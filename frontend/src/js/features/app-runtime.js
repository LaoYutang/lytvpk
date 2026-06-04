import {
  initAppShell,
  switchAppPage,
  refreshActiveIndicator,
} from "../core/ui-shell.js";
import {
  getConfig,
  initConfig,
  migrateLegacyLocalStorageIfNeeded,
  saveConfig,
} from "../core/config.js";
import { initTheme, setupThemeToggle } from "../core/theme.js";
import { renderAboutPage } from "./about/about.js";
import { renderDiagnosticsPage } from "./diagnostics/diagnostics-page.js";
import {
  configureModelStatsScan,
  openModelStatsScanModal,
} from "./diagnostics/model-stats-scan.js";
import { renderSettingsPage } from "./settings/settings-page.js";
import {
  configureServers,
  setupServerModalListeners,
  openServerModal,
  closeServerModal,
  renderServers,
  refreshAllServers,
  setupLaunchServerMenu,
  initServerStorage,
  getServers,
} from "./servers/servers.js";
import {
  updatePanelUploadTaskInList,
  updatePanelUploadProgress,
  handlePanelUploadTasksCleared,
} from "./servers/panel-modal.js";
import {
  configureUpdates,
  checkAndInstallUpdate,
  manualCheckUpdate,
  showUpdateModal,
} from "./update/updates.js";
import {
  configureConflicts,
  showConflictModal,
  hideConflictModal,
  startConflictCheck,
} from "./conflicts/conflicts.js";
import { configureSettings, showGlobalSettings, renderSettingsPageWithDeps } from "./settings/settings.js";
import {
  initProblemModScanAutoRestore,
  openProblemModScanIntro,
} from "./settings/problem-mod-scan.js";
import {
  configureWorkshopBrowser,
  browserState,
  openBrowser,
  loadWorkshopList,
  renderWorkshopSidebar,
  handleProtocolParse,
  handleProtocolWorkshop,
  initWatchLaterStorage,
} from "./workshop/workshop-browser.js";
import { showError, showNotification, handleError } from "../core/toast.js";
import { appState, applyConfigToAppState } from "./state.js";
import { renderFileList } from "./file-list/render.js";
import {
  handleSearch,
  performSearch,
  resetFilters,
  renderTagFilters,
  refreshFilesKeepFilter,
} from "./file-list/filters.js";
import { setupSortEvents } from "./file-list/sorting.js";
import {
  selectAll,
  deselectAll,
  enableSelected,
  disableSelected,
  exportZipSelected,
  deleteSelected,
  moveSelected,
  batchToggleVisibility,
  disableAllMods,
} from "./file-list/actions.js";
import { setupFileListEventDelegation } from "./file-list/events.js";
import { initBoxSelection } from "./file-list/box-selection.js";
import { showServerSubmenu } from "./file-list/context-menu.js";
import { shareSelectedWorkshopItems } from "./file-list/share.js";
import {
  toggleFile,
  moveFileToAddons,
  deleteFile,
  openFileLocation,
  toggleFileVisibility,
  renameFile,
} from "./file-list/operations.js";
import {
  manualRotate,
  initModRotationState,
  toggleModRotation,
} from "./mods/mod-rotation.js";
import {
  openWorkshopModal,
  closeWorkshopModal,
  checkWorkshopUrl,
  downloadWorkshopFile,
  copyCurrentDownloadUrls,
} from "./downloads/workshop-modal.js";
import {
  refreshTaskList,
  updateTaskInList,
  updateTaskProgress,
  setupClearCompletedTasks,
} from "./downloads/task-list.js";
import { openSetTagsModal, setupTagModalListeners } from "./file-list/tags.js";
import {
  openBatchSetTagsModal,
  setupBatchTagsModalListeners,
} from "./file-list/batch-tags.js";
import { showConfirmModal } from "./modals/confirm.js";
import { showExitModal, closeExitModal, confirmExit } from "./modals/exit.js";
import { showInfoModal, closeInfoModal } from "./modals/info.js";
import { closeModal, showFileDetail } from "./modals/detail.js";
import {
  openLoadOrderModal,
  closeLoadOrderModal,
  saveLoadOrder,
} from "./modals/load-order.js";
import {
  checkInitialDirectory,
  selectDirectory,
  handleUpload,
  launchL4D2,
  initWorkshopState,
  setupPageChangeListeners,
  disableGlobalContextMenu,
  setupInputContextMenu,
} from "./app-init.js";

