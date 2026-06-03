import { showNotification } from "../../core/toast.js";

let EventsOn;
let showError;

let progressOff = null;
let completeOff = null;
let activeScanId = "";
let modalOpen = false;
let currentResult = null;
let closeBound = false;
let awaitingScanStart = false;
let scanEventSettled = false;
let currentView = "mods";
let currentPage = 1;
let viewSwitchTimer = 0;

const MODEL_STATS_VIEW_MODS = "mods";
const MODEL_STATS_VIEW_MODELS = "models";
const MODEL_STATS_VIEW_STRIP_GROUPS = "stripGroups";
const MODEL_STATS_PAGE_SIZE = 10;

export function configureModelStatsScan(deps = {}) {
  EventsOn = deps.EventsOn;
  showError = deps.showError;
  bindCloseControls();
}

export async function openModelStatsScanModal() {
  const modal = getModal();
  if (!modal) return;

  modalOpen = true;
  currentResult = null;
  activeScanId = "";
  currentView = MODEL_STATS_VIEW_MODS;
  currentPage = 1;
  clearViewSwitchTimer();
  awaitingScanStart = false;
  scanEventSettled = false;
  modal.classList.remove("hidden");
  registerScanEvents();
  renderLoading({ current: 0, total: 0, message: "准备扫描模型面数..." });

  try {
    const state = await callApp("GetModelStatsScanState");
    if (state?.running && state.scanId) {
      activeScanId = state.scanId;
      awaitingScanStart = false;
      renderLoading(state.progress || { current: 0, total: 0, message: "正在扫描模型面数..." });
      return;
    }

    awaitingScanStart = true;
    scanEventSettled = false;
    const started = await callApp("StartModelStatsScan");
    if (scanEventSettled) return;
    if (!activeScanId) activeScanId = started?.scanId || "";
    awaitingScanStart = false;
    renderLoading(started?.progress || { current: 0, total: 0, message: "正在扫描模型面数..." });
  } catch (error) {
    awaitingScanStart = false;
    renderError("模型面数检测失败: " + error);
    showError?.("模型面数检测失败: " + error);
  }
}

function closeModelStatsScanModal() {
  modalOpen = false;
  activeScanId = "";
  awaitingScanStart = false;
  scanEventSettled = false;
  currentResult = null;
  currentView = MODEL_STATS_VIEW_MODS;
  currentPage = 1;
  clearViewSwitchTimer();
  clearScanEvents();
  getBody()?.replaceChildren();
  getFooter()?.replaceChildren();
  getModal()?.classList.add("hidden");
}

function registerScanEvents() {
  clearScanEvents();
  if (!EventsOn) return;

  progressOff = EventsOn("model_stats_scan_progress", (progress) => {
    if (!shouldAcceptScanEvent(progress?.scanId)) return;
    if (!activeScanId) activeScanId = progress.scanId;
    renderLoading(progress);
  });

  completeOff = EventsOn("model_stats_scan_complete", (payload) => {
    if (!shouldAcceptScanEvent(payload?.scanId)) return;
    if (!activeScanId) activeScanId = payload.scanId;
    awaitingScanStart = false;
    scanEventSettled = true;
    activeScanId = "";
    if (payload.error) {
      renderError(payload.error);
      showError?.("模型面数检测失败: " + payload.error);
      return;
    }
    currentResult = payload.result || null;
    renderResults(currentResult);
    showNotification("模型面数检测完成", "success");
  });
}

function shouldAcceptScanEvent(scanId) {
  if (!modalOpen || !scanId) return false;
  if (activeScanId) return scanId === activeScanId;
  return awaitingScanStart;
}

function clearScanEvents() {
  if (typeof progressOff === "function") progressOff();
  if (typeof completeOff === "function") completeOff();
  progressOff = null;
  completeOff = null;
}

