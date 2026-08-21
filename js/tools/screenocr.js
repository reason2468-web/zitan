(() => {
  const dropzone = document.querySelector('[data-target="screenocr-input"]');
  const input = document.getElementById("screenocr-input");
  const fileStatusEl = document.getElementById("screenocr-file-status");
  const imageEl = document.getElementById("screenocr-image");
  const selectNote = document.getElementById("screenocr-select-note");
  const runBtn = document.getElementById("screenocr-run");
  const statusEl = document.getElementById("screenocr-status");
  const errorEl = document.getElementById("screenocr-error");
  const outputLabel = document.getElementById("screenocr-output-label");
  const outputEl = document.getElementById("screenocr-output");
  const copyBtn = document.getElementById("screenocr-copy");
  const downloadBtn = document.getElementById("screenocr-download");

  let cropper = null;
  let ocrWorkers = null; // { horizontal, vertical }

  function setImage(url) {
    imageEl.src = url;
    imageEl.style.display = "block";
    if (cropper) cropper.destroy();
    cropper = new Cropper(imageEl, {
      viewMode: 1,
      autoCropArea: 1,
    });
    selectNote.hidden = false;
    runBtn.disabled = false;
    outputLabel.hidden = true;
    copyBtn.hidden = true;
    downloadBtn.hidden = true;
    errorEl.hidden = true;
  }

  async function loadFiles(fileList) {
    const files = await loadImageFiles(fileList, { resultArea: fileStatusEl, listEl: null });
    if (!files.length) return;
    const file = files[0];
    fileStatusEl.innerHTML = `<p>${file.name} を読み込みました</p>`;
    setImage(URL.createObjectURL(file));
  }

  setupDropzone(dropzone, input, loadFiles);

  // クリップボードに画像がある状態でCtrl+V(貼り付け)すると、そのまま読み込む
  document.addEventListener("paste", (e) => {
    if (!document.getElementById("screenocr")?.classList.contains("active")) return;
    const items = Array.from(e.clipboardData?.items || []);
    const imageItem = items.find((it) => it.type.startsWith("image/"));
    if (!imageItem) return;
    const file = imageItem.getAsFile();
    if (!file) return;
    e.preventDefault();
    loadFiles([file]);
  });

  async function getOcrWorkers() {
    if (ocrWorkers) return ocrWorkers;
    const [horizontal, vertical] = await Promise.all([
      Tesseract.createWorker("jpn+eng"),
      Tesseract.createWorker("jpn_vert"),
    ]);
    // 縦書きは「単一ブロックの縦書き」モードを明示しないと、複数の行(列)を
    // 上から下ではなく横一列ごとに区切ってしまい、文字の並び順が崩れるため設定する
    await vertical.setParameters({ tessedit_pageseg_mode: "5" });
    ocrWorkers = { horizontal, vertical };
    return ocrWorkers;
  }

  // Tesseract.jsのワーカー通信で、日本語などの結果がUTF-8のままLatin-1として
  // 誤読され文字化けすることがあるため、その場合は元の文字列を復元する
  function fixMojibakeUtf8(str) {
    if (!str) return str;
    try {
      const bytes = new Uint8Array([...str].map((ch) => {
        const code = ch.codePointAt(0);
        if (code > 0xff) throw new Error("not mojibake");
        return code;
      }));
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return str;
    }
  }

  const CJK_RANGE = "\\u3000-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF";
  const CJK_SPACE_RE = new RegExp(`([${CJK_RANGE}])[ \\t]+(?=[${CJK_RANGE}])`, "g");

  function cleanupOcrText(text) {
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    let joined = lines.join("\n");
    joined = joined.replace(CJK_SPACE_RE, "$1");
    return joined;
  }

  // 縦書き・横書きの両方でOCRを試し、読み取り精度(confidence)が高いほうを採用する。
  // 信頼度が同点になることがあり、その場合に横書きを優先すると、縦書き画像で
  // 行の順序が崩れた結果(横一列ごとに読んでしまう)が選ばれてしまうため、
  // 同点のときは縦書きを優先する
  async function ocrCanvas(canvas) {
    const { horizontal, vertical } = await getOcrWorkers();
    const [hRes, vRes] = await Promise.all([
      horizontal.recognize(canvas, {}, { text: true }).catch(() => null),
      vertical.recognize(canvas, {}, { text: true }).catch(() => null),
    ]);
    const hConf = hRes?.data?.confidence ?? -1;
    const vConf = vRes?.data?.confidence ?? -1;
    const best = hConf > vConf ? hRes : vRes;
    return cleanupOcrText(fixMojibakeUtf8(best?.data?.text ?? ""));
  }

  function showError(msg) {
    outputLabel.hidden = true;
    outputEl.value = "";
    copyBtn.hidden = true;
    downloadBtn.hidden = true;
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  runBtn.addEventListener("click", async () => {
    if (!cropper) return;
    runBtn.disabled = true;
    runBtn.textContent = "読み取り中...";
    errorEl.hidden = true;
    statusEl.textContent = "文字を読み取っています。初回は読み取りエンジンのダウンロードのため、少し時間がかかります。";

    try {
      const canvas = cropper.getCroppedCanvas();
      const text = await ocrCanvas(canvas);
      statusEl.textContent = "";
      if (!text.trim()) {
        showError("文字を読み取れませんでした。範囲を変えるか、別の画像でお試しください。");
      } else {
        outputEl.value = text;
        outputLabel.hidden = false;
        copyBtn.hidden = false;
        downloadBtn.hidden = false;
      }
    } catch (err) {
      statusEl.textContent = "";
      showError("読み取りに失敗しました。もう一度お試しください。");
    }

    runBtn.disabled = false;
    runBtn.textContent = "文字を読み取る";
  });

  copyBtn.addEventListener("click", () => {
    if (!outputEl.value) return;
    navigator.clipboard.writeText(outputEl.value).then(() => {
      const original = copyBtn.textContent;
      copyBtn.textContent = "コピーしました!";
      setTimeout(() => { copyBtn.textContent = original; }, 1200);
    });
  });

  downloadBtn.addEventListener("click", () => {
    if (!outputEl.value) return;
    downloadFile(new File([outputEl.value], "文字抽出結果.txt", { type: "text/plain" }));
  });
})();
