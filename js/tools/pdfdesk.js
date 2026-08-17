(() => {
  const dropzone = document.querySelector('[data-target="pdfdesk-input"]');
  const input = document.getElementById("pdfdesk-input");
  const canvasEl = document.getElementById("pdfdesk-canvas");
  const emptyMsg = document.getElementById("pdfdesk-empty");
  const resultArea = document.getElementById("pdfdesk-result");

  const modal = document.getElementById("pdfdesk-modal");
  const modalBackdrop = document.getElementById("pdfdesk-modal-backdrop");
  const modalThumbRow = document.getElementById("pdfdesk-modal-thumb-row");
  const modalCancel = document.getElementById("pdfdesk-modal-cancel");
  const modalConfirm = document.getElementById("pdfdesk-modal-confirm");

  const MAX_VISUAL_PAGES = 60;

  let cards = [];
  let nextId = 1;
  let dragState = null;
  let mergeTargetId = null;
  let modalCard = null;
  let modalSplitPoints = new Set();
  let modalToken = 0;

  function isPdfFile(file) {
    return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  }

  function updateEmptyState() {
    emptyMsg.hidden = cards.length > 0;
  }

  function nextCascadePosition(index) {
    const col = index % 5;
    const row = Math.floor(index / 5);
    return { x: 16 + col * 172, y: 16 + row * 210 };
  }

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
        <button type="button" class="pdfdesk-card-btn" data-action="split">分解</button>
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

  function removeCard(card) {
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
    card.x = x;
    card.y = y;
    card.el.style.left = `${x}px`;
    card.el.style.top = `${y}px`;
    updateMergeTarget(card);
  }

  function onDragEnd(e) {
    if (!dragState) return;
    const card = dragState.card;
    card.el.releasePointerCapture(e.pointerId);
    card.el.removeEventListener("pointermove", onDragMove);
    card.el.removeEventListener("pointerup", onDragEnd);
    card.el.removeEventListener("pointercancel", onDragEnd);
    card.el.classList.remove("dragging");
    dragState = null;

    const targetId = mergeTargetId;
    clearMergeTarget();
    if (targetId) {
      const targetCard = cards.find((c) => c.id === targetId);
      if (targetCard) mergeCards(card, targetCard);
    }
  }

  // ---------- カードの操作(回転・結合・分解・保存・削除) ----------

  async function rotateCard(card, delta) {
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

  async function mergeCards(draggedCard, targetCard) {
    resultArea.innerHTML = "";
    try {
      const { PDFDocument } = PDFLib;
      const targetDoc = await PDFDocument.load(targetCard.bytes, { ignoreEncryption: true });
      const draggedDoc = await PDFDocument.load(draggedCard.bytes, { ignoreEncryption: true });
      const newPages = await targetDoc.copyPages(draggedDoc, draggedDoc.getPageIndices());
      newPages.forEach((p) => targetDoc.addPage(p));
      targetCard.bytes = await targetDoc.save();
      targetCard.pageCount = targetDoc.getPageCount();
      removeCard(draggedCard);
      await renderCardThumb(targetCard);
      resultArea.innerHTML = `<p>「${draggedCard.name}」を「${targetCard.name}」に結合しました。</p>`;
    } catch {
      resultArea.innerHTML = `<p style="color:red;">結合に失敗しました(壊れているか、パスワード保護されている可能性があります)。</p>`;
    }
  }

  function downloadCard(card) {
    downloadFile(new File([card.bytes], card.name, { type: "application/pdf" }));
  }

  function handleCardAction(card, action) {
    if (action === "rotate-left") rotateCard(card, -90);
    else if (action === "rotate-right") rotateCard(card, 90);
    else if (action === "remove") removeCard(card);
    else if (action === "download") downloadCard(card);
    else if (action === "split") openSplitModal(card);
  }

  // ---------- 分解モーダル(ページを見ながら分ける) ----------

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
        return;
      }
      if (pageCount > MAX_VISUAL_PAGES) {
        modalThumbRow.innerHTML = `<p style="color:red;">ページ数が多いため(${MAX_VISUAL_PAGES}ページ超)、この画面では分けられません。</p>`;
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

  modalConfirm.addEventListener("click", async () => {
    if (!modalCard || !modalSplitPoints.size) return;
    const card = modalCard;
    modalConfirm.disabled = true;
    modalConfirm.textContent = "分けています...";

    try {
      const { PDFDocument } = PDFLib;
      const srcDoc = await PDFDocument.load(card.bytes, { ignoreEncryption: true });
      const pageCount = srcDoc.getPageCount();
      const sorted = Array.from(modalSplitPoints).sort((a, b) => a - b);
      const boundaries = [0, ...sorted, pageCount];
      const baseNoExt = card.name.replace(/\.pdf$/i, "");
      const originIndex = cards.findIndex((c) => c.id === card.id);

      removeCard(card);

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
})();
