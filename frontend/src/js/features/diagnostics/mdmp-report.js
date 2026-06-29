import { showError, showNotification } from "../../core/toast.js";

const TABS = [
  { id: "overview", label: "概览" },
  { id: "exception", label: "异常" },
  { id: "threads", label: "线程" },
  { id: "modules", label: "模块" },
  { id: "memory", label: "内存" },
  { id: "streams", label: "Streams" },
  { id: "raw", label: "Raw JSON" },
];

const PAGE_SIZE = 30;

let activeTab = "overview";
let currentReport = null;
let tableState = {};
let closeBound = false;

export async function openMDMPReportTool() {
  let filePath = "";
  try {
    filePath = await callApp("SelectMDMPFile");
  } catch (error) {
    showError("选择崩溃转储失败: " + formatError(error));
    return;
  }
  if (!filePath) return;
  await openMDMPReportFromPath(filePath);
}

export async function openMDMPReportFromPath(filePath) {
  try {
    currentReport = null;
    activeTab = "overview";
    tableState = {};
    openModal();
    renderLoading(filePath);

    const report = await callApp("ParseMDMPFile", filePath);
    currentReport = report || {};
    renderReport();
    showNotification("崩溃转储解析完成", "success");
  } catch (error) {
    renderError("解析崩溃转储失败: " + formatError(error));
    showError("解析崩溃转储失败: " + formatError(error));
  }
}

function openModal() {
  ensureModal();
  getModal()?.classList.remove("hidden");
}

function closeModal() {
  currentReport = null;
  tableState = {};
  getBody()?.replaceChildren();
  getFooter()?.replaceChildren();
  getModal()?.classList.add("hidden");
}

function ensureModal() {
  if (getModal()) return;

  const modal = createEl("div", "modal hidden");
  modal.id = "mdmp-report-modal";
  modal.style.zIndex = "20012";

  const content = createEl("div", "modal-content mdmp-report-modal-content");
  const header = createEl("div", "modal-header mdmp-report-header");
  const titleWrap = createEl("div", "mdmp-report-title");
  const title = createEl("h2", "", "崩溃转储查看器");
  const subtitle = createEl("p", "", "解析 .mdmp / .dmp 中的客观字段，不做原因判断。");
  titleWrap.append(title, subtitle);

  const closeBtn = createEl("button", "close-btn", "×");
  closeBtn.type = "button";
  closeBtn.id = "close-mdmp-report-modal-btn";
  closeBtn.setAttribute("aria-label", "关闭");
  header.append(titleWrap, closeBtn);

  const body = createEl("div", "modal-body");
  body.id = "mdmp-report-body";
  const footer = createEl("div", "modal-footer mdmp-report-footer");
  footer.id = "mdmp-report-footer";

  content.append(header, body, footer);
  modal.appendChild(content);
  document.body.appendChild(modal);
  bindCloseControls();
}

function bindCloseControls() {
  if (closeBound) return;
  closeBound = true;
  document.addEventListener("click", (event) => {
    if (event.target?.id === "close-mdmp-report-modal-btn") closeModal();
    if (event.target?.id === "mdmp-report-modal") closeModal();
  });
}

function renderLoading(filePath) {
  const body = getBody();
  const footer = getFooter();
  if (!body || !footer) return;

  body.replaceChildren();
  const shell = createEl("div", "mdmp-report-loading");
  shell.append(
    createEl("div", "mdmp-report-spinner"),
    createEl("h3", "", "正在解析崩溃转储"),
    createTextWithTitle("p", "", filePath || ""),
  );
  body.appendChild(shell);
  footer.replaceChildren(createFooterButton("关闭", "btn btn-secondary", closeModal));
}

