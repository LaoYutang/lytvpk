import { showConfirmModal } from "../modals/confirm.js";
import { workshopDeps } from "./deps.js";
import { browserState } from "./state.js";
import { openWorkshopDetail } from "./detail.js";
import { getWorkshopPreviewImages } from "./detail-images.js";
import { formatNumber, getWorkshopItemId } from "./utils.js";

let watchLaterItems = [];

const WATCH_LATER_PLACEHOLDER_SVG = `
  <svg viewBox="0 0 160 90" aria-hidden="true">
    <rect x="1" y="1" width="158" height="88" rx="8"></rect>
    <g>
      <rect x="55" y="28" width="50" height="34" rx="4"></rect>
      <circle cx="70" cy="40" r="4"></circle>
      <path d="M58 58l17-15 10 9 8-7 10 13"></path>
    </g>
  </svg>
`;

export async function initWatchLaterStorage() {
  try {
    const storage = await workshopDeps.GetWorkshopWatchLaterStorage();
    watchLaterItems = normalizeWatchLaterItems(storage?.items);
    renderWatchLaterDrawer();
  } catch (err) {
    console.warn("稍后再看数据读取失败，已使用空列表:", err);
    watchLaterItems = [];
  }
}

export function getWatchLaterItems() {
  return normalizeWatchLaterItems(watchLaterItems);
}

export function saveWatchLaterItems(items) {
  watchLaterItems = normalizeWatchLaterItems(items);
  workshopDeps.SaveWorkshopWatchLaterStorage?.({ items: watchLaterItems }).catch((err) => {
    console.error("保存稍后再看数据失败:", err);
    workshopDeps.showError?.("保存稍后再看失败: " + err);
  });
  updateWatchLaterBadge();
}

function normalizeWatchLaterItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => item && item.publishedfileid)
    .map((item) => ({
      publishedfileid: String(item.publishedfileid),
      title: item.title || `工坊 #${item.publishedfileid}`,
      preview_url: item.preview_url || "",
      views: item.views || 0,
      subscriptions: item.subscriptions || 0,
      favorited: item.favorited || 0,
      file_type: item.file_type || 0,
      addedAt: item.addedAt || new Date().toISOString(),
    }))
    .sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
}

export function isInWatchLater(itemId) {
  if (!itemId) return false;
  return getWatchLaterItems().some((item) => item.publishedfileid === String(itemId));
}

export function createWatchLaterItem(detail) {
  const images = getWorkshopPreviewImages(detail);
  return {
    publishedfileid: getWorkshopItemId(detail),
    title: detail.title || `工坊 #${detail.publishedfileid}`,
    preview_url: images[0] || detail.preview_url || "",
    views: detail.views || 0,
    subscriptions: detail.subscriptions || 0,
    favorited: detail.favorited || 0,
    file_type: detail.file_type || 0,
    addedAt: new Date().toISOString(),
  };
}

function getFreshWatchLaterPreview(item) {
  const itemId = getWorkshopItemId(item);
  const listItem = browserState.data.find(
    (candidate) => getWorkshopItemId(candidate) === itemId
  );
  return listItem?.preview_url || item.preview_url || "";
}

export function toggleWatchLaterItem(detail) {
  const itemId = getWorkshopItemId(detail);
  if (!itemId) return false;

  const items = getWatchLaterItems();
  const exists = items.some((item) => item.publishedfileid === itemId);
  const nextItems = exists
    ? items.filter((item) => item.publishedfileid !== itemId)
    : [createWatchLaterItem(detail), ...items.filter((item) => item.publishedfileid !== itemId)];

  saveWatchLaterItems(nextItems);
  renderWatchLaterDrawer();

  if (exists) {
    workshopDeps.showNotification?.("已从稍后再看移除", "info");
    return false;
  }

  workshopDeps.showNotification?.("已添加到稍后再看", "success");
  return true;
}

function updateWatchLaterBadge() {
  const badge = document.getElementById("browser-watch-later-count");
  if (!badge) return;

  const count = getWatchLaterItems().length;
  badge.textContent = String(count);
  badge.classList.toggle("hidden", count === 0);
}

export function updateWatchLaterDetailButton(button, detail) {
  if (!button) return;

  const itemId = getWorkshopItemId(detail);
  if (button.dataset.workshopId && button.dataset.workshopId !== itemId) return;

  const active = isInWatchLater(itemId);
  button.classList.toggle("active", active);
  button.setAttribute("aria-pressed", active ? "true" : "false");
  button.querySelector(".watch-later-label").textContent = active
    ? "已加入稍后再看"
    : "添加到稍后再看";
}

