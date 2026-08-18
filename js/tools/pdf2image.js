(() => {
  const dropzone = document.querySelector('[data-target="pdf2image-input"]');
  const input = document.getElementById("pdf2image-input");
  const formatSelect = document.getElementById("pdf2image-format");
  const runBtn = document.getElementById("pdf2image-run");
  const resultArea = document.getElementById("pdf2image-result");
  const listEl = document.getElementById("pdf2image-list");

  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@2.16.105/build/pdf.worker.min.js";

  let currentFiles = [];

  function isPdfFile(file) {
    return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  }

  function getQualityMode() {
    const checked = document.querySelector('input[name="pdf2image-quality"]:checked');
    return checked ? checked.value : "standard";
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

  async function pdfFileToImages(file, format, scale) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const ext = format === "image/png" ? "png" : "jpg";
    const baseName = file.name.replace(/\.pdf$/i, "");
    const results = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      if (format === "image/jpeg") {
        // JPEGは透明を扱えないため白背景で塗りつぶす
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      await page.render({ canvasContext: ctx, viewport }).promise;

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, format, 0.92));
      const pageLabel = pdf.numPages > 1 ? `_p${String(i).padStart(2, "0")}` : "";
      results.push(new File([blob], `${baseName}${pageLabel}.${ext}`, { type: format }));
    }
    return results;
  }

  runBtn.addEventListener("click", async () => {
    if (!currentFiles.length) return;
    runBtn.disabled = true;
    runBtn.textContent = "変換中...";
    listEl.innerHTML = "";
    resultArea.innerHTML = "";

    const format = formatSelect.value;
    const scale = getQualityMode() === "high" ? 4 : 2;
    const label = format === "image/png" ? "PNG" : "JPEG";
    const allResults = [];

    for (const file of currentFiles) {
      const li = document.createElement("li");
      li.innerHTML = `<span>${file.name}</span><span>処理中...</span>`;
      listEl.appendChild(li);

      try {
        const images = await pdfFileToImages(file, format, scale);
        allResults.push(...images);
        li.innerHTML = `<span>${file.name}</span><span>${images.length}枚の${label}に変換しました</span>`;
      } catch (err) {
        li.innerHTML = `<span>${file.name}</span><span style="color:red;">失敗</span>`;
      }
    }

    if (allResults.length) {
      const saveResult = await saveProcessedFiles(allResults, { category: "PDF", tool: `画像変換.${label}` }, allResults.length > 1);
      const savedMsg = saveResult === "folder" ? "指定したフォルダに保存しました。" : "ダウンロードしました。";
      resultArea.innerHTML = `
        <div class="result-card">
          <div class="result-info">
            <p>${allResults.length}枚の画像に変換しました。</p>
            <p>${savedMsg}</p>
          </div>
        </div>
      `;
    } else {
      resultArea.innerHTML = `<p style="color:red;">変換できたファイルがありませんでした。</p>`;
    }

    runBtn.disabled = false;
    runBtn.textContent = "変換する";
  });
})();
