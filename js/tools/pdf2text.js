(() => {
  const dropzone = document.querySelector('[data-target="pdf2text-input"]');
  const input = document.getElementById("pdf2text-input");
  const runBtn = document.getElementById("pdf2text-run");
  const statusEl = document.getElementById("pdf2text-status");
  const resultArea = document.getElementById("pdf2text-result");
  const listEl = document.getElementById("pdf2text-list");

  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@2.16.105/build/pdf.worker.min.js";

  const OCR_SCALE = 3; // 72dpi基準で3倍(約216dpi相当)。OCRの精度を確保しつつ処理時間を抑える
  // 1ページあたりの処理時間の目安(実際はページの複雑さやパソコンの性能で大きく変わる)
  const OCR_SEC_LOW = 6;
  const OCR_SEC_HIGH = 20;

  let currentFiles = [];
  let ocrWorkers = null; // { horizontal, vertical }

  function isPdfFile(file) {
    return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  }

  // PDF専用のファイル選択プレビュー(共通のbuildSelectedFilesPreviewは<img>サムネイル前提で
  // PDFには使えないため、同じ見た目のクラスを使って独自に組み立てる)
  function buildSelectedPdfPreview(files) {
    const maxShow = 10;
    const shown = files.slice(0, maxShow);
    const remaining = files.length - shown.length;
    const items = shown.map((f, i) => `
      <li data-index="${i}">
        <button type="button" class="file-remove-btn" data-index="${i}" aria-label="このファイルを削除">${TRASH_ICON}</button>
        <span class="file-thumb pdf-file-icon" aria-hidden="true">📄</span>
        <span class="file-name">${f.name}</span>
        <span class="file-size">${formatBytes(f.size)}</span>
      </li>
    `).join("");
    const moreItem = remaining > 0 ? `<li class="file-list-more">ほか${remaining}件</li>` : "";
    return `
      <div class="selected-file-header">
        <p>${files.length}件のPDFを選択中</p>
        <button type="button" class="clear-all-btn">すべて削除</button>
      </div>
      <ul class="selected-file-list">${items}${moreItem}</ul>
    `;
  }

  function renderSelectedPdfFiles(files, onChange) {
    function render(list) {
      resultArea.innerHTML = buildSelectedPdfPreview(list);
      resultArea.querySelectorAll(".file-remove-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = Number(btn.dataset.index);
          list = list.slice(0, idx).concat(list.slice(idx + 1));
          render(list);
          onChange(list);
        });
      });
      const clearBtn = resultArea.querySelector(".clear-all-btn");
      if (clearBtn) {
        clearBtn.addEventListener("click", () => {
          list = [];
          resultArea.innerHTML = "";
          onChange(list);
        });
      }
    }
    render(files);
  }

  async function loadFiles(fileList) {
    const allFiles = Array.from(fileList);
    const pdfFiles = allFiles.filter(isPdfFile);
    if (!pdfFiles.length) {
      resultArea.innerHTML = `<p style="color:red;">PDFファイルが見つかりませんでした。</p>`;
      return;
    }
    currentFiles = mergeUniqueFiles(currentFiles, pdfFiles);
    runBtn.disabled = currentFiles.length === 0;
    if (currentFiles.length) {
      renderSelectedPdfFiles(currentFiles, (updated) => {
        currentFiles = updated;
        runBtn.disabled = currentFiles.length === 0;
      });
    }
  }

  setupDropzone(dropzone, input, loadFiles);

  // ---------- ①PDFの内容を確認する(文字データがあるページ/OCRが必要なページを仕分ける) ----------

  async function analyzeFile(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const hasText = textContent.items.some((item) => item.str && item.str.trim().length > 0);
      pages.push({ pageNum: i, hasText, textContent: hasText ? textContent : null });
    }
    return { file, pdf, pages };
  }

  function estimateProcessing(analyses) {
    let textPages = 0;
    let ocrPages = 0;
    analyses.forEach((a) => {
      a.pages.forEach((p) => {
        if (p.hasText) textPages++;
        else ocrPages++;
      });
    });
    const lowSec = textPages * 0.2 + ocrPages * OCR_SEC_LOW;
    const highSec = textPages * 0.3 + ocrPages * OCR_SEC_HIGH;
    return { textPages, ocrPages, lowSec, highSec };
  }

  function formatSecondsRange(lowSec, highSec) {
    const fmt = (s) => (s < 60 ? `${Math.max(1, Math.round(s))}秒` : `${Math.round(s / 60)}分`);
    return `${fmt(lowSec)}〜${fmt(highSec)}`;
  }

  // ---------- ②文字データがあるページ:pdf.jsのテキスト情報から読みやすい文章に組み立てる ----------

  const SENTENCE_END_RE = /[。!?！？」』)）]\s*$/;

  // PDFの1行は見た目上の折り返しでしかないため、行の右端が本文の最大幅に近く
  // かつ文末の句読点で終わっていない行は「まだ文が続いている」とみなして
  // 次の行と直接つなげる。それ以外(短い行や句読点で終わる行)は段落の区切りとして
  // 改行を残す。これにより、PDFの折り返し位置ではなく自然な文の切れ目で改行される。
  function reflowRowsToParagraphs(rows) {
    if (!rows.length) return "";
    const maxRight = Math.max(...rows.map((r) => r.right));
    const widthTolerance = Math.max(10, maxRight * 0.04);

    const paragraphs = [];
    let current = "";
    rows.forEach((row, i) => {
      current += row.text;
      const isLastRow = i === rows.length - 1;
      const isNearFullWidth = row.right >= maxRight - widthTolerance;
      const endsWithSentenceEnd = SENTENCE_END_RE.test(row.text.trim());
      if (isLastRow || !isNearFullWidth || endsWithSentenceEnd) {
        paragraphs.push(current);
        current = "";
      }
    });
    if (current) paragraphs.push(current);
    return paragraphs.join("\n\n");
  }

  function extractPlainTextFromItems(items) {
    // 同じ行(Y座標がほぼ同じ)ごとにまとめてから、上→下、各行は左→右の順に並べる
    const TOLERANCE = 3;
    const rows = [];
    items.forEach((item) => {
      const y = item.transform[5];
      let row = rows.find((r) => Math.abs(r.y - y) <= TOLERANCE);
      if (!row) {
        row = { y, items: [] };
        rows.push(row);
      }
      row.items.push(item);
    });
    rows.sort((a, b) => b.y - a.y);
    rows.forEach((row) => {
      row.items.sort((a, b) => a.transform[4] - b.transform[4]);
      row.text = row.items.map((it) => it.str).join("");
      row.right = Math.max(...row.items.map((it) => it.transform[4] + (it.width || 0)));
    });

    const nonEmptyRows = rows.filter((r) => r.text.trim().length > 0);
    return reflowRowsToParagraphs(nonEmptyRows);
  }

  // ---------- ③文字データが無いページ:OCR(Tesseract.js)で読み取る ----------

  async function getOcrWorkers() {
    if (ocrWorkers) return ocrWorkers;
    const [horizontal, vertical] = await Promise.all([
      Tesseract.createWorker("jpn+eng"),
      Tesseract.createWorker("jpn_vert"),
    ]);
    ocrWorkers = { horizontal, vertical };
    return ocrWorkers;
  }

  async function terminateOcrWorkers() {
    if (!ocrWorkers) return;
    const { horizontal, vertical } = ocrWorkers;
    ocrWorkers = null;
    await Promise.all([horizontal.terminate(), vertical.terminate()]);
  }

  async function renderPageToCanvas(page) {
    const viewport = page.getViewport({ scale: OCR_SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas;
  }

  // Tesseract.jsのワーカー通信で、日本語などの結果がUTF-8のままLatin-1として
  // 誤読され文字化けすることがあるため、その場合は元の文字列を復元する
  // (文字化けでなければ何もせずそのまま返す、安全なフォールバック付き)
  function fixMojibakeUtf8(str) {
    if (!str) return str;
    try {
      const bytes = new Uint8Array([...str].map((ch) => {
        const code = ch.codePointAt(0);
        if (code > 0xff) throw new Error("not mojibake");
        return code;
      }));
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return str;
    }
  }

  // Tesseractの日本語OCRは、単語の区切りごとに余分な半角スペースを入れる癖があるため、
  // 漢字・ひらがな・カタカナ同士の間に挟まったスペースを削除する
  // (英単語・数字まわりの意味のあるスペースはCJK文字が隣にないので残る)
  const CJK_RANGE = "\\u3000-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF";
  const CJK_SPACE_RE = new RegExp(`([${CJK_RANGE}])[ \\t]+(?=[${CJK_RANGE}])`, "g");

  // 空行だらけになりやすいOCR結果を、各行の前後の空白を削って空行を詰めた状態に整える
  function cleanupOcrText(text) {
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    let joined = lines.join("\n");
    joined = joined.replace(CJK_SPACE_RE, "$1");
    return joined;
  }

  // 縦書き・横書きの両方でOCRを試し、読み取り精度(confidence)が高いほうを採用する
  async function ocrPageCanvas(canvas) {
    const { horizontal, vertical } = await getOcrWorkers();
    const [hRes, vRes] = await Promise.all([
      horizontal.recognize(canvas, {}, { text: true }).catch(() => null),
      vertical.recognize(canvas, {}, { text: true }).catch(() => null),
    ]);
    const hConf = hRes?.data?.confidence ?? -1;
    const vConf = vRes?.data?.confidence ?? -1;
    const best = hConf >= vConf ? hRes : vRes;
    return cleanupOcrText(fixMojibakeUtf8(best?.data?.text ?? ""));
  }

  async function extractTextFromAnalysis(analysis, onStatus) {
    const { file, pdf, pages } = analysis;
    const pageTexts = [];
    for (const p of pages) {
      if (p.hasText) {
        onStatus(`${file.name}: ${p.pageNum}/${pages.length}ページ目を確認中...`);
        pageTexts.push(extractPlainTextFromItems(p.textContent.items));
      } else {
        onStatus(`${file.name}: ${p.pageNum}/${pages.length}ページ目をOCRで読み取り中...(時間がかかります)`);
        const page = await pdf.getPage(p.pageNum);
        const canvas = await renderPageToCanvas(page);
        const text = await ocrPageCanvas(canvas);
        pageTexts.push(text);
      }
    }
    return pageTexts.map((t, i) => `----- ${i + 1}ページ目 -----\n${t.trim()}`).join("\n\n");
  }

  // ---------- 実行 ----------

  runBtn.addEventListener("click", async () => {
    if (!currentFiles.length) return;
    runBtn.disabled = true;
    runBtn.textContent = "内容を確認中...";
    listEl.innerHTML = "";
    statusEl.textContent = "";

    let analyses;
    try {
      analyses = [];
      for (const file of currentFiles) {
        analyses.push(await analyzeFile(file));
      }
    } catch (err) {
      resultArea.innerHTML = `<p style="color:red;">PDFの内容を確認できませんでした。</p>`;
      runBtn.disabled = false;
      runBtn.textContent = "文字を抽出する";
      return;
    }

    const { textPages, ocrPages, lowSec, highSec } = estimateProcessing(analyses);
    const totalPages = textPages + ocrPages;
    const message = ocrPages === 0
      ? `全${totalPages}ページとも文字データがあるので、すぐに抽出できます。\n実行しますか?`
      : `全${totalPages}ページ中、${ocrPages}ページはOCR(文字認識)で読み取ります。\nおおよそ${formatSecondsRange(lowSec, highSec)}かかりそうです(目安です。パソコンの性能により変わります)。\n実行しますか?`;

    if (!confirm(message)) {
      runBtn.disabled = false;
      runBtn.textContent = "文字を抽出する";
      return;
    }

    runBtn.textContent = "抽出中...";
    resultArea.innerHTML = "";
    const results = [];

    try {
      for (const analysis of analyses) {
        const li = document.createElement("li");
        li.innerHTML = `<span>${analysis.file.name}</span><span>処理中...</span>`;
        listEl.appendChild(li);

        try {
          const text = await extractTextFromAnalysis(analysis, (label) => {
            statusEl.textContent = label;
          });
          const newName = `${analysis.file.name.replace(/\.pdf$/i, "")}.txt`;
          results.push(new File([text], newName, { type: "text/plain" }));
          li.innerHTML = `<span>${analysis.file.name}</span><span>抽出しました</span>`;
        } catch (err) {
          li.innerHTML = `<span>${analysis.file.name}</span><span style="color:red;">失敗</span>`;
        }
      }
    } finally {
      await terminateOcrWorkers();
      statusEl.textContent = "";
    }

    if (results.length) {
      const saveResult = await saveProcessedFiles(results, { category: "PDF", tool: "文字抽出" }, currentFiles.length > 1);
      const savedMsg = saveResult === "folder" ? "指定したフォルダに保存しました。" : "ダウンロードしました。";
      resultArea.innerHTML = `
        <div class="result-card">
          <div class="result-info">
            <p>${results.length}件のPDFから文字を抽出しました。</p>
            <p>${savedMsg}</p>
          </div>
        </div>
      `;
    } else {
      resultArea.innerHTML = `<p style="color:red;">抽出できたファイルがありませんでした。</p>`;
    }

    runBtn.disabled = false;
    runBtn.textContent = "文字を抽出する";
  });
})();
