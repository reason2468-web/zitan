(() => {
  const textInput = document.getElementById("qrcode-text");
  const sizeInput = document.getElementById("qrcode-size");
  const colorDarkInput = document.getElementById("qrcode-color-dark");
  const colorLightInput = document.getElementById("qrcode-color-light");
  const logoInput = document.getElementById("qrcode-logo-input");
  const logoClearBtn = document.getElementById("qrcode-logo-clear");
  const logoNote = document.getElementById("qrcode-logo-note");
  const runBtn = document.getElementById("qrcode-run");
  const resultArea = document.getElementById("qrcode-result");
  const container = document.getElementById("qrcode-canvas");

  let logoImage = null;

  function loadImageElement(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  // QRコードの中央にロゴを重ねる(背景色に合わせた角丸の台座を敷いてから描画する)
  function drawLogoOnCanvas(canvas) {
    const ctx = canvas.getContext("2d");
    const logoSize = Math.round(canvas.width * 0.2);
    const pad = Math.round(logoSize * 0.12);
    const bgSize = logoSize + pad * 2;
    const bgX = (canvas.width - bgSize) / 2;
    const bgY = (canvas.height - bgSize) / 2;
    const radius = Math.round(bgSize * 0.15);

    ctx.fillStyle = colorLightInput.value;
    ctx.beginPath();
    ctx.moveTo(bgX + radius, bgY);
    ctx.arcTo(bgX + bgSize, bgY, bgX + bgSize, bgY + bgSize, radius);
    ctx.arcTo(bgX + bgSize, bgY + bgSize, bgX, bgY + bgSize, radius);
    ctx.arcTo(bgX, bgY + bgSize, bgX, bgY, radius);
    ctx.arcTo(bgX, bgY, bgX + bgSize, bgY, radius);
    ctx.closePath();
    ctx.fill();

    const x = (canvas.width - logoSize) / 2;
    const y = (canvas.height - logoSize) / 2;
    ctx.drawImage(logoImage, x, y, logoSize, logoSize);
  }

  function updatePreview() {
    const text = textInput.value.trim();
    container.innerHTML = "";
    if (!text) {
      container.hidden = true;
      runBtn.disabled = true;
      return;
    }
    const size = Math.min(1000, Math.max(100, Number(sizeInput.value) || 400));
    new QRCode(container, {
      text,
      width: size,
      height: size,
      colorDark: colorDarkInput.value,
      colorLight: colorLightInput.value,
      // ロゴで一部が隠れても読み取れるよう、ロゴありのときは誤り訂正レベルを上げる
      correctLevel: logoImage ? QRCode.CorrectLevel.H : QRCode.CorrectLevel.M,
    });

    if (logoImage) {
      const canvas = container.querySelector("canvas");
      if (canvas) drawLogoOnCanvas(canvas);
    }

    container.hidden = false;
    runBtn.disabled = false;
  }

  textInput.addEventListener("input", updatePreview);
  sizeInput.addEventListener("input", updatePreview);
  colorDarkInput.addEventListener("input", updatePreview);
  colorLightInput.addEventListener("input", updatePreview);

  logoInput.addEventListener("change", async () => {
    const file = logoInput.files[0];
    if (!file) return;
    try {
      logoImage = await loadImageElement(file);
      logoClearBtn.hidden = false;
      logoNote.hidden = false;
      updatePreview();
    } catch (err) {
      resultArea.innerHTML = `<p style="color:red;">ロゴ画像を読み込めませんでした。</p>`;
    }
    logoInput.value = "";
  });

  logoClearBtn.addEventListener("click", () => {
    logoImage = null;
    logoClearBtn.hidden = true;
    logoNote.hidden = true;
    updatePreview();
  });

  runBtn.addEventListener("click", async () => {
    const canvas = container.querySelector("canvas");
    if (!canvas) return;
    runBtn.disabled = true;
    runBtn.textContent = "保存中...";
    resultArea.innerHTML = "";

    try {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      const file = new File([blob], "QRコード.png", { type: "image/png" });
      const saveResult = await saveProcessedFiles([file], { category: "その他", tool: "QRコード生成" }, false);
      const savedMsg = saveResult === "folder" ? "指定したフォルダに保存しました。" : "ダウンロードしました。";
      resultArea.innerHTML = `
        <div class="result-card">
          <div class="result-info">
            <p>QRコードを作成しました。</p>
            <p>${savedMsg}</p>
          </div>
        </div>
      `;
    } catch (err) {
      resultArea.innerHTML = `<p style="color:red;">保存に失敗しました。</p>`;
    }

    runBtn.disabled = false;
    runBtn.textContent = "QRコードを保存する";
  });
})();
