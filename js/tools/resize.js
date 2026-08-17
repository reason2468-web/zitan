(() => {
  const dropzone = document.querySelector('[data-target="resize-input"]');
  const input = document.getElementById("resize-input");
  const folderInput = document.getElementById("resize-folder-input");
  const widthInput = document.getElementById("resize-width");
  const presetBtns = document.querySelectorAll("#resize .preset-btn");
  const presetRow = document.getElementById("resize-preset-row");
  const customRow = document.getElementById("resize-custom-row");
  const runBtn = document.getElementById("resize-run");
  const resultArea = document.getElementById("resize-result");
  const listEl = document.getElementById("resize-list");

  let currentFiles = [];

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

  presetBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      presetBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      widthInput.value = btn.dataset.width;
    });
  });

  function updateResizeModeVisibility() {
    const mode = document.querySelector('input[name="resize-mode"]:checked').value;
    presetRow.hidden = mode !== "preset";
    customRow.hidden = mode !== "custom";
  }

  document.querySelectorAll('input[name="resize-mode"]').forEach((radio) => {
    radio.addEventListener("change", updateResizeModeVisibility);
  });
  updateResizeModeVisibility();

  function loadImageElement(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  runBtn.addEventListener("click", async () => {
    if (!currentFiles.length) return;
    const maxWidth = Number(widthInput.value);
    if (!maxWidth || maxWidth < 1) return;

    runBtn.disabled = true;
    runBtn.textContent = "リサイズ中...";
    listEl.innerHTML = "";
    resultArea.innerHTML = "";

    const results = [];
    const skipped = [];

    for (const file of currentFiles) {
      const li = document.createElement("li");
      li.innerHTML = `<span>${file.name}</span><span>処理中...</span>`;
      listEl.appendChild(li);

      try {
        const img = await loadImageElement(file);

        if (img.naturalWidth <= maxWidth) {
          skipped.push(file.name);
          li.innerHTML = `<span>${file.name}</span><span>対応済み(すでに${maxWidth}px以下)</span>`;
          continue;
        }

        const scale = maxWidth / img.naturalWidth;
        const canvas = document.createElement("canvas");
        canvas.width = maxWidth;
        canvas.height = Math.round(img.naturalHeight * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const mimeType = normalizeImageType(file.type) || "image/jpeg";
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, mimeType, 0.92));
        const resized = new File([blob], file.name, { type: mimeType });
        results.push(resized);
        li.innerHTML = `<span>${file.name}</span><span>${img.naturalWidth}×${img.naturalHeight} → ${canvas.width}×${canvas.height}</span>`;
      } catch (err) {
        li.innerHTML = `<span>${file.name}</span><span style="color:red;">失敗</span>`;
      }
    }

    const skippedNotice = skipped.length
      ? `
        <div class="result-card result-notice">
          <div class="result-info">
            <p>${skipped.length}件は、すでに指定サイズに収まっているため、そのままで完了しています。</p>
            <p class="format-note">${skipped.join("、")}</p>
          </div>
        </div>
      `
      : "";

    if (results.length) {
      const mode = document.querySelector('input[name="resize-mode"]:checked').value;
      const detail = mode === "preset"
        ? document.querySelector("#resize .preset-btn.active")?.textContent || ""
        : `横幅${maxWidth}px`;
      const toolLabel = detail ? `リサイズ.${detail}` : "リサイズ";
      const saveResult = await saveProcessedFiles(results, { category: "画像", tool: toolLabel }, currentFiles.length > 1);
      const savedMsg = saveResult === "folder" ? "指定したフォルダに保存しました。" : "ダウンロードしました。";
      resultArea.innerHTML = `
        ${skippedNotice}
        <div class="result-card">
          <div class="result-info">
            <p>${results.length}件をリサイズしました。</p>
            <p>${savedMsg}</p>
          </div>
        </div>
      `;
    } else if (skipped.length) {
      resultArea.innerHTML = skippedNotice;
    } else {
      resultArea.innerHTML = `<p style="color:red;">リサイズできたファイルがありませんでした。</p>`;
    }

    runBtn.disabled = false;
    runBtn.textContent = "リサイズする";
  });
})();
