(() => {
  const panel = document.getElementById("calculator");
  const toolDetail = document.getElementById("tool-detail");
  const exprEl = document.getElementById("calc-expression");
  const resultEl = document.getElementById("calc-result");
  const sciGrid = document.getElementById("calc-sci-grid");
  const degToggle = document.getElementById("calc-deg-toggle");
  const modeRadios = document.querySelectorAll('input[name="calc-mode"]');

  let expr = "";
  let justEvaluated = false;
  let degMode = true;

  // ---- 式の文字列を数値に変換する ----

  function tokenize(str) {
    const re = /\d+\.?\d*|\.\d+|sin|cos|tan|log|ln|π|e|√|×|÷|[+\-−^!%()]/g;
    return str.match(re) || [];
  }

  function evaluate(str) {
    // 閉じ忘れた括弧は末尾で自動的に閉じる
    const openCount = (str.match(/\(/g) || []).length;
    const closeCount = (str.match(/\)/g) || []).length;
    str += ")".repeat(Math.max(0, openCount - closeCount));

    const tokens = tokenize(str);
    let pos = 0;
    const peek = () => tokens[pos];
    const next = () => tokens[pos++];

    function toRad(v) { return degMode ? (v * Math.PI) / 180 : v; }

    function factorial(n) {
      if (n < 0 || !Number.isInteger(n) || n > 170) return NaN;
      let r = 1;
      for (let i = 2; i <= n; i++) r *= i;
      return r;
    }

    function parsePrimary() {
      const t = peek();
      if (t === undefined) throw new Error("式が不完全です");
      if (t === "(") {
        next();
        const v = parseExpr();
        if (peek() === ")") next();
        return v;
      }
      if (t === "√") {
        next();
        if (peek() !== "(") throw new Error("括弧が必要です");
        next();
        const v = parseExpr();
        if (peek() === ")") next();
        return Math.sqrt(v);
      }
      if (["sin", "cos", "tan", "log", "ln"].includes(t)) {
        next();
        if (peek() !== "(") throw new Error("括弧が必要です");
        next();
        const v = parseExpr();
        if (peek() === ")") next();
        if (t === "sin") return Math.sin(toRad(v));
        if (t === "cos") return Math.cos(toRad(v));
        if (t === "tan") return Math.tan(toRad(v));
        if (t === "log") return Math.log10(v);
        if (t === "ln") return Math.log(v);
      }
      if (t === "π") { next(); return Math.PI; }
      if (t === "e") { next(); return Math.E; }
      if (/^\d/.test(t) || t.startsWith(".")) { next(); return parseFloat(t); }
      throw new Error("式が正しくありません");
    }

    function parsePostfix() {
      let v = parsePrimary();
      while (peek() === "!" || peek() === "%") {
        const op = next();
        v = op === "!" ? factorial(v) : v / 100;
      }
      return v;
    }

    function parseUnary() {
      if (peek() === "-" || peek() === "−") { next(); return -parseUnary(); }
      return parsePostfix();
    }

    function parsePow() {
      const v = parseUnary();
      if (peek() === "^") { next(); return Math.pow(v, parsePow()); }
      return v;
    }

    function parseTerm() {
      let v = parsePow();
      while (peek() === "×" || peek() === "÷") {
        const op = next();
        const rhs = parsePow();
        v = op === "×" ? v * rhs : v / rhs;
      }
      return v;
    }

    function parseExpr() {
      let v = parseTerm();
      while (peek() === "+" || peek() === "-" || peek() === "−") {
        const op = next();
        const rhs = parseTerm();
        v = op === "+" ? v + rhs : v - rhs;
      }
      return v;
    }

    if (tokens.length === 0) throw new Error("empty");
    const value = parseExpr();
    if (pos < tokens.length) throw new Error("式が正しくありません");
    if (!isFinite(value)) throw new Error("計算できません");
    return value;
  }

  function formatNumber(n) {
    const rounded = Number(n.toPrecision(12));
    return String(rounded);
  }

  // ---- 表示の更新 ----

  function render() {
    exprEl.textContent = expr || " ";
    try {
      const value = evaluate(expr);
      resultEl.textContent = formatNumber(value);
    } catch {
      resultEl.textContent = expr ? "" : "0";
    }
  }

  const CONTINUE_CHARS = new Set(["+", "-", "−", "×", "÷", "^", "!", "%"]);

  function isContinuation(text, btn) {
    if (btn && btn.dataset.continue === "1") return true;
    return CONTINUE_CHARS.has(text);
  }

  function insert(text, btn) {
    if (justEvaluated) {
      if (isContinuation(text, btn)) {
        // 直前の結果に続けて計算する
      } else {
        expr = "";
      }
      justEvaluated = false;
    }
    expr += text;
    render();
  }

  function clearAll() {
    expr = "";
    justEvaluated = false;
    render();
  }

  function backspace() {
    if (justEvaluated) {
      clearAll();
      return;
    }
    expr = expr.slice(0, -1);
    render();
  }

  function toggleSign() {
    // 式の末尾の数値だけ符号を反転する
    if (!expr) return;
    justEvaluated = false;
    const m = expr.match(/(\d+\.?\d*)$/);
    if (!m) return;
    const numStr = m[0];
    const before = expr.slice(0, expr.length - numStr.length);
    const prevChar = before.slice(-1);
    if (prevChar === "-" || prevChar === "−") {
      expr = before.slice(0, -1) + numStr;
    } else {
      expr = `${before}-${numStr}`;
    }
    render();
  }

  function equals() {
    if (!expr) return;
    try {
      const value = evaluate(expr);
      resultEl.textContent = formatNumber(value);
      exprEl.textContent = `${expr} =`;
      expr = formatNumber(value);
      justEvaluated = true;
    } catch {
      resultEl.textContent = "エラー";
      justEvaluated = true;
      expr = "";
    }
  }

  panel.addEventListener("click", (e) => {
    const btn = e.target.closest(".calc-btn");
    if (!btn || !panel.contains(btn)) return;

    if (btn.dataset.insert !== undefined) {
      insert(btn.dataset.insert, btn);
      return;
    }
    if (btn.dataset.fn) {
      insert(`${btn.dataset.fn === "sqrt" ? "√" : btn.dataset.fn}(`, btn);
      return;
    }
    if (btn.id === "calc-deg-toggle") {
      degMode = !degMode;
      degToggle.textContent = degMode ? "DEG" : "RAD";
      degToggle.classList.toggle("active", !degMode);
      render();
      return;
    }
    switch (btn.dataset.action) {
      case "clear": clearAll(); break;
      case "backspace": backspace(); break;
      case "sign": toggleSign(); break;
      case "equals": equals(); break;
    }
  });

  modeRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      const scientific = document.querySelector('input[name="calc-mode"]:checked').value === "scientific";
      sciGrid.hidden = !scientific;
    });
  });

  document.addEventListener("keydown", (e) => {
    if (toolDetail.classList.contains("hidden") || !panel.classList.contains("active")) return;
    const key = e.key;
    if (/^[0-9.]$/.test(key)) { insert(key); e.preventDefault(); return; }
    if (key === "+") { insert("+"); e.preventDefault(); return; }
    if (key === "-") { insert("−"); e.preventDefault(); return; }
    if (key === "*") { insert("×"); e.preventDefault(); return; }
    if (key === "/") { insert("÷"); e.preventDefault(); return; }
    if (key === "^") { insert("^"); e.preventDefault(); return; }
    if (key === "%") { insert("%"); e.preventDefault(); return; }
    if (key === "(" || key === ")") { insert(key); e.preventDefault(); return; }
    if (key === "Enter" || key === "=") { equals(); e.preventDefault(); return; }
    if (key === "Backspace") { backspace(); e.preventDefault(); return; }
    if (key === "Escape") { clearAll(); e.preventDefault(); return; }
  });

  render();
})();
