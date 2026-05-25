import { appState } from "../state.js";
import { iconSvg } from "./render.js";
import { showFileDetail } from "../modals/detail.js";
import { handleProtocolWorkshop } from "../workshop/workshop-browser.js";
import {
  openFileLocation,
  toggleFileVisibility,
  toggleFile,
  moveFileToAddons,
  deleteFile,
  renameFile,
} from "./operations.js";
import { openSetTagsModal } from "./tags.js";
import { openBatchSetTagsModal } from "./batch-tags.js";
import { openLoadOrderModal } from "../modals/load-order.js";
import {
  enableSelected,
  disableSelected,
  exportZipSelected,
  deleteSelected,
  moveSelected,
  batchToggleVisibility,
} from "./actions.js";
import {
  shareSelectedWorkshopItems,
  shareWorkshopItem,
} from "./share.js";
import { getServers } from "../servers/servers.js";
import { StartPanelMapUpload } from "../../../../wailsjs/go/app/App";
import { showNotification } from "../../core/toast.js";

let currentContextMenu = null;
let currentServerSubmenu = null;

const loadOrderIconSvg = `<svg class="icon-svg" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="10" y1="6" x2="21" y2="6"></line><line x1="10" y1="12" x2="21" y2="12"></line><line x1="10" y1="18" x2="21" y2="18"></line><path d="M4 6h1v4"></path><path d="M4 10h2"></path><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"></path></svg>`;

function createMenuItem(text, iconHtml, onClick, options = {}) {
  const item = document.createElement("button");
  item.className = "context-menu-item";
  if (options.danger) {
    item.classList.add("context-menu-item-danger");
  }
  item.innerHTML = `<span class="btn-icon">${iconHtml}</span> ${text}`;
  item.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    hideContextMenu();
    onClick();
  });
  return item;
}

function createDivider() {
  const divider = document.createElement("div");
  divider.className = "context-menu-divider";
  return divider;
}

function getPanelServers() {
  return getServers().filter((s) => s.panelUrl && s.panelPasswordSet);
}

async function handleUploadToServer(serverId, filePaths) {
  try {
    await StartPanelMapUpload(serverId, filePaths);
    showNotification(`已添加 ${filePaths.length} 个文件到上传任务`, "success");
  } catch (err) {
    console.error("上传服务器失败:", err);
    showNotification("上传失败: " + err, "error");
  }
}

export function showServerSubmenu(triggerElement, filePaths) {
  hideServerSubmenu();

  const servers = getPanelServers();
  const submenu = document.createElement("div");
  submenu.className = "server-submenu";

  if (servers.length === 0) {
    const empty = document.createElement("div");
    empty.className = "server-submenu-empty";
    empty.textContent = "没有配置面板的服务器";
    submenu.appendChild(empty);
  } else {
    servers.forEach((server) => {
      const item = document.createElement("button");
      item.className = "server-submenu-item";
      item.innerHTML = `<span class="server-submenu-name">${server.name || "未命名服务器"}</span>`;
      item.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        hideServerSubmenu();
        hideContextMenu();
        document.querySelectorAll(".dropdown-content").forEach((d) => {
          d.classList.add("hidden");
          const container = d.closest(".file-item") || d.closest(".file-card");
          if (container) container.classList.remove("active-dropdown");
        });
        handleUploadToServer(server.id, filePaths);
      });
      submenu.appendChild(item);
    });
  }

  document.body.appendChild(submenu);
  currentServerSubmenu = submenu;

  const triggerRect = triggerElement.getBoundingClientRect();
  const submenuWidth = submenu.offsetWidth || 180;
  const submenuHeight = submenu.offsetHeight || 200;
  const windowWidth = window.innerWidth;
  const windowHeight = window.innerHeight;

  let left = triggerRect.right + 8;
  let top = triggerRect.top;

  if (left + submenuWidth > windowWidth - 8) {
    left = triggerRect.left - submenuWidth - 8;
  }
  if (left < 8) {
    left = 8;
  }

  if (top + submenuHeight > windowHeight - 8) {
    top = windowHeight - submenuHeight - 8;
  }
  if (top < 8) {
    top = 8;
  }

  submenu.style.left = `${left}px`;
  submenu.style.top = `${top}px`;

  const closeOnClickOutside = (e) => {
    if (!submenu.contains(e.target) && !triggerElement.contains(e.target)) {
      hideServerSubmenu();
    }
  };

  submenu._cleanup = () => {
    document.removeEventListener("click", closeOnClickOutside);
  };

  setTimeout(() => {
    document.addEventListener("click", closeOnClickOutside);
  }, 0);
}

export function hideServerSubmenu() {
  if (currentServerSubmenu) {
    if (currentServerSubmenu._cleanup) {
      currentServerSubmenu._cleanup();
    }
    currentServerSubmenu.remove();
    currentServerSubmenu = null;
  }
}

