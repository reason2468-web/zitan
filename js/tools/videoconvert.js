(() => {
  const dropzone = document.querySelector('[data-target="videoconvert-input"]');
  const input = document.getElementById("videoconvert-input");
  const runBtn = document.getElementById("videoconvert-run");
  const cancelBtn = document.getElementById("videoconvert-cancel");
  const resultArea = document.getElementById("videoconvert-result");
  const listEl = document.getElementById("videoconvert-list");
  const statusEl = document.getElementById("videoconvert-status");

  let currentFiles = [];
  let cancelRequested = false;

  function getFormat() {
    const checked = document.querySelector('input[name="videoconvert-format"]:checked');
    return checked ? checked.value : "mp4";
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

  function suggestConvertedName(originalName, targetExt) {
    return originalName.replace(/\.[^/.]+$/, "") + "." + targetExt;
  }

  function getSettings(format) {
    // wasm(ブラウザ内)でのエンコードは速度を優先しつつ、画質はできるだけ保つ設定にしている。
    // WebMはVP9(libvpx-vp9)がこのビルドではクラッシュする既知の不具合があるため、
    // 安定して動くVP8(libvpx)を使っている
    return format === "webm"
      ? { ext: "webm", mime: "video/webm", args: ["-c:v", "libvpx", "-crf", "10", "-b:v", "2M", "-c:a", "libvorbis"] }
      : { ext: "mp4", mime: "video/mp4", args: ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-c:a", "aac", "-b:a", "192k"] };
  }

  async function convertOneFile(ffmpeg, file, format, onProgress) {
    const { ext, mime, args } = getSettings(format);
    const uid = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const inputName = `in_${uid}.${getExt(file.name)}`;
    const outputName = `out_${uid}.${ext}`;

    const progressHandler = ({ progress }) => {
      onProgress(Math.max(0, Math.min(1, progress)));
    };
    ffmpeg.on("progress", progressHandler);

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await ffmpeg.writeFile(inputName, bytes);
      await ffmpeg.exec(["-i", inputName, ...args, outputName]);
      const data = await ffmpeg.readFile(outputName);
      return new File([data], suggestConvertedName(file.name, ext), { type: mime });
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
      const proceed = confirm("変換の前に、初回のみ変換エンジン(合計約30MB)をダウンロードします。通信環境によっては少し時間がかかります。続けますか?");
      if (!proceed) return;
    }

    statusEl.textContent = "動画の長さを確認中...";
    const durations = await Promise.all(currentFiles.map(getVideoDuration));
    const totalDuration = durations.reduce((sum, d) => sum + (d || 0), 0);
    statusEl.textContent = "";
    if (totalDuration > 180) {
      const proceed = confirm(
        `選択した動画の合計の長さは約${formatDuration(totalDuration)}です。\n変換はこのパソコンの処理能力だけで行うため、専用ソフトよりかなり遅く、動画の長さの数十倍の時間がかかることがあります(長い動画・高画質なほど、さらに時間がかかります)。\n途中で中断することもできます。続けますか?`
      );
      if (!proceed) return;
    }

    const format = getFormat();
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
    let skippedCount = 0;

    for (const file of currentFiles) {
      if (cancelRequested) break;

      const li = document.createElement("li");
      listEl.appendChild(li);

      // すでに変換先と同じ形式の場合は、再エンコードすると画質が落ちたりファイルが
      // 大きくなったりするだけで意味がないため、変換せず元のファイルのまま扱う
      if (getExt(file.name).toLowerCase() === format) {
        results.push(file);
        skippedCount++;
        li.innerHTML = `<span>${file.name}</span><span>変換不要(すでに${format.toUpperCase()}形式です)</span>`;
        continue;
      }

      li.innerHTML = `<span>${file.name}</span><span>準備中...</span>`;

      const ticker = createProgressTicker(({ progress, elapsed, eta }) => {
        const pct = Math.round(progress * 100);
        const etaText = eta !== null ? `、残り目安 約${formatDuration(eta)}` : "";
        li.innerHTML = `<span>${file.name}</span><span>変換中... ${pct}%(経過 ${formatDuration(elapsed)}${etaText})</span>`;
      });

      try {
        const outFile = await convertOneFile(ffmpeg, file, format, (p) => ticker.setProgress(p));
        ticker.stop();
        results.push(outFile);
        li.innerHTML = `<span>${file.name}</span><span>${formatBytes(file.size)} → ${formatBytes(outFile.size)}(${outFile.name.split(".").pop()})</span>`;
      } catch (err) {
        ticker.stop();
        li.innerHTML = cancelRequested
          ? `<span>${file.name}</span><span>中断しました</span>`
          : `<span>${file.name}</span><span style="color:red;">失敗</span>`;
      }
    }

    if (cancelRequested) {
      statusEl.textContent = "中断しました。もう一度「変換する」を押すとやり直せます。";
    }

    if (results.length) {
      const saveResult = await saveProcessedFiles(results, { category: "動画", tool: "形式変換" }, currentFiles.length > 1);
      const savedMsg = saveResult === "folder" ? "指定したフォルダに保存しました。" : "ダウンロードしました。";
      const convertedCount = results.length - skippedCount;
      const summaryText = skippedCount > 0
        ? `${convertedCount}件を変換しました(${skippedCount}件はすでに同じ形式のため変換不要でした)。`
        : `${convertedCount}件を変換しました。`;
      resultArea.innerHTML = `
        <div class="result-card">
          <div class="result-info">
            <p>${summaryText}</p>
            <p>${savedMsg}</p>
          </div>
        </div>
      `;
    } else if (!cancelRequested) {
      resultArea.innerHTML = `<p style="color:red;">変換できたファイルがありませんでした。</p>`;
    }

    setProcessingUI(false);
    cancelBtn.disabled = false;
    cancelBtn.textContent = "中断する";
    runBtn.disabled = false;
  });
})();
