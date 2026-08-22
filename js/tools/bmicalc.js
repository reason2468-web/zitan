(() => {
  const heightInput = document.getElementById("bmi-height");
  const weightInput = document.getElementById("bmi-weight");
  const resultEl = document.getElementById("bmi-result");

  // 日本肥満学会の判定基準
  function judgeCategory(bmi) {
    if (bmi < 18.5) return "低体重(やせ型)";
    if (bmi < 25) return "普通体重";
    if (bmi < 30) return "肥満(1度)";
    if (bmi < 35) return "肥満(2度)";
    if (bmi < 40) return "肥満(3度)";
    return "肥満(4度)";
  }

  function update() {
    const heightCm = Number(heightInput.value);
    const weightKg = Number(weightInput.value);
    if (!heightCm || !weightKg || heightCm <= 0 || weightKg <= 0) {
      resultEl.innerHTML = "";
      return;
    }
    const heightM = heightCm / 100;
    const bmi = weightKg / (heightM * heightM);
    const standardWeight = 22 * heightM * heightM;
    const minWeight = 18.5 * heightM * heightM;
    const maxWeight = 25 * heightM * heightM;

    resultEl.innerHTML = `
      <li><span class="cc-label">BMI</span><strong class="cc-value">${bmi.toFixed(1)}</strong></li>
      <li><span class="cc-label">判定</span><strong class="cc-value">${judgeCategory(bmi)}</strong></li>
      <li><span class="cc-label">標準体重(BMI22)</span><strong class="cc-value">${standardWeight.toFixed(1)}kg</strong></li>
      <li><span class="cc-label">普通体重の範囲</span><strong class="cc-value">${minWeight.toFixed(1)}kg 〜 ${maxWeight.toFixed(1)}kg</strong></li>
    `;
  }

  [heightInput, weightInput].forEach((el) => el.addEventListener("input", update));
  update();
})();
