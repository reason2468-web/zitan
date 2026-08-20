(() => {
  const dropzone = document.querySelector('[data-target="videocompress-input"]');
  const input = document.getElementById("videocompress-input");
  const runBtn = document.getElementById("videocompress-run");
  const resultArea = document.getElementById("videocompress-result");
  const listEl = document.getElementById("videocompress-list");
  const statusEl = document.getElementById("videocompress-status");

  let currentFiles = [];

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
    return level === "strong"
      ? { maxWidth: 854, crf: 30, audioBitrate: "96k", preset: "veryfast" }
      : { maxWidth: 1280, crf: 26, audioBitrate: "128k", preset: "veryfast" };
  }

  async function compressOneFile(ffmpeg, file, level, onProgress) {
    const { maxWidth, crf, audioBitrate, preset } = getSettings(level);
    const uid = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const inputName = `in_${uid}.${getExt(file.name)}`;
    const outputName = `out_${uid}.mp4`;

    const progressHandler = ({ progress }) => {
      const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
      onProgress(pct);
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

  runBtn.addEventListener("click", async () => {
    if (!currentFiles.length) return;

    const isFirstLoad = !isFFmpegLoaded();
    if (isFirstLoad) {
      const proceed = confirm("初回のみ、変換エンジン(合計約30MB)をダウンロードします。通信環境によっては少し時間がかかります。続けますか?");
      if (!proceed) return;
    }

    const level = getLevel();

    runBtn.disabled = true;
    runBtn.textContent = "圧縮中...";
    listEl.innerHTML = "";
    resultArea.innerHTML = "";
    statusEl.textContent = isFirstLoad ? "変換エンジンを読み込み中です…" : "";

    let ffmpeg;
    try {
      ffmpeg = await getSharedFFmpeg();
    } catch (err) {
      statusEl.textContent = "変換エンジンの読み込みに失敗しました。通信環境を確認して、もう一度お試しください。";
      runBtn.disabled = false;
      runBtn.textContent = "圧縮する";
      return;
    }
    statusEl.textContent = "";

    const results = [];
    let totalBefore = 0;
    let totalAfter = 0;

    for (const file of currentFiles) {
      const li = document.createElement("li");
      li.innerHTML = `<span>${file.name}</span><span>圧縮中... 0%</span>`;
      listEl.appendChild(li);

      try {
        const outFile = await compressOneFile(ffmpeg, file, level, (pct) => {
          li.innerHTML = `<span>${file.name}</span><span>圧縮中... ${pct}%</span>`;
        });
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
        li.innerHTML = `<span>${file.name}</span><span style="color:red;">失敗</span>`;
      }
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
    } else {
      resultArea.innerHTML = `<p style="color:red;">圧縮できたファイルがありませんでした。</p>`;
    }

    runBtn.disabled = false;
    runBtn.textContent = "圧縮する";
  });
})();
