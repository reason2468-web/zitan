(() => {
  const modeRadios = document.querySelectorAll('input[name="pdftools-mode"]');
  const mergePanel = document.getElementById("pdfmerge");
  const splitPanel = document.getElementById("pdfsplit");

  modeRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      const mode = document.querySelector('input[name="pdftools-mode"]:checked').value;
      mergePanel.hidden = mode !== "merge";
      splitPanel.hidden = mode !== "split";
    });
  });
})();
