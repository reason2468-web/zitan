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
  const traceStatus = document.getElementById("bgremove-trace-status");
  const traceLoading = document.getElementById("bgremove-trace-loading");
  const traceLoadingText = document.getElementById("bgremove-trace-loading-text");
  const traceLoadingBar = document.getElementById("bgremove-trace-loading-bar");
  const traceLoadingFill = document.getElementById("bgremove-trace-loading-fill");
  const traceLoadingDetail = document.getElementById("bgremove-trace-loading-detail");
  const traceLoadingSub = document.getElementById("bgremove-trace-loading-sub");
  const traceLoadingElapsed = document.getElementById("bgremove-trace-loading-elapsed");

  let traceLoadingStallTimer = null;
  let traceElapsedTimer = null;
  let traceElapsedStart = 0;

  // 経過秒数を1秒ごとに表示し続けることで、「本当に動いているのか」を可視化する
  function startTraceElapsed() {
    traceElapsedStart = Date.now();
    clearInterval(traceElapsedTimer);
    traceLoadingElapsed.textContent = "経過時間: 0秒";
    traceElapsedTimer = setInterval(() => {
      const sec = Math.floor((Date.now() - traceElapsedStart) / 1000);
      traceLoadingElapsed.textContent = `経過時間: ${sec}秒`;
    }, 1000);
  }

  function stopTraceElapsed() {
    clearInterval(traceElapsedTimer);
    traceElapsedTimer = null;
    traceLoadingElapsed.textContent = "";
  }

  function showTraceLoading(text, sub) {
    traceLoadingText.textContent = text;
    traceLoadingSub.textContent = sub || "";
    traceLoadingDetail.textContent = "";
    traceLoadingBar.hidden = true;
    traceLoadingFill.style.width = "0%";
    traceLoading.hidden = false;
    traceCanvas.style.pointerEvents = "none";

    clearTimeout(traceLoadingStallTimer);
    traceLoadingStallTimer = setTimeout(() => {
      traceLoadingSub.textContent = "処理には端末の性能によって数十秒〜数分かかる場合があります。ブラウザを閉じずにそのままお待ちください。";
    }, 20000);
  }

  function hideTraceLoading() {
    clearTimeout(traceLoadingStallTimer);
    stopTraceElapsed();
    traceLoading.hidden = true;
    traceCanvas.style.pointerEvents = "";
  }

  // モデルのダウンロード進捗(バイト数)をファイル単位で受け取り、合算して表示する
  const modelDownloadProgress = new Map();
  function onModelDownloadProgress(e) {
    if (e.status !== "progress" || !(e.total > 0)) return;
    modelDownloadProgress.set(e.file, { loaded: e.loaded, total: e.total });
    let loaded = 0;
    let total = 0;
    for (const p of modelDownloadProgress.values()) {
      loaded += p.loaded;
      total += p.total;
    }
    const pct = Math.min(100, Math.round((loaded / total) * 100));
    traceLoadingBar.hidden = false;
    traceLoadingFill.style.width = `${pct}%`;
    traceLoadingDetail.textContent = `${pct}%(${formatBytes(loaded)} / ${formatBytes(total)})`;
    if (pct >= 100) {
      traceLoadingText.textContent = "AIモデルを初期化しています";
      traceLoadingSub.textContent = "ダウンロードは完了しました。もうしばらくお待ちください。";
    }
  }

  // 通信状況や端末の性能などで極端に時間がかかった場合に、無限に待たせず失敗として扱うまでの上限
  const TRACE_LOAD_TIMEOUT_MS = 150000;
  function withTraceLoadTimeout(promise) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("trace-load-timeout")), TRACE_LOAD_TIMEOUT_MS)
      ),
    ]);
  }

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
    // 実機比較の結果、軽量版(isnet_quint8)は輪郭が欠けることが多かったため、
    // 精度を優先してisnet_fp16(標準品質・約90MB)を使う
    const outBlob = await module.removeBackground(file, { model: "isnet_fp16" });
    return new File([outBlob], suggestRemovedName(file.name), { type: "image/png" });
  }

  autoRunBtn.addEventListener("click", async () => {
    if (!currentFiles.length) return;

    const isFirstLoad = !bgRemoveModuleLoaded;
    if (isFirstLoad) {
      const proceed = confirm("背景削除の前に、初回のみAIモデル(約90MB)をダウンロードします。通信環境によっては少し時間がかかります。続けますか?");
      if (!proceed) return;
    }

    autoRunBtn.disabled = true;
    manualStartBtn.disabled = true;
    listEl.innerHTML = "";
    statusEl.textContent = isFirstLoad ? "AIモデルを読み込み中です…(約90MBのため少し時間がかかります)" : "";

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

  // ---------- クリックで正確に切り抜くモード(SAM: Segment Anything Model) ----------
  //
  // 対象物の輪郭を手でなぞらせるのではなく、クリックした位置から「このあたりの
  // 対象物」をAIに認識させ、正確な輪郭を自動計算させる方式。SlimSAM(SAMの軽量版、
  // 実機検証済み)を使い、画像1枚につき1回だけ重い解析(埋め込み計算)を行い、
  // その後のクリックはその結果を使い回すため一瞬で反映される。

  const MAX_TRACE_DIM = 1000; // 表示用キャンバスの最大辺(実際の解析は元画像の解像度で行われる)
  const SAM_MODULE_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.0";
  const SAM_MODEL_ID = "Xenova/slimsam-77-uniform";
  let samModulePromise = null;
  let samModelPromise = null;
  let samModuleLoaded = false;

  function getSamModule() {
    if (!samModulePromise) {
      samModulePromise = import(SAM_MODULE_URL).catch((err) => {
        samModulePromise = null;
        throw err;
      });
    }
    return samModulePromise;
  }

  async function getSamModel(onProgress) {
    if (!samModelPromise) {
      samModelPromise = (async () => {
        const { SamModel, AutoProcessor } = await getSamModule();
        const [model, processor] = await Promise.all([
          SamModel.from_pretrained(SAM_MODEL_ID, {
            dtype: "fp16",
            device: "wasm",
            progress_callback: onProgress,
          }),
          AutoProcessor.from_pretrained(SAM_MODEL_ID),
        ]);
        samModuleLoaded = true;
        return { model, processor };
      })().catch((err) => {
        samModelPromise = null;
        throw err;
      });
    }
    return samModelPromise;
  }

  const ctx = traceCanvas.getContext("2d");
  let traceImage = null;
  let traceScale = 1;
  let samImageProcessed = null;
  let samImageEmbeddings = null;
  let tracePoints = []; // { x, y: 0〜1の正規化座標, label: 1(含める)/0(除く) }
  let currentMask = null; // { data: Uint8Array(0/255), width, height }(元画像の実寸解像度)
  let isDecoding = false;
  let decodePending = false;

  function drawBaseImage() {
    ctx.clearRect(0, 0, traceCanvas.width, traceCanvas.height);
    ctx.drawImage(traceImage, 0, 0, traceCanvas.width, traceCanvas.height);
  }

  function redrawTraceCanvas() {
    drawBaseImage();

    if (currentMask) {
      const overlay = document.createElement("canvas");
      overlay.width = currentMask.width;
      overlay.height = currentMask.height;
      const octx = overlay.getContext("2d");
      const imgData = octx.createImageData(currentMask.width, currentMask.height);
      for (let i = 0; i < currentMask.data.length; i++) {
        if (currentMask.data[i]) {
          imgData.data[4 * i] = 46;
          imgData.data[4 * i + 1] = 143;
          imgData.data[4 * i + 2] = 230;
          imgData.data[4 * i + 3] = 130;
        }
      }
      octx.putImageData(imgData, 0, 0);
      ctx.drawImage(overlay, 0, 0, traceCanvas.width, traceCanvas.height);
    }

    for (const p of tracePoints) {
      ctx.beginPath();
      ctx.arc(p.x * traceCanvas.width, p.y * traceCanvas.height, 6, 0, Math.PI * 2);
      ctx.fillStyle = p.label === 1 ? "#2F9E6E" : "#D24B72";
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
    }
  }

  function getNormalizedPoint(e) {
    const rect = traceCanvas.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    return { x, y };
  }

  async function decodeMask() {
    if (isDecoding) {
      decodePending = true;
      return;
    }
    if (!tracePoints.length) {
      currentMask = null;
      redrawTraceCanvas();
      traceApplyBtn.disabled = true;
      return;
    }
    isDecoding = true;

    try {
      const { model, processor } = await getSamModel();
      const { Tensor } = await getSamModule();

      const reshaped = samImageProcessed.reshaped_input_sizes[0];
      const coords = tracePoints.map((p) => [p.x * reshaped[1], p.y * reshaped[0]]).flat();
      const labels = tracePoints.map((p) => BigInt(p.label));

      const input_points = new Tensor("float32", coords, [1, 1, tracePoints.length, 2]);
      const input_labels = new Tensor("int64", labels, [1, 1, tracePoints.length]);

      const { pred_masks, iou_scores } = await model({
        ...samImageEmbeddings,
        input_points,
        input_labels,
      });
      const masks = await processor.post_process_masks(
        pred_masks,
        samImageProcessed.original_sizes,
        samImageProcessed.reshaped_input_sizes
      );

      const maskTensor = masks[0][0];
      const scores = iou_scores.data;
      let bestIndex = 0;
      for (let i = 1; i < scores.length; i++) {
        if (scores[i] > scores[bestIndex]) bestIndex = i;
      }
      const [, mh, mw] = maskTensor.dims;
      const data = new Uint8Array(mh * mw);
      for (let i = 0; i < mh * mw; i++) {
        data[i] = maskTensor.data[bestIndex * mh * mw + i] === 1 ? 255 : 0;
      }
      currentMask = { data, width: mw, height: mh };
      traceApplyBtn.disabled = false;
      traceStatus.textContent = "";
      redrawTraceCanvas();
    } catch (err) {
      traceStatus.textContent = "認識に失敗しました。もう一度クリックしてお試しください。";
    } finally {
      isDecoding = false;
      if (decodePending) {
        decodePending = false;
        decodeMask();
      }
    }
  }

  traceCanvas.addEventListener("pointerdown", (e) => {
    if (!samImageEmbeddings) return;
    const label = e.button === 2 ? 0 : 1; // 右クリック=除外、左クリック=含める
    tracePoints.push({ ...getNormalizedPoint(e), label });
    redrawTraceCanvas();
    decodeMask();
  });

  traceCanvas.addEventListener("contextmenu", (e) => e.preventDefault());

  traceClearBtn.addEventListener("click", () => {
    tracePoints = [];
    currentMask = null;
    traceApplyBtn.disabled = true;
    redrawTraceCanvas();
  });

  traceCancelBtn.addEventListener("click", () => {
    hideTraceLoading();
    traceStage.hidden = true;
    controls.hidden = false;
    tracePoints = [];
    currentMask = null;
    traceImage = null;
    samImageProcessed = null;
    samImageEmbeddings = null;
  });

  manualStartBtn.addEventListener("click", async () => {
    if (currentFiles.length !== 1) return;

    const isFirstLoad = !samModuleLoaded;
    if (isFirstLoad) {
      const proceed = confirm("クリックモードの前に、初回のみAIモデル(約20MB)をダウンロードします。通信環境によっては少し時間がかかります。続けますか?");
      if (!proceed) return;
    }

    const file = currentFiles[0];
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      traceImage = img;
      traceScale = Math.min(1, MAX_TRACE_DIM / Math.max(img.naturalWidth, img.naturalHeight));
      traceCanvas.width = Math.round(img.naturalWidth * traceScale);
      traceCanvas.height = Math.round(img.naturalHeight * traceScale);
      tracePoints = [];
      currentMask = null;
      samImageProcessed = null;
      samImageEmbeddings = null;
      traceApplyBtn.disabled = true;
      drawBaseImage();
      controls.hidden = true;
      traceStatus.textContent = "";
      traceStage.hidden = false;
      traceStage.scrollIntoView({ behavior: "smooth", block: "start" });

      if (isFirstLoad) {
        modelDownloadProgress.clear();
        showTraceLoading("AIモデルを準備しています", "初回のみ、セグメンテーションモデル(約20MB)をダウンロードします。");
      } else {
        showTraceLoading("画像を解析しています…");
      }
      startTraceElapsed();
      try {
        await withTraceLoadTimeout(
          (async () => {
            const { model, processor } = await getSamModel(isFirstLoad ? onModelDownloadProgress : undefined);
            const { RawImage } = await getSamModule();
            if (isFirstLoad) showTraceLoading("画像を解析しています…");
            const rawImage = await RawImage.fromURL(url);
            samImageProcessed = await processor(rawImage);
            samImageEmbeddings = await model.get_image_embeddings(samImageProcessed);
          })()
        );
        hideTraceLoading();
      } catch (err) {
        hideTraceLoading();
        traceStatus.textContent =
          err && err.message === "trace-load-timeout"
            ? "処理に時間がかかりすぎているため中断しました。端末の性能によっては、このクリックモードが動作しないことがあります。お手数ですが、AIによる自動削除モードもお試しください。"
            : "AIモデルの読み込みに失敗しました。通信環境を確認して、もう一度お試しください。";
        traceStage.hidden = true;
        controls.hidden = false;
      }
    };
    img.src = url;
  });

  traceApplyBtn.addEventListener("click", async () => {
    if (!traceImage || !currentMask) return;
    traceApplyBtn.disabled = true;
    traceApplyBtn.textContent = "切り抜き中...";

    try {
      const fullCanvas = document.createElement("canvas");
      fullCanvas.width = traceImage.naturalWidth;
      fullCanvas.height = traceImage.naturalHeight;
      const fullCtx = fullCanvas.getContext("2d");
      fullCtx.drawImage(traceImage, 0, 0);

      // マスクは元画像と同じ実寸解像度で計算済みのため、そのまま重ねられる
      const maskCanvas = document.createElement("canvas");
      maskCanvas.width = currentMask.width;
      maskCanvas.height = currentMask.height;
      const maskCtx = maskCanvas.getContext("2d");
      const maskImgData = maskCtx.createImageData(currentMask.width, currentMask.height);
      for (let i = 0; i < currentMask.data.length; i++) {
        const v = currentMask.data[i];
        maskImgData.data[4 * i] = v;
        maskImgData.data[4 * i + 1] = v;
        maskImgData.data[4 * i + 2] = v;
        maskImgData.data[4 * i + 3] = v;
      }
      maskCtx.putImageData(maskImgData, 0, 0);

      fullCtx.globalCompositeOperation = "destination-in";
      fullCtx.drawImage(maskCanvas, 0, 0, fullCanvas.width, fullCanvas.height);

      const file = currentFiles[0];
      const blob = await new Promise((resolve) => fullCanvas.toBlob(resolve, "image/png"));
      const outFile = new File([blob], suggestRemovedName(file.name), { type: "image/png" });

      const saveResult = await saveProcessedFiles([outFile], { category: "画像", tool: "背景削除.クリック" }, false);
      const savedMsg = saveResult === "folder" ? "指定したフォルダに保存しました。" : "ダウンロードしました。";

      traceStage.hidden = true;
      controls.hidden = false;
      resultArea.innerHTML = `
        <div class="result-card">
          <div class="result-info">
            <p>クリックで認識した形で切り抜きました。</p>
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
