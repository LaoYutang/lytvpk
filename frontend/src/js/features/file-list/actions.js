import {
  appState,
  toggleFileSelection,
  updateStatusBar,
  showLoadingScreen,
  showMainScreen,
  updateLoadingMessage,
} from "../state.js";
import { showError, showNotification, showSuccess } from "../../core/toast.js";
import { showConfirmModal } from "../modals/confirm.js";
import { renderFileList } from "./render.js";
import { refreshFilesKeepFilter } from "./filters.js";
import {
  ToggleVPKFile,
  ExportVPKFilesToZip,
  MoveVpkFiles,
  DeleteVPKFiles,
  SelectDirectory,
  GetVPKFiles,
  ToggleVPKVisibility,
} from "../../../../wailsjs/go/app/App";
import { EventsOn } from "../../../../wailsjs/runtime/runtime";

export function selectAll() {
  const checkboxes = document.querySelectorAll(".file-checkbox");
  checkboxes.forEach((checkbox, index) => {
    checkbox.checked = true;
    const file = appState.vpkFiles[index];
    if (file) {
      toggleFileSelection(file.path, true);
    }
  });
}

export function deselectAll() {
  appState.selectedFiles.clear();
  document.querySelectorAll(".file-checkbox").forEach((checkbox) => {
    checkbox.checked = false;
  });
  updateStatusBar();
}

export async function enableSelected() {
  if (appState.selectedFiles.size === 0) {
    showNotification("请先选择文件", "info");
    return;
  }

  const filesToToggle = Array.from(appState.selectedFiles).filter((filePath) => {
    const file = appState.vpkFiles.find((f) => f.path === filePath);
    return file && !file.enabled && file.location === "disabled";
  });

  if (filesToToggle.length === 0) {
    showNotification("没有需要启用的文件（只能启用disabled目录中的文件）", "info");
    return;
  }

  try {
    const promises = filesToToggle.map(async (filePath) => {
      try {
        await ToggleVPKFile(filePath);
        return filePath;
      } catch (error) {
        console.error("启用文件失败:", filePath, error);
        return null;
      }
    });

    const results = await Promise.all(promises);
    const successFiles = results.filter((path) => path !== null);

    await batchUpdateFileStatus(successFiles);
    await refreshFilesKeepFilter();

    showNotification(`成功启用 ${successFiles.length} 个文件`, "success");

    if (successFiles.length < filesToToggle.length) {
      const failedCount = filesToToggle.length - successFiles.length;
      showNotification(`${failedCount} 个文件启用失败`, "error");
    }
  } catch (error) {
    console.error("批量启用失败:", error);
    showError("批量启用失败: " + error);
  }
}

export async function disableSelected() {
  if (appState.selectedFiles.size === 0) {
    showNotification("请先选择文件", "info");
    return;
  }

  const filesToToggle = Array.from(appState.selectedFiles).filter((filePath) => {
    const file = appState.vpkFiles.find((f) => f.path === filePath);
    return file && file.enabled && file.location === "root";
  });

  if (filesToToggle.length === 0) {
    showNotification("没有需要禁用的文件（只能禁用root目录中的文件）", "info");
    return;
  }

  try {
    const promises = filesToToggle.map(async (filePath) => {
      try {
        await ToggleVPKFile(filePath);
        return filePath;
      } catch (error) {
        console.error("禁用文件失败:", filePath, error);
        return null;
      }
    });

    const results = await Promise.all(promises);
    const successFiles = results.filter((path) => path !== null);

    await batchUpdateFileStatus(successFiles);
    await refreshFilesKeepFilter();

    showNotification(`成功禁用 ${successFiles.length} 个文件`, "success");

    if (successFiles.length < filesToToggle.length) {
      const failedCount = filesToToggle.length - successFiles.length;
      showNotification(`${failedCount} 个文件禁用失败`, "error");
    }
  } catch (error) {
    console.error("批量禁用失败:", error);
    showError("批量禁用失败: " + error);
  }
}

