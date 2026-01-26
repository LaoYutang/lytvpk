import "./style.css?v=2.7";
import "./app.css?v=2.7";
import "./titlebar.css";
import "./rotation.css";

import {
  SetRootDirectory,
  GetRootDirectory,
  ScanVPKFiles,
  GetVPKFiles,
  ToggleVPKFile,
  MoveWorkshopToAddons,
  SearchVPKFiles,
  GetPrimaryTags,
  GetSecondaryTags,
  SelectDirectory,
  ValidateDirectory,
  LaunchL4D2,
  OpenFileLocation,
  GetWorkshopDetails,
  StartDownloadTask,
  GetDownloadTasks,
  ClearCompletedTasks,
  CancelDownloadTask,
  RetryDownloadTask,
  ForceExit,
  DeleteVPKFile,
  DeleteVPKFiles,
  HandleFileDrop,
  ConnectToServer,
  FetchServerInfo,
  ExportServersToFile,
  SelectFiles,
  CheckUpdate,
  DoUpdate,
  GetMirrors,
  AutoDiscoverAddons,
  ExportVPKFilesToZip,
  RenameVPKFile,
  SetVPKTags,
  GetMapName,
  FetchWorkshopList,
  FetchWorkshopDetail,
} from "../wailsjs/go/main/App";

import {
  EventsOn,
  OnFileDrop,
  BrowserOpenURL,
  WindowMinimise,
  WindowToggleMaximise,
  Quit,
} from "../wailsjs/runtime/runtime";

// 暴露给全局使用，以便在 onclick 中调用
window.BrowserOpenURL = BrowserOpenURL;

// LocalStorage 配置管理
const CONFIG_KEY = "vpk-manager-config";
const DOWNLOAD_ICON_SVG = `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
    <polyline points="7 10 12 15 17 10"></polyline>
    <line x1="12" y1="15" x2="12" y2="3"></line>
</svg>`;

const ROTATION_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-svg">
  <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
  <path d="M3 3v5h5"></path>
  <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"></path>
  <path d="M16 21h5v-5"></path>
</svg>`;

function getConfig() {
  const config = localStorage.getItem(CONFIG_KEY);
  return config ? JSON.parse(config) : { defaultDirectory: "" };
}

function saveConfig(config) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

function getDefaultDirectory() {
  return getConfig().defaultDirectory || "";
}

function setDefaultDirectory(directory) {
  const config = getConfig();
  config.defaultDirectory = directory;
  saveConfig(config);
}

// 应用状态
let appState = {
  allVpkFiles: [], // 完整的文件列表（原始数据）
  vpkFiles: [], // 当前显示的文件列表（搜索/筛选后）
  primaryTags: [], // 一级标签: ["地图", "人物", "武器", "其他"]
  selectedPrimaryTag: "", // 选中的一级标签
  selectedSecondaryTags: [], // 选中的二级标签
  selectedLocations: [], // 选中的位置标签
  searchQuery: "",
  selectedFiles: new Set(),
  currentDirectory: "",
  isLoading: false, // 是否正在加载中
  showHidden: false, // 是否显示隐藏文件
  sortType: "name", // 'name' | 'date'
  sortOrder: "asc", // 'asc' | 'desc'
};

// 初始化应用
document.addEventListener("DOMContentLoaded", function () {
  initializeApp();
});

function initializeApp() {
  setupEventListeners();
  setupWailsEvents();
  setupInputContextMenu(); // 添加右键菜单支持
  disableGlobalContextMenu(); // 全局禁用右键菜单
  checkInitialDirectory();
  checkAndInstallUpdate();
  initModRotationState();
}

// 全局禁用右键菜单
function disableGlobalContextMenu() {
  document.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    return false;
  });
}

// 为输入框添加右键菜单支持
function setupInputContextMenu() {
  const inputs = ["workshop-url", "download-url"];

  inputs.forEach((id) => {
    const input = document.getElementById(id);
    if (!input) return;

    // 阻止默认右键菜单（已由全局处理）
    input.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    // 确保标准快捷键工作
    input.addEventListener("keydown", (e) => {
      // Ctrl+V 粘贴
      if (e.ctrlKey && e.key === "v") {
        e.stopPropagation();
      }
      // Ctrl+C 复制
      if (e.ctrlKey && e.key === "c") {
        e.stopPropagation();
      }
      // Ctrl+X 剪切
      if (e.ctrlKey && e.key === "x") {
        e.stopPropagation();
      }
      // Ctrl+A 全选
      if (e.ctrlKey && e.key === "a") {
        e.stopPropagation();
      }
    });
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
    .addEventListener("click", selectDirectory);

  // 刷新按钮
  document
    .getElementById("refresh-btn")
    .addEventListener("click", refreshFilesKeepFilter);

  // 搜索框
  document
    .getElementById("search-input")
    .addEventListener("input", handleSearch);

  // 显示隐藏文件复选框
  const showHiddenCheckbox = document.getElementById("show-hidden-checkbox");
  if (showHiddenCheckbox) {
    showHiddenCheckbox.checked = appState.showHidden;
    showHiddenCheckbox.addEventListener("change", (e) => {
      appState.showHidden = e.target.checked;
      deselectAll(); // 切换显示模式时清除选中状态
      performSearch();
    });
  }

  // 排序功能
  setupSortEvents();

  // 批量操作按钮
  setupBatchActionEvents();
}

// 设置排序事件
function setupSortEvents() {
  const sortBtn = document.getElementById("sort-btn");
  const dropdown = document.getElementById("sort-dropdown-content");

  if (sortBtn && dropdown) {
    // 切换下拉菜单
    sortBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.classList.toggle("hidden");
    });

    // 点击外部关闭
    document.addEventListener("click", (e) => {
      if (!sortBtn.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.add("hidden");
      }
    });
  }

  // 排序选项点击
  document
    .getElementById("sort-name-btn")
    ?.addEventListener("click", () => handleSortChange("name"));
  document
    .getElementById("sort-date-btn")
    ?.addEventListener("click", () => handleSortChange("date"));

  // 初始化 UI
  updateSortButtonUI();
}

// 处理排序变更
function handleSortChange(type) {
  if (appState.sortType === type) {
    // 同类型切换顺序
    appState.sortOrder = appState.sortOrder === "asc" ? "desc" : "asc";
  } else {
    // 切换类型，默认顺序
    appState.sortType = type;
    appState.sortOrder = type === "date" ? "desc" : "asc"; // 日期默认倒序（最新在前），文件名默认正序
  }

  // saveSortConfig();
  updateSortButtonUI();

  // 关闭下拉菜单
  document.getElementById("sort-dropdown-content")?.classList.add("hidden");

  // 重新排序并渲染，不需要重新搜索
  applySort(appState.vpkFiles);
  renderFileList();
}

// 更新排序按钮 UI
function updateSortButtonUI() {
  const btnText = document.getElementById("sort-btn-text");
  const nameBtn = document.getElementById("sort-name-btn");
  const dateBtn = document.getElementById("sort-date-btn");

  // 更新按钮文本
  let text = "文件名排序";
  let arrow = "";

  if (appState.sortType === "name") {
    text = "文件名排序";
    arrow = appState.sortOrder === "asc" ? "(A-Z)" : "(Z-A)";
  } else if (appState.sortType === "date") {
    text = "更新时间排序";
    arrow = appState.sortOrder === "desc" ? "(最新)" : "(最旧)";
  }

  if (btnText) btnText.textContent = `${text} ${arrow}`;

  // 更新选中状态
  if (nameBtn) {
    nameBtn.classList.toggle("active", appState.sortType === "name");
  }

  if (dateBtn) {
    dateBtn.classList.toggle("active", appState.sortType === "date");
  }
}

// 应用排序
function applySort(files) {
  return files.sort((a, b) => {
    let result = 0;

    if (appState.sortType === "date") {
      const dateA = a.lastModified ? new Date(a.lastModified).getTime() : 0;
      const dateB = b.lastModified ? new Date(b.lastModified).getTime() : 0;
      result = dateA - dateB;
    } else {
      // 默认文件名排序
      const nameA = a.name.toLowerCase();
      const nameB = b.name.toLowerCase();

      result = nameA.localeCompare(nameB, "zh-CN", {
        numeric: true,
        sensitivity: "accent",
      });
    }

    // 如果是倒序
    if (appState.sortOrder === "desc") {
      result = -result;
    }

    // 稳定性回退
    if (result === 0) {
      if (appState.sortType === "date") {
        return a.name.localeCompare(b.name, "zh-CN", { numeric: true });
      }
      return a.path.localeCompare(b.path);
    }

    return result;
  });
}

function setupBatchActionEvents() {
  document
    .getElementById("select-all-btn")
    .addEventListener("click", selectAll);
  document
    .getElementById("deselect-all-btn")
    .addEventListener("click", deselectAll);
  document
    .getElementById("enable-selected-btn")
    .addEventListener("click", enableSelected);
  document
    .getElementById("disable-selected-btn")
    .addEventListener("click", disableSelected);

  // 批量操作下拉菜单
  const batchMoreBtn = document.getElementById("batch-more-btn");
  if (batchMoreBtn) {
    batchMoreBtn.addEventListener("click", (e) => {
      e.stopPropagation();

      // 关闭其他所有打开的下拉菜单
      document.querySelectorAll(".dropdown-content").forEach((d) => {
        if (d.id !== "batch-dropdown-content") {
          d.classList.add("hidden");
          const fileItem = d.closest(".file-item");
          if (fileItem) fileItem.classList.remove("active-dropdown");
        }
      });

      const dropdown = document.getElementById("batch-dropdown-content");
      dropdown.classList.toggle("hidden");
    });
  }

  // 批量操作下拉项点击后关闭菜单
  const closeBatchDropdown = () => {
    const dropdown = document.getElementById("batch-dropdown-content");
    if (dropdown) dropdown.classList.add("hidden");
  };

  document
    .getElementById("delete-selected-btn")
    .addEventListener("click", () => {
      closeBatchDropdown();
      deleteSelected();
    });

  // 批量导出ZIP
  const exportZipSelectedBtn = document.getElementById(
    "export-zip-selected-btn"
  );
  if (exportZipSelectedBtn) {
    exportZipSelectedBtn.addEventListener("click", () => {
      closeBatchDropdown();
      exportZipSelected();
    });
  }

  // 批量隐藏/取消隐藏
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
    .addEventListener("click", resetFilters);

  // 冲突检测按钮
  document
    .getElementById("conflict-check-btn")
    .addEventListener("click", showConflictModal);
  document
    .getElementById("close-conflict-modal")
    .addEventListener("click", hideConflictModal);
  document
    .getElementById("close-conflict-btn")
    .addEventListener("click", hideConflictModal);
  document
    .getElementById("start-conflict-check-btn")
    .addEventListener("click", startConflictCheck);

  // Mod随机轮换按钮
  document
    .getElementById("mod-rotation-btn")
    .addEventListener("click", toggleModRotation);

  // 服务器收藏按钮
  document
    .getElementById("server-favorites-btn")
    .addEventListener("click", openServerModal);

  setupServerModalListeners();

  // 启动L4D2按钮
  document
    .getElementById("launch-l4d2-btn")
    .addEventListener("click", launchL4D2);

  // 关于信息按钮
  document.getElementById("info-btn").addEventListener("click", showInfoModal);

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

  // 阻止浏览器默认的拖拽行为（防止打开文件或下载）
  window.addEventListener("dragover", function (e) {
    e.preventDefault();
  });

  window.addEventListener("drop", function (e) {
    e.preventDefault();
  });

  // 阻止应用内元素的拖拽（防止误触发文件拖入逻辑）
  window.addEventListener("dragstart", function (e) {
    // 允许输入框和文本域的拖拽操作
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") {
      return;
    }
    e.preventDefault();
  });

  // 退出确认模态框事件
  document
    .getElementById("close-exit-modal-btn")
    .addEventListener("click", closeExitModal);
  document
    .getElementById("exit-cancel-btn")
    .addEventListener("click", closeExitModal);
  document
    .getElementById("exit-confirm-btn")
    .addEventListener("click", confirmExit);

  // 点击模态框外部关闭
  document
    .getElementById("exit-confirm-modal")
    .addEventListener("click", function (e) {
      if (e.target === this) {
        closeExitModal();
      }
    });

  // 模态框关闭按钮
  document
    .getElementById("close-modal-header-btn")
    .addEventListener("click", closeModal);
  document
    .getElementById("close-info-modal-btn")
    .addEventListener("click", closeInfoModal);

  // 创意工坊按钮
  document
    .getElementById("workshop-btn")
    .addEventListener("click", openWorkshopModal);

  // 上传按钮
  document.getElementById("upload-btn").addEventListener("click", handleUpload);

  document
    .getElementById("close-workshop-modal-btn")
    .addEventListener("click", closeWorkshopModal);
  document
    .getElementById("check-workshop-btn")
    .addEventListener("click", checkWorkshopUrl);

  // 粘贴按钮事件
  document
    .getElementById("paste-workshop-url-btn")
    .addEventListener("click", async function () {
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
    .addEventListener("click", async function () {
      try {
        const text = await navigator.clipboard.readText();
        const input = document.getElementById("download-url");
        input.value = text;
        input.dispatchEvent(new Event("input")); // 触发 input 事件
        showNotification("已粘贴", "success");
      } catch (err) {
        console.error("粘贴失败:", err);
        showError("粘贴失败，请使用 Ctrl+V");
      }
    });

  document.getElementById("download-url").addEventListener("input", (e) => {
    const val = e.target.value;
    const optimizedIpContainer = document.getElementById(
      "optimized-ip-container"
    );
    if (val.includes("cdn.steamusercontent.com")) {
      optimizedIpContainer.classList.remove("hidden");
    } else {
      optimizedIpContainer.classList.add("hidden");
      document.getElementById("use-optimized-ip-global").checked = false;
    }
  });

  document
    .getElementById("download-workshop-btn")
    .addEventListener("click", downloadWorkshopFile);

  // 复制下载链接按钮
  document
    .getElementById("copy-url-btn")
    .addEventListener("click", function () {
      const input = document.getElementById("download-url");
      if (input.value) {
        input.select();
        navigator.clipboard
          .writeText(input.value)
          .then(() => {
            showNotification("链接已复制", "success");
          })
          .catch((err) => {
            console.error("复制失败:", err);
            showError("复制失败");
          });
      }
    });

  console.log("模态框事件监听器已设置");

  // 点击模态框外部关闭
  document
    .getElementById("file-detail-modal")
    .addEventListener("click", function (e) {
      if (e.target === this) {
        closeModal();
      }
    });

  document
    .getElementById("workshop-modal")
    .addEventListener("click", function (e) {
      if (e.target === this) {
        closeWorkshopModal();
      }
    });

  document.getElementById("info-modal").addEventListener("click", function (e) {
    if (e.target === this) {
      closeInfoModal();
    }
  });

  // 文件列表按钮事件委托
  console.log("正在设置文件列表按钮事件委托...");
  document.addEventListener("click", function (e) {
    console.log("全局点击事件触发:", e.target);

    // 处理更多按钮点击
    const moreBtn = e.target.closest(".more-btn");
    if (moreBtn) {
      e.preventDefault();
      e.stopPropagation();
      const dropdown = moreBtn.nextElementSibling;
      const fileItem = moreBtn.closest(".file-item");

      // 关闭其他所有打开的下拉菜单
      document.querySelectorAll(".dropdown-content").forEach((d) => {
        if (d !== dropdown) {
          d.classList.add("hidden");
          // 移除其他 file-item 的 active 状态
          const otherFileItem = d.closest(".file-item");
          if (otherFileItem) otherFileItem.classList.remove("active-dropdown");
        }
      });

      // 每次打开前先重置样式
      dropdown.classList.remove("dropup");

      dropdown.classList.toggle("hidden");
      if (fileItem) {
        if (dropdown.classList.contains("hidden")) {
          fileItem.classList.remove("active-dropdown");
        } else {
          fileItem.classList.add("active-dropdown");

          // 检查菜单位置，如果超出底部则向上弹出
          const rect = dropdown.getBoundingClientRect();
          const windowHeight =
            window.innerHeight || document.documentElement.clientHeight;

          // 获取状态栏高度，确保不被遮挡
          const statusBar = document.querySelector(".status-bar");
          const bottomMargin = statusBar ? statusBar.offsetHeight + 10 : 20; // 增加默认边距

          // 留出一点边距
          if (rect.bottom > windowHeight - bottomMargin) {
            dropdown.classList.add("dropup");
          }
        }
      }
      return;
    }

    // 点击其他地方关闭所有下拉菜单
    if (
      !e.target.closest(".more-actions-dropdown") &&
      !e.target.closest(".batch-actions-dropdown-container")
    ) {
      document.querySelectorAll(".dropdown-content").forEach((d) => {
        d.classList.add("hidden");
        const fileItem = d.closest(".file-item");
        if (fileItem) fileItem.classList.remove("active-dropdown");
      });
    }

    // 处理详情按钮点击
    const detailBtn = e.target.closest(".detail-btn");
    if (detailBtn) {
      console.log("找到详情按钮:", detailBtn);
      const filePath = detailBtn.getAttribute("data-file-path");
      console.log("文件路径:", filePath);
      if (filePath) {
        console.log("调用 showFileDetail:", filePath);
        e.preventDefault();
        e.stopPropagation();
        showFileDetail(filePath);
      } else {
        console.error("详情按钮缺少 data-file-path 属性");
      }
    }

    // 处理打开位置按钮点击
    const openLocationBtn = e.target.closest(
      '.open-location-btn[data-action="open-location"]'
    );
    if (openLocationBtn) {
      console.log("找到打开位置按钮:", openLocationBtn);
      const filePath = openLocationBtn.getAttribute("data-file-path");
      if (filePath) {
        console.log("调用 openFileLocation:", filePath);
        e.preventDefault();
        e.stopPropagation();

        // 关闭下拉菜单
        document.querySelectorAll(".dropdown-content").forEach((d) => {
          d.classList.add("hidden");
          const fileItem = d.closest(".file-item");
          if (fileItem) fileItem.classList.remove("active-dropdown");
        });

        openFileLocation(filePath);
      }
    }

    // 处理隐藏按钮点击
    const hideBtn = e.target.closest('.hide-btn[data-action="hide"]');
    if (hideBtn) {
      const filePath = hideBtn.getAttribute("data-file-path");
      if (filePath) {
        e.preventDefault();
        e.stopPropagation();

        // 关闭下拉菜单
        document.querySelectorAll(".dropdown-content").forEach((d) => {
          d.classList.add("hidden");
          const fileItem = d.closest(".file-item");
          if (fileItem) fileItem.classList.remove("active-dropdown");
        });

        toggleFileVisibility(filePath);
      }
    }

    // 处理切换按钮点击
    const toggleBtn = e.target.closest('.toggle-btn[data-action="toggle"]');
    if (toggleBtn) {
      console.log("找到切换按钮:", toggleBtn);
      const filePath = toggleBtn.getAttribute("data-file-path");
      if (filePath) {
        console.log("调用 toggleFile:", filePath);
        e.preventDefault();
        e.stopPropagation();
        toggleFile(filePath);
      }
    }

    // 处理转移按钮点击
    const moveBtn = e.target.closest('.move-btn[data-action="move"]');
    if (moveBtn) {
      console.log("找到转移按钮:", moveBtn);
      const filePath = moveBtn.getAttribute("data-file-path");
      if (filePath) {
        console.log("调用 moveFileToAddons:", filePath);
        e.preventDefault();
        e.stopPropagation();
        moveFileToAddons(filePath);
      }
    }

    // 处理设置标签按钮点击
    const setTagsBtn = e.target.closest(
      '.set-tags-btn[data-action="set-tags"]'
    );
    if (setTagsBtn) {
      const filePath = setTagsBtn.getAttribute("data-file-path");
      if (filePath) {
        e.preventDefault();
        e.stopPropagation();

        // 关闭下拉菜单
        document.querySelectorAll(".dropdown-content").forEach((d) => {
          d.classList.add("hidden");
          const fileItem = d.closest(".file-item");
          if (fileItem) fileItem.classList.remove("active-dropdown");
        });

        openSetTagsModal(filePath);
      }
    }

    // 处理重命名按钮点击
    const renameBtn = e.target.closest('.rename-btn[data-action="rename"]');
    if (renameBtn) {
      const filePath = renameBtn.getAttribute("data-file-path");
      if (filePath) {
        e.preventDefault();
        e.stopPropagation();

        // 关闭下拉菜单
        document.querySelectorAll(".dropdown-content").forEach((d) => {
          d.classList.add("hidden");
          const fileItem = d.closest(".file-item");
          if (fileItem) fileItem.classList.remove("active-dropdown");
        });

        renameFile(filePath);
      }
    }

    // 处理删除按钮点击
    const deleteBtn = e.target.closest('.delete-btn[data-action="delete"]');
    if (deleteBtn) {
      console.log("找到删除按钮:", deleteBtn);
      const filePath = deleteBtn.getAttribute("data-file-path");
      if (filePath) {
        console.log("调用 deleteFile:", filePath);
        e.preventDefault();
        e.stopPropagation();

        // 关闭下拉菜单
        document.querySelectorAll(".dropdown-content").forEach((d) => {
          d.classList.add("hidden");
          const fileItem = d.closest(".file-item");
          if (fileItem) fileItem.classList.remove("active-dropdown");
        });

        deleteFile(filePath);
      }
    }
  });

  console.log("文件列表按钮事件委托设置完成");

  // 添加测试函数到全局作用域
  window.testDetailButton = function () {
    console.log("测试详情按钮功能...");
    const detailBtns = document.querySelectorAll(".detail-btn");
    console.log("找到详情按钮数量:", detailBtns.length);

    if (detailBtns.length > 0) {
      const firstBtn = detailBtns[0];
      const filePath = firstBtn.getAttribute("data-file-path");
      console.log("第一个按钮的文件路径:", filePath);
      if (filePath) {
        showFileDetail(filePath);
      }
    }
  };

  // 添加强制显示模态框的测试函数
  window.testModal = function () {
    console.log("强制显示模态框测试...");
    const modal = document.getElementById("file-detail-modal");
    if (modal) {
      console.log("模态框存在，强制显示");
      modal.classList.remove("hidden");
      modal.style.display = "flex";
    } else {
      console.error("模态框不存在!");
    }
  };

  // 测试通知系统
  window.testNotifications = function () {
    console.log("测试通知系统...");
    showNotification("这是信息通知", "info");
    setTimeout(() => showNotification("这是成功通知", "success"), 1000);
    setTimeout(() => showNotification("这是错误通知", "error"), 2000);
  };

  // 添加单个文件状态更新测试函数
  window.testSingleFileUpdate = function (filePath) {
    console.log("测试单个文件更新...");
    const firstFile = appState.vpkFiles[0];
    if (firstFile) {
      console.log("测试更新文件:", firstFile.name);
      updateSingleFileStatus(firstFile.path);
    } else {
      console.log("没有找到可测试的文件");
    }
  };

  // 添加按钮状态验证测试函数
  window.testButtonStates = function () {
    console.log("=== 验证所有按钮状态 ===");
    const fileItems = document.querySelectorAll(".file-item");

    fileItems.forEach((item, index) => {
      const filePath = item.dataset.path;
      const file = appState.vpkFiles.find((f) => f.path === filePath);

      if (file) {
        const toggleBtn = item.querySelector(".toggle-btn");
        const statusEl = item.querySelector(".file-status");

        console.log(`文件 ${index + 1}: ${file.name}`);
        console.log(`- 实际状态: ${file.enabled ? "启用" : "禁用"}`);
        console.log(`- 显示状态: ${statusEl?.textContent || "未知"}`);
        console.log(`- 按钮类名: ${toggleBtn?.className || "未找到"}`);
        console.log(`- 按钮文本: ${toggleBtn?.textContent || "未找到"}`);

        // 检查状态是否一致
        const statusMatch = statusEl?.textContent.includes(
          file.enabled ? "启用" : "禁用"
        );
        const btnTextMatch = toggleBtn?.textContent.includes(
          file.enabled ? "禁用" : "启用"
        );

        if (!statusMatch || !btnTextMatch) {
          console.error(`❌ 状态不一致!`);
        } else {
          console.log(`✅ 状态一致`);
        }
        console.log("---");
      }
    });

    console.log("=== 按钮状态验证完成 ===");
  };

  // 添加文件排序验证测试函数
  window.testFileSorting = function () {
    console.log("=== 验证文件排序 ===");
    console.log("当前显示的文件列表顺序:");

    appState.vpkFiles.forEach((file, index) => {
      console.log(`${index + 1}. ${file.name}`);
    });

    // 检查是否已排序
    let isSorted = true;
    for (let i = 1; i < appState.vpkFiles.length; i++) {
      const prevName = appState.vpkFiles[i - 1].name.toLowerCase();
      const currName = appState.vpkFiles[i].name.toLowerCase();

      if (prevName > currName) {
        isSorted = false;
        console.error(
          `❌ 排序错误: "${appState.vpkFiles[i - 1].name}" 应该在 "${
            appState.vpkFiles[i].name
          }" 之后`
        );
        break;
      }
    }

    if (isSorted) {
      console.log("✅ 文件列表已正确排序");
    } else {
      console.error("❌ 文件列表排序有误");
    }

    console.log("=== 文件排序验证完成 ===");
  };
}

