import { getConfig, saveConfig } from "../core/config.js";
import { refreshActiveIndicator } from "../core/ui-shell.js";
import { showError, showNotification } from "../core/toast.js";
import {
  initDirectoryDropdown,
  addDirectory,
  updateTriggerDisplay,
  renderDirectoryList,
} from "./directory-dropdown.js";
import {
  appState,
  showLoadingScreen,
  showMainScreen,
  updateLoadingMessage,
  showFileListLoading,
  hideFileListLoading,
  enableActionButtons,
} from "./state.js";
import { renderTagFilters, performSearch } from "./file-list/filters.js";
import { applySort } from "./file-list/sorting.js";
import { refreshTaskList } from "./downloads/task-list.js";
import { renderServers, refreshAllServers } from "./servers/servers.js";
import { renderWorkshopSidebar, browserState, loadWorkshopList } from "./workshop/workshop-browser.js";
import {
  GetRootDirectory,
  ValidateDirectory,
  SetRootDirectory,
  AutoDiscoverAddons,
  SelectDirectory,
  SelectFiles,
  ScanVPKFiles,
  GetVPKFiles,
  GetPrimaryTags,
  LaunchL4D2,
  HandleFileDrop,
  SetWorkshopPreferredIP,
} from "../../../wailsjs/go/app/App";

export async function checkInitialDirectory() {
  try {
    // 初始化目录下拉组件（会自动执行配置迁移）
    initDirectoryDropdown();

    let dir = await GetRootDirectory();
    const config = getConfig();

    // 优先使用上次激活的目录
    const lastActive = config.lastActiveDirectory;
    if (!dir && lastActive) {
      try {
        await ValidateDirectory(lastActive);
        await SetRootDirectory(lastActive);
        appState.currentDirectory = lastActive; // 先设置状态
        dir = lastActive;
      } catch (error) {
        console.warn("上次激活的目录无效:", error);
      }
    }

    // 兼容旧版配置
    const defaultDir = config.defaultDirectory;
    if (!dir && defaultDir) {
      try {
        await ValidateDirectory(defaultDir);
        await SetRootDirectory(defaultDir);
        appState.currentDirectory = defaultDir; // 先设置状态
        addDirectory(defaultDir);
        dir = defaultDir;
      } catch (error) {
        console.warn("默认目录无效:", error);
      }
    }

    if (!dir) {
      try {
        updateLoadingMessage("正在自动搜索 L4D2 安装目录...");
        showLoadingScreen();

        const [autoDir] = await Promise.all([
          AutoDiscoverAddons(),
          new Promise((resolve) => setTimeout(resolve, 1500)),
        ]);

        if (autoDir) {
          console.log("自动发现目录:", autoDir);
          await SetRootDirectory(autoDir);
          appState.currentDirectory = autoDir; // 先设置状态
          addDirectory(autoDir);
          dir = autoDir;
        } else {
          showError("未自动找到 L4D2 目录，请手动选择", 4000);
        }
      } catch (err) {
        console.warn("自动搜索失败:", err);
        showError("自动搜索出错: " + err, 4000);
      }
    }

    if (dir) {
      // 状态已提前设置，这里只更新显示
      updateTriggerDisplay();
      renderDirectoryList(); // 渲染列表确保选中项正确
      showMainScreen();
      await loadFiles();
    } else {
      document.getElementById("loading-screen").classList.add("hidden");
      showDirectorySelection();
    }
  } catch (error) {
    console.error("初始化失败:", error);
    document.getElementById("loading-screen").classList.add("hidden");
    showDirectorySelection();
  }
}

export function showDirectorySelection() {
  document.getElementById("loading-screen").classList.add("hidden");
  document.getElementById("main-screen").classList.remove("hidden");
  updateLoadingMessage("请选择L4D2的addons目录");
  enableActionButtons();
  refreshActiveIndicator();
}

export async function selectDirectory() {
  try {
    const directory = await SelectDirectory();
    if (directory) {
      await ValidateDirectory(directory);
      await SetRootDirectory(directory);

      // 先更新状态，再添加到保存列表（确保渲染时选中项正确）
      appState.currentDirectory = directory;
      addDirectory(directory);
      updateTriggerDisplay();
      await loadFiles();
    }
  } catch (error) {
    console.error("选择目录失败:", error);
    showError("设置目录失败: " + error);
  }
}

export async function handleUpload() {
  try {
    const paths = await SelectFiles();
    if (paths && paths.length > 0) {
      updateLoadingMessage("正在处理选中的文件...");
      showLoadingScreen();
      try {
        await HandleFileDrop(paths);
        setTimeout(() => {
          showMainScreen();
        }, 1000);
      } catch (err) {
        showError("处理文件失败: " + err);
        showMainScreen();
      }
    }
  } catch (err) {
    console.error("选择文件失败:", err);
  }
}

export async function launchL4D2() {
  try {
    await LaunchL4D2();
    showNotification("正在启动 Left 4 Dead 2...", "success");
  } catch (error) {
    console.error("启动L4D2失败:", error);
    showNotification("启动游戏失败: " + error, "error");
  }
}

export function updateDirectoryDisplay() {
  updateTriggerDisplay();
}

export async function loadFiles() {
  if (appState.isLoading) {
    console.log("正在加载中，请稍候...");
    return;
  }

  appState.isLoading = true;
  showFileListLoading("正在扫描VPK文件...");

  try {
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

    console.log("扫描完成，找到", files.length, "个文件");
  } catch (error) {
    console.error("扫描文件失败:", error);
    showError("扫描文件失败: " + error);
  } finally {
    appState.isLoading = false;
    hideFileListLoading();
  }
}

export async function refreshFiles() {
  if (!appState.currentDirectory) {
    showNotification("请先选择目录", "info");
    return;
  }
  await loadFiles();
}

export async function initWorkshopState() {
  const config = getConfig();
  const enabled = config.workshopPreferredIP || false;
  await SetWorkshopPreferredIP(enabled);
}

export function setupPageChangeListeners() {
  document.addEventListener("app:page-change", (event) => {
    const page = event.detail.page;

    if (page === "workshop") {
      renderWorkshopSidebar();
      if (browserState.data.length === 0 && !browserState.loading) {
        browserState.page = 1;
        loadWorkshopList();
      }
    } else if (page === "downloads") {
      refreshTaskList();
      document.getElementById("workshop-url")?.focus();
    } else if (page === "servers") {
      renderServers();
      refreshAllServers();
    }
  });
}

export function disableGlobalContextMenu() {
  document.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    return false;
  });
}

export function setupInputContextMenu() {
  const inputs = ["workshop-url", "download-url"];

  inputs.forEach((id) => {
    const input = document.getElementById(id);
    if (!input) return;

    input.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    input.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.key === "v") {
        e.stopPropagation();
      }
      if (e.ctrlKey && e.key === "c") {
        e.stopPropagation();
      }
      if (e.ctrlKey && e.key === "x") {
        e.stopPropagation();
      }
      if (e.ctrlKey && e.key === "a") {
        e.stopPropagation();
      }
    });
  });
}
