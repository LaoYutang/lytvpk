import { appState } from "../state.js";
import { showError, showNotification } from "../../core/toast.js";
import {
  GetAddonListOrderInfo,
  SetAddonListOrder,
} from "../../../../wailsjs/go/app/App";
import { applySort, refreshLoadOrderMap } from "../file-list/sorting.js";
import { renderFileList } from "../file-list/render.js";

const SVG_NS = "http://www.w3.org/2000/svg";

const LOCATION_LABELS = {
  root: "addons",
  workshop: "工坊",
};

const ICON_SHAPES = {
  grip: [
    { tag: "circle", attrs: { cx: "9", cy: "6", r: "1" } },
    { tag: "circle", attrs: { cx: "9", cy: "12", r: "1" } },
    { tag: "circle", attrs: { cx: "9", cy: "18", r: "1" } },
    { tag: "circle", attrs: { cx: "15", cy: "6", r: "1" } },
    { tag: "circle", attrs: { cx: "15", cy: "12", r: "1" } },
    { tag: "circle", attrs: { cx: "15", cy: "18", r: "1" } },
  ],
  toTop: [
    { tag: "path", attrs: { d: "M5 3h14" } },
    { tag: "path", attrs: { d: "m18 13-6-6-6 6" } },
    { tag: "path", attrs: { d: "M12 7v14" } },
  ],
  toBottom: [
    { tag: "path", attrs: { d: "M12 17V3" } },
    { tag: "path", attrs: { d: "m6 11 6 6 6-6" } },
    { tag: "path", attrs: { d: "M19 21H5" } },
  ],
  setIndex: [
    { tag: "path", attrs: { d: "M4 9h16" } },
    { tag: "path", attrs: { d: "M4 15h16" } },
    { tag: "path", attrs: { d: "M10 3 8 21" } },
    { tag: "path", attrs: { d: "M16 3 14 21" } },
  ],
};

let workingOrder = [];
let focusedName = "";
let dragState = null;
let autoScrollFrame = 0;
let indexPopoverTarget = -1;
let isSaving = false;

const AUTO_SCROLL_EDGE = 28;
const AUTO_SCROLL_STEP = 8;
const DRAG_START_THRESHOLD = 4;

function byId(id) {
  return document.getElementById(id);
}

function createSvgIcon(shapes) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "icon-svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");

  shapes.forEach((shape) => {
    const node = document.createElementNS(SVG_NS, shape.tag);
    Object.entries(shape.attrs).forEach(([key, value]) => {
      node.setAttribute(key, value);
    });
    svg.appendChild(node);
  });

  return svg;
}

// 只列出会参与加载的 VPK：addons 根目录与 workshop，disabled 不参与排序
function buildEditorEntries() {
  const byName = new Map();
  const candidates = appState.allVpkFiles
    .filter((file) => file.location === "root" || file.location === "workshop")
    .sort((a, b) => (a.location === "root" ? 0 : 1) - (b.location === "root" ? 0 : 1));

  candidates.forEach((file) => {
    const key = String(file.name || "").toLowerCase();
    if (!key || byName.has(key)) return;

    byName.set(key, {
      name: file.name,
      title: file.title || file.name,
      location: file.location,
    });
  });

  return Array.from(byName.values());
}

function orderEditorEntries(entries, orderNames) {
  const position = new Map();
  orderNames.forEach((name, index) => {
    const key = String(name || "").toLowerCase();
    if (key && !position.has(key)) {
      position.set(key, index);
    }
  });

  const known = [];
  const rest = [];

  entries.forEach((entry) => {
    if (position.has(entry.name.toLowerCase())) {
      known.push(entry);
    } else {
      rest.push(entry);
    }
  });

  known.sort(
    (a, b) => position.get(a.name.toLowerCase()) - position.get(b.name.toLowerCase())
  );
  rest.sort((a, b) =>
    a.name.localeCompare(b.name, "zh-CN", { numeric: true, sensitivity: "accent" })
  );

  return known.concat(rest);
}