// 设置Wails事件监听
function setupWailsEvents() {
  console.log("正在初始化 Wails 事件监听...");

  // 监听错误事件
  EventsOn("error", handleError);

  // 监听任务更新
  EventsOn("task_updated", (task) => {
    updateTaskInList(task);
  });

  // 监听任务进度
  EventsOn("task_progress", (task) => {
    updateTaskProgress(task);
  });

  // 监听任务清理
  EventsOn("tasks_cleared", () => {
    refreshTaskList();
  });

  // 监听退出确认
  EventsOn("show_exit_confirmation", () => {
    showExitModal();
  });

  // 监听文件拖拽 (使用 OnFileDrop API)
  OnFileDrop((x, y, paths) => {
    console.log("OnFileDrop检测到文件拖拽:", paths);
    if (paths && paths.length > 0) {
      updateLoadingMessage("正在处理拖入的文件...");
      showLoadingScreen();
      HandleFileDrop(paths)
        .then(() => {
          // 处理完成后的逻辑，通常后端会发送 refresh_files 事件
          // 这里可以做一个保底的关闭加载屏
          setTimeout(() => {
            showMainScreen();
          }, 1000);
        })
        .catch((err) => {
          showError("处理文件失败: " + err);
          showMainScreen();
        });
    }
  }, true);

  // 监听刷新文件列表
  EventsOn("refresh_files", () => {
    if (typeof refreshFilesKeepFilter === "function") {
      refreshFilesKeepFilter();
    } else if (typeof performSearch === "function") {
      performSearch();
    }
  });

  // 监听Toast消息
  EventsOn("show_toast", (data) => {
    if (data.type === "error") {
      showError(data.message);
    } else {
      showNotification(data.message, data.type || "success");
    }
  });

  // 监听轮换日志
  EventsOn("rotation_log", (msg) => {
    console.log(`[ModRotation] ${msg}`);
  });
}

// 退出确认相关函数
function showExitModal() {
  document.getElementById("exit-confirm-modal").classList.remove("hidden");
}

function closeExitModal() {
  document.getElementById("exit-confirm-modal").classList.add("hidden");
}

async function confirmExit() {
  try {
    await ForceExit();
  } catch (err) {
    console.error("强制退出失败:", err);
  }
}

// 检查初始目录
async function checkInitialDirectory() {
  try {
    let dir = await GetRootDirectory();

    // 如果没有设置根目录但配置中有默认目录，使用默认目录
    const defaultDir = getDefaultDirectory();
    if (!dir && defaultDir) {
      try {
        await ValidateDirectory(defaultDir);
        await SetRootDirectory(defaultDir);
        dir = defaultDir;
      } catch (error) {
        console.warn("默认目录无效:", error);
      }
    }

    // 如果还是没有目录，尝试自动搜索
    if (!dir) {
      try {
        // 显示加载状态，避免用户以为卡死
        updateLoadingMessage("正在自动搜索 L4D2 安装目录...");
        showLoadingScreen();

        // 强制等待至少 1.5 秒，确保用户能看到提示
        const [autoDir] = await Promise.all([
          AutoDiscoverAddons(),
          new Promise((resolve) => setTimeout(resolve, 1500)),
        ]);

        if (autoDir) {
          console.log("自动发现目录:", autoDir);
          await SetRootDirectory(autoDir);
          setDefaultDirectory(autoDir);
          dir = autoDir;
        } else {
          // 搜索失败提示
          showError("未自动找到 L4D2 目录，请手动选择", 4000);
        }
      } catch (err) {
        console.warn("自动搜索失败:", err);
        showError("自动搜索出错: " + err, 4000);
      }
    }

    if (dir) {
      appState.currentDirectory = dir;
      updateDirectoryDisplay();
      showMainScreen();
      // 自动扫描
      await loadFiles();
    } else {
      // 确保关闭加载屏幕，显示选择界面
      document.getElementById("loading-screen").classList.add("hidden");
      showDirectorySelection();
    }
  } catch (error) {
    console.error("初始化失败:", error);
    document.getElementById("loading-screen").classList.add("hidden");
    showDirectorySelection();
  }
}

// 显示目录选择
function showDirectorySelection() {
  document.getElementById("loading-screen").classList.add("hidden");
  document.getElementById("main-screen").classList.remove("hidden");
  updateLoadingMessage("请选择L4D2的addons目录");
  enableActionButtons();
}

// 选择目录
async function selectDirectory() {
  try {
    const directory = await SelectDirectory();
    if (directory) {
      // 验证目录
      await ValidateDirectory(directory);

      await SetRootDirectory(directory);
      appState.currentDirectory = directory;

      // 保存默认目录到本地配置
      setDefaultDirectory(directory);

      updateDirectoryDisplay();
      await loadFiles();
    }
  } catch (error) {
    console.error("选择目录失败:", error);
    showError("设置目录失败: " + error);
  }
}

