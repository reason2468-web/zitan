(() => {
  const CATEGORIES = {
    length: {
      defaultUnit: "cm",
      units: {
        mm: { label: "mm(ミリメートル)", symbol: "mm", toBase: 0.001 },
        cm: { label: "cm(センチメートル)", symbol: "cm", toBase: 0.01 },
        m: { label: "m(メートル)", symbol: "m", toBase: 1 },
        km: { label: "km(キロメートル)", symbol: "km", toBase: 1000 },
        inch: { label: "inch(インチ)", symbol: "inch", toBase: 0.0254 },
        feet: { label: "feet(フィート)", symbol: "ft", toBase: 0.3048 },
        mile: { label: "mile(マイル)", symbol: "mi", toBase: 1609.344 },
      },
    },
    weight: {
      defaultUnit: "kg",
      units: {
        mg: { label: "mg(ミリグラム)", symbol: "mg", toBase: 0.001 },
        g: { label: "g(グラム)", symbol: "g", toBase: 1 },
        kg: { label: "kg(キログラム)", symbol: "kg", toBase: 1000 },
        t: { label: "t(トン)", symbol: "t", toBase: 1000000 },
        oz: { label: "oz(オンス)", symbol: "oz", toBase: 28.3495 },
        lb: { label: "lb(ポンド)", symbol: "lb", toBase: 453.592 },
      },
    },
    temperature: {
      defaultUnit: "c",
      special: true,
      units: {
        c: { label: "℃(摂氏)", symbol: "℃" },
        f: { label: "℉(華氏)", symbol: "℉" },
        k: { label: "K(ケルビン)", symbol: "K" },
      },
    },
    area: {
      defaultUnit: "m2",
      units: {
        cm2: { label: "cm²(平方センチメートル)", symbol: "cm²", toBase: 0.0001 },
        m2: { label: "m²(平方メートル)", symbol: "m²", toBase: 1 },
        km2: { label: "km²(平方キロメートル)", symbol: "km²", toBase: 1000000 },
        tsubo: { label: "坪", symbol: "坪", toBase: 3.30578 },
        tatami: { label: "畳(帖・目安)", symbol: "畳", toBase: 1.62 },
        ha: { label: "ha(ヘクタール)", symbol: "ha", toBase: 10000 },
        acre: { label: "acre(エーカー)", symbol: "acre", toBase: 4046.86 },
      },
    },
    volume: {
      defaultUnit: "ml",
      units: {
        ml: { label: "ml(ミリリットル)", symbol: "ml", toBase: 1 },
        l: { label: "L(リットル)", symbol: "L", toBase: 1000 },
        m3: { label: "m³(立方メートル)", symbol: "m³", toBase: 1000000 },
        cup: { label: "カップ(料理用・200ml)", symbol: "カップ", toBase: 200 },
        go: { label: "合(米・お酒)", symbol: "合", toBase: 180.39 },
        gallon: { label: "gallon(米ガロン)", symbol: "gal", toBase: 3785.41 },
      },
    },
    speed: {
      defaultUnit: "kmh",
      units: {
        ms: { label: "m/s(メートル毎秒)", symbol: "m/s", toBase: 1 },
        kmh: { label: "km/h(時速)", symbol: "km/h", toBase: 0.277778 },
        mph: { label: "mph(マイル毎時)", symbol: "mph", toBase: 0.44704 },
        knot: { label: "ノット", symbol: "kt", toBase: 0.514444 },
      },
    },
    dataSize: {
      defaultUnit: "mb",
      units: {
        b: { label: "B(バイト)", symbol: "B", toBase: 1 },
        kb: { label: "KB(キロバイト)", symbol: "KB", toBase: 1024 },
        mb: { label: "MB(メガバイト)", symbol: "MB", toBase: 1024 ** 2 },
        gb: { label: "GB(ギガバイト)", symbol: "GB", toBase: 1024 ** 3 },
        tb: { label: "TB(テラバイト)", symbol: "TB", toBase: 1024 ** 4 },
      },
    },
    // 電子レンジは「W(ワット数)× 秒 = 温める熱量」が一定になるように換算する。
    // toBaseにワット数そのものを使うことで、他カテゴリと同じ計算式(baseValue = 秒数×W)がそのまま使える。
    microwave: {
      defaultUnit: "w600",
      defaultValue: 500,
      hint: "「元は何ワットで何秒か」を、数値(秒)と単位(ワット数)で入力してください",
      units: {
        w500: { label: "500W", symbol: "秒", toBase: 500 },
        w600: { label: "600W", symbol: "秒", toBase: 600 },
        w700: { label: "700W", symbol: "秒", toBase: 700 },
        w800: { label: "800W", symbol: "秒", toBase: 800 },
        w1000: { label: "1000W", symbol: "秒", toBase: 1000 },
        w1200: { label: "1200W", symbol: "秒", toBase: 1200 },
        w1500: { label: "1500W", symbol: "秒", toBase: 1500 },
      },
    },
  };

  const valueInput = document.getElementById("unitconvert-value");
  const unitSelect = document.getElementById("unitconvert-unit");
  const resultList = document.getElementById("unitconvert-result-list");
  const hintEl = document.getElementById("unitconvert-hint");
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
    if (cat.defaultValue !== undefined) valueInput.value = cat.defaultValue;
    hintEl.textContent = cat.hint || "";
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
      results = Object.entries(cat.units).map(([key, u]) => [key, u, fromCelsius(c, key)]);
    } else {
      const baseValue = value * cat.units[fromUnit].toBase;
      results = Object.entries(cat.units).map(([key, u]) => [key, u, baseValue / u.toBase]);
    }

    resultList.innerHTML = results
      .map(([key, u, v]) => `
        <li>
          <span class="cc-label">${u.label}</span>
          <strong class="cc-value">${key === fromUnit ? "" : "≈ "}${formatNumber(v)} ${u.symbol}</strong>
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
