import { showError, showNotification } from "../core/toast.js";
import { openMDMPReportFromPath } from "./diagnostics/mdmp-report.js";

let HandleFileDrop;
let EventsOn;
let progressUnsubscribe = null;
let importRunning = false;

export function configureDropImport(deps = {}) {
  HandleFileDrop = deps.HandleFileDrop;
  EventsOn = deps.EventsOn;
  if (!progressUnsubscribe && typeof EventsOn === "function") {
    progressUnsubscribe = EventsOn("drop_import_progress", renderDropImportProgress);
  }
}

export async function handleDropImportPaths(paths = [], { source = "drop" } = {}) {
  const normalizedPaths = normalizePaths(paths);
  if (normalizedPaths.length === 0) return null;

  const dumpPaths = normalizedPaths.filter(isDumpPath);
  const importPaths = normalizedPaths.filter((path) => !isDumpPath(path));

  if (dumpPaths.length > 0) {
    openFirstDump(dumpPaths);
  }

  if (importPaths.length === 0) {
    return {
      total: dumpPaths.length,
      succeeded: dumpPaths.length > 0 ? 1 : 0,
      failed: Math.max(0, dumpPaths.length - 1),
      items: [],
      hasInstallChanges: false,
    };
  }

  if (importRunning) {
    showNotification("已有导入任务正在进行", "info");
    return null;
  }

  if (typeof HandleFileDrop !== "function") {
    showError("当前后端不支持拖入导入");
    return null;
  }

  importRunning = true;
  showDropImportPanel(source === "select" ? "正在导入选中的文件" : "正在处理拖入的文件");
  renderDropImportProgress({
    current: 0,
    total: importPaths.length,
    percent: 0,
    phase: "preparing",
    name: "",
    message: "准备处理...",
  });

  try {
    const result = await HandleFileDrop(importPaths);
    renderDropImportResult(result || {});
    showImportSummary(result || {});
    return result;
  } catch (error) {
    renderDropImportError("处理文件失败: " + formatError(error));
    showError("处理文件失败: " + formatError(error));
    return null;
  } finally {
    importRunning = false;
  }
}

function openFirstDump(dumpPaths) {
  openMDMPReportFromPath(dumpPaths[0]).catch((error) => {
    showError("打开崩溃转储失败: " + formatError(error));
  });
  if (dumpPaths.length > 1) {
    showNotification(`已打开第一个崩溃转储，另外 ${dumpPaths.length - 1} 个未同时打开`, "info");
  }
}

function showDropImportPanel(title) {
  const panel = ensureDropImportPanel();
  panel.querySelector(".drop-import-title").textContent = title;
  panel.querySelector(".drop-import-phase").textContent = "准备";
  panel.querySelector(".drop-import-summary").textContent = "总进度 0%";
  panel.querySelector(".drop-import-file").textContent = "等待文件";
  setDropImportCurrent(panel, "准备处理...");
  panel.querySelector(".drop-import-active-list").replaceChildren();
  panel.querySelector(".drop-import-progress-fill").style.width = "0%";
  panel.querySelector(".drop-import-progress-meta").textContent = "0%";
  panel.querySelector(".drop-import-results").replaceChildren();
  panel.querySelector(".drop-import-action").classList.add("hidden");
  panel.classList.remove("hidden", "is-error", "is-complete");
  panel.classList.add("is-running");
}

function renderDropImportProgress(progress = {}) {
  const panel = ensureDropImportPanel();
  panel.classList.remove("hidden", "is-error", "is-complete");
  panel.classList.add("is-running");

  const itemPercent = clampPercent(Number(progress.percent || 0));
  const current = Number(progress.current || 0);
  const total = Number(progress.total || 0);
  const percent = getOverallPercent(itemPercent, current, total);
  const name = progress.name || basename(progress.path || "");
  const message = progress.message || "正在处理...";
  const activeNames = Array.isArray(progress.activeNames) ? progress.activeNames : [];
  const fileLabel = formatImportFileLabel(name, current, total);

  panel.querySelector(".drop-import-title").textContent = "正在导入文件";
  panel.querySelector(".drop-import-phase").textContent = formatPhase(progress.phase);
  panel.querySelector(".drop-import-summary").textContent = `总进度 ${percent}%`;
  panel.querySelector(".drop-import-file").textContent = fileLabel;
  panel.querySelector(".drop-import-file").title = progress.path || name || "";
  if (activeNames.length > 0) {
    setDropImportCurrent(panel, "正在并行解压 VPK");
  } else {
    setDropImportCurrent(panel, message);
  }
  renderActiveNames(panel.querySelector(".drop-import-active-list"), activeNames);
  panel.querySelector(".drop-import-progress-fill").style.width = `${percent}%`;
  panel.querySelector(".drop-import-progress-meta").textContent = `${percent}%`;
}

