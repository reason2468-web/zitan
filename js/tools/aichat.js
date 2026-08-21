(() => {
  const loadBtn = document.getElementById("aichat-load");
  const statusEl = document.getElementById("aichat-status");
  const logEl = document.getElementById("aichat-log");
  const inputArea = document.getElementById("aichat-input-area");
  const inputEl = document.getElementById("aichat-input");
  const sendBtn = document.getElementById("aichat-send");
  const stopBtn = document.getElementById("aichat-stop");
  const clearBtn = document.getElementById("aichat-clear");

  // 試験導入(実験的): wllama(llama.cppのWasm版)で小型AIをブラウザだけで動かす。
  // 軽量なSmolLM2-360M-Instructを使う(それでも約270MBあるため、初回のみダウンロード)
  const WLLAMA_VERSION = "3.6.0";
  const WLLAMA_MODULE_URL = `https://cdn.jsdelivr.net/npm/@wllama/wllama@${WLLAMA_VERSION}/esm/index.js`;
  const WLLAMA_WASM_URL = `https://cdn.jsdelivr.net/npm/@wllama/wllama@${WLLAMA_VERSION}/esm/wasm/wllama.wasm`;
  const HF_REPO = "bartowski/SmolLM2-360M-Instruct-GGUF";
  const HF_QUANT = "Q4_K_M";

  let wllama = null;
  let messages = [];
  let sending = false;
  let abortController = null;

  function addMessage(role, text) {
    logEl.hidden = false;
    const div = document.createElement("div");
    div.className = role === "user" ? "aichat-msg aichat-msg-user" : "aichat-msg aichat-msg-ai";
    div.textContent = text;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
    return div;
  }

  loadBtn.addEventListener("click", async () => {
    loadBtn.disabled = true;
    statusEl.textContent = "AIモデルを読み込んでいます。完了するまで少々お待ちください。(約270MB)";
    try {
      const { Wllama } = await import(WLLAMA_MODULE_URL);
      wllama = new Wllama({ default: WLLAMA_WASM_URL });
      await wllama.loadModelFromHF(
        { repo: HF_REPO, quant: HF_QUANT },
        {
          n_ctx: 2048,
          progressCallback: ({ loaded, total }) => {
            const pct = total ? Math.round((loaded / total) * 100) : 0;
            statusEl.textContent = `AIモデルを読み込んでいます。完了するまで少々お待ちください。(${pct}%)`;
          },
        }
      );
      statusEl.textContent = "";
      loadBtn.hidden = true;
      inputArea.hidden = false;
      addMessage("ai", "こんにちは!簡単な質問や、短い文章の要約をお試しください。");
    } catch (err) {
      statusEl.textContent = "AIモデルの読み込みに失敗しました。通信環境を確認して、もう一度お試しください。";
      loadBtn.disabled = false;
    }
  });

  async function send() {
    const text = inputEl.value.trim();
    if (!text || sending || !wllama) return;
    sending = true;
    sendBtn.hidden = true;
    stopBtn.hidden = false;
    inputEl.value = "";

    addMessage("user", text);
    messages.push({ role: "user", content: text });

    const aiDiv = addMessage("ai", "");

    abortController = new AbortController();
    try {
      const stream = await wllama.createChatCompletion({
        messages,
        stream: true,
        max_tokens: 400,
        abortSignal: abortController.signal,
      });
      let full = "";
      for await (const chunk of stream) {
        const piece = chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content;
        if (piece) {
          full += piece;
          aiDiv.textContent = full;
          logEl.scrollTop = logEl.scrollHeight;
        }
      }
      messages.push({ role: "assistant", content: full });
    } catch (err) {
      if (!aiDiv.textContent) aiDiv.textContent = "(停止しました)";
    } finally {
      sending = false;
      sendBtn.hidden = false;
      stopBtn.hidden = true;
      abortController = null;
    }
  }

  sendBtn.addEventListener("click", send);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  stopBtn.addEventListener("click", () => {
    if (abortController) abortController.abort();
  });

  clearBtn.addEventListener("click", () => {
    messages = [];
    logEl.innerHTML = "";
    logEl.hidden = true;
  });
})();
