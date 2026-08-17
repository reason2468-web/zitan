(() => {
  const dropzone = document.querySelector('[data-target="convert-input"]');
  const input = document.getElementById("convert-input");
  const folderInput = document.getElementById("convert-folder-input");
  const formatSelect = document.getElementById("convert-format");
  const runBtn = document.getElementById("convert-run");
  const resultArea = document.getElementById("convert-result");
  const listEl = document.getElementById("convert-list");

  let currentFiles = [];

  async function loadFiles(fileList) {
    const newFiles = await loadImageFiles(fileList, { resultArea, listEl });
    currentFiles = currentFiles.concat(newFiles);
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
    return "jpg";
  }

  runBtn.addEventListener("click", async () => {
    if (!currentFiles.length) return;
    runBtn.disabled = true;
    runBtn.textContent = "変換中...";
    listEl.innerHTML = "";
    resultArea.innerHTML = "";

    const targetType = formatSelect.value;
    const targetLabel = targetType.replace("image/", "").toUpperCase();
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
      const saveResult = await saveProcessedFiles(results, { category: "画像", tool: "変換" }, currentFiles.length > 1);
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