function renderDropImportResult(result = {}) {
  const panel = ensureDropImportPanel();
  const failed = Number(result.failed || 0);
  const succeeded = Number(result.succeeded || 0);
  const total = Number(result.total || 0);

  panel.classList.toggle("is-error", failed > 0 && succeeded === 0);
  panel.classList.remove("is-running");
  panel.classList.add("is-complete");
  panel.querySelector(".drop-import-title").textContent = failed > 0 ? "导入完成，有失败" : "导入完成";
  panel.querySelector(".drop-import-phase").textContent = failed > 0 ? "完成" : "完成";
  panel.querySelector(".drop-import-summary").textContent = `成功 ${succeeded} / ${total}，失败 ${failed}`;
  panel.querySelector(".drop-import-file").textContent = failed > 0 ? "查看处理结果" : "全部处理完成";
  setDropImportCurrent(panel, failed > 0 ? "部分项目未处理成功" : "全部处理完成");
  panel.querySelector(".drop-import-active-list").replaceChildren();
  panel.querySelector(".drop-import-progress-fill").style.width = "100%";
  panel.querySelector(".drop-import-progress-meta").textContent = "100%";
  panel.querySelector(".drop-import-action").classList.remove("hidden");

  const results = panel.querySelector(".drop-import-results");
  results.replaceChildren();
  (result.items || []).forEach((item) => results.appendChild(createResultRow(item)));
}

function renderDropImportError(message) {
  const panel = ensureDropImportPanel();
  panel.classList.remove("hidden");
  panel.classList.remove("is-running");
  panel.classList.add("is-error", "is-complete");
  panel.querySelector(".drop-import-title").textContent = "导入失败";
  panel.querySelector(".drop-import-phase").textContent = "失败";
  panel.querySelector(".drop-import-summary").textContent = message || "处理文件失败";
  panel.querySelector(".drop-import-file").textContent = "处理失败";
  setDropImportCurrent(panel, "请查看错误信息后重试");
  panel.querySelector(".drop-import-active-list").replaceChildren();
  panel.querySelector(".drop-import-progress-fill").style.width = "100%";
  panel.querySelector(".drop-import-progress-meta").textContent = "失败";
  panel.querySelector(".drop-import-results").replaceChildren();
  panel.querySelector(".drop-import-action").classList.remove("hidden");
}

function createResultRow(item = {}) {
  const row = document.createElement("div");
  row.className = `drop-import-result ${item.success ? "is-success" : "is-failed"}`;

  const body = document.createElement("div");
  body.className = "drop-import-result-body";

  const name = document.createElement("strong");
  name.textContent = item.name || basename(item.path || "") || "-";
  name.title = item.path || "";

  const message = document.createElement("span");
  message.textContent = item.message || "";

  body.append(name, message);
  row.appendChild(body);
  if (!item.success) {
    const status = document.createElement("span");
    status.className = "drop-import-result-status";
    status.textContent = "失败";
    row.appendChild(status);
  }
  return row;
}

function setDropImportCurrent(panel, text, hidden = false) {
  const current = panel.querySelector(".drop-import-current");
  if (!current) return;
  current.textContent = text || "";
  current.classList.toggle("hidden", hidden);
}

function showImportSummary(result = {}) {
  const failed = Number(result.failed || 0);
  const succeeded = Number(result.succeeded || 0);
  if (failed > 0 && succeeded === 0) {
    showError(`导入失败：${failed} 个项目未处理成功`);
  } else if (failed > 0) {
    showNotification(`导入完成：成功 ${succeeded} 个，失败 ${failed} 个`, "info");
  } else {
    showNotification(`导入完成：成功 ${succeeded} 个`, "success");
  }
}

