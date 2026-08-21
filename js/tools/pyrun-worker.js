// Pythonの実行を裏側(別スレッド)で行うためのWorker。
// メイン画面をブロックしないことに加え、terminate()で実行中のコードを強制的に止められる
// (Pyodideは同期的にブロックするため、メインスレッド上ではこの停止操作ができない)。

import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v314.0.5/full/pyodide.mjs";

const PYODIDE_VERSION = "314.0.5";
const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

const UPLOAD_DIR = "/uploads";

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

def show_table(df, max_rows=200):
    _zitan_show_table_html(df.head(max_rows).to_html(index=False))

def save_file(path):
    import base64
    with open(path, "rb") as f:
        data = f.read()
    name = path.rsplit("/", 1)[-1]
    _zitan_save_file_b64(name, base64.b64encode(data).decode())

def save_files(paths, zip_name="files"):
    import base64
    _zitan_save_files_start(zip_name)
    for path in paths:
        with open(path, "rb") as f:
            data = f.read()
        name = path.rsplit("/", 1)[-1]
        _zitan_save_files_add(name, base64.b64encode(data).decode())
    _zitan_save_files_finish()
`;

const MATPLOTLIB_PATCH_CODE = `
import matplotlib
matplotlib.use("AGG")
import matplotlib.pyplot as plt
import io as _zitan_mpl_io, base64 as _zitan_mpl_b64
def _zitan_patched_show(*args, **kwargs):
    buf = _zitan_mpl_io.BytesIO()
    plt.savefig(buf, format="png", bbox_inches="tight")
    buf.seek(0)
    _zitan_show_image_b64(_zitan_mpl_b64.b64encode(buf.read()).decode())
    plt.close("all")
plt.show = _zitan_patched_show
`;

let pyodide = null;

async function ensurePyodide() {
  if (pyodide) return pyodide;
  pyodide = await loadPyodide({
    indexURL: PYODIDE_INDEX_URL,
    stdout: (msg) => postMessage({ type: "stdout", text: msg + "\n" }),
    stderr: (msg) => postMessage({ type: "stderr", text: msg + "\n" }),
  });
  pyodide.FS.mkdirTree(UPLOAD_DIR);
  pyodide.globals.set("_zitan_show_image_b64", (b64) => postMessage({ type: "show_image", b64 }));
  pyodide.globals.set("_zitan_show_video_b64", (ext, b64) => postMessage({ type: "show_video", ext, b64 }));
  pyodide.globals.set("_zitan_show_table_html", (html) => postMessage({ type: "show_table", html }));
  pyodide.globals.set("_zitan_save_file_b64", (name, b64) => postMessage({ type: "save_file", name, b64 }));
  pyodide.globals.set("_zitan_save_files_start", (zipName) => postMessage({ type: "save_files_start", zipName }));
  pyodide.globals.set("_zitan_save_files_add", (name, b64) => postMessage({ type: "save_files_add", name, b64 }));
  pyodide.globals.set("_zitan_save_files_finish", () => postMessage({ type: "save_files_finish" }));
  pyodide.runPython(PYRUN_SETUP_CODE);
  return pyodide;
}

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === "upload") {
      const pyodide = await ensurePyodide();
      for (const f of msg.files) {
        pyodide.FS.writeFile(f.path, new Uint8Array(f.buffer));
      }
      postMessage({ type: "ack", id: msg.id });
    } else if (msg.type === "delete") {
      const pyodide = await ensurePyodide();
      try {
        pyodide.FS.unlink(msg.path);
      } catch (err) {
        // 既に無いファイルの削除依頼は無視する
      }
      postMessage({ type: "ack", id: msg.id });
    } else if (msg.type === "run") {
      postMessage({ type: "loading" });
      const pyodide = await ensurePyodide();
      postMessage({ type: "running" });
      const code = msg.code;
      await pyodide.loadPackagesFromImports(code);
      if (/\bshow_image\s*\(/.test(code)) {
        await pyodide.loadPackage("Pillow");
      }
      if (/\bshow_table\s*\(|read_excel|to_excel/.test(code)) {
        await pyodide.loadPackage("openpyxl");
      }
      if (/matplotlib/.test(code)) {
        await pyodide.loadPackage("matplotlib");
        pyodide.runPython(MATPLOTLIB_PATCH_CODE);
      }
      await pyodide.runPythonAsync(code);
      postMessage({ type: "done" });
    }
  } catch (err) {
    postMessage({ type: "error", message: String(err && err.message ? err.message : err) });
  }
};
