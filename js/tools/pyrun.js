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
      li.innerHTML = `<span>${f.name}</span><span class="pyrun-path">${f.path}</span>`;
      filesListEl.appendChild(li);
    });
    filesNoteEl.hidden = uploadedFiles.length === 0;
  }

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
