(() => {
  const textInput = document.getElementById("charcount-text");
  const els = {
    total: document.getElementById("cc-total"),
    noSpace: document.getElementById("cc-no-space"),
    noPunct: document.getElementById("cc-no-punct"),
    kanji: document.getElementById("cc-kanji"),
    hiragana: document.getElementById("cc-hiragana"),
    katakana: document.getElementById("cc-katakana"),
    alnum: document.getElementById("cc-alnum"),
    genko: document.getElementById("cc-genko"),
  };

  function countMatches(text, regex) {
    return (text.match(regex) || []).length;
  }

  function update() {
    const text = textInput.value;
    const total = Array.from(text).length;
    const noSpace = Array.from(text.replace(/[\s　]/g, "")).length;
    const noPunct = total - countMatches(text, /\p{P}/gu);
    const kanji = countMatches(text, /\p{Script=Han}/gu);
    const hiragana = countMatches(text, /\p{Script=Hiragana}/gu);
    const katakana = countMatches(text, /\p{Script=Katakana}/gu);
    const alnum = countMatches(text, /[A-Za-z0-9０-９Ａ-Ｚａ-ｚ]/g);

    els.total.textContent = total;
    els.noSpace.textContent = noSpace;
    els.noPunct.textContent = noPunct;
    els.kanji.textContent = kanji;
    els.hiragana.textContent = hiragana;
    els.katakana.textContent = katakana;
    els.alnum.textContent = alnum;
    els.genko.textContent = (total / 400).toFixed(1) + "枚";
  }

  textInput.addEventListener("input", update);
  update();
})();
