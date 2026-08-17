(() => {
  const dropzone = document.querySelector('[data-target="pdfsplit-input"]');
  const input = document.getElementById("pdfsplit-input");
  const selectResult = document.getElementById("pdfsplit-select-result");
  const everyRow = document.getElementById("pdfsplit-every-row");
  const everyInput = document.getElementById("pdfsplit-every");
  const runBtn = document.getElementById("pdfsplit-run");
  const listEl = document.getElementById("pdfsplit-list");
  const resultArea = document.getElementById("pdfsplit-result");

  let currentFiles = [];

  function isPdfFile(file) {
    return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  }

  // 画像用のbuildSelectedFilesPreviewはサムネイル前提のため、PDF用に同じ見た目の一覧を個別に組み立てる
  function renderSelectList() {
    if (!currentFiles.length) {
      selectResult.innerHTML = "";
      runBtn.disabled = true;
      return;
    }
    const maxShow = 10;
    const shown = currentFiles.slice(0, maxShow);
    const remaining = currentFiles.length - shown.length;
    const items = shown.map((f, i) => `
      <li data-index="${i}">
        <button type="button" class="file-remove-btn" data-index="${i}" aria-label="このファイルを削除">${TRASH_ICON}</button>
        <span class="file-name">${f.name}</span>
        <span class="file-size">${formatBytes(f.size)}</span>
      </li>
    `).join("");
    const moreItem = remaining > 0 ? `<li class="file-list-more">ほか${remaining}件</li>` : "";
    selectResult.innerHTML = `
      <div class="selected-file-header">
        <p>${currentFiles.length}件のPDFを選択中</p>
        <button type="button" class="clear-all-btn">すべて削除</button>
      </div>
      <ul class="selected-file-list">${items}${moreItem}</ul>
    `;
    selectResult.querySelectorAll(".file-remove-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.index);
        currentFiles = currentFiles.slice(0, idx).concat(currentFiles.slice(idx + 1));
        renderSelectList();
      });
    });
    const clearBtn = selectResult.querySelector(".clear-all-btn");
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        currentFiles = [];
        renderSelectList();
      });
    }
    runBtn.disabled = false;
  }

  function loadFiles(fileList) {
    const allFiles = Array.from(fileList);
    const pdfFiles = allFiles.filter(isPdfFile);
    if (!pdfFiles.length) {
      resultArea.innerHTML = `<p style="color:red;">PDFファイルが見つかりませんでした。</p>`;
      return;
    }
    resultArea.innerHTML = "";
    currentFiles = mergeUniqueFiles(currentFiles, pdfFiles);
    renderSelectList();
  }

  setupDropzone(dropzone, input, loadFiles);

  function updateModeVisibility() {
    const mode = document.querySelector('input[name="pdfsplit-mode"]:checked').value;
    everyRow.hidden = mode !== "every";
  }
  document.querySelectorAll('input[name="pdfsplit-mode"]').forEach((radio) => {
    radio.addEventListener("change", updateModeVisibility);
  });
  updateModeVisibility();

  runBtn.addEventListener("click", async () => {
    if (!currentFiles.length) return;
    const mode = document.querySelector('input[name="pdfsplit-mode"]:checked').value;
    const every = Math.max(1, Math.floor(Number(everyInput.value)) || 1);

    runBtn.disabled = true;
    runBtn.textContent = "分割中...";
    listEl.innerHTML = "";
    resultArea.innerHTML = "";

    const { PDFDocument } = PDFLib;
    const results = [];

    for (const file of currentFiles) {
      const li = document.createElement("li");
      li.innerHTML = `<span>${file.name}</span><span>処理中...</span>`;
      listEl.appendChild(li);

      try {
        const bytes = await file.arrayBuffer();
        const srcDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pageCount = srcDoc.getPageCount();
        const baseNoExt = file.name.replace(/\.pdf$/i, "");

        const groups = [];
        if (mode === "single") {
          for (let i = 0; i < pageCount; i++) groups.push([i]);
        } else {
          for (let i = 0; i < pageCount; i += every) {
            const group = [];
            for (let j = i; j < Math.min(i + every, pageCount); j++) group.push(j);
            groups.push(group);
          }
        }

        for (const group of groups) {
          const newDoc = await PDFDocument.create();
          const pages = await newDoc.copyPages(srcDoc, group);
          pages.forEach((p) => newDoc.addPage(p));
          const outBytes = await newDoc.save();
          const start = group[0] + 1;
          const end = group[group.length - 1] + 1;
          const pageLabel = start === end ? `p${start}` : `p${start}-${end}`;
          results.push(new File([outBytes], `${baseNoExt}_${pageLabel}.pdf`, { type: "application/pdf" }));
        }

        li.innerHTML = `<span>${file.name}</span><span>${groups.length}個のファイルに分割(全${pageCount}ページ)</span>`;
      } catch {
        li.innerHTML = `<span>${file.name}</span><span style="color:red;">失敗(壊れているか、パスワード保護されている可能性があります)</span>`;
      }
    }

    if (results.length) {
      const modeLabel = mode === "single" ? "1ページずつ" : `${every}ページごと`;
      const saveResult = await saveProcessedFiles(results, { category: "PDF", tool: `分割.${modeLabel}` }, currentFiles.length > 1);
      const savedMsg = saveResult === "folder" ? "指定したフォルダに保存しました。" : "ダウンロードしました。";
      resultArea.innerHTML = `
        <div class="result-card">
          <div class="result-info">
            <p>${results.length}件のファイルに分割しました。</p>
            <p>${savedMsg}</p>
          </div>
        </div>
      `;
    } else {
      resultArea.innerHTML = `<p style="color:red;">分割できたファイルがありませんでした。</p>`;
    }

    runBtn.disabled = currentFiles.length === 0;
    runBtn.textContent = "分割してダウンロード";
  });
})();