import {
  HandleFileDrop,
  FetchServerInfo,
  FetchPlayerList,
  ConnectToServer,
  ExportServersToFile,
  GetMapName,
  CheckUpdate,
  GetMirrorsInitial,
  TestMirrorsLatency,
  GetWorkshopPreferredIP,
  GetWorkshopFixedIP,
  GetWorkshopIPOptions,
  GetWorkshopMetaEnabled,
  GetWorkshopUpdateCheckEnabled,
  GetWorkshopBrowserTarget,
  IsSelectingIP,
  GetCurrentBestIP,
  GetCurrentBestIPOption,
  CheckConflicts,
  SetWorkshopPreferredIP,
  SetWorkshopFixedIP,
  SetWorkshopMetaEnabled,
  SetWorkshopUpdateCheckEnabled,
  SetWorkshopBrowserTarget,
  DoUpdate,
  RestartApplication,
  FetchWorkshopList,
  FetchWorkshopDetail,
  GetAppVersion,
  CheckModUpdates,
  GetServerStorage,
  SaveServerStorage,
  FetchPanelServerStatus,
  RestartPanelServer,
  FetchPanelMapList,
  ClearPanelMaps,
  ChangePanelMap,
  SendPanelRconCommand,
  SelectPanelMapUploadFiles,
  StartPanelMapUpload,
  GetPanelMapUploadTasks,
  RetryPanelMapUpload,
  CancelPanelMapUpload,
  ClearCompletedPanelMapUploads,
  GetWorkshopWatchLaterStorage,
  SaveWorkshopWatchLaterStorage,
  GetProblemModScanSession,
} from "../../../wailsjs/go/app/App";

import {
  EventsOn,
  OnFileDrop,
  BrowserOpenURL,
  WindowMinimise,
  WindowToggleMaximise,
  Quit,
} from "../../../wailsjs/runtime/runtime";

// 暴露给全局使用，以便在 onclick 中调用
window.BrowserOpenURL = BrowserOpenURL;

const ChangePanelDifficulty = (serverID, difficulty) => {
  const method = window?.go?.app?.App?.ChangePanelDifficulty;
  if (typeof method !== "function") {
    return Promise.reject(new Error("当前后端不支持修改难度"));
  }
  return method(serverID, difficulty);
};

configureServers({
  showError,
  showNotification,
  showConfirmModal,
  switchAppPage,
  FetchServerInfo,
  FetchPlayerList,
  ConnectToServer,
  ExportServersToFile,
  GetMapName,
  GetServerStorage,
  SaveServerStorage,
  BrowserOpenURL,
  FetchPanelServerStatus,
  RestartPanelServer,
  FetchPanelMapList,
  ClearPanelMaps,
  ChangePanelMap,
  ChangePanelDifficulty,
  SendPanelRconCommand,
  SelectPanelMapUploadFiles,
  StartPanelMapUpload,
  GetPanelMapUploadTasks,
  RetryPanelMapUpload,
  CancelPanelMapUpload,
  ClearCompletedPanelMapUploads,
});

configureUpdates({
  getConfig,
  saveConfig,
  EventsOn,
  CheckUpdate,
  GetMirrorsInitial,
  TestMirrorsLatency,
  DoUpdate,
  RestartApplication,
});

configureConflicts({
  EventsOn,
  showError,
  CheckConflicts,
  toggleFile,
  moveFileToAddons,
});

configureModelStatsScan({
  EventsOn,
  showError,
});

configureSettings({
  appState,
  getConfig,
  saveConfig,
  renderFileList,
  renderTagFilters,
  refreshFilesKeepFilter,
  showNotification,
  renderSettingsPage,
  GetWorkshopPreferredIP,
  GetWorkshopFixedIP,
  GetWorkshopIPOptions,
  GetWorkshopMetaEnabled,
  GetWorkshopUpdateCheckEnabled,
  GetWorkshopBrowserTarget,
  IsSelectingIP,
  GetCurrentBestIP,
  GetCurrentBestIPOption,
  SetWorkshopPreferredIP,
  SetWorkshopFixedIP,
  SetWorkshopMetaEnabled,
  SetWorkshopUpdateCheckEnabled,
  SetWorkshopBrowserTarget,
  CheckModUpdates,
  switchAppPage,
});

