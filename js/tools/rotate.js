(() => {
  const dropzone = document.querySelector('[data-target="rotate-input"]');
  const input = document.getElementById("rotate-input");
  const folderInput = document.getElementById("rotate-folder-input");
  const runBtn = document.getElementById("rotate-run");
  const resultArea = document.getElementById("rotate-result");
  const listEl = document.getElementById("rotate-list");

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

  function applyTransform(canvas, ctx, img, operation) {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    switch (operation) {
      case "rotate-right":
        canvas.width = h;
        canvas.height = w;
        ctx.translate(h, 0);
        ctx.rotate(Math.PI / 2);
        break;
      case "rotate-left":
        canvas.width = h;
        canvas.height = w;
        ctx.translate(0, w);
        ctx.rotate(-Math.PI / 2);
        break;
      case "rotate-180":
        canvas.width = w;
        canvas.height = h;
        ctx.translate(w, h);
        ctx.rotate(Math.PI);
        break;
      case "flip-h":
        canvas.width = w;
        canvas.height = h;
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
        break;
      case "flip-v":
        canvas.width = w;
        canvas.height = h;
        ctx.translate(0, h);
        ctx.scale(1, -1);
        break;
    }
    ctx.drawImage(img, 0, 0);
  }

  runBtn.addEventListener("click", async () => {
    if (!currentFiles.length) return;
    runBtn.disabled = true;
    runBtn.textContent = "処理中...";
    listEl.innerHTML = "";
    resultArea.innerHTML = "";

    const operation = document.querySelector('input[name="rotate-op"]:checked').value;
    const results = [];

    for (const file of currentFiles) {
      const li = document.createElement("li");
      li.innerHTML = `<span>${file.name}</span><span>処理中...</span>`;
      listEl.appendChild(li);

      try {
        const img = await loadImageElement(file);
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        applyTransform(canvas, ctx, img, operation);

        const mimeType = normalizeImageType(file.type) || "image/jpeg";
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, mimeType, 0.95));
        const rotated = new File([blob], file.name, { type: mimeType });
        results.push(rotated);
        li.innerHTML = `<span>${file.name}</span><span>処理しました</span>`;
      } catch (err) {
        li.innerHTML = `<span>${file.name}</span><span style="color:red;">失敗</span>`;
      }
    }

    if (results.length) {
      const saveResult = await saveProcessedFiles(
        results,
        { category: "画像", tool: "回転・反転" },
        currentFiles.length > 1
      );
      const savedMsg = saveResult === "folder" ? "指定したフォルダに保存しました。" : "ダウンロードしました。";
      resultArea.innerHTML = `
        <div class="result-card">
          <div class="result-info">
            <p>${results.length}件を処理しました。</p>
            <p>${savedMsg}</p>
          </div>
        </div>
      `;
    } else {
      resultArea.innerHTML = `<p style="color:red;">処理できたファイルがありませんでした。</p>`;
    }

    runBtn.disabled = false;
    runBtn.textContent = "回転・反転する";
  });
})();