function renderLoading(progress = {}) {
  const body = getBody();
  const footer = getFooter();
  if (!body || !footer) return;

  const current = Number(progress.current || 0);
  const total = Number(progress.total || 0);
  const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  const description = progress.message || "正在读取 VPK 中的 .vvd 和 .dx90.vtx 文件...";
  const metaText = total > 0 ? `${current} / ${total}` : "准备中";
  const hintText = "扫描中可关闭弹窗；再次打开会接入正在运行的扫描任务。";

  const existingShell = body.firstElementChild?.classList.contains("model-stats-loading")
    ? body.firstElementChild
    : null;
  if (existingShell) {
    const desc = existingShell.querySelector(".model-stats-loading-desc");
    const fill = existingShell.querySelector(".model-stats-progress-fill");
    const meta = existingShell.querySelector(".model-stats-progress-meta");
    if (desc) desc.textContent = description;
    if (fill) fill.style.width = `${percent}%`;
    if (meta) meta.textContent = metaText;
  } else {
    body.replaceChildren();
    const shell = createEl("div", "model-stats-loading");
    const spinner = createEl("div", "model-stats-spinner");
    const title = createEl("h3", "", "正在扫描模型数据");
    const desc = createEl("p", "model-stats-loading-desc", description);
    const progressWrap = createEl("div", "model-stats-progress");
    const bar = createEl("div", "model-stats-progress-bar");
    const fill = createEl("div", "model-stats-progress-fill");
    fill.style.width = `${percent}%`;
    const meta = createEl("div", "model-stats-progress-meta", metaText);

    bar.appendChild(fill);
    progressWrap.append(bar, meta);
    shell.append(spinner, title, desc, progressWrap);
    body.appendChild(shell);
  }

  const existingHint = footer.firstElementChild?.classList.contains("model-stats-footer-hint")
    ? footer.firstElementChild
    : null;
  if (existingHint) {
    existingHint.textContent = hintText;
  } else {
    footer.replaceChildren(createFooterHint(hintText));
  }
}

function renderResults(result) {
  const body = getBody();
  const footer = getFooter();
  if (!body || !footer) return;

  const items = result?.items || [];
  const rows = getCurrentViewRows(items);
  const pagination = paginateRows(rows);
  body.replaceChildren();

  const shell = createEl("div", "model-stats-results");

  if (items.length === 0) {
    shell.appendChild(createEmptyState("没有可扫描的启用或创意工坊 Mod"));
  } else {
    shell.appendChild(createViewToolbar());
    if (rows.length === 0) {
      shell.appendChild(createEmptyState("没有可展示的模型明细"));
    } else {
      shell.appendChild(createResultTable(pagination.rows, pagination.startIndex));
    }
  }

  body.appendChild(shell);
  renderResultFooter(pagination);
}

function createViewToolbar() {
  const toolbar = createEl("div", "model-stats-toolbar");
  const toggle = createEl("div", "model-stats-view-toggle");
  toggle.setAttribute("role", "tablist");
  toggle.setAttribute("aria-label", "模型统计视图");
  toggle.dataset.active = currentView;
  toggle.append(
    createEl("span", "model-stats-view-indicator"),
    createViewButton(MODEL_STATS_VIEW_MODS, "Mod 汇总"),
    createViewButton(MODEL_STATS_VIEW_MODELS, "模型排行"),
    createViewButton(MODEL_STATS_VIEW_STRIP_GROUPS, "Strip Group 排行"),
  );

  const note = createEl(
    "span",
    "model-stats-sort-note",
    getCurrentViewSortNote(),
  );
  toolbar.append(toggle, note);
  return toolbar;
}

function createViewButton(view, label) {
  const button = createEl("button", `model-stats-view-btn${currentView === view ? " is-active" : ""}`, label);
  button.type = "button";
  button.dataset.view = view;
  button.setAttribute("role", "tab");
  button.setAttribute("aria-selected", String(currentView === view));
  button.addEventListener("click", () => {
    if (currentView === view) return;
    currentView = view;
    currentPage = 1;
    updateViewToggleState(button.closest(".model-stats-view-toggle"), view);
    clearViewSwitchTimer();
    viewSwitchTimer = window.setTimeout(() => {
      viewSwitchTimer = 0;
      if (modalOpen && currentView === view) {
        renderResults(currentResult);
      }
    }, 240);
  });
  return button;
}

function createResultTable(rows, startIndex) {
  const table = createEl(
    "div",
    `model-stats-table ${getCurrentViewTableClass()}`,
  );
  table.appendChild(createTableList(rows, startIndex));
  return table;
}

function createTableList(rows, startIndex) {
  const list = createEl("div", "model-stats-list");
  rows.forEach((item, index) => {
    const rank = startIndex + index + 1;
    list.appendChild(
      createResultRow(item, rank),
    );
  });
  return list;
}

