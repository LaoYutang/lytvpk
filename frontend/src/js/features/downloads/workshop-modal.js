import { switchAppPage } from "../../core/ui-shell.js";
import { showError, showNotification, showInfo } from "../../core/toast.js";
import { getConfig } from "../../core/config.js";
import { escapeHtml } from "../../core/utils.js";
import { refreshTaskList } from "./task-list.js";
import { closeWorkshopHistory, recordWorkshopHistory } from "./workshop-history.js";
import {
  selectDownloadsTab,
  captureDownloadOrigin,
  beginDownloadSubmission,
  notifyDownloadTaskCreated,
  finishDownloadSubmission,
  cancelDownloadFeedback,
} from "./downloads-page.js";
import {
  GetWorkshopDetailsGrouped,
  StartDownloadTask,
  IsSelectingIP,
} from "../../../../wailsjs/go/app/App";

const DOWNLOAD_ICON_SVG = `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
    <polyline points="7 10 12 15 17 10"></polyline>
    <line x1="12" y1="15" x2="12" y2="3"></line>
</svg>`;
const COPY_ICON_SVG = `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
</svg>`;
const CHEVRON_ICON_SVG = `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="6 9 12 15 18 9"></polyline>
</svg>`;
const IMAGE_PLACEHOLDER_SVG = `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
    <circle cx="8.5" cy="8.5" r="1.5"></circle>
    <polyline points="21 15 16 10 5 21"></polyline>
</svg>`;

let currentWorkshopResult = null;
let workshopParseSequence = 0;
let parseButtonContent = null;
const submittingButtons = new WeakSet();
const workshopCache = new Map();
const CACHE_DURATION = 3600 * 1000;

function getCurrentGroups() {
  return Array.isArray(currentWorkshopResult?.groups)
    ? currentWorkshopResult.groups
    : [];
}

function getGroupItems(group) {
  if (Array.isArray(group?.items) && group.items.length > 0) {
    return group.items;
  }
  return group?.main ? [group.main] : [];
}

function isCollectionGroup(group) {
  return Number(group?.main?.file_type) === 2;
}

function isDownloadableDetail(details) {
  return (
    details &&
    details.result === 1 &&
    typeof details.file_url === "string" &&
    details.file_url.trim() !== ""
  );
}

function getGroupDownloadableItems(group) {
  const explicitItems = Array.isArray(group?.downloadable_items)
    ? group.downloadable_items.filter(isDownloadableDetail)
    : [];

  if (explicitItems.length > 0) {
    return explicitItems;
  }

  return getGroupItems(group).filter(isDownloadableDetail);
}

function getAllDownloadableItems() {
  return getCurrentGroups().flatMap((group) => getGroupDownloadableItems(group));
}

function getCurrentDownloadUrls() {
  const manualUrl = document.getElementById("download-url")?.value.trim();
  if (manualUrl) {
    return [manualUrl];
  }

  const parsedUrls = getAllDownloadableItems()
    .map((details) => details.file_url.trim())
    .filter(Boolean);

  if (parsedUrls.length > 0) {
    return parsedUrls;
  }

  return [];
}

export function updateDownloadButtonLabel() {
  const button = document.getElementById("download-workshop-btn");
  if (!button) return;
  let label = button.querySelector("span");
  if (!label) {
    label = document.createElement("span");
    button.appendChild(label);
  }
  const manualUrl = document.getElementById("download-url")?.value.trim();
  label.textContent = !manualUrl && getAllDownloadableItems().length > 0 ? "全部下载" : "下载";
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (err) {
      console.error("Clipboard API copy failed:", err);
    }
  }

  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.position = "fixed";
  el.style.left = "-9999px";
  document.body.appendChild(el);
  el.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("execCommand copy failed");
    }
  } finally {
    document.body.removeChild(el);
  }
}

export async function copyCurrentDownloadUrls() {
  const urls = getCurrentDownloadUrls();
  if (urls.length === 0) {
    showError("没有可复制的下载链接");
    return;
  }

  try {
    await copyTextToClipboard(urls.join("\n"));
    showNotification(
      urls.length > 1 ? `已复制 ${urls.length} 个下载链接` : "链接已复制",
      "success"
    );
  } catch (err) {
    console.error("复制失败:", err);
    showError("复制失败");
  }
}

export function openWorkshopModal() {
  switchAppPage("downloads");
  selectDownloadsTab("parse");
  document.getElementById("workshop-url")?.focus();
  refreshTaskList();
}

export function openWorkshopParse(input, { autoParse = true } = {}) {
  cancelDownloadFeedback();
  invalidateWorkshopParse();
  openWorkshopModal();
  document.getElementById("workshop-url").value = String(input ?? "");
  if (autoParse) {
    return checkWorkshopUrl();
  }
}