// 处理上传文件
async function handleUpload() {
  try {
    const paths = await SelectFiles();
    if (paths && paths.length > 0) {
      updateLoadingMessage("正在处理选中的文件...");
      showLoadingScreen();
      try {
        await HandleFileDrop(paths);
        // HandleFileDrop 会触发 refresh_files 事件，但我们也可以等待一下确保 UI 更新
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

// 启动L4D2
async function launchL4D2() {
  try {
    await LaunchL4D2();
    showNotification("正在启动 Left 4 Dead 2...", "success");
  } catch (error) {
    console.error("启动L4D2失败:", error);
    showNotification("启动游戏失败: " + error, "error");
  }
}

// 更新目录显示
function updateDirectoryDisplay() {
  document.getElementById("current-directory").textContent =
    appState.currentDirectory;
}

// 加载文件
async function loadFiles() {
  // 防止重复点击
  if (appState.isLoading) {
    console.log("正在加载中，请稍候...");
    return;
  }

  appState.isLoading = true;
  showLoadingScreen();
  updateLoadingMessage("正在扫描VPK文件...");

  try {
    // 扫描VPK文件
    await ScanVPKFiles();

    // 获取文件列表和标签
    const [files, primaryTags] = await Promise.all([
      GetVPKFiles(),
      GetPrimaryTags(),
    ]);

    // 确保文件列表按名称排序，保持稳定顺序
    applySort(files);

    // 保存完整的文件列表和当前显示的列表
    appState.allVpkFiles = files;
    // appState.vpkFiles 将由 performSearch 更新
    appState.primaryTags = primaryTags;

    // 更新UI
    await renderTagFilters();

    // 应用当前的筛选条件（包括隐藏文件过滤）
    await performSearch();

    console.log("扫描完成，找到", files.length, "个文件");
  } catch (error) {
    console.error("扫描文件失败:", error);
    alert("扫描文件失败: " + error);
  } finally {
    appState.isLoading = false;
    showMainScreen();
  }
}

// 刷新文件列表
async function refreshFiles() {
  if (!appState.currentDirectory) {
    alert("请先选择目录");
    return;
  }
  await loadFiles();
}

// 保持筛选状态的刷新文件列表
async function refreshFilesKeepFilter() {
  if (!appState.currentDirectory) {
    alert("请先选择目录");
    return;
  }

  // 防止重复点击
  if (appState.isLoading) {
    console.log("正在加载中，请稍候...");
    return;
  }

  // 保存当前的筛选状态
  const currentFilters = {
    searchText: document.getElementById("search-input")?.value || "",
    primaryTag: appState.selectedPrimaryTag || "",
    secondaryTags: [...appState.selectedSecondaryTags],
    locationTags: [...appState.selectedLocations],
  };

  console.log("保存的筛选状态:", currentFilters);

  // 显示加载状态
  appState.isLoading = true;
  showLoadingScreen();
  updateLoadingMessage("正在刷新文件列表...");

  try {
    // ⭐ 重新扫描文件系统（触发智能缓存更新）
    await ScanVPKFiles();

    // 获取更新后的文件列表和标签
    const [files, primaryTags] = await Promise.all([
      GetVPKFiles(),
      GetPrimaryTags(),
    ]);

    // 确保文件列表按名称排序，保持稳定顺序
    applySort(files);

    // 更新状态
    appState.allVpkFiles = files;
    appState.primaryTags = primaryTags;

    // 先恢复筛选状态到 appState（这样 renderTagFilters 就能正确设置按钮状态）
    appState.searchQuery = currentFilters.searchText || "";
    appState.selectedPrimaryTag = currentFilters.primaryTag || "";
    appState.selectedSecondaryTags = currentFilters.secondaryTags || [];
    appState.selectedLocations = currentFilters.locationTags || [];

    // 重新渲染标签筛选器（会根据 appState 设置 active 状态）
    await renderTagFilters();

    // 恢复搜索框的值
    const searchInput = document.getElementById("search-input");
    if (searchInput) {
      searchInput.value = currentFilters.searchText || "";
    }

    // 重新执行搜索以应用筛选
    await performSearch();

    // 清理无效的选中项（移除已不存在的文件）
    const currentFilePaths = new Set(appState.allVpkFiles.map((f) => f.path));
    for (const path of appState.selectedFiles) {
      if (!currentFilePaths.has(path)) {
        appState.selectedFiles.delete(path);
      }
    }

    // 更新状态栏
    updateStatusBar();

    console.log("文件列表已刷新，筛选状态已恢复");
  } catch (error) {
    console.error("刷新文件列表失败:", error);
    showError("刷新失败: " + error);
  } finally {
    // 恢复正常状态
    appState.isLoading = false;
    showMainScreen();
  }
}

// 恢复筛选状态
function restoreFilterState(filters) {
  console.log("恢复筛选状态:", filters);

  // 恢复搜索框
  const searchInput = document.getElementById("search-input");
  if (searchInput) {
    searchInput.value = filters.searchText || "";
    appState.searchQuery = filters.searchText || "";
  }

  // 恢复一级标签选择
  document.querySelectorAll(".primary-tag-btn").forEach((btn) => {
    if (btn.dataset.value === (filters.primaryTag || "")) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
  appState.selectedPrimaryTag = filters.primaryTag || "";

  // 恢复二级标签选择
  appState.selectedSecondaryTags = filters.secondaryTags || [];

  // 如果有一级标签选择，重新渲染二级标签以恢复选中状态
  if (filters.primaryTag) {
    renderSecondaryTags(filters.primaryTag);
  }

  // 恢复位置标签
  appState.selectedLocations = filters.locationTags || [];
  document.querySelectorAll(".location-tag-btn").forEach((btn) => {
    if (appState.selectedLocations.includes(btn.dataset.tag)) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  console.log(
    "筛选状态已恢复，搜索词:",
    appState.searchQuery,
    "一级标签:",
    appState.selectedPrimaryTag,
    "二级标签:",
    appState.selectedSecondaryTags,
    "位置:",
    appState.selectedLocations
  );
}

// 显示加载屏幕
function showLoadingScreen() {
  document.getElementById("loading-screen").classList.remove("hidden");
  document.getElementById("main-screen").classList.add("hidden");
  disableActionButtons();
}

// 显示主屏幕
function showMainScreen() {
  document.getElementById("loading-screen").classList.add("hidden");
  document.getElementById("main-screen").classList.remove("hidden");
  enableActionButtons();
}

// 更新加载消息
function updateLoadingMessage(message) {
  document.getElementById("loading-message").textContent = message;
}

// 禁用操作按钮
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

// 启用操作按钮
function enableActionButtons() {
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

// 渲染标签筛选器
async function renderTagFilters() {
  const tagContainer = document.getElementById("tag-filters");
  const locationContainer = document.getElementById("location-filter-section");

  tagContainer.innerHTML = "";
  locationContainer.innerHTML = "";

  try {
    // 获取一级标签
    const primaryTags = await GetPrimaryTags();

    // 创建一级标签选择器
    const primaryGroup = document.createElement("div");
    primaryGroup.className = "tag-group primary-tag-group";

    const primaryLabel = document.createElement("label");
    primaryLabel.textContent = "标签:";
    primaryGroup.appendChild(primaryLabel);

    // 创建一级标签按钮容器
    const primaryTagsContainer = document.createElement("div");
    primaryTagsContainer.className = "primary-tags-container";

    // 添加"全部"按钮
    const allBtn = createPrimaryTagButton("", "全部");
    primaryTagsContainer.appendChild(allBtn);

    // 添加一级标签按钮
    primaryTags.forEach((tag) => {
      const tagBtn = createPrimaryTagButton(tag, tag);
      primaryTagsContainer.appendChild(tagBtn);
    });

    primaryGroup.appendChild(primaryTagsContainer);
    tagContainer.appendChild(primaryGroup);

    // 创建二级标签选择器
    const secondaryGroup = document.createElement("div");
    secondaryGroup.className = "tag-group secondary-tag-group";
    secondaryGroup.id = "secondary-tag-group";
    secondaryGroup.style.display = "none"; // 默认隐藏

    const secondaryLabel = document.createElement("label");
    secondaryLabel.textContent = "子标签:";
    secondaryGroup.appendChild(secondaryLabel);

    tagContainer.appendChild(secondaryGroup);

    // 如果已选择一级标签，渲染二级标签
    if (appState.selectedPrimaryTag) {
      await renderSecondaryTags(appState.selectedPrimaryTag);
    }

    // 渲染位置标签到第一行
    const locationLabel = document.createElement("label");
    locationLabel.textContent = "位置:";
    locationLabel.className = "filter-label";
    locationContainer.appendChild(locationLabel);

    const locationTags = ["root", "workshop", "disabled"];
    locationTags.forEach((tag) => {
      const tagBtn = createLocationTagButton(tag, getLocationDisplayName(tag));
      locationContainer.appendChild(tagBtn);
    });
  } catch (error) {
    console.error("渲染标签筛选器失败:", error);
  }
}

// 创建一级标签按钮
function createPrimaryTagButton(value, text) {
  const button = document.createElement("button");
  button.className = "primary-tag-btn";
  button.textContent = text;
  button.dataset.value = value;

  if (appState.selectedPrimaryTag === value) {
    button.classList.add("active");
  }

  button.addEventListener("click", async function () {
    // 移除所有一级标签的active状态
    document.querySelectorAll(".primary-tag-btn").forEach((btn) => {
      btn.classList.remove("active");
    });

    // 设置当前按钮为active
    button.classList.add("active");

    // 更新状态
    appState.selectedPrimaryTag = value;
    appState.selectedSecondaryTags = []; // 清空二级标签选择

    // 渲染二级标签
    await renderSecondaryTags(appState.selectedPrimaryTag);

    // 执行搜索
    performSearch();
  });

  return button;
}

// 渲染二级标签
async function renderSecondaryTags(primaryTag) {
  const secondaryGroup = document.getElementById("secondary-tag-group");

  // 清除现有的二级标签按钮
  const existingContainer = secondaryGroup.querySelector(
    ".secondary-tags-container"
  );
  if (existingContainer) {
    existingContainer.remove();
  }

  if (!primaryTag) {
    // 没有选择标签时隐藏整个子标签组
    secondaryGroup.style.display = "none";
    return;
  }

  try {
    const secondaryTags = await GetSecondaryTags(primaryTag);

    if (secondaryTags.length > 0) {
      // 对二级标签进行排序（按字母顺序）
      secondaryTags.sort((a, b) => a.localeCompare(b, "zh-CN"));

      // 显示子标签组
      secondaryGroup.style.display = "flex";

      const container = document.createElement("div");
      container.className = "secondary-tags-container";

      secondaryTags.forEach((tag) => {
        const tagBtn = createSecondaryTagButton(tag);
        container.appendChild(tagBtn);
      });

      secondaryGroup.appendChild(container);
    } else {
      // 没有子标签时隐藏
      secondaryGroup.style.display = "none";
    }
  } catch (error) {
    console.error("获取二级标签失败:", error);
    secondaryGroup.style.display = "none";
  }
}

// 创建二级标签按钮
function createSecondaryTagButton(tag) {
  const button = document.createElement("button");
  button.className = "secondary-tag-btn";
  button.textContent = tag;
  button.dataset.tag = tag;

  if (appState.selectedSecondaryTags.includes(tag)) {
    button.classList.add("active");
  }

  button.addEventListener("click", function () {
    toggleSecondaryTag(tag, button);
  });

  return button;
}

// 切换二级标签
function toggleSecondaryTag(tag, button) {
  const index = appState.selectedSecondaryTags.indexOf(tag);
  if (index > -1) {
    appState.selectedSecondaryTags.splice(index, 1);
    button.classList.remove("active");
  } else {
    appState.selectedSecondaryTags.push(tag);
    button.classList.add("active");
  }

  performSearch();
}

// 创建位置标签按钮
function createLocationTagButton(tag, displayName) {
  const button = document.createElement("button");
  button.className = "location-tag-btn";
  button.textContent = displayName;
  button.dataset.tag = tag;

  // 根据 appState 设置 active 状态
  if (appState.selectedLocations.includes(tag)) {
    button.classList.add("active");
  }

  button.addEventListener("click", function () {
    toggleLocationFilter(tag, button);
  });

  return button;
}

// 获取位置标签显示名称
function getLocationDisplayName(tag) {
  const displayNames = {
    root: "根目录",
    workshop: "创意工坊",
    disabled: "已禁用",
  };
  return displayNames[tag] || tag;
}

// 切换位置筛选
function toggleLocationFilter(location, button) {
  const index = appState.selectedLocations.indexOf(location);
  if (index > -1) {
    appState.selectedLocations.splice(index, 1);
    button.classList.remove("active");
  } else {
    appState.selectedLocations.push(location);
    button.classList.add("active");
  }

  performSearch();
}

// 重置所有筛选条件
async function resetFilters() {
  // 防止重复点击
  if (appState.isLoading) {
    console.log("正在加载中，请稍候...");
    return;
  }

  appState.isLoading = true;
  showLoadingScreen();
  updateLoadingMessage("正在重置筛选...");

  try {
    // 清空搜索框
    document.getElementById("search-input").value = "";
    appState.searchQuery = "";

    // 清空一级标签
    document.querySelectorAll(".primary-tag-btn").forEach((btn) => {
      btn.classList.remove("active");
      if (btn.dataset.value === "") {
        btn.classList.add("active"); // 激活"全部"按钮
      }
    });
    appState.selectedPrimaryTag = "";

    // 清空二级标签
    appState.selectedSecondaryTags = [];

    // 清空位置筛选
    appState.selectedLocations = [];
    document.querySelectorAll(".location-tag-btn").forEach((btn) => {
      btn.classList.remove("active");
    });

    // 清空二级标签显示
    await renderSecondaryTags("");

    // 重置排序状态
    appState.sortType = "name";
    appState.sortOrder = "asc";
    // saveSortConfig();
    updateSortButtonUI();

    // 重新执行搜索
    await performSearch();
  } finally {
    appState.isLoading = false;
    showMainScreen();
  }
}

// 处理搜索
function handleSearch(event) {
  appState.searchQuery = event.target.value;
  performSearch();
}

// 执行搜索
async function performSearch() {
  try {
    console.log(
      "执行搜索，查询词:",
      appState.searchQuery,
      "一级标签:",
      appState.selectedPrimaryTag,
      "二级标签:",
      appState.selectedSecondaryTags,
      "位置:",
      appState.selectedLocations
    );

    // 如果没有搜索条件，显示所有文件
    if (
      !appState.searchQuery &&
      !appState.selectedPrimaryTag &&
      appState.selectedSecondaryTags.length === 0
    ) {
      appState.vpkFiles = [...appState.allVpkFiles];
    } else {
      // 执行搜索
      const results = await SearchVPKFiles(
        appState.searchQuery,
        appState.selectedPrimaryTag,
        appState.selectedSecondaryTags
      );
      appState.vpkFiles = results;
    }

    // 应用位置过滤
    if (appState.selectedLocations.length > 0) {
      appState.vpkFiles = appState.vpkFiles.filter((file) =>
        appState.selectedLocations.includes(file.location)
      );
    }

    // 应用隐藏文件过滤
    if (!appState.showHidden) {
      appState.vpkFiles = appState.vpkFiles.filter(
        (file) => !file.name.startsWith("_")
      );
    }

    // 确保结果按名称排序，保持稳定顺序
    applySort(appState.vpkFiles);

    renderFileList();
    updateStatusBar();

    console.log(`搜索完成，显示 ${appState.vpkFiles.length} 个文件`);
  } catch (error) {
    console.error("搜索失败:", error);
    showError("搜索失败: " + error);
  }
}

// 渲染文件列表
function renderFileList() {
  const container = document.getElementById("file-list");
  container.innerHTML = "";

  appState.vpkFiles.forEach((file) => {
    const fileItem = createFileItem(file);
    container.appendChild(fileItem);
  });
}

// 创建文件项
function createFileItem(file) {
  const item = document.createElement("div");
  item.className = "file-item";
  item.dataset.path = file.path;

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "file-checkbox";
  checkbox.addEventListener("change", function () {
    toggleFileSelection(file.path, checkbox.checked);
  });

  const statusIcon = file.enabled ? "✅" : "❌";
  const locationIcon = getLocationIcon(file.location);
  const displayTitle = file.title || file.name;

  const isHidden = file.name.startsWith("_");
  const hideBtnText = isHidden ? "取消隐藏" : "隐藏";
  const hideBtnIcon = isHidden ? "👁️" : "👁️‍🗨️";

  item.innerHTML = `
        <div class="file-checkbox-container"></div>
        <div class="file-name" title="${file.path}">
            <div class="file-title">${displayTitle}</div>
            <div class="file-filename">${file.name}</div>
        </div>
        <div class="file-size">${formatFileSize(file.size)}</div>
        <div class="file-status">${statusIcon} ${
          file.enabled ? "启用" : "禁用"
        }</div>
        <div class="file-location">${locationIcon} ${getLocationDisplayName(
          file.location
        )}</div>
        <div class="file-tags">${formatTags(
          file.primaryTag,
          file.secondaryTags
        )}</div>
        <div class="file-actions">
            <button class="btn-small action-btn detail-btn" data-file-path="${
              file.path
            }">
                <span class="btn-icon">🔍</span>
                <span class="btn-text">详情</span>
            </button>
            ${getActionButton(file)}
            <div class="more-actions-dropdown">
                <button class="btn-small action-btn more-btn" title="更多操作">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                        <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
                    </svg>
                </button>
                <div class="dropdown-content hidden">
                    <button class="dropdown-item hide-btn" data-file-path="${
                      file.path
                    }" data-action="hide">
                        <span class="btn-icon">${hideBtnIcon}</span> ${hideBtnText}
                    </button>
                    <button class="dropdown-item set-tags-btn" data-file-path="${
                      file.path
                    }" data-action="set-tags">
                        <span class="btn-icon">🏷️</span> 设置标签
                    </button>
                    <button class="dropdown-item rename-btn" data-file-path="${
                      file.path
                    }" data-action="rename">
                        <span class="btn-icon">✏️</span> 重命名
                    </button>
                    <button class="dropdown-item open-location-btn" data-file-path="${
                      file.path
                    }" data-action="open-location">
                        <span class="btn-icon">📂</span> 位置
                    </button>
                    <button class="dropdown-item delete-btn" data-file-path="${
                      file.path
                    }" data-action="delete">
                        <span class="btn-icon">🗑️</span> 删除
                    </button>
                </div>
            </div>
        </div>
    `;

  // 插入复选框
  item.querySelector(".file-checkbox-container").appendChild(checkbox);

  // 为整个 item 添加双击事件（除了复选框和按钮）
  item.addEventListener("dblclick", function (e) {
    // 如果双击的是复选框或按钮，不触发详情
    if (
      e.target.closest(".file-checkbox-container") ||
      e.target.closest(".file-actions") ||
      e.target.type === "checkbox" ||
      e.target.closest("button")
    ) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    showFileDetail(file.path);
  });

  return item;
}

// 获取操作按钮
function getActionButton(file) {
  if (file.location === "workshop") {
    // Workshop文件显示转移按钮
    return `
      <button class="btn-small action-btn move-btn" data-file-path="${file.path}" data-action="move">
        <span class="btn-icon">📦</span>
        <span class="btn-text">转移</span>
      </button>
    `;
  } else {
    // Root和Disabled文件显示启用/禁用按钮
    return `
      <button class="btn-small action-btn toggle-btn ${
        file.enabled ? "toggle-disable" : "toggle-enable"
      }" data-file-path="${file.path}" data-action="toggle">
        <span class="btn-icon">${file.enabled ? "⛔" : "✅"}</span>
        <span class="btn-text">${file.enabled ? "禁用" : "启用"}</span>
      </button>
    `;
  }
}

// 获取位置图标
function getLocationIcon(location) {
  const icons = {
    root: "📁",
    workshop: "🔧",
    disabled: "🚫",
  };
  return icons[location] || "📄";
}

// 格式化文件大小
function formatFileSize(bytes) {
  if (bytes === 0) return "0 B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// 格式化标签
function formatTags(primaryTag, secondaryTags = []) {
  const tags = [];

  // 添加一级标签
  if (primaryTag) {
    tags.push(`<span class="tag primary-tag">${primaryTag}</span>`);
  }

  // 添加二级标签（最多显示2个）
  if (secondaryTags && secondaryTags.length > 0) {
    secondaryTags.slice(0, 2).forEach((tag) => {
      tags.push(`<span class="tag secondary-tag">${tag}</span>`);
    });

    // 如果还有更多二级标签，显示省略号
    if (secondaryTags.length > 2) {
      tags.push(
        `<span class="tag more-tags">+${secondaryTags.length - 2}</span>`
      );
    }
  }

  return tags.join("");
}

// 切换文件选择
function toggleFileSelection(filePath, selected) {
  if (selected) {
    appState.selectedFiles.add(filePath);
  } else {
    appState.selectedFiles.delete(filePath);
  }

  updateStatusBar();
}

// 全选
function selectAll() {
  const checkboxes = document.querySelectorAll(".file-checkbox");

  checkboxes.forEach((checkbox, index) => {
    checkbox.checked = true;
    const file = appState.vpkFiles[index];
    if (file) {
      toggleFileSelection(file.path, true);
    }
  });
}

// 取消全选
function deselectAll() {
  appState.selectedFiles.clear();

  const checkboxes = document.querySelectorAll(".file-checkbox");
  checkboxes.forEach((checkbox) => {
    checkbox.checked = false;
  });

  updateStatusBar();
}

// 启用选中的文件
async function enableSelected() {
  if (appState.selectedFiles.size === 0) {
    alert("请先选择文件");
    return;
  }

  const filesToToggle = Array.from(appState.selectedFiles).filter(
    (filePath) => {
      const file = appState.vpkFiles.find((f) => f.path === filePath);
      // 只处理disabled目录中的文件（workshop文件不能直接启用）
      return file && !file.enabled && file.location === "disabled";
    }
  );

  if (filesToToggle.length === 0) {
    showNotification(
      "没有需要启用的文件（只能启用disabled目录中的文件）",
      "info"
    );
    return;
  }

  try {
    console.log(`批量启用 ${filesToToggle.length} 个文件...`);

    // 并行处理所有文件
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

    // 批量更新成功的文件状态
    await batchUpdateFileStatus(successFiles);

    // 刷新列表以反映位置变化
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

// 禁用选中的文件
async function disableSelected() {
  if (appState.selectedFiles.size === 0) {
    alert("请先选择文件");
    return;
  }

  const filesToToggle = Array.from(appState.selectedFiles).filter(
    (filePath) => {
      const file = appState.vpkFiles.find((f) => f.path === filePath);
      // 只处理root目录中的启用文件（workshop文件不能直接禁用）
      return file && file.enabled && file.location === "root";
    }
  );

  if (filesToToggle.length === 0) {
    showNotification("没有需要禁用的文件（只能禁用root目录中的文件）", "info");
    return;
  }

  try {
    console.log(`批量禁用 ${filesToToggle.length} 个文件...`);

    // 并行处理所有文件
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

    // 批量更新成功的文件状态
    await batchUpdateFileStatus(successFiles);

    // 刷新列表以反映位置变化
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

// 批量导出ZIP
async function exportZipSelected() {
  const selectedFiles = Array.from(appState.selectedFiles);
  if (selectedFiles.length === 0) {
    showError("请先选择要导出的文件");
    return;
  }

  // 监听进度事件
  const cleanup = EventsOn("export-progress", (progress) => {
    updateLoadingMessage(
      `${progress.message} (${progress.current}/${progress.total})`
    );
  });

  showLoadingScreen();
  updateLoadingMessage("正在准备导出...");

  try {
    const result = await ExportVPKFilesToZip(selectedFiles);
    if (result === "cancelled") {
      return;
    }
    showSuccess(result);
  } catch (error) {
    console.error("导出ZIP失败:", error);
    showError("导出ZIP失败: " + error);
  } finally {
    showMainScreen();
    // 清理事件监听（虽然 EventsOn 返回的不是清理函数，但这里我们不需要手动清理，因为下次会重新注册或者覆盖）
    // 注意：Wails 的 EventsOn 返回的是一个清理函数，如果版本较新。
    // 如果 EventsOn 不返回清理函数，可能需要手动管理，但这里简单处理即可。
    // 实际上 Wails v2 的 EventsOn 返回一个取消订阅的函数。
    if (typeof cleanup === "function") {
      cleanup();
    }
  }
}

// 重命名文件
async function renameFile(filePath) {
  const file = appState.vpkFiles.find((f) => f.path === filePath);
  if (!file) return;

  const fileName = file.name;
  const isHidden = fileName.startsWith("_");

  // 隐藏标签部分，只显示文件名
  let editName = fileName;
  const tagMatch = fileName.match(/^(_)?\[(.*?)\](.*)$/);
  if (tagMatch) {
    // tagMatch[1] 是前缀 "_" (如果存在)
    // tagMatch[3] 是剩余的文件名 (e.g. "my_map.vpk")
    editName = (tagMatch[1] || "") + tagMatch[3];
  }

  // 去除前缀 _ 和后缀 .vpk
  if (isHidden) {
    editName = editName.substring(1);
  }
  if (editName.toLowerCase().endsWith(".vpk")) {
    editName = editName.substring(0, editName.length - 4);
  }

  // 显示自定义重命名模态框
  const modal = document.getElementById("rename-modal");
  const input = document.getElementById("rename-input");
  const confirmBtn = document.getElementById("confirm-rename-btn");
  const cancelBtn = document.getElementById("cancel-rename-btn");
  const closeBtn = document.getElementById("close-rename-modal-btn");

  input.value = editName;
  modal.classList.remove("hidden");
  input.focus();
  input.select();

  // 清理之前的事件监听器
  const cleanup = () => {
    modal.classList.add("hidden");
    confirmBtn.onclick = null;
    cancelBtn.onclick = null;
    closeBtn.onclick = null;
    input.onkeydown = null;
  };

  // 确认重命名逻辑
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

    // 组装新文件名
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

  confirmBtn.onclick = doRename;

  cancelBtn.onclick = cleanup;
  closeBtn.onclick = cleanup;

  // 回车确认，ESC取消
  input.onkeydown = (e) => {
    if (e.key === "Enter") {
      doRename();
    } else if (e.key === "Escape") {
      cleanup();
    }
  };
}

// 批量删除选中的文件
async function deleteSelected() {
  if (appState.selectedFiles.size === 0) {
    alert("请先选择文件");
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

        // 从选中集合中移除
        filesToDelete.forEach((filePath) =>
          appState.selectedFiles.delete(filePath)
        );

        // 刷新列表
        await refreshFilesKeepFilter();

        showNotification(`成功删除 ${filesToDelete.length} 个文件`, "success");
      } catch (error) {
        console.error("批量删除失败:", error);
        showError("批量删除失败: " + error);
      }
    }
  );
}

// 更新状态栏
function updateStatusBar() {
  // 使用完整列表进行统计
  const totalFiles = appState.allVpkFiles.length;
  const enabledFiles = appState.allVpkFiles.filter((f) => f.enabled).length;
  const disabledFiles = totalFiles - enabledFiles;
  const selectedCount = appState.selectedFiles.size;

  document.getElementById("total-files").textContent =
    `总文件数: ${totalFiles}`;
  document.getElementById("enabled-files").textContent =
    `已启用: ${enabledFiles}`;
  document.getElementById("disabled-files").textContent =
    `已禁用: ${disabledFiles}`;
  document.getElementById("selected-files").textContent =
    `已选择: ${selectedCount}`;
}

// 显示文件详情
let currentDetailFile = null;

window.showFileDetail = function (filePath) {
  console.log("=== showFileDetail 开始执行 ===");
  console.log("文件路径:", filePath);
  console.log("appState.vpkFiles 长度:", appState.vpkFiles.length);

  const file = appState.vpkFiles.find((f) => f.path === filePath);
  if (!file) {
    console.error("未找到文件:", filePath);
    console.log(
      "可用文件列表:",
      appState.vpkFiles.map((f) => f.path)
    );
    return;
  }

  console.log("找到文件:", file.name);
  currentDetailFile = file;
  console.log("当前详情文件:", currentDetailFile);

  // 检查模态框元素是否存在
  const modal = document.getElementById("file-detail-modal");
  console.log("模态框元素:", modal);

  if (!modal) {
    console.error("模态框元素不存在!");
    return;
  }

  // 填充基本信息
  document.getElementById("detail-file-name").textContent = file.name;
  document.getElementById("detail-name").textContent = file.name;
  document.getElementById("detail-size").textContent = formatFileSize(
    file.size
  );
  document.getElementById("detail-location").textContent =
    getLocationDisplayName(file.location);
  document.getElementById("detail-status").textContent = file.enabled
    ? "启用"
    : "禁用";
  document.getElementById("detail-modified").textContent = new Date(
    file.lastModified
  ).toLocaleString();

  // 显示预览图
  const previewSection = document.getElementById("preview-section");
  const previewImage = document.getElementById("detail-preview-image");
  if (file.previewImage) {
    previewSection.classList.remove("hidden");
    previewImage.src = file.previewImage;
    previewImage.style.display = "block";
  } else {
    previewSection.classList.add("hidden");
    previewImage.style.display = "none";
  }

  // 填充标签
  const tagsContainer = document.getElementById("detail-tags");
  const primaryTagHtml = file.primaryTag
    ? `<span class="tag primary-tag">${file.primaryTag}</span>`
    : "";
  tagsContainer.innerHTML = primaryTagHtml;

  const detailTagsContainer = document.getElementById("detail-detail-tags");
  const secondaryTagsHtml =
    file.secondaryTags && file.secondaryTags.length > 0
      ? file.secondaryTags
          .map((tag) => `<span class="tag secondary-tag">${tag}</span>`)
          .join("")
      : "";
  detailTagsContainer.innerHTML = secondaryTagsHtml;

  // 填充VPK信息
  const vpkInfoSection = document.getElementById("vpk-info-section");
  document.getElementById("detail-vpk-title").textContent =
    file.title || "无标题";

  // 作者信息（若有才显示）
  const authorItem = document.getElementById("detail-vpk-author-item");
  if (file.author && file.author !== "") {
    authorItem.style.display = "grid";
    document.getElementById("detail-vpk-author").textContent = file.author;
  } else {
    authorItem.style.display = "none";
  }

  // 版本信息（若有才显示）
  const versionItem = document.getElementById("detail-vpk-version-item");
  if (file.version && file.version !== "") {
    versionItem.style.display = "grid";
    document.getElementById("detail-vpk-version").textContent = file.version;
  } else {
    versionItem.style.display = "none";
  }

  // 描述信息（若有才显示）
  const descItem = document.getElementById("detail-vpk-desc-item");
  if (file.desc && file.desc !== "") {
    descItem.style.display = "grid";
    document.getElementById("detail-vpk-desc").textContent = file.desc;
  } else {
    descItem.style.display = "none";
  }

  // 链接信息（若有才显示）
  const urlItem = document.getElementById("detail-vpk-url-item");
  const urlLink = document.getElementById("detail-vpk-url");
  if (file.addonURL0 && file.addonURL0 !== "") {
    urlItem.style.display = "grid";
    urlLink.textContent = file.addonURL0;
    urlLink.href = file.addonURL0;
  } else {
    urlItem.style.display = "none";
  }

  // 填充地图信息
  const mapInfoSection = document.getElementById("map-info-section");
  if (file.primaryTag === "地图") {
    mapInfoSection.classList.remove("hidden");

    // 显示战役名（第一行）
    const campaignElement = document.getElementById("detail-campaign");
    campaignElement.textContent = file.campaign || "未知战役";

    // 显示章节和模式信息（第二行开始）
    const chaptersListElement = document.getElementById("detail-chapters-list");
    if (file.chapters && Object.keys(file.chapters).length > 0) {
      let chaptersHtml = "";
      // 遍历章节对象，key是章节代码，value是ChapterInfo
      Object.entries(file.chapters).forEach(([chapterCode, chapterInfo]) => {
        const chapterName = chapterInfo.title || chapterCode;
        const modes = chapterInfo.modes || [];
        chaptersHtml += `
          <div class="chapter-item">
            <div class="chapter-header">
              <div class="chapter-name">${chapterName}</div>
              <div class="chapter-code">${chapterCode}</div>
            </div>
            <div class="chapter-modes">${
              modes.length > 0 ? modes.join(" | ") : "未知模式"
            }</div>
          </div>
        `;
      });
      chaptersListElement.innerHTML = chaptersHtml;
    } else {
      chaptersListElement.innerHTML =
        '<div class="no-chapters">无章节信息</div>';
    }
  } else {
    mapInfoSection.classList.add("hidden");
  }

  console.log("显示模态框...");
  modal.classList.remove("hidden");

  // 将模态框内容滚动到顶部（使用 setTimeout 确保 DOM 更新后执行）
  setTimeout(() => {
    const modalContent = modal.querySelector(".modal-content");
    const modalBody = modal.querySelector(".modal-body");

    if (modalContent) {
      modalContent.scrollTop = 0;
    }
    if (modalBody) {
      modalBody.scrollTop = 0;
    }
  }, 0);

  console.log("模态框已显示, 当前类:", modal.className);
  console.log("=== showFileDetail 执行完成 ===");
};

// 关闭模态框
function closeModal() {
  document.getElementById("file-detail-modal").classList.add("hidden");
  currentDetailFile = null;
}

// 显示关于信息弹窗
function showInfoModal() {
  document.getElementById("info-modal").classList.remove("hidden");
}

// 关闭关于信息弹窗
function closeInfoModal() {
  document.getElementById("info-modal").classList.add("hidden");
}

// 切换文件隐藏状态
window.toggleFileVisibility = async function (filePath) {
  try {
    console.log("切换文件隐藏状态:", filePath);
    await window.go.main.App.ToggleVPKVisibility(filePath);
    await refreshFilesKeepFilter();
    showNotification("文件隐藏状态已更新", "success");
  } catch (error) {
    console.error("切换隐藏状态失败:", error);
    showError("操作失败: " + error);
  }
};

// 批量切换隐藏状态
async function batchToggleVisibility(hide) {
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
          // 检查当前状态
          const fileName = filePath.split(/[\\/]/).pop();
          const isHidden = fileName.startsWith("_");

          // 如果目标是隐藏(hide=false)且当前未隐藏，或者目标是取消隐藏(hide=true)且当前已隐藏
          // 注意：hide参数为true表示要"取消隐藏"（即显示），false表示要"隐藏"
          // 修正逻辑：
          // hide=false (隐藏操作): 只有当 !isHidden 时才执行
          // hide=true (取消隐藏操作): 只有当 isHidden 时才执行

          if ((!hide && !isHidden) || (hide && isHidden)) {
            await window.go.main.App.ToggleVPKVisibility(filePath);
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
        showNotification(
          `操作完成: 成功 ${successCount} 个, 失败 ${failCount} 个`,
          "warning"
        );
      } else {
        showNotification(`成功${actionName} ${successCount} 个文件`, "success");
      }

      // 清空选择
      deselectAll();
    }
  );
}

// 切换文件状态（全局函数）
window.toggleFile = async function (filePath) {
  try {
    console.log("切换文件状态:", filePath);

    // 调用后端切换状态
    await ToggleVPKFile(filePath);

    // 保持筛选状态的完整刷新
    await refreshFilesKeepFilter();

    showNotification("文件状态已更新", "success");
  } catch (error) {
    console.error("切换文件状态失败:", error);
    showError("操作失败: " + error);
  }
};

// 转移文件到插件目录（全局函数）
window.moveFileToAddons = async function (filePath) {
  try {
    console.log("转移文件到插件目录:", filePath);

    // 调用后端转移文件
    await MoveWorkshopToAddons(filePath);

    // 保持筛选状态的完整刷新
    await refreshFilesKeepFilter();

    showNotification("文件已转移到插件目录", "success");
  } catch (error) {
    console.error("转移文件失败:", error);
    showError("转移失败: " + error);
  }
};

// 删除文件（全局函数）
window.deleteFile = function (filePath) {
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
};

// 打开文件所在位置（全局函数）
window.openFileLocation = async function (filePath) {
  try {
    console.log("打开文件所在位置:", filePath);

    // 调用后端打开文件位置
    await OpenFileLocation(filePath);

    showNotification("已打开文件所在位置", "success");
  } catch (error) {
    console.error("打开文件位置失败:", error);
    showError("打开位置失败: " + error);
  }
};

// Mod随机轮换逻辑
async function initModRotationState() {
  // 检查后端方法是否存在（兼容性检查）
  if (!window.go?.main?.App?.SetModRotation) {
    console.warn("后端 SetModRotation 方法不可用");
    return;
  }

  // 从配置恢复状态
  const config = getConfig();
  const enabled = config.modRotationEnabled || false;

  try {
    // 同步到后端
    await window.go.main.App.SetModRotation(enabled);

    // 更新UI
    updateModRotationUI(enabled);
  } catch (e) {
    console.error("初始化Mod轮换状态失败:", e);
  }
}

function updateModRotationUI(enabled) {
  const btn = document.getElementById("mod-rotation-btn");
  if (!btn) return;

  if (enabled) {
    btn.classList.add("btn-rotation-enabled");
    btn.classList.remove("btn-outline");
    btn.innerHTML = `<span class="icon">${ROTATION_ICON_SVG}</span> 轮换已启用`;
  } else {
    btn.classList.remove("btn-rotation-enabled");
    btn.classList.add("btn-outline");
    btn.innerHTML = `<span class="icon">${ROTATION_ICON_SVG}</span> 轮换已禁用`;
  }
}

async function toggleModRotation() {
  if (!window.go?.main?.App?.SetModRotation) {
    showError("功能暂不可用：后端未实现轮换接口");
    return;
  }

  const config = getConfig();
  const currentlyEnabled = config.modRotationEnabled || false;

  if (currentlyEnabled) {
    // 禁用操作
    showConfirmModal(
      "关闭Mod随机轮换",
      "确定要关闭Mod随机轮换功能吗？\n\n关闭后，启动游戏将不再自动替换Mod。",
      async () => {
        try {
          config.modRotationEnabled = false;
          saveConfig(config);
          await window.go.main.App.SetModRotation(false);
          updateModRotationUI(false);
          showNotification("Mod随机轮换已禁用", "info");
        } catch (e) {
          showError("操作失败: " + e);
        }
      }
    );
  } else {
    // 启用操作
    const description = `
      <div class="rotation-desc-container">
        <p>开启 <strong>Mod随机轮换</strong> 功能后，每次从Mod管理器中启动时系统将自动：</p>
        <ul class="rotation-steps" style="text-align: left; padding-left: 20px; margin: 10px 0;">
          <li><strong>识别分类：</strong>扫描已启用中存在的人物/武器分类。</li>
          <li><strong>随机替换：</strong>从所有已安装Mod中随机选择同类替换。</li>
          <li><strong>自动应用：</strong>保持其他Mod不变，仅轮换指定随机池。</li>
        </ul>
        <p class="rotation-note" style="margin-top: 10px; font-size: 0.9em; color: var(--text-tertiary);">这能让您每次游玩时都体验不同的Mod组合。</p>
      </div>
    `;

    showConfirmModal(
      "开启Mod随机轮换",
      description,
      async () => {
        try {
          config.modRotationEnabled = true;
          saveConfig(config);
          await window.go.main.App.SetModRotation(true);
          updateModRotationUI(true);
          showNotification("Mod随机轮换已启用", "success");
        } catch (e) {
          showError("操作失败: " + e);
        }
      },
      true // useHtml
    );
  }
}

// LytVPK v2.8 - 启用/禁用逻辑重构版
//
// 功能特性：
// 1. Workshop文件只能转移，不能直接启用/禁用
// 2. Root文件可以禁用（移动到disabled目录）
// 3. Disabled文件可以启用（移动到root目录）
// 4. 文件状态切换后使用 refreshFilesKeepFilter() 完整刷新
// 5. 自动保存和恢复筛选状态（搜索词、标签筛选、状态筛选）
// 6. 确保文件列表按名称稳定排序，避免乱序跳动
// 7. 保持选中状态和UI一致性// 统一的文件排序函数

// 批量更新文件状态（保持列表顺序和筛选状态）
async function batchUpdateFileStatus(filePaths) {
  if (!filePaths || filePaths.length === 0) {
    return;
  }

  try {
    console.log(`批量更新 ${filePaths.length} 个文件状态...`);

    // 获取最新的文件列表
    const updatedFiles = await GetVPKFiles();

    // 创建一个映射以便快速查找
    const updatedFileMap = new Map(updatedFiles.map((f) => [f.path, f]));

    // 更新文件状态
    filePaths.forEach((filePath) => {
      const updatedFile = updatedFileMap.get(filePath);

      if (updatedFile) {
        // 更新原始完整列表
        const allFileIndex = appState.allVpkFiles.findIndex(
          (f) => f.path === filePath
        );
        if (allFileIndex >= 0) {
          appState.allVpkFiles[allFileIndex] = updatedFile;
        }

        // 更新当前显示列表中的文件（如果存在）
        const displayFileIndex = appState.vpkFiles.findIndex(
          (f) => f.path === filePath
        );
        if (displayFileIndex >= 0) {
          appState.vpkFiles[displayFileIndex] = updatedFile;

          // 更新单个文件的显示
          updateSingleFileDisplay(updatedFile);
        }
      }
    });

    // 更新状态栏
    updateStatusBar();

    console.log(`批量更新完成，共更新 ${filePaths.length} 个文件`);

    // 同步选中状态
    syncSelectedFiles();
  } catch (error) {
    console.error("批量更新文件状态失败:", error);
    // 如果批量更新失败，回退到完整刷新
    console.log("回退到完整刷新...");
    await refreshFiles();
  }
}

// 同步选中文件状态，确保界面显示的复选框状态正确
function syncSelectedFiles() {
  const checkboxes = document.querySelectorAll(".file-checkbox");
  checkboxes.forEach((checkbox, index) => {
    const file = appState.vpkFiles[index];
    if (file) {
      checkbox.checked = appState.selectedFiles.has(file.path);
    }
  });
}

// 错误队列
let errorQueue = [];
let errorTimer = null;

// 错误处理
function handleError(errorInfo) {
  console.error("应用错误:", errorInfo);
  errorQueue.push(errorInfo);

  if (errorTimer) {
    clearTimeout(errorTimer);
  }

  // 300ms 防抖，聚合短时间内的错误
  errorTimer = setTimeout(processErrorQueue, 300);
}

function processErrorQueue() {
  if (errorQueue.length === 0) return;

  const errors = [...errorQueue];
  errorQueue = []; // 清空队列

  if (errors.length === 1) {
    const errorInfo = errors[0];
    let title = errorInfo.type === "VPK解析" ? "解析错误" : errorInfo.type;
    let msg = `<strong>${title}</strong><br>`;

    if (errorInfo.file) {
      const fileName = errorInfo.file.split(/[\\/]/).pop();
      msg += `文件名：${fileName}<br>内容：${errorInfo.message}`;
    } else {
      msg += `内容：${errorInfo.message}`;
    }
    showError(msg, 5000);
  } else {
    // 多个错误聚合显示
    const type = errors[0].type === "VPK解析" ? "解析错误" : errors[0].type;
    let msg = `<strong>${type} (共${errors.length}个文件)</strong><br>`;

    // 显示前3个详情
    const maxShow = 3;
    for (let i = 0; i < Math.min(errors.length, maxShow); i++) {
      const err = errors[i];
      const fileName = err.file ? err.file.split(/[\\/]/).pop() : "未知文件";
      msg += `<div style="margin-top:4px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:2px;">
            文件名：${fileName}<br>
            <span style="opacity:0.8; font-size:0.9em;">内容：${err.message}</span>
        </div>`;
    }

    if (errors.length > maxShow) {
      msg += `<div style="margin-top:4px; font-style:italic;">...以及其他 ${
        errors.length - maxShow
      } 个文件</div>`;
    }

    showError(msg, 8000); // 多个错误显示时间长一点
  }
}

function showError(message, duration = 3000) {
  // 创建错误提示
  const errorDiv = document.createElement("div");
  errorDiv.className = "error-notification";
  errorDiv.innerHTML = `
    <div class="error-content">
      <span class="error-icon">⚠️</span>
      <span class="error-message">${message}</span>
      <button class="error-close" onclick="this.parentElement.parentElement.remove()">×</button>
    </div>
  `;

  document.body.appendChild(errorDiv);

  // 自动消失
  setTimeout(() => {
    if (errorDiv.parentNode) {
      errorDiv.parentNode.removeChild(errorDiv);
    }
  }, duration);
}

// 通用通知函数
function showNotification(message, type = "info") {
  console.log(`显示通知: ${message} (类型: ${type})`);

  switch (type) {
    case "success":
      showSuccess(message);
      break;
    case "error":
      showError(message);
      break;
    case "info":
    default:
      showInfo(message);
      break;
  }
}

function showSuccess(message) {
  // 创建成功提示
  const successDiv = document.createElement("div");
  successDiv.className = "success-notification";
  successDiv.innerHTML = `
    <div class="success-content">
      <span class="success-icon">✅</span>
      <span class="success-message">${message}</span>
      <button class="success-close" onclick="this.parentElement.parentElement.remove()">×</button>
    </div>
  `;

  document.body.appendChild(successDiv);

  // 3秒后自动消失
  setTimeout(() => {
    if (successDiv.parentNode) {
      successDiv.parentNode.removeChild(successDiv);
    }
  }, 3000);
}

// 显示信息提示
function showInfo(message) {
  const infoDiv = document.createElement("div");
  infoDiv.className = "info-notification";
  infoDiv.innerHTML = `
    <div class="info-content">
      <span class="info-icon">ℹ️</span>
      <span class="info-message">${message}</span>
      <button class="info-close" onclick="this.parentElement.parentElement.remove()">×</button>
    </div>
  `;

  document.body.appendChild(infoDiv);

  // 3秒后自动消失
  setTimeout(() => {
    if (infoDiv.parentNode) {
      infoDiv.style.opacity = "0";
      infoDiv.style.transform = "translateX(100%)";
      setTimeout(() => {
        if (infoDiv.parentNode) {
          infoDiv.parentNode.removeChild(infoDiv);
        }
      }, 300);
    }
  }, 3000);
}

// 创意工坊相关
let currentWorkshopDetails = null;

function openWorkshopModal() {
  document.getElementById("workshop-modal").classList.remove("hidden");
  document.getElementById("workshop-url").focus();
  refreshTaskList();
}

function closeWorkshopModal() {
  document.getElementById("workshop-modal").classList.add("hidden");
  // Reset state
  document.getElementById("workshop-url").value = "";
  document.getElementById("download-url").value = "";
  document.getElementById("download-url").placeholder =
    "解析后自动填充，或手动输入直链...";
  document.getElementById("workshop-result").classList.add("hidden");
  document.getElementById("workshop-result").innerHTML = "";
  document.getElementById("download-workshop-btn").innerHTML =
    DOWNLOAD_ICON_SVG + "<span>下载</span>";
  document.getElementById("optimized-ip-container").classList.add("hidden");
  document.getElementById("use-optimized-ip-global").checked = false;
  currentWorkshopDetails = null;
}

// 工坊解析缓存
const workshopCache = new Map();
const CACHE_DURATION = 3600 * 1000; // 1小时

async function checkWorkshopUrl() {
  const url = document.getElementById("workshop-url").value.trim();
  if (!url) {
    showError("请输入创意工坊链接");
    return;
  }

  const checkBtn = document.getElementById("check-workshop-btn");
  const result = document.getElementById("workshop-result");
  const downloadUrlInput = document.getElementById("download-url");

  // Set loading state
  const originalBtnText = checkBtn.innerHTML;
  checkBtn.disabled = true;
  checkBtn.innerHTML = '<span class="btn-spinner"></span> 解析中...';

  result.classList.add("hidden");
  downloadUrlInput.value = "";

  try {
    let detailsList;

    // 检查缓存
    if (workshopCache.has(url)) {
      const cached = workshopCache.get(url);
      if (Date.now() - cached.timestamp < CACHE_DURATION) {
        console.log("使用缓存的工坊解析结果");
        detailsList = cached.data;
      } else {
        workshopCache.delete(url);
      }
    }

    if (!detailsList) {
      detailsList = await GetWorkshopDetails(url);

      // 写入缓存
      if (detailsList && detailsList.length > 0) {
        workshopCache.set(url, {
          timestamp: Date.now(),
          data: detailsList,
        });
      }
    }

    currentWorkshopDetails = detailsList;

    result.innerHTML = ""; // Clear previous content

    if (!detailsList || detailsList.length === 0) {
      showError("未找到相关文件");
      return;
    }

    // If only one result, fill the input for backward compatibility
    const downloadBtn = document.getElementById("download-workshop-btn");
    const optimizedIpContainer = document.getElementById(
      "optimized-ip-container"
    );
    let hasSteamCDN = false;

    if (detailsList.length === 1) {
      downloadUrlInput.value = detailsList[0].file_url;
      downloadBtn.innerHTML = DOWNLOAD_ICON_SVG + "<span>下载</span>";
      if (detailsList[0].file_url.includes("cdn.steamusercontent.com")) {
        hasSteamCDN = true;
      }
    } else {
      downloadUrlInput.value = "";
      downloadUrlInput.placeholder = `解析出 ${detailsList.length} 个文件，请在下方选择下载`;
      downloadBtn.innerHTML = DOWNLOAD_ICON_SVG + "<span>全部下载</span>";
      // Check if any file is from Steam CDN
      for (const detail of detailsList) {
        if (detail.file_url.includes("cdn.steamusercontent.com")) {
          hasSteamCDN = true;
          break;
        }
      }
    }

    if (hasSteamCDN) {
      optimizedIpContainer.classList.remove("hidden");
    } else {
      optimizedIpContainer.classList.add("hidden");
      document.getElementById("use-optimized-ip-global").checked = false;
    }

    detailsList.forEach((details, index) => {
      const itemDiv = document.createElement("div");
      itemDiv.className = "workshop-info";
      itemDiv.style.cssText =
        "display: flex; gap: 20px; margin-bottom: 20px; border-bottom: 1px solid #eee; padding-bottom: 20px;";

      const creatorHtml =
        details.creator && details.creator.trim() !== ""
          ? `<p><strong>作者:</strong> <span>${details.creator}</span></p>`
          : "";

      itemDiv.innerHTML = `
            <img src="${
              details.preview_url
            }" alt="Preview" class="workshop-preview" style="max-width: 200px; max-height: 200px; object-fit: cover; border-radius: 4px;" />
            <div class="workshop-details" style="flex: 1;">
              <h3 style="margin-top: 0;">${details.title}</h3>
              <p><strong>文件名:</strong> <span>${details.filename}</span></p>
              <p><strong>大小:</strong> <span>${formatBytes(
                parseInt(details.file_size)
              )}</span></p>
              ${creatorHtml}
              <div style="margin-top: 10px;">
                  <button class="btn btn-success download-item-btn" data-index="${index}">下载此文件</button>
                  <button class="btn btn-secondary copy-url-item-btn" data-url="${
                    details.file_url
                  }">复制链接</button>
              </div>
            </div>
        `;
      result.appendChild(itemDiv);
    });

    // Bind events
    result.querySelectorAll(".download-item-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const index = parseInt(btn.dataset.index);
        const useOptimizedIP = document.getElementById(
          "use-optimized-ip-global"
        ).checked;
        try {
          await StartDownloadTask(
            currentWorkshopDetails[index],
            useOptimizedIP
          );
          showInfo("已添加到下载队列");
          refreshTaskList();
        } catch (err) {
          showError("下载失败: " + err);
        }
      });
    });

    result.querySelectorAll(".copy-url-item-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (navigator.clipboard) {
          navigator.clipboard
            .writeText(btn.dataset.url)
            .then(() => showInfo("链接已复制"));
        } else {
          const el = document.createElement("textarea");
          el.value = btn.dataset.url;
          document.body.appendChild(el);
          el.select();
          document.execCommand("copy");
          document.body.removeChild(el);
          showInfo("链接已复制");
        }
      });
    });

    result.classList.remove("hidden");
  } catch (err) {
    showError("解析失败: " + err);
  } finally {
    // Restore button state
    checkBtn.disabled = false;
    checkBtn.innerHTML = originalBtnText;
  }
}

async function downloadWorkshopFile() {
  const downloadUrl = document.getElementById("download-url").value.trim();
  const useOptimizedIP = document.getElementById(
    "use-optimized-ip-global"
  ).checked;

  // Handle multiple files download (Download All)
  if (
    Array.isArray(currentWorkshopDetails) &&
    currentWorkshopDetails.length > 1
  ) {
    let successCount = 0;
    for (const details of currentWorkshopDetails) {
      try {
        await StartDownloadTask(details, useOptimizedIP);
        successCount++;
      } catch (err) {
        console.error("Failed to start task for", details.title, err);
      }
    }

    if (successCount > 0) {
      showInfo(`已添加 ${successCount} 个任务到下载队列`);
      // Reset UI
      document.getElementById("workshop-url").value = "";
      document.getElementById("download-url").value = "";
      document.getElementById("download-url").placeholder =
        "解析后自动填充，或手动输入直链...";
      document.getElementById("workshop-result").classList.add("hidden");
      document.getElementById("download-workshop-btn").innerHTML =
        DOWNLOAD_ICON_SVG + "<span>下载</span>";
      currentWorkshopDetails = [];
      refreshTaskList();
    } else {
      showError("添加任务失败");
    }
    return;
  }

  if (!downloadUrl) {
    showError("请输入或解析下载链接");
    return;
  }

  let taskDetails = null;

  // If we have a single detail, use it as base
  if (
    Array.isArray(currentWorkshopDetails) &&
    currentWorkshopDetails.length === 1
  ) {
    taskDetails = { ...currentWorkshopDetails[0] };
    taskDetails.file_url = downloadUrl;
  } else {
    // Create dummy details for direct download
    // Try to extract filename from URL
    let filename = "unknown.vpk";
    try {
      const urlObj = new URL(downloadUrl);
      const pathParts = urlObj.pathname.split("/");
      if (pathParts.length > 0) {
        const lastPart = pathParts[pathParts.length - 1];
        if (lastPart && lastPart.trim() !== "") {
          filename = decodeURIComponent(lastPart);
        }
      }
    } catch (e) {
      console.warn("Failed to parse URL for filename:", e);
    }

    taskDetails = {
      title: "Direct Download",
      filename: filename,
      file_url: downloadUrl,
      file_size: "0",
      preview_url: "", // No preview
      publishedfileid: "direct-" + Date.now(),
      result: 1,
    };
  }

  try {
    await StartDownloadTask(taskDetails, useOptimizedIP);
    showInfo("已添加到后台下载队列");

    // Reset UI for next input
    document.getElementById("workshop-url").value = "";
    document.getElementById("download-url").value = "";
    document.getElementById("download-url").placeholder =
      "解析后自动填充，或手动输入直链...";
    document.getElementById("workshop-result").classList.add("hidden");
    document.getElementById("download-workshop-btn").innerHTML =
      DOWNLOAD_ICON_SVG + "<span>下载</span>";
    currentWorkshopDetails = [];

    // Refresh tasks list
    refreshTaskList();
  } catch (err) {
    showError("添加任务失败: " + err);
  }
}

async function refreshTaskList() {
  const listContainer = document.getElementById("download-tasks-list");
  try {
    const tasks = await GetDownloadTasks();

    if (!tasks || tasks.length === 0) {
      listContainer.innerHTML =
        '<div class="empty-tasks" style="text-align: center; color: #888; padding: 20px;">暂无下载任务</div>';
      return;
    }

    // Sort tasks: pending/downloading first, then by time
    tasks.sort((a, b) => {
      const statusOrder = {
        selecting_ip: 0,
        downloading: 1,
        pending: 2,
        failed: 3,
        completed: 4,
      };
      if (statusOrder[a.status] !== statusOrder[b.status]) {
        return (statusOrder[a.status] || 99) - (statusOrder[b.status] || 99);
      }
      return b.id.localeCompare(a.id);
    });

    listContainer.innerHTML = "";
    tasks.forEach((task) => {
      const item = createTaskElement(task);
      listContainer.appendChild(item);
    });
  } catch (err) {
    console.error("Failed to refresh tasks:", err);
  }
}

function createTaskElement(task) {
  const div = document.createElement("div");
  div.className = "task-item";
  div.id = `task-${task.id}`;
  div.style.cssText =
    "padding: 10px; border-bottom: 1px solid #eee; display: flex; gap: 10px; align-items: center;";

  const statusColors = {
    pending: "#ff9800",
    selecting_ip: "#9c27b0",
    downloading: "#2196f3",
    completed: "#4caf50",
    failed: "#f44336",
  };

  const statusText = {
    pending: "等待中",
    selecting_ip: "优选线路中...",
    downloading: "下载中",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
  };

  let actionButtons = "";
  if (
    task.status === "downloading" ||
    task.status === "pending" ||
    task.status === "selecting_ip"
  ) {
    actionButtons = `
      <button class="task-action-btn cancel-btn cancel-task-btn" data-id="${task.id}" title="取消下载">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>`;
  } else if (task.status === "failed" || task.status === "cancelled") {
    actionButtons = `
      <button class="task-action-btn retry-btn retry-task-btn" data-id="${task.id}" title="重试下载">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M23 4v6h-6"></path>
          <path d="M1 20v-6h6"></path>
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
        </svg>
      </button>`;
  }

  let previewHtml = "";
  if (task.preview_url) {
    previewHtml = `<img src="${task.preview_url}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 4px;">`;
  } else {
    previewHtml = `
      <div style="width: 50px; height: 50px; background-color: #f0f0f0; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: #888;">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
      </div>`;
  }

  div.innerHTML = `
    ${previewHtml}
    <div style="flex: 1;">
      <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
        <span class="task-title" style="font-weight: bold; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 250px;">${
          task.title
        }</span>
        <div style="display: flex; align-items: center; gap: 5px;">
          <span class="task-status" style="font-size: 12px; color: ${
            statusColors[task.status] || "#666"
          };">${statusText[task.status] || task.status}</span>
          ${actionButtons}
        </div>
      </div>
      <div style="font-size: 12px; color: #666; margin-bottom: 5px;">${
        task.filename
      }</div>
      <div class="progress-bar" style="width: 100%; height: 6px; background-color: #eee; border-radius: 3px; overflow: hidden;">
        <div class="progress-fill" style="width: ${
          task.progress
        }%; height: 100%; background-color: ${
          statusColors[task.status] || "#ccc"
        }; transition: width 0.3s;"></div>
      </div>
      <div style="display: flex; justify-content: space-between; font-size: 11px; color: #888; margin-top: 2px;">
        <span class="task-size">${formatBytes(
          task.downloaded_size
        )} / ${formatBytes(task.total_size)} ${
          task.speed ? `(${task.speed})` : ""
        }</span>
        <span class="task-percent">${task.progress}%</span>
      </div>
      ${
        task.error
          ? `<div style="color: #f44336; font-size: 11px; margin-top: 2px;">${task.error}</div>`
          : ""
      }
    </div>
  `;

  // Add event listeners for buttons
  const cancelBtn = div.querySelector(".cancel-task-btn");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      showConfirmModal("取消下载", "确定要取消这个下载任务吗？", async () => {
        try {
          await CancelDownloadTask(task.id);
          showNotification("任务已取消", "info");
        } catch (err) {
          console.error("取消任务失败:", err);
          showError("取消失败: " + err);
        }
      });
    });
  }

  const retryBtn = div.querySelector(".retry-task-btn");
  if (retryBtn) {
    retryBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await RetryDownloadTask(task.id);
        showNotification("任务已重试", "success");
      } catch (err) {
        console.error("重试任务失败:", err);
        showError("重试失败: " + err);
      }
    });
  }

  return div;
}