function renderError(message) {
  const body = getBody();
  const footer = getFooter();
  if (!body || !footer) return;

  body.replaceChildren();
  const shell = createEl("div", "mdmp-report-error");
  shell.append(
    createEl("div", "mdmp-report-error-icon", "!"),
    createEl("h3", "", "解析失败"),
    createEl("p", "", message || "无法解析崩溃转储文件"),
  );
  body.appendChild(shell);
  footer.replaceChildren(createFooterButton("关闭", "btn btn-secondary", closeModal));
}

function renderReport() {
  const body = getBody();
  const footer = getFooter();
  if (!body || !footer || !currentReport) return;

  body.replaceChildren();
  const shell = createEl("div", "mdmp-report-shell");
  shell.append(createSummaryBar(currentReport), createTabs(), createTabContent());
  body.appendChild(shell);
  footer.replaceChildren(createFooterButton("关闭", "btn btn-secondary", closeModal));
}

function createSummaryBar(report) {
  const bar = createEl("div", "mdmp-report-summary");
  bar.append(
    createMetricCard("文件", basename(report.file?.name || report.file?.path || "")),
    createMetricCard("Streams", formatNumber(report.streams?.length || 0)),
    createMetricCard("线程", formatNumber(report.threads?.length || 0)),
    createMetricCard("模块", formatNumber(report.modules?.length || 0)),
    createMetricCard("内存范围", formatNumber(report.memoryRanges?.length || 0)),
  );
  return bar;
}

function createMetricCard(label, value) {
  const card = createEl("div", "mdmp-report-metric");
  card.append(createEl("span", "", label), createTextWithTitle("strong", "", value || "-"));
  return card;
}

function createTabs() {
  const tabs = createEl("div", "mdmp-report-tabs");
  tabs.setAttribute("role", "tablist");
  TABS.forEach((tab) => {
    const btn = createEl("button", `mdmp-report-tab${activeTab === tab.id ? " is-active" : ""}`, tab.label);
    btn.type = "button";
    btn.dataset.tab = tab.id;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", String(activeTab === tab.id));
    btn.addEventListener("click", () => {
      if (activeTab === tab.id) return;
      activeTab = tab.id;
      renderReport();
    });
    tabs.appendChild(btn);
  });
  return tabs;
}

function createTabContent() {
  if (activeTab === "exception") return createExceptionView(currentReport);
  if (activeTab === "threads") return createThreadsView(currentReport);
  if (activeTab === "modules") return createModulesView(currentReport);
  if (activeTab === "memory") return createMemoryView(currentReport);
  if (activeTab === "streams") return createStreamsView(currentReport);
  if (activeTab === "raw") return createRawView(currentReport);
  return createOverviewView(currentReport);
}

function createOverviewView(report) {
  const view = createEl("div", "mdmp-report-view");
  view.append(
    createSection("文件信息", [
      ["路径", report.file?.path],
      ["大小", formatBytes(report.file?.size)],
      ["修改时间", report.file?.lastModified],
    ]),
    createSection("Header", [
      ["签名", `${report.header?.signatureAscii || ""} ${report.header?.signature || ""}`.trim()],
      ["版本", report.header?.version],
      ["Streams", report.header?.numberOfStreams],
      ["Stream Directory RVA", report.header?.streamDirectoryRva],
      ["TimeDateStamp UTC", report.header?.timeDateStampUtc],
      ["Flags", joinValue(report.header?.flags, report.header?.flagNames)],
    ]),
  );
  if (report.system) {
    view.appendChild(createSection("系统信息", [
      ["架构", joinValue(report.system.architectureName, report.system.processorArchitecture)],
      ["CPU Vendor", report.system.cpuVendor],
      ["处理器数量", report.system.numberOfProcessors],
      ["Windows", `${report.system.majorVersion}.${report.system.minorVersion}.${report.system.buildNumber}`],
      ["Platform", joinValue(report.system.platformName, report.system.platformId)],
      ["Product Type", joinValue(report.system.productTypeName, report.system.productType)],
    ]));
  }
  if (report.misc) {
    view.appendChild(createSection("进程信息", [
      ["Process ID", report.misc.processId],
      ["Process Create UTC", report.misc.processCreateTimeUtc],
      ["User Time", `${report.misc.processUserTimeSeconds || 0}s`],
      ["Kernel Time", `${report.misc.processKernelTimeSeconds || 0}s`],
      ["Flags", joinValue(report.misc.flags1, report.misc.flagNames)],
    ]));
  }
  if (report.exception) {
    view.appendChild(createSection("异常摘要", [
      ["Thread ID", report.exception.threadId],
      ["Exception Code", joinValue(report.exception.code, report.exception.codeName)],
      ["Address", report.exception.address],
      ["Module", formatModuleHit(report.exceptionModule)],
    ]));
  }
  if ((report.parseWarnings || []).length > 0) {
    view.appendChild(createListSection("解析警告", report.parseWarnings));
  }
  return view;
}