export async function disableAllMods(primaryTag = "") {
  const scopeLabel = primaryTag ? `${primaryTag}mod` : "mod";
  const filesToToggle = appState.allVpkFiles
    .filter((file) => {
      if (!file || !file.enabled || file.location !== "root") return false;
      return primaryTag ? file.primaryTag === primaryTag : true;
    })
    .map((file) => file.path);

  if (filesToToggle.length === 0) {
    showNotification(`没有需要禁用的${scopeLabel}（只会禁用root目录中已启用的文件）`, "info");
    return;
  }

  showConfirmModal(
    `确认禁用${scopeLabel}`,
    `确定要禁用 ${filesToToggle.length} 个${scopeLabel}吗？文件将被移动到 disabled 目录。`,
    async () => {
      updateLoadingMessage(`正在禁用${scopeLabel}...`);
      showLoadingScreen();

      const successFiles = [];
      let failedCount = 0;

      try {
        for (const filePath of filesToToggle) {
          try {
            await ToggleVPKFile(filePath);
            successFiles.push(filePath);
          } catch (error) {
            failedCount++;
            console.error("禁用文件失败:", filePath, error);
          }
        }

        await batchUpdateFileStatus(successFiles);
        await refreshFilesKeepFilter();

        if (successFiles.length > 0) {
          showNotification(`成功禁用 ${successFiles.length} 个${scopeLabel}`, "success");
        }

        if (failedCount > 0) {
          showNotification(`${failedCount} 个${scopeLabel}禁用失败`, "error");
        }
      } catch (error) {
        console.error(`批量禁用${scopeLabel}失败:`, error);
        showError(`批量禁用${scopeLabel}失败: ` + error);
      } finally {
        showMainScreen();
      }
    }
  );
}

export async function exportZipSelected() {
  const selectedFiles = Array.from(appState.selectedFiles);
  if (selectedFiles.length === 0) {
    showError("请先选择要导出的文件");
    return;
  }

  const confirmMessage = `
    <div style="display: flex; flex-direction: column; gap: 12px;">
      <p>共选择了 ${selectedFiles.length} 个文件，是否同时包含以下附加文件？</p>
      <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
        <input type="checkbox" id="export-include-extra" class="file-checkbox" checked>
        <span>缩略图与工坊信息(.meta)文件</span>
      </label>
    </div>
  `;

  showConfirmModal(
    "导出ZIP",
    confirmMessage,
    async () => {
      document.getElementById("confirm-modal").classList.add("hidden");

      const includeExtra = document.getElementById("export-include-extra").checked;

      const cleanup = EventsOn("export-progress", (progress) => {
        updateLoadingMessage(`${progress.message} (${progress.current}/${progress.total})`);
      });

      showLoadingScreen();
      updateLoadingMessage("正在准备导出...");

      try {
        const result = await ExportVPKFilesToZip(selectedFiles, includeExtra);
        if (result === "cancelled") return;
        showSuccess(result);
      } catch (error) {
        console.error("导出ZIP失败:", error);
        showError("导出ZIP失败: " + error);
      } finally {
        showMainScreen();
        if (typeof cleanup === "function") cleanup();
      }
    },
    true
  );
}

export async function deleteSelected() {
  if (appState.selectedFiles.size === 0) {
    showNotification("请先选择文件", "info");
    return;
  }

  showConfirmModal(
    "确认批量删除",
    `确定要删除选中的 ${appState.selectedFiles.size} 个文件吗？文件将被移动到回收站。`,
    async () => {
      const filesToDelete = Array.from(appState.selectedFiles);

      try {
        console.log(`批量删除 ${filesToDelete.length} 个文件...`);
        await DeleteVPKFiles(filesToDelete);
        filesToDelete.forEach((filePath) => appState.selectedFiles.delete(filePath));
        await refreshFilesKeepFilter();
        showNotification(`成功删除 ${filesToDelete.length} 个文件`, "success");
      } catch (error) {
        console.error("批量删除失败:", error);
        showError("批量删除失败: " + error);
      }
    }
  );
}

export async function moveSelected() {
  if (appState.selectedFiles.size === 0) {
    showNotification("请先选择文件", "info");
    return;
  }

  const filesToMove = Array.from(appState.selectedFiles);

  try {
    const destDir = await SelectDirectory();
    if (!destDir) return;

    showNotification("正在移动文件...", "info");

    const result = await MoveVpkFiles(filesToMove, destDir);

    if (result.successCount > 0) {
      showSuccess(`成功移动 ${result.successCount} 个文件`);
      appState.selectedFiles.clear();
    }

    if (result.failCount > 0) {
      showError(`${result.failCount} 个文件移动失败: ${result.errors[0]}`);
      console.error("移动失败详情:", result.errors);
    }

    await refreshFilesKeepFilter();
    updateStatusBar();
  } catch (error) {
    console.error("移动文件出错:", error);
    showError(`移动文件出错: ${error}`);
  }
}