// 确认对话框逻辑
function showConfirmModal(title, message, onConfirm, useHtml = false) {
  const modal = document.getElementById("confirm-modal");
  const titleEl = document.getElementById("confirm-title");
  const messageEl = document.getElementById("confirm-message");
  const okBtn = document.getElementById("confirm-ok-btn");
  const cancelBtn = document.getElementById("confirm-cancel-btn");
  const closeBtn = document.getElementById("close-confirm-modal-btn");

  titleEl.textContent = title;
  if (useHtml) {
    messageEl.innerHTML = message;
  } else {
    messageEl.textContent = message;
  }
  modal.classList.remove("hidden");

  const cleanup = () => {
    modal.classList.add("hidden");
    okBtn.onclick = null;
    cancelBtn.onclick = null;
    closeBtn.onclick = null;
  };

  okBtn.onclick = () => {
    cleanup();
    onConfirm();
  };

  cancelBtn.onclick = cleanup;
  closeBtn.onclick = cleanup;
}

function updateTaskInList(task) {
  const existing = document.getElementById(`task-${task.id}`);
  if (existing) {
    // Simple update: replace content or just update specific fields
    // For simplicity, replace the whole element to ensure state consistency
    const newItem = createTaskElement(task);
    existing.replaceWith(newItem);
  } else {
    // New task, refresh list to insert in correct order
    refreshTaskList();
  }

  // If completed, refresh file list
  if (task.status === "completed") {
    if (typeof refreshFilesKeepFilter === "function") {
      refreshFilesKeepFilter();
    } else if (typeof loadFiles === "function") {
      loadFiles();
    }
  }
}