configureWorkshopBrowser({
  switchAppPage,
  showNotification,
  showError,
  BrowserOpenURL,
  FetchWorkshopList,
  FetchWorkshopDetail,
  GetWorkshopBrowserTarget,
  IsSelectingIP,
  closeModal,
  openWorkshopModal,
  EventsOn,
  GetWorkshopWatchLaterStorage,
  SaveWorkshopWatchLaterStorage,
});

// 初始化应用
document.addEventListener("DOMContentLoaded", function () {
  initializeApp().catch((error) => {
    console.error("应用初始化失败:", error);
    showError("应用初始化失败: " + error);
  });
});

const UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24小时

let _updateCheckTimer = null;

async function initUpdateCheck() {
  try {
    const updateCheckEnabled = await GetWorkshopUpdateCheckEnabled();
    appState.workshopUpdateCheckEnabled = updateCheckEnabled;
    if (!updateCheckEnabled) return;

    const config = getConfig();
    const lastCheck = config.lastUpdateCheckTime;
    const now = Date.now();
    if (!lastCheck || now - Number(lastCheck) >= UPDATE_CHECK_INTERVAL) {
      // 延迟30秒后首次检测，避免和IP优选等其他启动任务冲突
      setTimeout(async () => {
        try {
          await CheckModUpdates();
          const nextConfig = getConfig();
          nextConfig.lastUpdateCheckTime = String(Date.now());
          saveConfig(nextConfig);
        } catch (err) {
          console.warn("更新检测失败:", err);
        }
      }, 30000);
    }

    // 每小时检查一次是否超过24小时
    if (_updateCheckTimer) clearInterval(_updateCheckTimer);
    _updateCheckTimer = setInterval(async () => {
      const last = getConfig().lastUpdateCheckTime;
      if (!last || Date.now() - Number(last) >= UPDATE_CHECK_INTERVAL) {
        try {
          await CheckModUpdates();
          const nextConfig = getConfig();
          nextConfig.lastUpdateCheckTime = String(Date.now());
          saveConfig(nextConfig);
        } catch (err) {
          console.warn("定时更新检测失败:", err);
        }
      }
    }, 60 * 60 * 1000);
  } catch (err) {
    console.warn("更新检测初始化失败:", err);
  }
}

async function initializeApp() {
  let migratedLegacyConfig = false;
  try {
    migratedLegacyConfig = await migrateLegacyLocalStorageIfNeeded();
  } catch (error) {
    console.error("旧配置迁移失败，已保留旧浏览器存储数据:", error);
  }

  await initConfig();
  applyConfigToAppState();
  await initServerStorage();
  await initWatchLaterStorage();

  initTheme();
  initAppShell();
  setupThemeToggle();
  setupPageChangeListeners();
  setupSettingsAndAboutListeners();
  setupEventListeners();
  setupWailsEvents();
  setupInputContextMenu();
  disableGlobalContextMenu();
  await checkInitialDirectory();
  checkAndInstallUpdate();
  initModRotationState();
  if (migratedLegacyConfig) {
    await initWorkshopState();
  }
  initBoxSelection();
  initUpdateCheck();
  await initProblemModScanAutoRestore();

  if (!window._ipEventsRegistered) {
    EventsOn("ip_selection_start", () => {
      console.log("IP优选开始");
    });

    EventsOn("ip_selection_end", () => {
      console.log("IP优选结束");
      const mainScreen = document.getElementById("main-screen");
      const loadingScreen = document.getElementById("loading-screen");
      if (mainScreen && loadingScreen) {
        loadingScreen.classList.add("hidden");
        mainScreen.classList.remove("hidden");
      }

      const browserModal = document.getElementById("browser-modal");
      if (browserModal && !browserModal.classList.contains("hidden")) {
        browserState.page = 1;
        browserState.data = [];
        loadWorkshopList();
      }
    });
    window._ipEventsRegistered = true;
  }
}

function setupSettingsAndAboutListeners() {
  document.addEventListener("app:page-change", (event) => {
    const page = event.detail.page;

    if (page === "settings") {
      renderSettingsPageWithDeps();
    } else if (page === "diagnostics") {
      renderDiagnosticsPage({
        GetProblemModScanSession,
        openProblemModScanIntro,
        openModelStatsScanModal,
        showConflictModal,
      });
    } else if (page === "about") {
      renderAboutPage({
        BrowserOpenURL,
        GetAppVersion,
        CheckUpdate,
        showUpdateModal,
      });
    }
  });
}

