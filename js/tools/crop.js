(() => {
  const dropzone = document.querySelector('[data-target="crop-input"]');
  const input = document.getElementById("crop-input");
  const imageEl = document.getElementById("crop-image");
  const runBtn = document.getElementById("crop-run");
  const resultArea = document.getElementById("crop-result");
  const ratioBtns = document.querySelectorAll("#crop .ratio-btn");

  let currentFile = null;
  let cropper = null;

  async function loadFile(fileList) {
    const files = await loadImageFiles(fileList, { resultArea, listEl: null });
    if (!files.length) {
      currentFile = null;
      runBtn.disabled = true;
      return;
    }

    currentFile = files[0];
    resultArea.innerHTML = files.length > 1
      ? `<p>${currentFile.name} を読み込みました</p><p class="format-note">トリミングは1枚ずつの処理のため、最初の1枚のみ読み込みました。</p>`
      : `<p>${currentFile.name} を読み込みました</p>`;

    const url = URL.createObjectURL(currentFile);
    imageEl.src = url;
    imageEl.style.display = "block";

    if (cropper) cropper.destroy();
    cropper = new Cropper(imageEl, {
      viewMode: 1,
      autoCropArea: 0.8,
    });

    runBtn.disabled = false;
  }

  setupDropzone(dropzone, input, loadFile);

  ratioBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      ratioBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const ratio = Number(btn.dataset.ratio);
      if (cropper) cropper.setAspectRatio(ratio === 0 ? NaN : ratio);
    });
  });

  runBtn.addEventListener("click", async () => {
    if (!cropper || !currentFile) return;
    runBtn.disabled = true;
    runBtn.textContent = "処理中...";
    resultArea.innerHTML = "";

    try {
      const canvas = cropper.getCroppedCanvas();
      const mimeType = normalizeImageType(currentFile.type) || "image/jpeg";
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, mimeType, 0.92));
      const cropped = new File([blob], currentFile.name, { type: mimeType });

      const saveResult = await saveProcessedFiles([cropped], { category: "画像", tool: "トリミング" }, false);
      const savedMsg = saveResult === "folder" ? "指定したフォルダに保存しました。" : "ダウンロードしました。";
      resultArea.innerHTML = `
        <div class="result-card">
          <div class="result-info">
            <p>切り抜きサイズ: ${canvas.width} × ${canvas.height} px</p>
            <p>${savedMsg}</p>
          </div>
        </div>
      `;
    } catch (err) {
      resultArea.innerHTML = `<p style="color:red;">処理に失敗しました。</p>`;
    }

    runBtn.disabled = false;
    runBtn.textContent = "切り抜く";
  });
})();
