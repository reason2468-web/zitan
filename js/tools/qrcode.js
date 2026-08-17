(() => {
  const textInput = document.getElementById("qrcode-text");
  const sizeInput = document.getElementById("qrcode-size");
  const runBtn = document.getElementById("qrcode-run");
  const resultArea = document.getElementById("qrcode-result");
  const container = document.getElementById("qrcode-canvas");

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
      correctLevel: QRCode.CorrectLevel.M,
    });
    container.hidden = false;
    runBtn.disabled = false;
  }

  textInput.addEventListener("input", updatePreview);
  sizeInput.addEventListener("input", updatePreview);

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
