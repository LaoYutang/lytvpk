export function getLocationDisplayName(tag) {
  const displayNames = {
    root: "根目录",
    workshop: "创意工坊",
    disabled: "已禁用",
  };
  return displayNames[tag] || tag;
}

export function getActionButton(file) {
  if (file.location === "workshop") {
    return `
      <button class="btn-small action-btn move-btn" data-file-path="${file.path}" data-action="move">
        <span class="btn-icon">
          <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"></path>
            <path d="m3.3 7 8.7 5 8.7-5"></path>
            <path d="M12 22V12"></path>
          </svg>
        </span>
        <span class="btn-text">转移</span>
      </button>
    `;
  } else {
    return `
      <button class="btn-small action-btn toggle-btn ${
        file.enabled ? "toggle-disable" : "toggle-enable"
      }" data-file-path="${file.path}" data-action="toggle">
        <span class="btn-icon">
          <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 2v10"></path>
            <path d="M18.4 6.6a9 9 0 1 1-12.8 0"></path>
          </svg>
        </span>
        <span class="btn-text">${file.enabled ? "禁用" : "启用"}</span>
      </button>
    `;
  }
}

export function formatFileSize(bytes) {
  if (bytes === 0) return "0 B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export function formatTags(primaryTag, secondaryTags = []) {
  const tags = [];

  if (primaryTag) {
    tags.push(
      `<span class="tag primary-tag" title="${escapeHtml(primaryTag)}">${escapeHtml(primaryTag)}</span>`
    );
  }

  if (secondaryTags && secondaryTags.length > 0) {
    secondaryTags.slice(0, 2).forEach((tag) => {
      tags.push(
        `<span class="tag secondary-tag" title="${escapeHtml(tag)}">${escapeHtml(tag)}</span>`
      );
    });

    if (secondaryTags.length > 2) {
      tags.push(
        `<span class="tag more-tags" title="${secondaryTags
          .slice(2)
          .map(escapeHtml)
          .join(", ")}">+${secondaryTags.length - 2}</span>`
      );
    }
  }

  return tags.join("");
}

export function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
