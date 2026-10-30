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
import { createTaskListStore } from "./task-list-state.js";

// These APIs are supplied by the latest backend; keep generated bindings intact.
const pauseDownloadTask = (taskID) => window.go.app.App.PauseDownloadTask(taskID);
const confirmPauseDownloadTask = (taskID) => window.go.app.App.ConfirmPauseDownloadTask(taskID);
const resumeDownloadTask = (taskID) => window.go.app.App.ResumeDownloadTask(taskID);
const pauseConfirmationRequired = "DOWNLOAD_PAUSE_CONFIRMATION_REQUIRED";
const pendingTaskActions = new Set();
const stoppedProgressStatuses = new Set(["pausing", "paused", "cancelling", "failing", "cancelled", "finalizing", "completed", "failed"]);
const taskStore = createTaskListStore();
const rowRecords = new WeakMap();
const movementAnimations = new WeakMap();
const taskListeners = new Set();
let publishedTaskIds = "";
let renderFrame = null;

function getTaskIds() {
  return taskStore.values().map((task) => task.id);
}

export function subscribeToDownloadTasks(listener) {
  taskListeners.add(listener);
  listener(getTaskIds());
  return () => taskListeners.delete(listener);
}

function publishTaskIds() {
  const ids = getTaskIds();
  const key = ids.join(",");
  if (key === publishedTaskIds) return;
  publishedTaskIds = key;
  taskListeners.forEach((listener) => listener(ids));
}

export function refreshTaskList() {
  if (!document.getElementById("download-tasks-list")) return Promise.resolve();
  const token = taskStore.beginRefresh();
  return Promise.resolve().then(() => GetDownloadTasks()).then((tasks) => {
    if (taskStore.applySnapshot(tasks, token)) {
      publishTaskIds();
      flushTaskRender();
    }
  }).catch((err) => {
    console.error("Failed to refresh tasks:", err);
  });
}

function queueTaskRender() {
  if (renderFrame != null) return;
  renderFrame = requestAnimationFrame(() => {
    renderFrame = null;
    renderTaskList();
  });
}

function flushTaskRender() {
  if (renderFrame != null) cancelAnimationFrame(renderFrame);
  renderFrame = null;
  renderTaskList();
}

function renderTaskList() {
  const container = document.getElementById("download-tasks-list");
  if (!container) return;
  const oldPositions = captureVisibleTaskPositions(container);
  const tasks = taskStore.values();
  const activeIds = new Set(tasks.map((task) => `task-${task.id}`));
  for (const child of Array.from(container.children)) {
    if (!activeIds.has(child.id)) child.remove();
  }
  let previous = null;
  for (const task of tasks) {
    let row = document.getElementById(`task-${task.id}`);
    if (!row || row.parentElement !== container) row = createTaskElement(task);
    else patchTaskElement(row, task);
    const next = previous ? previous.nextElementSibling : container.firstElementChild;
    if (next !== row) container.insertBefore(row, next);
    previous = row;
  }
  if (tasks.length === 0) {
    const empty = createNode("div", "empty-tasks");
    empty.textContent = "暂无下载任务";
    container.appendChild(empty);
  }
  animateMovedTasks(oldPositions);
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || false;
}

function captureVisibleTaskPositions(container) {
  const positions = new Map();
  if (prefersReducedMotion() || !container.getBoundingClientRect().height) return positions;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  for (const row of container.children) {
    if (!row.classList.contains("task-item")) continue;
    const rect = row.getBoundingClientRect();
    if (rect.height && rect.bottom > 0 && rect.top < viewportHeight) {
      positions.set(row, row.offsetTop);
      if (positions.size >= 24) break;
    }
  }
  return positions;
}

