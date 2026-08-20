(() => {
  const dropzone = document.querySelector('[data-target="videocompress-input"]');
  const input = document.getElementById("videocompress-input");
  const runBtn = document.getElementById("videocompress-run");
  const cancelBtn = document.getElementById("videocompress-cancel");
  const resultArea = document.getElementById("videocompress-result");
  const listEl = document.getElementById("videocompress-list");
  const statusEl = document.getElementById("videocompress-status");

  let currentFiles = [];
  let cancelRequested = false;

  function getLevel() {
    const checked = document.querySelector('input[name="videocompress-level"]:checked');
    return checked ? checked.value : "recommended";
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

  function suggestCompressedName(originalName) {
    return originalName.replace(/\.[^/.]+$/, "") + ".mp4";
  }

  function getExt(name) {
    const m = /\.([^/.]+)$/.exec(name);
    return m ? m[1] : "mp4";
  }

  function getSettings(level) {
    // wasm(ブラウザ内)でのエンコードはパソコンの処理能力だけが頼りで、専用ソフトよりずっと遅いため、
    // 圧縮率より速度を優先したプリセット(ultrafast)にしている
    return level === "strong"
      ? { maxWidth: 854, crf: 30, audioBitrate: "96k", preset: "ultrafast" }
      : { maxWidth: 1280, crf: 26, audioBitrate: "128k", preset: "ultrafast" };
  }

  async function compressOneFile(ffmpeg, file, level, onProgress) {
    const { maxWidth, crf, audioBitrate, preset } = getSettings(level);
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
        "-vf", `scale=min(${maxWidth}\\,iw):-2`,
        "-c:v", "libx264",
        "-preset", preset,
        "-crf", String(crf),
        "-c:a", "aac",
        "-b:a", audioBitrate,
        outputName,
      ]);
      const data = await ffmpeg.readFile(outputName);
      return new File([data], suggestCompressedName(file.name), { type: "video/mp4" });
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
      const proceed = confirm("初回のみ、変換エンジン(合計約30MB)をダウンロードします。通信環境によっては少し時間がかかります。続けますか?");
      if (!proceed) return;
    }

    statusEl.textContent = "動画の長さを確認中...";
    const durations = await Promise.all(currentFiles.map(getVideoDuration));
    const totalDuration = durations.reduce((sum, d) => sum + (d || 0), 0);
    statusEl.textContent = "";
    if (totalDuration > 180) {
      const proceed = confirm(
        `選択した動画の合計の長さは約${formatDuration(totalDuration)}です。\n圧縮はこのパソコンの処理能力だけで行うため、専用ソフトより遅く、動画の長さの数倍〜十数倍の時間がかかることがあります(長い動画・高画質なほど時間がかかります)。\n途中で中断することもできます。続けますか?`
      );
      if (!proceed) return;
    }

    const level = getLevel();
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
    let totalBefore = 0;
    let totalAfter = 0;

    for (const file of currentFiles) {
      if (cancelRequested) break;

      const li = document.createElement("li");
      li.innerHTML = `<span>${file.name}</span><span>準備中...</span>`;
      listEl.appendChild(li);

      const ticker = createProgressTicker(({ progress, elapsed, eta }) => {
        const pct = Math.round(progress * 100);
        const etaText = eta !== null ? `、残り目安 約${formatDuration(eta)}` : "";
        li.innerHTML = `<span>${file.name}</span><span>圧縮中... ${pct}%(経過 ${formatDuration(elapsed)}${etaText})</span>`;
      });

      try {
        const outFile = await compressOneFile(ffmpeg, file, level, (p) => ticker.setProgress(p));
        ticker.stop();
        // 圧縮の効果がなかった(むしろ大きくなった)場合は、元のファイルのまま残す
        const finalFile = outFile.size < file.size ? outFile : file;

        results.push(finalFile);
        totalBefore += file.size;
        totalAfter += finalFile.size;

        const reduction = Math.round((1 - finalFile.size / file.size) * 100);
        const summary = reduction > 0
          ? `${formatBytes(file.size)} → ${formatBytes(finalFile.size)}(-${reduction}%)`
          : `効果なし(元のファイルのまま)`;
        li.innerHTML = `<span>${file.name}</span><span>${summary}</span>`;
      } catch (err) {
        ticker.stop();
        li.innerHTML = cancelRequested
          ? `<span>${file.name}</span><span>中断しました</span>`
          : `<span>${file.name}</span><span style="color:red;">失敗</span>`;
      }
    }

    if (cancelRequested) {
      statusEl.textContent = "中断しました。もう一度「圧縮する」を押すとやり直せます。";
    }

    if (results.length) {
      const saveResult = await saveProcessedFiles(results, { category: "動画", tool: "圧縮" }, currentFiles.length > 1);
      const savedMsg = saveResult === "folder" ? "指定したフォルダに保存しました。" : "ダウンロードしました。";
      const reduction = Math.round((1 - totalAfter / totalBefore) * 100);
      resultArea.innerHTML = `
        <div class="result-card">
          <div class="result-info">
            <p>${results.length}件を処理:${formatBytes(totalBefore)} → ${formatBytes(totalAfter)}
              <span class="reduction">(${reduction > 0 ? "-" + reduction : reduction}%)</span>
            </p>
            <p>${savedMsg}</p>
          </div>
        </div>
      `;
    } else if (!cancelRequested) {
      resultArea.innerHTML = `<p style="color:red;">圧縮できたファイルがありませんでした。</p>`;
    }

    setProcessingUI(false);
    cancelBtn.disabled = false;
    cancelBtn.textContent = "中断する";
    runBtn.disabled = false;
  });
})();
