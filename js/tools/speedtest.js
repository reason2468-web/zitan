(() => {
  const startBtn = document.getElementById("speedtest-start");
  const statusEl = document.getElementById("speedtest-status");
  const statsEl = document.getElementById("speedtest-stats");
  const errorEl = document.getElementById("speedtest-error");
  const downloadEl = document.getElementById("speedtest-download");
  const uploadEl = document.getElementById("speedtest-upload");
  const latencyEl = document.getElementById("speedtest-latency");
  const jitterEl = document.getElementById("speedtest-jitter");

  const STATUS_TEXT = {
    latency: "応答速度(Ping)を測定中...",
    download: "ダウンロード速度を測定中...",
    upload: "アップロード速度を測定中...",
    packetLoss: "パケットロスを測定中...",
  };

  function fmtMbps(bps) {
    if (typeof bps !== "number" || !isFinite(bps)) return "-";
    return (bps / 1e6).toFixed(1);
  }

  function fmtMs(ms) {
    if (typeof ms !== "number" || !isFinite(ms)) return "-";
    return ms.toFixed(1);
  }

  let engine = null;

  startBtn.addEventListener("click", async () => {
    startBtn.disabled = true;
    errorEl.hidden = true;
    statsEl.hidden = true;
    downloadEl.textContent = "-";
    uploadEl.textContent = "-";
    latencyEl.textContent = "-";
    jitterEl.textContent = "-";
    statusEl.textContent = "測定エンジンを読み込み中...";

    try {
      const mod = await import("https://cdn.jsdelivr.net/npm/@cloudflare/speedtest@1.13.0/dist/speedtest.min.js");
      const SpeedTestEngine = mod.default;

      engine = new SpeedTestEngine({
        autoStart: false,
        measurements: [
          { type: "latency", numPackets: 20 },
          { type: "download", bytes: 1e5, count: 1, bypassMinDuration: true },
          { type: "download", bytes: 1e6, count: 8 },
          { type: "download", bytes: 1e7, count: 6 },
          { type: "download", bytes: 2.5e7, count: 4 },
          { type: "upload", bytes: 1e5, count: 8 },
          { type: "upload", bytes: 1e6, count: 6 },
          { type: "upload", bytes: 1e7, count: 4 },
        ],
      });

      engine.onResultsChange = ({ type }) => {
        statusEl.textContent = STATUS_TEXT[type] || "測定中...";
      };

      engine.onFinish = (results) => {
        downloadEl.textContent = `${fmtMbps(results.getDownloadBandwidth())} Mbps`;
        uploadEl.textContent = `${fmtMbps(results.getUploadBandwidth())} Mbps`;
        latencyEl.textContent = `${fmtMs(results.getUnloadedLatency())} ms`;
        jitterEl.textContent = `${fmtMs(results.getUnloadedJitter())} ms`;
        statsEl.hidden = false;
        statusEl.textContent = "";
        startBtn.disabled = false;
        startBtn.textContent = "もう一度測定する";
      };

      engine.onError = (err) => {
        statusEl.textContent = "";
        errorEl.textContent = `測定中にエラーが発生しました: ${err}`;
        errorEl.hidden = false;
        startBtn.disabled = false;
      };

      engine.play();
    } catch (err) {
      statusEl.textContent = "";
      errorEl.textContent = "測定エンジンの読み込みに失敗しました。通信環境を確認して、もう一度お試しください。";
      errorEl.hidden = false;
      startBtn.disabled = false;
    }
  });
})();
