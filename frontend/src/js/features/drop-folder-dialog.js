export function chooseDroppedFolderAction(folder, addonsDir) {
  const dialog = document.createElement("dialog");
  dialog.className = "drop-folder-dialog";
  dialog.setAttribute("aria-labelledby", "drop-folder-title");
  dialog.setAttribute("aria-describedby", "drop-folder-description");

  const form = document.createElement("form");
  form.method = "dialog";
  const title = document.createElement("h2");
  title.id = "drop-folder-title";
  title.textContent = folder.hasResources ? "选择文件夹的处理方式" : "确认导入文件夹中的 VPK";

  const description = document.createElement("p");
  description.id = "drop-folder-description";
  description.textContent = `在 ${folder.path} 中找到 ${folder.vpkPaths.length} 个 VPK 文件`;

  const destination = document.createElement("p");
  destination.textContent = addonsDir ? `目标 addons：${addonsDir}` : "请先设置游戏 addons 目录，再拖入文件夹";

  const files = document.createElement("pre");
  files.className = "drop-folder-files";
  files.tabIndex = 0;
  files.setAttribute("aria-label", "找到的 VPK 文件");
  files.textContent = folder.vpkPaths.join("\n");

  const footer = document.createElement("div");
  footer.className = "drop-folder-actions";
  const cancel = actionButton("取消", "", "btn-secondary");
  cancel.autofocus = true;
  footer.appendChild(cancel);
  if (folder.hasResources) {
    const pack = actionButton("打包资源目录", "pack", "btn-secondary");
    pack.disabled = !addonsDir;
    footer.appendChild(pack);
  }
  const importButton = actionButton("导入已有 VPK", "import", "btn-primary");
  importButton.disabled = !addonsDir;
  footer.appendChild(importButton);

  form.append(title, description, files, destination);
  if (folder.hasResources) {
    const packNote = document.createElement("p");
    packNote.textContent = "打包资源目录时会跳过列表中的现有 VPK。";
    form.appendChild(packNote);
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