function createExceptionView(report) {
  const view = createEl("div", "mdmp-report-view");
  const exception = report.exception;
  if (!exception) {
    view.appendChild(createEmptyState("这个 dump 没有 ExceptionStream"));
    return view;
  }

  view.append(
    createSection("异常信息", [
      ["Thread ID", exception.threadId],
      ["Code", joinValue(exception.code, exception.codeName)],
      ["Flags", exception.flags],
      ["Record", exception.record],
      ["Address", exception.address],
      ["命中模块", formatModuleHit(report.exceptionModule)],
      ["Parameters", (exception.parameters || []).join(", ")],
    ]),
    createRegisterSection("异常上下文", exception.context),
  );
  return view;
}

function createThreadsView(report) {
  const rows = (report.threads || []).map((thread) => ({
    id: thread.threadId,
    name: thread.name || "",
    teb: thread.teb,
    stack: `${thread.stack?.startAddress || ""} / ${formatBytes(thread.stack?.size)}`,
    eip: thread.context?.registers?.EIP || thread.context?.registers?.RIP || "",
    priority: thread.priority,
  }));
  return createDataTable("threads", rows, [
    ["TID", (row) => row.id],
    ["名称", (row) => row.name],
    ["TEB", (row) => row.teb],
    ["Stack", (row) => row.stack],
    ["IP", (row) => row.eip],
    ["Priority", (row) => row.priority],
  ]);
}

function createModulesView(report) {
  const rows = report.modules || [];
  return createDataTable("modules", rows, [
    ["#", (row) => row.index],
    ["文件", (row) => row.fileName || basename(row.path)],
    ["Base", (row) => row.baseAddress],
    ["Size", (row) => formatBytes(row.sizeOfImage)],
    ["Timestamp UTC", (row) => row.timeDateStampUtc],
    ["Version", (row) => row.version?.fileVersion],
    ["PDB", (row) => row.codeView?.pdbPath || ""],
    ["路径", (row) => row.path],
  ]);
}

function createMemoryView(report) {
  const view = createEl("div", "mdmp-report-view");
  if (report.systemMemory || report.processVmCounters) {
    const grid = createEl("div", "mdmp-report-two-col");
    if (report.systemMemory) grid.appendChild(createRawFieldSection("SystemMemoryInfoStream", report.systemMemory));
    if (report.processVmCounters) grid.appendChild(createRawFieldSection("ProcessVmCountersStream", report.processVmCounters));
    view.appendChild(grid);
  }
  view.appendChild(createDataTable("memory", report.memoryRanges || [], [
    ["#", (row) => row.index],
    ["Source", (row) => row.source],
    ["Start", (row) => row.startAddress],
    ["End", (row) => row.endAddress],
    ["Size", (row) => formatBytes(row.size)],
    ["RVA", (row) => row.rva],
  ]));
  if ((report.memoryInfo || []).length > 0) {
    view.appendChild(createDataTable("memoryInfo", report.memoryInfo || [], [
      ["#", (row) => row.index],
      ["Base", (row) => row.baseAddress],
      ["Region", (row) => formatBytes(row.regionSize)],
      ["State", (row) => joinValue(row.state, row.stateName)],
      ["Protect", (row) => joinValue(row.protect, row.protectName)],
      ["Type", (row) => joinValue(row.type, row.typeName)],
    ]));
  }
  return view;
}

