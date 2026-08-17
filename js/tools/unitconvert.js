(() => {
  const CATEGORIES = {
    length: {
      defaultUnit: "cm",
      units: {
        mm: { label: "mm(ミリメートル)", toBase: 0.001 },
        cm: { label: "cm(センチメートル)", toBase: 0.01 },
        m: { label: "m(メートル)", toBase: 1 },
        km: { label: "km(キロメートル)", toBase: 1000 },
        inch: { label: "inch(インチ)", toBase: 0.0254 },
        feet: { label: "feet(フィート)", toBase: 0.3048 },
        mile: { label: "mile(マイル)", toBase: 1609.344 },
      },
    },
    weight: {
      defaultUnit: "kg",
      units: {
        mg: { label: "mg(ミリグラム)", toBase: 0.001 },
        g: { label: "g(グラム)", toBase: 1 },
        kg: { label: "kg(キログラム)", toBase: 1000 },
        oz: { label: "oz(オンス)", toBase: 28.3495 },
        lb: { label: "lb(ポンド)", toBase: 453.592 },
      },
    },
    temperature: {
      defaultUnit: "c",
      special: true,
      units: {
        c: { label: "℃(摂氏)" },
        f: { label: "℉(華氏)" },
        k: { label: "K(ケルビン)" },
      },
    },
  };

  const valueInput = document.getElementById("unitconvert-value");
  const unitSelect = document.getElementById("unitconvert-unit");
  const resultList = document.getElementById("unitconvert-result-list");
  const categoryRadios = document.querySelectorAll('input[name="unitconvert-category"]');

  function toCelsius(value, unit) {
    if (unit === "c") return value;
    if (unit === "f") return (value - 32) * 5 / 9;
    return value - 273.15;
  }

  function fromCelsius(c, unit) {
    if (unit === "c") return c;
    if (unit === "f") return c * 9 / 5 + 32;
    return c + 273.15;
  }

  function getCategory() {
    return CATEGORIES[document.querySelector('input[name="unitconvert-category"]:checked').value];
  }

  function populateUnitSelect() {
    const cat = getCategory();
    unitSelect.innerHTML = Object.entries(cat.units)
      .map(([key, u]) => `<option value="${key}">${u.label}</option>`)
      .join("");
    unitSelect.value = cat.defaultUnit;
  }

  function formatNumber(n) {
    if (!isFinite(n)) return "-";
    const rounded = Math.round(n * 1000) / 1000;
    return rounded.toLocaleString("ja-JP", { maximumFractionDigits: 3 });
  }

  function update() {
    const cat = getCategory();
    const value = Number(valueInput.value);
    const fromUnit = unitSelect.value;

    if (!isFinite(value) || valueInput.value.trim() === "") {
      resultList.innerHTML = "";
      return;
    }

    let results;
    if (cat.special) {
      const c = toCelsius(value, fromUnit);
      results = Object.entries(cat.units).map(([key, u]) => [key, u.label, fromCelsius(c, key)]);
    } else {
      const baseValue = value * cat.units[fromUnit].toBase;
      results = Object.entries(cat.units).map(([key, u]) => [key, u.label, baseValue / u.toBase]);
    }

    resultList.innerHTML = results
      .map(([key, label, v]) => `
        <li>
          <span class="cc-label">${label}</span>
          <strong class="cc-value">${key === fromUnit ? "" : "≈ "}${formatNumber(v)}</strong>
        </li>
      `)
      .join("");
  }

  categoryRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      populateUnitSelect();
      update();
    });
  });
  valueInput.addEventListener("input", update);
  unitSelect.addEventListener("change", update);

  populateUnitSelect();
  update();
})();
