(() => {
  const dropzone = document.querySelector('[data-target="videotrim-input"]');
  const input = document.getElementById("videotrim-input");
  const preview = document.getElementById("videotrim-preview");
  const controls = document.getElementById("videotrim-controls");
  const durationEl = document.getElementById("videotrim-duration");
  const startInput = document.getElementById("videotrim-start");
  const endInput = document.getElementById("videotrim-end");
  const startNowBtn = document.getElementById("videotrim-start-now");
  const endNowBtn = document.getElementById("videotrim-end-now");
  const errorEl = document.getElementById("videotrim-error");
  const runBtn = document.getElementById("videotrim-run");
  const cancelBtn = document.getElementById("videotrim-cancel");
  const statusEl = document.getElementById("videotrim-status");
  const resultArea = document.getElementById("videotrim-result");

  let currentFile = null;
  let videoDuration = 0;
  let cancelRequested = false;
  let previewUrl = null;

  function formatTimeInput(totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
    const ss = String(sec).padStart(2, "0");
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  function parseTimeInput(str) {
    const parts = String(str).trim().split(":");
    if (!parts.length || parts.some((p) => p === "" || Number.isNaN(Number(p)) || Number(p) < 0)) return null;
    let seconds = 0;
    for (const p of parts) seconds = seconds * 60 + Number(p);
    return seconds;
  }

  function getExt(name) {
    const m = /\.([^/.]+)$/.exec(name);
    return m ? m[1] : "mp4";
  }

  function suggestTrimmedName(originalName) {
    const ext = getExt(originalName);
    const base = originalName.replace(/\.[^/.]+$/, "");
    return `${base}_トリミング.${ext}`;
  }

  function loadFile(fileList) {
    const allFiles = Array.from(fileList);
    const videoFile = allFiles.find(isVideoFile);
    if (!videoFile) {
      resultArea.innerHTML = `<p style="color:red;">動画ファイルが見つかりませんでした。</p>`;
      return;
    }
    currentFile = videoFile;
    errorEl.textContent = "";
    statusEl.textContent = "";
    resultArea.innerHTML = "";
    runBtn.disabled = true;
    controls.hidden = true;

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(videoFile);
    preview.src = previewUrl;
    preview.hidden = false;

    preview.onloadedmetadata = () => {
      videoDuration = preview.duration;
      durationEl.textContent = `動画の長さ: ${formatDuration(videoDuration)}`;
      startInput.value = formatTimeInput(0);
      endInput.value = formatTimeInput(videoDuration);
      controls.hidden = false;
      runBtn.disabled = false;
    };
  }

  setupDropzone(dropzone, input, loadFile);

  startNowBtn.addEventListener("click", () => {
    startInput.value = formatTimeInput(preview.currentTime);
  });
  endNowBtn.addEventListener("click", () => {
    endInput.value = formatTimeInput(preview.currentTime);
  });

  function setProcessingUI(isProcessing) {
    runBtn.hidden = isProcessing;
    cancelBtn.hidden = !isProcessing;
  }

  runBtn.addEventListener("click", async () => {
    if (!currentFile) return;
    errorEl.textContent = "";

    const start = parseTimeInput(startInput.value);
    const end = parseTimeInput(endInput.value);
    if (start === null || end === null) {
      errorEl.textContent = "開始・終了位置は「分:秒」の形式で入力してください(例: 1:30)。";
      return;
    }
    if (start >= end) {
      errorEl.textContent = "終了位置は開始位置より後にしてください。";
      return;
    }
    if (end > videoDuration + 1) {
      errorEl.textContent = "終了位置が動画の長さを超えています。";
      return;
    }

    const isFirstLoad = !isFFmpegLoaded();
    if (isFirstLoad) {
      const proceed = confirm("初回のみ、変換エンジン(合計約30MB)をダウンロードします。通信環境によっては少し時間がかかります。続けますか?");
      if (!proceed) return;
    }

    cancelRequested = false;
    setProcessingUI(true);
    resultArea.innerHTML = "";
    statusEl.textContent = isFirstLoad ? "変換エンジンを読み込み中です…" : "処理中...";

    let ffmpeg;
    try {
      ffmpeg = await getSharedFFmpeg();
    } catch (err) {
      statusEl.textContent = "変換エンジンの読み込みに失敗しました。通信環境を確認して、もう一度お試しください。";
      setProcessingUI(false);
      return;
    }

    cancelBtn.onclick = () => {
      cancelRequested = true;
      cancelBtn.disabled = true;
      cancelBtn.textContent = "中断しています...";
      terminateSharedFFmpeg();
    };

    const ticker = createProgressTicker(({ elapsed }) => {
      statusEl.textContent = `処理中...(経過 ${formatDuration(elapsed)})`;
    });

    const ext = getExt(currentFile.name);
    const inputName = `in.${ext}`;
    const outputName = `out.${ext}`;

    try {
      const bytes = new Uint8Array(await currentFile.arrayBuffer());
      await ffmpeg.writeFile(inputName, bytes);
      await ffmpeg.exec(["-ss", String(start), "-i", inputName, "-t", String(end - start), "-c", "copy", outputName]);
      const data = await ffmpeg.readFile(outputName);
      const outFile = new File([data], suggestTrimmedName(currentFile.name), { type: currentFile.type || "video/mp4" });

      ticker.stop();
      statusEl.textContent = "";

      const saveResult = await saveProcessedFiles([outFile], { category: "動画", tool: "トリミング" }, false);
      const savedMsg = saveResult === "folder" ? "指定したフォルダに保存しました。" : "ダウンロードしました。";
      resultArea.innerHTML = `
        <div class="result-card">
          <div class="result-info">
            <p>切り出しました:${formatBytes(outFile.size)}</p>
            <p>${savedMsg}</p>
          </div>
        </div>
      `;
    } catch (err) {
      ticker.stop();
      if (cancelRequested) {
        statusEl.textContent = "中断しました。もう一度「切り出す」を押すとやり直せます。";
      } else {
        statusEl.textContent = "";
        resultArea.innerHTML = `<p style="color:red;">切り出しに失敗しました。もう一度お試しください。</p>`;
      }
    } finally {
      try { await ffmpeg.deleteFile(inputName); } catch {}
      try { await ffmpeg.deleteFile(outputName); } catch {}
      setProcessingUI(false);
      cancelBtn.disabled = false;
      cancelBtn.textContent = "中断する";
    }
  });
})();
