(() => {
  const modeRadios = document.querySelectorAll('input[name="pdftools-mode"]');
  const mergePanel = document.getElementById("pdfmerge");
  const splitPanel = document.getElementById("pdfsplit");
  const deskPanel = document.getElementById("pdfdesk");

  modeRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      const mode = document.querySelector('input[name="pdftools-mode"]:checked').value;
      mergePanel.hidden = mode !== "merge";
      splitPanel.hidden = mode !== "split";
      deskPanel.hidden = mode !== "desk";
    });
  });
})();