export async function batchToggleVisibility(hide) {
  const selectedFiles = Array.from(appState.selectedFiles);
  if (selectedFiles.length === 0) {
    showNotification("请先选择文件", "info");
    return;
  }

  const actionName = hide ? "取消隐藏" : "隐藏";

  showConfirmModal(
    `批量${actionName}`,
    `确定要${actionName}选中的 ${selectedFiles.length} 个文件吗？`,
    async () => {
      updateLoadingMessage(`正在批量${actionName}...`);
      showLoadingScreen();

      let successCount = 0;
      let failCount = 0;

      for (const filePath of selectedFiles) {
        try {
          const fileName = filePath.split(/[\\/]/).pop();
          const isHidden = fileName.startsWith("_");

          if ((!hide && !isHidden) || (hide && isHidden)) {
            await ToggleVPKVisibility(filePath);
          }
          successCount++;
        } catch (err) {
          console.error(`处理文件 ${filePath} 失败:`, err);
          failCount++;
        }
      }

      await refreshFilesKeepFilter();
      showMainScreen();

      if (failCount > 0) {
        showNotification(`操作完成: 成功 ${successCount} 个, 失败 ${failCount} 个`, "warning");
      } else {
        showNotification(`成功${actionName} ${successCount} 个文件`, "success");
      }

      deselectAll();
    }
  );
}

export async function batchUpdateFileStatus(filePaths) {
  if (!filePaths || filePaths.length === 0) return;

  try {
    const updatedFiles = await GetVPKFiles();
    const updatedFileMap = new Map(updatedFiles.map((f) => [f.path, f]));

    filePaths.forEach((filePath) => {
      const updatedFile = updatedFileMap.get(filePath);
      if (updatedFile) {
        const allFileIndex = appState.allVpkFiles.findIndex((f) => f.path === filePath);
        if (allFileIndex >= 0) {
          appState.allVpkFiles[allFileIndex] = updatedFile;
        }

        const displayFileIndex = appState.vpkFiles.findIndex((f) => f.path === filePath);
        if (displayFileIndex >= 0) {
          appState.vpkFiles[displayFileIndex] = updatedFile;
          updateSingleFileDisplay(updatedFile);
        }
      }
    });

    updateStatusBar();
    syncSelectedFiles();
  } catch (error) {
    console.error("批量更新文件状态失败:", error);
    await refreshFilesKeepFilter();
  }
}

function updateSingleFileDisplay(file) {
  const item = document.querySelector(`.file-item[data-path="${CSS.escape(file.path)}"], .file-card[data-path="${CSS.escape(file.path)}"]`);
  if (!item) return;

  const statusEl = item.querySelector(".file-status");
  if (statusEl) {
    statusEl.textContent = `${file.enabled ? "✅" : "❌"} ${file.enabled ? "启用" : "禁用"}`;
  }

  const locationEl = item.querySelector(".file-location");
  if (locationEl) {
    const locationMap = { root: "📁", workshop: "🔧", disabled: "🚫" };
    const locationNames = { root: "根目录", workshop: "创意工坊", disabled: "已禁用" };
    locationEl.textContent = `${locationMap[file.location] || "📄"} ${locationNames[file.location] || file.location}`;
  }

  const actionBtn = item.querySelector(".toggle-btn, .move-btn");
  if (actionBtn) {
    if (file.location === "workshop") {
      actionBtn.outerHTML = `
        <button class="btn-small action-btn move-btn" data-file-path="${file.path}" data-action="move">
          <span class="btn-icon">📦</span>
          <span class="btn-text">转移</span>
        </button>
      `;
    } else {
      actionBtn.outerHTML = `
        <button class="btn-small action-btn toggle-btn ${file.enabled ? "toggle-disable" : "toggle-enable"}"
                data-file-path="${file.path}" data-action="toggle">
          <span class="btn-icon">${file.enabled ? "⛔" : "✅"}</span>
          <span class="btn-text">${file.enabled ? "禁用" : "启用"}</span>
        </button>
      `;
    }
  }
}

export function syncSelectedFiles() {
  const checkboxes = document.querySelectorAll(".file-checkbox");
  checkboxes.forEach((checkbox, index) => {
    const file = appState.vpkFiles[index];
    if (file) {
      checkbox.checked = appState.selectedFiles.has(file.path);
    }
  });
}
