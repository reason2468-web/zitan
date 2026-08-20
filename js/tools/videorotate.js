(() => {
  const dropzone = document.querySelector('[data-target="videorotate-input"]');
  const input = document.getElementById("videorotate-input");
  const runBtn = document.getElementById("videorotate-run");
  const cancelBtn = document.getElementById("videorotate-cancel");
  const resultArea = document.getElementById("videorotate-result");
  const listEl = document.getElementById("videorotate-list");
  const statusEl = document.getElementById("videorotate-status");

  let currentFiles = [];
  let cancelRequested = false;

  function getDirection() {
    const checked = document.querySelector('input[name="videorotate-direction"]:checked');
    return checked ? checked.value : "cw";
  }

  function loadFiles(fileList) {
    const allFiles = Array.from(fileList);
    const videoFiles = allFiles.filter(isVideoFile);
    if (!videoFiles.length) {
      resultArea.innerHTML = `<p style="color:red;">動画ファイルが見つかりませんでした。</p>`;
      return;
    }
    currentFiles = mergeUniqueFiles(currentFiles, videoFiles);
    runBtn.disabled = currentFiles.length === 0;
    if (currentFiles.length) {
      renderSelectedVideoFiles(resultArea, currentFiles, (updated) => {
        currentFiles = updated;
        runBtn.disabled = currentFiles.length === 0;
      });
    }
  }

  setupDropzone(dropzone, input, loadFiles);

  function getExt(name) {
    const m = /\.([^/.]+)$/.exec(name);
    return m ? m[1] : "mp4";
  }

  function suggestRotatedName(originalName) {
    return originalName.replace(/\.[^/.]+$/, "") + "_回転.mp4";
  }

  function getRotationFilter(direction) {
    if (direction === "ccw") return "transpose=2";
    if (direction === "180") return "hflip,vflip";
    return "transpose=1";
  }

  async function rotateOneFile(ffmpeg, file, direction, onProgress) {
    const uid = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const inputName = `in_${uid}.${getExt(file.name)}`;
    const outputName = `out_${uid}.mp4`;

    const progressHandler = ({ progress }) => {
      onProgress(Math.max(0, Math.min(1, progress)));
    };
    ffmpeg.on("progress", progressHandler);

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await ffmpeg.writeFile(inputName, bytes);
      await ffmpeg.exec([
        "-i", inputName,
        "-vf", getRotationFilter(direction),
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", "20",
        "-c:a", "aac",
        "-b:a", "192k",
        outputName,
      ]);
      const data = await ffmpeg.readFile(outputName);
      return new File([data], suggestRotatedName(file.name), { type: "video/mp4" });
    } finally {
      ffmpeg.off("progress", progressHandler);
      try { await ffmpeg.deleteFile(inputName); } catch {}
      try { await ffmpeg.deleteFile(outputName); } catch {}
    }
  }

  function setProcessingUI(isProcessing) {
    runBtn.hidden = isProcessing;
    cancelBtn.hidden = !isProcessing;
  }

  runBtn.addEventListener("click", async () => {
    if (!currentFiles.length) return;

    const isFirstLoad = !isFFmpegLoaded();
    if (isFirstLoad) {
      const proceed = confirm("回転の前に、初回のみ変換エンジン(合計約30MB)をダウンロードします。通信環境によっては少し時間がかかります。続けますか?");
      if (!proceed) return;
    }

    statusEl.textContent = "動画の長さを確認中...";
    const durations = await Promise.all(currentFiles.map(getVideoDuration));
    const totalDuration = durations.reduce((sum, d) => sum + (d || 0), 0);
    statusEl.textContent = "";
    if (totalDuration > 180) {
      const proceed = confirm(
        `選択した動画の合計の長さは約${formatDuration(totalDuration)}です。\n回転もこのパソコンの処理能力だけで行うため、専用ソフトより遅く、動画の長さの数倍〜十数倍の時間がかかることがあります。\n途中で中断することもできます。続けますか?`
      );
      if (!proceed) return;
    }

    const direction = getDirection();
    cancelRequested = false;

    setProcessingUI(true);
    runBtn.disabled = true;
    listEl.innerHTML = "";
    resultArea.innerHTML = "";
    statusEl.textContent = isFirstLoad ? "変換エンジンを読み込み中です…" : "";

    let ffmpeg;
    try {
      ffmpeg = await getSharedFFmpeg();
    } catch (err) {
      statusEl.textContent = "変換エンジンの読み込みに失敗しました。通信環境を確認して、もう一度お試しください。";
      setProcessingUI(false);
      runBtn.disabled = false;
      return;
    }
    statusEl.textContent = "";

    cancelBtn.onclick = () => {
      cancelRequested = true;
      cancelBtn.disabled = true;
      cancelBtn.textContent = "中断しています...";
      terminateSharedFFmpeg();
    };

    const results = [];

    for (const file of currentFiles) {
      if (cancelRequested) break;

      const li = document.createElement("li");
      li.innerHTML = `<span>${file.name}</span><span>準備中...</span>`;
      listEl.appendChild(li);

      const ticker = createProgressTicker(({ progress, elapsed, eta }) => {
        const pct = Math.round(progress * 100);
        const etaText = eta !== null ? `、残り目安 約${formatDuration(eta)}` : "";
        li.innerHTML = `<span>${file.name}</span><span>回転中... ${pct}%(経過 ${formatDuration(elapsed)}${etaText})</span>`;
      });

      try {
        const outFile = await rotateOneFile(ffmpeg, file, direction, (p) => ticker.setProgress(p));
        ticker.stop();
        results.push(outFile);
        li.innerHTML = `<span>${file.name}</span><span>${formatBytes(outFile.size)}</span>`;
      } catch (err) {
        ticker.stop();
        li.innerHTML = cancelRequested
          ? `<span>${file.name}</span><span>中断しました</span>`
          : `<span>${file.name}</span><span style="color:red;">失敗</span>`;
      }
    }

    if (cancelRequested) {
      statusEl.textContent = "中断しました。もう一度「回転する」を押すとやり直せます。";
    }

    if (results.length) {
      const saveResult = await saveProcessedFiles(results, { category: "動画", tool: "回転" }, currentFiles.length > 1);
      const savedMsg = saveResult === "folder" ? "指定したフォルダに保存しました。" : "ダウンロードしました。";
      resultArea.innerHTML = `
        <div class="result-card">
          <div class="result-info">
            <p>${results.length}件を回転しました。</p>
            <p>${savedMsg}</p>
          </div>
        </div>
      `;
    } else if (!cancelRequested) {
      resultArea.innerHTML = `<p style="color:red;">回転できたファイルがありませんでした。</p>`;
    }

    setProcessingUI(false);
    cancelBtn.disabled = false;
    cancelBtn.textContent = "中断する";
    runBtn.disabled = false;
  });
})();
