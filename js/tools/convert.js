(() => {
  const dropzone = document.querySelector('[data-target="convert-input"]');
  const input = document.getElementById("convert-input");
  const folderInput = document.getElementById("convert-folder-input");
  const formatSelect = document.getElementById("convert-format");
  const runBtn = document.getElementById("convert-run");
  const resultArea = document.getElementById("convert-result");
  const listEl = document.getElementById("convert-list");

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

  function extensionFor(mimeType) {
    if (mimeType === "image/png") return "png";
    if (mimeType === "image/webp") return "webp";
    return "jpg";
  }

  runBtn.addEventListener("click", async () => {
    if (!currentFiles.length) return;
    runBtn.disabled = true;
    runBtn.textContent = "変換中...";
    listEl.innerHTML = "";
    resultArea.innerHTML = "";

    const targetType = formatSelect.value;
    const ext = extensionFor(targetType);
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

        if (targetType === "image/jpeg") {
          // JPEGは透明を扱えないため白背景で塗りつぶす
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(img, 0, 0);

        const blob = await new Promise((resolve) => canvas.toBlob(resolve, targetType, 0.92));
        const newName = `${file.name.replace(/\.[^/.]+$/, "")}.${ext}`;
        const converted = new File([blob], newName, { type: targetType });
        results.push(converted);
        li.innerHTML = `<span>${file.name}</span><span>${targetType.replace("image/", "").toUpperCase()}に変換しました</span>`;
      } catch (err) {
        li.innerHTML = `<span>${file.name}</span><span style="color:red;">失敗</span>`;
      }
    }

    if (results.length) {
      const saveResult = await saveProcessedFiles(results, { category: "画像", tool: "変換" });
      const savedMsg = saveResult === "folder" ? "指定したフォルダに保存しました。" : "ダウンロードしました。";
      resultArea.innerHTML = `
        <div class="result-card">
          <div class="result-info">
            <p>${results.length}件を変換しました。</p>
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
