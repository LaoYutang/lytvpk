import { showError, showInfo } from "../../core/toast.js";
import { escapeHtml } from "../../core/utils.js";
import { showConfirmModal } from "../modals/confirm.js";
import {
  GetWorkshopHistory,
  AddWorkshopHistoryEntries,
  ClearWorkshopHistory,
} from "../../../../wailsjs/go/app/App";

let historyItems = [];
let selectHandler = null;

function getTrigger() {
  return document.getElementById("workshop-history-btn");
}

function getMenu() {
  return document.getElementById("workshop-history-menu");
}

function isMenuOpen() {
  return !getMenu()?.classList.contains("hidden");
}

function setMenuOpen(open) {
  const trigger = getTrigger();
  const menu = getMenu();
  if (!trigger || !menu) return;

  menu.classList.toggle("hidden", !open);
  trigger.classList.toggle("active", open);
  trigger.setAttribute("aria-expanded", String(open));
}

export function closeWorkshopHistory() {
  setMenuOpen(false);
}

function normalizeHistoryItems(items) {
  if (!Array.isArray(items)) return [];

  return items
    .filter(
      (item) => item && typeof item.rootId === "string" && item.rootId.trim() !== ""
    )
    .map((item) => ({
      rootId: item.rootId.trim(),
      title: typeof item.title === "string" ? item.title : "",
      fileType: Number(item.fileType) || 0,
      parsedAt: Number(item.parsedAt) || 0,
      group: item.group || null,
    }));
}

function renderHistoryList() {
  const listEl = document.getElementById("workshop-history-list");
  const emptyEl = document.getElementById("workshop-history-empty");
  if (!listEl) return;

  listEl.innerHTML = "";

  if (historyItems.length === 0) {
    emptyEl?.classList.remove("hidden");
    return;
  }

  emptyEl?.classList.add("hidden");

  historyItems.forEach((item) => {
    const label = item.title || `工坊 #${item.rootId}`;
    const row = document.createElement("div");
    row.className = "workshop-history-item";
    row.title = `${item.rootId} - ${label}`;
    row.innerHTML = `
      <span class="workshop-history-id">${escapeHtml(item.rootId)}</span>
      <span class="workshop-history-sep">-</span>
      <span class="workshop-history-title">${escapeHtml(label)}</span>
    `;
    row.addEventListener("click", () => selectHistoryItem(item));
    listEl.appendChild(row);
  });
}

function selectHistoryItem(item) {
  closeWorkshopHistory();

  const input = document.getElementById("workshop-url");
  if (input) {
    input.value = item.rootId;
  }

  if (item.group && selectHandler) {
    selectHandler(item);
    return;
  }

  // 快照缺失（旧数据）时退化为真实解析，复用解析按钮的既有绑定
  document.getElementById("check-workshop-btn")?.click();
}

async function loadHistory() {
  try {
    const storage = await GetWorkshopHistory();
    historyItems = normalizeHistoryItems(storage?.items);
    renderHistoryList();
  } catch (err) {
    console.error("读取解析历史失败:", err);
  }
}

// 解析成功后写入历史，失败不影响解析流程
export function recordWorkshopHistory(groups) {
  const items = (Array.isArray(groups) ? groups : [])
    .map((group) => ({
      rootId: String(group?.root_id || group?.main?.publishedfileid || "").trim(),
      title: typeof group?.main?.title === "string" ? group.main.title : "",
      fileType: Number(group?.main?.file_type) || 0,
      parsedAt: 0,
      group,
    }))
    .filter((item) => item.rootId !== "");

  if (items.length === 0) return;

  AddWorkshopHistoryEntries(items)
    .then((storage) => {
      historyItems = normalizeHistoryItems(storage?.items);
      renderHistoryList();
    })
    .catch((err) => {
      console.warn("写入解析历史失败:", err);
    });
}

function clearHistory() {
  showConfirmModal("清空解析历史", "确定要清空所有解析历史记录吗？", async () => {
    try {
      await ClearWorkshopHistory();
      historyItems = [];
      renderHistoryList();
      showInfo("解析历史已清空");
    } catch (err) {
      console.error("清空解析历史失败:", err);
      showError("清空解析历史失败: " + err);
    }
  });
}

export function setupWorkshopHistory({ onSelect } = {}) {
  selectHandler = typeof onSelect === "function" ? onSelect : null;

  const trigger = getTrigger();
  if (!trigger) return;

  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    const willOpen = !isMenuOpen();
    setMenuOpen(willOpen);
    if (willOpen) {
      void loadHistory();
    }
  });

  // 点击菜单外部关闭
  document.addEventListener("click", (event) => {
    if (
      !event.target.closest("#workshop-history-menu") &&
      !event.target.closest("#workshop-history-btn")
    ) {
      closeWorkshopHistory();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeWorkshopHistory();
    }
  });

  document
    .getElementById("workshop-history-clear")
    ?.addEventListener("click", () => {
      closeWorkshopHistory();
      clearHistory();
    });

  renderHistoryList();
}