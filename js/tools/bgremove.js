(() => {
  const dropzone = document.querySelector('[data-target="bgremove-input"]');
  const input = document.getElementById("bgremove-input");
  const resultArea = document.getElementById("bgremove-result");
  const controls = document.getElementById("bgremove-controls");
  const autoRunBtn = document.getElementById("bgremove-auto-run");
  const manualStartBtn = document.getElementById("bgremove-manual-start");
  const manualNote = document.getElementById("bgremove-manual-note");
  const statusEl = document.getElementById("bgremove-status");
  const listEl = document.getElementById("bgremove-list");

  const traceStage = document.getElementById("bgremove-trace-stage");
  const traceCanvas = document.getElementById("bgremove-trace-canvas");
  const traceClearBtn = document.getElementById("bgremove-trace-clear");
  const traceApplyBtn = document.getElementById("bgremove-trace-apply");
  const traceCancelBtn = document.getElementById("bgremove-trace-cancel");

  let currentFiles = [];

  // @imgly/background-removalはnpm配布のESM専用パッケージだが、jsDelivrの
  // +esm変換エンドポイントを使うとビルド不要でそのままdynamic import()できる
  const BGREMOVE_MODULE_URL = "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/dist/index.mjs/+esm";
  let bgRemoveModulePromise = null;
  let bgRemoveModuleLoaded = false;
  function getBgRemoveModule() {
    if (!bgRemoveModulePromise) {
      bgRemoveModulePromise = import(BGREMOVE_MODULE_URL)
        .then((mod) => {
          bgRemoveModuleLoaded = true;
          return mod;
        })
        .catch((err) => {
          bgRemoveModulePromise = null;
          throw err;
        });
    }
    return bgRemoveModulePromise;
  }

  function updateControlsVisibility() {
    controls.hidden = currentFiles.length === 0;
    manualStartBtn.hidden = currentFiles.length !== 1;
    manualNote.hidden = currentFiles.length <= 1;
    autoRunBtn.disabled = currentFiles.length === 0;
  }

  async function loadFiles(fileList) {
    const newFiles = await loadImageFiles(fileList, { resultArea, listEl });
    currentFiles = mergeUniqueFiles(currentFiles, newFiles);
    updateControlsVisibility();
    if (currentFiles.length) {
      renderSelectedFiles(resultArea, currentFiles, (updated) => {
        currentFiles = updated;
        updateControlsVisibility();
      });
    }
  }

  setupDropzone(dropzone, input, loadFiles);

  function suggestRemovedName(originalName) {
    return originalName.replace(/\.[^/.]+$/, "") + "_背景削除.png";
  }

  async function removeOneBackground(module, file) {
    const outBlob = await module.removeBackground(file, { model: "isnet_quint8" });
    return new File([outBlob], suggestRemovedName(file.name), { type: "image/png" });
  }

  autoRunBtn.addEventListener("click", async () => {
    if (!currentFiles.length) return;

    const isFirstLoad = !bgRemoveModuleLoaded;
    if (isFirstLoad) {
      const proceed = confirm("背景削除の前に、初回のみAIモデル(数十MB)をダウンロードします。通信環境によっては少し時間がかかります。続けますか?");
      if (!proceed) return;
    }

    autoRunBtn.disabled = true;
    manualStartBtn.disabled = true;
    listEl.innerHTML = "";
    statusEl.textContent = isFirstLoad ? "AIモデルを読み込み中です…(数十MBのため少し時間がかかります)" : "";

    let module;
    try {
      module = await getBgRemoveModule();
    } catch (err) {
      statusEl.textContent = "AIモデルの読み込みに失敗しました。通信環境を確認して、もう一度お試しください。";
      autoRunBtn.disabled = false;
      manualStartBtn.disabled = false;
      return;
    }
    statusEl.textContent = "";

    const results = [];

    for (const file of currentFiles) {
      const li = document.createElement("li");
      li.innerHTML = `<span>${file.name}</span><span>処理中...</span>`;
      listEl.appendChild(li);

      const ticker = createProgressTicker(({ elapsed }) => {
        li.innerHTML = `<span>${file.name}</span><span>処理中...(経過 ${formatDuration(elapsed)})</span>`;
      });

      try {
        const outFile = await removeOneBackground(module, file);
        ticker.stop();
        results.push(outFile);
        li.innerHTML = `<span>${file.name}</span><span>${formatBytes(outFile.size)}</span>`;
      } catch (err) {
        ticker.stop();
        li.innerHTML = `<span>${file.name}</span><span style="color:red;">失敗</span>`;
      }
    }

    if (results.length) {
      const saveResult = await saveProcessedFiles(results, { category: "画像", tool: "背景削除" }, currentFiles.length > 1);
      const savedMsg = saveResult === "folder" ? "指定したフォルダに保存しました。" : "ダウンロードしました。";
      resultArea.innerHTML = `
        <div class="result-card">
          <div class="result-info">
            <p>${results.length}件の背景を削除しました。</p>
            <p>${savedMsg}</p>
          </div>
        </div>
      `;
    } else {
      statusEl.textContent = "処理できたファイルがありませんでした。";
    }

    autoRunBtn.disabled = false;
    manualStartBtn.disabled = false;
  });

  // ---------- 手動でなぞって切り抜くモード ----------

  const MAX_TRACE_DIM = 1000; // なぞる作業用キャンバスの最大辺(重い画像でも操作を軽くするため)
  const ctx = traceCanvas.getContext("2d");
  let traceImage = null;
  let traceScale = 1;
  let tracePoints = [];
  let isDrawing = false;

  function redrawTraceCanvas() {
    ctx.clearRect(0, 0, traceCanvas.width, traceCanvas.height);
    ctx.drawImage(traceImage, 0, 0, traceCanvas.width, traceCanvas.height);
    if (tracePoints.length > 1) {
      ctx.beginPath();
      ctx.moveTo(tracePoints[0].x, tracePoints[0].y);
      for (let i = 1; i < tracePoints.length; i++) ctx.lineTo(tracePoints[i].x, tracePoints[i].y);
      if (!isDrawing) ctx.closePath();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#2E8FE6";
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.stroke();
      if (!isDrawing) {
        ctx.fillStyle = "rgba(46, 143, 230, 0.25)";
        ctx.fill();
      }
    }
  }

  function getCanvasPoint(e) {
    const rect = traceCanvas.getBoundingClientRect();
    const scaleX = traceCanvas.width / rect.width;
    const scaleY = traceCanvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  traceCanvas.addEventListener("pointerdown", (e) => {
    traceCanvas.setPointerCapture(e.pointerId);
    isDrawing = true;
    tracePoints = [getCanvasPoint(e)];
    traceApplyBtn.disabled = true;
    redrawTraceCanvas();
  });

  traceCanvas.addEventListener("pointermove", (e) => {
    if (!isDrawing) return;
    tracePoints.push(getCanvasPoint(e));
    redrawTraceCanvas();
  });

  function endDrawing() {
    if (!isDrawing) return;
    isDrawing = false;
    traceApplyBtn.disabled = tracePoints.length < 3;
    redrawTraceCanvas();
  }

  traceCanvas.addEventListener("pointerup", endDrawing);
  traceCanvas.addEventListener("pointercancel", endDrawing);

  traceClearBtn.addEventListener("click", () => {
    tracePoints = [];
    isDrawing = false;
    traceApplyBtn.disabled = true;
    redrawTraceCanvas();
  });

  traceCancelBtn.addEventListener("click", () => {
    traceStage.hidden = true;
    controls.hidden = false;
    tracePoints = [];
    traceImage = null;
  });

  manualStartBtn.addEventListener("click", () => {
    if (currentFiles.length !== 1) return;
    const file = currentFiles[0];
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      traceImage = img;
      traceScale = Math.min(1, MAX_TRACE_DIM / Math.max(img.naturalWidth, img.naturalHeight));
      traceCanvas.width = Math.round(img.naturalWidth * traceScale);
      traceCanvas.height = Math.round(img.naturalHeight * traceScale);
      tracePoints = [];
      traceApplyBtn.disabled = true;
      redrawTraceCanvas();
      controls.hidden = true;
      traceStage.hidden = false;
      traceStage.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    img.src = url;
  });

  traceApplyBtn.addEventListener("click", async () => {
    if (!traceImage || tracePoints.length < 3) return;
    traceApplyBtn.disabled = true;
    traceApplyBtn.textContent = "切り抜き中...";

    try {
      const fullCanvas = document.createElement("canvas");
      fullCanvas.width = traceImage.naturalWidth;
      fullCanvas.height = traceImage.naturalHeight;
      const fullCtx = fullCanvas.getContext("2d");
      fullCtx.drawImage(traceImage, 0, 0);

      // 作業用キャンバス上の座標を、元画像の実寸解像度の座標に拡大して使う
      const inv = 1 / traceScale;
      fullCtx.beginPath();
      fullCtx.moveTo(tracePoints[0].x * inv, tracePoints[0].y * inv);
      for (let i = 1; i < tracePoints.length; i++) {
        fullCtx.lineTo(tracePoints[i].x * inv, tracePoints[i].y * inv);
      }
      fullCtx.closePath();
      fullCtx.globalCompositeOperation = "destination-in";
      fullCtx.fill();

      const file = currentFiles[0];
      const blob = await new Promise((resolve) => fullCanvas.toBlob(resolve, "image/png"));
      const outFile = new File([blob], suggestRemovedName(file.name), { type: "image/png" });

      const saveResult = await saveProcessedFiles([outFile], { category: "画像", tool: "背景削除.手動" }, false);
      const savedMsg = saveResult === "folder" ? "指定したフォルダに保存しました。" : "ダウンロードしました。";

      traceStage.hidden = true;
      controls.hidden = false;
      resultArea.innerHTML = `
        <div class="result-card">
          <div class="result-info">
            <p>手動でなぞった形で切り抜きました。</p>
            <p>${savedMsg}</p>
          </div>
        </div>
      `;
    } catch (err) {
      statusEl.textContent = "切り抜きに失敗しました。もう一度お試しください。";
    }

    traceApplyBtn.disabled = false;
    traceApplyBtn.textContent = "この形で切り抜く";
  });
})();
