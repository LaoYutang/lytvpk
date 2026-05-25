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
import { openLoadOrderModal } from "../modals/load-order.js";
import { openWorkshopModal, checkWorkshopUrl } from "../downloads/workshop-modal.js";
import { showContextMenu, hideContextMenu, showServerSubmenu, hideServerSubmenu } from "./context-menu.js";
import { shareWorkshopFileByPath } from "./share.js";
import { getServers } from "../servers/servers.js";

export function setupFileListEventDelegation() {
  console.log("正在设置文件列表按钮事件委托...");

  document.addEventListener("click", function (e) {
    const moreBtn = e.target.closest(".more-btn");
    if (moreBtn) {
      e.preventDefault();
      e.stopPropagation();
      const dropdown = moreBtn.nextElementSibling;
      const fileContainer = moreBtn.closest(".file-item") || moreBtn.closest(".file-card");

      document.querySelectorAll(".dropdown-content").forEach((d) => {
        if (d !== dropdown) {
          d.classList.add("hidden");
          const otherContainer = d.closest(".file-item") || d.closest(".file-card");
          if (otherContainer) otherContainer.classList.remove("active-dropdown");
        }
      });

      dropdown.classList.remove("dropup");

      const uploadBtn = dropdown.querySelector(".upload-server-btn");
      if (uploadBtn) {
        const hasServers = getServers().some((s) => s.panelUrl && s.panelPasswordSet);
        uploadBtn.style.display = hasServers ? "" : "none";
      }

      dropdown.classList.toggle("hidden");

      if (fileContainer) {
        if (dropdown.classList.contains("hidden")) {
          fileContainer.classList.remove("active-dropdown");
        } else {
          fileContainer.classList.add("active-dropdown");
          const rect = dropdown.getBoundingClientRect();
          const windowHeight = window.innerHeight || document.documentElement.clientHeight;
          const statusBar = document.querySelector(".status-bar");
          const bottomMargin = statusBar ? statusBar.offsetHeight + 10 : 20;
          if (rect.bottom > windowHeight - bottomMargin) {
            dropdown.classList.add("dropup");
          }
        }
      }
      return;
    }

    if (
      !e.target.closest(".more-actions-dropdown") &&
      !e.target.closest(".batch-actions-dropdown-container")
    ) {
      document.querySelectorAll(".dropdown-content").forEach((d) => {
        d.classList.add("hidden");
        const container = d.closest(".file-item") || d.closest(".file-card");
        if (container) container.classList.remove("active-dropdown");
      });
      hideServerSubmenu();
    }

    // 待更新标签/按钮点击 - 打开下载界面并自动解析
    const updateTag = e.target.closest(".update-available-tag") || e.target.closest(".update-btn");
    if (updateTag) {
      const workshopId = updateTag.getAttribute("data-workshop-id");
      if (workshopId) {
        e.preventDefault();
        e.stopPropagation();
        const workshopUrl = `https://steamcommunity.com/sharedfiles/filedetails/?id=${workshopId}`;
        openWorkshopModal();
        // 等待模态框打开后填入URL并自动解析
        setTimeout(() => {
          const urlInput = document.getElementById("workshop-url");
          if (urlInput) {
            urlInput.value = workshopUrl;
            checkWorkshopUrl();
          }
        }, 300);
      }
    }

    const detailBtn = e.target.closest(".detail-btn");
    if (detailBtn) {
      const filePath = detailBtn.getAttribute("data-file-path");
      if (filePath) {
        e.preventDefault();
        e.stopPropagation();
        showFileDetail(filePath);
      }
    }

    const workshopBtn = e.target.closest(".workshop-btn");
    if (workshopBtn) {
      const workshopId = workshopBtn.getAttribute("data-workshop-id");
      if (workshopId) {
        e.preventDefault();
        e.stopPropagation();
        document.querySelectorAll(".dropdown-content").forEach((d) => {
          d.classList.add("hidden");
          const container = d.closest(".file-item") || d.closest(".file-card");
          if (container) container.classList.remove("active-dropdown");
        });
        handleProtocolWorkshop(workshopId);
      }
    }

    const shareWorkshopBtn = e.target.closest('.share-workshop-btn[data-action="share-workshop"]');
    if (shareWorkshopBtn) {
      const filePath = shareWorkshopBtn.getAttribute("data-file-path");
      if (filePath) {
        e.preventDefault();
        e.stopPropagation();
        document.querySelectorAll(".dropdown-content").forEach((d) => {
          d.classList.add("hidden");
          const container = d.closest(".file-item") || d.closest(".file-card");
          if (container) container.classList.remove("active-dropdown");
        });
        shareWorkshopFileByPath(filePath);
      }
    }

    const openLocationBtn = e.target.closest('.open-location-btn[data-action="open-location"]');
    if (openLocationBtn) {
      const filePath = openLocationBtn.getAttribute("data-file-path");
      if (filePath) {
        e.preventDefault();
        e.stopPropagation();
        document.querySelectorAll(".dropdown-content").forEach((d) => {
          d.classList.add("hidden");
          const fileItem = d.closest(".file-item");
          if (fileItem) fileItem.classList.remove("active-dropdown");
        });
        openFileLocation(filePath);
      }
    }

    const hideBtn = e.target.closest('.hide-btn[data-action="hide"]');
    if (hideBtn) {
      const filePath = hideBtn.getAttribute("data-file-path");
      if (filePath) {
        e.preventDefault();
        e.stopPropagation();
        document.querySelectorAll(".dropdown-content").forEach((d) => {
          d.classList.add("hidden");
          const fileItem = d.closest(".file-item");
          if (fileItem) fileItem.classList.remove("active-dropdown");
        });
        toggleFileVisibility(filePath);
      }
    }

    const toggleBtn = e.target.closest('.toggle-btn[data-action="toggle"]');
    if (toggleBtn) {
      const filePath = toggleBtn.getAttribute("data-file-path");
      if (filePath) {
        e.preventDefault();
        e.stopPropagation();
        toggleFile(filePath);
      }
    }

    const moveBtn = e.target.closest('.move-btn[data-action="move"]');
    if (moveBtn) {
      const filePath = moveBtn.getAttribute("data-file-path");
      if (filePath) {
        e.preventDefault();
        e.stopPropagation();
        moveFileToAddons(filePath);
      }
    }

    const setTagsBtn = e.target.closest('.set-tags-btn[data-action="set-tags"]');
    if (setTagsBtn) {
      const filePath = setTagsBtn.getAttribute("data-file-path");
      if (filePath) {
        e.preventDefault();
        e.stopPropagation();
        document.querySelectorAll(".dropdown-content").forEach((d) => {
          d.classList.add("hidden");
          const fileItem = d.closest(".file-item");
          if (fileItem) fileItem.classList.remove("active-dropdown");
        });
        openSetTagsModal(filePath);
      }
    }

    const renameBtn = e.target.closest('.rename-btn[data-action="rename"]');
    if (renameBtn) {
      const filePath = renameBtn.getAttribute("data-file-path");
      if (filePath) {
        e.preventDefault();
        e.stopPropagation();
        document.querySelectorAll(".dropdown-content").forEach((d) => {
          d.classList.add("hidden");
          const fileItem = d.closest(".file-item");
          if (fileItem) fileItem.classList.remove("active-dropdown");
        });
        renameFile(filePath);
      }
    }

    const deleteBtn = e.target.closest('.delete-btn[data-action="delete"]');
    if (deleteBtn) {
      const filePath = deleteBtn.getAttribute("data-file-path");
      if (filePath) {
        e.preventDefault();
        e.stopPropagation();
        document.querySelectorAll(".dropdown-content").forEach((d) => {
          d.classList.add("hidden");
          const fileItem = d.closest(".file-item");
          if (fileItem) fileItem.classList.remove("active-dropdown");
        });
        deleteFile(filePath);
      }
    }

    const loadOrderBtn = e.target.closest('.load-order-btn[data-action="load-order"]');
    if (loadOrderBtn) {
      const filePath = loadOrderBtn.getAttribute("data-file-path");
      if (filePath) {
        e.preventDefault();
        e.stopPropagation();
        document.querySelectorAll(".dropdown-content").forEach((d) => {
          d.classList.add("hidden");
          const fileItem = d.closest(".file-item");
          if (fileItem) fileItem.classList.remove("active-dropdown");
        });
        openLoadOrderModal(filePath);
      }
    }

    const uploadServerBtn = e.target.closest('.upload-server-btn[data-action="upload-server"]');
    if (uploadServerBtn) {
      const filePath = uploadServerBtn.getAttribute("data-file-path");
      if (filePath) {
        e.preventDefault();
        e.stopPropagation();
        showServerSubmenu(uploadServerBtn, [filePath]);
      }
    }
  });

  document.addEventListener("contextmenu", function (e) {
    const fileItem = e.target.closest(".file-item") || e.target.closest(".file-card");
    if (!fileItem) return;

    if (
      e.target.closest(".file-checkbox-container") ||
      e.target.closest(".card-checkbox-container") ||
      e.target.closest("button") ||
      e.target.closest(".more-actions-dropdown") ||
      e.target.closest(".dropdown-content") ||
      e.target.type === "checkbox"
    ) {
      return;
    }

    const filePath = fileItem.dataset.path;
    if (!filePath) return;

    e.preventDefault();
    e.stopPropagation();

    document.querySelectorAll(".dropdown-content").forEach((d) => {
      d.classList.add("hidden");
      const container = d.closest(".file-item") || d.closest(".file-card");
      if (container) container.classList.remove("active-dropdown");
    });

    hideContextMenu();
    showContextMenu(e, filePath);
  });

  console.log("文件列表按钮事件委托设置完成");
}
