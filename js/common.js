// 全ツール共通のヘルパー関数

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(2) + " MB";
}

function suggestFileName(originalName, mimeType) {
  const base = originalName.replace(/\.[^/.]+$/, "");
  const ext = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  return `${base}.${ext}`;
}

// フォルダ(FileSystemDirectoryEntry)の中身を再帰的にFileの配列として取得する
function readEntryFiles(entry) {
  return new Promise((resolve) => {
    if (entry.isFile) {
      entry.file((file) => resolve([file]), () => resolve([]));
      return;
    }
    if (!entry.isDirectory) {
      resolve([]);
      return;
    }
    const reader = entry.createReader();
    const collected = [];
    const readBatch = () => {
      reader.readEntries(async (entries) => {
        if (!entries.length) {
          const nested = await Promise.all(collected.map(readEntryFiles));
          resolve(nested.flat());
          return;
        }
        collected.push(...entries);
        readBatch(); // readEntriesは一度にすべて返さないことがあるので繰り返し呼ぶ
      }, () => resolve([]));
    };
    readBatch();
  });
}

// ドラッグ&ドロップされたファイル・フォルダを、フォルダの中身も含めたFileの配列にする
async function getFilesFromDataTransfer(dataTransfer) {
  try {
    const items = dataTransfer.items;
    if (!items || !items.length) return Array.from(dataTransfer.files);

    const entries = Array.from(items)
      .filter((item) => item.kind === "file")
      .map((item) => (item.webkitGetAsEntry ? item.webkitGetAsEntry() : null))
      .filter(Boolean);

    if (!entries.length) return Array.from(dataTransfer.files);

    const nested = await Promise.all(entries.map(readEntryFiles));
    const files = nested.flat();
    return files.length ? files : Array.from(dataTransfer.files);
  } catch (err) {
    console.error("フォルダの読み取りに失敗しました:", err);
    return Array.from(dataTransfer.files);
  }
}

// ---------- 画像ファイルの読み込み(各ツール共通) ----------

function isHeicFile(file) {
  return file.type === "image/heic" || file.type === "image/heif" || /\.(heic|heif)$/i.test(file.name);
}

function isImageFile(file) {
  return file.type.startsWith("image/") || isHeicFile(file);
}

// HEICファイルはブラウザが直接デコードできないため、先にJPEGへ変換する
// (zitanOriginallyHeic を付けておくと、「元はHEICだった」ことを後段のツールが判別できる)
async function toDecodableImageFile(file) {
  if (!isHeicFile(file)) return file;
  const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
  const blob = Array.isArray(converted) ? converted[0] : converted;
  const newFile = new File([blob], file.name.replace(/\.(heic|heif)$/i, ".jpg"), { type: "image/jpeg" });
  newFile.zitanOriginallyHeic = true;
  return newFile;
}

// ドロップ/選択されたファイル群を画像だけに絞り込み、HEICを変換して返す(各ツール共通の読み込み処理)
async function loadImageFiles(fileList, { resultArea, listEl }) {
  const allFiles = Array.from(fileList);
  const imageFiles = allFiles.filter(isImageFile);
  if (!imageFiles.length) {
    if (!allFiles.length) {
      resultArea.innerHTML = `<p style="color:red;">フォルダの中身を読み取れませんでした。お手数ですが「フォルダを選択」ボタンからお試しください。</p>`;
    } else {
      resultArea.innerHTML = `<p style="color:red;">画像ファイルが見つかりませんでした。(${allFiles.length}件のファイルを検出しましたが、対応する画像形式ではありませんでした)</p>`;
    }
    return [];
  }

  if (listEl) listEl.innerHTML = "";
  resultArea.innerHTML = `<p>読み込み中...(${imageFiles.length}件)</p>`;

  const converted = [];
  for (const file of imageFiles) {
    try {
      converted.push(await toDecodableImageFile(file));
    } catch (err) {
      // 変換できないファイルはスキップ
    }
  }

  resultArea.innerHTML = `<p>${converted.length}件の画像を選択中</p>`;
  return converted;
}

