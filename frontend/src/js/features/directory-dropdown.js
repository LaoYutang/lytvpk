import { getConfig, saveConfig, MAX_DIRECTORIES } from "../core/config.js";
import { appState, showFileListLoading, hideFileListLoading } from "./state.js";
import { showError, showNotification } from "../core/toast.js";
import {
  SetRootDirectory,
  ScanVPKFiles,
  ValidateDirectory,
  GetVPKFiles,
  GetPrimaryTags,
} from "../../../wailsjs/go/app/App";
import { applySort } from "./file-list/sorting.js";
import { renderTagFilters, performSearch } from "./file-list/filters.js";

// 截取路径显示（保留最后几级目录）
function truncatePath(path, maxLen = 40) {
  if (!path || path.length <= maxLen) return path;

  // 尝试保留关键部分：提取最后两级目录
  const parts = path.split(/[\\/]/);
  if (parts.length >= 3) {
    const lastTwo = parts.slice(-2).join("/");
    const prefix = parts[0];
    // 如 "D:/.../left4dead2/addons"
    const truncated = prefix + "/.../" + lastTwo;
    if (truncated.length <= maxLen) return truncated;
  }

  // 直接截断
  return "..." + path.slice(-(maxLen - 3));
}

// 初始化目录下拉组件
export function initDirectoryDropdown() {
  const trigger = document.getElementById("directory-dropdown-trigger");
  const menu = document.getElementById("directory-dropdown-menu");

  if (!trigger || !menu) return;

  // 点击触发器显示/隐藏下拉菜单
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = !menu.classList.contains("hidden");
    toggleDropdown(!isOpen);
  });

  // 点击外部关闭下拉菜单
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".directory-dropdown-container")) {
      closeDropdown();
    }
  });

  // 初始渲染列表
  renderDirectoryList();
  updateTriggerDisplay();
}

// 切换下拉菜单显示状态
export function toggleDropdown(show) {
  const trigger = document.getElementById("directory-dropdown-trigger");
  const menu = document.getElementById("directory-dropdown-menu");

  if (!trigger || !menu) return;

  if (show) {
    menu.classList.remove("hidden");
    trigger.classList.add("active");
  } else {
    menu.classList.add("hidden");
    trigger.classList.remove("active");
  }
}

export function closeDropdown() {
  toggleDropdown(false);
}

// 渲染目录列表
export function renderDirectoryList() {
  const listEl = document.getElementById("directory-list");
  const emptyEl = document.querySelector(".dropdown-empty");
  const config = getConfig();

  if (!listEl) return;

  const directories = config.savedDirectories || [];
  const currentPath =
    appState.currentDirectory || config.lastActiveDirectory || "";

  listEl.innerHTML = "";

  if (directories.length === 0) {
    emptyEl?.classList.remove("hidden");
    return;
  }

  emptyEl?.classList.add("hidden");

  directories.forEach((dir, index) => {
    const item = document.createElement("div");
    item.className = "directory-item";
    item.dataset.path = dir.path;
    item.dataset.index = index;

    const isActive = dir.path === currentPath;
    if (isActive) {
      item.classList.add("active");
    }

    // 当前路径不显示删除按钮
    if (isActive) {
      item.innerHTML = `
        <span class="directory-path" title="${dir.path}">${dir.path}</span>
      `;
    } else {
      item.innerHTML = `
        <span class="directory-path" title="${dir.path}">${dir.path}</span>
        <button class="directory-delete-btn" title="删除此路径" data-index="${index}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            <line x1="10" y1="11" x2="10" y2="17"></line>
            <line x1="14" y1="11" x2="14" y2="17"></line>
          </svg>
        </button>
      `;
    }

    // 点击目录项切换到该目录
    item.addEventListener("click", (e) => {
      if (e.target.closest(".directory-delete-btn")) return;
      switchToDirectory(dir.path);
    });

    // 点击删除按钮
    const deleteBtn = item.querySelector(".directory-delete-btn");
    if (deleteBtn) {
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        removeDirectory(index);
      });
    }

    listEl.appendChild(item);
  });
}

// 更新触发器显示文本（截取显示）
export function updateTriggerDisplay() {
  const textEl = document.getElementById("current-directory");
  if (!textEl) return;

  const path = appState.currentDirectory || getConfig().lastActiveDirectory || "";
  textEl.textContent = truncatePath(path);
}

// 添加新目录到保存列表
export function addDirectory(path) {
  const config = getConfig();
  let directories = config.savedDirectories || [];

  // 检查是否已存在
  const existingIndex = directories.findIndex((d) => d.path === path);
  if (existingIndex >= 0) {
    // 更新已存在目录的lastUsed时间
    directories[existingIndex].lastUsed = new Date().toISOString();
  } else {
    // 添加新目录
    directories.unshift({
      path: path,
      lastUsed: new Date().toISOString(),
    });

    // 限制最大数量
    if (directories.length > MAX_DIRECTORIES) {
      directories = directories.slice(0, MAX_DIRECTORIES);
    }
  }

  saveConfig({
    ...config,
    savedDirectories: directories,
    lastActiveDirectory: path,
  });

  renderDirectoryList();
}

// 删除指定目录（不能删除当前使用的路径）
function removeDirectory(index) {
  const config = getConfig();
  const directories = config.savedDirectories || [];
  const currentPath = appState.currentDirectory || config.lastActiveDirectory || "";

  if (index < 0 || index >= directories.length) return;

  const removedPath = directories[index]?.path;

  // 不允许删除当前正在使用的路径
  if (removedPath === currentPath) {
    showNotification("无法删除当前使用的目录", "warning");
    return;
  }

  directories.splice(index, 1);

  saveConfig({
    ...config,
    savedDirectories: directories,
  });

  renderDirectoryList();
  showNotification("已删除目录", "success");
}

// 切换到指定目录
export async function switchToDirectory(path) {
  if (!path) return;

  if (path === appState.currentDirectory) {
    closeDropdown();
    return; // 已经是当前目录
  }

  try {
    showFileListLoading("正在切换目录...");
    closeDropdown();

    // 验证目录
    await ValidateDirectory(path);

    // 设置新目录
    await SetRootDirectory(path);

    // 更新状态
    appState.currentDirectory = path;

    // 更新配置中的lastUsed和lastActiveDirectory
    const config = getConfig();
    const directories = config.savedDirectories || [];
    const dirIndex = directories.findIndex((d) => d.path === path);

    if (dirIndex >= 0) {
      directories[dirIndex].lastUsed = new Date().toISOString();
    }

    saveConfig({
      ...config,
      savedDirectories: directories,
      lastActiveDirectory: path,
    });

    // 加载文件
    await ScanVPKFiles();

    const [files, primaryTags] = await Promise.all([
      GetVPKFiles(),
      GetPrimaryTags(),
    ]);

    applySort(files);

    appState.allVpkFiles = files;
    appState.primaryTags = primaryTags;

    await renderTagFilters();
    await performSearch();

    updateTriggerDisplay();
    renderDirectoryList();

    showNotification(`已切换目录`, "success");
  } catch (error) {
    console.error("切换目录失败:", error);
    showError("切换目录失败: " + error);

    // 尝试恢复原目录显示
    updateTriggerDisplay();
  } finally {
    hideFileListLoading();
  }
}

// 获取当前目录列表（供其他模块使用）
export function getSavedDirectories() {
  return getConfig().savedDirectories || [];
}