function updateTaskProgress(task) {
  const el = document.getElementById(`task-${task.id}`);
  if (el) {
    const fill = el.querySelector(".progress-fill");
    const percentText = el.querySelector(".task-percent");
    const sizeText = el.querySelector(".task-size");

    if (fill) fill.style.width = `${task.progress}%`;
    if (percentText) percentText.textContent = `${task.progress}%`;
    if (sizeText)
      sizeText.textContent = `${formatBytes(
        task.downloaded_size
      )} / ${formatBytes(task.total_size)} ${
        task.speed ? `(${task.speed})` : ""
      }`;
  }
}

document
  .getElementById("clear-completed-tasks-btn")
  .addEventListener("click", async () => {
    await ClearCompletedTasks();
  });

// Helper for file size
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

function handleDroppedPaths(paths) {
  if (typeof HandleFileDrop === "function") {
    updateLoadingMessage("正在处理拖入的文件...");
    showLoadingScreen();

    HandleFileDrop(paths)
      .then(() => {
        showMainScreen();
      })
      .catch((err) => {
        showMainScreen();
        showError("处理文件失败: " + err);
      });
  } else {
    console.error("HandleFileDrop function not found");
    showError("请重新构建应用以启用拖拽功能");
  }
}

// --- 服务器收藏功能 ---

const SERVER_CONFIG_KEY = "vpk-manager-servers";

function getServers() {
  try {
    const servers = localStorage.getItem(SERVER_CONFIG_KEY);
    const parsed = servers ? JSON.parse(servers) : [];
    const list = Array.isArray(parsed) ? parsed : [];
    // 按权重降序排序
    return list.sort((a, b) => (b.weight || 0) - (a.weight || 0));
  } catch (e) {
    console.error("读取服务器列表失败:", e);
    return [];
  }
}

function saveServers(servers) {
  localStorage.setItem(SERVER_CONFIG_KEY, JSON.stringify(servers));
}

// --- 编辑/添加服务器功能 ---
let currentEditIndex = -1;
let isEditMode = false;

function openServerFormModal(index = -1) {
  const modal = document.getElementById("server-form-modal");
  const title = document.getElementById("server-form-title");
  const nameInput = document.getElementById("form-server-name");
  const addressInput = document.getElementById("form-server-address");
  const weightInput = document.getElementById("form-server-weight");

  // 重置表单
  nameInput.value = "";
  addressInput.value = "";
  weightInput.value = "0";

  if (index >= 0) {
    // 编辑模式
    isEditMode = true;
    currentEditIndex = index;
    title.textContent = "编辑服务器";

    const servers = getServers();
    const server = servers[index];
    if (server) {
      nameInput.value = server.name;
      addressInput.value = server.address;
      weightInput.value = server.weight || 0;
    }
  } else {
    // 添加模式
    isEditMode = false;
    currentEditIndex = -1;
    title.textContent = "添加服务器";
  }

  modal.classList.remove("hidden");
  document.getElementById("global-dropdown").classList.add("hidden");
}

function closeServerFormModal() {
  document.getElementById("server-form-modal").classList.add("hidden");
  currentEditIndex = -1;
  isEditMode = false;
}

function saveServerForm() {
  const name = document.getElementById("form-server-name").value.trim();
  const address = document.getElementById("form-server-address").value.trim();
  const weight =
    parseInt(document.getElementById("form-server-weight").value) || 0;

  if (!name || !address) {
    showError("请输入服务器名称和地址");
    return;
  }

  const servers = getServers();

  if (isEditMode) {
    // 编辑模式
    if (currentEditIndex >= 0 && currentEditIndex < servers.length) {
      servers[currentEditIndex] = {
        ...servers[currentEditIndex],
        name,
        address,
        weight,
      };
      saveServers(servers);
      showNotification("服务器修改成功", "success");
    }
  } else {
    // 添加模式
    servers.push({ name, address, weight });
    saveServers(servers);
    showNotification("服务器添加成功", "success");
  }

  renderServers();
  closeServerFormModal();

  // 尝试刷新该服务器信息
  // 重新获取列表以找到新位置（因为可能排序了）
  const newServers = getServers();
  const newIndex = newServers.findIndex(
    (s) => s.address === address && s.name === name
  );
  if (newIndex !== -1) {
    fetchServerInfo(address, newIndex);
  }
}

function setupServerModalListeners() {
  document
    .getElementById("close-server-modal-btn")
    .addEventListener("click", closeServerModal);
  document
    .getElementById("open-add-server-modal-btn")
    .addEventListener("click", () => openServerFormModal(-1));

  // 编辑/添加服务器相关
  document
    .getElementById("close-server-form-modal-btn")
    .addEventListener("click", closeServerFormModal);
  document
    .getElementById("cancel-server-form-btn")
    .addEventListener("click", closeServerFormModal);
  document
    .getElementById("save-server-form-btn")
    .addEventListener("click", saveServerForm);

  document
    .getElementById("global-edit-server-btn")
    .addEventListener("click", () => {
      const dropdown = document.getElementById("global-dropdown");
      const index = parseInt(dropdown.dataset.index);
      if (!isNaN(index)) {
        openServerFormModal(index);
      }
    });

  // 详情按钮
  document
    .getElementById("global-details-server-btn")
    .addEventListener("click", () => {
      const dropdown = document.getElementById("global-dropdown");
      const index = parseInt(dropdown.dataset.index);
      if (!isNaN(index)) {
        openServerDetailsModal(index);
        dropdown.classList.add("hidden");
      }
    });

  document
    .getElementById("close-server-details-modal-btn")
    .addEventListener("click", () => {
      document.getElementById("server-details-modal").classList.add("hidden");
    });

  // 点击详情模态框外部关闭
  document
    .getElementById("server-details-modal")
    .addEventListener("click", function (e) {
      if (e.target === this) {
        this.classList.add("hidden");
      }
    });

  // 数据管理折叠
  document
    .getElementById("toggle-data-mgmt-btn")
    .addEventListener("click", () => {
      const container = document.getElementById("server-data-container");
      const icon = document.querySelector("#toggle-data-mgmt-btn .icon");
      container.classList.toggle("hidden");
      icon.textContent = container.classList.contains("hidden") ? "▼" : "▲";
    });

  // 数据导入导出
  document
    .getElementById("export-clipboard-btn")
    .addEventListener("click", exportServersToClipboard);
  document
    .getElementById("export-file-btn")
    .addEventListener("click", exportServersToFile);
  document
    .getElementById("import-clipboard-btn")
    .addEventListener("click", importServersFromClipboard);

  const fileInput = document.getElementById("import-file-input");
  document
    .getElementById("import-file-btn")
    .addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      importServers(event.target.result);
      fileInput.value = ""; // 重置以便再次选择同一文件
    };
    reader.onerror = () => showError("读取文件失败");
    reader.readAsText(file);
  });

  // 全局删除按钮事件
  document
    .getElementById("global-delete-server-btn")
    .addEventListener("click", (e) => {
      const dropdown = document.getElementById("global-dropdown");
      const index = parseInt(dropdown.dataset.index);
      if (!isNaN(index)) {
        deleteServer(index);
        dropdown.classList.add("hidden");
      }
    });

  // 刷新所有按钮
  const refreshAllBtn = document.getElementById("refresh-all-servers-btn");
  if (refreshAllBtn) {
    refreshAllBtn.addEventListener("click", refreshAllServers);
  }

  // 点击模态框外部关闭
  window.addEventListener("click", (event) => {
    const modal = document.getElementById("server-modal");
    if (event.target === modal) {
      closeServerModal();
    }

    // 点击任意位置关闭全局下拉菜单
    if (
      !event.target.closest(".server-more-btn") &&
      !event.target.closest("#global-dropdown")
    ) {
      document.getElementById("global-dropdown").classList.add("hidden");
    }
  });

  // 滚动时关闭下拉菜单
  window.addEventListener(
    "scroll",
    () => {
      document.getElementById("global-dropdown").classList.add("hidden");
    },
    true
  );
}

