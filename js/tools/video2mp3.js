(() => {
  const dropzone = document.querySelector('[data-target="video2mp3-input"]');
  const input = document.getElementById("video2mp3-input");
  const runBtn = document.getElementById("video2mp3-run");
  const resultArea = document.getElementById("video2mp3-result");
  const listEl = document.getElementById("video2mp3-list");
  const statusEl = document.getElementById("video2mp3-status");

  const CORE_BASE_URL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";

  let currentFiles = [];
  let ffmpegInstance = null;
  let ffmpegLoadPromise = null;

  // @ffmpeg/utilのCDN版UMDビルドはブラウザの<script>タグ読み込みでは正しく動かない既知の不具合があるため使わず、
  // 必要な機能(URLの中身を取得してBlob URL化するだけ)をここで直接実装する
  async function toBlobURL(url, mimeType) {
    const buf = await (await fetch(url)).arrayBuffer();
    const blob = new Blob([buf], { type: mimeType });
    return URL.createObjectURL(blob);
  }

  function isVideoFile(file) {
    return file.type.startsWith("video/") || /\.(mp4|mov|avi|webm|mkv|wmv|flv|m4v|3gp|3g2|mpg|mpeg|ts|m2ts|mts|ogv|vob|asf|rm|rmvb|divx|f4v|mxf|dv)$/i.test(file.name);
  }

  // 画像プレビュー(buildSelectedFilesPreview)はサムネイル画像前提のため、動画には同じ見た目のクラスを使い独自に組み立てる
  function buildSelectedVideoPreview(files) {
    const maxShow = 10;
    const shown = files.slice(0, maxShow);
    const remaining = files.length - shown.length;
    const items = shown.map((f, i) => `
      <li data-index="${i}">
        <button type="button" class="file-remove-btn" data-index="${i}" aria-label="このファイルを削除">${TRASH_ICON}</button>
        <span class="file-thumb pdf-file-icon" aria-hidden="true">🎬</span>
        <span class="file-name">${f.name}</span>
        <span class="file-size">${formatBytes(f.size)}</span>
      </li>
    `).join("");
    const moreItem = remaining > 0 ? `<li class="file-list-more">ほか${remaining}件</li>` : "";
    return `
      <div class="selected-file-header">
        <p>${files.length}件の動画を選択中</p>
        <button type="button" class="clear-all-btn">すべて削除</button>
      </div>
      <ul class="selected-file-list">${items}${moreItem}</ul>
    `;
  }

  function renderSelectedVideoFiles(files, onChange) {
    function render(list) {
      resultArea.innerHTML = buildSelectedVideoPreview(list);
      resultArea.querySelectorAll(".file-remove-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = Number(btn.dataset.index);
          list = list.slice(0, idx).concat(list.slice(idx + 1));
          render(list);
          onChange(list);
        });
      });
      const clearBtn = resultArea.querySelector(".clear-all-btn");
      if (clearBtn) {
        clearBtn.addEventListener("click", () => {
          list = [];
          resultArea.innerHTML = "";
          onChange(list);
        });
      }
    }
    render(files);
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
      renderSelectedVideoFiles(currentFiles, (updated) => {
        currentFiles = updated;
        runBtn.disabled = currentFiles.length === 0;
      });
    }
  }

  setupDropzone(dropzone, input, loadFiles);

  // 変換エンジン(約30MB)は初回実行時に一度だけ読み込み、以後は使い回す
  function getFFmpeg() {
    if (ffmpegLoadPromise) return ffmpegLoadPromise;
    ffmpegLoadPromise = (async () => {
      const { FFmpeg } = FFmpegWASM;
      const ffmpeg = new FFmpeg();
      await ffmpeg.load({
        coreURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.wasm`, "application/wasm"),
      });
      ffmpegInstance = ffmpeg;
      return ffmpeg;
    })();
    // 読み込みに失敗した場合は次回また最初からやり直せるようにキャッシュを消す
    ffmpegLoadPromise.catch(() => {
      ffmpegLoadPromise = null;
    });
    return ffmpegLoadPromise;
  }

  function suggestMp3Name(originalName) {
    return originalName.replace(/\.[^/.]+$/, "") + ".mp3";
  }

  function getExt(name) {
    const m = /\.([^/.]+)$/.exec(name);
    return m ? m[1] : "mp4";
  }

  async function convertOneFile(ffmpeg, file, onProgress) {
    const uid = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const inputName = `in_${uid}.${getExt(file.name)}`;
    const outputName = `out_${uid}.mp3`;

    const progressHandler = ({ progress }) => {
      const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
      onProgress(pct);
    };
    ffmpeg.on("progress", progressHandler);

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await ffmpeg.writeFile(inputName, bytes);
      await ffmpeg.exec(["-i", inputName, "-vn", "-acodec", "libmp3lame", "-b:a", "192k", outputName]);
      const data = await ffmpeg.readFile(outputName);
      return new File([data], suggestMp3Name(file.name), { type: "audio/mpeg" });
    } finally {
      ffmpeg.off("progress", progressHandler);
      try { await ffmpeg.deleteFile(inputName); } catch {}
      try { await ffmpeg.deleteFile(outputName); } catch {}
    }
  }

  runBtn.addEventListener("click", async () => {
    if (!currentFiles.length) return;

    const isFirstLoad = !ffmpegInstance;
    if (isFirstLoad) {
      const proceed = confirm("初回のみ、変換エンジン(合計約30MB)をダウンロードします。通信環境によっては少し時間がかかります。続けますか?");
      if (!proceed) return;
    }

    runBtn.disabled = true;
    runBtn.textContent = "変換中...";
    listEl.innerHTML = "";
    resultArea.innerHTML = "";
    statusEl.textContent = isFirstLoad ? "変換エンジンを読み込み中です…" : "";

    let ffmpeg;
    try {
      ffmpeg = await getFFmpeg();
    } catch (err) {
      statusEl.textContent = "変換エンジンの読み込みに失敗しました。通信環境を確認して、もう一度お試しください。";
      runBtn.disabled = false;
      runBtn.textContent = "MP3に変換する";
      return;
    }
    statusEl.textContent = "";

    const results = [];
    for (const file of currentFiles) {
      const li = document.createElement("li");
      li.innerHTML = `<span>${file.name}</span><span>変換中... 0%</span>`;
      listEl.appendChild(li);

      try {
        const outFile = await convertOneFile(ffmpeg, file, (pct) => {
          li.innerHTML = `<span>${file.name}</span><span>変換中... ${pct}%</span>`;
        });
        results.push(outFile);
        li.innerHTML = `<span>${file.name}</span><span>${formatBytes(file.size)} → ${formatBytes(outFile.size)}</span>`;
      } catch (err) {
        li.innerHTML = `<span>${file.name}</span><span style="color:red;">失敗</span>`;
      }
    }

    if (results.length) {
      const saveResult = await saveProcessedFiles(results, { category: "動画", tool: "MP3変換" }, currentFiles.length > 1);
      const savedMsg = saveResult === "folder" ? "指定したフォルダに保存しました。" : "ダウンロードしました。";
      resultArea.innerHTML = `
        <div class="result-card">
          <div class="result-info">
            <p>${results.length}件をMP3に変換しました。</p>
            <p>${savedMsg}</p>
          </div>
        </div>
      `;
    } else {
      resultArea.innerHTML = `<p style="color:red;">変換できたファイルがありませんでした。</p>`;
    }

    runBtn.disabled = false;
    runBtn.textContent = "MP3に変換する";
  });
})();
