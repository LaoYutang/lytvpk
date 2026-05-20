import { WORKSHOP_COLLECTION_FILE_TYPE } from "./state.js";

export function getWorkshopItemId(item) {
  return String(item?.publishedfileid || "");
}

export function isWorkshopCollection(item) {
  return Number(item?.file_type) === WORKSHOP_COLLECTION_FILE_TYPE;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function formatWorkshopDate(value) {
  if (!value) return "N/A";
  const rawValue = Number(value);
  const date = Number.isFinite(rawValue)
    ? new Date(rawValue * 1000)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? "N/A" : date.toLocaleDateString();
}

export function formatNumber(num) {
  if (!num) return "0";
  if (num > 10000) return (num / 10000).toFixed(1) + "w";
  if (num > 1000) return (num / 1000).toFixed(1) + "k";
  return num;
}

export function formatSize(bytes) {
  if (!bytes) return "N/A";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + " MB";
  return (bytes / 1073741824).toFixed(1) + " GB";
}

export function renderWorkshopLoading(
  message = "正在加载创意工坊列表...",
  hint = ""
) {
  const hintHtml = hint ? `<span class="workshop-loading-hint">${hint}</span>` : "";

  return `
    <div class="file-list-loading-content workshop-loading-card">
      <div class="file-list-loading-spinner"></div>
      <p>${message}</p>
      ${hintHtml}
    </div>
  `;
}