function animateMovedTasks(positions) {
  for (const [row, before] of positions) {
    if (!row.isConnected) continue;
    const distance = before - row.offsetTop;
    if (!distance || typeof row.animate !== "function") continue;
    movementAnimations.get(row)?.cancel();
    const animation = row.animate([
      { transform: `translateY(${distance}px)` },
      { transform: "translateY(0)" },
    ], { duration: 300, easing: "cubic-bezier(0, 0, 0.2, 1)" });
    movementAnimations.set(row, animation);
    animation.finished.catch(() => {}).finally(() => {
      if (movementAnimations.get(row) === animation) movementAnimations.delete(row);
    });
  }
}

function createNode(tag, className = "", style = "") {
  const node = document.createElement(tag);
  node.className = className;
  if (style) node.style.cssText = style;
  return node;
}

function createTaskIcon(kind) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const attributes = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" };
  for (const [key, value] of Object.entries(attributes)) svg.setAttribute(key, value);
  const paths = {
    copy: ["M9 9h13v13H9z", "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"],
    cancel: ["M18 6 6 18M6 6l12 12"],
    retry: ["M23 4v6h-6M1 20v-6h6", "M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"],
    pause: ["M8 5v14M16 5v14"],
    resume: ["m8 5 12 7-12 7z"],
    download: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m7 10 5 5 5-5M12 15V3"],
  };
  for (const pathData of paths[kind]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    svg.appendChild(path);
  }
  return svg;
}

function createActionButton(kind, title, classes) {
  const button = createNode("button", `task-action-btn ${classes}`);
  button.type = "button";
  button.title = title;
  button.setAttribute("aria-label", title);
  button.appendChild(createTaskIcon(kind));
  return button;
}

export function createTaskElement(task) {
  const row = createNode("div", "task-item", "padding: 10px; display: flex; gap: 10px; align-items: center;");
  row.id = `task-${task.id}`;
  const preview = createNode("div", "task-preview", "width: 50px; height: 50px; flex-shrink: 0; border-radius: 4px; overflow: hidden;");
  const content = createNode("div", "task-content", "flex: 1; min-width: 0;");
  const heading = createNode("div", "", "display: flex; justify-content: space-between; gap: 8px; margin-bottom: 5px;");
  const title = createNode("span", "task-title", "font-weight: bold; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;");
  const controls = createNode("div", "", "display: flex; align-items: center; gap: 5px; flex-shrink: 0;");
  const status = createNode("span", "task-status", "font-size: 12px;");
  const copy = createActionButton("copy", "复制下载链接", "copy-link-btn");
  const pause = createActionButton("pause", "暂停下载", "pause-task-btn");
  const resume = createActionButton("resume", "继续下载", "resume-task-btn");
  const cancel = createActionButton("cancel", "取消下载", "cancel-btn cancel-task-btn");
  const retry = createActionButton("retry", "重试下载", "retry-btn retry-task-btn");
  controls.append(status, copy, pause, resume, cancel, retry);
  heading.append(title, controls);
  const filename = createNode("div", "task-filename", "font-size: 12px; color: var(--text-secondary); margin-bottom: 5px; overflow-wrap: anywhere;");
  const bar = createNode("div", "progress-bar", "width: 100%; height: 6px; background-color: var(--border-light); border-radius: 3px; overflow: hidden;");
  const fill = createNode("div", "progress-fill", "height: 100%; transition: width 0.3s;");
  bar.appendChild(fill);
  const progress = createNode("div", "", "display: flex; justify-content: space-between; font-size: 11px; color: var(--text-tertiary); margin-top: 2px;");
  const size = createNode("span", "task-size");
  const percent = createNode("span", "task-percent");
  progress.append(size, percent);
  const error = createNode("div", "task-error", "color: #f44336; font-size: 11px; margin-top: 2px; overflow-wrap: anywhere;");
  const notice = createNode("div", "task-notice", "color: var(--text-secondary); font-size: 11px; margin-top: 2px; overflow-wrap: anywhere;");
  content.append(heading, filename, bar, progress, notice, error);
  row.append(preview, content);
  const record = { task, preview, content, title, status, copy, pause, resume, cancel, retry, filename, fill, size, percent, notice, error, previewUrl: null, completedActions: null };
  rowRecords.set(row, record);
  copy.addEventListener("click", (event) => {
    event.stopPropagation();
    copyTaskLink(record.task.file_url);
  });
  for (const [button, action] of [[pause, "pause"], [resume, "resume"]]) {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      await runTransferAction(row, record, action);
    });
  }
  cancel.addEventListener("click", (event) => {
    event.stopPropagation();
    showConfirmModal("取消下载", "确定要取消这个下载任务吗？", async () => {
      try {
        await CancelDownloadTask(record.task.id);
        showNotification("已请求取消下载", "info");
      } catch (err) {
        showError("取消失败: " + err);
      }
    });
  });
  retry.addEventListener("click", async (event) => {
    event.stopPropagation();
    try {
      await RetryDownloadTask(record.task.id);
      showNotification("任务已重试", "success");
    } catch (err) {
      showError("重试失败: " + err);
    }
  });
  patchTaskElement(row, task);
  return row;
}