function buildSingleMenu(menu, file) {
  menu.appendChild(createMenuItem("详情", iconSvg("info"), () => showFileDetail(file.path)));

  if (file.location === "workshop") {
    menu.appendChild(createMenuItem("转移", iconSvg("package"), () => moveFileToAddons(file.path)));
  } else {
    const isEnabled = file.enabled;
    menu.appendChild(
      createMenuItem(
        isEnabled ? "禁用" : "启用",
        isEnabled ? iconSvg("x") : iconSvg("check"),
        () => toggleFile(file.path)
      )
    );
  }

  if (file.workshopId) {
    menu.appendChild(
      createMenuItem("跳转工坊", iconSvg("external"), () => handleProtocolWorkshop(file.workshopId))
    );
  }

  menu.appendChild(createMenuItem("分享物品", iconSvg("share"), () => shareWorkshopItem(file)));
  menu.appendChild(createMenuItem("设置标签", iconSvg("tag"), () => openSetTagsModal(file.path)));

  const panelServers = getPanelServers();
  if (panelServers.length > 0) {
    const uploadItem = document.createElement("button");
    uploadItem.className = "context-menu-item";
    uploadItem.innerHTML = `<span class="btn-icon">${iconSvg("upload")}</span> <span class="menu-item-text">上传服务器</span> <span class="menu-item-arrow">${iconSvg("chevronRight")}</span>`;
    uploadItem.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showServerSubmenu(uploadItem, [file.path]);
    });
    menu.appendChild(uploadItem);
  }

  menu.appendChild(createMenuItem("重命名", iconSvg("edit"), () => renameFile(file.path)));
  menu.appendChild(createMenuItem("加载顺序", loadOrderIconSvg, () => openLoadOrderModal(file.path)));
  menu.appendChild(createMenuItem("打开位置", iconSvg("folderOpen"), () => openFileLocation(file.path)));

  const isHidden = file.name.startsWith("_");
  menu.appendChild(
    createMenuItem(
      isHidden ? "取消隐藏" : "隐藏",
      isHidden ? iconSvg("eye") : iconSvg("eyeOff"),
      () => toggleFileVisibility(file.path)
    )
  );

  menu.appendChild(createDivider());
  menu.appendChild(createMenuItem("删除", iconSvg("trash"), () => deleteFile(file.path), { danger: true }));
}

function buildBatchMenu(menu) {
  menu.appendChild(createMenuItem("启用选中", iconSvg("check"), () => enableSelected()));
  menu.appendChild(createMenuItem("禁用选中", iconSvg("x"), () => disableSelected()));

  menu.appendChild(createDivider());

  const selectedPaths = Array.from(appState.selectedFiles);
  const selectedFiles = selectedPaths
    .map((fp) => appState.vpkFiles.find((f) => f.path === fp))
    .filter(Boolean);

  const hasVisible = selectedFiles.some((f) => !f.name.startsWith("_"));
  const hasHidden = selectedFiles.some((f) => f.name.startsWith("_"));

  if (hasVisible) {
    menu.appendChild(createMenuItem("批量隐藏", iconSvg("eyeOff"), () => batchToggleVisibility(false)));
  }
  if (hasHidden) {
    menu.appendChild(createMenuItem("批量取消隐藏", iconSvg("eye"), () => batchToggleVisibility(true)));
  }

  menu.appendChild(createDivider());
  menu.appendChild(createMenuItem("分享物品", iconSvg("share"), () => shareSelectedWorkshopItems()));
  menu.appendChild(createMenuItem("设置标签", iconSvg("tag"), () => openBatchSetTagsModal()));

  const panelServers = getPanelServers();
  if (panelServers.length > 0) {
    const uploadItem = document.createElement("button");
    uploadItem.className = "context-menu-item";
    uploadItem.innerHTML = `<span class="btn-icon">${iconSvg("upload")}</span> <span class="menu-item-text">上传服务器</span> <span class="menu-item-arrow">${iconSvg("chevronRight")}</span>`;
    uploadItem.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const selectedPaths = Array.from(appState.selectedFiles);
      showServerSubmenu(uploadItem, selectedPaths);
    });
    menu.appendChild(uploadItem);
  }

  menu.appendChild(createMenuItem("导出ZIP", iconSvg("package"), () => exportZipSelected()));
  menu.appendChild(createMenuItem("移动文件", iconSvg("folderOpen"), () => moveSelected()));
  menu.appendChild(createMenuItem("批量删除", iconSvg("trash"), () => deleteSelected(), { danger: true }));
}

export function showContextMenu(event, filePath) {
  event.preventDefault();
  event.stopPropagation();

  hideContextMenu();

  const file = appState.vpkFiles.find((f) => f.path === filePath);
  if (!file) return;

  const menu = document.createElement("div");
  menu.className = "context-menu";

  const hasSelection = appState.selectedFiles.size > 0;

  if (!hasSelection) {
    buildSingleMenu(menu, file);
  } else {
    buildBatchMenu(menu);
  }

  document.body.appendChild(menu);
  currentContextMenu = menu;

  const menuWidth = menu.offsetWidth || 180;
  const menuHeight = menu.offsetHeight || 300;
  const windowWidth = window.innerWidth;
  const windowHeight = window.innerHeight;

  let left = event.clientX;
  let top = event.clientY;

  if (left + menuWidth > windowWidth) {
    left = windowWidth - menuWidth - 8;
  }
  if (top + menuHeight > windowHeight) {
    top = windowHeight - menuHeight - 8;
  }

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  const closeOnClickOutside = (e) => {
    if (!menu.contains(e.target)) {
      hideContextMenu();
    }
  };

  const closeOnEsc = (e) => {
    if (e.key === "Escape") {
      hideContextMenu();
    }
  };

  const closeOnScrollOrResize = () => {
    hideContextMenu();
  };

  menu._cleanup = () => {
    document.removeEventListener("click", closeOnClickOutside);
    document.removeEventListener("keydown", closeOnEsc);
    window.removeEventListener("scroll", closeOnScrollOrResize);
    window.removeEventListener("resize", closeOnScrollOrResize);
  };

  setTimeout(() => {
    document.addEventListener("click", closeOnClickOutside);
  }, 0);

  document.addEventListener("keydown", closeOnEsc);
  window.addEventListener("scroll", closeOnScrollOrResize);
  window.addEventListener("resize", closeOnScrollOrResize);
}

export function hideContextMenu() {
  hideServerSubmenu();
  if (currentContextMenu) {
    if (currentContextMenu._cleanup) {
      currentContextMenu._cleanup();
    }
    currentContextMenu.remove();
    currentContextMenu = null;
  }
}
