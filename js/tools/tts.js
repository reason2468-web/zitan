(() => {
  const unsupportedNote = document.getElementById("tts-unsupported");
  const textInput = document.getElementById("tts-text");
  const voiceSelect = document.getElementById("tts-voice");
  const rateInput = document.getElementById("tts-rate");
  const rateVal = document.getElementById("tts-rate-val");
  const pitchInput = document.getElementById("tts-pitch");
  const pitchVal = document.getElementById("tts-pitch-val");
  const playBtn = document.getElementById("tts-play");
  const pauseBtn = document.getElementById("tts-pause");
  const stopBtn = document.getElementById("tts-stop");
  const resultArea = document.getElementById("tts-result");

  if (!("speechSynthesis" in window)) {
    unsupportedNote.hidden = false;
    return;
  }

  let voices = [];
  let isPaused = false;

  function populateVoices() {
    voices = window.speechSynthesis.getVoices();
    if (!voices.length) return;

    // 日本語の声を上のほうに並べる(それ以外の言語の声も一応選べるようにしておく)
    const order = voices
      .map((v, i) => i)
      .sort((a, b) => {
        const aJa = voices[a].lang.startsWith("ja") ? 0 : 1;
        const bJa = voices[b].lang.startsWith("ja") ? 0 : 1;
        if (aJa !== bJa) return aJa - bJa;
        return voices[a].name.localeCompare(voices[b].name);
      });

    voiceSelect.innerHTML = order
      .map((i) => `<option value="${i}">${voices[i].name}(${voices[i].lang})${voices[i].default ? " ※標準" : ""}</option>`)
      .join("");

    const jaIndex = voices.findIndex((v) => v.lang.startsWith("ja"));
    if (jaIndex !== -1) voiceSelect.value = String(jaIndex);

    playBtn.disabled = false;
  }

  populateVoices();
  // 声の一覧は非同期に読み込まれるブラウザがあるため、変化を検知して再取得する
  window.speechSynthesis.onvoiceschanged = populateVoices;

  rateInput.addEventListener("input", () => {
    rateVal.textContent = Number(rateInput.value).toFixed(1);
  });
  pitchInput.addEventListener("input", () => {
    pitchVal.textContent = Number(pitchInput.value).toFixed(1);
  });

  // 長い文章は句点などで区切って、順番に読み上げる
  // (一度に長すぎる文章を読み上げようとすると、ブラウザによっては途中で止まることがあるため)
  function splitIntoChunks(text) {
    return text
      .split(/(?<=[。!?！?\n])/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  function resetButtons() {
    playBtn.disabled = false;
    pauseBtn.disabled = true;
    pauseBtn.textContent = "一時停止";
    stopBtn.disabled = true;
    isPaused = false;
  }

  playBtn.addEventListener("click", () => {
    const text = textInput.value.trim();
    if (!text) return;

    window.speechSynthesis.cancel();
    resultArea.innerHTML = "";

    const chunks = splitIntoChunks(text);
    const selectedVoice = voices[Number(voiceSelect.value)];
    const rate = Number(rateInput.value);
    const pitch = Number(pitchInput.value);

    chunks.forEach((chunk, i) => {
      const utterance = new SpeechSynthesisUtterance(chunk);
      if (selectedVoice) utterance.voice = selectedVoice;
      utterance.rate = rate;
      utterance.pitch = pitch;
      if (i === chunks.length - 1) {
        utterance.onend = resetButtons;
        utterance.onerror = resetButtons;
      }
      window.speechSynthesis.speak(utterance);
    });

    playBtn.disabled = true;
    pauseBtn.disabled = false;
    pauseBtn.textContent = "一時停止";
    stopBtn.disabled = false;
    isPaused = false;
  });

  pauseBtn.addEventListener("click", () => {
    if (!isPaused) {
      window.speechSynthesis.pause();
      isPaused = true;
      pauseBtn.textContent = "再開";
    } else {
      window.speechSynthesis.resume();
      isPaused = false;
      pauseBtn.textContent = "一時停止";
    }
  });

  stopBtn.addEventListener("click", () => {
    window.speechSynthesis.cancel();
    resetButtons();
  });
})();
