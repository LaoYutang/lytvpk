import { appState, toggleFileSelection } from "../state.js";
import {
  formatFileSize,
  getLocationDisplayName,
  getLocationIcon,
  getActionButton,
  formatTags,
} from "../../core/utils.js";
import { showFileDetail } from "../modals/detail.js";
import { GetVPKPreviewImage } from "../../../../wailsjs/go/app/App";

export function renderFileList() {
  const container = document.getElementById("file-list");
  const listHeader = document.querySelector(".file-list-header");
  const statusBar = document.querySelector(".status-bar");

  container.innerHTML = "";

  if (appState.displayMode === "card") {
    container.classList.add("file-list-grid");
    container.classList.remove("file-list");
    if (listHeader) listHeader.style.display = "none";
    if (statusBar) statusBar.style.display = "flex";

    appState.vpkFiles.forEach((file) => {
      container.appendChild(createFileCard(file));
    });
  } else {
    container.classList.add("file-list");
    container.classList.remove("file-list-grid");
    if (listHeader) listHeader.style.display = "grid";
    if (statusBar) statusBar.style.display = "flex";

    appState.vpkFiles.forEach((file) => {
      container.appendChild(createFileItem(file));
    });
  }
}

export function createFileItem(file) {
  const item = document.createElement("div");
  item.className = "file-item";
  item.dataset.path = file.path;

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "file-checkbox";
  checkbox.checked = appState.selectedFiles.has(file.path);
  checkbox.addEventListener("change", function () {
    toggleFileSelection(file.path, checkbox.checked);
  });

  const statusIcon = file.enabled ? "✅" : "❌";
  const locationIcon = getLocationIcon(file.location);
  const displayTitle = file.title || file.name;
  const isHidden = file.name.startsWith("_");
  const hideBtnText = isHidden ? "取消隐藏" : "隐藏";
  const hideBtnIcon = isHidden ? "👁️" : "👁️‍🗨️";

  const moreActionsHtml = `
    <div class="more-actions-dropdown">
      <button class="btn-small action-btn more-btn" title="更多操作">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
        </svg>
      </button>
      <div class="dropdown-content hidden">
        <button class="dropdown-item detail-btn" data-file-path="${file.path}">
          <span class="btn-icon">🔍</span> 详情
        </button>
        ${file.workshopId ? `
        <button class="dropdown-item workshop-btn" data-file-path="${file.path}" data-workshop-id="${file.workshopId}">
          <span class="btn-icon">🌐</span> 跳转工坊
        </button>
        ` : ""}
        <button class="dropdown-item hide-btn" data-file-path="${file.path}" data-action="hide">
          <span class="btn-icon">${hideBtnIcon}</span> ${hideBtnText}
        </button>
        <button class="dropdown-item set-tags-btn" data-file-path="${file.path}" data-action="set-tags">
          <span class="btn-icon">🏷️</span> 设置标签
        </button>
        <button class="dropdown-item rename-btn" data-file-path="${file.path}" data-action="rename">
          <span class="btn-icon">✏️</span> 重命名
        </button>
        <button class="dropdown-item load-order-btn" data-file-path="${file.path}" data-action="load-order">
          <span class="btn-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="10" y1="6" x2="21" y2="6"></line>
              <line x1="10" y1="12" x2="21" y2="12"></line>
              <line x1="10" y1="18" x2="21" y2="18"></line>
              <path d="M4 6h1v4"></path>
              <path d="M4 10h2"></path>
              <path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"></path>
            </svg>
          </span> 加载顺序
        </button>
        <button class="dropdown-item open-location-btn" data-file-path="${file.path}" data-action="open-location">
          <span class="btn-icon">📂</span> 位置
        </button>
        <button class="dropdown-item delete-btn" data-file-path="${file.path}" data-action="delete">
          <span class="btn-icon">🗑️</span> 删除
        </button>
      </div>
    </div>
  `;

  item.innerHTML = `
    <div class="file-checkbox-container"></div>
    <div class="file-name" title="${file.path}">
      <div class="file-title">${displayTitle}</div>
      <div class="file-filename">${file.name}</div>
    </div>
    <div class="file-size">${formatFileSize(file.size)}</div>
    <div class="file-status">${statusIcon} ${file.enabled ? "启用" : "禁用"}</div>
    <div class="file-location">${locationIcon} ${getLocationDisplayName(file.location)}</div>
    <div class="file-tags">${formatTags(file.primaryTag, file.secondaryTags)}</div>
    <div class="file-actions">
      <button class="btn-small action-btn detail-btn" data-file-path="${file.path}">
        <span class="btn-icon">🔍</span>
        <span class="btn-text">详情</span>
      </button>
      ${getActionButton(file)}
      ${moreActionsHtml}
    </div>
  `;

  item.querySelector(".file-checkbox-container").appendChild(checkbox);

  item.addEventListener("dblclick", function (e) {
    if (
      e.target.closest(".file-checkbox-container") ||
      e.target.closest(".file-actions") ||
      e.target.type === "checkbox" ||
      e.target.closest("button")
    ) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    showFileDetail(file.path);
  });

  return item;
}