function createResultRow(item, rank) {
  if (currentView === MODEL_STATS_VIEW_MODELS) return createModelResultRow(item, rank);
  if (currentView === MODEL_STATS_VIEW_STRIP_GROUPS) return createStripGroupResultRow(item, rank);
  return createModResultRow(item, rank);
}

function renderResultFooter(pagination) {
  const footer = getFooter();
  if (!footer) return;

  footer.replaceChildren();
  if ((pagination?.totalRows || 0) > 0) {
    footer.append(createPagination(pagination));
  }
  const closeBtn = createEl("button", "btn btn-secondary", "关闭");
  closeBtn.type = "button";
  closeBtn.addEventListener("click", closeModelStatsScanModal);
  footer.append(closeBtn);
}

function renderError(message) {
  const body = getBody();
  const footer = getFooter();
  if (!body || !footer) return;

  body.replaceChildren();
  const error = createEl("div", "model-stats-error");
  error.append(
    createEl("div", "model-stats-error-icon", "!"),
    createEl("h3", "", "检测失败"),
    createEl("p", "", message || "模型面数检测发生错误"),
  );
  body.appendChild(error);

  footer.replaceChildren();
  const retryBtn = createEl("button", "btn btn-primary", "重新扫描");
  retryBtn.type = "button";
  retryBtn.addEventListener("click", openModelStatsScanModal);
  const closeBtn = createEl("button", "btn btn-secondary", "关闭");
  closeBtn.type = "button";
  closeBtn.addEventListener("click", closeModelStatsScanModal);
  footer.append(retryBtn, closeBtn);
}

function createPagination(pagination = {}) {
  const totalRows = pagination.totalRows || 0;
  const totalPages = pagination.totalPages || 1;
  const page = pagination.page || 1;
  const pager = createEl("div", "model-stats-pagination");

  const prev = createPaginationButton("‹", "上一页", page <= 1, () => {
    currentPage = Math.max(1, currentPage - 1);
    renderResults(currentResult);
  });
  const next = createPaginationButton("›", "下一页", page >= totalPages, () => {
    currentPage = Math.min(totalPages, currentPage + 1);
    renderResults(currentResult);
  });
  const meta = createEl("span", "model-stats-pagination-meta", `第 ${page} / ${totalPages} 页 · 共 ${formatNumber(totalRows)} 条`);

  pager.append(prev, meta, next);
  return pager;
}

function createPaginationButton(label, title, disabled, onClick) {
  const button = createEl("button", "model-stats-page-btn", label);
  button.type = "button";
  button.title = title;
  button.disabled = disabled;
  button.addEventListener("click", onClick);
  return button;
}

function createModResultRow(item, rankNumber) {
  const wrapper = createEl("section", "model-stats-mod");
  const header = createEl("button", "model-stats-mod-header");
  header.type = "button";
  header.setAttribute("aria-expanded", "false");

  const rank = createEl("span", "model-stats-rank", String(rankNumber));
  const main = createEl("div", "model-stats-mod-main");
  main.append(
    createTextWithTitle("strong", "model-stats-mod-title", item.title || item.name || "未知 Mod"),
    createTextWithTitle("span", "model-stats-mod-file", item.name || item.path || ""),
  );

  const chevron = createEl("span", "model-stats-chevron");
  header.append(
    rank,
    main,
    createTableMetric("模型", item.modelCount || 0),
    createTableMetric("Strip Group", getModStripGroupCount(item)),
    createTableMetric("顶点", item.totalVertices || 0),
    createTableMetric("三角形", item.totalTriangles || 0),
    chevron,
  );

  const details = createEl("div", "model-stats-model-list hidden");
  header.addEventListener("click", () => {
    const expanded = header.getAttribute("aria-expanded") === "true";
    if (expanded) {
      header.setAttribute("aria-expanded", "false");
      details.classList.add("hidden");
      details.replaceChildren();
      wrapper.classList.remove("is-expanded");
      return;
    }

    renderModelDetails(details, item);
    header.setAttribute("aria-expanded", "true");
    details.classList.remove("hidden");
    wrapper.classList.add("is-expanded");
  });

  wrapper.append(header, details);
  return wrapper;
}