// 设置事件监听器
function setupEventListeners() {
  // 窗口控制
  const minBtn = document.getElementById("w-min-btn");
  const maxBtn = document.getElementById("w-max-btn");
  const closeBtn = document.getElementById("w-close-btn");

  if (minBtn) minBtn.addEventListener("click", WindowMinimise);
  if (maxBtn) maxBtn.addEventListener("click", WindowToggleMaximise);
  if (closeBtn) closeBtn.addEventListener("click", Quit);

  // 标题栏双击最大化/还原
  const titleBar = document.querySelector(".title-drag-region");
  if (titleBar) {
    titleBar.addEventListener("dblclick", WindowToggleMaximise);
  }

  // 目录选择
  document
    .getElementById("select-directory-btn")
    ?.addEventListener("click", selectDirectory);

  // 刷新按钮
  document
    .getElementById("refresh-btn")
    ?.addEventListener("click", refreshFilesKeepFilter);

  // 搜索框
  document
    .getElementById("search-input")
    ?.addEventListener("input", handleSearch);

  // 显示隐藏文件复选框
  const showHiddenCheckbox = document.getElementById("show-hidden-checkbox");
  if (showHiddenCheckbox) {
    showHiddenCheckbox.checked = appState.showHidden;
    showHiddenCheckbox.addEventListener("change", (e) => {
      appState.showHidden = e.target.checked;
      deselectAll();
      performSearch();
    });
  }

  // 排序功能
  setupSortEvents();
  setupFilterDropdownEvents();

  // 批量操作按钮
  setupBatchActionEvents();

  // 文件列表事件委托
  setupFileListEventDelegation();

  // 标签模态框事件
  setupTagModalListeners();
  setupBatchTagsModalListeners();

  // 清除已完成任务
  setupClearCompletedTasks();

  // ESC 键取消所有 mod 选择
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;

    // 如果有模态框打开，不处理（让模态框的 ESC 处理优先）
    const visibleModal = document.querySelector(".modal:not(.hidden)");
    if (visibleModal) return;

    // 如果图片预览弹窗打开，不处理
    const imagePreview = document.getElementById("image-preview-modal");
    if (imagePreview && imagePreview.style.display === "flex") return;

    // 如果焦点在输入元素上，不处理
    const activeElement = document.activeElement;
    if (
      activeElement &&
      (activeElement.tagName === "INPUT" ||
        activeElement.tagName === "TEXTAREA" ||
        activeElement.tagName === "SELECT" ||
        activeElement.isContentEditable)
    ) {
      return;
    }

    // 如果右键菜单打开，不处理
    const contextMenu = document.querySelector(".context-menu");
    if (contextMenu) return;

    // 如果当前不在主页面，不处理
    const mainScreen = document.getElementById("main-screen");
    if (!mainScreen || mainScreen.classList.contains("hidden")) return;

    // 取消所有选择
    if (appState.selectedFiles.size > 0) {
      deselectAll();
    }
  });
}

function setupFilterDropdownEvents() {
  document.addEventListener("click", (event) => {
    if (
      !event.target.closest(".multi-select-dropdown, .single-select-dropdown")
    ) {
      document
        .querySelectorAll(".select-menu, .multi-select-menu")
        .forEach((menu) => {
          menu.classList.add("hidden");
        });
    }
  });
}

