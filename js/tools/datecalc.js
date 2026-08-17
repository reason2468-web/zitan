(() => {
  const modeRadios = document.querySelectorAll('input[name="datecalc-mode"]');
  const diffControls = document.getElementById("dc-diff-controls");
  const addControls = document.getElementById("dc-add-controls");

  const startInput = document.getElementById("dc-start");
  const endInput = document.getElementById("dc-end");
  const inclusiveRadios = document.querySelectorAll('input[name="dc-inclusive"]');
  const diffResult = document.getElementById("dc-diff-result");

  const baseInput = document.getElementById("dc-base");
  const daysInput = document.getElementById("dc-days");
  const directionRadios = document.querySelectorAll('input[name="dc-direction"]');
  const addResult = document.getElementById("dc-add-result");

  const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
  const DAY_MS = 24 * 60 * 60 * 1000;

  // input[type=date]の値("YYYY-MM-DD")をローカル時間のDateに変換する
  // (new Date("YYYY-MM-DD")はUTCとして解釈されるため、タイムゾーンによって日付がずれることがある)
  function parseDateInput(str) {
    if (!str) return null;
    const [y, m, d] = str.split("-").map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  }

  function toDateInputValue(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function formatDate(date) {
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日(${WEEKDAYS[date.getDay()]})`;
  }

  function updateDiff() {
    const start = parseDateInput(startInput.value);
    const end = parseDateInput(endInput.value);
    if (!start || !end) {
      diffResult.innerHTML = "";
      return;
    }
    const inclusive = document.querySelector('input[name="dc-inclusive"]:checked').value === "inclusive";
    let days = Math.round((end - start) / DAY_MS);
    if (inclusive) days += days >= 0 ? 1 : -1;

    diffResult.innerHTML = `
      <li><span class="cc-label">開始日</span><strong class="cc-value">${formatDate(start)}</strong></li>
      <li><span class="cc-label">終了日</span><strong class="cc-value">${formatDate(end)}</strong></li>
      <li><span class="cc-label">日数</span><strong class="cc-value">${days}日</strong></li>
    `;
  }

  function updateAdd() {
    const base = parseDateInput(baseInput.value);
    const days = Number(daysInput.value);
    if (!base || !isFinite(days)) {
      addResult.innerHTML = "";
      return;
    }
    const direction = document.querySelector('input[name="dc-direction"]:checked').value;
    const sign = direction === "before" ? -1 : 1;
    const target = new Date(base);
    target.setDate(target.getDate() + sign * days);

    addResult.innerHTML = `
      <li><span class="cc-label">基準日</span><strong class="cc-value">${formatDate(base)}</strong></li>
      <li><span class="cc-label">計算結果</span><strong class="cc-value">${formatDate(target)}</strong></li>
    `;
  }

  modeRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      const mode = document.querySelector('input[name="datecalc-mode"]:checked').value;
      diffControls.hidden = mode !== "diff";
      addControls.hidden = mode !== "add";
    });
  });

  [startInput, endInput].forEach((el) => el.addEventListener("input", updateDiff));
  inclusiveRadios.forEach((r) => r.addEventListener("change", updateDiff));
  [baseInput, daysInput].forEach((el) => el.addEventListener("input", updateAdd));
  directionRadios.forEach((r) => r.addEventListener("change", updateAdd));

  const today = new Date();
  const weekLater = new Date(today);
  weekLater.setDate(weekLater.getDate() + 7);
  startInput.value = toDateInputValue(today);
  endInput.value = toDateInputValue(weekLater);
  baseInput.value = toDateInputValue(today);

  updateDiff();
  updateAdd();
})();
