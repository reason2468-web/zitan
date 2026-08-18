(() => {
  const screenControls = document.getElementById("qrscan-screen-controls");
  const imageControls = document.getElementById("qrscan-image-controls");
  const screenStartBtn = document.getElementById("qrscan-screen-start");
  const screenStopBtn = document.getElementById("qrscan-screen-stop");
  const video = document.getElementById("qrscan-video");
  const dropzone = document.querySelector('[data-target="qrscan-image-input"]');
  const imageInput = document.getElementById("qrscan-image-input");
  const statusEl = document.getElementById("qrscan-status");
  const resultArea = document.getElementById("qrscan-result");

  const MAX_SCAN_DIM = 2400;
  const SCAN_INTERVAL_MS = 500;
  const MAX_CODES_PER_FRAME = 25;

  let screenStream = null;
  let scanTimer = null;
  const found = []; // { text, source }
  const seenTexts = new Set();

  function loadImageElement(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[ch]);
  }

  // 1枚の画像(ImageData)の中から、見つかる限りすべてのQRコードを読み取る。
  // jsQRは1回の呼び出しで1つしか検出できないため、見つけた場所を黒く塗りつぶしてから
  // 再度探す、という処理を繰り返して複数のQRコードに対応する。
  function decodeAllQRCodes(imageData) {
    const results = [];
    const data = new Uint8ClampedArray(imageData.data);
    const { width, height } = imageData;
    let attempts = 0;

    while (attempts < MAX_CODES_PER_FRAME) {
      attempts++;
      const code = jsQR(data, width, height, { inversionAttempts: "attemptBoth" });
      if (!code || !code.data) break;
      results.push(code.data);

      const pts = [code.location.topLeftCorner, code.location.topRightCorner, code.location.bottomRightCorner, code.location.bottomLeftCorner];
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const minX = Math.max(0, Math.floor(Math.min(...xs)) - 4);
      const maxX = Math.min(width, Math.ceil(Math.max(...xs)) + 4);
      const minY = Math.max(0, Math.floor(Math.min(...ys)) - 4);
      const maxY = Math.min(height, Math.ceil(Math.max(...ys)) + 4);
      for (let y = minY; y < maxY; y++) {
        for (let x = minX; x < maxX; x++) {
          const idx = (y * width + x) * 4;
          data[idx] = 0;
          data[idx + 1] = 0;
          data[idx + 2] = 0;
          data[idx + 3] = 255;
        }
      }
    }
    return results;
  }

  async function copyText(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      // クリップボードが使えない環境では何もしない
    }
    if (btn) {
      const original = btn.textContent;
      btn.textContent = "コピーしました";
      setTimeout(() => { btn.textContent = original; }, 1000);
    }
  }

  function renderResults() {
    if (!found.length) {
      resultArea.innerHTML = "";
      return;
    }
    const items = found.map((r, i) => {
      const isUrl = /^https?:\/\//i.test(r.text);
      const escaped = escapeHtml(r.text);
      return `
        <div class="result-card qrscan-result-card">
          <div class="result-info">
            <p class="qrscan-result-text">${isUrl ? `<a href="${escaped}" target="_blank" rel="noopener">${escaped}</a>` : escaped}</p>
            <p class="format-note">${escapeHtml(r.source)}から読み取り</p>
          </div>
          <button type="button" class="file-btn-outline qrscan-copy-btn" data-index="${i}">コピー</button>
        </div>
      `;
    }).join("");
    resultArea.innerHTML = `
      <div class="selected-file-header">
        <p>${found.length}件のQRコードを読み取りました</p>
        <button type="button" class="clear-all-btn" id="qrscan-clear-btn">すべて削除</button>
      </div>
      ${items}
    `;
    resultArea.querySelectorAll(".qrscan-copy-btn").forEach((btn) => {
      btn.addEventListener("click", () => copyText(found[Number(btn.dataset.index)].text, btn));
    });
    const clearBtn = document.getElementById("qrscan-clear-btn");
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        found.length = 0;
        seenTexts.clear();
        renderResults();
      });
    }
  }

  function addResults(texts, source) {
    let addedAny = false;
    texts.forEach((text) => {
      if (seenTexts.has(text)) return;
      seenTexts.add(text);
      found.push({ text, source });
      addedAny = true;
    });
    if (addedAny) renderResults();
  }

  // ---------- モード切り替え ----------

  document.querySelectorAll('input[name="qrscan-mode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      const mode = document.querySelector('input[name="qrscan-mode"]:checked').value;
      screenControls.hidden = mode !== "screen";
      imageControls.hidden = mode !== "image";
      statusEl.textContent = "";
      if (mode !== "screen") stopScreenScan();
    });
  });

  // ---------- 画面から読み取る ----------

  function drawVideoToCanvas(canvas, ctx) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const scale = Math.min(1, MAX_SCAN_DIM / Math.max(vw, vh));
    canvas.width = Math.max(1, Math.round(vw * scale));
    canvas.height = Math.max(1, Math.round(vh * scale));
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  }

  async function startScreenScan() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      statusEl.textContent = "お使いのブラウザは画面共有に対応していません。Chrome・Edgeなどでお試しください。";
      return;
    }
    try {
      // 画面内の小さいQRコードも読み取れるよう、できるだけ高い解像度を要求する
      // (実際の解像度は画面や環境によって変わり、ブラウザ側で調整される)
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 5, max: 10 } },
      });
    } catch (err) {
      return; // ユーザーが選択をキャンセルした場合
    }

    video.srcObject = screenStream;
    video.hidden = false;
    try {
      await video.play();
    } catch (err) {
      // 一部環境で自動再生がブロックされても、映像自体は取得できていれば読み取りは続行する
    }

    screenStartBtn.hidden = true;
    screenStopBtn.hidden = false;
    statusEl.textContent = "読み取り中です。QRコードが画面に映るようにしてください。";

    screenStream.getVideoTracks()[0].addEventListener("ended", stopScreenScan);

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    scanTimer = setInterval(() => {
      if (!video.videoWidth) return;
      try {
        drawVideoToCanvas(canvas, ctx);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const codes = decodeAllQRCodes(imageData);
        if (codes.length) addResults(codes, "画面");
        statusEl.textContent = found.length
          ? `読み取り中です。ここまでに${found.length}件見つかりました。`
          : "読み取り中です。QRコードが画面に映るようにしてください。";
      } catch (err) {
        // 1フレームの読み取り失敗は無視して続行する
      }
    }, SCAN_INTERVAL_MS);
  }

  function stopScreenScan() {
    if (scanTimer) {
      clearInterval(scanTimer);
      scanTimer = null;
    }
    if (screenStream) {
      screenStream.getTracks().forEach((t) => t.stop());
      screenStream = null;
    }
    video.pause();
    video.srcObject = null;
    video.hidden = true;
    screenStartBtn.hidden = false;
    screenStopBtn.hidden = true;
    statusEl.textContent = "";
  }

  screenStartBtn.addEventListener("click", startScreenScan);
  screenStopBtn.addEventListener("click", stopScreenScan);

  // ツールを離れるときは画面共有を止める(消し忘れ防止)
  document.getElementById("tool-back")?.addEventListener("click", stopScreenScan);
  document.querySelectorAll(".category-btn, .tool-card").forEach((el) => {
    el.addEventListener("click", stopScreenScan);
  });

  // ---------- 画像から読み取る ----------

  async function scanImageFiles(fileList) {
    const files = Array.from(fileList).filter(isImageFile);
    if (!files.length) {
      statusEl.textContent = "画像ファイルが見つかりませんでした。";
      return;
    }
    statusEl.textContent = "読み取り中...";

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    let totalFound = 0;

    for (const file of files) {
      try {
        const img = await loadImageElement(file);
        const scale = Math.min(1, MAX_SCAN_DIM / Math.max(img.naturalWidth, img.naturalHeight));
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const codes = decodeAllQRCodes(imageData);
        addResults(codes, file.name);
        totalFound += codes.length;
      } catch (err) {
        // 読み込めない画像はスキップ
      }
    }

    statusEl.textContent = totalFound
      ? `${files.length}件の画像を確認し、${totalFound}件のQRコードを見つけました。`
      : `${files.length}件の画像を確認しましたが、QRコードは見つかりませんでした。`;
  }

  setupDropzone(dropzone, imageInput, scanImageFiles);
})();