function createActionButton(action, label, shapes, index, entry) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `load-order-action load-order-action-${action}`;
  button.dataset.action = action;
  button.dataset.index = String(index);
  button.title = label;
  button.setAttribute("aria-label", `${label} ${entry.title}`);
  button.appendChild(createSvgIcon(shapes));
  return button;
}

function createRow(entry, index) {
  const row = document.createElement("div");
  row.className = "load-order-row";
  row.dataset.index = String(index);
  row.dataset.name = entry.name.toLowerCase();

  // 用 span 而不是 button：拖动由指针事件实现，避免表单控件的默认行为
  const handle = document.createElement("span");
  handle.className = "load-order-drag-handle";
  handle.setAttribute("role", "button");
  handle.setAttribute("tabindex", "0");
  handle.title = "拖动排序";
  handle.setAttribute("aria-label", `拖动排序 ${entry.title}`);
  handle.appendChild(createSvgIcon(ICON_SHAPES.grip));

  const order = document.createElement("span");
  order.className = "load-order-row-index";
  order.textContent = String(index + 1);

  const info = document.createElement("div");
  info.className = "load-order-row-info";

  const title = document.createElement("span");
  title.className = "load-order-row-title";
  title.textContent = entry.title;
  title.title = entry.title;

  const name = document.createElement("span");
  name.className = "load-order-row-name";
  name.textContent = entry.name;
  name.title = entry.name;

  info.append(title, name);

  const location = document.createElement("span");
  location.className = "load-order-row-location";
  location.textContent = LOCATION_LABELS[entry.location] || entry.location;

  const actions = document.createElement("div");
  actions.className = "load-order-row-actions";
  actions.append(
    createActionButton("top", "置顶", ICON_SHAPES.toTop, index, entry),
    createActionButton("bottom", "置底", ICON_SHAPES.toBottom, index, entry),
    createActionButton("index", "设置序号", ICON_SHAPES.setIndex, index, entry)
  );

  row.append(handle, order, info, location, actions);
  return row;
}

function renderEditorList() {
  const container = byId("load-order-editor-list");
  if (!container) return;

  const scrollTop = container.scrollTop;
  container.textContent = "";
  workingOrder.forEach((entry, index) => {
    container.appendChild(createRow(entry, index));
  });
  container.scrollTop = scrollTop;
}

function moveEntryTo(from, to) {
  if (from < 0 || from >= workingOrder.length) return;

  const target = Math.max(0, Math.min(to, workingOrder.length - 1));
  if (from === target) return;

  const [entry] = workingOrder.splice(from, 1);
  workingOrder.splice(target, 0, entry);
  renderEditorList();
}

function handleListClick(event) {
  const button = event.target.closest(".load-order-action");
  if (!button) return;

  const index = Number(button.dataset.index);
  if (!Number.isInteger(index) || index < 0 || index >= workingOrder.length) return;

  const action = button.dataset.action;
  if (action === "top") {
    moveEntryTo(index, 0);
  } else if (action === "bottom") {
    moveEntryTo(index, workingOrder.length - 1);
  } else if (action === "index") {
    openIndexPopover(index);
  }
}

function getRowPitch(rows) {
  if (rows.length >= 2) {
    const pitch = rows[1].offsetTop - rows[0].offsetTop;
    if (pitch > 0) return pitch;
  }

  const rect = rows[0]?.getBoundingClientRect();
  return rect ? rect.height + 6 : 0;
}

function updateDragShifts() {
  if (!dragState) return;

  const { rows, row, fromIndex, toIndex, pitch } = dragState;

  // 被拖动的条目让开原位，其余条目按方向补齐
  rows.forEach((item, index) => {
    if (item === row) return;

    let shift = 0;
    if (fromIndex < toIndex && index > fromIndex && index <= toIndex) {
      shift = -pitch;
    } else if (fromIndex > toIndex && index >= toIndex && index < fromIndex) {
      shift = pitch;
    }

    item.style.transform = shift ? `translate3d(0, ${shift}px, 0)` : "";
  });
}

