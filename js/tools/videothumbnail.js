(() => {
  const dropzone = document.querySelector('[data-target="videothumbnail-input"]');
  const input = document.getElementById("videothumbnail-input");
  const preview = document.getElementById("videothumbnail-preview");
  const controls = document.getElementById("videothumbnail-controls");
  const captureBtn = document.getElementById("videothumbnail-capture");
  const statusEl = document.getElementById("videothumbnail-status");
  const resultArea = document.getElementById("videothumbnail-result");
  const listEl = document.getElementById("videothumbnail-list");

  let currentFile = null;
  let previewUrl = null;
  let captureCount = 0;

  function loadFile(fileList) {
    const allFiles = Array.from(fileList);
    const videoFile = allFiles.find(isVideoFile);
    if (!videoFile) {
      resultArea.innerHTML = `<p style="color:red;">動画ファイルが見つかりませんでした。</p>`;
      return;
    }
    currentFile = videoFile;
    statusEl.textContent = "";
    resultArea.innerHTML = "";
    listEl.innerHTML = "";
    captureCount = 0;
    captureBtn.disabled = true;

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(videoFile);
    preview.src = previewUrl;
    preview.hidden = false;
    controls.hidden = false;

    preview.onloadeddata = () => {
      captureBtn.disabled = false;
    };
  }

  setupDropzone(dropzone, input, loadFile);

  function formatTimeForFilename(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}m${String(sec).padStart(2, "0")}s`;
  }

  function captureFrame() {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement("canvas");
      canvas.width = preview.videoWidth;
      canvas.height = preview.videoHeight;
      if (!canvas.width || !canvas.height) {
        reject(new Error("動画の準備ができていません"));
        return;
      }
      const ctx = canvas.getContext("2d");
      ctx.drawImage(preview, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob); else reject(new Error("画像の作成に失敗しました"));
      }, "image/jpeg", 0.92);
    });
  }

  captureBtn.addEventListener("click", async () => {
    if (!currentFile) return;
    statusEl.textContent = "";

    try {
      const blob = await captureFrame();
      const base = currentFile.name.replace(/\.[^/.]+$/, "");
      const filename = `${base}_${formatTimeForFilename(preview.currentTime)}.jpg`;
      const file = new File([blob], filename, { type: "image/jpeg" });

      const saveResult = await saveProcessedFiles([file], { category: "動画", tool: "サムネイル抽出" }, false);
      const savedMsg = saveResult === "folder" ? "指定したフォルダに保存しました。" : "ダウンロードしました。";

      captureCount++;
      const thumbUrl = URL.createObjectURL(blob);
      const li = document.createElement("li");
      li.innerHTML = `
        <span style="display:flex;align-items:center;gap:8px;">
          <img src="${thumbUrl}" alt="" style="width:48px;height:27px;object-fit:cover;border-radius:6px;border:1px solid var(--line);">
          <span class="file-name">${filename}</span>
        </span>
        <span>${savedMsg}</span>
      `;
      listEl.prepend(li);
      statusEl.textContent = `${captureCount}枚保存しました。動画の別の場面に移動して、続けて保存することもできます。`;
    } catch (err) {
      statusEl.textContent = "画像の保存に失敗しました。もう一度お試しください。";
    }
  });
})();
