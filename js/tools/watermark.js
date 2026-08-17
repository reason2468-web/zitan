(() => {
  const dropzone = document.querySelector('[data-target="watermark-input"]');
  const input = document.getElementById("watermark-input");
  const folderInput = document.getElementById("watermark-folder-input");
  const runBtn = document.getElementById("watermark-run");
  const resultArea = document.getElementById("watermark-result");
  const listEl = document.getElementById("watermark-list");
  const previewImg = document.getElementById("watermark-preview-img");

  const textInput = document.getElementById("watermark-text");
  const posBtns = document.querySelectorAll(".wm-pos-btn");
  const colorInput = document.getElementById("watermark-color");
  const sizeInput = document.getElementById("watermark-size");
  const sizeVal = document.getElementById("watermark-size-val");
  const opacityInput = document.getElementById("watermark-opacity");
  const opacityVal = document.getElementById("watermark-opacity-val");

  let currentFiles = [];
  let currentPos = "bottom-right";
  let previewToken = 0;

  function loadImageElement(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  function getSettings() {
    return {
      text: textInput.value.trim(),
      pos: currentPos,
      color: colorInput.value,
      sizeRatio: Number(sizeInput.value) / 100,
      opacity: Number(opacityInput.value) / 100,
    };
  }

  function drawWatermark(canvas, ctx, img, settings) {
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);

    if (!settings.text) return;

    const fontSize = Math.max(10, Math.round(canvas.width * settings.sizeRatio));
    const padding = Math.round(fontSize * 0.6);
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.globalAlpha = settings.opacity;
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2, fontSize * 0.08);
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.fillStyle = settings.color;

    const [vPos, hPos] = settings.pos.split("-");
    let x, y;
    if (hPos === "left") { ctx.textAlign = "left"; x = padding; }
    else if (hPos === "right") { ctx.textAlign = "right"; x = canvas.width - padding; }
    else { ctx.textAlign = "center"; x = canvas.width / 2; }

    if (vPos === "top") { ctx.textBaseline = "top"; y = padding; }
    else if (vPos === "bottom") { ctx.textBaseline = "bottom"; y = canvas.height - padding; }
    else { ctx.textBaseline = "middle"; y = canvas.height / 2; }

    ctx.strokeText(settings.text, x, y);
    ctx.fillText(settings.text, x, y);
    ctx.globalAlpha = 1;
  }

  async function updatePreview() {
    const token = ++previewToken;
    if (!currentFiles.length) {
      previewImg.hidden = true;
      return;
    }
    try {
      const img = await loadImageElement(currentFiles[0]);
      if (token !== previewToken) return;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      drawWatermark(canvas, ctx, img, getSettings());
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
      if (token !== previewToken) return;
      previewImg.src = URL.createObjectURL(blob);
      previewImg.hidden = false;
    } catch (err) {
      previewImg.hidden = true;
    }
  }

  function updateRunState() {
    runBtn.disabled = currentFiles.length === 0 || !textInput.value.trim();
  }

  posBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      posBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentPos = btn.dataset.pos;
      updatePreview();
    });
  });

  textInput.addEventListener("input", () => {
    updateRunState();
    updatePreview();
  });
  colorInput.addEventListener("input", updatePreview);
  sizeInput.addEventListener("input", () => {
    sizeVal.textContent = sizeInput.value;
    updatePreview();
  });
  opacityInput.addEventListener("input", () => {
    opacityVal.textContent = opacityInput.value;
    updatePreview();
  });

  async function loadFiles(fileList) {
    const newFiles = await loadImageFiles(fileList, { resultArea, listEl });
    currentFiles = mergeUniqueFiles(currentFiles, newFiles);
    updateRunState();
    if (currentFiles.length) {
      renderSelectedFiles(resultArea, currentFiles, (updated) => {
        currentFiles = updated;
        updateRunState();
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
    const settings = getSettings();
    if (!currentFiles.length || !settings.text) return;
    runBtn.disabled = true;
    runBtn.textContent = "処理中...";
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
        const ctx = canvas.getContext("2d");
        drawWatermark(canvas, ctx, img, settings);

        const mimeType = normalizeImageType(file.type) || "image/jpeg";
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, mimeType, 0.95));
        const watermarked = new File([blob], file.name, { type: mimeType });
        results.push(watermarked);
        li.innerHTML = `<span>${file.name}</span><span>処理しました</span>`;
      } catch (err) {
        li.innerHTML = `<span>${file.name}</span><span style="color:red;">失敗</span>`;
      }
    }

    if (results.length) {
      const saveResult = await saveProcessedFiles(
        results,
        { category: "画像", tool: "ウォーターマーク" },
        currentFiles.length > 1
      );
      const savedMsg = saveResult === "folder" ? "指定したフォルダに保存しました。" : "ダウンロードしました。";
      resultArea.innerHTML = `
        <div class="result-card">
          <div class="result-info">
            <p>${results.length}件にウォーターマークを追加しました。</p>
            <p>${savedMsg}</p>
          </div>
        </div>
      `;
    } else {
      resultArea.innerHTML = `<p style="color:red;">処理できたファイルがありませんでした。</p>`;
    }

    runBtn.disabled = false;
    runBtn.textContent = "ウォーターマークを追加する";
  });
})();
