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

const WINDOWS_PATH_WARNING_LENGTH = 240;
const WINDOWS_MAX_PATH_LENGTH = 260;
const WINDOWS_MAX_FILENAME_LENGTH = 255;

function getDirectoryPath(filePath) {
  const path = String(filePath || "");
  const separatorIndex = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return separatorIndex >= 0 ? path.slice(0, separatorIndex) : "";
}

function joinPathForPreview(dir, filename) {
  if (!dir) return filename;
  if (dir.endsWith("\\") || dir.endsWith("/")) {
    return dir + filename;
  }
  return `${dir}\\${filename}`;
}

function parseFilenameTags(filename) {
  const match = String(filename || "").match(/^(_?)\[(.*?)\](.*)$/);
  if (!match) {
    return { hasTags: false, tags: [] };
  }

  const tags = match[2]
    .split(/[,+]/)
    .map((tag) => tag.trim())
    .filter(Boolean);

  return { hasTags: true, tags };
}

function buildRenamePreview(filePath, oldFileName, inputName, isHidden) {
  let finalName = inputName.trim();
  if (!finalName.toLowerCase().endsWith(".vpk")) {
    finalName += ".vpk";
  }
  if (isHidden) {
    finalName = "_" + finalName;
  }

  const oldTags = parseFilenameTags(oldFileName);
  const newTags = parseFilenameTags(finalName);
  if (oldTags.hasTags && !newTags.hasTags && oldTags.tags.length > 0) {
    let prefix = "";
    let body = finalName;
    if (finalName.startsWith("_")) {
      prefix = "_";
      body = finalName.substring(1);
    }

    finalName = `${prefix}[${oldTags.tags.join("+")}]${body}`;
  }

  return {
    filename: finalName,
    path: joinPathForPreview(getDirectoryPath(filePath), finalName),
  };
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
  const lengthHint = document.getElementById("rename-length-hint");
  const confirmBtn = document.getElementById("confirm-rename-btn");
  const cancelBtn = document.getElementById("cancel-rename-btn");
  const closeBtn = document.getElementById("close-rename-modal-btn");
  const modTitle = sanitizeRenameTitle(file.title);
  let renameLengthState = { hasError: false, message: "" };

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
    input.oninput = null;
    input.onkeydown = null;
  };

  const updateRenameLengthHint = () => {
    const newName = input.value.trim();
    renameLengthState = { hasError: false, message: "" };
    confirmBtn.disabled = false;

    if (!lengthHint) return renameLengthState;

    lengthHint.classList.add("hidden");
    lengthHint.classList.remove("is-warning", "is-error");
    lengthHint.textContent = "";

    if (!newName) {
      return renameLengthState;
    }

    const preview = buildRenamePreview(filePath, fileName, newName, isHidden);
    const filenameLength = preview.filename.length;
    const pathLength = preview.path.length;

    if (filenameLength > WINDOWS_MAX_FILENAME_LENGTH) {
      renameLengthState = {
        hasError: true,
        message: `文件名过长：${filenameLength}/${WINDOWS_MAX_FILENAME_LENGTH}，请缩短名称`,
      };
    } else if (pathLength > WINDOWS_MAX_PATH_LENGTH) {
      renameLengthState = {
        hasError: true,
        message: `完整路径过长：${pathLength}/${WINDOWS_MAX_PATH_LENGTH}，请缩短名称或移动 Mod 目录`,
      };
    } else if (pathLength >= WINDOWS_PATH_WARNING_LENGTH) {
      renameLengthState = {
        hasError: false,
        message: `完整路径较长：${pathLength}/${WINDOWS_MAX_PATH_LENGTH}，接近 Windows 限制`,
      };
    }

    if (renameLengthState.message) {
      lengthHint.textContent = renameLengthState.message;
      lengthHint.classList.remove("hidden");
      lengthHint.classList.add(renameLengthState.hasError ? "is-error" : "is-warning");
    }

    confirmBtn.disabled = renameLengthState.hasError;
    return renameLengthState;
  };

  const fillFromTitle = () => {
    if (!modTitle) {
      showError("未解析到 Mod 名称");
      return;
    }

    input.value = modTitle;
    updateRenameLengthHint();
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

    const lengthState = updateRenameLengthHint();
    if (lengthState.hasError) {
      showError(lengthState.message);
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
  input.oninput = updateRenameLengthHint;

  input.onkeydown = (e) => {
    if (e.key === "Enter") {
      doRename();
    } else if (e.key === "Escape") {
      cleanup();
    }
  };

  updateRenameLengthHint();
}
