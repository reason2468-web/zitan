(() => {
  const dropzone = document.querySelector('[data-target="compress-input"]');
  const input = document.getElementById("compress-input");
  const folderInput = document.getElementById("compress-folder-input");
  const targetSizeRow = document.getElementById("target-size-row");
  const targetKbSlider = document.getElementById("target-kb");
  const targetKbVal = document.getElementById("target-kb-val");
  const targetKbMinus = document.getElementById("target-kb-minus");
  const targetKbPlus = document.getElementById("target-kb-plus");
  const runBtn = document.getElementById("compress-run");
  const resultArea = document.getElementById("compress-result");
  const listEl = document.getElementById("compress-list");

  let currentFiles = [];

  document.querySelectorAll('input[name="compress-quality-mode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      targetSizeRow.hidden = radio.value !== "target";
    });
  });

  targetKbSlider.addEventListener("input", () => {
    targetKbVal.textContent = targetKbSlider.value;
  });

  function stepTargetKb(delta) {
    const min = Number(targetKbSlider.min);
    const max = Number(targetKbSlider.max);
    const next = Math.min(max, Math.max(min, Number(targetKbSlider.value) + delta));
    targetKbSlider.value = next;
    targetKbVal.textContent = next;
  }

  targetKbMinus.addEventListener("click", () => stepTargetKb(-50));
  targetKbPlus.addEventListener("click", () => stepTargetKb(50));

  function isHeic(file) {
    return file.type === "image/heic" || file.type === "image/heif" || /\.(heic|heif)$/i.test(file.name);
  }

  function isImageFile(file) {
    return file.type.startsWith("image/") || isHeic(file);
  }

  async function toCompressibleFile(file) {
    if (!isHeic(file)) return file;
    const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    return new File([blob], file.name.replace(/\.(heic|heif)$/i, ".jpg"), { type: "image/jpeg" });
  }

  async function loadFiles(fileList) {
    const allFiles = Array.from(fileList);
    const imageFiles = allFiles.filter(isImageFile);
    if (!imageFiles.length) {
      if (!allFiles.length) {
        resultArea.innerHTML = `<p style="color:red;">フォルダの中身を読み取れませんでした。お手数ですが「フォルダを選択」ボタンからお試しください。</p>`;
      } else {
        resultArea.innerHTML = `<p style="color:red;">画像ファイルが見つかりませんでした。(${allFiles.length}件のファイルを検出しましたが、対応する画像形式ではありませんでした)</p>`;
      }
      return;
    }

    runBtn.disabled = true;
    listEl.innerHTML = "";
    resultArea.innerHTML = `<p>読み込み中...(${imageFiles.length}件)</p>`;

    const converted = [];
    for (const file of imageFiles) {
      try {
        converted.push(await toCompressibleFile(file));
      } catch (err) {
        // 変換できないファイルはスキップ
      }
    }

    currentFiles = converted;
    runBtn.disabled = currentFiles.length === 0;
    resultArea.innerHTML = `<p>${currentFiles.length}件の画像を選択中</p>`;
  }

  setupDropzone(dropzone, input, loadFiles);
  folderInput.addEventListener("change", () => {
    if (folderInput.files.length) loadFiles(folderInput.files);
  });

  runBtn.addEventListener("click", async () => {
    if (!currentFiles.length) return;
    runBtn.disabled = true;
    runBtn.textContent = "圧縮中...";
    listEl.innerHTML = "";
    resultArea.innerHTML = "";

    const mode = document.querySelector('input[name="compress-quality-mode"]:checked').value;
    const targetKB = Number(targetKbSlider.value);

    const results = [];
    let totalBefore = 0;
    let totalAfter = 0;

    for (const file of currentFiles) {
      const li = document.createElement("li");
      li.innerHTML = `<span>${file.name}</span><span>処理中...</span>`;
      listEl.appendChild(li);

      try {
        const options = { useWebWorker: true };
        if (mode === "target") {
          options.maxSizeMB = targetKB / 1024;
        } else {
          options.initialQuality = 0.8;
        }
        const compressed = await imageCompression(file, options);
        results.push(compressed);
        totalBefore += file.size;
        totalAfter += compressed.size;
        const reduction = Math.round((1 - compressed.size / file.size) * 100);
        li.innerHTML = `<span>${file.name}</span><span>${formatBytes(file.size)} → ${formatBytes(compressed.size)}(${reduction > 0 ? "-" + reduction : reduction}%)</span>`;
      } catch (err) {
        li.innerHTML = `<span>${file.name}</span><span style="color:red;">失敗</span>`;
      }
    }

    if (results.length) {
      const saveResult = await saveProcessedFiles(results, { category: "画像", tool: "圧縮" });
      const savedMsg = saveResult === "folder" ? "指定したフォルダに保存しました。" : "ダウンロードしました。";
      const reduction = Math.round((1 - totalAfter / totalBefore) * 100);
      resultArea.innerHTML = `
        <div class="result-card">
          <div class="result-info">
            <p>${results.length}件を圧縮:${formatBytes(totalBefore)} → ${formatBytes(totalAfter)}
              <span class="reduction">(${reduction > 0 ? "-" + reduction : reduction}%)</span>
            </p>
            <p>${savedMsg}</p>
          </div>
        </div>
      `;
    } else {
      resultArea.innerHTML = `<p style="color:red;">圧縮できたファイルがありませんでした。</p>`;
    }

    runBtn.disabled = false;
    runBtn.textContent = "圧縮する";
  });
})();