export function closeWorkshopModal() {
  switchAppPage("mods");
  resetWorkshopParseState();
}

function resetWorkshopParseState() {
  invalidateWorkshopParse();
  document.getElementById("workshop-url").value = "";
  document.getElementById("download-url").value = "";
  document.getElementById("download-url").placeholder = "解析后自动填充，或手动输入直链...";
  document.getElementById("workshop-result").classList.add("hidden");
  document.getElementById("workshop-result").innerHTML = "";
  document.getElementById("download-workshop-btn").innerHTML = DOWNLOAD_ICON_SVG + "<span>下载</span>";
  document.getElementById("optimized-ip-container")?.classList.add("hidden");
  const optimizedIpCheckbox = document.getElementById("use-optimized-ip-global");
  if (optimizedIpCheckbox) {
    optimizedIpCheckbox.checked = false;
  }
  currentWorkshopResult = null;
  closeWorkshopHistory();
}

function restoreParseButton() {
  const checkBtn = document.getElementById("check-workshop-btn");
  if (!checkBtn) return;
  checkBtn.disabled = false;
  if (parseButtonContent) {
    checkBtn.replaceChildren(...parseButtonContent);
    parseButtonContent = null;
  }
}

function invalidateWorkshopParse() {
  workshopParseSequence++;
  restoreParseButton();
}

export async function checkWorkshopUrl() {
  const input = document.getElementById("workshop-url");
  const url = input.value.trim();
  if (!url) {
    showError("请输入创意工坊链接或工坊ID");
    return;
  }

  const checkBtn = document.getElementById("check-workshop-btn");
  const result = document.getElementById("workshop-result");
  const downloadUrlInput = document.getElementById("download-url");

  cancelDownloadFeedback();
  const requestSequence = ++workshopParseSequence;
  const isCurrentRequest = () =>
    requestSequence === workshopParseSequence && input.value.trim() === url;
  if (!parseButtonContent) {
    parseButtonContent = [...checkBtn.childNodes];
  }
  checkBtn.disabled = true;
  const spinner = document.createElement("span");
  spinner.className = "btn-spinner";
  checkBtn.replaceChildren(spinner, document.createTextNode(" 解析中..."));

  currentWorkshopResult = null;
  result.classList.add("hidden");
  result.replaceChildren();
  downloadUrlInput.value = "";

  try {
    let groupedResult;

    if (workshopCache.has(url)) {
      const cached = workshopCache.get(url);
      if (Date.now() - cached.timestamp < CACHE_DURATION) {
        groupedResult = cached.data;
      } else {
        workshopCache.delete(url);
      }
    }

    if (!groupedResult) {
      groupedResult = await GetWorkshopDetailsGrouped(url);
      if (groupedResult?.groups?.length > 0) {
        workshopCache.set(url, { timestamp: Date.now(), data: groupedResult });
      }
    }

    if (!isCurrentRequest()) return;
    renderWorkshopGroups(groupedResult?.groups);
    recordWorkshopHistory(groupedResult?.groups);
  } catch (err) {
    if (isCurrentRequest()) {
      showError("解析失败: " + err);
    }
  } finally {
    if (requestSequence === workshopParseSequence) {
      restoreParseButton();
    }
  }
}

// 把解析结果渲染到结果区，供实时解析与历史记录快照共用
export function applyWorkshopGroups(groups) {
  invalidateWorkshopParse();
  renderWorkshopGroups(groups);
}

function renderWorkshopGroups(groups) {
  const result = document.getElementById("workshop-result");
  const downloadUrlInput = document.getElementById("download-url");
  const downloadBtn = document.getElementById("download-workshop-btn");
  const optimizedIpContainer = document.getElementById("optimized-ip-container");

  const safeGroups = Array.isArray(groups) ? groups : [];
  currentWorkshopResult = { groups: safeGroups };

  result.classList.add("hidden");
  result.innerHTML = "";
  downloadUrlInput.value = "";

  if (safeGroups.length === 0) {
    showError("未找到相关文件");
    return;
  }

  const downloadableItems = getAllDownloadableItems();

  downloadUrlInput.placeholder =
    downloadableItems.length > 0
      ? `已解析 ${safeGroups.length} 组 / ${downloadableItems.length} 个可下载文件`
      : `已解析 ${safeGroups.length} 组，但没有可下载文件`;
  downloadBtn.innerHTML = DOWNLOAD_ICON_SVG + "<span>全部下载</span>";

  const hasSteamCDN = downloadableItems.some((details) =>
    details.file_url.includes("cdn.steamusercontent.com")
  );

  if (hasSteamCDN && optimizedIpContainer) {
    optimizedIpContainer.classList.remove("hidden");
  } else if (optimizedIpContainer) {
    optimizedIpContainer.classList.add("hidden");
  }

  safeGroups.forEach((group, groupIndex) => {
    result.appendChild(renderWorkshopGroup(group, groupIndex));
  });

  bindWorkshopResultEvents(result);
  result.classList.remove("hidden");
}

