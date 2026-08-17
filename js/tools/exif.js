(() => {
  const dropzone = document.querySelector('[data-target="exif-input"]');
  const input = document.getElementById("exif-input");
  const folderInput = document.getElementById("exif-folder-input");
  const runBtn = document.getElementById("exif-run");
  const resultArea = document.getElementById("exif-result");
  const listEl = document.getElementById("exif-list");
  const previewArea = document.getElementById("exif-preview-area");

  let currentFiles = [];

  function formatExifDate(date) {
    if (!(date instanceof Date) || isNaN(date)) return String(date);
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  async function describeExifFacts(file) {
    let tags;
    try {
      tags = await exifr.parse(file, { gps: true });
    } catch (err) {
      tags = null;
    }
    if (!tags) return [];

    const facts = [];
    const dateTime = tags.DateTimeOriginal || tags.CreateDate || tags.ModifyDate;
    if (dateTime) facts.push(`📅 撮影日時: ${formatExifDate(dateTime)}`);
    if (typeof tags.latitude === "number" && typeof tags.longitude === "number") {
      facts.push(`📍 位置情報(GPS): 緯度${tags.latitude.toFixed(4)}, 経度${tags.longitude.toFixed(4)}`);
    }
    const camera = [tags.Make, tags.Model].filter(Boolean).join(" ");
    if (camera) facts.push(`📷 撮影機種: ${camera}`);
    if (tags.Software) facts.push(`🖥️ 使用ソフト: ${tags.Software}`);
    return facts;
  }

  async function showExifPreview(files) {
    const maxShow = 10;
    const shown = files.slice(0, maxShow);
    previewArea.innerHTML = `<p>写真に含まれている情報を確認中...</p>`;

    const rows = await Promise.all(shown.map(async (file) => {
      const facts = await describeExifFacts(file);
      const body = facts.length
        ? `<ul class="exif-fact-list">${facts.map((f) => `<li>${f}</li>`).join("")}</ul>`
        : `<p class="exif-none">検出された情報はありません</p>`;
      return `<li><strong>${file.name}</strong>${body}</li>`;
    }));

    const remaining = files.length - shown.length;
    const moreNote = remaining > 0 ? `<p class="format-note">ほか${remaining}件は表示を省略しています</p>` : "";

    previewArea.innerHTML = `
      <div class="exif-preview">
        <h4>アップロードした写真に含まれていた情報</h4>
        <ul class="exif-file-list">${rows.join("")}</ul>
        ${moreNote}
      </div>
    `;
  }

  async function loadFiles(fileList) {
    const newFiles = await loadImageFiles(fileList, { resultArea, listEl });
    currentFiles = currentFiles.concat(newFiles);
    runBtn.disabled = currentFiles.length === 0;
    if (currentFiles.length) {
      renderSelectedFiles(resultArea, currentFiles, async (updated) => {
        currentFiles = updated;
        runBtn.disabled = currentFiles.length === 0;
        if (currentFiles.length) {
          await showExifPreview(currentFiles);
        } else {
          previewArea.innerHTML = "";
        }
      });
      await showExifPreview(currentFiles);
    } else {
      previewArea.innerHTML = "";
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

  runBtn.addEventListener("click", async () => {
    if (!currentFiles.length) return;
    runBtn.disabled = true;
    runBtn.textContent = "削除中...";
    listEl.innerHTML = "";
    resultArea.innerHTML = "";

    const results = [];

    for (const file of currentFiles) {
      const li = document.createElement("li");
      li.innerHTML = `<span>${file.name}</span><span>処理中...</span>`;
      listEl.appendChild(li);

      try {
        const img = await loadImageElement(file);
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        // Canvasに描き直して書き出すだけで、Exif(撮影日時・GPS位置情報など)は自動的に失われる
        ctx.drawImage(img, 0, 0);

        const mimeType = normalizeImageType(file.type) || "image/jpeg";
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, mimeType, 0.95));
        const cleaned = new File([blob], file.name, { type: mimeType });
        results.push(cleaned);
        li.innerHTML = `<span>${file.name}</span><span>撮影情報を削除しました</span>`;
      } catch (err) {
        li.innerHTML = `<span>${file.name}</span><span style="color:red;">失敗</span>`;
      }
    }

    if (results.length) {
      const saveResult = await saveProcessedFiles(
        results,
        { category: "画像", tool: "Exif削除" },
        currentFiles.length > 1
      );
      const savedMsg = saveResult === "folder" ? "指定したフォルダに保存しました。" : "ダウンロードしました。";
      resultArea.innerHTML = `
        <div class="result-card">
          <div class="result-info">
            <p>${results.length}件から撮影日時・位置情報などを削除しました。</p>
            <p>${savedMsg}</p>
          </div>
        </div>
      `;
    } else {
      resultArea.innerHTML = `<p style="color:red;">処理できたファイルがありませんでした。</p>`;
    }

    runBtn.disabled = false;
    runBtn.textContent = "Exifを削除する";
  });
})();