function createModelResultRow(row, rankNumber) {
  const wrapper = createEl("section", "model-stats-mod model-stats-model-result");
  const content = createEl("button", "model-stats-mod-header");
  content.type = "button";
  content.setAttribute("aria-expanded", "false");
  const rank = createEl("span", "model-stats-rank", String(rankNumber));
  const modRef = createEl("div", "model-stats-row-mod-ref");
  modRef.append(
    createTextWithTitle("strong", "", row.mod.title || row.mod.name || "未知 Mod"),
    createTextWithTitle("span", "", row.mod.name || row.mod.path || ""),
  );
  const main = createEl("div", "model-stats-mod-main");
  main.append(
    createTextWithTitle("strong", "model-stats-mod-title", row.model.path || "未知模型"),
    createTextWithTitle("span", "model-stats-mod-file", row.model.message || row.model.vtxPath || row.model.vvdPath || "LOD0"),
  );
  const chevron = createEl("span", "model-stats-chevron");
  content.append(
    rank,
    modRef,
    main,
    createTableMetric("Strip Group", row.model.stripGroupCount || getStripGroups(row.model).length),
    createTableMetric("顶点", row.model.vertices || 0),
    createTableMetric("三角形", row.model.triangles || 0, row.model.triangleStripEstimated ? "估算" : ""),
    chevron,
  );

  const details = createEl("div", "model-stats-strip-grid hidden");
  content.addEventListener("click", () => {
    const expanded = content.getAttribute("aria-expanded") === "true";
    if (expanded) {
      content.setAttribute("aria-expanded", "false");
      details.classList.add("hidden");
      details.replaceChildren();
      wrapper.classList.remove("is-expanded");
      return;
    }

    renderStripGroupCards(details, row.model);
    content.setAttribute("aria-expanded", "true");
    details.classList.remove("hidden");
    wrapper.classList.add("is-expanded");
  });

  wrapper.append(content, details);
  return wrapper;
}

function createStripGroupResultRow(row, rankNumber) {
  const wrapper = createEl("section", "model-stats-mod model-stats-strip-result");
  const content = createEl("div", "model-stats-mod-header is-static");
  const rank = createEl("span", "model-stats-rank", String(rankNumber));
  const main = createEl("div", "model-stats-mod-main");
  main.append(
    createTextWithTitle("strong", "model-stats-mod-title", row.mod.title || row.mod.name || "未知 Mod"),
    createTextWithTitle("span", "model-stats-mod-file", row.mod.name || row.mod.path || ""),
  );

  const modelRef = createEl("div", "model-stats-row-mod-ref");
  modelRef.append(
    createTextWithTitle("strong", "", getModelDisplayName(row.model)),
    createTextWithTitle("span", "", row.model.path || row.model.vtxPath || row.model.vvdPath || "LOD0"),
  );
  const groupRef = createEl("div", "model-stats-row-group-ref");
  groupRef.append(
    createTextWithTitle("strong", "", formatStripGroupName(row.group)),
    createTextWithTitle("span", "", formatStripGroupLabel(row.group)),
  );
  const spacer = createEl("span", "model-stats-list-spacer");
  content.append(
    rank,
    main,
    modelRef,
    groupRef,
    createTableMetric("顶点", row.group.vertices || 0),
    createTableMetric("索引", row.group.indices || 0),
    spacer,
  );
  wrapper.appendChild(content);
  return wrapper;
}

function renderModelDetails(container, item) {
  container.replaceChildren();
  if (item.message) {
    container.appendChild(createEl("div", "model-stats-model-note", item.message));
  }
  const models = getSortedModels(item);
  if (models.length === 0) {
    container.appendChild(createEmptyState("这个 Mod 没有检测到模型文件"));
    return;
  }

  models.forEach((model, index) => container.appendChild(createModelDetailSection(model, index)));
}