function patchTaskElement(row, task) {
  const record = rowRecords.get(row);
  if (!record) return;
  record.task = task;
  row.dataset.status = task.status;
  const colors = { pending: "#ff9800", selecting_ip: "#9c27b0", downloading: "#2196f3", pausing: "#ff9800", cancelling: "#ff9800", failing: "#ff9800", paused: "#ff9800", finalizing: "#2196f3", completed: "#4caf50", failed: "#f44336", cancelled: "#888" };
  const labels = { pending: "等待中", selecting_ip: "优选线路中...", downloading: "下载中", pausing: "正在暂停...", cancelling: "正在取消...", failing: "正在结束...", paused: "已暂停", finalizing: "正在完成...", completed: "已完成", failed: "失败", cancelled: "已取消" };
  record.title.textContent = task.title || "";
  record.title.title = task.title || "";
  record.filename.textContent = task.filename || "";
  record.status.textContent = labels[task.status] || task.status || "";
  record.status.style.color = colors[task.status] || "#666";
  record.fill.style.backgroundColor = colors[task.status] || "#ccc";
  record.pause.hidden = !["downloading", "pending", "selecting_ip", "pausing"].includes(task.status);
  record.resume.hidden = task.status !== "paused";
  record.cancel.hidden = !["downloading", "pending", "selecting_ip", "pausing", "paused"].includes(task.status);
  record.retry.hidden = !["failed", "cancelled"].includes(task.status);
  for (const button of [record.pause, record.resume, record.cancel, record.retry]) {
    button.style.display = button.hidden ? "none" : "";
    button.disabled = pendingTaskActions.has(task.id) || (button === record.pause && task.status === "pausing");
  }
  record.pause.title = task.status === "pausing" ? "正在暂停" : "暂停下载";
  record.pause.setAttribute("aria-label", record.pause.title);
  record.notice.textContent = task.notice || "";
  record.notice.hidden = !task.notice;
  record.error.textContent = task.error || "";
  record.error.hidden = !task.error;
  const previewUrl = safePreviewUrl(task.preview_url);
  if (record.previewUrl !== previewUrl) {
    record.previewUrl = previewUrl;
    if (record.previewUrl) {
      const image = createNode("img", "", "width: 100%; height: 100%; object-fit: cover;");
      image.src = record.previewUrl;
      image.alt = "";
      record.preview.replaceChildren(image);
    } else {
      const fallback = createNode("div", "", "width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: var(--text-tertiary); background: var(--bg-surface);");
      const icon = createTaskIcon("download");
      icon.setAttribute("width", "24");
      icon.setAttribute("height", "24");
      fallback.appendChild(icon);
      record.preview.replaceChildren(fallback);
    }
  }
  const showCompletedActions = task.status === "completed" && Boolean(getCompletedTaskFilePathCandidate(task));
  if (showCompletedActions && !record.completedActions) {
    record.completedActions = createCompletedTaskActions(() => record.task);
    record.content.appendChild(record.completedActions);
  }
  if (record.completedActions) {
    record.completedActions.hidden = !showCompletedActions;
    record.completedActions.style.display = showCompletedActions ? "" : "none";
  }
  patchTaskProgress(record, task);
}

