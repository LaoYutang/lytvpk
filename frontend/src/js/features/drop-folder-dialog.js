export function chooseDroppedFolderAction(folder, addonsDir) {
  const hasVPKs = folder.vpkPaths.length > 0;
  const mixed = folder.hasResources && hasVPKs;
  const dialog = document.createElement("dialog");
  dialog.className = "drop-folder-dialog";
  dialog.setAttribute("aria-labelledby", "drop-folder-title");
  dialog.setAttribute("aria-describedby", "drop-folder-description");
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") event.stopPropagation();
  });

  const form = document.createElement("form");
  form.method = "dialog";
  const title = document.createElement("h2");
  title.id = "drop-folder-title";
  title.textContent = hasVPKs ? "确认导入文件夹中的 VPK" : "确认打包资源目录";
  if (mixed) title.textContent = "选择文件夹的处理方式";

  const description = document.createElement("p");
  description.id = "drop-folder-description";
  description.textContent = hasVPKs
    ? `在 ${folder.path} 中找到 ${folder.vpkPaths.length} 个 VPK 文件`
    : `将 ${folder.path} 打包为 VPK`;
  form.append(title, description);

  if (hasVPKs) {
    const files = document.createElement("pre");
    files.className = "drop-folder-files";
    files.tabIndex = 0;
    files.setAttribute("aria-label", "找到的 VPK 文件");
    files.textContent = folder.vpkPaths.join("\n");
    form.appendChild(files);
  }

  const destination = document.createElement("p");
  destination.textContent = addonsDir ? `目标 addons：${addonsDir}` : "请先设置游戏 addons 目录，再拖入文件夹";
  form.appendChild(destination);
  if (mixed) {
    const packNote = document.createElement("p");
    packNote.textContent = "打包资源目录时会跳过列表中的现有 VPK。";
    form.appendChild(packNote);
  }

  const footer = document.createElement("div");
  footer.className = "drop-folder-actions";
  const cancel = actionButton("取消", "", "btn-secondary");
  cancel.autofocus = true;
  footer.appendChild(cancel);
  if (folder.hasResources) {
    const pack = actionButton(mixed ? "打包资源目录" : "确认打包", "pack", mixed ? "btn-secondary" : "btn-primary");
    pack.disabled = !addonsDir;
    footer.appendChild(pack);
  }
  if (hasVPKs) {
    const importButton = actionButton(mixed ? "导入其中的 VPK" : "确认导入", "import", "btn-primary");
    importButton.disabled = !addonsDir;
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
