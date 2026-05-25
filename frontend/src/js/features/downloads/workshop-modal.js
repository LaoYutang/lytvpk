import { switchAppPage } from "../../core/ui-shell.js";
import { showError, showNotification, showInfo } from "../../core/toast.js";
import { getConfig } from "../../core/config.js";
import { escapeHtml } from "../../core/utils.js";
import { refreshTaskList } from "./task-list.js";
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
  const parsedUrls = getAllDownloadableItems()
    .map((details) => details.file_url.trim())
    .filter(Boolean);

  if (parsedUrls.length > 0) {
    return parsedUrls;
  }

  const manualUrl = document.getElementById("download-url")?.value.trim();
  if (manualUrl) {
    return [manualUrl];
  }

  return [];
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
  document.getElementById("workshop-url")?.focus();
  refreshTaskList();
}

export function closeWorkshopModal() {
  switchAppPage("mods");
  resetWorkshopParseState();
}

function resetWorkshopParseState() {
  document.getElementById("workshop-url").value = "";
  document.getElementById("download-url").value = "";
  document.getElementById("download-url").placeholder = "解析后自动填充，或手动输入直链...";
  document.getElementById("workshop-result").classList.add("hidden");
  document.getElementById("workshop-result").innerHTML = "";
  document.getElementById("download-workshop-btn").innerHTML = DOWNLOAD_ICON_SVG + "<span>下载</span>";
  document.getElementById("optimized-ip-container").classList.add("hidden");
  document.getElementById("use-optimized-ip-global").checked = false;
  currentWorkshopResult = null;
}

export async function checkWorkshopUrl() {
  const url = document.getElementById("workshop-url").value.trim();
  if (!url) {
    showError("请输入创意工坊链接或工坊ID");
    return;
  }

  const checkBtn = document.getElementById("check-workshop-btn");
  const result = document.getElementById("workshop-result");
  const downloadUrlInput = document.getElementById("download-url");

  const originalBtnText = checkBtn.innerHTML;
  checkBtn.disabled = true;
  checkBtn.innerHTML = '<span class="btn-spinner"></span> 解析中...';

  result.classList.add("hidden");
  result.innerHTML = "";
  downloadUrlInput.value = "";

  try {
    let groupedResult;

    if (workshopCache.has(url)) {
      const cached = workshopCache.get(url);
      if (Date.now() - cached.timestamp < CACHE_DURATION) {
        console.log("使用缓存的工坊解析结果");
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

    currentWorkshopResult = groupedResult;
    const groups = getCurrentGroups();

    if (groups.length === 0) {
      showError("未找到相关文件");
      return;
    }

    const downloadBtn = document.getElementById("download-workshop-btn");
    const optimizedIpContainer = document.getElementById("optimized-ip-container");
    const downloadableItems = getAllDownloadableItems();

    downloadUrlInput.placeholder =
      downloadableItems.length > 0
        ? `已解析 ${groups.length} 组 / ${downloadableItems.length} 个可下载文件`
        : `已解析 ${groups.length} 组，但没有可下载文件`;
    downloadBtn.innerHTML = DOWNLOAD_ICON_SVG + "<span>全部下载</span>";

    const hasSteamCDN = downloadableItems.some((details) =>
      details.file_url.includes("cdn.steamusercontent.com")
    );

    if (hasSteamCDN && optimizedIpContainer) {
      optimizedIpContainer.classList.remove("hidden");
    } else if (optimizedIpContainer) {
      optimizedIpContainer.classList.add("hidden");
    }

    groups.forEach((group, groupIndex) => {
      result.appendChild(renderWorkshopGroup(group, groupIndex));
    });

    bindWorkshopResultEvents(result);
    result.classList.remove("hidden");
  } catch (err) {
    showError("解析失败: " + err);
  } finally {
    checkBtn.disabled = false;
    checkBtn.innerHTML = originalBtnText;
  }
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
  getGroupItems(group).forEach((details, itemIndex) => {
    body.appendChild(renderWorkshopItem(details, groupIndex, itemIndex));
  });

  return groupDiv;
}

function renderWorkshopItem(details, groupIndex, itemIndex) {
  const itemDiv = document.createElement("div");
  const isMain = itemIndex === 0;
  const downloadable = isDownloadableDetail(details);
  itemDiv.className = `workshop-info workshop-group-item${isMain ? " workshop-main-item" : ""}`;

  const creatorHtml = details.creator && details.creator.trim() !== ""
    ? `<p><strong>作者:</strong> <span>${escapeHtml(details.creator)}</span></p>`
    : "";
  const previewUrl = details.preview_url || "";
  const title = details.title || (isMain ? "主物品" : "子物品");
  const filename = details.filename || "";
  const fileUrl = details.file_url || "";
  const fileSize = Number.parseInt(details.file_size, 10) || 0;
  const itemTypeLabel = isMain ? "主物品" : "子物品";

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
      await startDownloadItems(items, "已添加本组任务到下载队列");
    });
  });

  result.querySelectorAll(".download-item-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const groupIndex = Number.parseInt(btn.dataset.groupIndex, 10);
      const itemIndex = Number.parseInt(btn.dataset.itemIndex, 10);
      const item = getGroupItems(getCurrentGroups()[groupIndex])[itemIndex];
      await startDownloadItems([item], "已添加到下载队列");
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

async function startDownloadItems(items, successMessage) {
  const downloadableItems = items.filter(isDownloadableDetail);
  if (downloadableItems.length === 0) {
    showError("没有可下载的文件");
    return 0;
  }

  const config = getConfig();
  const useOptimizedIP = config.workshopPreferredIP || false;
  let successCount = 0;

  for (const details of downloadableItems) {
    try {
      await StartDownloadTask(details, useOptimizedIP);
      successCount++;
    } catch (err) {
      console.error("Failed to start task for", details.title, err);
    }
  }

  if (successCount > 0) {
    showInfo(
      downloadableItems.length === 1
        ? successMessage
        : `已添加 ${successCount} 个任务到下载队列`
    );
    refreshTaskList();
  } else {
    showError("添加任务失败");
  }

  return successCount;
}

export async function downloadWorkshopFile() {
  const isSelecting = await IsSelectingIP();
  if (isSelecting) {
    const btn = document.getElementById("download-workshop-btn");
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="btn-spinner"></span> 正在优选线路...`;
    showNotification("正在优选最佳线路，完成后自动开始下载", "info");

    const checkInterval = setInterval(async () => {
      const stillSelecting = await IsSelectingIP();
      if (!stillSelecting) {
        clearInterval(checkInterval);
        btn.disabled = false;
        btn.innerHTML = originalText;
        downloadWorkshopFile();
      }
    }, 1000);

    return;
  }

  const groupedItems = getAllDownloadableItems();
  if (groupedItems.length > 0) {
    const successCount = await startDownloadItems(groupedItems, "已添加到下载队列");
    if (successCount > 0) {
      resetWorkshopParseState();
    }
    return;
  }

  const downloadUrl = document.getElementById("download-url").value.trim();
  const config = getConfig();
  const useOptimizedIP = config.workshopPreferredIP || false;

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

  try {
    await StartDownloadTask(taskDetails, useOptimizedIP);
    showInfo("已添加到后台下载队列");
    resetWorkshopParseState();
    refreshTaskList();
  } catch (err) {
    showError("添加任务失败: " + err);
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
