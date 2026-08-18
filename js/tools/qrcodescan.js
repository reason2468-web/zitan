(() => {
  const panel = document.getElementById("qrcodescan");
  const toolDetail = document.getElementById("tool-detail");
  const screenControls = document.getElementById("qrscan-screen-controls");
  const imageControls = document.getElementById("qrscan-image-controls");
  const pasteZone = document.getElementById("qrscan-paste-zone");
  const captureArea = document.getElementById("qrscan-capture-area");
  const captureWrap = document.getElementById("qrscan-capture-wrap");
  const captureCanvas = document.getElementById("qrscan-capture-canvas");
  const captureSelect = document.getElementById("qrscan-capture-select");
  const captureConfirmBtn = document.getElementById("qrscan-capture-confirm");
  const captureCancelBtn = document.getElementById("qrscan-capture-cancel");
  const dropzone = document.querySelector('[data-target="qrscan-image-input"]');
  const imageInput = document.getElementById("qrscan-image-input");
  const statusEl = document.getElementById("qrscan-status");
  const resultArea = document.getElementById("qrscan-result");

  const MAX_SCAN_DIM = 2400;
  const MAX_CODES_PER_FRAME = 25;

  let hasCapture = false;
  let selectRect = null; // キャプチャ画像内での選択範囲(キャンバスのピクセル座標)
  let dragStart = null;
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
      if (mode !== "screen") resetCapture();
    });
  });

  // ---------- 画面から読み取る(スクリーンショットを貼り付けて、範囲を選んで1個だけ読み取る) ----------
  //
  // getDisplayMedia(画面共有)は必ずブラウザ標準の確認ダイアログが出る仕様で、これは
  // ブラウザのセキュリティ上の理由により消すことができない。「怖い」という声を踏まえ、
  // 代わりにOS標準のスクリーンショット機能(クリップボードにコピーされる)を貼り付けてもらう方式にする。

  function loadImageFromClipboardItem(item) {
    return new Promise((resolve, reject) => {
      const blob = item.getAsFile();
      if (!blob) { reject(new Error("no image")); return; }
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  function showCaptureImage(img) {
    captureCanvas.width = img.naturalWidth;
    captureCanvas.height = img.naturalHeight;
    captureCanvas.getContext("2d").drawImage(img, 0, 0);

    hasCapture = true;
    selectRect = null;
    captureSelect.hidden = true;
    captureConfirmBtn.disabled = true;
    captureArea.hidden = false;
    statusEl.textContent = "QRコードの部分をドラッグして囲み、「この範囲を読み取る」を押してください。";
  }

  pasteZone.addEventListener("click", () => pasteZone.focus());

  function isPanelVisible() {
    return !toolDetail.classList.contains("hidden") && panel.classList.contains("active");
  }

  function isScreenModeActive() {
    const checked = document.querySelector('input[name="qrscan-mode"]:checked');
    return checked ? checked.value === "screen" : false;
  }

  // pasteZoneにフォーカスしていなくても貼り付けられるよう、document全体で拾う
  // (このツールが表示中で、かつ「画面から読み取る」モードのときだけ反応する)
  document.addEventListener("paste", async (e) => {
    if (!isPanelVisible() || !isScreenModeActive()) return;
    const items = e.clipboardData ? Array.from(e.clipboardData.items) : [];
    const imageItem = items.find((item) => item.type.startsWith("image/"));
    if (!imageItem) {
      statusEl.textContent = "クリップボードに画像が見つかりませんでした。スクリーンショットを撮ってから、もう一度貼り付けてください。";
      return;
    }
    try {
      const img = await loadImageFromClipboardItem(imageItem);
      showCaptureImage(img);
    } catch (err) {
      statusEl.textContent = "画像の読み込みに失敗しました。もう一度お試しください。";
    }
  });

  function canvasPointFromEvent(e) {
    const rect = captureCanvas.getBoundingClientRect();
    const x = Math.min(captureCanvas.width, Math.max(0, Math.round((e.clientX - rect.left) / rect.width * captureCanvas.width)));
    const y = Math.min(captureCanvas.height, Math.max(0, Math.round((e.clientY - rect.top) / rect.height * captureCanvas.height)));
    return { x, y };
  }

  function updateSelectBox(rect) {
    captureSelect.style.left = `${(rect.x / captureCanvas.width) * 100}%`;
    captureSelect.style.top = `${(rect.y / captureCanvas.height) * 100}%`;
    captureSelect.style.width = `${(rect.w / captureCanvas.width) * 100}%`;
    captureSelect.style.height = `${(rect.h / captureCanvas.height) * 100}%`;
    captureSelect.hidden = false;
  }

  captureWrap.addEventListener("pointerdown", (e) => {
    if (!hasCapture) return;
    dragStart = canvasPointFromEvent(e);
    captureWrap.setPointerCapture(e.pointerId);
    captureConfirmBtn.disabled = true;
  });

  captureWrap.addEventListener("pointermove", (e) => {
    if (!dragStart) return;
    const pos = canvasPointFromEvent(e);
    const rect = {
      x: Math.min(dragStart.x, pos.x),
      y: Math.min(dragStart.y, pos.y),
      w: Math.abs(pos.x - dragStart.x),
      h: Math.abs(pos.y - dragStart.y),
    };
    selectRect = rect;
    updateSelectBox(rect);
  });

  captureWrap.addEventListener("pointerup", () => {
    dragStart = null;
    if (selectRect && selectRect.w > 5 && selectRect.h > 5) {
      captureConfirmBtn.disabled = false;
    }
  });

  captureConfirmBtn.addEventListener("click", () => {
    if (!hasCapture || !selectRect) return;
    const { x, y, w, h } = selectRect;
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = w;
    cropCanvas.height = h;
    cropCanvas.getContext("2d").drawImage(captureCanvas, x, y, w, h, 0, 0, w, h);
    const imageData = cropCanvas.getContext("2d").getImageData(0, 0, w, h);
    const codes = decodeAllQRCodes(imageData);

    if (codes.length) {
      addResults([codes[0]], "画面(選択した範囲)");
      statusEl.textContent = "読み取れました。続けて他のQRコードを読み取る場合は、もう一度範囲を選んでください。";
    } else {
      statusEl.textContent = "選択した範囲からQRコードを読み取れませんでした。範囲を選び直してみてください。";
    }
  });

  function resetCapture() {
    hasCapture = false;
    selectRect = null;
    dragStart = null;
    captureArea.hidden = true;
    captureSelect.hidden = true;
  }

  captureCancelBtn.addEventListener("click", () => {
    resetCapture();
    statusEl.textContent = "";
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
