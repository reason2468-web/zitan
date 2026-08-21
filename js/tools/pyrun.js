(() => {
  const codeInput = document.getElementById("pyrun-code");
  const runBtn = document.getElementById("pyrun-run");
  const clearBtn = document.getElementById("pyrun-clear");
  const statusEl = document.getElementById("pyrun-status");
  const resultArea = document.getElementById("pyrun-result");
  const outputEl = document.getElementById("pyrun-output");
  const uploadInput = document.getElementById("pyrun-upload");
  const filesListEl = document.getElementById("pyrun-files");
  const filesNoteEl = document.getElementById("pyrun-files-note");

  const PYODIDE_VERSION = "314.0.5";
  const PYODIDE_MODULE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/pyodide.mjs`;
  const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
  const UPLOAD_DIR = "/uploads";

  function appendOutput(text, isError = false) {
    resultArea.hidden = false;
    const span = document.createElement("span");
    if (isError) span.className = "pyrun-error";
    span.textContent = text;
    outputEl.appendChild(span);
    outputEl.scrollTop = outputEl.scrollHeight;
  }

  // Python側のshow_image()から呼ばれ、画像をそのまま出力結果欄に表示する
  function showImageFromBase64(b64) {
    resultArea.hidden = false;
    const img = document.createElement("img");
    img.src = `data:image/png;base64,${b64}`;
    outputEl.appendChild(img);
    outputEl.scrollTop = outputEl.scrollHeight;
  }

  const VIDEO_MIME_TYPES = { mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", ogg: "video/ogg", ogv: "video/ogg" };

  // Python側のshow_video()から呼ばれ、動画をそのまま出力結果欄に表示する
  function showVideoFromBase64(ext, b64) {
    resultArea.hidden = false;
    const video = document.createElement("video");
    video.controls = true;
    video.src = `data:${VIDEO_MIME_TYPES[ext] || "video/mp4"};base64,${b64}`;
    outputEl.appendChild(video);
    outputEl.scrollTop = outputEl.scrollHeight;
  }

  // Python側のsave_file()から呼ばれ、仮想ファイルシステム上のファイルをダウンロードさせる
  function saveFileFromBase64(name, b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    downloadFile(new File([bytes], name));
  }

  const PYRUN_SETUP_CODE = `
def show_image(image):
    from PIL import Image
    import base64, io
    if isinstance(image, str):
        image = Image.open(image)
    buf = io.BytesIO()
    image.convert("RGBA").save(buf, format="PNG")
    _zitan_show_image_b64(base64.b64encode(buf.getvalue()).decode())

def show_video(path):
    import base64
    with open(path, "rb") as f:
        data = f.read()
    ext = path.rsplit(".", 1)[-1].lower() if "." in path else "mp4"
    _zitan_show_video_b64(ext, base64.b64encode(data).decode())

def save_file(path):
    import base64
    with open(path, "rb") as f:
        data = f.read()
    name = path.rsplit("/", 1)[-1]
    _zitan_save_file_b64(name, base64.b64encode(data).decode())
`;

  let pyodidePromise = null;
  let pyodideLoaded = false;
  function getPyodide() {
    if (!pyodidePromise) {
      pyodidePromise = (async () => {
        const { loadPyodide } = await import(PYODIDE_MODULE_URL);
        const pyodide = await loadPyodide({
          indexURL: PYODIDE_INDEX_URL,
          stdout: (msg) => appendOutput(msg + "\n"),
          stderr: (msg) => appendOutput(msg + "\n", true),
        });
        pyodide.FS.mkdirTree(UPLOAD_DIR);
        pyodide.globals.set("_zitan_show_image_b64", showImageFromBase64);
        pyodide.globals.set("_zitan_show_video_b64", showVideoFromBase64);
        pyodide.globals.set("_zitan_save_file_b64", saveFileFromBase64);
        pyodide.runPython(PYRUN_SETUP_CODE);
        pyodideLoaded = true;
        return pyodide;
      })().catch((err) => {
        pyodidePromise = null;
        throw err;
      });
    }
    return pyodidePromise;
  }

  // 初回だけ読み込みバナーを表示する共通処理(コード実行・ファイル渡し両方から呼ぶ)
  async function loadPyodideWithStatus() {
    const isFirstLoad = !pyodideLoaded;
    if (isFirstLoad) {
      statusEl.textContent = "Pythonの実行環境を読み込んでいます。完了するまで少々お待ちください。(数十MBのため少し時間がかかります)";
    }
    const pyodide = await getPyodide();
    if (isFirstLoad) statusEl.textContent = "";
    return pyodide;
  }

  const uploadedFiles = []; // { name, path }

  function renderFileList() {
    filesListEl.innerHTML = "";
    uploadedFiles.forEach((f) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${f.name}</span><span class="pyrun-path" data-path="${f.path}" title="クリックでコピー">${f.path}</span>`;
      filesListEl.appendChild(li);
    });
    filesNoteEl.hidden = uploadedFiles.length === 0;
  }

  filesListEl.addEventListener("click", (e) => {
    const pathEl = e.target.closest(".pyrun-path");
    if (!pathEl) return;
    navigator.clipboard.writeText(pathEl.dataset.path).then(() => {
      const original = pathEl.textContent;
      pathEl.textContent = "コピーしました!";
      setTimeout(() => {
        pathEl.textContent = original;
      }, 1200);
    });
  });

  // 既にアップロード済みの名前と重ならないよう、同名ファイルには連番を振る
  function uniqueUploadName(name, takenNames) {
    if (!takenNames.has(name)) return name;
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    let n = 2;
    while (takenNames.has(`${base} (${n})${ext}`)) n++;
    return `${base} (${n})${ext}`;
  }

  uploadInput.addEventListener("change", async () => {
    const files = Array.from(uploadInput.files);
    if (!files.length) return;

    uploadInput.disabled = true;
    try {
      const pyodide = await loadPyodideWithStatus();
      const takenNames = new Set(uploadedFiles.map((f) => f.name));
      for (const file of files) {
        const name = uniqueUploadName(file.name, takenNames);
        takenNames.add(name);
        const buf = new Uint8Array(await file.arrayBuffer());
        const path = `${UPLOAD_DIR}/${name}`;
        pyodide.FS.writeFile(path, buf);
        uploadedFiles.push({ name, path });
      }
      renderFileList();
    } catch (err) {
      statusEl.textContent = "ファイルの読み込みに失敗しました。もう一度お試しください。";
    } finally {
      uploadInput.disabled = false;
      uploadInput.value = "";
    }
  });

  runBtn.addEventListener("click", async () => {
    const code = codeInput.value;
    if (!code.trim()) return;

    runBtn.disabled = true;
    try {
      const pyodide = await loadPyodideWithStatus();
      statusEl.textContent = "実行中です…";
      await pyodide.loadPackagesFromImports(code);
      if (/\bshow_image\s*\(/.test(code)) {
        await pyodide.loadPackage("Pillow");
      }
      await pyodide.runPythonAsync(code);
      statusEl.textContent = "";
    } catch (err) {
      appendOutput(String(err && err.message ? err.message : err), true);
      statusEl.textContent = "";
    } finally {
      runBtn.disabled = false;
    }
  });

  clearBtn.addEventListener("click", () => {
    outputEl.textContent = "";
    resultArea.hidden = true;
  });
})();