function updateDragPosition(contentY) {
  if (!dragState) return;

  const { row, rows, fromIndex, pitch } = dragState;
  const offset = contentY - dragState.startContentY;
  row.style.transform = `translate3d(0, ${offset}px, 0)`;

  const step = pitch > 0 ? Math.round(offset / pitch) : 0;
  const toIndex = Math.max(0, Math.min(fromIndex + step, rows.length - 1));
  if (toIndex === dragState.toIndex) return;

  dragState.toIndex = toIndex;
  updateDragShifts();
}

function handleListPointerDown(event) {
  if (event.button !== 0) return;

  // 行内按钮保留点击行为，其余区域整行都可以拖动
  if (event.target.closest(".load-order-action")) return;

  const list = byId("load-order-editor-list");
  const row = event.target.closest(".load-order-row");
  if (!list || !row) return;

  const index = Number(row.dataset.index);
  if (!Number.isInteger(index)) return;

  event.preventDefault();

  const rows = Array.from(list.querySelectorAll(".load-order-row"));
  dragState = {
    pointerId: event.pointerId,
    list,
    row,
    rows,
    fromIndex: index,
    toIndex: index,
    startClientY: event.clientY,
    startContentY: event.clientY + list.scrollTop,
    lastClientY: event.clientY,
    pitch: getRowPitch(rows),
    active: false,
  };

  list.setPointerCapture?.(event.pointerId);
}

function activateDrag() {
  if (!dragState || dragState.active) return;

  dragState.active = true;
  dragState.row.classList.add("is-dragging");
  dragState.list.classList.add("is-dragging");
  startAutoScroll();
}

function handlePointerMove(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) return;

  dragState.lastClientY = event.clientY;

  // 超过阈值才真正进入拖动，避免普通点击时条目抖动
  if (!dragState.active) {
    if (Math.abs(event.clientY - dragState.startClientY) < DRAG_START_THRESHOLD) return;
    activateDrag();
  }

  updateDragPosition(event.clientY + dragState.list.scrollTop);
}

function handlePointerUp(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  finishDrag(true);
}

function handlePointerCancel(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  finishDrag(false);
}

function finishDrag(commit) {
  const state = dragState;
  dragState = null;
  stopAutoScroll();

  if (state.list.hasPointerCapture?.(state.pointerId)) {
    state.list.releasePointerCapture(state.pointerId);
  }

  state.row.classList.remove("is-dragging");
  state.list.classList.remove("is-dragging");
  state.rows.forEach((item) => {
    item.style.transform = "";
  });

  if (commit && state.active && state.toIndex !== state.fromIndex) {
    moveEntryTo(state.fromIndex, state.toIndex);
  }
}

function startAutoScroll() {
  if (autoScrollFrame) return;
  autoScrollFrame = window.requestAnimationFrame(autoScrollTick);
}

function stopAutoScroll() {
  if (!autoScrollFrame) return;

  window.cancelAnimationFrame(autoScrollFrame);
  autoScrollFrame = 0;
}

// 拖到列表上下边缘时自动滚动，方便长列表跨屏拖动
function autoScrollTick() {
  autoScrollFrame = 0;
  if (!dragState) return;

  const { list, lastClientY } = dragState;
  const rect = list.getBoundingClientRect();

  let delta = 0;
  if (lastClientY < rect.top + AUTO_SCROLL_EDGE) {
    delta = -AUTO_SCROLL_STEP;
  } else if (lastClientY > rect.bottom - AUTO_SCROLL_EDGE) {
    delta = AUTO_SCROLL_STEP;
  }

  if (delta !== 0) {
    const before = list.scrollTop;
    list.scrollTop = before + delta;
    if (list.scrollTop !== before) {
      updateDragPosition(lastClientY + list.scrollTop);
    }
  }

  autoScrollFrame = window.requestAnimationFrame(autoScrollTick);
}

function openIndexPopover(index) {
  const popover = byId("load-order-index-popover");
  const input = byId("load-order-index-input");
  if (!popover || !input) return;

  indexPopoverTarget = index;
  input.min = "1";
  input.max = String(workingOrder.length);
  input.value = String(index + 1);
  popover.classList.remove("hidden");
  input.focus();
  input.select();
}

function closeIndexPopover() {
  indexPopoverTarget = -1;
  byId("load-order-index-popover")?.classList.add("hidden");
}

