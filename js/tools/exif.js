(() => {
  const dropzone = document.querySelector('[data-target="exif-input"]');
  const input = document.getElementById("exif-input");
  const folderInput = document.getElementById("exif-folder-input");
  const runBtn = document.getElementById("exif-run");
  const resultArea = document.getElementById("exif-result");
  const listEl = document.getElementById("exif-list");

  let currentFiles = [];

  async function loadFiles(fileList) {
    currentFiles = await loadImageFiles(fileList, { resultArea, listEl });
    runBtn.disabled = currentFiles.length === 0;
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
    runBtn.textContent = "削除中...";
    listEl.innerHTML = "";
    resultArea.innerHTML = "";

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
        // Canvasに描き直して書き出すだけで、Exif(撮影日時・GPS位置情報など)は自動的に失われる
        ctx.drawImage(img, 0, 0);

        const mimeType = normalizeImageType(file.type) || "image/jpeg";
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, mimeType, 0.95));
        const cleaned = new File([blob], file.name, { type: mimeType });
        results.push(cleaned);
        li.innerHTML = `<span>${file.name}</span><span>撮影情報を削除しました</span>`;
      } catch (err) {
        li.innerHTML = `<span>${file.name}</span><span style="color:red;">失敗</span>`;
      }
    }

    if (results.length) {
      const saveResult = await saveProcessedFiles(
        results,
        { category: "画像", tool: "Exif削除" },
        currentFiles.length > 1
      );
      const savedMsg = saveResult === "folder" ? "指定したフォルダに保存しました。" : "ダウンロードしました。";
      resultArea.innerHTML = `
        <div class="result-card">
          <div class="result-info">
            <p>${results.length}件から撮影日時・位置情報などを削除しました。</p>
            <p>${savedMsg}</p>
          </div>
        </div>
      `;
    } else {
      resultArea.innerHTML = `<p style="color:red;">処理できたファイルがありませんでした。</p>`;
    }

    runBtn.disabled = false;
    runBtn.textContent = "Exifを削除する";
  });
})();
