(() => {
  const dropzone = document.querySelector('[data-target="watermark-input"]');
  const input = document.getElementById("watermark-input");
  const folderInput = document.getElementById("watermark-folder-input");
  const runBtn = document.getElementById("watermark-run");
  const resultArea = document.getElementById("watermark-result");
  const listEl = document.getElementById("watermark-list");
  const previewCanvas = document.getElementById("watermark-preview-canvas");

  const textControls = document.getElementById("wm-text-controls");
  const imageControls = document.getElementById("wm-image-controls");
  const textInput = document.getElementById("watermark-text");
  const colorInput = document.getElementById("watermark-color");
  const textSizeInput = document.getElementById("watermark-text-size");
  const textSizeVal = document.getElementById("watermark-text-size-val");
  const logoInput = document.getElementById("watermark-logo-input");
  const logoNameEl = document.getElementById("wm-logo-name");
  const imageSizeInput = document.getElementById("watermark-image-size");
  const imageSizeVal = document.getElementById("watermark-image-size-val");
  const opacityInput = document.getElementById("watermark-opacity");
  const opacityVal = document.getElementById("watermark-opacity-val");
  const posBtns = document.querySelectorAll(".wm-pos-btn");

  const PRESET_POS = {
    "top-left": { x: 0.12, y: 0.08 },
    "top-center": { x: 0.5, y: 0.08 },
    "top-right": { x: 0.88, y: 0.08 },
    "middle-left": { x: 0.12, y: 0.5 },
    "middle-center": { x: 0.5, y: 0.5 },
    "middle-right": { x: 0.88, y: 0.5 },
    "bottom-left": { x: 0.12, y: 0.92 },
    "bottom-center": { x: 0.5, y: 0.92 },
    "bottom-right": { x: 0.88, y: 0.92 },
  };

  let currentFiles = [];
  let previewBaseImg = null;
  let logoImg = null;
  let dragging = false;
  const pos = { ...PRESET_POS["bottom-right"] };

  function loadImageElement(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  function getMode() {
    return document.querySelector('input[name="watermark-mode"]:checked').value;
  }

  function getSettings() {
    return {
      mode: getMode(),
      text: textInput.value.trim(),
      color: colorInput.value,
      textSizeRatio: Number(textSizeInput.value) / 100,
      imageSizeRatio: Number(imageSizeInput.value) / 100,
      opacity: Number(opacityInput.value) / 100,
      x: pos.x,
      y: pos.y,
    };
  }

  function isReady(settings) {
    return settings.mode === "text" ? !!settings.text : !!logoImg;
  }

  function drawWatermark(canvas, ctx, baseImg, settings) {
    canvas.width = baseImg.naturalWidth;
    canvas.height = baseImg.naturalHeight;
    ctx.globalAlpha = 1;
    ctx.drawImage(baseImg, 0, 0);

    const cx = canvas.width * settings.x;
    const cy = canvas.height * settings.y;

    if (settings.mode === "text") {
      if (!settings.text) return;
      const fontSize = Math.max(10, Math.round(canvas.width * settings.textSizeRatio));
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.globalAlpha = settings.opacity;
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(2, fontSize * 0.08);
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.fillStyle = settings.color;
      ctx.strokeText(settings.text, cx, cy);
      ctx.fillText(settings.text, cx, cy);
    } else if (logoImg) {
      const w = canvas.width * settings.imageSizeRatio;
      const h = w * (logoImg.naturalHeight / logoImg.naturalWidth);
      ctx.globalAlpha = settings.opacity;
      ctx.drawImage(logoImg, cx - w / 2, cy - h / 2, w, h);
    }
    ctx.globalAlpha = 1;
  }

  function renderPreview() {
    if (!previewBaseImg) {
      previewCanvas.hidden = true;
      return;
    }
    const ctx = previewCanvas.getContext("2d");
    drawWatermark(previewCanvas, ctx, previewBaseImg, getSettings());
    previewCanvas.hidden = false;
  }

  async function refreshPreviewBaseImage() {
    if (!currentFiles.length) {
      previewBaseImg = null;
      renderPreview();
      return;
    }
    try {
      previewBaseImg = await loadImageElement(currentFiles[0]);
    } catch (err) {
      previewBaseImg = null;
    }
    renderPreview();
  }

  function updateRunState() {
    runBtn.disabled = currentFiles.length === 0 || !isReady(getSettings());
  }

  document.querySelectorAll('input[name="watermark-mode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      const mode = getMode();
      textControls.hidden = mode !== "text";
      imageControls.hidden = mode !== "image";
      updateRunState();
      renderPreview();
    });
  });

  textInput.addEventListener("input", () => {
    updateRunState();
    renderPreview();
  });
  colorInput.addEventListener("input", renderPreview);
  textSizeInput.addEventListener("input", () => {
    textSizeVal.textContent = textSizeInput.value;
    renderPreview();
  });
  imageSizeInput.addEventListener("input", () => {
    imageSizeVal.textContent = imageSizeInput.value;
    renderPreview();
  });
  opacityInput.addEventListener("input", () => {
    opacityVal.textContent = opacityInput.value;
    renderPreview();
  });

  logoInput.addEventListener("change", async () => {
    const file = logoInput.files[0];
    if (!file) return;
    logoNameEl.textContent = "読み込み中...";
    try {
      const converted = await toDecodableImageFile(file);
      logoImg = await loadImageElement(converted);
      logoNameEl.textContent = `選択中の画像:${file.name}`;
    } catch (err) {
      logoImg = null;
      logoNameEl.textContent = "画像を読み込めませんでした";
    }
    updateRunState();
    renderPreview();
  });

  posBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      posBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const p = PRESET_POS[btn.dataset.pos];
      pos.x = p.x;
      pos.y = p.y;
      renderPreview();
    });
  });

  function setPosFromEvent(e) {
    const rect = previewCanvas.getBoundingClientRect();
    pos.x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    pos.y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    posBtns.forEach((b) => b.classList.remove("active"));
    renderPreview();
  }

  previewCanvas.addEventListener("pointerdown", (e) => {
    if (previewCanvas.hidden) return;
    dragging = true;
    previewCanvas.setPointerCapture(e.pointerId);
    setPosFromEvent(e);
  });
  previewCanvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    setPosFromEvent(e);
  });
  previewCanvas.addEventListener("pointerup", () => { dragging = false; });
  previewCanvas.addEventListener("pointercancel", () => { dragging = false; });

  async function loadFiles(fileList) {
    const newFiles = await loadImageFiles(fileList, { resultArea, listEl });
    currentFiles = mergeUniqueFiles(currentFiles, newFiles);
    updateRunState();
    if (currentFiles.length) {
      renderSelectedFiles(resultArea, currentFiles, (updated) => {
        currentFiles = updated;
        updateRunState();
        refreshPreviewBaseImage();
      });
    }
    await refreshPreviewBaseImage();
  }

  setupDropzone(dropzone, input, loadFiles);
  folderInput.addEventListener("change", () => {
    if (folderInput.files.length) loadFiles(folderInput.files);
  });

  runBtn.addEventListener("click", async () => {
    const settings = getSettings();
    if (!currentFiles.length || !isReady(settings)) return;
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
        { category: "画像", tool: `ウォーターマーク.${settings.mode === "text" ? "文字" : "画像"}` },
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