function createStreamsView(report) {
  return createDataTable("streams", report.streams || [], [
    ["#", (row) => row.index],
    ["Type", (row) => row.type],
    ["Name", (row) => row.name],
    ["Size", (row) => formatBytes(row.size)],
    ["RVA", (row) => row.rva],
    ["End", (row) => row.end],
  ]);
}

function createRawView(report) {
  const view = createEl("div", "mdmp-report-view");
  const pre = createEl("pre", "mdmp-report-raw");
  pre.textContent = JSON.stringify(report, null, 2);
  view.appendChild(pre);
  return view;
}

function createSection(title, rows) {
  const section = createEl("section", "mdmp-report-section");
  section.appendChild(createEl("h3", "", title));
  const grid = createEl("div", "mdmp-report-detail-grid");
  rows.forEach(([label, value]) => {
    const item = createEl("div", "mdmp-report-detail");
    item.append(createEl("span", "", label), createTextWithTitle("strong", "", formatValue(value)));
    grid.appendChild(item);
  });
  section.appendChild(grid);
  return section;
}

function createListSection(title, values) {
  const section = createEl("section", "mdmp-report-section");
  section.appendChild(createEl("h3", "", title));
  const list = createEl("div", "mdmp-report-warning-list");
  values.forEach((value) => list.appendChild(createEl("div", "", value)));
  section.appendChild(list);
  return section;
}

function createRegisterSection(title, context = {}) {
  const rows = Object.entries(context.registers || {}).sort(([a], [b]) => a.localeCompare(b));
  const section = createSection(title, [
    ["Architecture", context.architecture],
    ["Context RVA", context.rva],
    ["Context Size", context.size],
    ["Context Flags", context.contextFlags],
  ]);
  if (rows.length > 0) {
    const regs = createEl("div", "mdmp-report-register-grid");
    rows.forEach(([name, value]) => {
      const item = createEl("div", "mdmp-report-register");
      item.append(createEl("span", "", name), createEl("strong", "", value));
      regs.appendChild(item);
    });
    section.appendChild(regs);
  }
  if (context.preview?.text) {
    const pre = createEl("pre", "mdmp-report-hex");
    pre.textContent = context.preview.text;
    section.appendChild(pre);
  }
  return section;
}

function createRawFieldSection(title, stream = {}) {
  const section = createEl("section", "mdmp-report-section");
  section.appendChild(createEl("h3", "", title));
  const rows = (stream.fields || []).slice(0, 16).map((field) => `${field.name}: ${field.hex || field.value}${field.display ? ` (${field.display})` : ""}`);
  const list = createEl("div", "mdmp-report-warning-list");
  rows.forEach((row) => list.appendChild(createEl("div", "", row)));
  section.appendChild(list);
  return section;
}

