(() => {
  const codeInput = document.getElementById("pyrun-code");
  const runBtn = document.getElementById("pyrun-run");
  const stopBtn = document.getElementById("pyrun-stop");
  const clearBtn = document.getElementById("pyrun-clear");
  const statusEl = document.getElementById("pyrun-status");
  const resultArea = document.getElementById("pyrun-result");
  const outputEl = document.getElementById("pyrun-output");
  const uploadInput = document.getElementById("pyrun-upload");
  const dropzone = document.getElementById("pyrun-dropzone");
  const filesListEl = document.getElementById("pyrun-files");
  const filesNoteEl = document.getElementById("pyrun-files-note");
  const sampleSelect = document.getElementById("pyrun-sample-select");
  const sampleInsertBtn = document.getElementById("pyrun-sample-insert");

  const UPLOAD_DIR = "/uploads";
  const WORKER_URL = "js/tools/pyrun-worker.js";
  const VIDEO_MIME_TYPES = { mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", ogg: "video/ogg", ogv: "video/ogg" };

  // CodeMirrorが読み込めている場合のみ、通常のtextareaを置き換えて
  // 色付け・行番号・かっこ自動補完付きのエディタにする
  const cmEditor = window.CodeMirror
    ? CodeMirror.fromTextArea(codeInput, {
        mode: "python",
        lineNumbers: true,
        matchBrackets: true,
        autoCloseBrackets: true,
        indentUnit: 4,
        tabSize: 4,
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
    {
      group: "初心者向け",
      items: [
        { label: "九九表を作る", code: `for i in range(1, 10):\n    for j in range(1, 10):\n        print(f"{i} x {j} = {i*j}")\n    print("---")` },
        { label: "今日から指定日までの日数を計算", code: `from datetime import date\n\ntoday = date.today()\ntarget = date(2026, 12, 25)  # ここを好きな日付に変えられます\ndays_left = (target - today).days\n\nprint("今日:", today)\nprint("目標日:", target)\nprint("あと", days_left, "日")` },
      ],
    },
    {
      group: "ファイル・表計算",
      items: [
        { label: "アップロードしたCSVを表で表示", code: `import pandas as pd\n\ndf = pd.read_csv("/uploads/ファイル名.csv")\nshow_table(df)` },
        { label: "アップロードしたExcelを表で表示", code: `import pandas as pd\n\ndf = pd.read_excel("/uploads/ファイル名.xlsx")\nshow_table(df)` },
        { label: "numpyでテストの点数を分析", code: `import numpy as np\n\nscores = np.array([80, 65, 90, 72, 88, 55, 100])\n\nprint("平均点:", scores.mean())\nprint("最高点:", scores.max())\nprint("最低点:", scores.min())\nprint("80点以上の人数:", (scores >= 80).sum())` },
      ],
    },
    {
      group: "画像・動画",
      items: [
        { label: "アップロードした画像を表示", code: `show_image("/uploads/ファイル名")` },
        { label: "アップロードした動画を再生", code: `show_video("/uploads/ファイル名")` },
      ],
    },
    {
      group: "グラフ",
      items: [
        { label: "matplotlibで簡単なグラフを描く", code: `import matplotlib.pyplot as plt\n\nx = [1, 2, 3, 4, 5]\ny = [2, 4, 6, 8, 10]\nplt.plot(x, y)\nplt.title("サンプルグラフ")\nplt.show()` },
      ],
    },
  ];

  SAMPLES.forEach((group) => {
    const optgroup = document.createElement("optgroup");
    optgroup.label = group.group;
    group.items.forEach((item, i) => {
      const option = document.createElement("option");
      option.value = `${group.group}::${i}`;
      option.textContent = item.label;
      optgroup.appendChild(option);
    });
    sampleSelect.appendChild(optgroup);
  });

  sampleInsertBtn.addEventListener("click", () => {
    const [groupName, indexStr] = sampleSelect.value.split("::");
    const group = SAMPLES.find((g) => g.group === groupName);
    const item = group && group.items[Number(indexStr)];
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

  // よくあるPythonのエラーを、日本語のヒントに変換する(専門用語だけだと
  // 初心者には原因が分かりにくいため)
  const ERROR_HINTS = [
    { pattern: /UnidentifiedImageError/, hint: "画像として開けないファイルです。show_imageは画像専用なので、動画にはshow_videoを使ってください。" },
    { pattern: /^ModuleNotFoundError|^ImportError/, hint: "そのライブラリが見つからないか、対応していません。名前のスペルが正しいか確認してください。" },
    { pattern: /^NameError/, hint: "変数や関数の名前が間違っているか、使う前に定義されていない可能性があります。" },
    { pattern: /^SyntaxError/, hint: "コードの書き方に誤りがあります。コロン(:)の付け忘れやカッコの閉じ忘れがないか確認してください。" },
    { pattern: /^IndentationError/, hint: "インデント(行の先頭の空白)の数がずれています。半角スペース4つで揃えると安定します。" },
    { pattern: /^TypeError/, hint: "データの種類(文字列・数値など)が合わない操作をしています。" },
    { pattern: /^ValueError/, hint: "値の中身が、その処理には適していません。" },
    { pattern: /^ZeroDivisionError/, hint: "0で割り算しようとしています。" },
    { pattern: /^FileNotFoundError/, hint: "指定したファイルの場所が見つかりません。ファイルをアップロード済みか、場所(パス)が正しいか確認してください。" },
    { pattern: /^KeyError/, hint: "辞書(dict)に、その名前のキーが存在しません。" },
    { pattern: /^IndexError/, hint: "リストなどの範囲外の場所を指定しています。" },
    { pattern: /^AttributeError/, hint: "そのデータには、指定した機能(メソッド)が存在しません。" },
  ];

  function findErrorHint(message) {
    const lines = message.trim().split("\n");
    const lastLine = lines[lines.length - 1] || "";
    const found = ERROR_HINTS.find((h) => h.pattern.test(lastLine));
    return found ? found.hint : null;
  }

  function showImage(b64) {
    resultArea.hidden = false;
    const img = document.createElement("img");
    img.src = `data:image/png;base64,${b64}`;
    outputEl.appendChild(img);
    outputEl.scrollTop = outputEl.scrollHeight;
  }

  function showVideo(ext, b64) {
    resultArea.hidden = false;
    const video = document.createElement("video");
    video.controls = true;
    video.src = `data:${VIDEO_MIME_TYPES[ext] || "video/mp4"};base64,${b64}`;
    outputEl.appendChild(video);
    outputEl.scrollTop = outputEl.scrollHeight;
  }

  function showTable(html) {
    resultArea.hidden = false;
    const wrap = document.createElement("div");
    wrap.className = "pyrun-table-wrap";
    wrap.innerHTML = html;
    outputEl.appendChild(wrap);
    outputEl.scrollTop = outputEl.scrollHeight;
  }

  function saveFile(name, b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    downloadFile(new File([bytes], name));
  }

  let zipBatch = null; // { zipName, files: [{name, b64}] }
  async function finishZipBatch() {
    if (!zipBatch) return;
    const zip = new JSZip();
    zipBatch.files.forEach((f) => zip.file(f.name, f.b64, { base64: true }));
    const blob = await zip.generateAsync({ type: "blob" });
    downloadFile(new File([blob], `${zipBatch.zipName}.zip`, { type: "application/zip" }));
    zipBatch = null;
  }

  // --- Worker管理 ---
  // 停止ボタンでworker.terminate()すると、次回実行時は新しいworkerを
  // 一から立ち上げる(Pyodideの再読み込みが必要)ため、その都度アップロード
  // 済みファイルを再送信して仮想ファイルシステムを復元する
  let worker = null;
  let workerFilesSynced = false;
  let requestSeq = 0;
  const pendingAcks = new Map();
  let running = false;

  function createWorker() {
    const w = new Worker(WORKER_URL, { type: "module" });
    w.onmessage = (e) => handleWorkerMessage(e.data);
    w.onerror = (e) => {
      appendOutput(`Workerの実行中にエラーが発生しました: ${e.message}`, true);
      finishRun();
    };
    return w;
  }

  function getWorker() {
    if (!worker) {
      worker = createWorker();
      workerFilesSynced = false;
    }
    return worker;
  }

  function sendAckRequest(type, payload) {
    return new Promise((resolve) => {
      const id = ++requestSeq;
      pendingAcks.set(id, resolve);
      getWorker().postMessage({ id, type, ...payload });
    });
  }

  async function syncFilesToWorker() {
    if (workerFilesSynced || !uploadedFiles.length) {
      workerFilesSynced = true;
      return;
    }
    await sendAckRequest("upload", {
      files: uploadedFiles.map((f) => ({ path: f.path, buffer: f.buffer })),
    });
    workerFilesSynced = true;
  }

  function handleWorkerMessage(data) {
    switch (data.type) {
      case "stdout":
        appendOutput(data.text);
        break;
      case "stderr":
        appendOutput(data.text, true);
        break;
      case "show_image":
        showImage(data.b64);
        break;
      case "show_video":
        showVideo(data.ext, data.b64);
        break;
      case "show_table":
        showTable(data.html);
        break;
      case "save_file":
        saveFile(data.name, data.b64);
        break;
      case "save_files_start":
        zipBatch = { zipName: data.zipName, files: [] };
        break;
      case "save_files_add":
        if (zipBatch) zipBatch.files.push({ name: data.name, b64: data.b64 });
        break;
      case "save_files_finish":
        finishZipBatch();
        break;
      case "loading":
        statusEl.textContent = "Pythonの実行環境を読み込んでいます。完了するまで少々お待ちください。(数十MBのため少し時間がかかります)";
        break;
      case "running":
        statusEl.textContent = "実行中です…";
        break;
      case "done":
        statusEl.textContent = "";
        finishRun();
        break;
      case "error": {
        appendOutput(data.message, true);
        const hint = findErrorHint(data.message);
        if (hint) appendHint(hint);
        statusEl.textContent = "";
        finishRun();
        break;
      }
      case "ack":
        if (pendingAcks.has(data.id)) {
          pendingAcks.get(data.id)();
          pendingAcks.delete(data.id);
        }
        break;
    }
  }

  function finishRun() {
    running = false;
    runBtn.hidden = false;
    stopBtn.hidden = true;
  }

  const uploadedFiles = []; // { name, path, buffer }

  function renderFileList() {
    filesListEl.innerHTML = "";
    uploadedFiles.forEach((f) => {
      const li = document.createElement("li");

      const nameSpan = document.createElement("span");
      nameSpan.textContent = f.name;

      const pathSpan = document.createElement("span");
      pathSpan.className = "pyrun-path";
      pathSpan.dataset.path = f.path;
      pathSpan.title = "クリックでコピー";
      pathSpan.textContent = f.path;

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "pyrun-file-delete";
      deleteBtn.dataset.path = f.path;
      deleteBtn.title = "削除";
      deleteBtn.textContent = "✕";

      li.append(nameSpan, pathSpan, deleteBtn);
      filesListEl.appendChild(li);
    });
    filesNoteEl.hidden = uploadedFiles.length === 0;
  }

  filesListEl.addEventListener("click", (e) => {
    const deleteBtn = e.target.closest(".pyrun-file-delete");
    if (deleteBtn) {
      const path = deleteBtn.dataset.path;
      const idx = uploadedFiles.findIndex((f) => f.path === path);
      if (idx !== -1) uploadedFiles.splice(idx, 1);
      renderFileList();
      if (worker) sendAckRequest("delete", { path });
      return;
    }
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

  async function addFiles(fileList) {
    const files = Array.from(fileList);
    if (!files.length) return;

    uploadInput.disabled = true;
    try {
      const takenNames = new Set(uploadedFiles.map((f) => f.name));
      const newEntries = [];
      for (const file of files) {
        const name = uniqueUploadName(file.name, takenNames);
        takenNames.add(name);
        const buffer = await file.arrayBuffer();
        const path = `${UPLOAD_DIR}/${name}`;
        const entry = { name, path, buffer };
        uploadedFiles.push(entry);
        newEntries.push(entry);
      }
      renderFileList();
      await sendAckRequest("upload", { files: newEntries.map((f) => ({ path: f.path, buffer: f.buffer })) });
      workerFilesSynced = true;
    } catch (err) {
      statusEl.textContent = "ファイルの読み込みに失敗しました。もう一度お試しください。";
    } finally {
      uploadInput.disabled = false;
      uploadInput.value = "";
    }
  }

  setupDropzone(dropzone, uploadInput, addFiles);

  async function startRun() {
    const code = getCode();
    if (!code.trim() || running) return;

    running = true;
    runBtn.hidden = true;
    stopBtn.hidden = false;
    try {
      await syncFilesToWorker();
      getWorker().postMessage({ type: "run", code });
    } catch (err) {
      appendOutput(String(err && err.message ? err.message : err), true);
      finishRun();
    }
  }

  runBtn.addEventListener("click", startRun);

  stopBtn.addEventListener("click", () => {
    if (worker) {
      worker.terminate();
      worker = null;
      workerFilesSynced = false;
    }
    pendingAcks.clear();
    appendOutput("⏹ 実行を停止しました。次回の実行では、Pythonの実行環境を読み込み直します。", true);
    statusEl.textContent = "";
    finishRun();
  });

  clearBtn.addEventListener("click", () => {
    outputEl.textContent = "";
    resultArea.hidden = true;
  });
})();
