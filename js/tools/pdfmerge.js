(() => {
  const dropzone = document.querySelector('[data-target="pdfmerge-input"]');
  const input = document.getElementById("pdfmerge-input");
  const listEl = document.getElementById("pdfmerge-list");
  const orderNote = document.getElementById("pdfmerge-order-note");
  const runBtn = document.getElementById("pdfmerge-run");
  const resultArea = document.getElementById("pdfmerge-result");

  let currentFiles = [];

  function isPdfFile(file) {
    return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  }

  function render() {
    listEl.innerHTML = currentFiles.map((file, i) => `
      <li data-index="${i}">
        <span class="pdfmerge-order">${i + 1}</span>
        <span class="pdfmerge-name">${file.name}</span>
        <span class="pdfmerge-size">${formatBytes(file.size)}</span>
        <div class="pdfmerge-item-actions">
          <button type="button" class="pdfmerge-move-btn" data-action="up" data-index="${i}" ${i === 0 ? "disabled" : ""} aria-label="上へ移動">▲</button>
          <button type="button" class="pdfmerge-move-btn" data-action="down" data-index="${i}" ${i === currentFiles.length - 1 ? "disabled" : ""} aria-label="下へ移動">▼</button>
          <button type="button" class="file-remove-btn" data-action="remove" data-index="${i}" aria-label="このファイルを削除">${TRASH_ICON}</button>
        </div>
      </li>
    `).join("");
    orderNote.hidden = currentFiles.length < 2;
    runBtn.disabled = currentFiles.length < 2;
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
    render();
  }

  setupDropzone(dropzone, input, loadFiles);

  listEl.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const idx = Number(btn.dataset.index);
    if (btn.dataset.action === "remove") {
      currentFiles = currentFiles.slice(0, idx).concat(currentFiles.slice(idx + 1));
    } else if (btn.dataset.action === "up" && idx > 0) {
      [currentFiles[idx - 1], currentFiles[idx]] = [currentFiles[idx], currentFiles[idx - 1]];
    } else if (btn.dataset.action === "down" && idx < currentFiles.length - 1) {
      [currentFiles[idx + 1], currentFiles[idx]] = [currentFiles[idx], currentFiles[idx + 1]];
    }
    render();
  });

  runBtn.addEventListener("click", async () => {
    if (currentFiles.length < 2) return;
    runBtn.disabled = true;
    runBtn.textContent = "結合中...";
    resultArea.innerHTML = "";

    try {
      const { PDFDocument } = PDFLib;
      const mergedPdf = await PDFDocument.create();

      for (const file of currentFiles) {
        const bytes = await file.arrayBuffer();
        let srcDoc;
        try {
          srcDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        } catch {
          throw new Error(`「${file.name}」を読み込めませんでした(壊れているか、パスワードで保護されている可能性があります)`);
        }
        const pages = await mergedPdf.copyPages(srcDoc, srcDoc.getPageIndices());
        pages.forEach((page) => mergedPdf.addPage(page));
      }

      const mergedBytes = await mergedPdf.save();
      const mergedFile = new File([mergedBytes], "結合.pdf", { type: "application/pdf" });
      const saveResult = await saveProcessedFiles([mergedFile], { category: "PDF", tool: "結合" }, false);
      const savedMsg = saveResult === "folder" ? "指定したフォルダに保存しました。" : "ダウンロードしました。";
      resultArea.innerHTML = `
        <div class="result-card">
          <div class="result-info">
            <p>${currentFiles.length}件のPDFを結合しました。</p>
            <p>${savedMsg}</p>
          </div>
        </div>
      `;
    } catch (err) {
      resultArea.innerHTML = `<p style="color:red;">${err.message || "結合に失敗しました。"}</p>`;
    }

    runBtn.disabled = currentFiles.length < 2;
    runBtn.textContent = "結合してダウンロード";
  });
})();
