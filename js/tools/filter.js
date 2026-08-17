(() => {
  const dropzone = document.querySelector('[data-target="filter-input"]');
  const input = document.getElementById("filter-input");
  const folderInput = document.getElementById("filter-folder-input");
  const runBtn = document.getElementById("filter-run");
  const resultArea = document.getElementById("filter-result");
  const listEl = document.getElementById("filter-list");

  let currentFiles = [];

  async function loadFiles(fileList) {
    const newFiles = await loadImageFiles(fileList, { resultArea, listEl });
    currentFiles = currentFiles.concat(newFiles);
    runBtn.disabled = currentFiles.length === 0;
    if (currentFiles.length) {
      renderSelectedFiles(resultArea, currentFiles, (updated) => {
        currentFiles = updated;
        runBtn.disabled = currentFiles.length === 0;
      });
    }
  }

  setupDropzone(dropzone, input, loadFiles);
  folderInput.addEventListener("change", () => {
    if (folderInput.files.length) loadFiles(folderInput.files);
  });

  function loadImageElement(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  runBtn.addEventListener("click", async () => {
    if (!currentFiles.length) return;
    runBtn.disabled = true;
    runBtn.textContent = "処理中...";
    listEl.innerHTML = "";
    resultArea.innerHTML = "";

    const filterValue = document.querySelector('input[name="filter-type"]:checked').value;
    const results = [];

    for (const file of currentFiles) {
      const li = document.createElement("li");
      li.innerHTML = `<span>${file.name}</span><span>処理中...</span>`;
      listEl.appendChild(li);

      try {
        const img = await loadImageElement(file);
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        ctx.filter = filterValue;
        ctx.drawImage(img, 0, 0);

        const mimeType = normalizeImageType(file.type) || "image/jpeg";
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, mimeType, 0.92));
        const filtered = new File([blob], file.name, { type: mimeType });
        results.push(filtered);
        li.innerHTML = `<span>${file.name}</span><span>処理しました</span>`;
      } catch (err) {
        li.innerHTML = `<span>${file.name}</span><span style="color:red;">失敗</span>`;
      }
    }

    if (results.length) {
      const saveResult = await saveProcessedFiles(
        results,
        { category: "画像", tool: "フィルター" },
        currentFiles.length > 1
      );
      const savedMsg = saveResult === "folder" ? "指定したフォルダに保存しました。" : "ダウンロードしました。";
      resultArea.innerHTML = `
        <div class="result-card">
          <div class="result-info">
            <p>${results.length}件にフィルターを適用しました。</p>
            <p>${savedMsg}</p>
          </div>
        </div>
      `;
    } else {
      resultArea.innerHTML = `<p style="color:red;">処理できたファイルがありませんでした。</p>`;
    }

    runBtn.disabled = false;
    runBtn.textContent = "フィルターを適用する";
  });
})();