function setupBatchActionEvents() {
  document
    .getElementById("select-all-btn")
    ?.addEventListener("click", selectAll);
  document
    .getElementById("deselect-all-btn")
    ?.addEventListener("click", deselectAll);
  document
    .getElementById("enable-selected-btn")
    ?.addEventListener("click", enableSelected);
  document
    .getElementById("disable-selected-btn")
    ?.addEventListener("click", disableSelected);

  const closeBatchDisableDropdown = () => {
    const dropdown = document.getElementById("batch-disable-dropdown-content");
    const button = document.getElementById("batch-disable-menu-btn");
    if (dropdown) dropdown.classList.add("hidden");
    button?.setAttribute("aria-expanded", "false");
  };

  const batchDisableMenuBtn = document.getElementById("batch-disable-menu-btn");
  if (batchDisableMenuBtn) {
    batchDisableMenuBtn.addEventListener("click", (e) => {
      e.stopPropagation();

      document.querySelectorAll(".dropdown-content").forEach((d) => {
        if (d.id !== "batch-disable-dropdown-content") {
          d.classList.add("hidden");
          const fileItem = d.closest(".file-item");
          if (fileItem) fileItem.classList.remove("active-dropdown");
        }
      });

      const dropdown = document.getElementById("batch-disable-dropdown-content");
      if (dropdown) {
        const willOpen = dropdown.classList.contains("hidden");
        dropdown.classList.toggle("hidden");
        batchDisableMenuBtn.setAttribute("aria-expanded", String(willOpen));
      }
    });
  }

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".batch-disable-split-container")) {
      closeBatchDisableDropdown();
    }
  });

  // 批量操作下拉菜单
  const batchMoreBtn = document.getElementById("batch-more-btn");
  if (batchMoreBtn) {
    batchMoreBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeBatchDisableDropdown();

      document.querySelectorAll(".dropdown-content").forEach((d) => {
        if (d.id !== "batch-dropdown-content") {
          d.classList.add("hidden");
          const fileItem = d.closest(".file-item");
          if (fileItem) fileItem.classList.remove("active-dropdown");
        }
      });

      const batchUploadBtn = document.getElementById("batch-upload-server-btn");
      if (batchUploadBtn) {
        const hasServers = getServers().some((s) => s.panelUrl && s.panelPasswordSet);
        batchUploadBtn.style.display = hasServers ? "" : "none";
      }

      const dropdown = document.getElementById("batch-dropdown-content");
      dropdown?.classList.toggle("hidden");
    });
  }

  const closeBatchDropdown = () => {
    const dropdown = document.getElementById("batch-dropdown-content");
    if (dropdown) dropdown.classList.add("hidden");
  };

  const bindBatchDisableAction = (buttonId, primaryTag = "") => {
    const button = document.getElementById(buttonId);
    if (!button) return;

    button.addEventListener("click", () => {
      closeBatchDisableDropdown();
      disableAllMods(primaryTag);
    });
  };

  bindBatchDisableAction("disable-all-mods-btn");
  bindBatchDisableAction("disable-all-character-mods-btn", "人物");
  bindBatchDisableAction("disable-all-weapon-mods-btn", "武器");

  document
    .getElementById("delete-selected-btn")
    ?.addEventListener("click", () => {
      closeBatchDropdown();
      deleteSelected();
    });

  const exportZipSelectedBtn = document.getElementById(
    "export-zip-selected-btn"
  );
  if (exportZipSelectedBtn) {
    exportZipSelectedBtn.addEventListener("click", () => {
      closeBatchDropdown();
      exportZipSelected();
    });
  }

  const batchSetTagsBtn = document.getElementById("batch-set-tags-btn");
  if (batchSetTagsBtn) {
    batchSetTagsBtn.addEventListener("click", () => {
      closeBatchDropdown();
      openBatchSetTagsModal();
    });
  }

  const shareSelectedBtn = document.getElementById("share-selected-btn");
  if (shareSelectedBtn) {
    shareSelectedBtn.addEventListener("click", () => {
      closeBatchDropdown();
      shareSelectedWorkshopItems();
    });
  }

  const moveSelectedBtn = document.getElementById("move-selected-btn");
  if (moveSelectedBtn) {
    moveSelectedBtn.addEventListener("click", () => {
      closeBatchDropdown();
      moveSelected();
    });
  }

  const batchUploadServerBtn = document.getElementById("batch-upload-server-btn");
  if (batchUploadServerBtn) {
    batchUploadServerBtn.addEventListener("click", () => {
      const filePaths = Array.from(appState.selectedFiles);
      if (filePaths.length === 0) {
        showNotification("请先选择文件", "info");
        return;
      }
      showServerSubmenu(batchUploadServerBtn, filePaths);
    });
  }

  const hideSelectedBtn = document.getElementById("hide-selected-btn");
  if (hideSelectedBtn) {
    hideSelectedBtn.addEventListener("click", () => {
      closeBatchDropdown();
      batchToggleVisibility(false);
    });
  }

  const unhideSelectedBtn = document.getElementById("unhide-selected-btn");
  if (unhideSelectedBtn) {
    unhideSelectedBtn.addEventListener("click", () => {
      closeBatchDropdown();
      batchToggleVisibility(true);
    });
  }

  // 检查更新按钮
  const checkUpdateBtn = document.getElementById("check-update-btn");
  if (checkUpdateBtn) {
    checkUpdateBtn.addEventListener("click", manualCheckUpdate);
  }

  // 重置筛选按钮
  document
    .getElementById("reset-filter-btn")
    ?.addEventListener("click", resetFilters);

  // 冲突检测弹窗按钮
  document
    .getElementById("close-conflict-modal")
    ?.addEventListener("click", hideConflictModal);
  document
    .getElementById("close-conflict-btn")
    ?.addEventListener("click", hideConflictModal);
  document
    .getElementById("start-conflict-check-btn")
    ?.addEventListener("click", startConflictCheck);

  // Mod随机轮换按钮
  document
    .getElementById("mod-rotation-btn")
    ?.addEventListener("click", toggleModRotation);

  // 服务器收藏按钮
  document
    .getElementById("server-favorites-btn")
    ?.addEventListener("click", openServerModal);

  setupServerModalListeners();
  setupLaunchServerMenu();

  // 启动L4D2按钮
  document
    .getElementById("launch-l4d2-btn")
    ?.addEventListener("click", launchL4D2);

  // 关于信息按钮
  document.getElementById("info-btn")?.addEventListener("click", showInfoModal);

  // 处理关于页面的外部链接
  document.querySelectorAll(".info-link").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const url = link.getAttribute("href");
      if (url) {
        BrowserOpenURL(url);
      }
    });
  });

  // 阻止浏览器默认的拖拽行为
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());
  window.addEventListener("dragstart", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    e.preventDefault();
  });

  // 退出确认模态框事件
  document
    .getElementById("close-exit-modal-btn")
    ?.addEventListener("click", closeExitModal);
  document
    .getElementById("exit-cancel-btn")
    ?.addEventListener("click", closeExitModal);
  document
    .getElementById("exit-confirm-btn")
    ?.addEventListener("click", confirmExit);

  document
    .getElementById("exit-confirm-modal")
    ?.addEventListener("click", function (e) {
      if (e.target === this) {
        closeExitModal();
      }
    });

  // 模态框关闭按钮
  document
    .getElementById("close-modal-header-btn")
    ?.addEventListener("click", closeModal);
  document
    .getElementById("close-info-modal-btn")
    ?.addEventListener("click", closeInfoModal);
  document
    .getElementById("close-load-order-modal-btn")
    ?.addEventListener("click", closeLoadOrderModal);
  document
    .getElementById("cancel-load-order-btn")
    ?.addEventListener("click", closeLoadOrderModal);
  document
    .getElementById("confirm-load-order-btn")
    ?.addEventListener("click", saveLoadOrder);

  // 创意工坊按钮
  document
    .getElementById("workshop-btn")
    ?.addEventListener("click", openWorkshopModal);

  // 工坊浏览器按钮
  document
    .getElementById("browser-btn")
    ?.addEventListener("click", openBrowser);

  // 上传按钮
  document
    .getElementById("upload-btn")
    ?.addEventListener("click", handleUpload);

  document
    .getElementById("check-workshop-btn")
    ?.addEventListener("click", checkWorkshopUrl);

  // 粘贴按钮事件
  document
    .getElementById("paste-workshop-url-btn")
    ?.addEventListener("click", async function () {
      try {
        const text = await navigator.clipboard.readText();
        document.getElementById("workshop-url").value = text;
        showNotification("已粘贴", "success");
      } catch (err) {
        console.error("粘贴失败:", err);
        showError("粘贴失败，请使用 Ctrl+V");
      }
    });

  document
    .getElementById("paste-download-url-btn")
    ?.addEventListener("click", async function () {
      try {
        const text = await navigator.clipboard.readText();
        const input = document.getElementById("download-url");
        input.value = text;
        input.dispatchEvent(new Event("input"));
        showNotification("已粘贴", "success");
      } catch (err) {
        console.error("粘贴失败:", err);
        showError("粘贴失败，请使用 Ctrl+V");
      }
    });

  document.getElementById("download-url")?.addEventListener("input", (e) => {
    const val = e.target.value;
    const optimizedIpContainer = document.getElementById(
      "optimized-ip-container"
    );
    if (val.includes("cdn.steamusercontent.com")) {
      optimizedIpContainer?.classList.remove("hidden");
    } else {
      optimizedIpContainer?.classList.add("hidden");
      const checkbox = document.getElementById("use-optimized-ip-global");
      if (checkbox) checkbox.checked = false;
    }
  });

  document
    .getElementById("download-workshop-btn")
    ?.addEventListener("click", downloadWorkshopFile);

  // 复制下载链接按钮
  document
    .getElementById("copy-url-btn")
    ?.addEventListener("click", copyCurrentDownloadUrls);

  // 点击模态框外部关闭
  document
    .getElementById("file-detail-modal")
    ?.addEventListener("click", function (e) {
      if (e.target === this) {
        closeModal();
      }
    });

  document
    .getElementById("workshop-modal")
    ?.addEventListener("click", function (e) {
      if (e.target === this) {
        closeWorkshopModal();
      }
    });

  document
    .getElementById("info-modal")
    ?.addEventListener("click", function (e) {
      if (e.target === this) {
        closeInfoModal();
      }
    });

  document
    .getElementById("load-order-modal")
    ?.addEventListener("click", function (e) {
      if (e.target === this) {
        closeLoadOrderModal();
      }
    });

  console.log("事件监听器已设置");
}

