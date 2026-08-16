(() => {
  const zipRadio = document.getElementById("save-mode-zip");
  const folderRadio = document.getElementById("save-mode-folder");
  const folderRow = document.getElementById("folder-picker-row");
  const chooseFolderBtn = document.getElementById("choose-folder-btn");
  const chosenFolderName = document.getElementById("chosen-folder-name");

  if (getSaveMode() === "folder" && supportsFolderSave()) {
    folderRadio.checked = true;
    folderRow.hidden = false;
  }

  if (!supportsFolderSave()) {
    folderRadio.disabled = true;
  }

  zipRadio.addEventListener("change", () => {
    setSaveMode("zip");
    folderRow.hidden = true;
  });

  folderRadio.addEventListener("change", () => {
    setSaveMode("folder");
    folderRow.hidden = false;
  });

  chooseFolderBtn.addEventListener("click", async () => {
    try {
      const handle = await pickSaveDirectory();
      chosenFolderName.textContent = `選択中のフォルダ: ${handle.name}`;
    } catch (err) {
      // フォルダ選択をキャンセルした場合は何もしない
    }
  });

  // ---------- 保存名の付け方 ----------

  const namingSimpleRadio = document.getElementById("naming-mode-simple");
  const namingProRadio = document.getElementById("naming-mode-pro");
  const namingProBlock = document.getElementById("naming-pro-block");
  const templateInput = document.getElementById("naming-template-input");
  const simplePreview = document.getElementById("simple-preview-text");
  const proPreview = document.getElementById("pro-preview-text");

  const PREVIEW_CONTEXT = { category: "画像", tool: "圧縮" };

  function refreshNamingPreviews() {
    simplePreview.textContent = formatSaveName(DEFAULT_NAMING_TEMPLATE, PREVIEW_CONTEXT);
    proPreview.textContent = formatSaveName(templateInput.value.trim() || DEFAULT_NAMING_TEMPLATE, PREVIEW_CONTEXT);
  }

  templateInput.value = getNamingTemplate();

  if (getNamingMode() === "pro") {
    namingProRadio.checked = true;
    namingProBlock.hidden = false;
  }

  namingSimpleRadio.addEventListener("change", () => {
    setNamingMode("simple");
    namingProBlock.hidden = true;
  });

  namingProRadio.addEventListener("change", () => {
    setNamingMode("pro");
    namingProBlock.hidden = false;
    refreshNamingPreviews();
  });

  templateInput.addEventListener("input", () => {
    setNamingTemplate(templateInput.value);
    refreshNamingPreviews();
  });

  refreshNamingPreviews();
})();
