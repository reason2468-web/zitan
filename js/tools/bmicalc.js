(() => {
  const heightInput = document.getElementById("bmi-height");
  const weightInput = document.getElementById("bmi-weight");
  const summaryEl = document.getElementById("bmi-summary");
  const tableBodyEl = document.getElementById("bmi-table-body");

  // 日本肥満学会の判定基準([下限, 上限, 呼び名])。上限がnullの行は上限なし
  const CATEGORIES = [
    { min: 0, max: 18.5, label: "低体重(やせ型)", rangeLabel: "18.5未満" },
    { min: 18.5, max: 25, label: "普通体重", rangeLabel: "18.5〜25未満" },
    { min: 25, max: 30, label: "肥満(1度)", rangeLabel: "25〜30未満" },
    { min: 30, max: 35, label: "肥満(2度)", rangeLabel: "30〜35未満" },
    { min: 35, max: 40, label: "肥満(3度)", rangeLabel: "35〜40未満" },
    { min: 40, max: null, label: "肥満(4度)", rangeLabel: "40以上" },
  ];

  function judgeCategory(bmi) {
    return CATEGORIES.find((c) => c.max === null || bmi < c.max) || CATEGORIES[CATEGORIES.length - 1];
  }

  function formatKg(kg) {
    return `${kg.toFixed(1)}kg`;
  }

  function formatSigned(kg) {
    const sign = kg > 0 ? "+" : kg < 0 ? "" : "±";
    return `${sign}${kg.toFixed(1)}kg`;
  }

  function update() {
    const heightCm = Number(heightInput.value);
    const weightKg = Number(weightInput.value);
    if (!heightCm || !weightKg || heightCm <= 0 || weightKg <= 0) {
      summaryEl.innerHTML = "";
      tableBodyEl.innerHTML = "";
      return;
    }
    const heightM = heightCm / 100;
    const heightSq = heightM * heightM;
    const bmi = weightKg / heightSq;
    const standardWeight = 22 * heightSq;
    const diff = weightKg - standardWeight;
    const current = judgeCategory(bmi);

    summaryEl.innerHTML = `
      <li><span class="cc-label">BMI</span><strong class="cc-value">${bmi.toFixed(1)}</strong></li>
      <li><span class="cc-label">判定</span><strong class="cc-value">${current.label}</strong></li>
      <li><span class="cc-label">標準体重(BMI22)</span><strong class="cc-value">${formatKg(standardWeight)}</strong></li>
      <li><span class="cc-label">標準体重との差</span><strong class="cc-value">${formatSigned(diff)}</strong></li>
    `;

    tableBodyEl.innerHTML = CATEGORIES.map((c) => {
      const minKg = c.min * heightSq;
      const weightRangeLabel = c.max === null
        ? `${minKg.toFixed(1)}kg以上`
        : `${minKg.toFixed(1)}kg 〜 ${(c.max * heightSq).toFixed(1)}kg`;
      const isCurrent = c === current;
      return `
        <tr class="${isCurrent ? "bmi-table-current" : ""}">
          <td>${c.rangeLabel}</td>
          <td>${c.label}</td>
          <td>${weightRangeLabel}</td>
          <td>${isCurrent ? formatKg(standardWeight) : ""}</td>
        </tr>
      `;
    }).join("");
  }

  [heightInput, weightInput].forEach((el) => el.addEventListener("input", update));
  update();
})();