function createModelDetailSection(model, index) {
  const section = createEl("section", "model-stats-model-section");
  const row = createEl("button", "model-stats-model-row");
  row.type = "button";
  row.setAttribute("aria-expanded", "false");

  const main = createEl("div", "model-stats-model-main");
  main.append(
    createTextWithTitle("strong", "", model.path || `模型 ${index + 1}`),
    createTextWithTitle("span", "", model.message || model.vtxPath || model.vvdPath || "LOD0"),
  );
  const values = createEl("div", "model-stats-model-values");
  values.append(
    createMetric("顶点", model.vertices || 0),
    createMetric("三角形", model.triangles || 0),
    createMetric("Strip Group", model.stripGroupCount || getStripGroups(model).length),
  );
  if (model.triangleStripEstimated) {
    values.appendChild(createEl("span", "model-stats-pill is-warning", "估算"));
  }
  const chevron = createEl("span", "model-stats-chevron");
  row.append(main, values, chevron);

  const cards = createEl("div", "model-stats-strip-grid hidden");
  row.addEventListener("click", () => {
    const expanded = row.getAttribute("aria-expanded") === "true";
    if (expanded) {
      row.setAttribute("aria-expanded", "false");
      cards.classList.add("hidden");
      cards.replaceChildren();
      section.classList.remove("is-expanded");
      return;
    }

    renderStripGroupCards(cards, model);
    row.setAttribute("aria-expanded", "true");
    cards.classList.remove("hidden");
    section.classList.add("is-expanded");
  });

  section.append(row, cards);
  return section;
}

function renderStripGroupCards(container, model) {
  container.replaceChildren();
  const groups = getSortedStripGroups(model);
  if (groups.length === 0) {
    container.appendChild(createEmptyState("这个模型没有检测到 strip group 数据"));
    return;
  }
  groups.forEach((group) => container.appendChild(createStripGroupCard(group)));
}

function createStripGroupCard(group) {
  const card = createEl("div", "model-stats-strip-card");
  card.append(
    createEl("strong", "", formatStripGroupLabel(group)),
    createEl("span", "model-stats-strip-card-value", formatNumber(group.vertices || 0)),
    createEl("span", "", `索引 ${formatNumber(group.indices || 0)}`),
    createEl("span", "", `三角形 ${formatNumber(group.triangles || 0)}`),
  );
  if (group.triangleStripEstimated) {
    card.appendChild(createEl("em", "", "三角形估算"));
  }
  return card;
}

function createTableMetric(label, value, suffix = "") {
  const cell = createEl("span", "model-stats-value model-stats-value-labeled");
  cell.append(createEl("small", "", label), createEl("b", "", formatNumber(value)));
  if (suffix) {
    cell.appendChild(createEl("em", "", suffix));
  }
  return cell;
}

function createMetric(label, value) {
  const metric = createEl("span", "model-stats-metric");
  metric.append(createEl("small", "", label), createEl("b", "", formatNumber(value)));
  return metric;
}

function createEmptyState(text) {
  const empty = createEl("div", "model-stats-empty", text);
  return empty;
}

function createFooterHint(text) {
  return createEl("div", "model-stats-footer-hint", text);
}

function getCurrentViewRows(items) {
  if (currentView === MODEL_STATS_VIEW_MODELS) {
    return createModelRankRows(items);
  }
  if (currentView === MODEL_STATS_VIEW_STRIP_GROUPS) {
    return createStripGroupRankRows(items);
  }
  return [...items].sort((a, b) => {
    if ((b.totalVertices || 0) !== (a.totalVertices || 0)) {
      return (b.totalVertices || 0) - (a.totalVertices || 0);
    }
    if ((b.totalTriangles || 0) !== (a.totalTriangles || 0)) {
      return (b.totalTriangles || 0) - (a.totalTriangles || 0);
    }
    return String(a.name || "").localeCompare(String(b.name || ""), "zh-CN");
  });
}

function createModelRankRows(items) {
  const rows = [];
  items.forEach((mod) => {
    (mod.models || []).forEach((model) => rows.push({ mod, model }));
  });
  rows.sort((a, b) => {
    if ((b.model.triangles || 0) !== (a.model.triangles || 0)) {
      return (b.model.triangles || 0) - (a.model.triangles || 0);
    }
    if ((b.model.vertices || 0) !== (a.model.vertices || 0)) {
      return (b.model.vertices || 0) - (a.model.vertices || 0);
    }
    return String(a.model.path || "").localeCompare(String(b.model.path || ""), "zh-CN");
  });
  return rows;
}

function createStripGroupRankRows(items) {
  const rows = [];
  items.forEach((mod) => {
    (mod.models || []).forEach((model) => {
      getStripGroups(model).forEach((group) => rows.push({ mod, model, group }));
    });
  });
  rows.sort((a, b) => {
    if ((b.group.vertices || 0) !== (a.group.vertices || 0)) {
      return (b.group.vertices || 0) - (a.group.vertices || 0);
    }
    if ((b.group.indices || 0) !== (a.group.indices || 0)) {
      return (b.group.indices || 0) - (a.group.indices || 0);
    }
    if ((b.group.triangles || 0) !== (a.group.triangles || 0)) {
      return (b.group.triangles || 0) - (a.group.triangles || 0);
    }
    return String(a.model.path || "").localeCompare(String(b.model.path || ""), "zh-CN");
  });
  return rows;
}

