(() => {
  const dropzone = document.querySelector('[data-target="transcribe-upload"]');
  const input = document.getElementById("transcribe-upload");
  const fileInfoEl = document.getElementById("transcribe-file-info");
  const qualitySelect = document.getElementById("transcribe-quality");
  const runBtn = document.getElementById("transcribe-run");
  const stopBtn = document.getElementById("transcribe-stop");
  const statusEl = document.getElementById("transcribe-status");
  const errorEl = document.getElementById("transcribe-error");
  const outputLabel = document.getElementById("transcribe-output-label");
  const outputEl = document.getElementById("transcribe-output");
  const copyBtn = document.getElementById("transcribe-copy");
  const downloadBtn = document.getElementById("transcribe-download");

  const WORKER_URL = "js/tools/transcribe-worker.js";
  const MODEL_INFO = {
    small: { label: "高精度", mb: 970 },
    base: { label: "バランス", mb: 290 },
    tiny: { label: "高速", mb: 150 },
  };

  let currentFile = null;
  let worker = null;
  let running = false;
  let ticker = null;
  let loadedModelKey = null; // モデルを切り替えると、次回はそのモデルの再ダウンロードが必要になる

  function isMediaFile(file) {
    return file.type.startsWith("audio/") || file.type.startsWith("video/") ||
      /\.(mp3|wav|m4a|aac|ogg|oga|flac|mp4|mov|webm|mkv|avi)$/i.test(file.name);
  }

  function renderFileInfo() {
    if (!currentFile) {
      fileInfoEl.innerHTML = "";
      runBtn.disabled = true;
      return;
    }
    fileInfoEl.innerHTML = `
      <div class="selected-file-header">
        <p>${currentFile.name}(${formatBytes(currentFile.size)})</p>
        <button type="button" class="clear-all-btn">削除</button>
      </div>
    `;
    fileInfoEl.querySelector(".clear-all-btn").addEventListener("click", () => {
      currentFile = null;
      renderFileInfo();
    });
    runBtn.disabled = false;
  }

  function loadFiles(fileList) {
    const files = Array.from(fileList).filter(isMediaFile);
    if (!files.length) {
      fileInfoEl.innerHTML = `<p style="color:red;">音声・動画ファイルが見つかりませんでした。</p>`;
      return;
    }
    currentFile = files[0];
    renderFileInfo();
  }

  setupDropzone(dropzone, input, loadFiles);

  function getExt(name) {
    const m = /\.([^/.]+)$/.exec(name);
    return m ? m[1] : "dat";
  }

  // 音声・動画どちらの入力でも、ffmpegでWhisperが求める16kHzモノラルのWAVに正規化してから
  // Web Audio APIでデコードし、モデルへ渡すFloat32Arrayのサンプル列を作る
  async function extractAudioSamples(file, onStatus) {
    if (!isFFmpegLoaded()) {
      onStatus("音声変換エンジンを読み込んでいます。完了するまで少々お待ちください。");
    }
    const ffmpeg = await getSharedFFmpeg();
    onStatus("音声を変換しています...");

    const uid = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const inputName = `in_${uid}.${getExt(file.name)}`;
    const outputName = `out_${uid}.wav`;

    const bytes = new Uint8Array(await file.arrayBuffer());
    await ffmpeg.writeFile(inputName, bytes);
    try {
      await ffmpeg.exec(["-i", inputName, "-vn", "-ar", "16000", "-ac", "1", outputName]);
      const data = await ffmpeg.readFile(outputName);
      const wavBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);

      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      let decoded;
      try {
        decoded = await audioCtx.decodeAudioData(wavBuffer);
      } finally {
        audioCtx.close();
      }
      const channelData = decoded.getChannelData(0);
      return channelData.slice(); // 独立したコピーを返す(transferで送るため)
    } finally {
      try { await ffmpeg.deleteFile(inputName); } catch {}
      try { await ffmpeg.deleteFile(outputName); } catch {}
    }
  }

  function createWorker() {
    const w = new Worker(WORKER_URL, { type: "module" });
    w.onmessage = (e) => handleWorkerMessage(e.data);
    w.onerror = (e) => {
      if (ticker) { ticker.stop(); ticker = null; }
      statusEl.textContent = "";
      showError(`文字起こし中にエラーが発生しました: ${e.message}`);
      finishRun();
    };
    return w;
  }

  function getWorker() {
    if (!worker) {
      worker = createWorker();
      loadedModelKey = null;
    }
    return worker;
  }

  function showError(msg) {
    outputLabel.hidden = true;
    outputEl.value = "";
    copyBtn.hidden = true;
    downloadBtn.hidden = true;
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  function finishRun() {
    running = false;
    runBtn.hidden = false;
    stopBtn.hidden = true;
  }

  function handleWorkerMessage(data) {
    switch (data.type) {
      case "loading":
        statusEl.textContent = "AIモデルを読み込んでいます。完了するまで少々お待ちください。";
        break;
      case "running":
        ticker = createProgressTicker(({ elapsed }) => {
          statusEl.textContent = `文字起こし中です...(経過 ${formatDuration(elapsed)})`;
        });
        break;
      case "done":
        if (ticker) { ticker.stop(); ticker = null; }
        statusEl.textContent = "";
        errorEl.hidden = true;
        outputLabel.hidden = false;
        outputEl.value = data.text.trim();
        copyBtn.hidden = false;
        downloadBtn.hidden = false;
        finishRun();
        break;
      case "error":
        if (ticker) { ticker.stop(); ticker = null; }
        statusEl.textContent = "";
        showError(`文字起こしに失敗しました: ${data.message}`);
        finishRun();
        break;
    }
  }

  runBtn.addEventListener("click", async () => {
    if (!currentFile || running) return;

    const modelKey = qualitySelect.value;
    if (loadedModelKey !== modelKey) {
      const info = MODEL_INFO[modelKey];
      const proceed = confirm(`初回のみ、文字起こし用のAIモデル(${info.label}・約${info.mb}MB)をダウンロードします。通信環境によっては時間がかかります。続けますか?`);
      if (!proceed) return;
    }

    running = true;
    runBtn.hidden = true;
    stopBtn.hidden = false;
    errorEl.hidden = true;
    outputLabel.hidden = true;
    copyBtn.hidden = true;
    downloadBtn.hidden = true;
    outputEl.value = "";

    try {
      const samples = await extractAudioSamples(currentFile, (label) => {
        statusEl.textContent = label;
      });
      const audioBuffer = samples.buffer;
      loadedModelKey = modelKey;
      getWorker().postMessage({ type: "transcribe", modelKey, audioBuffer }, [audioBuffer]);
    } catch (err) {
      statusEl.textContent = "";
      showError("音声の変換に失敗しました。ファイル形式を確認して、もう一度お試しください。");
      finishRun();
    }
  });

  stopBtn.addEventListener("click", () => {
    if (worker) {
      worker.terminate();
      worker = null;
      loadedModelKey = null;
    }
    if (ticker) { ticker.stop(); ticker = null; }
    statusEl.textContent = "";
    finishRun();
  });

  copyBtn.addEventListener("click", () => {
    if (!outputEl.value) return;
    navigator.clipboard.writeText(outputEl.value).then(() => {
      const original = copyBtn.textContent;
      copyBtn.textContent = "コピーしました!";
      setTimeout(() => { copyBtn.textContent = original; }, 1200);
    });
  });

  downloadBtn.addEventListener("click", () => {
    if (!outputEl.value) return;
    const name = (currentFile ? currentFile.name.replace(/\.[^/.]+$/, "") : "文字起こし") + ".txt";
    downloadFile(new File([outputEl.value], name, { type: "text/plain" }));
  });
})();