function ensureDropImportPanel() {
  let panel = document.getElementById("drop-import-panel");
  if (panel) return panel;

  panel = document.createElement("section");
  panel.id = "drop-import-panel";
  panel.className = "drop-import-panel hidden";
  panel.setAttribute("aria-live", "polite");

  const header = document.createElement("div");
  header.className = "drop-import-header";
  const stateIcon = document.createElement("div");
  stateIcon.className = "drop-import-state-icon";
  stateIcon.setAttribute("aria-hidden", "true");
  const titleWrap = document.createElement("div");
  titleWrap.className = "drop-import-title-wrap";
  const title = document.createElement("h3");
  title.className = "drop-import-title";
  title.textContent = "正在导入文件";
  const summary = document.createElement("p");
  summary.className = "drop-import-summary";
  summary.textContent = "准备处理...";
  const phase = document.createElement("span");
  phase.className = "drop-import-phase";
  phase.textContent = "准备";
  titleWrap.append(title, summary);
  header.append(stateIcon, titleWrap, phase);

  const progressSection = document.createElement("div");
  progressSection.className = "drop-import-progress-section";
  const file = document.createElement("strong");
  file.className = "drop-import-file";
  file.textContent = "等待文件";
  const current = document.createElement("p");
  current.className = "drop-import-current";
  const activeList = document.createElement("div");
  activeList.className = "drop-import-active-list";

  const progress = document.createElement("div");
  progress.className = "drop-import-progress";
  const bar = document.createElement("div");
  bar.className = "drop-import-progress-bar";
  const fill = document.createElement("div");
  fill.className = "drop-import-progress-fill";
  bar.appendChild(fill);
  const meta = document.createElement("span");
  meta.className = "drop-import-progress-meta";
  meta.textContent = "0%";
  progress.append(bar, meta);

  const results = document.createElement("div");
  results.className = "drop-import-results";

  const footer = document.createElement("div");
  footer.className = "drop-import-footer";
  const actionBtn = document.createElement("button");
  actionBtn.type = "button";
  actionBtn.className = "btn btn-primary drop-import-action hidden";
  actionBtn.textContent = "完成";
  actionBtn.addEventListener("click", () => panel.classList.add("hidden"));
  footer.appendChild(actionBtn);

  progressSection.append(file, current, activeList, progress);
  panel.append(header, progressSection, results, footer);
  document.body.appendChild(panel);
  return panel;
}

function normalizePaths(paths) {
  const seen = new Set();
  const normalized = [];
  paths.forEach((path) => {
    const value = String(path || "").trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    normalized.push(value);
  });
  return normalized;
}

function renderActiveNames(container, names = []) {
  if (!container) return;
  container.replaceChildren();
  names.forEach((name) => {
    const item = document.createElement("span");
    item.className = "drop-import-active-item";
    item.textContent = name;
    item.title = name;
    container.appendChild(item);
  });
}

function isDumpPath(path) {
  return /\.(mdmp|dmp)$/i.test(String(path || ""));
}

function clampPercent(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function getOverallPercent(itemPercent, current, total) {
  if (!total || total <= 1) return itemPercent;
  const safeCurrent = Math.max(1, Math.min(current || 1, total));
  return clampPercent(((safeCurrent - 1) * 100 + itemPercent) / total);
}

function formatImportFileLabel(name, current, total) {
  if (total > 1) {
    if (current >= 1) {
      const safeCurrent = Math.min(current, total);
      return `[${safeCurrent}/${total}] ${name || "当前文件"}`;
    }
    return `等待处理 ${total} 个文件`;
  }
  return name || "当前文件";
}

function basename(path = "") {
  return String(path).split(/[\\/]/).pop() || path;
}

function formatPhase(phase = "") {
  const labels = {
    preparing: "准备",
    copying: "复制",
    extracting: "解压",
    packing: "打包",
    complete: "完成",
    failed: "失败",
  };
  return labels[phase] || "处理";
}

function formatError(error) {
  if (error?.message) return error.message;
  return String(error || "未知错误");
}