function renderWorkshopGroup(group, groupIndex) {
  const groupDiv = document.createElement("div");
  groupDiv.className = "workshop-group";
  groupDiv.dataset.groupIndex = String(groupIndex);

  const rootId = group.root_id || group.main?.publishedfileid || "";
  const mainTitle = group.main?.title || `工坊 #${rootId}`;
  const downloadableCount = getGroupDownloadableItems(group).length;

  groupDiv.innerHTML = `
    <div class="workshop-group-header">
      <button class="workshop-group-toggle" type="button" aria-expanded="true">
        <span class="workshop-group-chevron" aria-hidden="true">${CHEVRON_ICON_SVG}</span>
        <span class="workshop-group-title">${escapeHtml(mainTitle)} <span class="workshop-group-id">#${escapeHtml(rootId)}</span></span>
      </button>
      <div class="workshop-group-actions">
        <button class="btn btn-success download-group-btn" type="button" data-group-index="${groupIndex}" ${downloadableCount === 0 ? "disabled" : ""}>
          ${DOWNLOAD_ICON_SVG}<span>下载本组</span>
        </button>
      </div>
    </div>
    <div class="workshop-group-body"></div>
  `;

  const body = groupDiv.querySelector(".workshop-group-body");
  const collectionGroup = isCollectionGroup(group);
  let renderedCount = 0;
  getGroupItems(group).forEach((details, itemIndex) => {
    // 合集本体不是文件，标题栏已经展示合集名和 ID，这里不再单独占一个卡片
    if (collectionGroup && itemIndex === 0) {
      return;
    }
    body.appendChild(
      renderWorkshopItem(details, groupIndex, itemIndex, collectionGroup)
    );
    renderedCount++;
  });

  if (renderedCount === 0) {
    const empty = document.createElement("p");
    empty.className = "workshop-group-empty";
    empty.textContent = "该合集内暂无可显示的文件";
    body.appendChild(empty);
  }

  return groupDiv;
}

function renderWorkshopItem(details, groupIndex, itemIndex, collectionGroup = false) {
  const itemDiv = document.createElement("div");
  const isMain = itemIndex === 0;
  const downloadable = isDownloadableDetail(details);
  itemDiv.className = `workshop-info workshop-group-item${isMain ? " workshop-main-item" : ""}`;

  const creatorHtml = details.creator && details.creator.trim() !== ""
    ? `<p><strong>作者:</strong> <span>${escapeHtml(details.creator)}</span></p>`
    : "";
  const previewUrl = details.preview_url || "";
  const itemTypeLabel = isMain ? "主物品" : collectionGroup ? "合集" : "子物品";
  const title = details.title || itemTypeLabel;
  const filename = details.filename || "";
  const fileUrl = details.file_url || "";
  const fileSize = Number.parseInt(details.file_size, 10) || 0;

  const actionsHtml = downloadable
    ? `
      <button class="btn btn-success download-item-btn" type="button" data-group-index="${groupIndex}" data-item-index="${itemIndex}">
        ${DOWNLOAD_ICON_SVG}<span>下载此文件</span>
      </button>
      <button class="btn btn-secondary copy-url-item-btn" type="button" data-url="${escapeHtml(fileUrl)}">
        ${COPY_ICON_SVG}<span>复制链接</span>
      </button>
    `
    : `<span class="workshop-unavailable-badge">不可下载</span>`;

  itemDiv.innerHTML = `
    <div class="workshop-result-preview skeleton-anim">
      <div class="skeleton-image-placeholder">
        ${IMAGE_PLACEHOLDER_SVG}
      </div>
      <img ${previewUrl ? `src="${escapeHtml(previewUrl)}"` : ""} alt="${escapeHtml(title)}" class="workshop-preview" loading="lazy" />
    </div>
    <div class="workshop-details">
      <div class="workshop-item-heading">
        <span class="workshop-item-role">${itemTypeLabel}</span>
        <h3>${escapeHtml(title)}</h3>
      </div>
      <p><strong>文件名:</strong> <span>${escapeHtml(filename || "无文件")}</span></p>
      <p><strong>大小:</strong> <span>${downloadable ? formatBytes(fileSize) : "-"}</span></p>
      ${creatorHtml}
      <div class="workshop-item-actions">
        ${actionsHtml}
      </div>
    </div>
  `;

  bindPreviewLoading(itemDiv, previewUrl);
  return itemDiv;
}