function confirmIndexPopover() {
  if (indexPopoverTarget < 0) return;

  const input = byId("load-order-index-input");
  const value = Number.parseInt(input?.value ?? "", 10);

  if (!Number.isFinite(value) || value < 1 || value > workingOrder.length) {
    showError(`请输入 1 - ${workingOrder.length} 之间的序号`);
    return;
  }

  const from = indexPopoverTarget;
  closeIndexPopover();
  moveEntryTo(from, value - 1);
}

function highlightFocusedRow() {
  if (!focusedName) return;

  const container = byId("load-order-editor-list");
  const row = Array.from(container?.querySelectorAll(".load-order-row") || []).find(
    (item) => item.dataset.name === focusedName
  );
  if (!row) return;

  row.classList.add("focused");
  row.scrollIntoView({ block: "center" });
  window.setTimeout(() => row.classList.remove("focused"), 1600);
}

export async function openLoadOrderEditor(fileName = "") {
  const entries = buildEditorEntries();
  if (!entries.length) {
    showError("当前目录没有可排序的 VPK 文件");
    return;
  }

  let info = null;
  try {
    info = await GetAddonListOrderInfo();
  } catch (err) {
    console.error("读取 addonlist.txt 失败:", err);
    showError("读取加载顺序失败: " + err);
    return;
  }

  workingOrder = orderEditorEntries(entries, info?.order || []);
  focusedName = String(fileName || "").toLowerCase();
  closeIndexPopover();
  renderEditorList();

  byId("load-order-editor-modal")?.classList.remove("hidden");
  highlightFocusedRow();
}

export function closeLoadOrderEditor() {
  byId("load-order-editor-modal")?.classList.add("hidden");
  closeIndexPopover();

  if (dragState) {
    finishDrag(false);
  }

  workingOrder = [];
  focusedName = "";
}

export async function saveLoadOrderEditor() {
  if (isSaving || !workingOrder.length) return;

  const button = byId("save-load-order-editor-btn");
  isSaving = true;
  if (button) button.disabled = true;

  try {
    await SetAddonListOrder(workingOrder.map((entry) => entry.name));
    await refreshLoadOrderMap();

    if (appState.sortType === "loadOrder") {
      applySort(appState.vpkFiles);
      renderFileList();
    }

    showNotification("加载顺序已保存", "success");
    closeLoadOrderEditor();
  } catch (err) {
    console.error("保存加载顺序失败:", err);
    showError("保存加载顺序失败: " + err);
  } finally {
    isSaving = false;
    if (button) button.disabled = false;
  }
}

function handleKeydown(event) {
  if (event.key !== "Escape") return;

  const modal = byId("load-order-editor-modal");
  if (!modal || modal.classList.contains("hidden")) return;

  const popover = byId("load-order-index-popover");
  if (popover && !popover.classList.contains("hidden")) {
    closeIndexPopover();
    return;
  }

  closeLoadOrderEditor();
}

export function setupLoadOrderEditor() {
  byId("load-order-editor-btn")?.addEventListener("click", () =>
    openLoadOrderEditor()
  );
  byId("close-load-order-editor-btn")?.addEventListener("click", closeLoadOrderEditor);
  byId("cancel-load-order-editor-btn")?.addEventListener("click", closeLoadOrderEditor);
  byId("save-load-order-editor-btn")?.addEventListener("click", saveLoadOrderEditor);

  byId("load-order-editor-modal")?.addEventListener("click", function (event) {
    if (event.target === this) {
      closeLoadOrderEditor();
    }
  });

  const list = byId("load-order-editor-list");
  list?.addEventListener("click", handleListClick);
  list?.addEventListener("pointerdown", handleListPointerDown);

  document.addEventListener("pointermove", handlePointerMove);
  document.addEventListener("pointerup", handlePointerUp);
  document.addEventListener("pointercancel", handlePointerCancel);

  byId("cancel-load-order-index-btn")?.addEventListener("click", closeIndexPopover);
  byId("confirm-load-order-index-btn")?.addEventListener("click", confirmIndexPopover);
  byId("load-order-index-input")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      confirmIndexPopover();
    }
  });

  document.addEventListener("keydown", handleKeydown);
}
