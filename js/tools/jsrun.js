(() => {
  const codeInput = document.getElementById("jsrun-code");
  const runBtn = document.getElementById("jsrun-run");
  const stopBtn = document.getElementById("jsrun-stop");
  const clearBtn = document.getElementById("jsrun-clear");
  const resultArea = document.getElementById("jsrun-result");
  const outputEl = document.getElementById("jsrun-output");
  const sampleSelect = document.getElementById("jsrun-sample-select");
  const sampleInsertBtn = document.getElementById("jsrun-sample-insert");

  const WORKER_URL = "js/tools/jsrun-worker.js";

  const cmEditor = window.CodeMirror
    ? CodeMirror.fromTextArea(codeInput, {
        mode: "javascript",
        lineNumbers: true,
        matchBrackets: true,
        autoCloseBrackets: true,
        indentUnit: 2,
        tabSize: 2,
        extraKeys: { "Ctrl-Enter": () => startRun(), "Cmd-Enter": () => startRun() },
      })
    : null;

  function getCode() {
    return cmEditor ? cmEditor.getValue() : codeInput.value;
  }

  function setCode(text) {
    if (cmEditor) cmEditor.setValue(text);
    else codeInput.value = text;
  }

  const SAMPLES = [
    { label: "Hello World", code: `console.log("Hello, Zitan!");` },
    { label: "九九表を作る", code: `for (let i = 1; i <= 9; i++) {\n  let row = [];\n  for (let j = 1; j <= 9; j++) {\n    row.push(\`\${i}x\${j}=\${i * j}\`);\n  }\n  console.log(row.join(" "));\n}` },
    { label: "配列の合計・平均を計算", code: `const scores = [80, 65, 90, 72, 88, 55, 100];\nconst sum = scores.reduce((a, b) => a + b, 0);\nconsole.log("合計:", sum);\nconsole.log("平均:", sum / scores.length);\nconsole.log("最高点:", Math.max(...scores));` },
    { label: "今日の日付を表示", code: `const today = new Date();\nconsole.log(today.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "long" }));` },
    { label: "簡単なオブジェクト操作", code: `const user = { name: "山田太郎", age: 25 };\nconsole.log(JSON.stringify(user, null, 2));` },
  ];

  SAMPLES.forEach((item, i) => {
    const option = document.createElement("option");
    option.value = String(i);
    option.textContent = item.label;
    sampleSelect.appendChild(option);
  });

  sampleInsertBtn.addEventListener("click", () => {
    const item = SAMPLES[Number(sampleSelect.value)];
    if (!item) return;
    if (getCode().trim() && !confirm("今書いているコードを、サンプルコードで上書きします。よろしいですか?")) return;
    setCode(item.code);
  });

  function appendOutput(text, isError = false) {
    resultArea.hidden = false;
    const span = document.createElement("span");
    if (isError) span.className = "pyrun-error";
    span.textContent = text;
    outputEl.appendChild(span);
    outputEl.scrollTop = outputEl.scrollHeight;
  }

  function appendHint(text) {
    resultArea.hidden = false;
    const span = document.createElement("span");
    span.className = "pyrun-hint";
    span.textContent = `💡 ヒント: ${text}\n`;
    outputEl.appendChild(span);
    outputEl.scrollTop = outputEl.scrollHeight;
  }

  const ERROR_HINTS = [
    { pattern: /^ReferenceError/, hint: "変数や関数の名前が間違っているか、定義する前に使っています。" },
    { pattern: /^SyntaxError/, hint: "コードの書き方に誤りがあります。カッコや引用符の閉じ忘れがないか確認してください。" },
    { pattern: /^TypeError/, hint: "データの種類が合わない操作をしています(数値でないものを計算しようとした、など)。" },
    { pattern: /^RangeError/, hint: "指定した数値が範囲外です。" },
  ];

  function findErrorHint(message) {
    const found = ERROR_HINTS.find((h) => h.pattern.test(message));
    return found ? found.hint : null;
  }

  let worker = null;
  let running = false;

  function createWorker() {
    const w = new Worker(WORKER_URL);
    w.onmessage = (e) => handleWorkerMessage(e.data);
    w.onerror = (e) => {
      appendOutput(`実行中にエラーが発生しました: ${e.message}`, true);
      finishRun();
    };
    return w;
  }

  function getWorker() {
    if (!worker) worker = createWorker();
    return worker;
  }

  function handleWorkerMessage(data) {
    switch (data.type) {
      case "log":
        appendOutput(data.text, data.level === "error" || data.level === "warn");
        break;
      case "done":
        finishRun();
        break;
      case "error": {
        appendOutput(data.message, true);
        const hint = findErrorHint(data.message);
        if (hint) appendHint(hint);
        finishRun();
        break;
      }
    }
  }

  function finishRun() {
    running = false;
    runBtn.hidden = false;
    stopBtn.hidden = true;
  }

  function startRun() {
    const code = getCode();
    if (!code.trim() || running) return;
    running = true;
    runBtn.hidden = true;
    stopBtn.hidden = false;
    getWorker().postMessage({ code });
  }

  runBtn.addEventListener("click", startRun);

  stopBtn.addEventListener("click", () => {
    if (worker) {
      worker.terminate();
      worker = null;
    }
    appendOutput("⏹ 実行を停止しました。", true);
    finishRun();
  });

  clearBtn.addEventListener("click", () => {
    outputEl.textContent = "";
    resultArea.hidden = true;
  });
})();
