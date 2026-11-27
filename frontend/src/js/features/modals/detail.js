import { appState } from "../state.js";
import { createTextElement, formatFileSize, getLocationDisplayName } from "../../core/utils.js";
import { GetVPKPreviewImage, ParseWorkshopID } from "../../../../wailsjs/go/app/App";
import { handleProtocolWorkshop } from "../workshop/workshop-browser.js";

let currentDetailFile = null;
let detailOpener = null;

export function showFileDetail(filePath, opener = null) {
  const file =
    appState.vpkFiles.find((f) => f.path === filePath) ??
    appState.allVpkFiles.find((f) => f.path === filePath);
  if (!file) return false;

  const modal = document.getElementById("file-detail-modal");
  if (!modal) return false;
  currentDetailFile = file;
  detailOpener = opener;

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
        if (currentDetailFile !== file) return;
        if (imgData) {
          previewImage.src = imgData;
          previewImage.style.display = "block";
        } else {
          previewSection.classList.add("hidden");
        }
      })
      .catch((err) => {
        if (currentDetailFile !== file) return;
        console.error("加载预览图失败:", err);
        previewSection.classList.add("hidden");
      });
  }

  const tagsContainer = document.getElementById("detail-tags");
  tagsContainer.replaceChildren();
  if (file.primaryTag) {
    tagsContainer.appendChild(createTextElement("span", "tag primary-tag", file.primaryTag));
  }

  const detailTagsContainer = document.getElementById("detail-detail-tags");
  detailTagsContainer.replaceChildren();
  for (const tag of file.secondaryTags || []) {
    detailTagsContainer.appendChild(createTextElement("span", "tag secondary-tag", tag));
  }

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

    if (currentDetailFile === file && workshopId) {
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
    chaptersListElement.replaceChildren();
    for (const [code, chapter] of Object.entries(file.chapters || {})) {
      const item = document.createElement("div");
      item.className = "chapter-item";
      const header = document.createElement("div");
      header.className = "chapter-header";
      header.append(
        createTextElement("div", "chapter-name", chapter.title || code),
        createTextElement("div", "chapter-code", code)
      );
      const modes = chapter.modes?.length ? chapter.modes.join(" | ") : "未知模式";
      item.append(header, createTextElement("div", "chapter-modes", modes));
      chaptersListElement.appendChild(item);
    }
    if (!chaptersListElement.childElementCount) {
      chaptersListElement.appendChild(createTextElement("div", "no-chapters", "无章节信息"));
    }
  } else {
    mapInfoSection.classList.add("hidden");
  }

  modal.classList.remove("hidden");
  if (opener) {
    document.getElementById("conflict-modal").inert = true;
    modal.setAttribute("aria-modal", "true");
    document.addEventListener("keydown", handleConflictDetailKeydown, true);
    document.getElementById("close-modal-header-btn").focus({ preventScroll: true });
  }

  setTimeout(() => {
    const modalContent = modal.querySelector(".modal-content");
    const modalBody = modal.querySelector(".modal-body");
    if (modalContent) modalContent.scrollTop = 0;
    if (modalBody) modalBody.scrollTop = 0;
  }, 0);
  return true;
}

function handleConflictDetailKeydown(event) {
  if (event.key !== "Escape" && event.key !== "Tab") return;
  const modal = document.getElementById("file-detail-modal");
  // 退出确认等提示可能临时盖在详情上，此时由最上层处理按键。
  const topElement = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
  if (!modal.contains(topElement)) return;

  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) closeModal();
    return;
  }

  const controls = Array.from(modal.querySelectorAll("button:enabled, a[href]"))
    .filter((element) => element.getClientRects().length > 0);
  const first = controls[0];
  const last = controls[controls.length - 1];
  const active = document.activeElement;
  if (!modal.contains(active) || active === (event.shiftKey ? first : last)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus({ preventScroll: true });
  }
}

export function closeModal() {
  const modal = document.getElementById("file-detail-modal");
  modal.classList.add("hidden");
  currentDetailFile = null;
  if (detailOpener) {
    document.removeEventListener("keydown", handleConflictDetailKeydown, true);
    modal.removeAttribute("aria-modal");
    document.getElementById("conflict-modal").inert = false;
    detailOpener.focus({ preventScroll: true });
    detailOpener = null;
  }
}