function setupWailsEvents() {
  console.log("正在初始化 Wails 事件监听...");

  EventsOn("error", handleError);

  EventsOn("task_updated", (task) => {
    updateTaskInList(task);
  });

  EventsOn("task_progress", (task) => {
    updateTaskProgress(task);
  });

  EventsOn("tasks_cleared", () => {
    refreshTaskList();
  });

  EventsOn("panel_upload_task_updated", (task) => {
    updatePanelUploadTaskInList(task);
  });

  EventsOn("panel_upload_task_progress", (task) => {
    updatePanelUploadProgress(task);
  });

  EventsOn("panel_upload_tasks_cleared", () => {
    handlePanelUploadTasksCleared();
  });

  EventsOn("show_exit_confirmation", () => {
    showExitModal();
  });

  OnFileDrop((x, y, paths) => {
    console.log("OnFileDrop检测到文件拖拽:", paths);
    if (paths && paths.length > 0) {
      const loadingMsg = document.getElementById("loading-message");
      if (loadingMsg) loadingMsg.textContent = "正在处理拖入的文件...";
      const loadingScreen = document.getElementById("loading-screen");
      const mainScreen = document.getElementById("main-screen");
      if (loadingScreen && mainScreen) {
        loadingScreen.classList.remove("hidden");
        mainScreen.classList.add("hidden");
      }
      HandleFileDrop(paths)
        .then(() => {
          setTimeout(() => {
            if (loadingScreen) loadingScreen.classList.add("hidden");
            if (mainScreen) mainScreen.classList.remove("hidden");
          }, 1000);
        })
        .catch((err) => {
          showError("处理文件失败: " + err);
          if (loadingScreen) loadingScreen.classList.add("hidden");
          if (mainScreen) mainScreen.classList.remove("hidden");
        });
    }
  }, true);

  EventsOn("refresh_files", () => {
    refreshFilesKeepFilter();
  });

  EventsOn("show_toast", (data) => {
    if (data.type === "error") {
      showError(data.message);
    } else {
      showNotification(data.message, data.type || "success");
    }
  });

  EventsOn("rotation_log", (msg) => {
    console.log(`[ModRotation] ${msg}`);
  });

  EventsOn("protocol:parse", (data) => {
    console.log("收到协议解析请求:", data);
    if (data && data.workshopId) {
      handleProtocolParse(data.workshopId);
    }
  });

  EventsOn("protocol:workshop", (data) => {
    console.log("收到协议打开工坊请求:", data);
    if (data && data.workshopId) {
      handleProtocolWorkshop(data.workshopId);
    }
  });

  EventsOn("protocol:error", (data) => {
    console.error("协议处理错误:", data);
    if (data && data.message) {
      showError(`协议处理失败: ${data.message}`);
    }
  });

  // 监听Mod更新检测事件
  EventsOn("mod_update_check_complete", () => {
    refreshFilesKeepFilter();
  });
}

// 暴露给全局使用，以便在 onclick 中调用
window.showFileDetail = showFileDetail;
window.toggleFile = toggleFile;
window.manualRotate = manualRotate;
window.openFileLocation = openFileLocation;
window.toggleFileVisibility = toggleFileVisibility;
window.moveFileToAddons = moveFileToAddons;
window.deleteFile = deleteFile;
window.renameFile = renameFile;
window.openSetTagsModal = openSetTagsModal;
window.openLoadOrderModal = openLoadOrderModal;
window.openWorkshopModal = openWorkshopModal;
window.closeWorkshopModal = closeWorkshopModal;
window.checkWorkshopUrl = checkWorkshopUrl;
window.downloadWorkshopFile = downloadWorkshopFile;
