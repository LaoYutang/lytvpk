import { appState } from "../state.js";
import { formatFileSize, getLocationDisplayName } from "../../core/utils.js";
import { showError } from "../../core/toast.js";
import { GetVPKPreviewImage, ParseWorkshopID } from "../../../../wailsjs/go/app/App";
import { handleProtocolWorkshop } from "../workshop/workshop-browser.js";

let currentDetailFile = null;

export function showFileDetail(filePath) {
  console.log("=== showFileDetail 开始执行 ===");
  console.log("文件路径:", filePath);
  console.log("appState.vpkFiles 长度:", appState.vpkFiles.length);

  const file = appState.vpkFiles.find((f) => f.path === filePath);
  if (!file) {
    console.error("未找到文件:", filePath);
    console.log("可用文件列表:", appState.vpkFiles.map((f) => f.path));
    return;
  }

  console.log("找到文件:", file.name);
  currentDetailFile = file;

  const modal = document.getElementById("file-detail-modal");
  if (!modal) {
    console.error("模态框元素不存在!");
    return;
  }

  document.getElementById("detail-file-name").textContent = file.name;
  document.getElementById("detail-name").textContent = file.name;
  document.getElementById("detail-size").textContent = formatFileSize(file.size);
  document.getElementById("detail-location").textContent = getLocationDisplayName(file.location);
  document.getElementById("detail-status").textContent = file.enabled ? "启用" : "禁用";
  document.getElementById("detail-modified").textContent = new Date(file.lastModified).toLocaleString();

  const previewSection = document.getElementById("preview-section");
  const previewImage = document.getElementById("detail-preview-image");

  previewSection.classList.remove("hidden");
  previewImage.style.display = "none";

  if (file.previewImage) {
    previewImage.src = file.previewImage;
    previewImage.style.display = "block";
  } else {
    GetVPKPreviewImage(file.path)
      .then((imgData) => {
        if (imgData) {
          previewImage.src = imgData;
          previewImage.style.display = "block";
        } else {
          previewSection.classList.add("hidden");
        }
      })
      .catch((err) => {
        console.error("加载预览图失败:", err);
        previewSection.classList.add("hidden");
      });
  }

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

  const vpkInfoSection = document.getElementById("vpk-info-section");
  document.getElementById("detail-vpk-title").textContent = file.title || "无标题";

  const authorItem = document.getElementById("detail-vpk-author-item");
  if (file.author && file.author !== "") {
    authorItem.style.display = "grid";
    document.getElementById("detail-vpk-author").textContent = file.author;
  } else {
    authorItem.style.display = "none";
  }

  const versionItem = document.getElementById("detail-vpk-version-item");
  if (file.version && file.version !== "") {
    versionItem.style.display = "grid";
    document.getElementById("detail-vpk-version").textContent = file.version;
  } else {
    versionItem.style.display = "none";
  }

  const descItem = document.getElementById("detail-vpk-desc-item");
  if (file.desc && file.desc !== "") {
    descItem.style.display = "grid";
    document.getElementById("detail-vpk-desc").textContent = file.desc;
  } else {
    descItem.style.display = "none";
  }

  const urlItem = document.getElementById("detail-vpk-url-item");
  const urlLink = document.getElementById("detail-vpk-url");
  urlItem.style.display = "none";
  urlLink.onclick = null;

  (async () => {
    let workshopId = file.workshopId;

    if (!workshopId && file.addonURL0) {
      try {
        workshopId = await ParseWorkshopID(file.addonURL0);
      } catch (e) {
        console.log("从addonURL0解析工坊ID失败:", e);
      }
    }

    if (workshopId) {
      urlItem.style.display = "grid";
      urlLink.textContent = `工坊 #${workshopId}`;
      urlLink.href = "javascript:void(0)";
      urlLink.removeAttribute("target");
      urlLink.onclick = (e) => {
        e.preventDefault();
        handleProtocolWorkshop(workshopId);
      };
    }
  })();

  const mapInfoSection = document.getElementById("map-info-section");
  if (file.primaryTag === "地图") {
    mapInfoSection.classList.remove("hidden");

    const campaignElement = document.getElementById("detail-campaign");
    campaignElement.textContent = file.campaign || "未知战役";

    const chaptersListElement = document.getElementById("detail-chapters-list");
    if (file.chapters && Object.keys(file.chapters).length > 0) {
      let chaptersHtml = "";
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
      chaptersListElement.innerHTML = '<div class="no-chapters">无章节信息</div>';
    }
  } else {
    mapInfoSection.classList.add("hidden");
  }

  modal.classList.remove("hidden");

  setTimeout(() => {
    const modalContent = modal.querySelector(".modal-content");
    const modalBody = modal.querySelector(".modal-body");
    if (modalContent) modalContent.scrollTop = 0;
    if (modalBody) modalBody.scrollTop = 0;
  }, 0);

  console.log("=== showFileDetail 执行完成 ===");
}

export function closeModal() {
  document.getElementById("file-detail-modal").classList.add("hidden");
  currentDetailFile = null;
}
