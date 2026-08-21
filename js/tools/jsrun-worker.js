// JavaScriptの実行を裏側(別スレッド)で行うためのWorker。
// メイン画面をブロックせず、terminate()で実行中のコードを強制的に止められる。
// 外部ライブラリを読み込まないので、Pythonの実行環境と違って起動は一瞬。

function formatValue(v) {
  if (typeof v === "string") return v;
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (v === undefined) return "undefined";
  try {
    return JSON.stringify(v, null, 2);
  } catch (err) {
    return String(v);
  }
}

function relay(level) {
  return (...args) => {
    postMessage({ type: "log", level, text: args.map(formatValue).join(" ") + "\n" });
  };
}

console.log = relay("log");
console.info = relay("info");
console.warn = relay("warn");
console.error = relay("error");

self.onmessage = async (e) => {
  const { code } = e.data;
  try {
    // 間接eval(0, eval)でグローバルスコープで実行し、async/awaitも使えるようにする
    await (0, eval)(`(async () => {\n${code}\n})()`);
    postMessage({ type: "done" });
  } catch (err) {
    postMessage({ type: "error", message: `${(err && err.name) || "Error"}: ${(err && err.message) || err}` });
  }
};