function paginateRows(rows) {
  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / MODEL_STATS_PAGE_SIZE));
  currentPage = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = (currentPage - 1) * MODEL_STATS_PAGE_SIZE;
  return {
    page: currentPage,
    rows: rows.slice(startIndex, startIndex + MODEL_STATS_PAGE_SIZE),
    startIndex,
    totalPages,
    totalRows,
  };
}

function getCurrentViewSortNote() {
  if (currentView === MODEL_STATS_VIEW_MODELS) return "按单模型三角形数量降序";
  if (currentView === MODEL_STATS_VIEW_STRIP_GROUPS) return "按单个 strip group 顶点数降序";
  return "按 Mod 顶点总量降序";
}

function getCurrentViewTableClass() {
  if (currentView === MODEL_STATS_VIEW_MODELS) return "is-model-view";
  if (currentView === MODEL_STATS_VIEW_STRIP_GROUPS) return "is-strip-group-view";
  return "is-mod-view";
}

function getStripGroups(model) {
  return Array.isArray(model?.stripGroups) ? model.stripGroups : [];
}

function getModStripGroupCount(item) {
  return (item?.models || []).reduce((total, model) => (
    total + (model.stripGroupCount || getStripGroups(model).length)
  ), 0);
}

function getSortedModels(item) {
  return [...(item?.models || [])].sort((a, b) => {
    if ((b.vertices || 0) !== (a.vertices || 0)) return (b.vertices || 0) - (a.vertices || 0);
    if ((b.triangles || 0) !== (a.triangles || 0)) return (b.triangles || 0) - (a.triangles || 0);
    return String(a.path || "").localeCompare(String(b.path || ""), "zh-CN");
  });
}

function getSortedStripGroups(model) {
  return [...getStripGroups(model)].sort((a, b) => {
    if ((b.vertices || 0) !== (a.vertices || 0)) return (b.vertices || 0) - (a.vertices || 0);
    if ((b.indices || 0) !== (a.indices || 0)) return (b.indices || 0) - (a.indices || 0);
    return (b.triangles || 0) - (a.triangles || 0);
  });
}

function getModelDisplayName(model = {}) {
  const value = model.path || model.vtxPath || model.vvdPath || "未知模型";
  const normalized = String(value).replaceAll("\\", "/");
  return normalized.split("/").pop() || normalized;
}

function formatStripGroupLabel(group = {}) {
  return `BP${group.bodyPart || 0} / M${group.model || 0} / Mesh${group.mesh || 0} / SG${group.stripGroup || 0}`;
}

function formatStripGroupName(group = {}) {
  return `SG ${group.stripGroup || 0}`;
}

function updateViewToggleState(toggle, nextView) {
  if (!toggle) return;
  toggle.dataset.active = nextView;
  toggle.querySelectorAll(".model-stats-view-btn").forEach((button) => {
    const active = button.dataset.view === nextView;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
}

function clearViewSwitchTimer() {
  if (!viewSwitchTimer) return;
  window.clearTimeout(viewSwitchTimer);
  viewSwitchTimer = 0;
}

function bindCloseControls() {
  if (closeBound) return;
  closeBound = true;
  document.getElementById("close-model-stats-modal-btn")?.addEventListener("click", closeModelStatsScanModal);
  document.getElementById("model-stats-modal")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) {
      closeModelStatsScanModal();
    }
  });
}

function callApp(methodName, ...args) {
  const method = window?.go?.app?.App?.[methodName];
  if (typeof method !== "function") {
    return Promise.reject(new Error(`当前后端不支持 ${methodName}`));
  }
  return method(...args);
}

function getModal() {
  return document.getElementById("model-stats-modal");
}

function getBody() {
  return document.getElementById("model-stats-body");
}

function getFooter() {
  return document.getElementById("model-stats-footer");
}

function createEl(tag, className = "", text = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== "") element.textContent = text;
  return element;
}

function createTextWithTitle(tag, className = "", text = "") {
  const element = createEl(tag, className, text);
  if (text !== "") element.title = text;
  return element;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("zh-CN");
}