function openServerModal() {
  const modal = document.getElementById("server-modal");
  modal.classList.remove("hidden");

  renderServers();

  // 自动刷新所有服务器信息
  refreshAllServers();
}

function closeServerModal() {
  const modal = document.getElementById("server-modal");
  modal.classList.add("hidden");
}

function renderServers() {
  const servers = getServers();
  const list = document.getElementById("server-list");
  list.innerHTML = "";

  servers.forEach((server, index) => {
    const li = createServerListItem(server, index);
    list.appendChild(li);

    // 初始渲染时，获取信息
    fetchServerInfo(server.address, index);
  });
}

function createServerListItem(server, index) {
  const li = document.createElement("li");
  li.className = "server-item";
  li.dataset.address = server.address;

  let detailsHtml = `
        <div class="server-details" id="server-details-${index}">
          <span style="font-size: 0.85em; color: var(--text-tertiary);">加载中...</span>
        </div>
      `;

  li.innerHTML = `
      <div class="server-info">
        <span class="server-name" id="server-name-${index}">
          ${server.name}
        </span>
        <span class="server-address">${server.address}</span>
        ${detailsHtml}
      </div>
      <div class="server-actions">
        <button class="btn btn-small btn-success connect-server-btn" data-address="${server.address}">
          <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 1em; height: 1em; margin-right: 4px;">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
          </svg>
          连接
        </button>
        <button class="btn btn-small btn-outline refresh-server-btn" title="刷新" data-address="${server.address}" data-index="${index}" style="padding: 0; width: 2rem; justify-content: center;">
            <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 1.1em; height: 1.1em;">
                <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path>
                <path d="M21 3v5h-5"></path>
            </svg>
        </button>
        <button class="btn btn-small btn-outline server-more-btn" title="更多操作" data-index="${index}" style="padding: 0; width: 2rem; justify-content: center;">
            <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 1.1em; height: 1.1em;">
                <circle cx="12" cy="12" r="1"></circle>
                <circle cx="12" cy="5" r="1"></circle>
                <circle cx="12" cy="19" r="1"></circle>
            </svg>
        </button>
      </div>
    `;

  // 双击进入详情
  li.addEventListener("dblclick", (e) => {
    // 如果点击的是按钮，不触发详情
    if (e.target.closest("button")) return;
    openServerDetailsModal(index);
  });

  // 绑定连接按钮事件
  const connectBtn = li.querySelector(".connect-server-btn");
  if (connectBtn) {
    connectBtn.addEventListener("click", (e) => {
      const target = e.target.closest(".connect-server-btn");
      const address = target.dataset.address;
      connectServer(address);
    });
  }

  // 绑定刷新按钮事件
  const refreshBtn = li.querySelector(".refresh-server-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", (e) => {
      const target = e.target.closest(".refresh-server-btn");
      const icon = target.querySelector("svg");
      if (icon) icon.classList.add("spinning");
      target.disabled = true;

      const address = target.dataset.address;
      const idx = target.dataset.index;

      fetchServerInfo(address, idx).finally(() => {
        if (icon) icon.classList.remove("spinning");
        target.disabled = false;
      });
    });
  }

  // 绑定更多按钮事件
  const moreBtn = li.querySelector(".server-more-btn");
  if (moreBtn) {
    moreBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = moreBtn.dataset.index;
      const dropdown = document.getElementById("global-dropdown");

      if (
        !dropdown.classList.contains("hidden") &&
        dropdown.dataset.index === idx
      ) {
        dropdown.classList.add("hidden");
        return;
      }

      const rect = moreBtn.getBoundingClientRect();
      dropdown.style.top = `${rect.bottom + 5}px`;
      dropdown.style.left = `${rect.right - 100}px`;

      dropdown.dataset.index = idx;
      dropdown.classList.remove("hidden");
    });
  }

  return li;
}

// 全局函数以便在HTML中调用
// window.refreshServerInfo 已废弃，因为移除了单个刷新按钮

function refreshAllServers() {
  const servers = getServers();

  const btn = document.getElementById("refresh-all-servers-btn");
  if (btn) {
    const icon = btn.querySelector(".icon");
    if (icon) icon.classList.add("spinning");
    btn.disabled = true;
  }

  const promises = servers.map((server, index) =>
    fetchServerInfo(server.address, index)
  );

  Promise.allSettled(promises).finally(() => {
    if (btn) {
      const icon = btn.querySelector(".icon");
      if (icon) icon.classList.remove("spinning");
      btn.disabled = false;
    }
  });
}

async function resolveMapName(mapCode) {
  if (!mapCode) return mapCode;
  try {
    // 使用后端 Go 方法获取地图名，解决 CORS 问题
    if (
      window.go &&
      window.go.main &&
      window.go.main.App &&
      window.go.main.App.GetMapName
    ) {
      const name = await window.go.main.App.GetMapName(mapCode);
      if (name && name.length > 0) {
        return name;
      }
    } else if (typeof GetMapName === "function") {
      // 尝试使用导入的函数
      const name = await GetMapName(mapCode);
      if (name && name.length > 0) {
        return name;
      }
    }
  } catch (e) {
    console.error("Failed to resolve map name via backend", e);
  }
  return mapCode; // Fallback to original
}

async function fetchServerInfo(address, index) {
  let detailsContainer = null;

  // 优先通过地址查找，以避免索引变化导致的错位
  // 遍历查找比querySelector更安全（防止特殊字符破坏选择器）
  const listItems = document.querySelectorAll("li.server-item");
  for (const li of listItems) {
    if (li.dataset.address === address) {
      detailsContainer = li.querySelector(".server-details");
      break;
    }
  }

  // 回退到通过ID查找
  if (!detailsContainer) {
    detailsContainer = document.getElementById(`server-details-${index}`);
  }

  if (!detailsContainer) return;

  try {
    const info = await FetchServerInfo(address);

    // 再次检查元素是否存在（防止异步期间被删除）
    if (!document.body.contains(detailsContainer)) return;

    detailsContainer.innerHTML = `
      <div class="server-stats-grid">
        <span class="stat-badge name-badge" title="${info.name}">🏠 ${info.name}</span>
        <span class="stat-badge mode-badge" title="游戏模式">🎮 ${info.mode}</span>
        <span class="stat-badge map-badge" title="地图: ${info.map} (点击解析)" data-map-code="${info.map}">🗺️ ${info.map}</span>
        <span class="stat-badge players-badge" title="在线人数">👥 ${info.players}/${info.max_players}</span>
      </div>
    `;

    // 绑定地图点击事件
    const mapBadge = detailsContainer.querySelector(".map-badge");
    if (mapBadge) {
      mapBadge.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (mapBadge.dataset.resolved === "true") return;

        const originalText = mapBadge.textContent;
        mapBadge.textContent = "🗺️ 解析中...";
        mapBadge.style.cursor = "wait";

        try {
          const realName = await resolveMapName(info.map);
          if (realName && realName !== info.map) {
            mapBadge.textContent = `🗺️ ${realName}`;
            mapBadge.dataset.resolved = "true";
            mapBadge.title = `地图: ${info.map}`;
            mapBadge.style.cursor = "default";
            // 移除 hover 效果
            mapBadge.style.textDecoration = "none";
            mapBadge.style.color = "inherit";
          } else {
            mapBadge.textContent = originalText;
            mapBadge.style.cursor = "pointer";
          }
        } catch (err) {
          mapBadge.textContent = originalText;
          mapBadge.style.cursor = "pointer";
        }
      });
    }
  } catch (err) {
    console.error("获取服务器信息失败:", err);
    if (document.body.contains(detailsContainer)) {
      detailsContainer.innerHTML = `<span class="error-text">获取失败</span>`;
    }
  }
}

// function addServer() { ... } 已被整合到 saveServerForm 中，此处保留空函数或删除以避免引用错误
// 但为了安全起见，如果还有其他地方调用 addServer，可以保留一个兼容版本
function addServer() {
  openServerFormModal(-1);
}

function deleteServer(index) {
  console.log("deleteServer called with index:", index);
  const servers = getServers();
  const server = servers[index];

  if (!server) {
    console.error("Server not found at index:", index);
    showError("无法找到要删除的服务器");
    return;
  }

  showConfirmModal(
    "删除服务器",
    `确定要删除服务器 "${server.name}" 吗？`,
    () => {
      console.log("Confirm callback executed for index:", index);
      const currentServers = getServers();
      // 确保 index 是数字
      const idx = parseInt(index);

      if (!isNaN(idx) && idx >= 0 && idx < currentServers.length) {
        currentServers.splice(idx, 1);
        saveServers(currentServers);

        // 直接从DOM中移除元素，而不是重新渲染整个列表
        const list = document.getElementById("server-list");
        const itemToRemove = list.children[idx];
        if (itemToRemove) {
          list.removeChild(itemToRemove);

          // 更新剩余项的索引
          Array.from(list.children).forEach((li, newIndex) => {
            // 更新更多按钮的索引
            const moreBtn = li.querySelector(".server-more-btn");
            if (moreBtn) moreBtn.dataset.index = newIndex;

            // 更新详情容器ID (如果需要的话，虽然不更新也不影响显示，但为了保持一致性)
            const details = li.querySelector(".server-details");
            if (details) details.id = `server-details-${newIndex}`;

            // 更新名称ID
            const nameEl = li.querySelector(".server-name");
            if (nameEl) nameEl.id = `server-name-${newIndex}`;
          });
        } else {
          // 如果DOM操作失败，回退到重新渲染（但不自动刷新信息）
          renderServers(false);
        }

        showNotification("服务器已删除", "success");
      } else {
        console.error("Invalid index in callback:", idx);
        showError("删除失败：索引无效");
      }
    }
  );
}

function connectServer(address) {
  ConnectToServer(address)
    .then(() => {
      // 可以添加一些提示，比如“正在启动...”
    })
    .catch((err) => {
      console.error("连接服务器失败:", err);
      alert("连接服务器失败: " + err);
    });
}

function exportServersToClipboard() {
  const servers = getServers();
  const json = JSON.stringify(servers, null, 2);
  navigator.clipboard
    .writeText(json)
    .then(() => {
      showNotification("服务器配置已复制到剪贴板", "success");
    })
    .catch((err) => {
      console.error("复制失败:", err);
      showError("复制失败: " + err);
    });
}

function exportServersToFile() {
  const servers = getServers();
  const json = JSON.stringify(servers, null, 2);

  ExportServersToFile(json)
    .then((path) => {
      if (path) {
        showNotification("服务器配置已导出", "success");
      }
    })
    .catch((err) => {
      console.error("导出失败:", err);
      showError("导出失败: " + err);
    });
}

async function importServersFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) {
      showError("剪贴板为空");
      return;
    }
    importServers(text);
  } catch (err) {
    console.error("读取剪贴板失败:", err);
    showError("无法读取剪贴板: " + err);
  }
}

function importServers(jsonStr) {
  try {
    const newServers = JSON.parse(jsonStr);
    if (!Array.isArray(newServers)) {
      throw new Error("数据格式错误: 必须是服务器数组");
    }

    const currentServers = getServers();
    let addedCount = 0;

    newServers.forEach((server) => {
      if (server.name && server.address) {
        // 检查是否存在
        const existingIndex = currentServers.findIndex(
          (s) => s.address === server.address
        );

        if (existingIndex === -1) {
          currentServers.push({
            name: server.name,
            address: server.address,
            weight: server.weight || 0,
          });
          addedCount++;
        }
      }
    });

    if (addedCount > 0) {
      saveServers(currentServers);
      renderServers();
      showNotification(`成功导入 ${addedCount} 个新服务器`, "success");
    } else {
      showNotification("没有发现新的服务器配置", "info");
    }
  } catch (e) {
    console.error("导入失败:", e);
    showError("导入失败: " + e.message);
  }
}