export function createFileCard(file) {
  const card = document.createElement("div");
  card.className = "file-card";
  card.dataset.path = file.path;

  if (!file.enabled) {
    card.classList.add("disabled");
  }

  const displayTitle = file.title || file.name;
  const isHidden = file.name.startsWith("_");
  const hideBtnText = isHidden ? "取消隐藏" : "隐藏";
  const hideBtnIcon = isHidden ? "👁️" : "👁️‍🗨️";

  let previewSrc = "";
  let showPlaceholder = true;

  if (file.previewImage) {
    previewSrc = file.previewImage;
    showPlaceholder = false;
  }

  let secondaryTagsHtml = "";
  if (file.secondaryTags && file.secondaryTags.length > 0) {
    const displayTags = file.secondaryTags.slice(0, 2);
    const hasMore = file.secondaryTags.length > 2;

    secondaryTagsHtml = displayTags
      .map((tag) => `<span class="card-badge secondary-tag-badge">${tag}</span>`)
      .join("");

    if (hasMore) {
      secondaryTagsHtml += `<span class="card-badge more-tag-badge">+${file.secondaryTags.length - 2}</span>`;
    }
  }

  let actionBtn = "";
  if (file.location === "workshop") {
    actionBtn = `
      <button class="btn-small action-btn move-btn" data-file-path="${file.path}" data-action="move" title="转移到addons">
        <span class="btn-icon">📦</span>
        <span class="btn-text">转移</span>
      </button>
    `;
  } else {
    actionBtn = `
      <button class="btn-small action-btn toggle-btn ${file.enabled ? "toggle-disable" : "toggle-enable"}"
              data-file-path="${file.path}" data-action="toggle"
              title="${file.enabled ? "点击禁用" : "点击启用"}">
        <span class="btn-icon">${file.enabled ? "⛔" : "✅"}</span>
        <span class="btn-text">${file.enabled ? "禁用" : "启用"}</span>
      </button>
    `;
  }

  const moreActionsHtml = `
    <div class="more-actions-dropdown">
      <button class="btn-small action-btn more-btn" title="更多操作">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
        </svg>
      </button>
      <div class="dropdown-content hidden">
        <button class="dropdown-item detail-btn" data-file-path="${file.path}">
          <span class="btn-icon">🔍</span> 详情
        </button>
        ${file.workshopId ? `
        <button class="dropdown-item workshop-btn" data-file-path="${file.path}" data-workshop-id="${file.workshopId}">
          <span class="btn-icon">🌐</span> 跳转工坊
        </button>
        ` : ""}
        <button class="dropdown-item hide-btn" data-file-path="${file.path}" data-action="hide">
          <span class="btn-icon">${hideBtnIcon}</span> ${hideBtnText}
        </button>
        <button class="dropdown-item set-tags-btn" data-file-path="${file.path}" data-action="set-tags">
          <span class="btn-icon">🏷️</span> 设置标签
        </button>
        <button class="dropdown-item rename-btn" data-file-path="${file.path}" data-action="rename">
          <span class="btn-icon">✏️</span> 重命名
        </button>
        <button class="dropdown-item load-order-btn" data-file-path="${file.path}" data-action="load-order">
          <span class="btn-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="10" y1="6" x2="21" y2="6"></line>
              <line x1="10" y1="12" x2="21" y2="12"></line>
              <line x1="10" y1="18" x2="21" y2="18"></line>
              <path d="M4 6h1v4"></path>
              <path d="M4 10h2"></path>
              <path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"></path>
            </svg>
          </span> 加载顺序
        </button>
        <button class="dropdown-item open-location-btn" data-file-path="${file.path}" data-action="open-location">
          <span class="btn-icon">📂</span> 位置
        </button>
        <button class="dropdown-item delete-btn" data-file-path="${file.path}" data-action="delete">
          <span class="btn-icon">🗑️</span> 删除
        </button>
      </div>
    </div>
  `;

  card.innerHTML = `
    <div class="card-preview-container">
      <div class="card-preview-placeholder ${showPlaceholder ? "" : "hidden"}">
        <svg class="icon-svg placeholder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          <circle cx="8.5" cy="8.5" r="1.5"></circle>
          <polyline points="21 15 16 10 5 21"></polyline>
        </svg>
      </div>
      <img class="card-preview-img ${showPlaceholder ? "hidden" : ""}" src="${previewSrc}" alt="${displayTitle}" loading="lazy" />
      <div class="card-checkbox-container"></div>
      <div class="card-badges">
        <span class="card-badge location-badge">${getLocationDisplayName(file.location)}</span>
        ${file.primaryTag ? `<span class="card-badge tag-badge">${file.primaryTag}</span>` : ""}
        ${secondaryTagsHtml}
      </div>
    </div>
    <div class="card-content">
      <div class="card-title" title="${displayTitle}">${displayTitle}</div>
      <div class="card-filename" title="${file.name}">${file.name}</div>
      <div class="card-actions">
        ${actionBtn}
        ${moreActionsHtml}
      </div>
    </div>
  `;

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "file-checkbox card-checkbox";
  checkbox.checked = appState.selectedFiles.has(file.path);
  checkbox.addEventListener("change", function () {
    toggleFileSelection(file.path, checkbox.checked);
  });
  const checkboxContainer = card.querySelector(".card-checkbox-container");
  checkboxContainer.appendChild(checkbox);
  checkboxContainer.addEventListener("click", function (e) {
    e.stopPropagation();
  });

  const img = card.querySelector(".card-preview-img");
  const placeholder = card.querySelector(".card-preview-placeholder");

  if (!file.previewImage) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          loadCardPreview(file, img, placeholder);
          observer.unobserve(entry.target);
        }
      });
    });
    observer.observe(card);
  }

  card.addEventListener("click", function (e) {
    if (
      e.target.closest("button") ||
      e.target.closest(".more-actions-dropdown") ||
      e.target.closest(".card-checkbox-container")
    ) {
      return;
    }
    showFileDetail(file.path);
  });

  return card;
}

export async function loadCardPreview(file, imgElement, placeholderElement) {
  try {
    const imgData = await GetVPKPreviewImage(file.path);
    if (imgData) {
      imgElement.src = imgData;
      imgElement.classList.remove("hidden");
      placeholderElement.classList.add("hidden");
      file.previewImage = imgData;
    }
  } catch (err) {
    console.warn("加载预览图失败:", file.name);
  }
}
