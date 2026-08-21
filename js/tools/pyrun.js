(() => {
  const codeInput = document.getElementById("pyrun-code");
  const runBtn = document.getElementById("pyrun-run");
  const clearBtn = document.getElementById("pyrun-clear");
  const statusEl = document.getElementById("pyrun-status");
  const resultArea = document.getElementById("pyrun-result");
  const outputEl = document.getElementById("pyrun-output");

  const PYODIDE_VERSION = "314.0.5";
  const PYODIDE_MODULE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/pyodide.mjs`;
  const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

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
        pyodideLoaded = true;
        return pyodide;
      })().catch((err) => {
        pyodidePromise = null;
        throw err;
      });
    }
    return pyodidePromise;
  }

  runBtn.addEventListener("click", async () => {
    const code = codeInput.value;
    if (!code.trim()) return;

    const isFirstLoad = !pyodideLoaded;
    runBtn.disabled = true;
    statusEl.textContent = isFirstLoad
      ? "Pythonの実行環境を読み込んでいます。完了するまで少々お待ちください。(数十MBのため少し時間がかかります)"
      : "実行中です…";

    try {
      const pyodide = await getPyodide();
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
