(() => {
  const panel = document.getElementById("pdftools");
  const toolDetail = document.getElementById("tool-detail");
  const dropzone = document.querySelector('[data-target="pdfdesk-input"]');
  const input = document.getElementById("pdfdesk-input");
  const scrollEl = document.getElementById("pdfdesk-canvas-scroll");
  const innerEl = document.getElementById("pdfdesk-canvas-inner");
  const emptyMsg = document.getElementById("pdfdesk-empty");
  const resultArea = document.getElementById("pdfdesk-result");

  const undoBtn = document.getElementById("pdfdesk-undo-btn");
  const redoBtn = document.getElementById("pdfdesk-redo-btn");
  const mergeSelectedBtn = document.getElementById("pdfdesk-merge-selected-btn");
  const downloadAllBtn = document.getElementById("pdfdesk-download-all-btn");
  const fullscreenBtn = document.getElementById("pdfdesk-fullscreen-btn");
  const zoomInBtn = document.getElementById("pdfdesk-zoom-in");
  const zoomOutBtn = document.getElementById("pdfdesk-zoom-out");
  const zoomLabel = document.getElementById("pdfdesk-zoom-label");

  const modal = document.getElementById("pdfdesk-modal");
  const modalBackdrop = document.getElementById("pdfdesk-modal-backdrop");
  const modalThumbRow = document.getElementById("pdfdesk-modal-thumb-row");
  const modalCancel = document.getElementById("pdfdesk-modal-cancel");
  const modalConfirm = document.getElementById("pdfdesk-modal-confirm");
  const modalSplitAll = document.getElementById("pdfdesk-modal-split-all");

  const mergeModal = document.getElementById("pdfdesk-merge-modal");
  const mergeModalBackdrop = document.getElementById("pdfdesk-merge-modal-backdrop");
  const mergePreviewRow = document.getElementById("pdfdesk-merge-preview-row");
  const mergeModalCancel = document.getElementById("pdfdesk-merge-modal-cancel");
  const mergeModalConfirm = document.getElementById("pdfdesk-merge-modal-confirm");

  const MAX_VISUAL_PAGES = 60;
  const MAX_HISTORY = 30;

  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@2.16.105/build/pdf.worker.min.js";

  let cards = [];
  let nextId = 1;
  let dragState = null;
  let selectedIds = new Set();
  let zoomLevel = 1;
  let modalCard = null;
  let modalSplitPoints = new Set();
  let modalToken = 0;
  let mergePreviewOrder = [];
  let mergePreviewToken = 0;
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

  // カードが増えても取り出せるよう、キャンバス内側の大きさを実際のカード配置に合わせて広げる
  function updateCanvasContentSize() {
    if (!cards.length) {
      innerEl.style.width = "";
      innerEl.style.height = "";
      return;
    }
    let maxX = 0;
    let maxY = 0;
    cards.forEach((c) => {
      maxX = Math.max(maxX, c.x + (c.el.offsetWidth || 152));
      maxY = Math.max(maxY, c.y + (c.el.offsetHeight || 200));
    });
    innerEl.style.width = `${maxX + 20}px`;
    innerEl.style.height = `${maxY + 20}px`;
  }

  // 画面上の座標(マウス位置など)を、拡大縮小・スクロールを考慮した実際のカード座標に変換する
  function toLogical(clientX, clientY) {
    const rect = innerEl.getBoundingClientRect();
    return { x: (clientX - rect.left) / zoomLevel, y: (clientY - rect.top) / zoomLevel };
  }

  // ---------- 拡大縮小 ----------

  function setZoom(level) {
    zoomLevel = Math.max(0.5, Math.min(2, Math.round(level * 100) / 100));
    innerEl.style.transform = `scale(${zoomLevel})`;
    zoomLabel.textContent = `${Math.round(zoomLevel * 100)}%`;
  }

  zoomInBtn.addEventListener("click", () => setZoom(zoomLevel + 0.1));
  zoomOutBtn.addEventListener("click", () => setZoom(zoomLevel - 0.1));

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

  function pushPreCapturedHistory(snapshot) {
    undoStack.push(snapshot);
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack = [];
    updateUndoRedoButtons();
  }

  function restoreSnapshot(snapshot) {
    cards.forEach((c) => c.el && c.el.remove());
    selectedIds = new Set();
    cards = snapshot.map((s) => ({ ...s, el: null }));
    cards.forEach((c) => createCardElement(c));
    updateEmptyState();
    updateSelectionUI();
    updateCanvasContentSize();
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

  // ---------- ページの描画(pdf.js) ----------

  async function renderPageThumbCanvas(bytes, maxWidth) {
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    const page = await pdf.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = maxWidth / baseViewport.width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    return canvas;
  }

  async function renderCardThumb(card) {
    const thumbHost = card.el.querySelector(".pdfdesk-card-thumb");
    thumbHost.innerHTML = "";
    try {
      thumbHost.appendChild(await renderPageThumbCanvas(card.bytes, 136));
    } catch {
      thumbHost.innerHTML = `<span style="color:red;font-size:0.75rem;">表示できません</span>`;
    }
    card.el.querySelector(".pdfdesk-card-pages").textContent = `1/${card.pageCount}`;
  }

  // ---------- 選択 ----------

  function setSelection(ids) {
    const idSet = new Set(ids);
    cards.forEach((c) => c.el.classList.toggle("selected", idSet.has(c.id)));
    selectedIds = idSet;
    updateSelectionUI();
  }

  function clearSelection() {
    setSelection([]);
  }

  function updateSelectionUI() {
    mergeSelectedBtn.disabled = selectedIds.size < 2;
  }

  // ---------- 名前の変更 ----------

  function enterRenameMode(card) {
    const nameEl = card.el.querySelector(".pdfdesk-card-name");
    if (nameEl.querySelector("input")) return;
    const oldName = card.name;
    nameEl.innerHTML = `<input type="text" class="pdfdesk-card-name-input" draggable="false">`;
    const nameInput = nameEl.querySelector("input");
    nameInput.value = oldName;
    nameInput.focus();
    nameInput.select();

    let finished = false;
    function finish(commit) {
      if (finished) return;
      finished = true;
      const newName = nameInput.value.trim();
      if (commit && newName && newName !== oldName) {
        pushHistory();
        card.name = newName;
      }
      nameEl.textContent = card.name;
    }

    nameInput.addEventListener("blur", () => finish(true));
    nameInput.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); nameInput.blur(); }
      else if (e.key === "Escape") { e.preventDefault(); finish(false); }
    });
  }

  // ---------- カードの表示 ----------

  function createCardElement(card) {
    const el = document.createElement("div");
    el.className = "pdfdesk-card";
    el.draggable = true;
    el.dataset.id = card.id;
    el.style.left = `${card.x}px`;
    el.style.top = `${card.y}px`;
    el.innerHTML = `
      <div class="pdfdesk-card-toolbar">
        <button type="button" class="pdfdesk-card-btn" data-action="rotate-left" draggable="false" title="左に90度回転" aria-label="左に90度回転">⟲</button>
        <span class="pdfdesk-card-pages">1/${card.pageCount}</span>
        <button type="button" class="pdfdesk-card-btn" data-action="rotate-right" draggable="false" title="右に90度回転" aria-label="右に90度回転">⟳</button>
      </div>
      <div class="pdfdesk-card-thumb"></div>
      <div class="pdfdesk-card-name" draggable="false" title="クリックして名前を変更">${card.name}</div>
      <div class="pdfdesk-card-actions">
        <button type="button" class="pdfdesk-card-btn" data-action="split" draggable="false">分割</button>
        <button type="button" class="pdfdesk-card-btn" data-action="download" draggable="false">保存</button>
        <button type="button" class="file-remove-btn" data-action="remove" draggable="false" aria-label="このカードを削除">${TRASH_ICON}</button>
      </div>
    `;
    card.el = el;
    innerEl.appendChild(el);

    el.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        handleCardAction(card, btn.dataset.action);
      });
    });
    el.querySelector(".pdfdesk-card-name").addEventListener("click", (e) => {
      e.stopPropagation();
      enterRenameMode(card);
    });
    el.addEventListener("click", (e) => {
      if (e.target.closest("button") || e.target.closest(".pdfdesk-card-name")) return;
      setSelection([card.id]);
    });

    attachDragHandlers(card);
    renderCardThumb(card);
    return el;
  }

  // position を渡すとその座標に配置(分割結果の少し重ねた配置用)、渡さなければ通常のカスケード配置
  function addCard({ name, bytes, pageCount }, position) {
    const pos = position || nextCascadePosition(cards.length);
    const card = { id: nextId++, name, bytes, pageCount, x: Math.max(0, pos.x), y: Math.max(0, pos.y), el: null };
    cards.push(card);
    createCardElement(card);
    updateEmptyState();
    updateCanvasContentSize();
    return card;
  }

  function removeCardSilently(card) {
    if (selectedIds.has(card.id)) {
      const next = new Set(selectedIds);
      next.delete(card.id);
      setSelection(Array.from(next));
    }
    card.el.remove();
    cards = cards.filter((c) => c.id !== card.id);
    updateEmptyState();
    updateCanvasContentSize();
  }

  // ---------- ドラッグ(パソコンのマウス専用・ネイティブドラッグ&ドロップ) ----------
  // カードのドラッグはOSのネイティブ機能を使うため、デスクトップへそのままドラッグして保存することもできる

  function attachDragHandlers(card) {
    const el = card.el;

    el.addEventListener("dragstart", (e) => {
      const cardRect = el.getBoundingClientRect();
      dragState = {
        card,
        offsetX: (e.clientX - cardRect.left) / zoomLevel,
        offsetY: (e.clientY - cardRect.top) / zoomLevel,
        preDragSnapshot: snapshotCards(),
        blobUrl: null,
      };
      el.classList.add("dragging");
      e.dataTransfer.effectAllowed = "copyMove";
      e.dataTransfer.setData("text/plain", String(card.id));
      try {
        const blobUrl = URL.createObjectURL(new Blob([card.bytes], { type: "application/pdf" }));
        dragState.blobUrl = blobUrl;
        e.dataTransfer.setData("DownloadURL", `application/pdf:${card.name}:${blobUrl}`);
      } catch {
        // DownloadURL未対応ブラウザでは通常のドラッグ移動のみになる
      }
    });

    el.addEventListener("dragend", () => {
      el.classList.remove("dragging");
      cards.forEach((c) => c.el.classList.remove("merge-target"));
      if (dragState && dragState.blobUrl) {
        const url = dragState.blobUrl;
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
      dragState = null;
    });

    el.addEventListener("dragenter", (e) => {
      if (!dragState || dragState.card.id === card.id) return;
      e.preventDefault();
      el.classList.add("merge-target");
    });

    el.addEventListener("dragover", (e) => {
      if (!dragState || dragState.card.id === card.id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });

    el.addEventListener("dragleave", () => {
      el.classList.remove("merge-target");
    });

    el.addEventListener("drop", (e) => {
      if (!dragState || dragState.card.id === card.id) return;
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove("merge-target");
      const draggedCard = dragState.card;
      pushPreCapturedHistory(dragState.preDragSnapshot);
      mergeCards(draggedCard, card);
    });
  }

  scrollEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (dragState) e.dataTransfer.dropEffect = "move";
  });

  scrollEl.addEventListener("drop", async (e) => {
    e.preventDefault();
    if (dragState) {
      const { card, offsetX, offsetY, preDragSnapshot } = dragState;
      const pos = toLogical(e.clientX, e.clientY);
      const x = Math.max(0, pos.x - offsetX);
      const y = Math.max(0, pos.y - offsetY);
      if (x !== card.x || y !== card.y) pushPreCapturedHistory(preDragSnapshot);
      card.x = x;
      card.y = y;
      card.el.style.left = `${x}px`;
      card.el.style.top = `${y}px`;
      setSelection([card.id]);
      updateCanvasContentSize();
      return;
    }
    if (e.dataTransfer.files && e.dataTransfer.files.length) {
      const files = await getFilesFromDataTransfer(e.dataTransfer);
      addCardsFromFiles(files);
    }
  });

  // ---------- 範囲選択(空いている場所をドラッグ) ----------

  let marqueeState = null;

  function rectsTouch(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  scrollEl.addEventListener("pointerdown", (e) => {
    if (e.target !== scrollEl && e.target !== innerEl) return;
    e.preventDefault();
    const pos = toLogical(e.clientX, e.clientY);
    const marqueeEl = document.createElement("div");
    marqueeEl.className = "pdfdesk-marquee";
    innerEl.appendChild(marqueeEl);
    marqueeState = { startX: pos.x, startY: pos.y, el: marqueeEl, rect: null };
    scrollEl.setPointerCapture(e.pointerId);
  });

  scrollEl.addEventListener("pointermove", (e) => {
    if (!marqueeState) return;
    const pos = toLogical(e.clientX, e.clientY);
    const x = Math.min(marqueeState.startX, pos.x);
    const y = Math.min(marqueeState.startY, pos.y);
    const w = Math.abs(pos.x - marqueeState.startX);
    const h = Math.abs(pos.y - marqueeState.startY);
    marqueeState.el.style.left = `${x}px`;
    marqueeState.el.style.top = `${y}px`;
    marqueeState.el.style.width = `${w}px`;
    marqueeState.el.style.height = `${h}px`;
    marqueeState.rect = { x, y, w, h };
  });

  scrollEl.addEventListener("pointerup", (e) => {
    if (!marqueeState) return;
    scrollEl.releasePointerCapture(e.pointerId);
    const rect = marqueeState.rect;
    marqueeState.el.remove();
    marqueeState = null;
    if (!rect || (rect.w < 3 && rect.h < 3)) {
      clearSelection();
      return;
    }
    const hits = cards.filter((c) => rectsTouch(rect, { x: c.x, y: c.y, w: c.el.offsetWidth, h: c.el.offsetHeight }));
    setSelection(hits.map((c) => c.id));
  });

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
      setSelection([targetCard.id]);
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

  function removeCards(cardList) {
    if (!cardList.length) return;
    pushHistory();
    cardList.forEach((c) => removeCardSilently(c));
  }

  function handleCardAction(card, action) {
    if (action === "rotate-left") rotateCard(card, -90);
    else if (action === "rotate-right") rotateCard(card, 90);
    else if (action === "remove") removeCard(card);
    else if (action === "download") downloadCard(card);
    else if (action === "split") openSplitModal(card);
  }

  document.addEventListener("keydown", (e) => {
    if (!isPanelVisible()) return;
    if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.size > 0) {
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      removeCards(Array.from(selectedIds).map((id) => cards.find((c) => c.id === id)).filter(Boolean));
    }
  });

  // ---------- 選択したカードをまとめて結合 ----------

  function sortByPosition(cardList) {
    return [...cardList].sort((a, b) => a.x - b.x || a.y - b.y);
  }

  mergeSelectedBtn.addEventListener("click", () => {
    const selected = cards.filter((c) => selectedIds.has(c.id));
    if (selected.length < 2) return;
    openMergePreview(selected);
  });

  async function openMergePreview(selected) {
    mergePreviewOrder = sortByPosition(selected);
    mergeModal.hidden = false;
    mergeModalConfirm.disabled = false;
    mergeModalConfirm.textContent = "この順番で結合する";
    mergePreviewRow.innerHTML = `<p>読み込み中...</p>`;
    const token = ++mergePreviewToken;
    const elements = [];
    for (let i = 0; i < mergePreviewOrder.length; i++) {
      const card = mergePreviewOrder[i];
      const wrap = document.createElement("div");
      wrap.className = "pdfsplit-thumb-card";
      try {
        wrap.appendChild(await renderPageThumbCanvas(card.bytes, 100));
      } catch {
        const span = document.createElement("span");
        span.style.color = "red";
        span.style.fontSize = "0.7rem";
        span.textContent = "表示できません";
        wrap.appendChild(span);
      }
      if (token !== mergePreviewToken) return;
      const label = document.createElement("span");
      label.className = "pdfdesk-merge-preview-label";
      label.textContent = `${i + 1}. ${card.name}`;
      wrap.appendChild(label);
      elements.push(wrap);
    }
    mergePreviewRow.innerHTML = "";
    elements.forEach((el) => mergePreviewRow.appendChild(el));
  }

  function closeMergeModal() {
    mergeModal.hidden = true;
    mergePreviewOrder = [];
    mergePreviewToken++;
  }

  mergeModalCancel.addEventListener("click", closeMergeModal);
  mergeModalBackdrop.addEventListener("click", closeMergeModal);

  mergeModalConfirm.addEventListener("click", async () => {
    if (mergePreviewOrder.length < 2) return;
    pushHistory();
    mergeModalConfirm.disabled = true;
    mergeModalConfirm.textContent = "結合中...";
    const order = mergePreviewOrder;
    try {
      const { PDFDocument } = PDFLib;
      const mergedDoc = await PDFDocument.create();
      for (const card of order) {
        const srcDoc = await PDFDocument.load(card.bytes, { ignoreEncryption: true });
        const pages = await mergedDoc.copyPages(srcDoc, srcDoc.getPageIndices());
        pages.forEach((p) => mergedDoc.addPage(p));
      }
      const primary = order[0];
      const rest = order.slice(1);
      primary.bytes = await mergedDoc.save();
      primary.pageCount = mergedDoc.getPageCount();
      rest.forEach((c) => removeCardSilently(c));
      setSelection([primary.id]);
      await renderCardThumb(primary);
      resultArea.innerHTML = `<p>${order.length}件のPDFを結合しました。</p>`;
    } catch {
      resultArea.innerHTML = `<p style="color:red;">結合に失敗しました。</p>`;
    }
    closeMergeModal();
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
      const originX = card.x;
      const originY = card.y;
      const FAN_OFFSET = 14;

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
        // 元の書類が少しずつ重なって分かれたように見えるよう、斜めにずらして配置する
        addCard(
          { name: `${baseNoExt}_${label}.pdf`, bytes, pageCount: group.length },
          { x: originX + i * FAN_OFFSET, y: originY + i * FAN_OFFSET }
        );
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
  updateSelectionUI();
  updateCanvasContentSize();
})();