async function openServerDetailsModal(index) {
  const servers = getServers();
  const server = servers[index];
  if (!server) return;

  const modal = document.getElementById("server-details-modal");
  const title = document.getElementById("details-server-name");
  const loading = document.getElementById("server-details-loading");
  const content = document.getElementById("server-details-content");
  const mapEl = document.getElementById("details-map");
  const playersEl = document.getElementById("details-players");
  const listEl = document.getElementById("details-player-list");

  title.textContent = server.name;
  loading.classList.remove("hidden");
  content.classList.add("hidden");
  modal.classList.remove("hidden");

  try {
    // Fetch basic info first
    const info = await FetchServerInfo(server.address);
    mapEl.textContent = info.map;
    mapEl.title = `地图: ${info.map}`;
    playersEl.textContent = `${info.players}/${info.max_players}`;

    // 异步尝试解析地图名
    resolveMapName(info.map).then((realName) => {
      if (realName !== info.map && document.body.contains(mapEl)) {
        mapEl.textContent = realName;
        mapEl.title = `地图: ${info.map}`;
      }
    });

    // Fetch players
    // Using window.go.main.App.FetchPlayerList because it might not be imported yet
    const players = await window.go.main.App.FetchPlayerList(server.address);

    listEl.innerHTML = "";
    if (players && players.length > 0) {
      // Sort by score desc
      players.sort((a, b) => b.score - a.score);

      players.forEach((p) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
                    <td class="player-name">${escapeHtml(p.name)}</td>
                    <td class="text-right">${p.score}</td>
                    <td class="text-right">${formatDuration(p.duration)}</td>
                `;
        listEl.appendChild(tr);
      });
    } else {
      listEl.innerHTML =
        '<tr><td colspan="3" class="empty-state">暂无玩家信息</td></tr>';
    }

    loading.classList.add("hidden");
    content.classList.remove("hidden");
  } catch (err) {
    console.error(err);
    loading.textContent = "获取失败: " + err;
  }
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s
      .toString()
      .padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// 检查更新 (自动检查用)
async function checkAndInstallUpdate() {
  try {
    const info = await CheckUpdate();

    // 更新关于页面的版本显示
    const verDisplay = document.getElementById("current-version-display");
    if (verDisplay) {
      verDisplay.textContent = `v${info.current_ver}`;
    }

    if (info.error) {
      console.error("检查更新出错:", info.error);
      return;
    }

    if (info.has_update) {
      // 检查是否已忽略此版本
      const config = getConfig();
      if (config.ignoredVersion === info.latest_ver) {
        console.log("已忽略版本:", info.latest_ver);
        return;
      }
      showUpdateModal(info);
    } else {
      console.log("当前已是最新版本");
    }
  } catch (e) {
    console.error(e);
  }
}

// 手动检查更新 (按钮触发)
async function manualCheckUpdate() {
  const btn = document.getElementById("check-update-btn");
  const msgDiv = document.getElementById("update-status-msg");
  const verDisplay = document.getElementById("current-version-display");

  if (!btn) return;

  btn.disabled = true;
  btn.textContent = "检查中...";
  msgDiv.classList.add("hidden");
  msgDiv.className = "update-msg hidden"; // reset classes

  try {
    const info = await CheckUpdate();

    if (verDisplay) {
      verDisplay.textContent = `v${info.current_ver}`;
    }

    if (info.error) {
      msgDiv.textContent = "检查失败: " + info.error;
      msgDiv.classList.add("error");
      msgDiv.classList.remove("hidden");
    } else if (info.has_update) {
      msgDiv.innerHTML = `发现新版本: <strong>v${info.latest_ver}</strong>`;
      msgDiv.classList.add("success");
      msgDiv.classList.remove("hidden");

      showUpdateModal(info);
    } else {
      msgDiv.textContent = `当前已是最新版本 (v${info.latest_ver})`;
      msgDiv.classList.add("success");
      msgDiv.classList.remove("hidden");
    }
  } catch (e) {
    msgDiv.textContent = "发生错误: " + e;
    msgDiv.classList.add("error");
    msgDiv.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "检查更新";
  }
}

// 显示更新弹窗
async function showUpdateModal(info) {
  const modal = document.getElementById("update-modal");
  const newVer = document.getElementById("new-version-number");
  const curVer = document.getElementById("current-version-number");
  const notes = document.getElementById("release-notes-content");
  const mirrorSelect = document.getElementById("mirror-select");
  const customInput = document.getElementById("custom-mirror-input");
  const confirmBtn = document.getElementById("confirm-update-btn");
  const cancelBtn = document.getElementById("cancel-update-btn");
  const closeBtn = document.getElementById("close-update-modal-btn");
  const progressContainer = document.getElementById(
    "update-progress-container"
  );
  const progressFill = document.getElementById("update-progress-fill");
  const progressText = document.getElementById("update-progress-text");
  const modalFooter = document.getElementById("update-modal-footer");
  const ignoreBtn = document.getElementById("ignore-update-btn");

  newVer.textContent = info.latest_ver;
  curVer.textContent = info.current_ver;
  notes.textContent = info.release_note || "暂无更新日志";

  // 加载镜像列表
  try {
    const mirrors = await GetMirrors();
    mirrorSelect.innerHTML = '<option value="">GitHub 直连</option>';
    if (mirrors && mirrors.length > 0) {
      mirrors.forEach((mirror) => {
        const option = document.createElement("option");
        option.value = mirror;
        option.textContent = mirror;
        mirrorSelect.appendChild(option);
      });
    }
    const customOption = document.createElement("option");
    customOption.value = "custom";
    customOption.textContent = "自定义镜像源...";
    mirrorSelect.appendChild(customOption);
  } catch (e) {
    console.error("Failed to load mirrors:", e);
  }

  // 重置状态
  mirrorSelect.value = "";
  customInput.classList.add("hidden");
  customInput.value = "";
  progressContainer.classList.add("hidden");
  modalFooter.classList.remove("hidden");
  confirmBtn.disabled = false;
  confirmBtn.textContent = "立即更新";

  // 镜像选择事件
  mirrorSelect.onchange = () => {
    if (mirrorSelect.value === "custom") {
      customInput.classList.remove("hidden");
    } else {
      customInput.classList.add("hidden");
    }
  };

  let cancelProgress = null;

  // 清理函数
  const cleanup = () => {
    if (cancelProgress) {
      cancelProgress();
      cancelProgress = null;
    }
    modal.classList.add("hidden");
  };

  // 不再提醒
  ignoreBtn.onclick = () => {
    const config = getConfig();
    config.ignoredVersion = info.latest_ver;
    saveConfig(config);
    console.log("已设置忽略版本:", info.latest_ver);
    cleanup();
  };

  // 确认更新
  confirmBtn.onclick = async () => {
    let mirror = mirrorSelect.value;
    if (mirror === "custom") {
      mirror = customInput.value.trim();
      if (!mirror) {
        showMessageModal("提示", "请输入自定义镜像地址");
        return;
      }
    }

    // 切换到进度条模式
    modalFooter.classList.add("hidden");
    progressContainer.classList.remove("hidden");
    progressFill.style.width = "0%";
    progressText.textContent = "0%";

    // 监听进度
    if (cancelProgress) cancelProgress();
    cancelProgress = EventsOn("update_progress", (percent) => {
      progressFill.style.width = percent + "%";
      progressText.textContent = percent + "%";
    });

    await performUpdate(mirror);

    // 恢复状态 (如果失败)
    modalFooter.classList.remove("hidden");
    progressContainer.classList.add("hidden");

    if (cancelProgress) {
      cancelProgress();
      cancelProgress = null;
    }
  };

  // 关闭弹窗
  cancelBtn.onclick = cleanup;
  closeBtn.onclick = cleanup;

  modal.classList.remove("hidden");
}

// 显示通用消息弹窗
function showMessageModal(title, message, onConfirm) {
  const modal = document.getElementById("message-modal");
  const titleEl = document.getElementById("message-modal-title");
  const contentEl = document.getElementById("message-modal-content");
  const confirmBtn = document.getElementById("message-modal-confirm-btn");
  const closeBtn = document.getElementById("close-message-modal-btn");

  titleEl.textContent = title;
  contentEl.textContent = message;

  const closeModal = () => {
    modal.classList.add("hidden");
    if (onConfirm) onConfirm();
  };

  confirmBtn.onclick = closeModal;
  closeBtn.onclick = () => modal.classList.add("hidden"); // 关闭按钮不触发回调

  modal.classList.remove("hidden");
}

// 执行更新逻辑
async function performUpdate(mirrorUrl) {
  // 显示全局加载提示
  const btn = document.getElementById("refresh-btn");
  if (btn) btn.textContent = "正在更新...";

  // 也可以在关于页面显示状态
  const updateBtn = document.getElementById("check-update-btn");
  if (updateBtn) {
    updateBtn.disabled = true;
    updateBtn.textContent = "正在下载...";
  }

  // 调用后端 DoUpdate，传入镜像地址
  const result = await window.go.main.App.DoUpdate(mirrorUrl || "");

  if (result === "success") {
    // 清除忽略版本设置，以便下次更新提醒
    const config = getConfig();
    config.ignoredVersion = "";
    saveConfig(config);

    showMessageModal("更新成功", "程序将自动重启以应用更新。", async () => {
      try {
        // 尝试调用重启方法
        if (window.go.main.App.RestartApplication) {
          await window.go.main.App.RestartApplication();
        } else {
          // 兼容旧版本或未生成绑定的情况
          window.runtime.Quit();
        }
      } catch (e) {
        console.error("重启失败:", e);
        window.runtime.Quit();
      }
    });
  } else {
    showMessageModal("更新失败", result);
    if (btn) btn.textContent = "刷新";
    if (updateBtn) {
      updateBtn.disabled = false;
      updateBtn.textContent = "检查更新";
    }
  }
}

// 冲突检测相关逻辑
let currentConflictResult = null;
let currentSeverityFilter = "critical"; // 默认只显示严重

function showConflictModal() {
  document.getElementById("conflict-modal").classList.remove("hidden");
  resetConflictModal();
  // 自动开始检测
  startConflictCheck();
}

function hideConflictModal() {
  document.getElementById("conflict-modal").classList.add("hidden");
}

function resetConflictModal() {
  document
    .getElementById("conflict-progress-container")
    .classList.add("hidden");
  document.getElementById("conflict-results").classList.add("hidden");
  document.getElementById("conflict-empty").classList.add("hidden");
  // 隐藏开始按钮，因为自动开始
  document.getElementById("start-conflict-check-btn").style.display = "none";
  document.getElementById("conflict-list").innerHTML = "";
  document.getElementById("conflict-progress-bar").style.width = "0%";
  document.getElementById("conflict-progress-text").textContent = "准备开始...";

  // 重置筛选状态
  currentSeverityFilter = "critical";
  updateFilterButtons();
}

// 更新筛选按钮状态
function updateFilterButtons() {
  document.querySelectorAll(".filter-btn").forEach((btn) => {
    if (btn.dataset.filter === currentSeverityFilter) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
}

// 初始化筛选按钮事件
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      currentSeverityFilter = e.target.dataset.filter;
      updateFilterButtons();
      if (currentConflictResult) {
        renderConflictResults(currentConflictResult);
      }
    });
  });
});

async function startConflictCheck() {
  document
    .getElementById("conflict-progress-container")
    .classList.remove("hidden");
  document.getElementById("conflict-results").classList.add("hidden");
  document.getElementById("conflict-empty").classList.add("hidden");

  try {
    // 使用 window.go.main.App.CheckConflicts 调用后端
    const result = await window.go.main.App.CheckConflicts();
    currentConflictResult = result;
    renderConflictResults(result);
  } catch (err) {
    showError("冲突检测失败: " + err);
    // 出错时显示关闭按钮即可
  }
}

function renderConflictResults(result) {
  document
    .getElementById("conflict-progress-container")
    .classList.add("hidden");

  if (!result || result.total_conflicts === 0) {
    document.getElementById("conflict-empty").classList.remove("hidden");
    return;
  }

  document.getElementById("conflict-results").classList.remove("hidden");
  document.getElementById("conflict-count").textContent =
    result.total_conflicts;

  const list = document.getElementById("conflict-list");
  list.innerHTML = "";

  // 过滤并渲染
  let displayedCount = 0;
  result.conflict_groups.forEach((group) => {
    const severity = group.severity || "info";

    // 筛选逻辑
    if (currentSeverityFilter !== "all" && severity !== currentSeverityFilter) {
      return;
    }

    displayedCount++;
    const groupEl = document.createElement("div");
    // 添加严重程度 class
    groupEl.className = `conflict-group ${severity}`;

    // 生成垂直排列的文件名列表
    const vpkListHtml = group.vpk_files
      .map((name) => `<div>${name}</div>`)
      .join("");

    // 严重程度标签文本
    let severityText = "普通";
    if (severity === "critical") severityText = "严重";
    if (severity === "warning") severityText = "警告";

    groupEl.innerHTML = `
            <div class="conflict-header">
                <div class="conflict-title-section">
                    <span class="severity-badge ${severity}">${severityText}</span>
                    <div class="conflict-vpk-names">
                        ${vpkListHtml}
                    </div>
                </div>
                <div class="conflict-file-count">${
                  group.files.length
                } 个冲突文件</div>
            </div>
            <div class="conflict-details">
                ${(() => {
                  // 构建文件树
                  const buildTree = (paths) => {
                    const root = [];
                    paths.forEach((path) => {
                      const parts = path.replace(/\\/g, "/").split("/");
                      let currentLevel = root;
                      parts.forEach((part, index) => {
                        const isFile = index === parts.length - 1;
                        let node = currentLevel.find((n) => n.name === part);
                        if (!node) {
                          node = {
                            name: part,
                            type: isFile ? "file" : "folder",
                            children: [],
                            path: isFile ? path : null,
                          };
                          currentLevel.push(node);
                        }
                        if (!isFile) currentLevel = node.children;
                      });
                    });
                    return root;
                  };

                  // 递归渲染树
                  const renderTree = (nodes) => {
                    // 排序：文件夹在前，文件在后，按名称排序
                    nodes.sort((a, b) => {
                      if (a.type !== b.type)
                        return a.type === "folder" ? -1 : 1;
                      return a.name.localeCompare(b.name);
                    });

                    return nodes
                      .map((node) => {
                        if (node.type === "folder") {
                          return `
                                    <div class="tree-folder">
                                        <div class="tree-folder-name">
                                            <span class="folder-icon">📁</span> ${
                                              node.name
                                            }
                                        </div>
                                        <div class="tree-children">
                                            ${renderTree(node.children)}
                                        </div>
                                    </div>
                                `;
                        } else {
                          const category = getFileCategory(node.path);
                          return `
                                    <div class="tree-file">
                                        <span class="file-tag ${category.className}">${category.label}</span> ${node.name}
                                    </div>
                                `;
                        }
                      })
                      .join("");
                  };

                  const tree = buildTree(group.files);
                  return `<div class="file-tree">${renderTree(tree)}</div>`;
                })()}
            </div>
        `;

    // 点击展开/收起
    const header = groupEl.querySelector(".conflict-header");
    const details = groupEl.querySelector(".conflict-details");

    header.addEventListener("click", () => {
      details.classList.toggle("expanded");
    });

    list.appendChild(groupEl);
  });

  // 如果筛选后没有结果
  if (displayedCount === 0) {
    list.innerHTML =
      '<div class="empty-state"><p>当前筛选条件下无冲突</p></div>';
  }
}

// 监听进度事件
EventsOn("conflict_check_progress", (progress) => {
  const bar = document.getElementById("conflict-progress-bar");
  const text = document.getElementById("conflict-progress-text");

  if (bar && text) {
    if (progress.total > 0) {
      const percent = (progress.current / progress.total) * 100;
      bar.style.width = percent + "%";
    }
    text.textContent = progress.message;
  }
});

// 获取文件分类和样式
function getFileCategory(filePath) {
  const lower = filePath.toLowerCase().replace(/\\/g, "/");

  // 🔴 严重 (Critical)
  if (lower === "particles/particles_manifest.txt") {
    return { label: "全局特效", className: "tag-critical" };
  }
  if (lower === "scripts/soundmixers.txt") {
    return { label: "全局混音", className: "tag-critical" };
  }
  if (lower.endsWith(".bsp")) {
    return { label: "地图文件", className: "tag-critical" };
  }
  if (lower.endsWith(".nav")) {
    return { label: "导航网格", className: "tag-critical" };
  }
  if (lower.startsWith("missions/") && lower.endsWith(".txt")) {
    return { label: "任务脚本", className: "tag-critical" };
  }
  if (lower.startsWith("scripts/") && lower.endsWith(".txt")) {
    if (lower.startsWith("scripts/vscripts/")) {
      return { label: "VScript", className: "tag-warning" };
    }
    return { label: "核心脚本", className: "tag-critical" };
  }

  // 🟡 告警 (Warning)
  if (lower === "sound/sound.cache") {
    return { label: "音频缓存", className: "tag-warning" };
  }
  if (lower.endsWith(".phy")) {
    return { label: "物理模型", className: "tag-warning" };
  }
  if (lower.startsWith("resource/") && lower.endsWith(".res")) {
    return { label: "界面资源", className: "tag-warning" };
  }
  if (lower.startsWith("scripts/vscripts/")) {
    return { label: "VScript", className: "tag-warning" };
  }
  if (
    lower.endsWith(".vscript") ||
    lower.endsWith(".nut") ||
    lower.endsWith(".nuc")
  ) {
    return { label: "VScript", className: "tag-warning" };
  }
  if (lower.endsWith(".db")) {
    return { label: "数据库", className: "tag-warning" };
  }
  if (lower.endsWith(".vtx") || lower.endsWith(".vvd")) {
    return { label: "模型数据", className: "tag-warning" };
  }
  if (lower.endsWith(".ttf") || lower.endsWith(".otf")) {
    return { label: "字体文件", className: "tag-warning" };
  }

  // 🟢 一般 (Info)
  if (lower.endsWith(".vtf")) {
    return { label: "纹理", className: "tag-info" };
  }
  if (lower.endsWith(".vmt")) {
    return { label: "材质", className: "tag-info" };
  }
  if (lower.endsWith(".mdl")) {
    return { label: "模型", className: "tag-info" };
  }
  if (lower.endsWith(".wav") || lower.endsWith(".mp3")) {
    return { label: "音频", className: "tag-info" };
  }
  if (lower.endsWith(".cfg")) {
    return { label: "配置", className: "tag-info" };
  }

  return { label: "其他", className: "tag-info" };
}

// --- Custom Tags Management ---

let currentEditingTagsFile = null;
let currentSecondaryTags = [];

function openSetTagsModal(filePath) {
  // try to find in appState.vpkFiles (current view) or appState.allVpkFiles (all)
  const file =
    (appState.vpkFiles || []).find((f) => f.path === filePath) ||
    (appState.allVpkFiles || []).find((f) => f.path === filePath);

  if (!file) {
    console.error("File not found for setting tags:", filePath);
    return;
  }

  currentEditingTagsFile = filePath;
  currentSecondaryTags = [...(file.secondaryTags || [])];

  const modal = document.getElementById("set-tags-modal");
  const primarySelect = document.getElementById("primary-tag-select");
  const input = document.getElementById("new-secondary-tag-input");

  if (primarySelect) primarySelect.value = file.primaryTag || "";
  renderEditTagsList();
  if (input) input.value = "";

  if (modal) modal.classList.remove("hidden");
}

function renderEditTagsList() {
  const container = document.getElementById("secondary-tags-list");
  if (!container) return;
  container.innerHTML = "";

  currentSecondaryTags.forEach((tag, index) => {
    const tagEl = document.createElement("span");
    tagEl.className = "tag-badge";
    tagEl.innerHTML = `
            ${tag}
            <span class="tag-remove-btn" title="删除">&times;</span>
        `;
    tagEl.querySelector(".tag-remove-btn").addEventListener("click", () => {
      currentSecondaryTags.splice(index, 1);
      renderEditTagsList();
    });
    container.appendChild(tagEl);
  });
}

// Clear All Tags Button logic
const clearTagsBtn = document.getElementById("clear-tags-btn");
if (clearTagsBtn) {
  clearTagsBtn.addEventListener("click", () => {
    // Clear primary tag
    const primarySelect = document.getElementById("primary-tag-select");
    if (primarySelect) primarySelect.value = "";

    // Clear secondary tags
    currentSecondaryTags = [];
    renderEditTagsList();
  });
}

// Tag Modal Event Listeners
const addTagBtn = document.getElementById("add-secondary-tag-btn");
if (addTagBtn) {
  addTagBtn.addEventListener("click", () => {
    const input = document.getElementById("new-secondary-tag-input");
    const val = input.value.trim();
    if (val && !currentSecondaryTags.includes(val)) {
      currentSecondaryTags.push(val);
      input.value = "";
      renderEditTagsList();
    }
  });
}

const newTagInput = document.getElementById("new-secondary-tag-input");
if (newTagInput) {
  newTagInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const val = e.target.value.trim();
      if (val && !currentSecondaryTags.includes(val)) {
        currentSecondaryTags.push(val);
        e.target.value = "";
        renderEditTagsList();
      }
    }
  });
}

const appSaveTagsBtn = document.getElementById("save-tags-btn");
if (appSaveTagsBtn) {
  appSaveTagsBtn.addEventListener("click", async () => {
    const modal = document.getElementById("set-tags-modal");
    const primarySelect = document.getElementById("primary-tag-select");

    const pTag = primarySelect.value;
    const sTags = currentSecondaryTags;

    try {
      await SetVPKTags(currentEditingTagsFile, pTag, sTags);
      modal.classList.add("hidden");
      if (typeof showNotification === "function") {
        showNotification("标签已更新", "success");
      }
      // Refresh
      const refreshBtn = document.getElementById("refresh-btn");
      if (refreshBtn) refreshBtn.click();
    } catch (err) {
      if (typeof showError === "function") {
        showError("更新标签失败: " + err);
      } else {
        console.error(err);
        alert("更新标签失败: " + err);
      }
    }
  });
}

const closeTagModalBtns = ["close-set-tags-modal-btn", "cancel-set-tags-btn"];
closeTagModalBtns.forEach((id) => {
  const btn = document.getElementById(id);
  if (btn) {
    btn.addEventListener("click", () => {
      document.getElementById("set-tags-modal").classList.add("hidden");
    });
  }
});

/* -------------------------------------------------------------------------- */
/* 创意工坊浏览器 (Workshop Browser) 逻辑                                        */
/* -------------------------------------------------------------------------- */

const browserState = {
  page: 1,
  query: "",
  sort: "trend",
  tags: [],
  loading: false,
  hasMore: true,
  data: [],
};

// 初始化
document.addEventListener("DOMContentLoaded", () => {
  // 入口按钮
  const openBrowserBtn = document.getElementById("open-browser-btn");
  if (openBrowserBtn) {
    openBrowserBtn.addEventListener("click", () => {
      document.getElementById("workshop-modal").classList.add("hidden"); // 暂时隐藏现有弹窗
      openBrowser();
    });
  }

  // 关闭按钮
  const closeBrowserBtn = document.getElementById("close-browser-modal-btn");
  if (closeBrowserBtn) {
    closeBrowserBtn.addEventListener("click", () => {
      document.getElementById("browser-modal").classList.add("hidden");
      // 如果是从下载弹窗来的，恢复下载弹窗？
      // 或者就不恢复，反正用户关掉了。
      document.getElementById("workshop-modal").classList.remove("hidden");
    });
  }

  // 搜索
  const searchInput = document.getElementById("browser-search-input");
  if (searchInput) {
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        browserState.query = e.target.value.trim();
        browserState.page = 1;
        browserState.data = [];
        loadWorkshopList();
      }
    });
  }

  // 排序筛选
  document
    .querySelectorAll("#browser-sort-list .filter-item")
    .forEach((item) => {
      item.addEventListener("click", () => {
        document
          .querySelectorAll("#browser-sort-list .filter-item")
          .forEach((i) => i.classList.remove("active"));
        item.classList.add("active");
        browserState.sort = item.dataset.sort;
        browserState.page = 1;
        browserState.data = [];
        loadWorkshopList();
      });
    });

  // 初始化动态侧边栏
  renderWorkshopSidebar();

  // 加载更多
  const loadMoreBtn = document.getElementById("browser-load-more");

  if (loadMoreBtn) {
    loadMoreBtn.addEventListener("click", () => {
      browserState.page++;
      loadWorkshopList();
    });
  }
});

function openBrowser() {
  const modal = document.getElementById("browser-modal");
  modal.classList.remove("hidden");

  // 如果是第一次打开且没数据，加载
  if (browserState.data.length === 0) {
    loadWorkshopList();
  }
}

async function loadWorkshopList() {
  if (browserState.loading && browserState.page > 1) return; // 第一页允许重刷

  // 隐藏详情页
  const detailView = document.getElementById("browser-detail-view");
  if (detailView) detailView.classList.add("hidden");

  const grid = document.getElementById("browser-grid");
  const loadingEl = document.getElementById("browser-loading");
  const loadMoreBtn = document.getElementById("browser-load-more");

  browserState.loading = true;
  loadingEl.classList.remove("hidden");
  loadMoreBtn.classList.add("hidden");

  if (browserState.page === 1) {
    grid.innerHTML = "";
    browserState.hasMore = true;
  } else {
    // 如果是加载更多，先移除可能存在的错误提示
    const errorEl = grid.querySelector(".error-state");
    if (errorEl) errorEl.remove();

    // 移除"未找到结果"提示
    const emptyEl = grid.querySelector(".empty-state");
    if (emptyEl) emptyEl.remove();
  }

  try {
    // 调用 Go 后端
    const opts = {
      page: browserState.page,
      search_text: browserState.query,
      sort: browserState.sort,
      tags: browserState.tags,
    };

    const result = await FetchWorkshopList(opts);

    // 渲染
    if (result.items && result.items.length > 0) {
      renderWorkshopGrid(result.items);
      browserState.data = browserState.data.concat(result.items);
    } else {
      browserState.hasMore = false;
      if (browserState.page === 1) {
        grid.innerHTML =
          '<div class="empty-state" style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-tertiary);">未找到相关结果</div>';
      }
    }
  } catch (err) {
    console.error("Fetch failed", err);
    grid.innerHTML = `<div class="error-state" style="grid-column: 1/-1; text-align: center; color: var(--danger);">加载失败: ${err}</div>`;
  } finally {
    browserState.loading = false;
    loadingEl.classList.add("hidden");
    if (browserState.hasMore) {
      loadMoreBtn.classList.remove("hidden");
    }
  }
}

function renderWorkshopGrid(items) {
  const grid = document.getElementById("browser-grid");

  items.forEach((item) => {
    const card = document.createElement("div");
    card.className = "workshop-card";
    card.innerHTML = `
            <div class="card-preview skeleton-anim">
                 <div class="skeleton-image-placeholder">
                     <svg class="icon-svg" style="width: 32px; height: 32px; opacity: 0.5;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                         <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                         <circle cx="8.5" cy="8.5" r="1.5"></circle>
                         <polyline points="21 15 16 10 5 21"></polyline>
                     </svg>
                 </div>
                <img src="${
                  item.preview_url || "assets/images/no-preview.png"
                }" loading="lazy" alt="${item.title}"
                style="opacity: 0; transition: opacity 0.3s; position: relative; z-index: 2;"
                onload="this.style.opacity='1'; this.parentElement.classList.remove('skeleton-anim'); this.previousElementSibling.style.display='none';">
            </div>
            <div class="card-info">
                <div class="card-title">${item.title}</div>
                <div class="card-meta">
                    <span class="card-author">${item.creator}</span>
                    <div class="card-stats">
                        <span>👁️ ${formatNumber(item.views)}</span>
                        <span>⭐ ${formatNumber(item.favorited)}</span>
                    </div>
                </div>
            </div>
        `;

    card.addEventListener("click", () => {
      openWorkshopDetail(item);
    });

    grid.appendChild(card);
  });
}

function formatNumber(num) {
  if (!num) return "0";
  if (num > 10000) return (num / 10000).toFixed(1) + "w";
  if (num > 1000) return (num / 1000).toFixed(1) + "k";
  return num;
}

// 切换预览图
window.switchPreview = function (url, element) {
  const mainImg = document.getElementById("main-preview-img");
  if (mainImg) {
    mainImg.src = url;
  }
  document
    .querySelectorAll(".thumbnail-item")
    .forEach((el) => el.classList.remove("active"));
  if (element) {
    element.classList.add("active");
  }
};

// 全屏图片预览
window.openFullImage = function (src) {
  const modal = document.getElementById("image-preview-modal");
  const modalImg = document.getElementById("full-image");
  if (modal && modalImg) {
    modal.style.display = "flex"; // 修改为 flex 以配合 CSS 居中
    modalImg.src = src;
  }
};

// 初始化全屏图片模态框事件
document.addEventListener("DOMContentLoaded", () => {
  const modal = document.getElementById("image-preview-modal");
  const span = document.getElementsByClassName("image-modal-close")[0];

  if (modal && span) {
    span.onclick = function () {
      modal.style.display = "none";
    };

    modal.onclick = function (event) {
      if (event.target === modal) {
        modal.style.display = "none";
      }
    };
  }
});

function renderThumbnails(detail) {
  let images = detail.previews || [];
  // 提取 URL (处理 previews 是对象数组的情况)
  images = images.map((p) => p.preview_url || p);

  // 去重
  images = [...new Set(images)];

  // 如果没有 previews 列表，或者列表为空，且只有单张预览图，则不显示缩略图栏
  if (images.length <= 1) return "";

  return `
    <div class="detail-thumbnails">
        ${images
          .map(
            (img, index) => `
            <div class="thumbnail-item skeleton-anim ${
              index === 0 ? "active" : ""
            }" onclick="window.switchPreview('${img}', this)">
                <img src="${img}" loading="lazy" style="opacity: 0; transition: opacity 0.3s;"
                onload="this.style.opacity='1'; this.parentElement.classList.remove('skeleton-anim')">
            </div>
        `
          )
          .join("")}
    </div>
    `;
}

async function openWorkshopDetail(item) {
  const detailView = document.getElementById("browser-detail-view");
  detailView.classList.remove("hidden");
  detailView.innerHTML =
    '<div class="loading-placeholder" style="margin: auto;">加载详情中...</div>';

  try {
    // 请求详情
    const detail = await FetchWorkshopDetail(item.publishedfileid);

    detailView.innerHTML = `
            <div class="detail-container">
                <div class="detail-header-action">
                    <button class="btn btn-outline" id="back-to-list-btn">← 返回列表</button>
                    <a href="javascript:void(0)" id="open-in-steam-browser" class="btn btn-outline">
                        🔗 在浏览器打开
                    </a>
                </div>

                <div class="detail-scroll-content">
                <div class="detail-top-section">
                    <div class="detail-preview-wrapper">
                        <div class="main-preview-container skeleton-anim">
                             <div class="skeleton-image-placeholder">
                                 <svg class="icon-svg" style="width: 48px; height: 48px; opacity: 0.5;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                     <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                                     <circle cx="8.5" cy="8.5" r="1.5"></circle>
                                     <polyline points="21 15 16 10 5 21"></polyline>
                                 </svg>
                             </div>
                             <img src="${
                               detail.previews && detail.previews.length > 0
                                 ? detail.previews[0].preview_url ||
                                   detail.previews[0]
                                 : detail.preview_url
                             }" class="detail-preview-img-large" id="main-preview-img" 
                             style="opacity: 0; transition: opacity 0.3s; position: relative; z-index: 2;"
                             onclick="window.openFullImage(this.src)"
                             onload="this.style.opacity='1'; this.parentElement.classList.remove('skeleton-anim'); this.previousElementSibling.style.display='none';">
                        </div>
                        ${renderThumbnails(detail)}
                    </div>
                    
                    <div class="detail-info-wrapper">
                         <h1 class="detail-title-large">${detail.title}</h1>
                         
                         <div class="detail-stats-bar">
                             <div class="stat-item">
                                <span class="stat-value">${formatNumber(
                                  detail.subscriptions
                                )}</span>
                                <span class="stat-label">订阅</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-value">${formatNumber(
                                  detail.favorited
                                )}</span>
                                <span class="stat-label">收藏</span>
                            </div>
                             <div class="stat-item">
                                <span class="stat-value">${formatSize(
                                  detail.file_size
                                )}</span>
                                <span class="stat-label">大小</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-value">${new Date(
                                  detail.time_updated * 1000
                                ).toLocaleDateString()}</span>
                                <span class="stat-label">更新</span>
                            </div>
                        </div>

                         <div class="detail-tags-row">
                            ${(detail.tags || [])
                              .map(
                                (t) => `<span class="tag-badge">${t.tag}</span>`
                              )
                              .join("")}
                        </div>

                         <div class="action-bar-large">
                            <button class="btn btn-success btn-large" id="browser-download-btn" style="width: 100%;">
                                <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                    <polyline points="7 10 12 15 17 10"></polyline>
                                    <line x1="12" y1="15" x2="12" y2="3"></line>
                                </svg>
                                <span>下载并安装</span>
                            </button>
                         </div>
                    </div>
                </div>

                <div class="detail-description-box">
                    <h3>MOD 介绍</h3>
                    <div class="detail-description-text">${
                      detail.description
                        ? formatDescription(detail.description)
                        : "暂无描述"
                    }</div>
                </div>
                </div>
            </div>
        `;

    // 绑定事件
    document
      .getElementById("back-to-list-btn")
      .addEventListener("click", () => {
        // 隐藏详情，因为我们现在是单页覆盖
        detailView.classList.add("hidden");
      });

    document
      .getElementById("browser-download-btn")
      .addEventListener("click", () => {
        startDownloadFromBrowser(detail.publishedfileid);
      });

    document
      .getElementById("open-in-steam-browser")
      .addEventListener("click", () => {
        BrowserOpenURL(
          `https://steamcommunity.com/sharedfiles/filedetails/?id=${detail.publishedfileid}`
        );
      });

    // 绑定缩略图滚轮事件
    const thumbContainer = detailView.querySelector(".detail-thumbnails");
    if (thumbContainer) {
      thumbContainer.addEventListener("wheel", (evt) => {
        if (evt.deltaY !== 0) {
          evt.preventDefault();
          thumbContainer.scrollLeft += evt.deltaY;
        }
      });
    }
  } catch (err) {
    detailView.innerHTML = `
            <div class="loading-placeholder">
                <p>加载详情失败: ${err}</p>
                <button class="btn btn-primary" onclick="this.parentElement.parentElement.classList.add('hidden')">返回</button>
            </div>`;
  }
}

