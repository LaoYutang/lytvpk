export function chooseDroppedFolderAction(folder, hasAddons) {
  const vpkCount = folder.vpkPaths.length;
  const hasVPKs = vpkCount > 0;
  const mixed = folder.hasResources && hasVPKs;
  const folderName = folder.path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || folder.path;
  const dialog = document.createElement("dialog");
  dialog.className = "drop-folder-dialog";
  dialog.setAttribute("aria-labelledby", "drop-folder-title");
  dialog.setAttribute("aria-describedby", "drop-folder-description");
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") event.stopPropagation();
  });

  const form = document.createElement("form");
  form.method = "dialog";
  const header = document.createElement("header");
  header.className = "drop-folder-header";
  const title = document.createElement("h2");
  title.id = "drop-folder-title";
  title.textContent = hasVPKs ? "导入已有 VPK" : "打包资源目录";
  if (mixed) title.textContent = "选择文件夹的处理方式";
  header.appendChild(title);
  form.appendChild(header);

  const body = document.createElement("div");
  body.className = "drop-folder-body";
  const description = document.createElement("p");
  description.id = "drop-folder-description";
  description.textContent = hasVPKs
    ? `在「${folderName}」中找到 ${vpkCount} 个 VPK 文件。`
    : `将「${folderName}」中的资源打包成一个 VPK。`;
  body.appendChild(description);

  if (hasVPKs) {
    const files = document.createElement("pre");
    files.className = "drop-folder-files";
    files.tabIndex = 0;
    files.setAttribute("aria-label", "找到的 VPK 文件");
    files.textContent = folder.vpkPaths.join("\n");
    body.appendChild(files);
  }

  if (mixed) {
    const packNote = document.createElement("p");
    packNote.textContent = "打包时会排除已有 VPK 和对应的附属文件。";
    body.appendChild(packNote);
  }
  if (!hasAddons) {
    const notice = document.createElement("p");
    notice.textContent = "请先设置游戏 addons 目录，再拖入文件夹。";
    body.appendChild(notice);
  }
  form.appendChild(body);

  const footer = document.createElement("div");
  footer.className = "drop-folder-actions";
  const cancel = actionButton("取消", "", "btn-secondary");
  cancel.autofocus = true;
  footer.appendChild(cancel);
  if (folder.hasResources) {
    const pack = actionButton(mixed ? "打包资源目录" : "确认打包", "pack", mixed ? "btn-secondary" : "btn-primary");
    pack.disabled = !hasAddons;
    footer.appendChild(pack);
  }
  if (hasVPKs) {
    const importButton = actionButton(mixed ? "导入其中的 VPK" : "确认导入", "import", "btn-primary");
    importButton.disabled = !hasAddons;
    footer.appendChild(importButton);
  }
  form.appendChild(footer);
  dialog.appendChild(form);
  document.body.appendChild(dialog);

  return new Promise((resolve) => {
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(dialog.returnValue);
    }, { once: true });
    dialog.showModal();
  });
}

function actionButton(label, value, style) {
  const button = document.createElement("button");
  button.type = "submit";
  button.value = value;
  button.className = `btn ${style}`;
  button.textContent = label;
  return button;
}
