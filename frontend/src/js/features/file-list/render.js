import { appState, toggleFileSelection } from "../state.js";
import {
  formatFileSize,
  getLocationDisplayName,
  getActionButton,
  formatTags,
  escapeHtml,
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

  const displayTitle = file.title || file.name;
  const isHidden = file.name.startsWith("_");
  const hideBtnText = isHidden ? "取消隐藏" : "隐藏";
  const hideBtnIcon = isHidden ? iconSvg("eye") : iconSvg("eyeOff");
  const locationBadgeClass = `location-${file.location || "unknown"}`;
  const hasUpdate = file.hasUpdate;

  const updateTagHtml = hasUpdate
    ? `<span class="update-available-tag" data-workshop-id="${file.workshopId}" title="点击更新此Mod">待更新</span>`
    : "";

  // 列表模式：更新标签放在文件名后面

  const moreActionsHtml = `
    <div class="more-actions-dropdown">
      <button class="btn-small action-btn more-btn" title="更多操作">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
        </svg>
      </button>
      <div class="dropdown-content hidden">
        <button class="dropdown-item detail-btn" data-file-path="${file.path}">
          <span class="btn-icon">${iconSvg("info")}</span> 详情
        </button>
        ${file.workshopId ? `
        <button class="dropdown-item workshop-btn" data-file-path="${file.path}" data-workshop-id="${file.workshopId}">
          <span class="btn-icon">${iconSvg("external")}</span> 跳转工坊
        </button>
        ` : ""}
        <button class="dropdown-item hide-btn" data-file-path="${file.path}" data-action="hide">
          <span class="btn-icon">${hideBtnIcon}</span> ${hideBtnText}
        </button>
        <button class="dropdown-item set-tags-btn" data-file-path="${file.path}" data-action="set-tags">
          <span class="btn-icon">${iconSvg("tag")}</span> 设置标签
        </button>
        <button class="dropdown-item rename-btn" data-file-path="${file.path}" data-action="rename">
          <span class="btn-icon">${iconSvg("edit")}</span> 重命名
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
          <span class="btn-icon">${iconSvg("folderOpen")}</span> 位置
        </button>
        <button class="dropdown-item delete-btn" data-file-path="${file.path}" data-action="delete">
          <span class="btn-icon">${iconSvg("trash")}</span> 删除
        </button>
      </div>
    </div>
  `;

  item.innerHTML = `
    <div class="file-checkbox-container"></div>
    <div class="file-name" title="${file.path}">
      <div class="file-title">${displayTitle}</div>
      <div class="file-filename">${file.name}${updateTagHtml}</div>
    </div>
    <div class="file-size">${formatFileSize(file.size)}</div>
    <div class="file-location">
      <span class="location-state-tag ${locationBadgeClass}">
        ${getLocationSvg(file.location)}
        <span>${getLocationDisplayName(file.location)}</span>
      </span>
    </div>
    <div class="file-tags">${formatTags(file.primaryTag, file.secondaryTags)}</div>
    <div class="file-actions">
      <button class="btn-small action-btn detail-btn" data-file-path="${file.path}">
        <span class="btn-icon">${iconSvg("info")}</span>
        <span class="btn-text">详情</span>
      </button>
      ${getActionButton(file)}
      ${moreActionsHtml}
    </div>
  `;

  item.querySelector(".file-checkbox-container").appendChild(checkbox);

  item.addEventListener("click", function (e) {
    if (
      e.target.closest(".file-checkbox-container") ||
      e.target.closest(".file-actions") ||
      e.target.type === "checkbox" ||
      e.target.closest("button")
    ) {
      return;
    }

    if (e.ctrlKey && appState.ctrlClickSelectionEnabled) {
      e.preventDefault();
      e.stopPropagation();
      const newChecked = !checkbox.checked;
      checkbox.checked = newChecked;
      toggleFileSelection(file.path, newChecked);
    }
  });

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
  const hideBtnIcon = isHidden ? iconSvg("eye") : iconSvg("eyeOff");
  const hasUpdate = file.hasUpdate;

  const updateBtnHtml = hasUpdate
    ? `<button class="btn-small action-btn update-btn" data-workshop-id="${file.workshopId}" title="点击更新此Mod">
        <span class="btn-icon">
          <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
        </span>
        <span class="btn-text">待更新</span>
      </button>`
    : "";

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
      .map((tag) => {
        const longTagClass = tag.length > 16 ? " is-long" : "";
        return `<span class="card-badge secondary-tag-badge${longTagClass}" title="${escapeHtml(tag)}">${escapeHtml(tag)}</span>`;
      })
      .join("");

    if (hasMore) {
      secondaryTagsHtml += `<span class="card-badge more-tag-badge" title="${file.secondaryTags
        .slice(2)
        .map(escapeHtml)
        .join(", ")}">+${file.secondaryTags.length - 2}</span>`;
    }
  }

  let actionBtn = "";
  if (file.location === "workshop") {
    actionBtn = `
      <button class="btn-small action-btn move-btn" data-file-path="${file.path}" data-action="move" title="转移到addons">
        <span class="btn-icon">${iconSvg("package")}</span>
        <span class="btn-text">转移</span>
      </button>
    `;
  } else {
    actionBtn = `
      <button class="btn-small action-btn toggle-btn ${file.enabled ? "toggle-disable" : "toggle-enable"}"
              data-file-path="${file.path}" data-action="toggle"
              title="${file.enabled ? "点击禁用" : "点击启用"}">
        <span class="btn-icon">${iconSvg("power")}</span>
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
          <span class="btn-icon">${iconSvg("info")}</span> 详情
        </button>
        ${file.workshopId ? `
        <button class="dropdown-item workshop-btn" data-file-path="${file.path}" data-workshop-id="${file.workshopId}">
          <span class="btn-icon">${iconSvg("external")}</span> 跳转工坊
        </button>
        ` : ""}
        <button class="dropdown-item hide-btn" data-file-path="${file.path}" data-action="hide">
          <span class="btn-icon">${hideBtnIcon}</span> ${hideBtnText}
        </button>
        <button class="dropdown-item set-tags-btn" data-file-path="${file.path}" data-action="set-tags">
          <span class="btn-icon">${iconSvg("tag")}</span> 设置标签
        </button>
        <button class="dropdown-item rename-btn" data-file-path="${file.path}" data-action="rename">
          <span class="btn-icon">${iconSvg("edit")}</span> 重命名
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
          <span class="btn-icon">${iconSvg("folderOpen")}</span> 位置
        </button>
        <button class="dropdown-item delete-btn" data-file-path="${file.path}" data-action="delete">
          <span class="btn-icon">${iconSvg("trash")}</span> 删除
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
        ${
          file.primaryTag
            ? `<span class="card-badge tag-badge" title="${escapeHtml(file.primaryTag)}">${escapeHtml(file.primaryTag)}</span>`
            : ""
        }
        ${secondaryTagsHtml}
      </div>
    </div>
    <div class="card-content">
      <div class="card-title" title="${displayTitle}">${displayTitle}</div>
      <div class="card-filename" title="${file.name}">${file.name}</div>
      <div class="card-actions">
        <div class="card-actions-left">
          ${actionBtn}
          ${updateBtnHtml}
        </div>
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

    if (e.ctrlKey && appState.ctrlClickSelectionEnabled) {
      e.preventDefault();
      e.stopPropagation();
      const newChecked = !checkbox.checked;
      checkbox.checked = newChecked;
      toggleFileSelection(file.path, newChecked);
      return;
    }

    showFileDetail(file.path);
  });

  return card;
}

export function iconSvg(name) {
  const icons = {
    search: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>`,
    info: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 11v5"></path><path d="M12 8h.01"></path></svg>`,
    external: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"></path><path d="M10 14 21 3"></path><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"></path></svg>`,
    eye: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle></svg>`,
    eyeOff: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 3 18 18"></path><path d="M10.6 10.6A2 2 0 0 0 13.4 13.4"></path><path d="M9.9 4.2A10.4 10.4 0 0 1 12 4c6.5 0 10 8 10 8a18 18 0 0 1-2.2 3.2"></path><path d="M6.6 6.6C3.6 8.6 2 12 2 12s3.5 8 10 8a10.6 10.6 0 0 0 4.1-.8"></path></svg>`,
    tag: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"></path><circle cx="7.5" cy="7.5" r=".8"></circle></svg>`,
    edit: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>`,
    folderOpen: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 14 8 8h13l-2 8a2 2 0 0 1-2 1.5H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 2h4"></path></svg>`,
    trash: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="m19 6-1 14H6L5 6"></path><path d="M10 11v5"></path><path d="M14 11v5"></path></svg>`,
    package: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"></path><path d="m3.3 7 8.7 5 8.7-5"></path><path d="M12 22V12"></path></svg>`,
    power: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v10"></path><path d="M18.4 6.6a9 9 0 1 1-12.8 0"></path></svg>`,
    check: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>`,
    x: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>`,
  };
  return icons[name] || "";
}

export function getLocationSvg(location) {
  if (location === "workshop") {
    return `<svg class="location-tag-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"></path><path d="M5 7l1-3h12l1 3"></path><path d="M6 7v12h12V7"></path><path d="M9 11h6"></path></svg>`;
  }
  if (location === "disabled") {
    return `<svg class="location-tag-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="m5.7 5.7 12.6 12.6"></path></svg>`;
  }
  return `<svg class="location-tag-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7h7l2 2h9v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"></path><path d="M3 7V5a2 2 0 0 1 2-2h4l2 2h4"></path></svg>`;
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