function bindPreviewLoading(itemDiv, previewUrl) {
  const preview = itemDiv.querySelector(".workshop-preview");
  const previewWrapper = itemDiv.querySelector(".workshop-result-preview");
  const placeholder = itemDiv.querySelector(".skeleton-image-placeholder");
  const showPreview = () => {
    preview.classList.add("loaded");
    previewWrapper.classList.remove("skeleton-anim");
    placeholder.classList.add("hidden");
  };
  const stopPreviewLoading = () => {
    previewWrapper.classList.remove("skeleton-anim");
  };

  if (!previewUrl) {
    stopPreviewLoading();
  } else if (preview.complete && preview.naturalWidth > 0) {
    showPreview();
  } else {
    preview.addEventListener("load", showPreview, { once: true });
    preview.addEventListener("error", stopPreviewLoading, { once: true });
  }
}

function bindWorkshopResultEvents(result) {
  result.querySelectorAll(".workshop-group-header").forEach((header) => {
    header.addEventListener("click", (event) => {
      if (event.target.closest(".download-group-btn")) {
        return;
      }

      const group = header.closest(".workshop-group");
      const toggleBtn = header.querySelector(".workshop-group-toggle");
      const willCollapse = !group.classList.contains("collapsed");
      group.classList.toggle("collapsed", willCollapse);
      toggleBtn?.setAttribute("aria-expanded", String(!willCollapse));
    });
  });

  result.querySelectorAll(".download-group-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const groupIndex = Number.parseInt(btn.dataset.groupIndex, 10);
      const group = getCurrentGroups()[groupIndex];
      const items = getGroupDownloadableItems(group);
      await startDownloadItems(items, "已添加本组任务到下载队列", btn);
    });
  });

  result.querySelectorAll(".download-item-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const groupIndex = Number.parseInt(btn.dataset.groupIndex, 10);
      const itemIndex = Number.parseInt(btn.dataset.itemIndex, 10);
      const item = getGroupItems(getCurrentGroups()[groupIndex])[itemIndex];
      await startDownloadItems([item], "已添加到下载队列", btn);
    });
  });

  result.querySelectorAll(".copy-url-item-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const url = btn.dataset.url;
      if (!url) {
        showError("无效的下载链接");
        return;
      }

      try {
        await copyTextToClipboard(url);
        showInfo("链接已复制");
      } catch (err) {
        console.error("复制失败:", err);
        showError("复制失败");
      }
    });
  });
}

async function startDownloadItems(items, successMessage, button) {
  if (button && submittingButtons.has(button)) return 0;
  const downloadableItems = items.filter(isDownloadableDetail).map((item) => ({ ...item }));
  if (downloadableItems.length === 0) {
    showError("没有可下载的文件");
    return 0;
  }

  const config = getConfig();
  const useOptimizedIP = config.workshopPreferredIP || false;
  const origin = captureDownloadOrigin(button);
  const submission = beginDownloadSubmission(origin);
  if (button) {
    submittingButtons.add(button);
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
  }
  let successCount = 0;
  let lastError;

  try {
    let waitingNoticeShown = false;
    while (await IsSelectingIP()) {
      if (!waitingNoticeShown) {
        showNotification("正在优选最佳线路，完成后自动添加下载任务", "info");
        waitingNoticeShown = true;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    for (const details of downloadableItems) {
      try {
        const taskId = await StartDownloadTask(details, useOptimizedIP);
        if (!taskId) throw new Error("未返回下载任务编号");
        successCount++;
        notifyDownloadTaskCreated(submission, taskId);
      } catch (err) {
        lastError = err;
        console.error("Failed to start task for", details.title, err);
      }
    }
  } catch (err) {
    lastError = err;
  } finally {
    if (button) {
      submittingButtons.delete(button);
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
    finishDownloadSubmission(submission);
  }

  if (successCount > 0) {
    const failedCount = downloadableItems.length - successCount;
    showInfo(
      failedCount > 0
        ? `已添加 ${successCount} 个任务，${failedCount} 个任务添加失败`
        : downloadableItems.length === 1
          ? successMessage
          : `已添加 ${successCount} 个任务到下载队列`
    );
    refreshTaskList();
  } else {
    showError(lastError ? "添加任务失败: " + lastError : "添加任务失败");
  }

  return successCount;
}

export async function downloadWorkshopFile(event) {
  const button = event?.currentTarget || document.getElementById("download-workshop-btn");
  const downloadUrl = document.getElementById("download-url").value.trim();
  const groupedItems = getAllDownloadableItems();
  if (!downloadUrl && groupedItems.length > 0) {
    return startDownloadItems(groupedItems, "已添加到下载队列", button);
  }

  if (!downloadUrl) {
    showError("请输入或解析下载链接");
    return;
  }

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

  const taskDetails = {
    title: "Direct Download",
    filename: filename,
    file_url: downloadUrl,
    file_size: "0",
    preview_url: "",
    publishedfileid: "direct-" + Date.now(),
    result: 1,
  };

  return startDownloadItems([taskDetails], "已添加到后台下载队列", button);
}

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}