function formatWatchLaterDate(value) {
  if (!value) return "刚刚";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return date.toLocaleDateString();
}

function openWatchLaterDrawer() {
  renderWatchLaterDrawer();
  document.getElementById("browser-watch-later-drawer-root")?.classList.add("is-open");
}

function closeWatchLaterDrawer() {
  document.getElementById("browser-watch-later-drawer-root")?.classList.remove("is-open");
}

export function renderWatchLaterDrawer() {
  const list = document.getElementById("browser-watch-later-list");
  const empty = document.getElementById("browser-watch-later-empty");
  const titleCount = document.getElementById("browser-watch-later-title-count");
  if (!list || !empty) return;

  const items = getWatchLaterItems();
  list.innerHTML = "";
  list.classList.toggle("hidden", items.length === 0);
  empty.classList.toggle("hidden", items.length > 0);
  if (titleCount) titleCount.textContent = String(items.length);

  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "watch-later-item";
    row.setAttribute("role", "button");
    row.tabIndex = 0;

    const thumb = document.createElement("div");
    thumb.className = "watch-later-thumb";
    thumb.innerHTML = WATCH_LATER_PLACEHOLDER_SVG;

    const imageUrl = getFreshWatchLaterPreview(item);
    if (imageUrl) {
      const img = document.createElement("img");
      img.src = imageUrl;
      img.alt = item.title;
      img.loading = "lazy";
      img.onload = () => {
        thumb.classList.add("is-loaded");
      };
      img.onerror = () => {
        img.remove();
        thumb.classList.remove("is-loaded");
      };
      thumb.appendChild(img);
    }

    const content = document.createElement("div");
    content.className = "watch-later-content";

    const title = document.createElement("div");
    title.className = "watch-later-item-title";
    title.textContent = item.title;

    const meta = document.createElement("div");
    meta.className = "watch-later-item-meta";
    meta.textContent = `ID ${item.publishedfileid} · ${formatWatchLaterDate(item.addedAt)} 加入`;

    const stats = document.createElement("div");
    stats.className = "watch-later-stats";
    stats.innerHTML = `
      <span>点击 ${formatNumber(item.views)}</span>
      <span>订阅 ${formatNumber(item.subscriptions)}</span>
      <span>收藏 ${formatNumber(item.favorited)}</span>
    `;

    content.append(title, meta, stats);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "watch-later-remove";
    removeBtn.textContent = "移除";
    removeBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      const nextItems = getWatchLaterItems().filter(
        (savedItem) => savedItem.publishedfileid !== item.publishedfileid
      );
      saveWatchLaterItems(nextItems);
      renderWatchLaterDrawer();
      updateWatchLaterDetailButton(
        document.getElementById("add-to-watch-later-btn"),
        { publishedfileid: item.publishedfileid }
      );
    });

    const openItem = () => {
      closeWatchLaterDrawer();
      openWorkshopDetail(item);
    };
    row.addEventListener("click", openItem);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openItem();
      }
    });

    row.append(thumb, content, removeBtn);
    list.appendChild(row);
  });

  updateWatchLaterBadge();
}

export function setupWatchLaterDrawerListeners() {
  document
    .getElementById("browser-watch-later-btn")
    ?.addEventListener("click", openWatchLaterDrawer);
  document
    .getElementById("browser-watch-later-close")
    ?.addEventListener("click", closeWatchLaterDrawer);
  document
    .getElementById("browser-watch-later-backdrop")
    ?.addEventListener("click", closeWatchLaterDrawer);
  document
    .getElementById("browser-watch-later-clear")
    ?.addEventListener("click", clearWatchLater);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeWatchLaterDrawer();
  });
  renderWatchLaterDrawer();
}

function clearWatchLater() {
  const items = getWatchLaterItems();
  if (items.length === 0) return;

  showConfirmModal(
    "确认清空",
    `确定要清空稍后再看列表吗？列表中有 ${items.length} 个物品，此操作不可撤销。`,
    () => {
      saveWatchLaterItems([]);
      renderWatchLaterDrawer();
      workshopDeps.showNotification?.("已清空稍后再看列表", "info");
    }
  );
}
