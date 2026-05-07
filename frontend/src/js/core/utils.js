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
        <span class="btn-icon">📦</span>
        <span class="btn-text">转移</span>
      </button>
    `;
  } else {
    return `
      <button class="btn-small action-btn toggle-btn ${
        file.enabled ? "toggle-disable" : "toggle-enable"
      }" data-file-path="${file.path}" data-action="toggle">
        <span class="btn-icon">${file.enabled ? "⛔" : "✅"}</span>
        <span class="btn-text">${file.enabled ? "禁用" : "启用"}</span>
      </button>
    `;
  }
}

export function getLocationIcon(location) {
  const icons = {
    root: "📁",
    workshop: "🔧",
    disabled: "🚫",
  };
  return icons[location] || "📄";
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
    tags.push(`<span class="tag primary-tag">${primaryTag}</span>`);
  }

  if (secondaryTags && secondaryTags.length > 0) {
    secondaryTags.slice(0, 2).forEach((tag) => {
      tags.push(`<span class="tag secondary-tag">${tag}</span>`);
    });

    if (secondaryTags.length > 2) {
      tags.push(
        `<span class="tag more-tags">+${secondaryTags.length - 2}</span>`
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
