(() => {
  const dropzone = document.querySelector('[data-target="pdfsplit-input"]');
  const input = document.getElementById("pdfsplit-input");
  const selectResult = document.getElementById("pdfsplit-select-result");
  const everyRow = document.getElementById("pdfsplit-every-row");
  const everyInput = document.getElementById("pdfsplit-every");
  const runBtn = document.getElementById("pdfsplit-run");
  const listEl = document.getElementById("pdfsplit-list");
  const resultArea = document.getElementById("pdfsplit-result");
  const visualContainer = document.getElementById("pdfsplit-visual");
  const thumbRow = document.getElementById("pdfsplit-thumb-row");
  const visualRunBtn = document.getElementById("pdfsplit-visual-run");

  const MAX_VISUAL_PAGES = 60;

  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@2.16.105/build/pdf.worker.min.js";

  let currentFiles = [];
  let splitPoints = new Set();
  let visualRenderToken = 0;

  function isPdfFile(file) {
    return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  }

  function currentMode() {
    return document.querySelector('input[name="pdfsplit-mode"]:checked').value;
  }

  // pdf-libで指定ページだけの新しいPDFファイルを作る(通常の分割・ページ指定分割で共通利用)
  async function extractPdfGroup(PDFDocument, srcDoc, baseNoExt, group) {
    const newDoc = await PDFDocument.create();
    const pages = await newDoc.copyPages(srcDoc, group);
    pages.forEach((p) => newDoc.addPage(p));
    const outBytes = await newDoc.save();
    const start = group[0] + 1;
    const end = group[group.length - 1] + 1;
    const pageLabel = start === end ? `p${start}` : `p${start}-${end}`;
    return new File([outBytes], `${baseNoExt}_${pageLabel}.pdf`, { type: "application/pdf" });
  }

  // 画像用のbuildSelectedFilesPreviewはサムネイル前提のため、PDF用に同じ見た目の一覧を個別に組み立てる
  function renderSelectList() {
    if (!currentFiles.length) {
      selectResult.innerHTML = "";
      runBtn.disabled = true;
      visualRunBtn.disabled = true;
      return;
    }
    const maxShow = 10;
    const shown = currentFiles.slice(0, maxShow);
    const remaining = currentFiles.length - shown.length;
    const items = shown.map((f, i) => `
      <li data-index="${i}">
        <button type="button" class="file-remove-btn" data-index="${i}" aria-label="このファイルを削除">${TRASH_ICON}</button>
        <span class="file-name">${f.name}</span>
        <span class="file-size">${formatBytes(f.size)}</span>
      </li>
    `).join("");
    const moreItem = remaining > 0 ? `<li class="file-list-more">ほか${remaining}件</li>` : "";
    selectResult.innerHTML = `
      <div class="selected-file-header">
        <p>${currentFiles.length}件のPDFを選択中</p>
        <button type="button" class="clear-all-btn">すべて削除</button>
      </div>
      <ul class="selected-file-list">${items}${moreItem}</ul>
    `;
    selectResult.querySelectorAll(".file-remove-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.index);
        currentFiles = currentFiles.slice(0, idx).concat(currentFiles.slice(idx + 1));
        renderSelectList();
        if (currentMode() === "visual") renderThumbnails();
      });
    });
    const clearBtn = selectResult.querySelector(".clear-all-btn");
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        currentFiles = [];
        renderSelectList();
        if (currentMode() === "visual") renderThumbnails();
      });
    }
    runBtn.disabled = false;
  }

  function loadFiles(fileList) {
    const allFiles = Array.from(fileList);
    const pdfFiles = allFiles.filter(isPdfFile);
    if (!pdfFiles.length) {
      resultArea.innerHTML = `<p style="color:red;">PDFファイルが見つかりませんでした。</p>`;
      return;
    }
    resultArea.innerHTML = "";
    currentFiles = mergeUniqueFiles(currentFiles, pdfFiles);
    renderSelectList();
    if (currentMode() === "visual") renderThumbnails();
  }

  setupDropzone(dropzone, input, loadFiles);

  function updateVisualRunLabel(pageCount) {
    const count = splitPoints.size + 1;
    visualRunBtn.textContent = splitPoints.size
      ? `${count}個のファイルに分割してダウンロード`
      : "分割位置を選んでください";
    visualRunBtn.disabled = splitPoints.size === 0;
  }

  async function renderThumbnails() {
    const token = ++visualRenderToken;
    splitPoints = new Set();
    visualRunBtn.disabled = true;
    visualRunBtn.textContent = "分割位置を選んでください";

    if (currentFiles.length !== 1) {
      thumbRow.innerHTML = `<p style="color:red;">このモードは、PDFを1つだけ選んだときに使えます(現在${currentFiles.length}件選択中)</p>`;
      return;
    }

    const file = currentFiles[0];
    thumbRow.innerHTML = `<p>ページを読み込み中...</p>`;

    try {
      const bytes = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
      if (token !== visualRenderToken) return;
      const pageCount = pdf.numPages;

      if (pageCount > MAX_VISUAL_PAGES) {
        thumbRow.innerHTML = `<p style="color:red;">ページ数が多いため(${MAX_VISUAL_PAGES}ページ超)、このモードでは表示できません。他の分割方法をお試しください。</p>`;
        return;
      }

      thumbRow.innerHTML = "";
      for (let i = 1; i <= pageCount; i++) {
        const page = await pdf.getPage(i);
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = 110 / baseViewport.width;
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        if (token !== visualRenderToken) return;

        const card = document.createElement("div");
        card.className = "pdfsplit-thumb-card";
        card.appendChild(canvas);
        const num = document.createElement("span");
        num.className = "pdfsplit-thumb-num";
        num.textContent = i;
        card.appendChild(num);
        thumbRow.appendChild(card);

        if (i < pageCount) {
          const divider = document.createElement("button");
          divider.type = "button";
          divider.className = "pdfsplit-divider";
          divider.setAttribute("aria-label", `${i}ページ目の後ろで分割`);
          divider.title = "ここで分割";
          divider.innerHTML = `<span class="pdfsplit-divider-icon">✂</span>`;
          divider.addEventListener("click", () => {
            if (splitPoints.has(i)) splitPoints.delete(i);
            else splitPoints.add(i);
            divider.classList.toggle("active", splitPoints.has(i));
            updateVisualRunLabel(pageCount);
          });
          thumbRow.appendChild(divider);
        }
      }

      updateVisualRunLabel(pageCount);
    } catch {
      if (token !== visualRenderToken) return;
      thumbRow.innerHTML = `<p style="color:red;">ページを読み込めませんでした(壊れているか、パスワード保護されている可能性があります)</p>`;
    }
  }

  function updateModeVisibility() {
    const mode = currentMode();
    everyRow.hidden = mode !== "every";
    runBtn.hidden = mode === "visual";
    visualContainer.hidden = mode !== "visual";
    if (mode === "visual") renderThumbnails();
  }
  document.querySelectorAll('input[name="pdfsplit-mode"]').forEach((radio) => {
    radio.addEventListener("change", updateModeVisibility);
  });
  updateModeVisibility();

  runBtn.addEventListener("click", async () => {
    if (!currentFiles.length) return;
    const mode = currentMode();
    const every = Math.max(1, Math.floor(Number(everyInput.value)) || 1);

    runBtn.disabled = true;
    runBtn.textContent = "分割中...";
    listEl.innerHTML = "";
    resultArea.innerHTML = "";

    const { PDFDocument } = PDFLib;
    const results = [];

    for (const file of currentFiles) {
      const li = document.createElement("li");
      li.innerHTML = `<span>${file.name}</span><span>処理中...</span>`;
      listEl.appendChild(li);

      try {
        const bytes = await file.arrayBuffer();
        const srcDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pageCount = srcDoc.getPageCount();
        const baseNoExt = file.name.replace(/\.pdf$/i, "");

        const groups = [];
        if (mode === "single") {
          for (let i = 0; i < pageCount; i++) groups.push([i]);
        } else {
          for (let i = 0; i < pageCount; i += every) {
            const group = [];
            for (let j = i; j < Math.min(i + every, pageCount); j++) group.push(j);
            groups.push(group);
          }
        }

        for (const group of groups) {
          results.push(await extractPdfGroup(PDFDocument, srcDoc, baseNoExt, group));
        }

        li.innerHTML = `<span>${file.name}</span><span>${groups.length}個のファイルに分割(全${pageCount}ページ)</span>`;
      } catch {
        li.innerHTML = `<span>${file.name}</span><span style="color:red;">失敗(壊れているか、パスワード保護されている可能性があります)</span>`;
      }
    }

    if (results.length) {
      const modeLabel = mode === "single" ? "1ページずつ" : `${every}ページごと`;
      const saveResult = await saveProcessedFiles(results, { category: "PDF", tool: `分割.${modeLabel}` }, currentFiles.length > 1);
      const savedMsg = saveResult === "folder" ? "指定したフォルダに保存しました。" : "ダウンロードしました。";
      resultArea.innerHTML = `
        <div class="result-card">
          <div class="result-info">
            <p>${results.length}件のファイルに分割しました。</p>
            <p>${savedMsg}</p>
          </div>
        </div>
      `;
    } else {
      resultArea.innerHTML = `<p style="color:red;">分割できたファイルがありませんでした。</p>`;
    }

    runBtn.disabled = currentFiles.length === 0;
    runBtn.textContent = "分割してダウンロード";
  });

  visualRunBtn.addEventListener("click", async () => {
    if (!splitPoints.size || currentFiles.length !== 1) return;
    const file = currentFiles[0];
    const originalLabel = visualRunBtn.textContent;
    visualRunBtn.disabled = true;
    visualRunBtn.textContent = "分割中...";
    resultArea.innerHTML = "";

    try {
      const { PDFDocument } = PDFLib;
      const bytes = await file.arrayBuffer();
      const srcDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pageCount = srcDoc.getPageCount();
      const baseNoExt = file.name.replace(/\.pdf$/i, "");

      const sortedPoints = Array.from(splitPoints).sort((a, b) => a - b);
      const boundaries = [0, ...sortedPoints, pageCount];
      const results = [];
      for (let i = 0; i < boundaries.length - 1; i++) {
        const group = [];
        for (let p = boundaries[i]; p < boundaries[i + 1]; p++) group.push(p);
        results.push(await extractPdfGroup(PDFDocument, srcDoc, baseNoExt, group));
      }

      const saveResult = await saveProcessedFiles(results, { category: "PDF", tool: "分割.ページ指定" }, true);
      const savedMsg = saveResult === "folder" ? "指定したフォルダに保存しました。" : "ダウンロードしました。";
      resultArea.innerHTML = `
        <div class="result-card">
          <div class="result-info">
            <p>${results.length}件のファイルに分割しました。</p>
            <p>${savedMsg}</p>
          </div>
        </div>
      `;
    } catch {
      resultArea.innerHTML = `<p style="color:red;">分割に失敗しました。</p>`;
    }

    visualRunBtn.disabled = false;
    visualRunBtn.textContent = originalLabel;
  });
})();
