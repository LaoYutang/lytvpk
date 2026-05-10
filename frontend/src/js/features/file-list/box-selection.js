import { appState, toggleFileSelection, updateStatusBar } from "../state.js";
import { getConfig } from "../../core/config.js";

// 最小拖动距离阈值（像素）
const DRAG_THRESHOLD = 5;

// 框选状态
const boxState = {
  isSelecting: false,
  hasStarted: false, // 是否已超过阈值开始框选
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
  containerRect: null,
  scrollOffset: 0,
  itemsInBox: new Set(),
  originalSelectedFiles: new Set(), // 记录开始框选前的选择状态
};

let selectionBoxEl = null;
let fileListContainer = null;

/**
 * 初始化框选功能 - 在应用加载时调用
 */
export function initBoxSelection() {
  selectionBoxEl = document.getElementById("selection-box");
  fileListContainer = document.querySelector(".file-list-container");

  if (!fileListContainer || !selectionBoxEl) {
    console.warn("框选初始化失败：找不到必要的元素");
    return;
  }

  // 使用事件捕获来确保能够阻止后续事件
  fileListContainer.addEventListener("mousedown", handleMouseDown, { capture: true });
  fileListContainer.addEventListener("mousemove", handleMouseMove);
  fileListContainer.addEventListener("mouseup", handleMouseUp);
  fileListContainer.addEventListener("mouseleave", handleMouseUp);

  // 滚动时取消选择
  fileListContainer.addEventListener("scroll", handleScroll);

  console.log("框选功能已初始化");
}

/**
 * 处理鼠标按下事件
 */
function handleMouseDown(e) {
  // 检查框选是否启用
  const config = getConfig();
  if (!config.boxSelectionEnabled && !appState.boxSelectionEnabled) {
    return;
  }

  // 排除交互元素：菜单、筛选框、checkbox、按钮、下拉菜单等
  const excludedSelectors = [
    ".dropdown-content",
    ".filter-bar",
    ".file-list-header",
    ".status-bar",
    ".file-checkbox",
    "button",
    "input",
    ".more-btn",
    ".action-btn",
    ".dropdown-item",
    "#file-list-loading",
    ".modal",
  ];

  if (e.target.closest(excludedSelectors.join(", "))) {
    return;
  }

  // 记录开始框选前的选择状态
  boxState.originalSelectedFiles = new Set(appState.selectedFiles);

  // 开始记录，但不立即显示选择框
  boxState.isSelecting = true;
  boxState.hasStarted = false;
  boxState.containerRect = fileListContainer.getBoundingClientRect();
  boxState.scrollOffset = fileListContainer.scrollTop;
  boxState.startX = e.clientX - boxState.containerRect.left;
  boxState.startY = e.clientY - boxState.containerRect.top + boxState.scrollOffset;
  boxState.currentX = boxState.startX;
  boxState.currentY = boxState.startY;
  boxState.itemsInBox.clear();

  // 阻止文本选择
  e.preventDefault();
}

/**
 * 处理鼠标移动事件
 */
function handleMouseMove(e) {
  if (!boxState.isSelecting) return;

  boxState.currentX = e.clientX - boxState.containerRect.left;
  boxState.currentY = e.clientY - boxState.containerRect.top + fileListContainer.scrollTop;

  // 检查是否超过阈值
  const dx = Math.abs(boxState.currentX - boxState.startX);
  const dy = Math.abs(boxState.currentY - boxState.startY);

  if (!boxState.hasStarted && (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD)) {
    // 超过阈值，开始显示选择框
    boxState.hasStarted = true;
    selectionBoxEl.classList.remove("hidden");
  }

  if (boxState.hasStarted) {
    updateBoxPosition();
    updateItemsInBox();
  }
}

/**
 * 处理鼠标松开事件
 */
function handleMouseUp(e) {
  if (!boxState.isSelecting) return;

  const wasStarted = boxState.hasStarted;
  boxState.isSelecting = false;
  boxState.hasStarted = false;

  if (wasStarted) {
    // 有框选行为，应用选择
    selectionBoxEl.classList.add("hidden");

    // 将框选中的文件添加到 selectedFiles（保留原有选择）
    boxState.itemsInBox.forEach((filePath) => {
      toggleFileSelection(filePath, true);
    });

    updateAllCheckboxes();
    clearBoxHighlights();
    updateStatusBar();
  }

  boxState.itemsInBox.clear();
  boxState.originalSelectedFiles.clear();
}

