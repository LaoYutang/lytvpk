import { appState } from "../state.js";
import { showError, showNotification } from "../../core/toast.js";
import { showConfirmModal } from "../modals/confirm.js";
import { refreshFilesKeepFilter } from "./filters.js";
import {
  ToggleVPKFile,
  MoveWorkshopToAddons,
  DeleteVPKFile,
  OpenFileLocation,
  RenameVPKFile,
  ToggleVPKVisibility,
} from "../../../../wailsjs/go/app/App";

export async function toggleFile(filePath) {
  try {
    console.log("切换文件状态:", filePath);
    await ToggleVPKFile(filePath);
    await refreshFilesKeepFilter();
    showNotification("文件状态已更新", "success");
  } catch (error) {
    console.error("切换文件状态失败:", error);
    showError("操作失败: " + error);
  }
}

export async function moveFileToAddons(filePath) {
  try {
    console.log("转移文件到插件目录:", filePath);
    await MoveWorkshopToAddons(filePath);
    await refreshFilesKeepFilter();
    showNotification("文件已转移到插件目录", "success");
  } catch (error) {
    console.error("转移文件失败:", error);
    showError("转移失败: " + error);
  }
}

export function deleteFile(filePath) {
  showConfirmModal("确认删除", "确定要将此文件移至回收站吗？", async () => {
    try {
      console.log("删除文件:", filePath);
      await DeleteVPKFile(filePath);
      await refreshFilesKeepFilter();
      showNotification("文件已移至回收站", "success");
    } catch (error) {
      console.error("删除文件失败:", error);
      showError("删除失败: " + error);
    }
  });
}

export async function openFileLocation(filePath) {
  try {
    console.log("打开文件所在位置:", filePath);
    await OpenFileLocation(filePath);
    showNotification("已打开文件所在位置", "success");
  } catch (error) {
    console.error("打开文件位置失败:", error);
    showError("打开位置失败: " + error);
  }
}

export async function toggleFileVisibility(filePath) {
  try {
    console.log("切换文件隐藏状态:", filePath);
    await ToggleVPKVisibility(filePath);
    await refreshFilesKeepFilter();
    showNotification("文件隐藏状态已更新", "success");
  } catch (error) {
    console.error("切换隐藏状态失败:", error);
    showError("操作失败: " + error);
  }
}

function sanitizeRenameTitle(title) {
  const cleaned = String(title || "")
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, " ")
    .replace(/\.vpk$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");

  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned)) {
    return `_${cleaned}`;
  }

  return cleaned;
}

export async function renameFile(filePath) {
  const file = appState.vpkFiles.find((f) => f.path === filePath);
  if (!file) return;

  const fileName = file.name;
  const isHidden = fileName.startsWith("_");

  let editName = fileName;
  const tagMatch = fileName.match(/^_?\[(.*?)\](.*)$/);
  if (tagMatch) {
    editName = (tagMatch[1] || "") + tagMatch[2];
  }

  if (isHidden) {
    editName = editName.substring(1);
  }
  if (editName.toLowerCase().endsWith(".vpk")) {
    editName = editName.substring(0, editName.length - 4);
  }

  const modal = document.getElementById("rename-modal");
  const input = document.getElementById("rename-input");
  const fillFromTitleBtn = document.getElementById("fill-rename-from-title-btn");
  const confirmBtn = document.getElementById("confirm-rename-btn");
  const cancelBtn = document.getElementById("cancel-rename-btn");
  const closeBtn = document.getElementById("close-rename-modal-btn");
  const modTitle = sanitizeRenameTitle(file.title);

  input.value = editName;
  if (fillFromTitleBtn) {
    fillFromTitleBtn.disabled = !modTitle;
    fillFromTitleBtn.title = modTitle
      ? "使用 addoninfo 中的 Mod 名称"
      : "未解析到 Mod 名称";
  }
  modal.classList.remove("hidden");
  input.focus();
  input.select();

  const cleanup = () => {
    modal.classList.add("hidden");
    confirmBtn.onclick = null;
    cancelBtn.onclick = null;
    closeBtn.onclick = null;
    if (fillFromTitleBtn) {
      fillFromTitleBtn.onclick = null;
    }
    input.onkeydown = null;
  };

  const fillFromTitle = () => {
    if (!modTitle) {
      showError("未解析到 Mod 名称");
      return;
    }

    input.value = modTitle;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  };

  const doRename = async () => {
    const newName = input.value.trim();
    if (!newName) {
      showError("文件名不能为空");
      return;
    }

    if (newName === editName) {
      cleanup();
      return;
    }

    let finalName = newName;
    if (!finalName.toLowerCase().endsWith(".vpk")) {
      finalName += ".vpk";
    }
    if (isHidden) {
      finalName = "_" + finalName;
    }

    try {
      await RenameVPKFile(filePath, finalName);
      showNotification("重命名成功", "success");
      cleanup();
      await refreshFilesKeepFilter();
    } catch (error) {
      console.error("重命名失败:", error);
      showError("重命名失败: " + error);
    }
  };

  if (fillFromTitleBtn) {
    fillFromTitleBtn.onclick = fillFromTitle;
  }
  confirmBtn.onclick = doRename;
  cancelBtn.onclick = cleanup;
  closeBtn.onclick = cleanup;

  input.onkeydown = (e) => {
    if (e.key === "Enter") {
      doRename();
    } else if (e.key === "Escape") {
      cleanup();
    }
  };
}
