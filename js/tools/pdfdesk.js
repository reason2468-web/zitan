(() => {
  const panel = document.getElementById("pdftools");
  const toolDetail = document.getElementById("tool-detail");
  const dropzone = document.querySelector('[data-target="pdfdesk-input"]');
  const input = document.getElementById("pdfdesk-input");
  const canvasEl = document.getElementById("pdfdesk-canvas");
  const emptyMsg = document.getElementById("pdfdesk-empty");
  const resultArea = document.getElementById("pdfdesk-result");

  const undoBtn = document.getElementById("pdfdesk-undo-btn");
  const redoBtn = document.getElementById("pdfdesk-redo-btn");
  const downloadAllBtn = document.getElementById("pdfdesk-download-all-btn");
  const fullscreenBtn = document.getElementById("pdfdesk-fullscreen-btn");

  const modal = document.getElementById("pdfdesk-modal");
  const modalBackdrop = document.getElementById("pdfdesk-modal-backdrop");
  const modalThumbRow = document.getElementById("pdfdesk-modal-thumb-row");
  const modalCancel = document.getElementById("pdfdesk-modal-cancel");
  const modalConfirm = document.getElementById("pdfdesk-modal-confirm");
  const modalSplitAll = document.getElementById("pdfdesk-modal-split-all");

  const MAX_VISUAL_PAGES = 60;
  const MAX_HISTORY = 30;

  let cards = [];
  let nextId = 1;
  let dragState = null;
  let mergeTargetId = null;
  let selectedId = null;
  let modalCard = null;
  let modalSplitPoints = new Set();
  let modalToken = 0;
  let undoStack = [];
  let redoStack = [];

  function isPdfFile(file) {
    return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  }

  function isPanelVisible() {
    return !toolDetail.classList.contains("hidden") && panel.classList.contains("active");
  }

  function updateEmptyState() {
    emptyMsg.hidden = cards.length > 0;
    downloadAllBtn.disabled = cards.length === 0;
  }

  function nextCascadePosition(index) {
    const col = index % 5;
    const row = Math.floor(index / 5);
    return { x: 16 + col * 172, y: 16 + row * 210 };
  }

  // ---------- 元に戻す・やり直す ----------

  function snapshotCards() {
    return cards.map((c) => ({ id: c.id, name: c.name, bytes: c.bytes, pageCount: c.pageCount, x: c.x, y: c.y }));
  }

  function updateUndoRedoButtons() {
    undoBtn.disabled = undoStack.length === 0;
    redoBtn.disabled = redoStack.length === 0;
  }

  function pushHistory() {
    undoStack.push(snapshotCards());
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack = [];
    updateUndoRedoButtons();
  }

  function restoreSnapshot(snapshot) {
    cards.forEach((c) => c.el && c.el.remove());
    selectedId = null;
    cards = snapshot.map((s) => ({ ...s, el: null }));
    cards.forEach((c) => createCardElement(c));
    updateEmptyState();
  }

  undoBtn.addEventListener("click", () => {
    if (!undoStack.length) return;
    redoStack.push(snapshotCards());
    restoreSnapshot(undoStack.pop());
    updateUndoRedoButtons();
  });

  redoBtn.addEventListener("click", () => {
    if (!redoStack.length) return;
    undoStack.push(snapshotCards());
    restoreSnapshot(redoStack.pop());
    updateUndoRedoButtons();
  });

  // ---------- カードの表示 ----------

  async function renderCardThumb(card) {
    const thumbHost = card.el.querySelector(".pdfdesk-card-thumb");
    thumbHost.innerHTML = "";
    try {
      const pdf = await pdfjsLib.getDocument({ data: card.bytes.slice() }).promise;
      const page = await pdf.getPage(1);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(120 / baseViewport.width, 130 / baseViewport.height);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      thumbHost.appendChild(canvas);
    } catch {
      thumbHost.innerHTML = `<span style="color:red;font-size:0.75rem;">表示できません</span>`;
    }
    card.el.querySelector(".pdfdesk-card-pages").textContent = `1/${card.pageCount}`;
  }

  function selectCard(card) {
    if (selectedId !== null) {
      const prev = cards.find((c) => c.id === selectedId);
      if (prev && prev.el) prev.el.classList.remove("selected");
    }
    selectedId = card ? card.id : null;
    if (card) card.el.classList.add("selected");
  }

  function createCardElement(card) {
    const el = document.createElement("div");
    el.className = "pdfdesk-card";
    el.dataset.id = card.id;
    el.style.left = `${card.x}px`;
    el.style.top = `${card.y}px`;
    el.innerHTML = `
      <div class="pdfdesk-card-toolbar">
        <button type="button" class="pdfdesk-card-btn" data-action="rotate-left" title="左に90度回転" aria-label="左に90度回転">⟲</button>
        <span class="pdfdesk-card-pages">1/${card.pageCount}</span>
        <button type="button" class="pdfdesk-card-btn" data-action="rotate-right" title="右に90度回転" aria-label="右に90度回転">⟳</button>
      </div>
      <div class="pdfdesk-card-thumb"></div>
      <div class="pdfdesk-card-name">${card.name}</div>
      <div class="pdfdesk-card-actions">
        <button type="button" class="pdfdesk-card-btn" data-action="split">分割</button>
        <button type="button" class="pdfdesk-card-btn" data-action="download">保存</button>
        <button type="button" class="file-remove-btn" data-action="remove" aria-label="このカードを削除">${TRASH_ICON}</button>
      </div>
    `;
    card.el = el;
    canvasEl.appendChild(el);

    el.addEventListener("pointerdown", (e) => startDrag(e, card));
    el.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        handleCardAction(card, btn.dataset.action);
      });
    });

    renderCardThumb(card);
    return el;
  }

  function addCard({ name, bytes, pageCount }, cascadeIndex) {
    const pos = nextCascadePosition(cascadeIndex != null ? cascadeIndex : cards.length);
    const card = { id: nextId++, name, bytes, pageCount, x: pos.x, y: pos.y, el: null };
    cards.push(card);
    createCardElement(card);
    updateEmptyState();
    return card;
  }

  function removeCardSilently(card) {
    if (selectedId === card.id) selectedId = null;
    card.el.remove();
    cards = cards.filter((c) => c.id !== card.id);
    updateEmptyState();
  }

  // ---------- ドラッグ移動・結合判定 ----------

  function rectOverlapArea(a, b) {
    const left = Math.max(a.x, b.x);
    const right = Math.min(a.x + a.w, b.x + b.w);
    const top = Math.max(a.y, b.y);
    const bottom = Math.min(a.y + a.h, b.y + b.h);
    if (right <= left || bottom <= top) return 0;
    return (right - left) * (bottom - top);
  }

  function clearMergeTarget() {
    if (mergeTargetId) {
      const target = cards.find((c) => c.id === mergeTargetId);
      if (target) target.el.classList.remove("merge-target");
    }
    mergeTargetId = null;
  }

  function updateMergeTarget(draggingCard) {
    clearMergeTarget();
    const a = { x: draggingCard.x, y: draggingCard.y, w: draggingCard.el.offsetWidth, h: draggingCard.el.offsetHeight };
    let best = null;
    let bestArea = 0;
    for (const other of cards) {
      if (other.id === draggingCard.id) continue;
      const b = { x: other.x, y: other.y, w: other.el.offsetWidth, h: other.el.offsetHeight };
      const area = rectOverlapArea(a, b);
      const threshold = 0.35 * Math.min(a.w * a.h, b.w * b.h);
      if (area > threshold && area > bestArea) {
        best = other;
        bestArea = area;
      }
    }
    if (best) {
      mergeTargetId = best.id;
      best.el.classList.add("merge-target");
    }
  }

  function startDrag(e, card) {
    if (e.target.closest("button")) return;
    e.preventDefault();
    const cardRect = card.el.getBoundingClientRect();
    dragState = {
      card,
      offsetX: e.clientX - cardRect.left,
      offsetY: e.clientY - cardRect.top,
      startX: card.x,
      startY: card.y,
      preDragSnapshot: snapshotCards(),
      moved: false,
    };
    card.el.classList.add("dragging");
    card.el.setPointerCapture(e.pointerId);
    card.el.addEventListener("pointermove", onDragMove);
    card.el.addEventListener("pointerup", onDragEnd);
    card.el.addEventListener("pointercancel", onDragEnd);
  }

  function onDragMove(e) {
    if (!dragState) return;
    const canvasRect = canvasEl.getBoundingClientRect();
    const card = dragState.card;
    const cardW = card.el.offsetWidth;
    const cardH = card.el.offsetHeight;
    let x = e.clientX - canvasRect.left - dragState.offsetX;
    let y = e.clientY - canvasRect.top - dragState.offsetY;
    x = Math.max(0, Math.min(x, canvasRect.width - cardW));
    y = Math.max(0, Math.min(y, canvasRect.height - cardH));
    if (x !== card.x || y !== card.y) dragState.moved = true;
    card.x = x;
    card.y = y;
    card.el.style.left = `${x}px`;
    card.el.style.top = `${y}px`;
    updateMergeTarget(card);
  }

  function onDragEnd(e) {
    if (!dragState) return;
    const card = dragState.card;
    const wasMoved = dragState.moved;
    const preDragSnapshot = dragState.preDragSnapshot;
    card.el.releasePointerCapture(e.pointerId);
    card.el.removeEventListener("pointermove", onDragMove);
    card.el.removeEventListener("pointerup", onDragEnd);
    card.el.removeEventListener("pointercancel", onDragEnd);
    card.el.classList.remove("dragging");
    dragState = null;
    selectCard(card);

    const targetId = mergeTargetId;
    clearMergeTarget();
    if (targetId) {
      const targetCard = cards.find((c) => c.id === targetId);
      if (targetCard) {
        undoStack.push(preDragSnapshot);
        if (undoStack.length > MAX_HISTORY) undoStack.shift();
        redoStack = [];
        updateUndoRedoButtons();
        mergeCards(card, targetCard);
        return;
      }
    }
    if (wasMoved) {
      undoStack.push(preDragSnapshot);
      if (undoStack.length > MAX_HISTORY) undoStack.shift();
      redoStack = [];
      updateUndoRedoButtons();
    }
  }

  // ---------- カードの操作(回転・結合・分割・保存・削除) ----------

  async function rotateCard(card, delta) {
    pushHistory();
    const { PDFDocument, degrees } = PDFLib;
    try {
      const doc = await PDFDocument.load(card.bytes, { ignoreEncryption: true });
      doc.getPages().forEach((p) => {
        const cur = p.getRotation().angle;
        p.setRotation(degrees(((cur + delta) % 360 + 360) % 360));
      });
      card.bytes = await doc.save();
      renderCardThumb(card);
    } catch {
      resultArea.innerHTML = `<p style="color:red;">回転に失敗しました。</p>`;
    }
  }

  // カードAをカードBに重ねたとき、上に乗せたA(ドラッグしていた側)のページが先頭にくるようにする
  async function mergeCards(draggedCard, targetCard) {
    resultArea.innerHTML = "";
    try {
      const { PDFDocument } = PDFLib;
      const draggedDoc = await PDFDocument.load(draggedCard.bytes, { ignoreEncryption: true });
      const targetDoc = await PDFDocument.load(targetCard.bytes, { ignoreEncryption: true });
      const mergedDoc = await PDFDocument.create();
      const topPages = await mergedDoc.copyPages(draggedDoc, draggedDoc.getPageIndices());
      topPages.forEach((p) => mergedDoc.addPage(p));
      const restPages = await mergedDoc.copyPages(targetDoc, targetDoc.getPageIndices());
      restPages.forEach((p) => mergedDoc.addPage(p));
      targetCard.bytes = await mergedDoc.save();
      targetCard.pageCount = mergedDoc.getPageCount();
      removeCardSilently(draggedCard);
      selectCard(targetCard);
      await renderCardThumb(targetCard);
      resultArea.innerHTML = `<p>「${draggedCard.name}」を「${targetCard.name}」に結合しました。</p>`;
    } catch {
      resultArea.innerHTML = `<p style="color:red;">結合に失敗しました(壊れているか、パスワード保護されている可能性があります)。</p>`;
    }
  }

  function downloadCard(card) {
    downloadFile(new File([card.bytes], card.name, { type: "application/pdf" }));
  }

  function removeCard(card) {
    pushHistory();
    removeCardSilently(card);
  }

  function handleCardAction(card, action) {
    if (action === "rotate-left") rotateCard(card, -90);
    else if (action === "rotate-right") rotateCard(card, 90);
    else if (action === "remove") removeCard(card);
    else if (action === "download") downloadCard(card);
    else if (action === "split") openSplitModal(card);
  }

  canvasEl.addEventListener("click", (e) => {
    if (e.target === canvasEl) selectCard(null);
  });

  document.addEventListener("keydown", (e) => {
    if (!isPanelVisible()) return;
    if ((e.key === "Delete" || e.key === "Backspace") && selectedId !== null) {
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const card = cards.find((c) => c.id === selectedId);
      if (card) {
        e.preventDefault();
        removeCard(card);
      }
    }
  });

  // ---------- すべてダウンロード ----------

  downloadAllBtn.addEventListener("click", async () => {
    if (!cards.length) return;
    const files = cards.map((c) => new File([c.bytes], c.name, { type: "application/pdf" }));
    const saveResult = await saveProcessedFiles(files, { category: "PDF", tool: "自由に操作する" }, true);
    const savedMsg = saveResult === "folder" ? "指定したフォルダに保存しました。" : "ダウンロードしました。";
    resultArea.innerHTML = `<p>${files.length}件のPDFを${savedMsg}</p>`;
  });

  // ---------- 全画面 ----------

  function setFullscreen(on) {
    panel.classList.toggle("pdfdesk-fullscreen", on);
    fullscreenBtn.textContent = on ? "✕ 全画面を閉じる" : "⛶ 全画面で開く";
  }

  fullscreenBtn.addEventListener("click", () => {
    setFullscreen(!panel.classList.contains("pdfdesk-fullscreen"));
  });

  document.addEventListener("keydown", (e) => {
    if (!isPanelVisible()) return;
    if (e.key === "Escape" && panel.classList.contains("pdfdesk-fullscreen")) {
      setFullscreen(false);
    }
  });

  // ---------- 分割モーダル(ページを見ながら分ける・1ページずつ) ----------

  function updateModalConfirmLabel() {
    const count = modalSplitPoints.size + 1;
    modalConfirm.textContent = modalSplitPoints.size ? `${count}枚のカードに分ける` : "分ける位置を選んでください";
    modalConfirm.disabled = modalSplitPoints.size === 0;
  }

  async function renderModalThumbnails(card) {
    const token = ++modalToken;
    modalThumbRow.innerHTML = `<p>読み込み中...</p>`;
    try {
      const pdf = await pdfjsLib.getDocument({ data: card.bytes.slice() }).promise;
      if (token !== modalToken) return;
      const pageCount = pdf.numPages;

      if (pageCount < 2) {
        modalThumbRow.innerHTML = `<p>このカードは1ページしかないため、分けられません。</p>`;
        modalSplitAll.disabled = true;
        return;
      }
      modalSplitAll.disabled = false;
      if (pageCount > MAX_VISUAL_PAGES) {
        modalThumbRow.innerHTML = `<p style="color:red;">ページ数が多いため(${MAX_VISUAL_PAGES}ページ超)、この画面では表示できません。「1ページずつ分割する」はそのまま使えます。</p>`;
        return;
      }

      modalThumbRow.innerHTML = "";
      for (let i = 1; i <= pageCount; i++) {
        const page = await pdf.getPage(i);
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = 110 / baseViewport.width;
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        if (token !== modalToken) return;

        const thumbCard = document.createElement("div");
        thumbCard.className = "pdfsplit-thumb-card";
        thumbCard.appendChild(canvas);
        const num = document.createElement("span");
        num.className = "pdfsplit-thumb-num";
        num.textContent = i;
        thumbCard.appendChild(num);
        modalThumbRow.appendChild(thumbCard);

        if (i < pageCount) {
          const divider = document.createElement("button");
          divider.type = "button";
          divider.className = "pdfsplit-divider";
          divider.title = "ここで分割";
          divider.setAttribute("aria-label", `${i}ページ目の後ろで分ける`);
          divider.innerHTML = `<span class="pdfsplit-divider-icon">✂</span>`;
          divider.dataset.page = i;
          divider.addEventListener("click", () => {
            if (modalSplitPoints.has(i)) modalSplitPoints.delete(i);
            else modalSplitPoints.add(i);
            divider.classList.toggle("active", modalSplitPoints.has(i));
            updateModalConfirmLabel();
          });
          modalThumbRow.appendChild(divider);
        }
      }
    } catch {
      if (token !== modalToken) return;
      modalThumbRow.innerHTML = `<p style="color:red;">ページを読み込めませんでした。</p>`;
      modalSplitAll.disabled = true;
    }
  }

  function openSplitModal(card) {
    modalCard = card;
    modalSplitPoints = new Set();
    modal.hidden = false;
    updateModalConfirmLabel();
    renderModalThumbnails(card);
  }

  function closeModal() {
    modal.hidden = true;
    modalCard = null;
    modalSplitPoints = new Set();
    modalToken++;
  }

  modalCancel.addEventListener("click", closeModal);
  modalBackdrop.addEventListener("click", closeModal);

  async function applySplit(card, splitPointsArr) {
    pushHistory();
    try {
      const { PDFDocument } = PDFLib;
      const srcDoc = await PDFDocument.load(card.bytes, { ignoreEncryption: true });
      const pageCount = srcDoc.getPageCount();
      const sorted = [...splitPointsArr].sort((a, b) => a - b);
      const boundaries = [0, ...sorted, pageCount];
      const baseNoExt = card.name.replace(/\.pdf$/i, "");
      const originIndex = cards.findIndex((c) => c.id === card.id);

      removeCardSilently(card);

      for (let i = 0; i < boundaries.length - 1; i++) {
        const group = [];
        for (let p = boundaries[i]; p < boundaries[i + 1]; p++) group.push(p);
        const newDoc = await PDFDocument.create();
        const pages = await newDoc.copyPages(srcDoc, group);
        pages.forEach((p) => newDoc.addPage(p));
        const bytes = await newDoc.save();
        const start = group[0] + 1;
        const end = group[group.length - 1] + 1;
        const label = start === end ? `p${start}` : `p${start}-${end}`;
        addCard({ name: `${baseNoExt}_${label}.pdf`, bytes, pageCount: group.length }, originIndex + i);
      }
      closeModal();
    } catch {
      modalThumbRow.innerHTML = `<p style="color:red;">分割に失敗しました。</p>`;
      modalConfirm.disabled = false;
      modalConfirm.textContent = "もう一度試す";
    }
  }

  modalConfirm.addEventListener("click", () => {
    if (!modalCard || !modalSplitPoints.size) return;
    modalConfirm.disabled = true;
    modalConfirm.textContent = "分けています...";
    applySplit(modalCard, Array.from(modalSplitPoints));
  });

  modalSplitAll.addEventListener("click", async () => {
    if (!modalCard) return;
    modalSplitAll.disabled = true;
    const { PDFDocument } = PDFLib;
    try {
      const doc = await PDFDocument.load(modalCard.bytes, { ignoreEncryption: true });
      const pageCount = doc.getPageCount();
      if (pageCount < 2) return;
      const allPoints = [];
      for (let i = 1; i < pageCount; i++) allPoints.push(i);
      await applySplit(modalCard, allPoints);
    } catch {
      modalThumbRow.innerHTML = `<p style="color:red;">分割に失敗しました。</p>`;
      modalSplitAll.disabled = false;
    }
  });

  // ---------- ファイル読み込み ----------

  async function addCardsFromFiles(fileList) {
    const allFiles = Array.from(fileList);
    const pdfFiles = allFiles.filter(isPdfFile);
    if (!pdfFiles.length) {
      resultArea.innerHTML = `<p style="color:red;">PDFファイルが見つかりませんでした。</p>`;
      return;
    }
    resultArea.innerHTML = "";
    pushHistory();
    const { PDFDocument } = PDFLib;
    for (const file of pdfFiles) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        addCard({ name: file.name, bytes, pageCount: doc.getPageCount() });
      } catch {
        resultArea.innerHTML += `<p style="color:red;">「${file.name}」を読み込めませんでした。</p>`;
      }
    }
  }

  setupDropzone(dropzone, input, addCardsFromFiles);

  updateEmptyState();
  updateUndoRedoButtons();
})();
