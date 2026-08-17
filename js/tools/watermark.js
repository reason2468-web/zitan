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
  const logoDropzone = document.querySelector('[data-target="watermark-logo-input"]');
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
  let dragTarget = null;
  const pos = {
    text: { ...PRESET_POS["bottom-right"] },
    image: { ...PRESET_POS["top-right"] },
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
    };
  }

  function hasText(settings) {
    return (settings.mode === "text" || settings.mode === "both") && !!settings.text;
  }

  function hasImage(settings) {
    return (settings.mode === "image" || settings.mode === "both") && !!logoImg;
  }

  function isReady(settings) {
    if (settings.mode === "text") return !!settings.text;
    if (settings.mode === "image") return !!logoImg;
    return !!settings.text || !!logoImg;
  }

  function drawWatermark(canvas, ctx, baseImg, settings) {
    canvas.width = baseImg.naturalWidth;
    canvas.height = baseImg.naturalHeight;
    ctx.globalAlpha = 1;
    ctx.drawImage(baseImg, 0, 0);

    if (hasImage(settings)) {
      const cx = canvas.width * pos.image.x;
      const cy = canvas.height * pos.image.y;
      const w = canvas.width * settings.imageSizeRatio;
      const h = w * (logoImg.naturalHeight / logoImg.naturalWidth);
      ctx.globalAlpha = settings.opacity;
      ctx.drawImage(logoImg, cx - w / 2, cy - h / 2, w, h);
    }

    if (hasText(settings)) {
      const cx = canvas.width * pos.text.x;
      const cy = canvas.height * pos.text.y;
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
      textControls.hidden = mode === "image";
      imageControls.hidden = mode === "text";
      if (mode === "both" && pos.text.x === pos.image.x && pos.text.y === pos.image.y) {
        pos.image = { ...PRESET_POS["top-right"] };
      }
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

  async function loadLogoFile(fileList) {
    const file = fileList[0];
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
  }

  setupDropzone(logoDropzone, logoInput, loadLogoFile);

  posBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      posBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const p = PRESET_POS[btn.dataset.pos];
      pos.text.x = p.x;
      pos.text.y = p.y;
      pos.image.x = p.x;
      pos.image.y = p.y;
      renderPreview();
    });
  });

  function getTextBoxRatio(settings) {
    const cw = previewBaseImg.naturalWidth;
    const ch = previewBaseImg.naturalHeight;
    const fontSize = Math.max(10, Math.round(cw * settings.textSizeRatio));
    const ctx = previewCanvas.getContext("2d");
    ctx.font = `bold ${fontSize}px sans-serif`;
    const w = ctx.measureText(settings.text).width;
    const h = fontSize * 1.2;
    return { cx: pos.text.x, cy: pos.text.y, halfW: (w / 2) / cw, halfH: (h / 2) / ch };
  }

  function getImageBoxRatio(settings) {
    const cw = previewBaseImg.naturalWidth;
    const ch = previewBaseImg.naturalHeight;
    const w = cw * settings.imageSizeRatio;
    const h = w * (logoImg.naturalHeight / logoImg.naturalWidth);
    return { cx: pos.image.x, cy: pos.image.y, halfW: (w / 2) / cw, halfH: (h / 2) / ch };
  }

  function pickDragTarget(rx, ry, settings) {
    const candidates = [];
    if (hasText(settings)) candidates.push({ key: "text", ...getTextBoxRatio(settings) });
    if (hasImage(settings)) candidates.push({ key: "image", ...getImageBoxRatio(settings) });
    if (!candidates.length) return null;

    const inside = candidates.filter((b) => Math.abs(rx - b.cx) <= b.halfW && Math.abs(ry - b.cy) <= b.halfH);
    if (inside.length) {
      inside.sort((a, b) => (a.halfW * a.halfH) - (b.halfW * b.halfH));
      return inside[0].key;
    }
    candidates.sort((a, b) => Math.hypot(rx - a.cx, ry - a.cy) - Math.hypot(rx - b.cx, ry - b.cy));
    return candidates[0].key;
  }

  function eventToRatio(e) {
    const rect = previewCanvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  }

  previewCanvas.addEventListener("pointerdown", (e) => {
    if (previewCanvas.hidden || !previewBaseImg) return;
    const { x, y } = eventToRatio(e);
    dragTarget = pickDragTarget(x, y, getSettings());
    if (!dragTarget) return;
    dragging = true;
    previewCanvas.setPointerCapture(e.pointerId);
    pos[dragTarget].x = x;
    pos[dragTarget].y = y;
    posBtns.forEach((b) => b.classList.remove("active"));
    renderPreview();
  });
  previewCanvas.addEventListener("pointermove", (e) => {
    if (!dragging || !dragTarget) return;
    const { x, y } = eventToRatio(e);
    pos[dragTarget].x = x;
    pos[dragTarget].y = y;
    renderPreview();
  });
  previewCanvas.addEventListener("pointerup", () => { dragging = false; dragTarget = null; });
  previewCanvas.addEventListener("pointercancel", () => { dragging = false; dragTarget = null; });

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
      const modeLabel = settings.mode === "text" ? "文字" : settings.mode === "image" ? "画像" : "文字と画像";
      const saveResult = await saveProcessedFiles(
        results,
        { category: "画像", tool: `ウォーターマーク.${modeLabel}` },
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