// ドラッグ&ドロップ + クリックでファイル選択できるようにする共通セットアップ
// (ドラッグ&ドロップはフォルダにも対応、フォルダの中の画像も再帰的に拾う)
function setupDropzone(dropzoneEl, inputEl, onFiles) {
  dropzoneEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzoneEl.classList.add("dragover");
  });
  dropzoneEl.addEventListener("dragleave", () => {
    dropzoneEl.classList.remove("dragover");
  });
  dropzoneEl.addEventListener("drop", async (e) => {
    e.preventDefault();
    dropzoneEl.classList.remove("dragover");
    const files = await getFilesFromDataTransfer(e.dataTransfer);
    onFiles(files);
  });
  inputEl.addEventListener("change", () => {
    if (inputEl.files.length) onFiles(inputEl.files);
  });
}

// ---------- 処理後ファイルの保存先(設定画面と各ツールで共有) ----------

const SAVE_MODE_KEY = "zitan-save-mode";
let chosenDirectoryHandle = null;

function getSaveMode() {
  return localStorage.getItem(SAVE_MODE_KEY) || "zip";
}

function setSaveMode(mode) {
  localStorage.setItem(SAVE_MODE_KEY, mode);
}

function supportsFolderSave() {
  return "showDirectoryPicker" in window;
}

async function pickSaveDirectory() {
  chosenDirectoryHandle = await window.showDirectoryPicker();
  return chosenDirectoryHandle;
}

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ---------- 保存名の付け方(簡単設定 / プロ向け設定) ----------

const NAMING_MODE_KEY = "zitan-naming-mode";
const NAMING_TEMPLATE_KEY = "zitan-naming-template";
const DEFAULT_NAMING_TEMPLATE = "{datetime}({category}.{tool})";

function getNamingMode() {
  return localStorage.getItem(NAMING_MODE_KEY) || "simple";
}

function setNamingMode(mode) {
  localStorage.setItem(NAMING_MODE_KEY, mode);
}

function getNamingTemplate() {
  return localStorage.getItem(NAMING_TEMPLATE_KEY) || DEFAULT_NAMING_TEMPLATE;
}

function setNamingTemplate(template) {
  localStorage.setItem(NAMING_TEMPLATE_KEY, template);
}

function sanitizeFileName(name) {
  return name.replace(/[\\/:*?"<>|]/g, "_");
}

// テンプレート文字列({date} {time} {datetime} {category} {tool})を今の日時で展開する
function formatSaveName(template, context) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const values = {
    date,
    time,
    datetime: date + time,
    category: context.category || "",
    tool: context.tool || "",
  };
  const name = template.replace(/\{(\w+)\}/g, (match, key) => (key in values ? values[key] : match));
  return sanitizeFileName(name);
}

function buildSaveName(context) {
  const template = getNamingMode() === "pro" ? getNamingTemplate() : DEFAULT_NAMING_TEMPLATE;
  return formatSaveName(template, context);
}

// 設定の保存先(フォルダ指定 / ZIPダウンロード / 単体ダウンロード)に従って処理済みファイルを保存する
// context: { category: "画像", tool: "圧縮" } のように、保存名テンプレートに使う情報を渡す
async function saveProcessedFiles(files, context) {
  const baseName = buildSaveName(context);

  if (getSaveMode() === "folder" && supportsFolderSave() && chosenDirectoryHandle) {
    const runFolder = await chosenDirectoryHandle.getDirectoryHandle(baseName, { create: true });
    for (const file of files) {
      const handle = await runFolder.getFileHandle(file.name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(file);
      await writable.close();
    }
    return "folder";
  }

  if (files.length === 1) {
    downloadFile(files[0]);
    return "single";
  }

  const zip = new JSZip();
  files.forEach((file) => zip.file(file.name, file));
  const blob = await zip.generateAsync({ type: "blob" });
  downloadFile(new File([blob], `${baseName}.zip`, { type: "application/zip" }));
  return "zip";
}