/**
 * 处理滚动事件 - 取消当前选择
 */
function handleScroll() {
  if (boxState.isSelecting && boxState.hasStarted) {
    // 滚动时取消选择，恢复原始选择状态
    boxState.isSelecting = false;
    boxState.hasStarted = false;
    selectionBoxEl.classList.add("hidden");
    boxState.itemsInBox.clear();
    clearBoxHighlights();

    // 恢复原始选择状态
    appState.selectedFiles = new Set(boxState.originalSelectedFiles);
    updateAllCheckboxes();
    updateStatusBar();
    boxState.originalSelectedFiles.clear();
  }
}

/**
 * 更新选择框位置和大小
 */
function updateBoxPosition() {
  const left = Math.min(boxState.startX, boxState.currentX);
  const top = Math.min(boxState.startY, boxState.currentY);
  const width = Math.abs(boxState.currentX - boxState.startX);
  const height = Math.abs(boxState.currentY - boxState.startY);

  selectionBoxEl.style.left = `${left}px`;
  selectionBoxEl.style.top = `${top}px`;
  selectionBoxEl.style.width = `${width}px`;
  selectionBoxEl.style.height = `${height}px`;
}

/**
 * 更新框选中的文件项
 */
function updateItemsInBox() {
  const boxLeft = parseFloat(selectionBoxEl.style.left) || 0;
  const boxTop = parseFloat(selectionBoxEl.style.top) || 0;
  const boxWidth = parseFloat(selectionBoxEl.style.width) || 0;
  const boxHeight = parseFloat(selectionBoxEl.style.height) || 0;

  const items = document.querySelectorAll(".file-item, .file-card");
  const newItemsInBox = new Set();

  items.forEach((item) => {
    const itemRect = item.getBoundingClientRect();
    const itemLeft = itemRect.left - boxState.containerRect.left;
    const itemTop = itemRect.top - boxState.containerRect.top + fileListContainer.scrollTop;

    // 检测交集
    const intersects =
      itemLeft < boxLeft + boxWidth &&
      itemLeft + itemRect.width > boxLeft &&
      itemTop < boxTop + boxHeight &&
      itemTop + itemRect.height > boxTop;

    const filePath = item.dataset.path;

    if (intersects && filePath) {
      newItemsInBox.add(filePath);
      item.classList.add("box-selected");

      // 实时更新 checkbox 视觉状态
      const checkbox = item.querySelector(".file-checkbox");
      if (checkbox) checkbox.checked = true;
    } else {
      item.classList.remove("box-selected");

      // 未框选的文件：如果原本就选中则保持选中，否则取消选中
      const checkbox = item.querySelector(".file-checkbox");
      if (checkbox && filePath) {
        checkbox.checked = boxState.originalSelectedFiles.has(filePath);
      }
    }
  });

  boxState.itemsInBox = newItemsInBox;
}

/**
 * 更新所有 checkbox 的状态以匹配 appState
 */
function updateAllCheckboxes(checkedOverride = null) {
  const checkboxes = document.querySelectorAll(".file-checkbox");
  checkboxes.forEach((checkbox) => {
    const item = checkbox.closest(".file-item, .file-card");
    if (item && item.dataset.path) {
      if (checkedOverride !== null) {
        checkbox.checked = checkedOverride || appState.selectedFiles.has(item.dataset.path);
      } else {
        checkbox.checked = appState.selectedFiles.has(item.dataset.path);
      }
    }
  });
}

/**
 * 清除所有框选高亮样式
 */
function clearBoxHighlights() {
  document.querySelectorAll(".file-item.box-selected, .file-card.box-selected").forEach((item) => {
    item.classList.remove("box-selected");
  });
}

/**
 * 重置框选状态 - 在刷新文件列表或切换目录时调用
 */
export function resetBoxSelection() {
  if (boxState.isSelecting) {
    boxState.isSelecting = false;
    boxState.hasStarted = false;
    selectionBoxEl?.classList.add("hidden");
    boxState.itemsInBox.clear();
    clearBoxHighlights();
  }
}