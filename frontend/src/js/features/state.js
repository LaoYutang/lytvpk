import { getConfig, saveConfig } from "../core/config.js";
import { refreshActiveIndicator } from "../core/ui-shell.js";

export function getDefaultDirectory() {
  return getConfig().defaultDirectory || "";
}

export function setDefaultDirectory(directory) {
  const config = getConfig();
  config.defaultDirectory = directory;
  saveConfig(config);
}

// 应用状态
export const appState = {
  allVpkFiles: [],
  vpkFiles: [],
  primaryTags: [],
  selectedPrimaryTag: "",
  selectedSecondaryTags: [],
  selectedLocations: [],
  searchQuery: "",
  selectedFiles: new Set(),
  currentDirectory: "",
  isLoading: false,
  showHidden: false,
  sortType: "name",
  sortOrder: "asc",
  loadOrderMap: new Map(),
  displayMode: getConfig().displayMode || "list",
};

export function toggleFileSelection(filePath, selected) {
  if (selected) {
    appState.selectedFiles.add(filePath);
  } else {
    appState.selectedFiles.delete(filePath);
  }
  updateStatusBar();
}

export function updateStatusBar() {
  const totalFiles = appState.allVpkFiles.length;
  const enabledFiles = appState.allVpkFiles.filter((f) => f.enabled).length;
  const disabledFiles = totalFiles - enabledFiles;
  const selectedCount = appState.selectedFiles.size;

  const totalEl = document.getElementById("total-files");
  const enabledEl = document.getElementById("enabled-files");
  const disabledEl = document.getElementById("disabled-files");
  const selectedEl = document.getElementById("selected-files");

  if (totalEl) totalEl.textContent = `总文件数: ${totalFiles}`;
  if (enabledEl) enabledEl.textContent = `已启用: ${enabledFiles}`;
  if (disabledEl) disabledEl.textContent = `已禁用: ${disabledFiles}`;
  if (selectedEl) selectedEl.textContent = `已选择: ${selectedCount}`;
}

export function showFileListLoading(message = "正在加载...") {
  const loading = document.getElementById("file-list-loading");
  const loadingMessage = document.getElementById("file-list-loading-message");
  if (!loading) return;
  if (loadingMessage) loadingMessage.textContent = message;
  loading.classList.remove("hidden");
  disableActionButtons();
}

export function hideFileListLoading() {
  document.getElementById("file-list-loading")?.classList.add("hidden");
  enableActionButtons();
}

function disableActionButtons() {
  const buttons = [
    "refresh-btn",
    "reset-filter-btn",
    "select-directory-btn",
    "select-all-btn",
    "deselect-all-btn",
    "enable-selected-btn",
    "disable-selected-btn",
  ];
  buttons.forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.disabled = true;
      btn.style.opacity = "0.5";
      btn.style.cursor = "not-allowed";
    }
  });
}

export function enableActionButtons() {
  const buttons = [
    "refresh-btn",
    "reset-filter-btn",
    "select-directory-btn",
    "select-all-btn",
    "deselect-all-btn",
    "enable-selected-btn",
    "disable-selected-btn",
  ];
  buttons.forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.disabled = false;
      btn.style.opacity = "";
      btn.style.cursor = "";
    }
  });
}

export function showLoadingScreen() {
  document.getElementById("loading-screen")?.classList.remove("hidden");
  document.getElementById("main-screen")?.classList.add("hidden");
  disableActionButtons();
}

export function showMainScreen() {
  document.getElementById("loading-screen")?.classList.add("hidden");
  document.getElementById("file-list-loading")?.classList.add("hidden");
  document.getElementById("main-screen")?.classList.remove("hidden");
  enableActionButtons();
  refreshActiveIndicator();
}

export function updateLoadingMessage(message) {
  const el = document.getElementById("loading-message");
  if (el) el.textContent = message;
}
