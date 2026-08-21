// 文字起こし(Whisper AI)を裏側(別スレッド)で行うためのWorker。
// メイン画面をブロックしないことに加え、terminate()で実行中の処理を強制的に止められる。

import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/dist/transformers.min.js";

env.allowLocalModels = false;

const MODEL_IDS = {
  small: "onnx-community/whisper-small",
  base: "onnx-community/whisper-base",
  tiny: "onnx-community/whisper-tiny",
};

let transcriberPromise = null;
let loadedModelKey = null;

function getTranscriber(modelKey) {
  if (transcriberPromise && loadedModelKey === modelKey) return transcriberPromise;
  loadedModelKey = modelKey;
  // 量子化(q8/q4/fp16)は端末やモデルの組み合わせによって、演算に必要な情報が
  // 足りずセッション作成に失敗したり、演算カーネルが無く止まったりする報告が
  // 他のツールでもあったため、ダウンロード量は増えるが確実に動くfp32を使う
  transcriberPromise = pipeline("automatic-speech-recognition", MODEL_IDS[modelKey], {
    dtype: { encoder_model: "fp32", decoder_model_merged: "fp32" },
    device: "wasm",
  }).catch((err) => {
    transcriberPromise = null;
    loadedModelKey = null;
    throw err;
  });
  return transcriberPromise;
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type !== "transcribe") return;
  try {
    postMessage({ type: "loading" });
    const transcriber = await getTranscriber(msg.modelKey);
    postMessage({ type: "running" });
    const audio = new Float32Array(msg.audioBuffer);
    const result = await transcriber(audio, {
      language: "japanese",
      task: "transcribe",
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    postMessage({ type: "done", text: result.text || "" });
  } catch (err) {
    postMessage({ type: "error", message: String(err && err.message ? err.message : err) });
  }
};
