(() => {
  const dropzone = document.querySelector('[data-target="pdfcompress-input"]');
  const input = document.getElementById("pdfcompress-input");
  const runBtn = document.getElementById("pdfcompress-run");
  const resultArea = document.getElementById("pdfcompress-result");
  const listEl = document.getElementById("pdfcompress-list");

  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@2.16.105/build/pdf.worker.min.js";

  let currentFiles = [];

  function isPdfFile(file) {
    return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  }

  function getMode() {
    const checked = document.querySelector('input[name="pdfcompress-mode"]:checked');
    return checked ? checked.value : "images";
  }

  function getLevel() {
    const checked = document.querySelector('input[name="pdfcompress-level"]:checked');
    return checked ? checked.value : "recommended";
  }

  // PDF専用のファイル選択プレビュー(共通のbuildSelectedFilesPreviewは<img>サムネイル前提で
  // PDFには使えないため、同じ見た目のクラスを使って独自に組み立てる)
  function buildSelectedPdfPreview(files) {
    const maxShow = 10;
    const shown = files.slice(0, maxShow);
    const remaining = files.length - shown.length;
    const items = shown.map((f, i) => `
      <li data-index="${i}">
        <button type="button" class="file-remove-btn" data-index="${i}" aria-label="このファイルを削除">${TRASH_ICON}</button>
        <span class="file-thumb pdf-file-icon" aria-hidden="true">📄</span>
        <span class="file-name">${f.name}</span>
        <span class="file-size">${formatBytes(f.size)}</span>
      </li>
    `).join("");
    const moreItem = remaining > 0 ? `<li class="file-list-more">ほか${remaining}件</li>` : "";
    return `
      <div class="selected-file-header">
        <p>${files.length}件のPDFを選択中</p>
        <button type="button" class="clear-all-btn">すべて削除</button>
      </div>
      <ul class="selected-file-list">${items}${moreItem}</ul>
    `;
  }

  function renderSelectedPdfFiles(files, onChange) {
    function render(list) {
      resultArea.innerHTML = buildSelectedPdfPreview(list);
      resultArea.querySelectorAll(".file-remove-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = Number(btn.dataset.index);
          list = list.slice(0, idx).concat(list.slice(idx + 1));
          render(list);
          onChange(list);
        });
      });
      const clearBtn = resultArea.querySelector(".clear-all-btn");
      if (clearBtn) {
        clearBtn.addEventListener("click", () => {
          list = [];
          resultArea.innerHTML = "";
          onChange(list);
        });
      }
    }
    render(files);
  }

  async function loadFiles(fileList) {
    const allFiles = Array.from(fileList);
    const pdfFiles = allFiles.filter(isPdfFile);
    if (!pdfFiles.length) {
      resultArea.innerHTML = `<p style="color:red;">PDFファイルが見つかりませんでした。</p>`;
      return;
    }
    currentFiles = mergeUniqueFiles(currentFiles, pdfFiles);
    runBtn.disabled = currentFiles.length === 0;
    if (currentFiles.length) {
      renderSelectedPdfFiles(currentFiles, (updated) => {
        currentFiles = updated;
        runBtn.disabled = currentFiles.length === 0;
      });
    }
  }

  setupDropzone(dropzone, input, loadFiles);

  // ---------- モード1: 写真(JPEG)だけを再圧縮する。文字・ベクター部分には触れない ----------
  //
  // PDF内の画像はXObjectという部品として保存されている。JPEGとして保存されている
  // (Filterが DCTDecode の)画像だけを対象に、画像の生バイト列を取り出して
  // canvasで縮小・再エンコードし、同じ場所(同じ参照番号)に差し替える。
  // 対応できない形式や、途中で何か失敗した画像は安全のため元のまま残す。
  async function compressPdfImages(file, { maxDimension, quality }) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdfDoc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
    const { context } = pdfDoc;
    const { PDFName, PDFRawStream, PDFNumber, PDFArray } = PDFLib;

    const NAME_SUBTYPE = PDFName.of("Subtype");
    const NAME_IMAGE = PDFName.of("Image");
    const NAME_FILTER = PDFName.of("Filter");
    const NAME_DCT = PDFName.of("DCTDecode");
    const NAME_WIDTH = PDFName.of("Width");
    const NAME_HEIGHT = PDFName.of("Height");
    const NAME_COLORSPACE = PDFName.of("ColorSpace");
    const NAME_DEVICERGB = PDFName.of("DeviceRGB");
    const NAME_BPC = PDFName.of("BitsPerComponent");
    const NAME_LENGTH = PDFName.of("Length");
    const NAME_IMAGEMASK = PDFName.of("ImageMask");
    const NAME_DECODEPARMS = PDFName.of("DecodeParms");
    const NAME_DECODE = PDFName.of("Decode");

    let changedCount = 0;

    for (const [ref, obj] of context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      const dict = obj.dict;
      if (dict.get(NAME_SUBTYPE) !== NAME_IMAGE) continue;
      if (dict.get(NAME_IMAGEMASK)) continue;
      const filter = dict.get(NAME_FILTER);
      const isDct = filter === NAME_DCT || (filter instanceof PDFArray && filter.asArray().includes(NAME_DCT));
      if (!isDct) continue;

      try {
        const originalBytes = obj.contents;
        const bitmap = await createImageBitmap(new Blob([originalBytes], { type: "image/jpeg" }));
        const shrink = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
        const newWidth = Math.max(1, Math.round(bitmap.width * shrink));
        const newHeight = Math.max(1, Math.round(bitmap.height * shrink));

        const canvas = document.createElement("canvas");
        canvas.width = newWidth;
        canvas.height = newHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(bitmap, 0, 0, newWidth, newHeight);
        bitmap.close();

        const newBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
        const newBytes = new Uint8Array(await newBlob.arrayBuffer());

        // 再圧縮しても小さくならなかった画像は、安全のため元のまま残す
        if (!newBytes.length || newBytes.length >= originalBytes.length) continue;

        const newDict = dict.clone(context);
        newDict.set(NAME_WIDTH, PDFNumber.of(newWidth));
        newDict.set(NAME_HEIGHT, PDFNumber.of(newHeight));
        newDict.set(NAME_COLORSPACE, NAME_DEVICERGB);
        newDict.set(NAME_BPC, PDFNumber.of(8));
        newDict.set(NAME_FILTER, NAME_DCT);
        newDict.delete(NAME_DECODEPARMS);
        newDict.delete(NAME_DECODE);
        newDict.set(NAME_LENGTH, PDFNumber.of(newBytes.length));

        context.assign(ref, PDFRawStream.of(newDict, newBytes));
        changedCount++;
      } catch {
        // 対応できない画像(CMYKなど)は安全のためスキップし、元のまま残す
      }
    }

    const savedBytes = await pdfDoc.save();
    return { bytes: savedBytes, changedCount };
  }

  // ---------- モード2: ページ全体を画像として保存し直す(pdf2image.jsの描画 + convert.jsの埋め込みと同じ手法) ----------

  async function rasterizePdfFile(file, { scale, quality }) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const pdfDoc = await PDFLib.PDFDocument.create();

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const baseViewport = page.getViewport({ scale: 1 });
      const renderViewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = renderViewport.width;
      canvas.height = renderViewport.height;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: renderViewport }).promise;

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      const jpegBytes = new Uint8Array(await blob.arrayBuffer());
      const jpgImage = await pdfDoc.embedJpg(jpegBytes);

      // 画像の解像度(scale)は落としても、ページ自体の物理サイズは元のまま保つ
      const newPage = pdfDoc.addPage([baseViewport.width, baseViewport.height]);
      newPage.drawImage(jpgImage, { x: 0, y: 0, width: baseViewport.width, height: baseViewport.height });
    }

    return await pdfDoc.save();
  }

  async function compressOneFile(file, mode, level) {
    if (mode === "images") {
      const settings = level === "strong" ? { maxDimension: 1100, quality: 0.5 } : { maxDimension: 1600, quality: 0.75 };
      return await compressPdfImages(file, settings);
    }
    const settings = level === "strong" ? { scale: 1.0, quality: 0.55 } : { scale: 1.5, quality: 0.75 };
    const bytes = await rasterizePdfFile(file, settings);
    return { bytes };
  }

  runBtn.addEventListener("click", async () => {
    if (!currentFiles.length) return;
    runBtn.disabled = true;
    runBtn.textContent = "圧縮中...";
    listEl.innerHTML = "";
    resultArea.innerHTML = "";

    const mode = getMode();
    const level = getLevel();
    const results = [];
    let totalBefore = 0;
    let totalAfter = 0;

    for (const file of currentFiles) {
      const li = document.createElement("li");
      li.innerHTML = `<span>${file.name}</span><span>処理中...</span>`;
      listEl.appendChild(li);

      try {
        const { bytes } = await compressOneFile(file, mode, level);
        // 圧縮の効果がなかった(むしろ大きくなった)場合は、元のファイルのまま残す
        const finalFile = bytes.length < file.size
          ? new File([bytes], file.name, { type: "application/pdf" })
          : file;

        results.push(finalFile);
        totalBefore += file.size;
        totalAfter += finalFile.size;

        const reduction = Math.round((1 - finalFile.size / file.size) * 100);
        const summary = reduction > 0
          ? `${formatBytes(file.size)} → ${formatBytes(finalFile.size)}(-${reduction}%)`
          : `効果なし(元のサイズのまま)`;
        li.innerHTML = `<span>${file.name}</span><span>${summary}</span>`;
      } catch (err) {
        li.innerHTML = `<span>${file.name}</span><span style="color:red;">失敗</span>`;
      }
    }

    if (results.length) {
      const modeLabel = mode === "rasterize" ? "ページ全体" : "写真のみ";
      const saveResult = await saveProcessedFiles(results, { category: "PDF", tool: `圧縮.${modeLabel}` }, currentFiles.length > 1);
      const savedMsg = saveResult === "folder" ? "指定したフォルダに保存しました。" : "ダウンロードしました。";
      const reduction = Math.round((1 - totalAfter / totalBefore) * 100);
      resultArea.innerHTML = `
        <div class="result-card">
          <div class="result-info">
            <p>${results.length}件を処理:${formatBytes(totalBefore)} → ${formatBytes(totalAfter)}
              <span class="reduction">(${reduction > 0 ? "-" + reduction : reduction}%)</span>
            </p>
            <p>${savedMsg}</p>
          </div>
        </div>
      `;
    } else {
      resultArea.innerHTML = `<p style="color:red;">圧縮できたファイルがありませんでした。</p>`;
    }

    runBtn.disabled = false;
    runBtn.textContent = "圧縮する";
  });
})();
