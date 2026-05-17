import { switchAppPage } from "../../core/ui-shell.js";
import { showError, showNotification, showInfo } from "../../core/toast.js";
import { getConfig } from "../../core/config.js";
import { escapeHtml } from "../../core/utils.js";
import { refreshTaskList } from "./task-list.js";
import {
  GetWorkshopDetails,
  StartDownloadTask,
  IsSelectingIP,
} from "../../../../wailsjs/go/app/App";

const DOWNLOAD_ICON_SVG = `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
    <polyline points="7 10 12 15 17 10"></polyline>
    <line x1="12" y1="15" x2="12" y2="3"></line>
</svg>`;
const IMAGE_PLACEHOLDER_SVG = `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
    <circle cx="8.5" cy="8.5" r="1.5"></circle>
    <polyline points="21 15 16 10 5 21"></polyline>
</svg>`;

let currentWorkshopDetails = null;
const workshopCache = new Map();
const CACHE_DURATION = 3600 * 1000;

function getCurrentDownloadUrls() {
  const parsedUrls = Array.isArray(currentWorkshopDetails)
    ? currentWorkshopDetails
        .map((details) => details?.file_url?.trim())
        .filter(Boolean)
    : [];

  if (parsedUrls.length > 1) {
    return parsedUrls;
  }

  const manualUrl = document.getElementById("download-url")?.value.trim();
  if (manualUrl) {
    return [manualUrl];
  }

  return parsedUrls;
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
  document.getElementById("workshop-url").value = "";
  document.getElementById("download-url").value = "";
  document.getElementById("download-url").placeholder = "解析后自动填充，或手动输入直链...";
  document.getElementById("workshop-result").classList.add("hidden");
  document.getElementById("workshop-result").innerHTML = "";
  document.getElementById("download-workshop-btn").innerHTML = DOWNLOAD_ICON_SVG + "<span>下载</span>";
  document.getElementById("optimized-ip-container").classList.add("hidden");
  document.getElementById("use-optimized-ip-global").checked = false;
  currentWorkshopDetails = null;
}

export async function checkWorkshopUrl() {
  const url = document.getElementById("workshop-url").value.trim();
  if (!url) {
    showError("请输入创意工坊链接");
    return;
  }

  const checkBtn = document.getElementById("check-workshop-btn");
  const result = document.getElementById("workshop-result");
  const downloadUrlInput = document.getElementById("download-url");

  const originalBtnText = checkBtn.innerHTML;
  checkBtn.disabled = true;
  checkBtn.innerHTML = '<span class="btn-spinner"></span> 解析中...';

  result.classList.add("hidden");
  downloadUrlInput.value = "";

  try {
    let detailsList;

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
      if (detailsList && detailsList.length > 0) {
        workshopCache.set(url, { timestamp: Date.now(), data: detailsList });
      }
    }

    currentWorkshopDetails = detailsList;
    result.innerHTML = "";

    if (!detailsList || detailsList.length === 0) {
      showError("未找到相关文件");
      return;
    }

    const downloadBtn = document.getElementById("download-workshop-btn");
    const optimizedIpContainer = document.getElementById("optimized-ip-container");
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
      for (const detail of detailsList) {
        if (detail.file_url.includes("cdn.steamusercontent.com")) {
          hasSteamCDN = true;
          break;
        }
      }
    }

    if (hasSteamCDN && optimizedIpContainer) {
      optimizedIpContainer.classList.remove("hidden");
    } else if (optimizedIpContainer) {
      optimizedIpContainer.classList.add("hidden");
    }

    detailsList.forEach((details, index) => {
      const itemDiv = document.createElement("div");
      itemDiv.className = "workshop-info";

      const creatorHtml = details.creator && details.creator.trim() !== ""
        ? `<p><strong>作者:</strong> <span>${escapeHtml(details.creator)}</span></p>`
        : "";
      const previewUrl = details.preview_url || "";
      const title = details.title || "Preview";
      const filename = details.filename || "";
      const fileUrl = details.file_url || "";
      const fileSize = Number.parseInt(details.file_size, 10) || 0;

      itemDiv.innerHTML = `
        <div class="workshop-result-preview skeleton-anim">
          <div class="skeleton-image-placeholder">
            ${IMAGE_PLACEHOLDER_SVG}
          </div>
          <img ${previewUrl ? `src="${escapeHtml(previewUrl)}"` : ""} alt="${escapeHtml(title)}" class="workshop-preview" loading="lazy" />
        </div>
        <div class="workshop-details" style="flex: 1;">
          <h3 style="margin-top: 0;">${escapeHtml(title)}</h3>
          <p><strong>文件名:</strong> <span>${escapeHtml(filename)}</span></p>
          <p><strong>大小:</strong> <span>${formatBytes(fileSize)}</span></p>
          ${creatorHtml}
          <div style="margin-top: 10px;">
            <button class="btn btn-success download-item-btn" data-index="${index}">下载此文件</button>
            <button class="btn btn-secondary copy-url-item-btn" data-url="${escapeHtml(fileUrl)}">复制链接</button>
          </div>
        </div>
      `;

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

      result.appendChild(itemDiv);
    });

    result.querySelectorAll(".download-item-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const index = parseInt(btn.dataset.index);
        const config = getConfig();
        const useOptimizedIP = config.workshopPreferredIP || false;
        try {
          await StartDownloadTask(currentWorkshopDetails[index], useOptimizedIP);
          showInfo("已添加到下载队列");
          refreshTaskList();
        } catch (err) {
          showError("下载失败: " + err);
        }
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

    result.classList.remove("hidden");
  } catch (err) {
    showError("解析失败: " + err);
  } finally {
    checkBtn.disabled = false;
    checkBtn.innerHTML = originalBtnText;
  }
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

  const downloadUrl = document.getElementById("download-url").value.trim();
  const config = getConfig();
  const useOptimizedIP = config.workshopPreferredIP || false;

  if (Array.isArray(currentWorkshopDetails) && currentWorkshopDetails.length > 1) {
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
      document.getElementById("workshop-url").value = "";
      document.getElementById("download-url").value = "";
      document.getElementById("download-url").placeholder = "解析后自动填充，或手动输入直链...";
      document.getElementById("workshop-result").classList.add("hidden");
      document.getElementById("download-workshop-btn").innerHTML = DOWNLOAD_ICON_SVG + "<span>下载</span>";
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

  if (Array.isArray(currentWorkshopDetails) && currentWorkshopDetails.length === 1) {
    taskDetails = { ...currentWorkshopDetails[0] };
    taskDetails.file_url = downloadUrl;
  } else {
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
      preview_url: "",
      publishedfileid: "direct-" + Date.now(),
      result: 1,
    };
  }

  try {
    await StartDownloadTask(taskDetails, useOptimizedIP);
    showInfo("已添加到后台下载队列");

    document.getElementById("workshop-url").value = "";
    document.getElementById("download-url").value = "";
    document.getElementById("download-url").placeholder = "解析后自动填充，或手动输入直链...";
    document.getElementById("workshop-result").classList.add("hidden");
    document.getElementById("download-workshop-btn").innerHTML = DOWNLOAD_ICON_SVG + "<span>下载</span>";
    currentWorkshopDetails = [];

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
