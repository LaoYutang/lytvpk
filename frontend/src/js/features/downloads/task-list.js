import { showError, showNotification } from "../../core/toast.js";
import { showConfirmModal } from "../modals/confirm.js";
import { appState } from "../state.js";
import { refreshFilesKeepFilter } from "../file-list/filters.js";
import { renameFile } from "../file-list/operations.js";
import { openSetTagsModal } from "../file-list/tags.js";
import {
  GetDownloadTasks,
  CancelDownloadTask,
  RetryDownloadTask,
  ClearCompletedTasks,
} from "../../../../wailsjs/go/app/App";

// Wails generates these bindings during the build. Calling the runtime bridge
// directly keeps generated files out of the source change.
const pauseDownloadTask = (taskID) => window.go.app.App.PauseDownloadTask(taskID);
const confirmPauseDownloadTask = (taskID) => window.go.app.App.ConfirmPauseDownloadTask(taskID);
const resumeDownloadTask = (taskID) => window.go.app.App.ResumeDownloadTask(taskID);
const pauseConfirmationRequired = "DOWNLOAD_PAUSE_CONFIRMATION_REQUIRED";
const pendingTaskActions = new Set();

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
        pausing: 2,
        cancelling: 3,
        failing: 4,
        pending: 5,
        paused: 6,
        finalizing: 7,
        failed: 8,
        completed: 9,
      };
      if (statusOrder[a.status] !== statusOrder[b.status]) {
        return (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99);
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
  div.dataset.status = task.status;
  div.style.cssText = "padding: 10px; border-bottom: 1px solid #eee; display: flex; gap: 10px; align-items: center;";

  const statusColors = {
    pending: "#ff9800",
    selecting_ip: "#9c27b0",
    downloading: "#2196f3",
    pausing: "#ff9800",
    cancelling: "#ff9800",
    failing: "#ff9800",
    paused: "#ff9800",
    finalizing: "#2196f3",
    completed: "#4caf50",
    failed: "#f44336",
  };

  const statusText = {
    pending: "等待中",
    selecting_ip: "优选线路中...",
    downloading: "下载中",
    pausing: "正在暂停...",
    cancelling: "正在取消...",
    failing: "正在结束...",
    paused: "已暂停",
    finalizing: "正在完成...",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
  };

  const copyBtn = `
    <button class="task-action-btn copy-link-btn" data-url="${escapeHtml(task.file_url)}" title="复制下载链接">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
    </button>`;

  let actionButtons = "";
  if (["downloading", "pending", "selecting_ip", "pausing", "paused"].includes(task.status)) {
    actionButtons = `
      ${copyBtn}
      <button class="task-action-btn cancel-btn cancel-task-btn" data-id="${escapeHtml(task.id)}" title="取消下载">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>`;
  } else if (task.status === "failed" || task.status === "cancelled") {
    actionButtons = `
      ${copyBtn}
      <button class="task-action-btn retry-btn retry-task-btn" data-id="${escapeHtml(task.id)}" title="重试下载">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M23 4v6h-6"></path>
          <path d="M1 20v-6h6"></path>
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
        </svg>
      </button>`;
  } else if (task.status === "completed" || task.status === "finalizing") {
    actionButtons = copyBtn;
  }

  let previewHtml = "";
  const previewUrl = safePreviewUrl(task.preview_url);
  if (previewUrl) {
    previewHtml = `<img src="${escapeHtml(previewUrl)}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 4px;">`;
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
    <div class="task-content" style="flex: 1; min-width: 0;">
      <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
        <span class="task-title" style="font-weight: bold; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 250px;">${escapeHtml(task.title)}</span>
        <div style="display: flex; align-items: center; gap: 5px;">
          <span class="task-status" style="font-size: 12px; color: ${statusColors[task.status] || "#666"};">${escapeHtml(statusText[task.status] || task.status)}</span>
          ${actionButtons}
        </div>
      </div>
      <div style="font-size: 12px; color: #666; margin-bottom: 5px;">${escapeHtml(task.filename)}</div>
      <div class="progress-bar" style="width: 100%; height: 6px; background-color: #eee; border-radius: 3px; overflow: hidden;">
        <div class="progress-fill" style="width: ${safeProgress(task.progress)}%; height: 100%; background-color: ${statusColors[task.status] || "#ccc"}; transition: width 0.3s;"></div>
      </div>
      <div style="display: flex; justify-content: space-between; font-size: 11px; color: #888; margin-top: 2px;">
        <span class="task-size">${formatBytes(task.downloaded_size)} / ${formatBytes(task.total_size)} ${task.speed ? `(${escapeHtml(task.speed)})` : ""}</span>
        <span class="task-percent">${safeProgress(task.progress)}%</span>
      </div>
      ${task.notice ? `<div class="task-notice" style="color: var(--text-secondary); font-size: 11px; margin-top: 2px;">${escapeHtml(task.notice)}</div>` : ""}
      ${task.error ? `<div style="color: #f44336; font-size: 11px; margin-top: 2px;">${escapeHtml(task.error)}</div>` : ""}
    </div>
  `;

  const actionGroup = div.querySelector(".task-status")?.parentElement;
  const cancelButton = div.querySelector(".cancel-task-btn");
  if (actionGroup && cancelButton) {
    if (["downloading", "pending", "selecting_ip", "pausing"].includes(task.status)) {
      actionGroup.insertBefore(createTransferControl(task, "pause"), cancelButton);
    } else if (task.status === "paused") {
      actionGroup.insertBefore(createTransferControl(task, "resume"), cancelButton);
    }
  }

  if (pendingTaskActions.has(task.id)) {
    div.querySelectorAll(".task-action-btn:not(.copy-link-btn)").forEach((button) => {
      button.disabled = true;
    });
  }

  const completedActions = createCompletedTaskActions(task);
  if (completedActions) {
    div.querySelector(".task-content")?.appendChild(completedActions);
  }

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
          showNotification("已请求取消下载", "info");
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

function createTransferControl(task, action) {
  const paused = action === "pause";
  const button = document.createElement("button");
  button.type = "button";
  button.className = `task-action-btn ${action}-task-btn`;
  button.title = task.status === "pausing" ? "正在暂停" : (paused ? "暂停下载" : "继续下载");
  button.setAttribute("aria-label", button.title);
  button.textContent = paused ? "Ⅱ" : "▶";
  button.disabled = task.status === "pausing";
  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (pendingTaskActions.has(task.id)) return;

    pendingTaskActions.add(task.id);
    button.disabled = true;
    let confirmationOpen = false;
    try {
      if (paused) {
        try {
          await pauseDownloadTask(task.id);
        } catch (err) {
          const reason = String(err);
          if (!reason.includes(pauseConfirmationRequired)) throw err;
          const message = reason.includes(`${pauseConfirmationRequired}_KNOWN`)
            ? "服务器未提供可靠的文件标识，暂停将清空已下载进度，继续时需重新下载。确定暂停吗？"
            : "当前尚未确认服务器是否提供可靠的文件标识。暂停可能清空已下载进度，继续时可能需要重新下载。确定暂停吗？";
          showConfirmModal("确认暂停下载", message, async () => {
            try {
              await confirmPauseDownloadTask(task.id);
            } catch (confirmErr) {
              showError(`暂停下载失败: ${confirmErr}`);
            }
          }, false, "", () => {
            pendingTaskActions.delete(task.id);
            void refreshTaskList();
          });
          confirmationOpen = true;
        }
      } else {
        await resumeDownloadTask(task.id);
      }
    } catch (err) {
      showError(`${paused ? "暂停" : "继续"}下载失败: ${err}`);
    } finally {
      if (!confirmationOpen) {
        pendingTaskActions.delete(task.id);
        await refreshTaskList();
      }
    }
  });
  return button;
}

function createCompletedTaskActions(task) {
  if (task.status !== "completed" || !getCompletedTaskFilePathCandidate(task)) {
    return null;
  }

  const actions = document.createElement("div");
  actions.className = "task-completed-actions";

  const renameBtn = createCompletedTaskButton("重命名", "task-rename-shortcut-btn");
  renameBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await openCompletedTaskFile(task, renameFile);
  });

  const tagsBtn = createCompletedTaskButton("设置标签", "task-tags-shortcut-btn");
  tagsBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await openCompletedTaskFile(task, openSetTagsModal);
  });

  actions.appendChild(renameBtn);
  actions.appendChild(tagsBtn);
  return actions;
}

function createCompletedTaskButton(label, extraClass) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `task-completed-action-btn ${extraClass}`;
  button.textContent = label;
  return button;
}

async function openCompletedTaskFile(task, action) {
  const filePath = await resolveCompletedTaskFilePath(task);
  if (!filePath) {
    showError("无法定位已下载的 VPK 文件，请刷新 Mod 列表后重试");
    return;
  }

  action(filePath);
}

async function resolveCompletedTaskFilePath(task) {
  let file = findDownloadedTaskFile(task);
  if (file?.path) {
    return file.path;
  }

  if (!getTaskVPKPath(task)) {
    return "";
  }

  await refreshFilesKeepFilter();
  file = findDownloadedTaskFile(task);
  return file?.path || "";
}

function getCompletedTaskFilePathCandidate(task) {
  const file = findDownloadedTaskFile(task);
  if (file?.path) {
    return file.path;
  }

  return getTaskVPKPath(task);
}

function getTaskVPKPath(task) {
  const filePath = String(task.file_path || "").trim();
  if (!filePath || !filePath.toLowerCase().endsWith(".vpk")) {
    return "";
  }
  return filePath;
}

function findDownloadedTaskFile(task) {
  const files = getKnownVPKFiles();
  const taskPath = normalizePathForCompare(getTaskVPKPath(task));
  if (taskPath) {
    const file = files.find((item) => normalizePathForCompare(item.path) === taskPath);
    if (file) return file;
  }

  const workshopId = String(task.workshop_id || "").trim();
  if (workshopId && !workshopId.startsWith("direct-")) {
    const matches = files.filter((item) => String(item.workshopId || "") === workshopId);
    if (matches.length === 1) {
      return matches[0];
    }
  }

  const filename = String(task.filename || "").trim().toLowerCase();
  if (filename.endsWith(".vpk")) {
    const matches = files.filter((item) => String(item.name || "").toLowerCase() === filename);
    if (matches.length === 1) {
      return matches[0];
    }
  }

  return null;
}

function getKnownVPKFiles() {
  const filesByPath = new Map();
  [...(appState.allVpkFiles || []), ...(appState.vpkFiles || [])].forEach((file) => {
    if (file?.path && !filesByPath.has(file.path)) {
      filesByPath.set(file.path, file);
    }
  });
  return Array.from(filesByPath.values());
}

function normalizePathForCompare(filePath) {
  return String(filePath || "").replace(/\//g, "\\").toLowerCase();
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
  if (el && !["pausing", "paused", "cancelling", "failing", "cancelled"].includes(el.dataset.status)) {
    const fill = el.querySelector(".progress-fill");
    const percentText = el.querySelector(".task-percent");
    const sizeText = el.querySelector(".task-size");

    if (fill) fill.style.width = `${safeProgress(task.progress)}%`;
    if (percentText) percentText.textContent = `${safeProgress(task.progress)}%`;
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

function safeProgress(progress) {
  return Math.max(0, Math.min(100, Number(progress) || 0));
}

function safePreviewUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}
