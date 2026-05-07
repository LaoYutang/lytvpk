import { showError, showNotification } from "../../core/toast.js";
import { showConfirmModal } from "../modals/confirm.js";
import { refreshFilesKeepFilter } from "../file-list/filters.js";
import {
  GetDownloadTasks,
  CancelDownloadTask,
  RetryDownloadTask,
  ClearCompletedTasks,
} from "../../../../wailsjs/go/app/App";

export async function refreshTaskList() {
  const listContainer = document.getElementById("download-tasks-list");
  if (!listContainer) return;

  try {
    const tasks = await GetDownloadTasks();

    if (!tasks || tasks.length === 0) {
      listContainer.innerHTML = '<div class="empty-tasks" style="text-align: center; color: #888; padding: 20px;">暂无下载任务</div>';
      return;
    }

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

export function createTaskElement(task) {
  const div = document.createElement("div");
  div.className = "task-item";
  div.id = `task-${task.id}`;
  div.style.cssText = "padding: 10px; border-bottom: 1px solid #eee; display: flex; gap: 10px; align-items: center;";

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

  const copyBtn = `
    <button class="task-action-btn copy-link-btn" data-url="${task.file_url}" title="复制下载链接">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
    </button>`;

  let actionButtons = "";
  if (task.status === "downloading" || task.status === "pending" || task.status === "selecting_ip") {
    actionButtons = `
      ${copyBtn}
      <button class="task-action-btn cancel-btn cancel-task-btn" data-id="${task.id}" title="取消下载">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>`;
  } else if (task.status === "failed" || task.status === "cancelled") {
    actionButtons = `
      ${copyBtn}
      <button class="task-action-btn retry-btn retry-task-btn" data-id="${task.id}" title="重试下载">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M23 4v6h-6"></path>
          <path d="M1 20v-6h6"></path>
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
        </svg>
      </button>`;
  } else if (task.status === "completed") {
    actionButtons = copyBtn;
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
        <span class="task-title" style="font-weight: bold; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 250px;">${task.title}</span>
        <div style="display: flex; align-items: center; gap: 5px;">
          <span class="task-status" style="font-size: 12px; color: ${statusColors[task.status] || "#666"};">${statusText[task.status] || task.status}</span>
          ${actionButtons}
        </div>
      </div>
      <div style="font-size: 12px; color: #666; margin-bottom: 5px;">${task.filename}</div>
      <div class="progress-bar" style="width: 100%; height: 6px; background-color: #eee; border-radius: 3px; overflow: hidden;">
        <div class="progress-fill" style="width: ${task.progress}%; height: 100%; background-color: ${statusColors[task.status] || "#ccc"}; transition: width 0.3s;"></div>
      </div>
      <div style="display: flex; justify-content: space-between; font-size: 11px; color: #888; margin-top: 2px;">
        <span class="task-size">${formatBytes(task.downloaded_size)} / ${formatBytes(task.total_size)} ${task.speed ? `(${task.speed})` : ""}</span>
        <span class="task-percent">${task.progress}%</span>
      </div>
      ${task.error ? `<div style="color: #f44336; font-size: 11px; margin-top: 2px;">${task.error}</div>` : ""}
    </div>
  `;

  const copyLinkBtn = div.querySelector(".copy-link-btn");
  if (copyLinkBtn) {
    copyLinkBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const url = copyLinkBtn.dataset.url;
      if (url) {
        navigator.clipboard.writeText(url)
          .then(() => showNotification("下载链接已复制", "success"))
          .catch((err) => {
            console.error("复制失败:", err);
            const el = document.createElement("textarea");
            el.value = url;
            document.body.appendChild(el);
            el.select();
            document.execCommand("copy");
            document.body.removeChild(el);
            showNotification("下载链接已复制", "success");
          });
      } else {
        showError("无效的下载链接");
      }
    });
  }

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

export function updateTaskInList(task) {
  const existing = document.getElementById(`task-${task.id}`);
  if (existing) {
    const newItem = createTaskElement(task);
    existing.replaceWith(newItem);
  } else {
    refreshTaskList();
  }

  if (task.status === "completed") {
    refreshFilesKeepFilter();
  }
}

export function updateTaskProgress(task) {
  const el = document.getElementById(`task-${task.id}`);
  if (el) {
    const fill = el.querySelector(".progress-fill");
    const percentText = el.querySelector(".task-percent");
    const sizeText = el.querySelector(".task-size");

    if (fill) fill.style.width = `${task.progress}%`;
    if (percentText) percentText.textContent = `${task.progress}%`;
    if (sizeText) {
      sizeText.textContent = `${formatBytes(task.downloaded_size)} / ${formatBytes(task.total_size)} ${task.speed ? `(${task.speed})` : ""}`;
    }
  }
}

export function setupClearCompletedTasks() {
  const btn = document.getElementById("clear-completed-tasks-btn");
  if (btn) {
    btn.addEventListener("click", async () => {
      await ClearCompletedTasks();
    });
  }
}

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}