async function runTransferAction(row, record, action) {
  const id = record.task.id;
  if (pendingTaskActions.has(id)) return;
  pendingTaskActions.add(id);
  patchTaskElement(row, record.task);
  const paused = action === "pause";
  let confirmationOpen = false;
  try {
    if (paused) {
      try {
        await pauseDownloadTask(id);
      } catch (err) {
        const reason = String(err);
        if (!reason.includes(pauseConfirmationRequired)) throw err;
        const message = reason.includes(`${pauseConfirmationRequired}_KNOWN`)
          ? "服务器未提供可靠的文件标识，暂停将清空已下载进度，继续时需重新下载。确定暂停吗？"
          : "当前尚未确认服务器是否提供可靠的文件标识。暂停可能清空已下载进度，继续时可能需要重新下载。确定暂停吗？";
        showConfirmModal("确认暂停下载", message, async () => {
          try {
            await confirmPauseDownloadTask(id);
          } catch (confirmErr) {
            showError(`暂停下载失败: ${confirmErr}`);
          }
        }, false, "", () => {
          pendingTaskActions.delete(id);
          patchTaskElement(row, record.task);
          void refreshTaskList();
        });
        confirmationOpen = true;
      }
    } else {
      await resumeDownloadTask(id);
    }
  } catch (err) {
    showError(`${paused ? "暂停" : "继续"}下载失败: ${err}`);
  } finally {
    if (!confirmationOpen) {
      pendingTaskActions.delete(id);
      patchTaskElement(row, record.task);
      await refreshTaskList();
    }
  }
}

function safePreviewUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function patchTaskProgress(record, task) {
  const progress = Math.max(0, Math.min(100, Number(task.progress) || 0));
  record.fill.style.width = `${progress}%`;
  record.percent.textContent = `${progress}%`;
  record.size.textContent = `${formatBytes(task.downloaded_size)} / ${formatBytes(task.total_size)} ${task.speed ? `(${task.speed})` : ""}`;
}

async function copyTaskLink(url) {
  if (!url) {
    showError("无效的下载链接");
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    showNotification("下载链接已复制", "success");
  } catch {
    const input = createNode("textarea");
    input.value = url;
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    if (copied) showNotification("下载链接已复制", "success");
    else showError("复制失败");
  }
}

function createCompletedTaskActions(getTask) {
  const actions = document.createElement("div");
  actions.className = "task-completed-actions";

  const renameBtn = createCompletedTaskButton("重命名", "task-rename-shortcut-btn");
  renameBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await openCompletedTaskFile(getTask(), renameFile);
  });

  const tagsBtn = createCompletedTaskButton("设置标签", "task-tags-shortcut-btn");
  tagsBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await openCompletedTaskFile(getTask(), openSetTagsModal);
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
  const previous = taskStore.get(task?.id);
  const merged = taskStore.upsert({ ...task, notice: task?.notice || "" });
  if (!merged) return;
  if (!previous) publishTaskIds();
  const row = document.getElementById(`task-${merged.id}`);
  if (row) patchTaskElement(row, merged);
  else queueTaskRender();
  if (merged.status === "completed" && previous?.status !== "completed") refreshFilesKeepFilter();
}

export function updateTaskProgress(task) {
  const previous = taskStore.get(task?.id);
  if (previous && stoppedProgressStatuses.has(previous.status)) return;
  const merged = taskStore.upsert(task);
  if (!merged) return;
  if (!previous) publishTaskIds();
  const row = document.getElementById(`task-${merged.id}`);
  const record = row && rowRecords.get(row);
  if (record) {
    record.task = merged;
    patchTaskProgress(record, merged);
  } else queueTaskRender();
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
  bytes = Math.max(0, Number(bytes) || 0);
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  const i = Math.max(0, Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k))));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}
