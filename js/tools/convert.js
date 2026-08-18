(() => {
  const dropzone = document.querySelector('[data-target="convert-input"]');
  const input = document.getElementById("convert-input");
  const folderInput = document.getElementById("convert-folder-input");
  const formatSelect = document.getElementById("convert-format");
  const runBtn = document.getElementById("convert-run");
  const resultArea = document.getElementById("convert-result");
  const listEl = document.getElementById("convert-list");
  const pdfModeRow = document.getElementById("convert-pdf-mode-row");
  const pdfSizeRow = document.getElementById("convert-pdf-size-row");

  const mergeModal = document.getElementById("convert-merge-modal");
  const mergeModalBackdrop = document.getElementById("convert-merge-modal-backdrop");
  const mergePreviewRow = document.getElementById("convert-merge-preview-row");
  const mergeModalCancel = document.getElementById("convert-merge-modal-cancel");
  const mergeModalConfirm = document.getElementById("convert-merge-modal-confirm");

  let currentFiles = [];
  let mergeOrder = [];
  let mergeToken = 0;

  function getPdfMode() {
    const checked = document.querySelector('input[name="convert-pdf-mode"]:checked');
    return checked ? checked.value : "separate";
  }

  function getPdfSizeMode() {
    const checked = document.querySelector('input[name="convert-pdf-size"]:checked');
    return checked ? checked.value : "keep";
  }

  function updatePdfOptionVisibility() {
    const isPdf = formatSelect.value === "application/pdf";
    pdfModeRow.hidden = !isPdf;
    pdfSizeRow.hidden = !(isPdf && getPdfMode() === "merge");
  }

  formatSelect.addEventListener("change", updatePdfOptionVisibility);
  document.querySelectorAll('input[name="convert-pdf-mode"]').forEach((radio) => {
    radio.addEventListener("change", updatePdfOptionVisibility);
  });

  async function loadFiles(fileList) {
    const newFiles = await loadImageFiles(fileList, { resultArea, listEl });
    currentFiles = mergeUniqueFiles(currentFiles, newFiles);
    runBtn.disabled = currentFiles.length === 0;
    if (currentFiles.length) {
      renderSelectedFiles(resultArea, currentFiles, (updated) => {
        currentFiles = updated;
        runBtn.disabled = currentFiles.length === 0;
      });
    }
  }

  setupDropzone(dropzone, input, loadFiles);
  folderInput.addEventListener("change", () => {
    if (folderInput.files.length) loadFiles(folderInput.files);
  });

  function loadImageElement(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  function extensionFor(mimeType) {
    if (mimeType === "image/png") return "png";
    if (mimeType === "image/webp") return "webp";
    if (mimeType === "image/avif") return "avif";
    if (mimeType === "application/pdf") return "pdf";
    return "jpg";
  }

  function labelFor(mimeType) {
    if (mimeType === "application/pdf") return "PDF";
    return mimeType.replace("image/", "").toUpperCase();
  }

  // 画像1枚をA4等ではなく画像自体のサイズのPDFに変換する(96dpi想定でpx→pt換算)
  const PT_PER_PX = 0.75;
  // A4サイズ(ポイント単位、210mm×297mm)
  const A4_SHORT = 595.28;
  const A4_LONG = 841.89;

  // 画像ファイルを既存のpdfDocに1ページとして追加する(単独PDF化・結合PDF化の両方から使う)
  // sizeMode: "keep"(元のサイズのまま) または "a4"(A4に収まるよう縮小して中央配置)
  async function addImageAsPdfPage(pdfDoc, file, sizeMode = "keep") {
    const img = await loadImageElement(file);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    const jpegBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
    const jpgImage = await pdfDoc.embedJpg(jpegBytes);

    const imgWidthPt = canvas.width * PT_PER_PX;
    const imgHeightPt = canvas.height * PT_PER_PX;

    if (sizeMode === "a4") {
      const isLandscape = canvas.width >= canvas.height;
      const pageWidth = isLandscape ? A4_LONG : A4_SHORT;
      const pageHeight = isLandscape ? A4_SHORT : A4_LONG;
      const scale = Math.min(pageWidth / imgWidthPt, pageHeight / imgHeightPt);
      const drawWidth = imgWidthPt * scale;
      const drawHeight = imgHeightPt * scale;
      const page = pdfDoc.addPage([pageWidth, pageHeight]);
      page.drawImage(jpgImage, {
        x: (pageWidth - drawWidth) / 2,
        y: (pageHeight - drawHeight) / 2,
        width: drawWidth,
        height: drawHeight,
      });
      return;
    }

    const page = pdfDoc.addPage([imgWidthPt, imgHeightPt]);
    page.drawImage(jpgImage, { x: 0, y: 0, width: imgWidthPt, height: imgHeightPt });
  }

  async function imageFileToPdfFile(file) {
    const pdfDoc = await PDFLib.PDFDocument.create();
    await addImageAsPdfPage(pdfDoc, file);
    const pdfBytes = await pdfDoc.save();
    const newName = `${file.name.replace(/\.[^/.]+$/, "")}.pdf`;
    return new File([pdfBytes], newName, { type: "application/pdf" });
  }

  // ---------- 画像→PDF結合(順番プレビュー) ----------

  async function renderImageThumbCanvas(file, maxWidth, maxHeight) {
    const img = await loadImageElement(file);
    let scale = maxWidth / img.naturalWidth;
    if (maxHeight && img.naturalHeight * scale > maxHeight) scale = maxHeight / img.naturalHeight;
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth * scale;
    canvas.height = img.naturalHeight * scale;
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function renderMergeOrder() {
    mergePreviewRow.innerHTML = "";
    mergeOrder.forEach((entry, i) => {
      entry.el.querySelector(".pdfdesk-merge-preview-label").textContent = `${i + 1}. ${entry.file.name}`;
      const [leftBtn, rightBtn] = entry.el.querySelectorAll(".pdfdesk-merge-preview-move button");
      leftBtn.disabled = i === 0;
      rightBtn.disabled = i === mergeOrder.length - 1;
      mergePreviewRow.appendChild(entry.el);
    });
  }

  function moveMergeItem(entry, delta) {
    const idx = mergeOrder.indexOf(entry);
    const newIdx = idx + delta;
    if (idx === -1 || newIdx < 0 || newIdx >= mergeOrder.length) return;
    [mergeOrder[idx], mergeOrder[newIdx]] = [mergeOrder[newIdx], mergeOrder[idx]];
    renderMergeOrder();
  }

  async function openMergeOrderModal() {
    mergeOrder = currentFiles.map((file) => ({ file, el: null }));
    mergeModal.hidden = false;
    mergeModalConfirm.disabled = false;
    mergeModalConfirm.textContent = "結合してダウンロード";
    mergePreviewRow.innerHTML = `<p>読み込み中...</p>`;
    const token = ++mergeToken;

    for (const entry of mergeOrder) {
      const wrap = document.createElement("div");
      wrap.className = "pdfsplit-thumb-card";
      try {
        wrap.appendChild(await renderImageThumbCanvas(entry.file, 100, 150));
      } catch {
        const span = document.createElement("span");
        span.style.color = "red";
        span.style.fontSize = "0.7rem";
        span.textContent = "表示できません";
        wrap.appendChild(span);
      }
      if (token !== mergeToken) return;

      const label = document.createElement("span");
      label.className = "pdfdesk-merge-preview-label";
      wrap.appendChild(label);

      const moveRow = document.createElement("div");
      moveRow.className = "pdfdesk-merge-preview-move";
      const leftBtn = document.createElement("button");
      leftBtn.type = "button";
      leftBtn.className = "pdfdesk-card-btn";
      leftBtn.textContent = "◀";
      leftBtn.setAttribute("aria-label", "順番を1つ前に");
      leftBtn.addEventListener("click", () => moveMergeItem(entry, -1));
      const rightBtn = document.createElement("button");
      rightBtn.type = "button";
      rightBtn.className = "pdfdesk-card-btn";
      rightBtn.textContent = "▶";
      rightBtn.setAttribute("aria-label", "順番を1つ後ろに");
      rightBtn.addEventListener("click", () => moveMergeItem(entry, 1));
      moveRow.appendChild(leftBtn);
      moveRow.appendChild(rightBtn);
      wrap.appendChild(moveRow);

      entry.el = wrap;
    }
    renderMergeOrder();
  }

  function closeMergeOrderModal() {
    mergeModal.hidden = true;
    mergeOrder = [];
    mergeToken++;
  }

  mergeModalCancel.addEventListener("click", closeMergeOrderModal);
  mergeModalBackdrop.addEventListener("click", closeMergeOrderModal);

  mergeModalConfirm.addEventListener("click", async () => {
    if (!mergeOrder.length) return;
    mergeModalConfirm.disabled = true;
    mergeModalConfirm.textContent = "結合中...";
    try {
      const sizeMode = getPdfSizeMode();
      const pdfDoc = await PDFLib.PDFDocument.create();
      for (const entry of mergeOrder) {
        await addImageAsPdfPage(pdfDoc, entry.file, sizeMode);
      }
      const pdfBytes = await pdfDoc.save();
      const baseName = mergeOrder.length === 1 ? mergeOrder[0].file.name.replace(/\.[^/.]+$/, "") : "結合PDF";
      const merged = new File([pdfBytes], `${baseName}.pdf`, { type: "application/pdf" });
      await saveProcessedFiles([merged], { category: "画像", tool: "変換.PDF結合" }, false);
      resultArea.innerHTML = `
        <div class="result-card">
          <div class="result-info">
            <p>${mergeOrder.length}件の画像を1つのPDFに結合しました。</p>
            <p>ダウンロードしました。</p>
          </div>
        </div>
      `;
    } catch {
      resultArea.innerHTML = `<p style="color:red;">結合に失敗しました。</p>`;
    }
    closeMergeOrderModal();
  });

  runBtn.addEventListener("click", async () => {
    if (!currentFiles.length) return;

    if (formatSelect.value === "application/pdf" && getPdfMode() === "merge") {
      openMergeOrderModal();
      return;
    }

    runBtn.disabled = true;
    runBtn.textContent = "変換中...";
    listEl.innerHTML = "";
    resultArea.innerHTML = "";

    const targetType = formatSelect.value;
    const targetLabel = labelFor(targetType);
    const ext = extensionFor(targetType);
    const results = [];
    const skipped = [];

    for (const file of currentFiles) {
      const li = document.createElement("li");
      li.innerHTML = `<span>${file.name}</span><span>処理中...</span>`;
      listEl.appendChild(li);

      // 元々HEICだったファイルは、この時点では既にJPEGへ変換済みだが「元は違う形式だった」ため変換対象にする
      if (normalizeImageType(file.type) === targetType && !file.zitanOriginallyHeic) {
        skipped.push(file.name);
        li.innerHTML = `<span>${file.name}</span><span>対応済み(すでに${targetLabel}形式)</span>`;
        continue;
      }

      try {
        if (targetType === "application/pdf") {
          const converted = await imageFileToPdfFile(file);
          results.push(converted);
          li.innerHTML = `<span>${file.name}</span><span>PDFに変換しました</span>`;
          continue;
        }

        const img = await loadImageElement(file);
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");

        if (targetType === "image/jpeg") {
          // JPEGは透明を扱えないため白背景で塗りつぶす
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(img, 0, 0);

        const blob = await new Promise((resolve) => canvas.toBlob(resolve, targetType, 0.92));
        const newName = `${file.name.replace(/\.[^/.]+$/, "")}.${ext}`;
        const converted = new File([blob], newName, { type: targetType });
        results.push(converted);
        li.innerHTML = `<span>${file.name}</span><span>${targetLabel}に変換しました</span>`;
      } catch (err) {
        li.innerHTML = `<span>${file.name}</span><span style="color:red;">失敗</span>`;
      }
    }

    const skippedNotice = skipped.length
      ? `
        <div class="result-card result-notice">
          <div class="result-info">
            <p>${skipped.length}件は、すでに${targetLabel}形式のため、そのままで完了しています。</p>
            <p class="format-note">${skipped.join("、")}</p>
          </div>
        </div>
      `
      : "";

    if (results.length) {
      const saveResult = await saveProcessedFiles(results, { category: "画像", tool: `変換.${targetLabel}` }, currentFiles.length > 1);
      const savedMsg = saveResult === "folder" ? "指定したフォルダに保存しました。" : "ダウンロードしました。";
      resultArea.innerHTML = `
        ${skippedNotice}
        <div class="result-card">
          <div class="result-info">
            <p>${results.length}件を変換しました。</p>
            <p>${savedMsg}</p>
          </div>
        </div>
      `;
    } else if (skipped.length) {
      resultArea.innerHTML = skippedNotice;
    } else {
      resultArea.innerHTML = `<p style="color:red;">変換できたファイルがありませんでした。</p>`;
    }

    runBtn.disabled = false;
    runBtn.textContent = "変換する";
  });
})();