function createDataTable(key, rows, columns) {
  const state = getTableState(key);
  const gridTemplate = `repeat(${columns.length}, minmax(9rem, 1fr))`;

  const wrap = createEl("section", "mdmp-report-table-section");
  const toolbar = createEl("div", "mdmp-report-table-toolbar");
  const input = createEl("input", "form-input mdmp-report-search");
  input.type = "search";
  input.placeholder = "搜索当前表格";
  input.value = state.query;
  const countLabel = createEl("span", "", "");
  toolbar.append(input, countLabel);
  wrap.appendChild(toolbar);

  const table = createEl("div", "mdmp-report-table");
  const pager = createEl("div", "mdmp-report-pagination");
  wrap.append(table, pager);

  // 只重建表格行/计数/分页，保留 input 自身，避免输入时丢失焦点。
  function render() {
    const filtered = filterRows(rows, state.query);
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    state.page = Math.min(Math.max(1, state.page), totalPages);
    const start = (state.page - 1) * PAGE_SIZE;
    const pageRows = filtered.slice(start, start + PAGE_SIZE);

    countLabel.textContent = `共 ${formatNumber(filtered.length)} 条`;

    table.replaceChildren();
    const header = createEl("div", "mdmp-report-table-row is-header");
    header.style.gridTemplateColumns = gridTemplate;
    columns.forEach(([label]) => header.appendChild(createEl("span", "", label)));
    table.appendChild(header);

    if (pageRows.length === 0) {
      table.appendChild(createEmptyState("没有可展示的数据"));
    } else {
      pageRows.forEach((row) => {
        const line = createEl("div", "mdmp-report-table-row");
        line.style.gridTemplateColumns = gridTemplate;
        columns.forEach(([, getValue]) => line.appendChild(createTextWithTitle("span", "", formatValue(getValue(row)))));
        table.appendChild(line);
      });
    }

    pager.replaceChildren(
      createPagerButton("‹", "上一页", state.page <= 1, () => {
        state.page = Math.max(1, state.page - 1);
        render();
      }),
      createEl("span", "", `第 ${state.page} / ${totalPages} 页 · ${formatNumber(filtered.length)} 条`),
      createPagerButton("›", "下一页", state.page >= totalPages, () => {
        state.page = Math.min(totalPages, state.page + 1);
        render();
      }),
    );
  }

  input.addEventListener("input", () => {
    state.query = input.value;
    state.page = 1;
    render();
  });

  render();
  return wrap;
}

function createPagerButton(label, title, disabled, onClick) {
  const button = createEl("button", "mdmp-report-page-btn", label);
  button.type = "button";
  button.title = title;
  button.disabled = disabled;
  button.addEventListener("click", onClick);
  return button;
}

function getTableState(key) {
  if (!tableState[key]) tableState[key] = { page: 1, query: "" };
  return tableState[key];
}

function filterRows(rows, query) {
  if (!query) return rows;
  const needle = query.toLowerCase();
  return rows.filter((row) => JSON.stringify(row).toLowerCase().includes(needle));
}

function createEmptyState(text) {
  return createEl("div", "mdmp-report-empty", text);
}

function createFooterButton(label, className, onClick) {
  const button = createEl("button", className, label);
  button.type = "button";
  button.addEventListener("click", onClick);
  return button;
}

function callApp(methodName, ...args) {
  const method = window?.go?.app?.App?.[methodName];
  if (typeof method !== "function") {
    return Promise.reject(new Error(`当前后端不支持 ${methodName}`));
  }
  return method(...args);
}

function getModal() {
  return document.getElementById("mdmp-report-modal");
}

function getBody() {
  return document.getElementById("mdmp-report-body");
}

function getFooter() {
  return document.getElementById("mdmp-report-footer");
}

function createEl(tag, className = "", text = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== "") element.textContent = text;
  return element;
}

function createTextWithTitle(tag, className = "", text = "") {
  const element = createEl(tag, className, formatValue(text));
  element.title = formatValue(text);
  return element;
}

function formatError(error) {
  if (error?.message) return error.message;
  return String(error || "未知错误");
}

function formatValue(value) {
  if (value === null || value === undefined || value === "") return "-";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function joinValue(primary, secondary) {
  if (Array.isArray(secondary)) secondary = secondary.join(", ");
  if (!secondary) return formatValue(primary);
  if (!primary) return formatValue(secondary);
  return `${primary} · ${secondary}`;
}

function formatModuleHit(hit) {
  if (!hit) return "-";
  return `${hit.fileName || basename(hit.path)} ${hit.offset || ""}`.trim();
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("zh-CN");
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index++;
  }
  return `${size.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function basename(path = "") {
  return String(path).split(/[\\/]/).pop() || path;
}
