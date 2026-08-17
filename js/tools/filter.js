(() => {
  const dropzone = document.querySelector('[data-target="filter-input"]');
  const input = document.getElementById("filter-input");
  const folderInput = document.getElementById("filter-folder-input");
  const runBtn = document.getElementById("filter-run");
  const resultArea = document.getElementById("filter-result");
  const listEl = document.getElementById("filter-list");
  const previewImg = document.getElementById("filter-preview-img");

  let currentFiles = [];
  let previewToken = 0;

  const FILTER_CSS = {
    grayscale: "grayscale(100%)",
    sepia: "sepia(100%)",
    brighten: "brightness(130%)",
    vivid: "saturate(180%)",
    "blur-weak": "blur(2px)",
    "blur-medium": "blur(5px)",
    "blur-strong": "blur(10px)",
  };

  function loadImageElement(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  // 画像を小さく縮小してから拡大し直す(なめらかにしない)ことでモザイク状のブロックを作る
  function applyMosaic(canvas, ctx, img, blockSize = 12) {
    const w = canvas.width;
    const h = canvas.height;
    const smallW = Math.max(1, Math.round(w / blockSize));
    const smallH = Math.max(1, Math.round(h / blockSize));

    const tmp = document.createElement("canvas");
    tmp.width = smallW;
    tmp.height = smallH;
    tmp.getContext("2d").drawImage(img, 0, 0, smallW, smallH);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, smallW, smallH, 0, 0, w, h);
  }

  function applyFilterToCanvas(canvas, ctx, img, filterType) {
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    if (filterType === "mosaic") {
      applyMosaic(canvas, ctx, img);
    } else {
      ctx.filter = FILTER_CSS[filterType] || "none";
      ctx.drawImage(img, 0, 0);
    }
  }

  async function updatePreview() {
    const token = ++previewToken;
    if (!currentFiles.length) {
      previewImg.hidden = true;
      return;
    }
    const filterType = document.querySelector('input[name="filter-type"]:checked').value;
    try {
      const img = await loadImageElement(currentFiles[0]);
      if (token !== previewToken) return;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      applyFilterToCanvas(canvas, ctx, img, filterType);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
      if (token !== previewToken) return;
      previewImg.src = URL.createObjectURL(blob);
      previewImg.hidden = false;
    } catch (err) {
      previewImg.hidden = true;
    }
  }

  document.querySelectorAll('input[name="filter-type"]').forEach((radio) => {
    radio.addEventListener("change", updatePreview);
  });

  async function loadFiles(fileList) {
    const newFiles = await loadImageFiles(fileList, { resultArea, listEl });
    currentFiles = mergeUniqueFiles(currentFiles, newFiles);
    runBtn.disabled = currentFiles.length === 0;
    if (currentFiles.length) {
      renderSelectedFiles(resultArea, currentFiles, (updated) => {
        currentFiles = updated;
        runBtn.disabled = currentFiles.length === 0;
        updatePreview();
      });
    }
    updatePreview();
  }

  setupDropzone(dropzone, input, loadFiles);
  folderInput.addEventListener("change", () => {
    if (folderInput.files.length) loadFiles(folderInput.files);
  });

  runBtn.addEventListener("click", async () => {
    if (!currentFiles.length) return;
    runBtn.disabled = true;
    runBtn.textContent = "処理中...";
    listEl.innerHTML = "";
    resultArea.innerHTML = "";

    const filterType = document.querySelector('input[name="filter-type"]:checked').value;
    const results = [];

    for (const file of currentFiles) {
      const li = document.createElement("li");
      li.innerHTML = `<span>${file.name}</span><span>処理中...</span>`;
      listEl.appendChild(li);

      try {
        const img = await loadImageElement(file);
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        applyFilterToCanvas(canvas, ctx, img, filterType);

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
