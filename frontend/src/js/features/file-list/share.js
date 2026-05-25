import { showError, showNotification } from "../../core/toast.js";
import { appState } from "../state.js";

function getFileByPath(filePath) {
  return (
    appState.vpkFiles.find((file) => file.path === filePath) ||
    appState.allVpkFiles.find((file) => file.path === filePath) ||
    null
  );
}

function getSelectedFilesInListOrder() {
  const selectedPaths = appState.selectedFiles;
  const files = [];
  const addedPaths = new Set();

  appState.vpkFiles.forEach((file) => {
    if (selectedPaths.has(file.path)) {
      files.push(file);
      addedPaths.add(file.path);
    }
  });

  appState.allVpkFiles.forEach((file) => {
    if (selectedPaths.has(file.path) && !addedPaths.has(file.path)) {
      files.push(file);
      addedPaths.add(file.path);
    }
  });

  return files;
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (err) {
      console.error("Clipboard API copy failed:", err);
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("execCommand copy failed");
    }
  } finally {
    document.body.removeChild(textarea);
  }
}

export async function shareWorkshopItems(files) {
  const items = Array.isArray(files) ? files.filter(Boolean) : [];
  if (items.length === 0) {
    showNotification("请先选择文件", "info");
    return;
  }

  const ids = [];
  const seenIds = new Set();
  let missingCount = 0;

  items.forEach((file) => {
    const workshopId = String(file?.workshopId || "").trim();
    if (!workshopId) {
      missingCount++;
      return;
    }

    if (!seenIds.has(workshopId)) {
      seenIds.add(workshopId);
      ids.push(workshopId);
    }
  });

  if (ids.length === 0) {
    showNotification(`有 ${missingCount} 个 Mod 没有工坊 ID，未复制`, "info");
    return;
  }

  try {
    await copyTextToClipboard(ids.join(","));
    showNotification(`已复制 ${ids.length} 个工坊 ID`, "success");
    if (missingCount > 0) {
      showNotification(`有 ${missingCount} 个 Mod 没有工坊 ID，已跳过`, "info");
    }
  } catch (err) {
    console.error("复制工坊 ID 失败:", err);
    showError("复制失败");
  }
}

export function shareWorkshopItem(file) {
  return shareWorkshopItems([file]);
}

export function shareWorkshopFileByPath(filePath) {
  return shareWorkshopItem(getFileByPath(filePath));
}

export function shareSelectedWorkshopItems() {
  return shareWorkshopItems(getSelectedFilesInListOrder());
}