// Helper to format bbcode-like description roughly or just preserve whitespace
function formatDescription(text) {
  if (!text) return "";

  // 1. 转义 HTML 特殊字符，防止 XSS
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  // 2. 基础 BBCode 替换
  const tags = [
    { regex: /\[h1\](.*?)\[\/h1\]/gi, replace: "<h3>$1</h3>" },
    { regex: /\[h2\](.*?)\[\/h2\]/gi, replace: "<h4>$1</h4>" },
    { regex: /\[h3\](.*?)\[\/h3\]/gi, replace: "<h5>$1</h5>" },
    { regex: /\[b\](.*?)\[\/b\]/gi, replace: "<strong>$1</strong>" },
    { regex: /\[u\](.*?)\[\/u\]/gi, replace: "<u>$1</u>" },
    { regex: /\[i\](.*?)\[\/i\]/gi, replace: "<em>$1</em>" },
    { regex: /\[strike\](.*?)\[\/strike\]/gi, replace: "<del>$1</del>" },
    {
      regex: /\[spoiler\](.*?)\[\/spoiler\]/gi,
      replace: '<span class="spoiler">$1</span>',
    },
    { regex: /\[hr\]/gi, replace: "<hr>" },
    {
      regex: /\[code\](.*?)\[\/code\]/gis,
      replace: "<pre><code>$1</code></pre>",
    },
    {
      regex: /\[quote\](.*?)\[\/quote\]/gis,
      replace: "<blockquote>$1</blockquote>",
    },
    { regex: /\[noparse\](.*?)\[\/noparse\]/gis, replace: "$1" },
  ];

  tags.forEach((tag) => {
    html = html.replace(tag.regex, tag.replace);
  });

  // 3. 链接替换
  // [url=...]text[/url]
  html = html.replace(
    /\[url=(.*?)\](.*?)\[\/url\]/gi,
    (match, url, content) => {
      return `<a href="javascript:void(0)" onclick="window.BrowserOpenURL('${url}')" class="bbcode-link">${content}</a>`;
    }
  );
  // [url]...[/url]
  html = html.replace(/\[url\](.*?)\[\/url\]/gi, (match, url) => {
    return `<a href="javascript:void(0)" onclick="window.BrowserOpenURL('${url}')" class="bbcode-link">${url}</a>`;
  });

  // 4. 图片替换
  html = html.replace(
    /\[img\](.*?)\[\/img\]/gi,
    '<img src="$1" class="bbcode-img" loading="lazy" />'
  );

  // 5. 列表替换
  // [list]...[/list]
  html = html.replace(/\[list\](.*?)\[\/list\]/gis, (match, content) => {
    const items = content.split("[*]").filter((s) => s.trim().length > 0);
    const listItems = items.map((item) => `<li>${item.trim()}</li>`).join("");
    return `<ul class="bbcode-list">${listItems}</ul>`;
  });
  // [olist]...[/olist]
  html = html.replace(/\[olist\](.*?)\[\/olist\]/gis, (match, content) => {
    const items = content.split("[*]").filter((s) => s.trim().length > 0);
    const listItems = items.map((item) => `<li>${item.trim()}</li>`).join("");
    return `<ol class="bbcode-list">${listItems}</ol>`;
  });

  // 6. 处理换行
  html = html.replace(/\n/g, "<br>");

  return html;
}

function startDownloadFromBrowser(id) {
  // 1. 关闭浏览弹窗
  document.getElementById("browser-modal").classList.add("hidden");

  // 2. 显示下载弹窗
  const workshopModal = document.getElementById("workshop-modal");
  workshopModal.classList.remove("hidden");

  // 3. 填充 URL
  const urlInput = document.getElementById("workshop-url");
  urlInput.value = `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`;

  // 4. 触发解析
  const checkBtn = document.getElementById("check-workshop-btn");
  if (checkBtn) checkBtn.click();
}

function formatSize(bytes) {
  if (!bytes) return "N/A";
  if (bytes < 1024) return bytes + " B";
  else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  else if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + " MB";
  else return (bytes / 1073741824).toFixed(1) + " GB";
}

/* -------------------------------------------------------------------------- */
/* 创意工坊侧边栏数据与渲染                                                    */
/* -------------------------------------------------------------------------- */

const WORKSHOP_CATEGORIES = [
  {
    name: "幸存者 (Survivors)",
    children: [
      { name: "Bill", tag: "Bill" },
      { name: "Francis", tag: "Francis" },
      { name: "Louis", tag: "Louis" },
      { name: "Zoey", tag: "Zoey" },
      { name: "Coach", tag: "Coach" },
      { name: "Ellis", tag: "Ellis" },
      { name: "Nick", tag: "Nick" },
      { name: "Rochelle", tag: "Rochelle" },
    ],
  },
  {
    name: "感染者 (Infected)",
    children: [
      { name: "特感 (Special Infected)", tag: "Special Infected" },
      { name: "Tank", tag: "Tank" },
      { name: "Witch", tag: "Witch" },
      { name: "Hunter", tag: "Hunter" },
      { name: "Smoker", tag: "Smoker" },
      { name: "Boomer", tag: "Boomer" },
      { name: "Charger", tag: "Charger" },
      { name: "Jockey", tag: "Jockey" },
      { name: "Spitter", tag: "Spitter" },
      { name: "普通感染者", tag: "Common Infected" },
    ],
  },
  {
    name: "模式 & 战役",
    children: [
      { name: "战役 (Campaigns)", tag: "Campaigns" },
      { name: "合作 (Co-op)", tag: "Co-op" },
      { name: "生存 (Survival)", tag: "Survival" },
      { name: "对抗 (Versus)", tag: "Versus" },
      { name: "清道夫 (Scavenge)", tag: "Scavenge" },
      { name: "写实 (Realism)", tag: "Realism" },
      { name: "写实对抗", tag: "Realism Versus" },
      { name: "突变 (Mutations)", tag: "Mutations" },
      { name: "单人 (Single Player)", tag: "Single Player" },
    ],
  },
  {
    name: "武器 (Weapons)",
    children: [
      { name: "步枪 (Rifle)", tag: "Rifle" },
      { name: "冲锋枪 (SMG)", tag: "SMG" },
      { name: "散弹枪 (Shotgun)", tag: "Shotgun" },
      { name: "狙击枪 (Sniper)", tag: "Sniper" },
      { name: "手枪 (Pistol)", tag: "Pistol" },
      { name: "近战 (Melee)", tag: "Melee" },
      { name: "榴弹 (Grenade Launcher)", tag: "Grenade Launcher" },
      { name: "M60", tag: "M60" },
      { name: "投掷物 (Throwable)", tag: "Throwable" },
    ],
  },
  {
    name: "物品 (Items)",
    children: [
      { name: "治疗包 (Medkit)", tag: "Medkit" },
      { name: "电击器 (Defibrillator)", tag: "Defibrillator" },
      { name: "肾上腺素 (Adrenaline)", tag: "Adrenaline" },
      { name: "止痛药 (Pills)", tag: "Pills" },
    ],
  },
  {
    name: "其他资源",
    children: [
      { name: "UI", tag: "UI" },
      { name: "音效 (Sounds)", tag: "Sounds" },
      { name: "脚本 (Scripts)", tag: "Scripts" },
      { name: "模型 (Models)", tag: "Models" },
      { name: "纹理 (Textures)", tag: "Textures" },
      { name: "杂项 (Miscellaneous)", tag: "Miscellaneous" },
      { name: "其他 (Other)", tag: "Other" },
    ],
  },
];

function renderWorkshopSidebar() {
  const container = document.getElementById("browser-sidebar-content");
  if (!container) return;

  container.innerHTML = "";

  // 渲染 Categories
  WORKSHOP_CATEGORIES.forEach((cat) => {
    const group = document.createElement("div");
    group.className = "filter-group";

    // 分组标题
    if (cat.name !== "全部") {
      const title = document.createElement("h4");
      title.textContent = cat.name;
      group.appendChild(title);
    }

    const list = document.createElement("ul");
    list.className = "filter-list";

    // 也是一种扁平化处理，如果 cat 本身有 tag，那它就是一个项
    if (cat.tag !== undefined) {
      renderFilterItem(list, cat.name, cat.tag, cat.searchText, true);
    }

    // 如果有 children
    if (cat.children) {
      cat.children.forEach((child) => {
        renderFilterItem(list, child.name, child.tag, child.searchText);
      });
    }

    group.appendChild(list);
    container.appendChild(group);
  });
}

function renderFilterItem(
  parentList,
  name,
  tag,
  searchText,
  isDefault = false
) {
  const li = document.createElement("li");
  li.className = "filter-item";

  // Check active state
  // Update active based on whether the PRIMARY tag matches
  const currentTag = browserState.tags[0] || "";

  // If searchText is used logic needs to be careful, but here we prioritize Tag matching significantly
  if (tag === currentTag) {
    li.classList.add("active");
  }

  // Store data
  li.dataset.tag = tag;
  li.textContent = name;

  li.addEventListener("click", () => {
    // Clear all active
    document
      .querySelectorAll("#browser-sidebar-content .filter-item")
      .forEach((i) => i.classList.remove("active"));
    li.classList.add("active");

    // Update State
    // Simplify: Just send specific tag. Avoid strict AND logic failure.
    let tagsToSend = [];
    if (tag) {
      tagsToSend.push(tag);
    }

    browserState.tags = tagsToSend;

    // Handle Search Text Override
    if (searchText) {
      browserState.query = searchText;
      const input = document.getElementById("browser-search-input");
      if (input) input.value = searchText;
    } else {
      // Clear regular search unless user typed it?
      // If we click a category, usually we want to see ALL of that category.
      // But if user typed "skins" and clicked "Coach", maybe they want "Coach Skins"?
      // Current behavior: Reset query to avoid confusion (like "AK47" query stuck on "Coach" tag)
      browserState.query = "";
      const input = document.getElementById("browser-search-input");
      if (input) input.value = "";
    }

    browserState.page = 1;
    browserState.data = [];

    loadWorkshopList();
  });

  parentList.appendChild(li);
}

document.addEventListener("DOMContentLoaded", () => {
  const browseBtn = document.getElementById("browse-workshop-btn");
  if (browseBtn) {
    browseBtn.addEventListener("click", () => {
      const m = document.getElementById("browser-modal");
      if (m) {
        m.classList.remove("hidden");
        renderWorkshopSidebar();
        // Load if empty
        if (browserState.data.length === 0) {
          loadWorkshopList();
        }
      }
    });
  }

  // Wire up search in browser
  const browserSearch = document.getElementById("browser-search-input");
  const browserSearchBtn = document.getElementById("browser-search-btn");
  const browserResetBtn = document.getElementById("browser-reset-btn");

  const performBrowserSearch = () => {
    if (browserSearch) {
      browserState.query = browserSearch.value.trim();
    }
    browserState.page = 1;
    browserState.data = [];
    loadWorkshopList();
  };

  if (browserSearch) {
    let debounceTimer;

    // 回车搜索
    browserSearch.addEventListener("keyup", (e) => {
      if (e.key === "Enter") {
        clearTimeout(debounceTimer);
        performBrowserSearch();
      }
    });

    // 输入延迟搜索
    browserSearch.addEventListener("input", (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        performBrowserSearch();
      }, 800);
    });
  }

  // 查询按钮
  if (browserSearchBtn) {
    browserSearchBtn.addEventListener("click", () => {
      performBrowserSearch();
    });
  }

  // 重置按钮
  if (browserResetBtn) {
    browserResetBtn.addEventListener("click", () => {
      // 清空搜索框
      if (browserSearch) browserSearch.value = "";

      // 清空状态
      browserState.query = "";
      browserState.tags = [];
      browserState.page = 1;
      browserState.data = [];

      // 清空侧边栏选中
      document
        .querySelectorAll("#browser-sidebar-content .filter-item")
        .forEach((i) => i.classList.remove("active"));

      loadWorkshopList();
    });
  }

  // Close button for browser modal
  const closeBrowserBtn = document.getElementById("close-browser-modal-btn");
  if (closeBrowserBtn) {
    closeBrowserBtn.addEventListener("click", () => {
      document.getElementById("browser-modal").classList.add("hidden");
    });
  }
});
