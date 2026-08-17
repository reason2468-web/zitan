(() => {
  const dropzone = document.querySelector('[data-target="colorpicker-input"]');
  const input = document.getElementById("colorpicker-input");
  const resultArea = document.getElementById("colorpicker-result");
  const layout = document.getElementById("colorpicker-layout");
  const canvas = document.getElementById("colorpicker-canvas");
  const paletteRow = document.getElementById("colorpicker-palette-row");
  const pickedCard = document.getElementById("colorpicker-picked-card");
  const pickedSwatch = document.getElementById("colorpicker-picked-swatch");
  const pickedHex = document.getElementById("colorpicker-picked-hex");
  const pickedRgb = document.getElementById("colorpicker-picked-rgb");
  const copyBtn = document.getElementById("colorpicker-copy-btn");
  const eyedropperBtn = document.getElementById("colorpicker-eyedropper-btn");
  const eyedropperNote = document.getElementById("colorpicker-eyedropper-note");
  const screenControls = document.getElementById("cp-screen-controls");
  const imageControls = document.getElementById("cp-image-controls");

  let currentHex = "#000000";

  document.querySelectorAll('input[name="colorpicker-mode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      const mode = document.querySelector('input[name="colorpicker-mode"]:checked').value;
      screenControls.hidden = mode !== "screen";
      imageControls.hidden = mode !== "image";
    });
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

  function rgbToHex(r, g, b) {
    return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("").toUpperCase();
  }

  function hexToRgb(hex) {
    const clean = hex.replace("#", "");
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
    ];
  }

  function extractPalette(w, h, count = 8) {
    const maxDim = 100;
    const scale = Math.min(1, maxDim / Math.max(w, h));
    const sw = Math.max(1, Math.round(w * scale));
    const sh = Math.max(1, Math.round(h * scale));
    const sampleCanvas = document.createElement("canvas");
    sampleCanvas.width = sw;
    sampleCanvas.height = sh;
    const sctx = sampleCanvas.getContext("2d");
    sctx.drawImage(canvas, 0, 0, w, h, 0, 0, sw, sh);
    const { data } = sctx.getImageData(0, 0, sw, sh);

    const counts = new Map();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const r = Math.round(data[i] / 16) * 16;
      const g = Math.round(data[i + 1] / 16) * 16;
      const b = Math.round(data[i + 2] / 16) * 16;
      const key = `${r},${g},${b}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, count)
      .map(([key]) => {
        const [r, g, b] = key.split(",").map(Number);
        return rgbToHex(r, g, b);
      });
  }

  function buildSwatch(hex) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "color-swatch";
    btn.dataset.hex = hex;
    btn.innerHTML = `
      <span class="color-swatch-fill" style="background:${hex};"></span>
      <span class="color-swatch-hex">${hex}</span>
    `;
    btn.addEventListener("click", () => copyHex(hex, btn));
    return btn;
  }

  async function copyHex(hex, btn) {
    try {
      await navigator.clipboard.writeText(hex);
    } catch (err) {
      // クリップボードが使えない環境では何もしない
    }
    if (btn) {
      const label = btn.querySelector(".color-swatch-hex");
      const original = label.textContent;
      label.textContent = "コピーしました";
      btn.classList.add("copied");
      setTimeout(() => {
        label.textContent = original;
        btn.classList.remove("copied");
      }, 1000);
    }
  }

  function showPickedColor(r, g, b) {
    const hex = rgbToHex(r, g, b);
    currentHex = hex;
    pickedSwatch.style.background = hex;
    pickedHex.textContent = hex;
    pickedRgb.textContent = `R:${r} G:${g} B:${b}`;
    pickedCard.hidden = false;
  }

  canvas.addEventListener("click", (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.min(canvas.width - 1, Math.max(0, Math.floor((e.clientX - rect.left) / rect.width * canvas.width)));
    const y = Math.min(canvas.height - 1, Math.max(0, Math.floor((e.clientY - rect.top) / rect.height * canvas.height)));
    const ctx = canvas.getContext("2d");
    const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
    showPickedColor(r, g, b);
  });

  copyBtn.addEventListener("click", () => copyHex(currentHex, null));

  eyedropperBtn.addEventListener("click", async () => {
    if (!window.EyeDropper) {
      eyedropperNote.textContent = "お使いのブラウザは対応していません。Chrome・Edgeなどでお試しください。";
      return;
    }
    eyedropperNote.textContent = "";
    try {
      const result = await new window.EyeDropper().open();
      const [r, g, b] = hexToRgb(result.sRGBHex);
      showPickedColor(r, g, b);
    } catch (err) {
      // ユーザーがEscキーなどでキャンセルした場合は何もしない
    }
  });

  async function loadFile(fileList) {
    const files = await loadImageFiles(fileList, { resultArea, listEl: null });
    if (!files.length) return;

    const file = files[0];
    resultArea.innerHTML = files.length > 1
      ? `<p>${file.name} を読み込みました</p><p class="format-note">このツールは1枚ずつの処理のため、最初の1枚のみ読み込みました。</p>`
      : `<p>${file.name} を読み込みました</p>`;

    try {
      const img = await loadImageElement(file);
      const ctx = canvas.getContext("2d");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);

      paletteRow.innerHTML = "";
      const palette = extractPalette(canvas.width, canvas.height);
      palette.forEach((hex) => paletteRow.appendChild(buildSwatch(hex)));

      pickedCard.hidden = true;
      layout.hidden = false;
    } catch (err) {
      resultArea.innerHTML = `<p style="color:red;">画像を読み込めませんでした。</p>`;
      layout.hidden = true;
    }
  }

  setupDropzone(dropzone, input, loadFile);
})();
