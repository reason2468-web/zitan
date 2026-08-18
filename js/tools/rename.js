(() => {
  const downloadControls = document.getElementById("rename-download-controls");
  const folderControls = document.getElementById("rename-folder-controls");
  const dropzone = document.querySelector('[data-target="rename-input"]');
  const input = document.getElementById("rename-input");
  const folderPickBtn = document.getElementById("rename-folder-pick");
  const folderUnsupportedNote = document.getElementById("rename-folder-unsupported");

  const rulesArea = document.getElementById("rename-rules");
  const baseInput = document.getElementById("rename-base");
  const findInput = document.getElementById("rename-find");
  const replaceInput = document.getElementById("rename-replace");
  const prefixInput = document.getElementById("rename-prefix");
  const suffixInput = document.getElementById("rename-suffix");
  const prefixDateBtn = document.getElementById("rename-prefix-date");
  const suffixDateBtn = document.getElementById("rename-suffix-date");
  const numberOptions = document.getElementById("rename-number-options");
  const numberPositionRow = document.getElementById("rename-number-position-row");
  const numberStartInput = document.getElementById("rename-number-start");
  const numberDigitsInput = document.getElementById("rename-number-digits");

  const previewList = document.getElementById("rename-preview");
  const warningEl = document.getElementById("rename-warning");
  const runBtn = document.getElementById("rename-run");
  const resultArea = document.getElementById("rename-result");
  const listEl = document.getElementById("rename-list");

  let currentFiles = []; // [{ name, ref }] ref: File(ダウンロードモード) または FileSystemFileHandle(フォルダモード)
  let dirHandle = null;

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[ch]);
  }

  function getMode() {
    const checked = document.querySelector('input[name="rename-mode"]:checked');
    return checked ? checked.value : "download";
  }

  function getNumberEnabled() {
    const checked = document.querySelector('input[name="rename-number-mode"]:checked');
    return checked ? checked.value === "on" : false;
  }

  function getNumberPosition() {
    const checked = document.querySelector('input[name="rename-number-position"]:checked');
    return checked ? checked.value : "suffix";
  }

  function todayDateString() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  prefixDateBtn.addEventListener("click", () => {
    prefixInput.value = `${todayDateString()}_`;
    updatePreview();
  });
  suffixDateBtn.addEventListener("click", () => {
    suffixInput.value = `_${todayDateString()}`;
    updatePreview();
  });

  // ---------- モード切り替え ----------

  function resetFiles() {
    currentFiles = [];
    dirHandle = null;
    resultArea.innerHTML = "";
    rulesArea.hidden = true;
    previewList.innerHTML = "";
    warningEl.textContent = "";
    runBtn.disabled = true;
  }

  document.querySelectorAll('input[name="rename-mode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      const mode = getMode();
      downloadControls.hidden = mode !== "download";
      folderControls.hidden = mode !== "folder";
      resetFiles();

      if (mode === "folder" && !supportsFolderSave()) {
        folderUnsupportedNote.hidden = false;
        folderPickBtn.disabled = true;
      } else {
        folderUnsupportedNote.hidden = true;
        folderPickBtn.disabled = false;
      }
    });
  });

  // ---------- ①ファイルを選んで名前を変更する(ダウンロード) ----------

  async function loadDownloadFiles(fileList) {
    const files = Array.from(fileList);
    if (!files.length) return;
    const seen = new Set(currentFiles.map((f) => `${f.name}::${f.ref.size}::${f.ref.lastModified}`));
    files.forEach((file) => {
      const key = `${file.name}::${file.size}::${file.lastModified}`;
      if (seen.has(key)) return;
      seen.add(key);
      currentFiles.push({ name: file.name, ref: file });
    });
    renderFileList();
    updatePreview();
  }

  setupDropzone(dropzone, input, loadDownloadFiles);

  // ---------- ②フォルダを選んで直接名前を変更する ----------

  folderPickBtn.addEventListener("click", async () => {
    if (!supportsFolderSave()) return;
    try {
      dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    } catch (err) {
      return; // ユーザーが選択をキャンセルした場合
    }
    currentFiles = [];
    for await (const [name, handle] of dirHandle.entries()) {
      if (handle.kind === "file") currentFiles.push({ name, ref: handle });
    }
    currentFiles.sort((a, b) => a.name.localeCompare(b.name, "ja"));
    renderFileList();
    updatePreview();
  });

  // ---------- 選択中ファイルの表示 ----------

  function buildFileListPreview(files) {
    const maxShow = 10;
    const shown = files.slice(0, maxShow);
    const remaining = files.length - shown.length;
    const items = shown.map((f, i) => {
      const sizeLabel = f.ref instanceof File ? `<span class="file-size">${formatBytes(f.ref.size)}</span>` : "";
      return `
        <li data-index="${i}">
          <button type="button" class="file-remove-btn" data-index="${i}" aria-label="このファイルを削除">${TRASH_ICON}</button>
          <span class="file-thumb pdf-file-icon" aria-hidden="true">📄</span>
          <span class="file-name">${escapeHtml(f.name)}</span>
          ${sizeLabel}
        </li>
      `;
    }).join("");
    const moreItem = remaining > 0 ? `<li class="file-list-more">ほか${remaining}件</li>` : "";
    return `
      <div class="selected-file-header">
        <p>${files.length}件のファイルを選択中</p>
        <button type="button" class="clear-all-btn">すべて削除</button>
      </div>
      <ul class="selected-file-list">${items}${moreItem}</ul>
    `;
  }

  function renderFileList() {
    rulesArea.hidden = currentFiles.length === 0;
    if (!currentFiles.length) {
      resultArea.innerHTML = "";
      return;
    }
    resultArea.innerHTML = buildFileListPreview(currentFiles);
    resultArea.querySelectorAll(".file-remove-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.index);
        currentFiles = currentFiles.slice(0, idx).concat(currentFiles.slice(idx + 1));
        renderFileList();
        updatePreview();
      });
    });
    const clearBtn = resultArea.querySelector(".clear-all-btn");
    if (clearBtn) clearBtn.addEventListener("click", resetFiles);
  }

  // ---------- リネームルール ----------

  function splitNameExt(name) {
    const dotIdx = name.lastIndexOf(".");
    if (dotIdx <= 0) return { base: name, ext: "" };
    return { base: name.slice(0, dotIdx), ext: name.slice(dotIdx) };
  }

  function computeNewName(originalName, index, opts) {
    const { base: originalBase, ext } = splitNameExt(originalName);
    let base = opts.baseName ? opts.baseName : originalBase;

    if (opts.findText) {
      base = base.split(opts.findText).join(opts.replaceText);
    }

    base = `${opts.prefix}${base}${opts.suffix}`;

    if (opts.numberEnabled) {
      const num = String(opts.numberStart + index).padStart(opts.numberDigits, "0");
      base = opts.numberPosition === "prefix" ? `${num}${base}` : `${base}${num}`;
    }

    return `${base}${ext}`;
  }

  function getRuleOptions() {
    return {
      baseName: baseInput.value.trim(),
      findText: findInput.value,
      replaceText: replaceInput.value,
      prefix: prefixInput.value,
      suffix: suffixInput.value,
      numberEnabled: getNumberEnabled(),
      numberStart: Math.max(0, Number(numberStartInput.value) || 0),
      numberDigits: Math.min(6, Math.max(1, Number(numberDigitsInput.value) || 1)),
      numberPosition: getNumberPosition(),
    };
  }

  function computeAllNewNames() {
    const opts = getRuleOptions();
    return currentFiles.map((f, i) => ({
      oldName: f.name,
      newName: computeNewName(f.name, i, opts),
    }));
  }

  function updatePreview() {
    if (!currentFiles.length) {
      previewList.innerHTML = "";
      warningEl.textContent = "";
      runBtn.disabled = true;
      return;
    }
    const renames = computeAllNewNames();

    const maxShow = 8;
    const shown = renames.slice(0, maxShow);
    const items = shown.map((r) => `<li><span>${escapeHtml(r.oldName)}</span><span>→ ${escapeHtml(r.newName)}</span></li>`).join("");
    const moreItem = renames.length > maxShow ? `<li class="file-list-more">ほか${renames.length - maxShow}件</li>` : "";
    previewList.innerHTML = items + moreItem;

    // 結果の名前が重複していないか確認する(重複すると上書き・消失の原因になるため)
    const nameCounts = new Map();
    renames.forEach((r) => nameCounts.set(r.newName, (nameCounts.get(r.newName) || 0) + 1));
    const duplicates = [...nameCounts.entries()].filter(([, c]) => c > 1).map(([name]) => name);

    if (duplicates.length) {
      warningEl.textContent = `同じ名前になってしまうファイルがあります(${duplicates.slice(0, 5).join("、")})。ルールを調整してください。`;
      runBtn.disabled = true;
    } else {
      warningEl.textContent = "";
      runBtn.disabled = false;
    }
  }

  [baseInput, findInput, replaceInput, prefixInput, suffixInput, numberStartInput, numberDigitsInput].forEach((el) => {
    el.addEventListener("input", updatePreview);
  });

  document.querySelectorAll('input[name="rename-number-mode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      const enabled = getNumberEnabled();
      numberOptions.hidden = !enabled;
      numberPositionRow.hidden = !enabled;
      updatePreview();
    });
  });

  document.querySelectorAll('input[name="rename-number-position"]').forEach((radio) => {
    radio.addEventListener("change", updatePreview);
  });

  // ---------- 実行:ダウンロード ----------

  async function runDownloadRename(renames) {
    runBtn.disabled = true;
    runBtn.textContent = "名前を変更中...";
    listEl.innerHTML = "";

    const results = currentFiles.map((f, i) => {
      const { newName } = renames[i];
      const li = document.createElement("li");
      li.innerHTML = `<span>${escapeHtml(f.name)}</span><span>→ ${escapeHtml(newName)}</span>`;
      listEl.appendChild(li);
      return new File([f.ref], newName, { type: f.ref.type, lastModified: f.ref.lastModified });
    });

    const saveResult = await saveProcessedFiles(results, { category: "その他", tool: "リネーム" }, results.length > 1);
    const savedMsg = saveResult === "folder" ? "指定したフォルダに保存しました。" : "ダウンロードしました。";
    resultArea.innerHTML = `
      <div class="result-card">
        <div class="result-info">
          <p>${results.length}件の名前を変更しました。</p>
          <p>${savedMsg}</p>
        </div>
      </div>
    `;

    runBtn.disabled = false;
    runBtn.textContent = "名前を変更する";
  }

  // ---------- 実行:フォルダ内で直接変更 ----------

  async function runFolderRename(renames) {
    runBtn.disabled = true;
    runBtn.textContent = "名前を変更中...";
    listEl.innerHTML = "";

    let okCount = 0;
    let errorCount = 0;

    for (let i = 0; i < currentFiles.length; i++) {
      const { oldName, newName } = renames[i];
      const li = document.createElement("li");

      if (oldName === newName) {
        li.innerHTML = `<span>${escapeHtml(oldName)}</span><span>変更なし</span>`;
        listEl.appendChild(li);
        continue;
      }

      li.innerHTML = `<span>${escapeHtml(oldName)}</span><span>処理中...</span>`;
      listEl.appendChild(li);

      try {
        const handle = currentFiles[i].ref;
        const file = await handle.getFile();
        const buf = await file.arrayBuffer();
        const newHandle = await dirHandle.getFileHandle(newName, { create: true });
        const writable = await newHandle.createWritable();
        await writable.write(buf);
        await writable.close();
        await dirHandle.removeEntry(oldName);
        li.innerHTML = `<span>${escapeHtml(oldName)}</span><span>→ ${escapeHtml(newName)}</span>`;
        okCount++;
      } catch (err) {
        li.innerHTML = `<span>${escapeHtml(oldName)}</span><span style="color:red;">失敗</span>`;
        errorCount++;
      }
    }

    resultArea.innerHTML = `
      <div class="result-card">
        <div class="result-info">
          <p>${okCount}件の名前を変更しました。${errorCount ? `(${errorCount}件は失敗しました)` : ""}</p>
        </div>
      </div>
    `;

    // フォルダの中身が変わったので、もう一度フォルダを選び直すまで実行できないようにする
    resetFiles();

    runBtn.disabled = false;
    runBtn.textContent = "名前を変更する";
  }

  runBtn.addEventListener("click", async () => {
    if (!currentFiles.length) return;
    const renames = computeAllNewNames();
    const mode = getMode();

    if (mode === "folder") {
      const changedCount = renames.filter((r) => r.oldName !== r.newName).length;
      if (!changedCount) {
        resultArea.innerHTML = `<p>変更されるファイルがありません。</p>`;
        return;
      }
      if (!confirm(`${changedCount}件のファイルの名前を、選んだフォルダ内で直接書き換えます(元には戻せません)。実行しますか?`)) return;
      await runFolderRename(renames);
    } else {
      await runDownloadRename(renames);
    }
  });
})();
