import {
  CreateSnapshot,
  DeleteSnapshot,
  ExecuteSnapshotRestore,
  GetSnapshotDirectory,
  ListSnapshots,
  OpenSnapshotDirectory,
  PreviewSnapshotRestore,
  RenameSnapshot,
} from "../../../../wailsjs/go/app/App";
import { EventsOn } from "../../../../wailsjs/runtime/runtime";
import { showError, showNotification } from "../../core/toast.js";
import { showConfirmModal } from "../modals/confirm.js";
import { appState } from "../state.js";

const SVG_NS = "http://www.w3.org/2000/svg";

const ICONS = {
  back: [
    ["path", { d: "M19 12H5" }],
    ["path", { d: "m12 19-7-7 7-7" }],
  ],
  plus: [
    ["path", { d: "M12 5v14" }],
    ["path", { d: "M5 12h14" }],
  ],
  folder: [
    [
      "path",
      {
        d: "M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",
      },
    ],
  ],
  search: [
    ["circle", { cx: 11, cy: 11, r: 7 }],
    ["path", { d: "m21 21-4.3-4.3" }],
  ],
  pencil: [
    ["path", { d: "M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" }],
    ["path", { d: "m15 5 4 4" }],
  ],
  trash: [
    ["path", { d: "M3 6h18" }],
    ["path", { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" }],
    ["path", { d: "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }],
    ["path", { d: "M10 11v6" }],
    ["path", { d: "M14 11v6" }],
  ],
  history: [
    [
      "path",
      { d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" },
    ],
    ["path", { d: "M3 3v5h5" }],
    ["path", { d: "M12 7v5l4 2" }],
  ],
  camera: [
    [
      "path",
      {
        d: "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z",
      },
    ],
    ["circle", { cx: 12, cy: 13, r: 3 }],
  ],
  archive: [
    ["rect", { x: 2, y: 3, width: 20, height: 5, rx: 1 }],
    ["path", { d: "M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" }],
    ["path", { d: "M10 12h4" }],
  ],
  alert: [
    [
      "path",
      {
        d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z",
      },
    ],
    ["path", { d: "M12 9v4" }],
    ["path", { d: "M12 17h.01" }],
  ],
  info: [
    ["circle", { cx: 12, cy: 12, r: 9 }],
    ["path", { d: "M12 16v-4" }],
    ["path", { d: "M12 8h.01" }],
  ],
  chevron: [["path", { d: "m6 9 6 6 6-6" }]],
};

const SNAPSHOT_KINDS = {
  filename: {
    title: "文件名快照",
    short: "只记录当前启用状态",
    detailTitle: "文件名快照会记录什么？",
    points: [
      "记录 addons 根目录当前启用的 VPK 文件名和 addonlist.txt。",
      "不保存 VPK 文件内容，体积小、创建快。",
      "文件被删除或重命名后，无法恢复原文件内容。",
    ],
  },
  full: {
    title: "完整备份",
    short: "包含 VPK 和配套文件",
    detailTitle: "完整备份会保存什么？",
    points: [
      "打包 addons 根目录中的 VPK、同名图片、.meta 文件和 addonlist.txt。",
      "占用空间更大，创建需要更长时间。",
      "可以恢复文件内容，适合在批量更新、删除或整理 Mod 前使用。",
    ],
  },
};

let modal = null;
let refs = null;
let progressCleanup = null;
let busy = false;

const state = {
  refreshFilesKeepFilter: null,
  snapshots: [],
  directory: "",
  filter: "",
  previewFilter: "all",
  actionFoldOverrides: new Map(),
};

export async function openSnapshotTool({ refreshFilesKeepFilter } = {}) {
  ensureSnapshotModal();
  state.refreshFilesKeepFilter =
    typeof refreshFilesKeepFilter === "function" ? refreshFilesKeepFilter : null;
  modal.classList.remove("hidden");
  await showList();
}

function ensureSnapshotModal() {
  if (modal) return;

  modal = document.createElement("div");
  modal.id = "snapshot-tool-modal";
  modal.className = "modal hidden snapshot-tool-modal";
  modal.style.zIndex = "15000";

  const content = document.createElement("div");
  content.className = "modal-content snapshot-tool-content";

  const header = document.createElement("div");
  header.className = "modal-header snapshot-tool-header";

  const backButton = document.createElement("button");
  backButton.type = "button";
  backButton.className = "snapshot-back-btn hidden";
  backButton.setAttribute("aria-label", "返回快照列表");
  backButton.title = "返回列表";
  backButton.appendChild(createIcon("back"));
  backButton.addEventListener("click", () => {
    if (!busy) showList();
  });

  const heading = document.createElement("div");
  heading.className = "snapshot-tool-heading";
  const title = document.createElement("h2");
  const subtitle = document.createElement("p");
  subtitle.className = "snapshot-tool-subtitle";
  heading.append(title, subtitle);

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "close-btn";
  closeButton.textContent = "×";
  closeButton.setAttribute("aria-label", "关闭");
  closeButton.addEventListener("click", closeSnapshotTool);

  header.append(backButton, heading, closeButton);

  const body = document.createElement("div");
  body.className = "modal-body snapshot-tool-body";

  const progress = document.createElement("div");
  progress.className = "snapshot-tool-progress hidden";
  const progressInfo = document.createElement("div");
  progressInfo.className = "snapshot-progress-info";
  const progressMessage = document.createElement("span");
  progressMessage.className = "snapshot-progress-message";
  const progressCount = document.createElement("span");
  progressCount.className = "snapshot-progress-count";
  progressInfo.append(progressMessage, progressCount);
  const progressBar = document.createElement("div");
  progressBar.className = "snapshot-progress-bar";
  const progressFill = document.createElement("div");
  progressFill.className = "snapshot-progress-fill";
  progressBar.appendChild(progressFill);
  progress.append(progressInfo, progressBar);

  const footer = document.createElement("div");
  footer.className = "modal-footer snapshot-tool-footer";
  const footerStatus = document.createElement("div");
  footerStatus.className = "snapshot-tool-footer-status";
  const footerActions = document.createElement("div");
  footerActions.className = "snapshot-tool-footer-actions";
  footer.append(footerStatus, footerActions);

  content.append(header, body, progress, footer);
  modal.appendChild(content);
  modal.addEventListener("click", (event) => {
    if (event.target === modal && !busy) closeSnapshotTool();
  });
  document.body.appendChild(modal);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.classList.contains("hidden") && !busy) {
      closeSnapshotTool();
    }
  });

  refs = {
    backButton,
    title,
    subtitle,
    closeButton,
    body,
    progress,
    progressMessage,
    progressCount,
    progressFill,
    footerStatus,
    footerActions,
  };
}

function closeSnapshotTool() {
  if (busy) return;
  cleanupProgressListener();
  modal?.classList.add("hidden");
}

function setView(view, { title, subtitle = "", showBack = false }) {
  refs.title.textContent = title;
  refs.subtitle.textContent = subtitle;
  refs.backButton.classList.toggle("hidden", !showBack);
}

function setFooter(statusText, buttons) {
  refs.footerStatus.textContent = statusText || "";
  refs.footerStatus.title = statusText || "";
  refs.footerActions.replaceChildren(...buttons);
}

function setFooterDisabled(disabled) {
  refs.footerActions.querySelectorAll("button").forEach((button) => {
    button.disabled = disabled;
  });
  refs.backButton.disabled = disabled;
  refs.closeButton.disabled = disabled;
}

async function showList() {
  setView("list", { title: "Mod 快照", subtitle: "正在读取快照列表..." });
  setFooter("", []);
  refs.body.replaceChildren(createLoading("正在读取快照列表"));
  setBusy(true);

  try {
    const [snapshots, directory] = await Promise.all([
      ListSnapshots(),
      GetSnapshotDirectory(),
    ]);
    state.snapshots = Array.isArray(snapshots) ? snapshots : [];
    state.directory = directory || "";
    state.filter = "";
    renderListView();
  } catch (error) {
    refs.subtitle.textContent = "";
    showError("读取快照失败: " + formatError(error));
    refs.body.replaceChildren(
      createMessage("读取快照失败", formatError(error), "error")
    );
  } finally {
    setBusy(false);
  }
}

function renderListView() {
  const { snapshots, directory } = state;
  const totalBytes = snapshots.reduce(
    (sum, snapshot) =>
      sum + (snapshot.corrupt ? 0 : Number(snapshot.totalBytes) || 0),
    0
  );
  refs.subtitle.textContent = snapshots.length
    ? `共 ${snapshots.length} 个快照 · 占用 ${formatBytes(totalBytes)}`
    : "还没有快照";

  refs.body.replaceChildren();

  const toolbar = document.createElement("div");
  toolbar.className = "snapshot-toolbar";

  if (snapshots.length) {
    const search = document.createElement("div");
    search.className = "snapshot-search";
    search.appendChild(createIcon("search"));
    const input = document.createElement("input");
    input.className = "form-input";
    input.type = "search";
    input.placeholder = "搜索快照名称...";
    input.value = state.filter;
    input.addEventListener("input", () => {
      state.filter = input.value.trim().toLowerCase();
      renderListRows();
    });
    search.appendChild(input);
    toolbar.appendChild(search);
  }

  const toolbarActions = document.createElement("div");
  toolbarActions.className = "snapshot-toolbar-actions";

  const createBtn = createButton("新建快照", "btn btn-primary", () =>
    showCreate()
  );
  createBtn.prepend(createIcon("plus"));

  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.className = "btn btn-outline btn-icon-only";
  openBtn.title = "打开存储位置";
  openBtn.setAttribute("aria-label", "打开存储位置");
  openBtn.appendChild(createIcon("folder"));
  openBtn.addEventListener("click", async () => {
    try {
      await OpenSnapshotDirectory();
    } catch (error) {
      showError("打开存储位置失败: " + formatError(error));
    }
  });

  toolbarActions.append(createBtn, openBtn);
  toolbar.appendChild(toolbarActions);
  refs.body.appendChild(toolbar);

  const rows = document.createElement("div");
  rows.className = "snapshot-rows";
  refs.body.appendChild(rows);
  renderListRows();

  setFooter(directory ? `存储位置：${directory}` : "", []);
}

function renderListRows() {
  const container = refs.body.querySelector(".snapshot-rows");
  if (!container) return;
  container.replaceChildren();

  const { snapshots, filter } = state;
  if (!snapshots.length) {
    container.appendChild(createEmptyState());
    return;
  }

  const visible = filter
    ? snapshots.filter((snapshot) =>
        (snapshot.name || snapshot.id || "").toLowerCase().includes(filter)
      )
    : snapshots;

  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "snapshot-filter-empty";
    empty.textContent = `没有匹配“${state.filter}”的快照`;
    container.appendChild(empty);
    return;
  }

  visible.forEach((snapshot) => {
    container.appendChild(createSnapshotRow(snapshot));
  });
}

function createSnapshotRow(snapshot) {
  const row = document.createElement("section");
  row.className = "snapshot-row";
  if (snapshot.corrupt) row.classList.add("is-corrupt");

  const iconWrap = document.createElement("div");
  iconWrap.className = "snapshot-row-icon";
  if (snapshot.corrupt) {
    iconWrap.classList.add("is-corrupt");
    iconWrap.appendChild(createIcon("alert"));
  } else if (snapshot.type === "full") {
    iconWrap.classList.add("is-full");
    iconWrap.appendChild(createIcon("archive"));
  } else {
    iconWrap.classList.add("is-filename");
    iconWrap.appendChild(createIcon("camera"));
  }

  const main = document.createElement("div");
  main.className = "snapshot-row-main";

  const titleRow = document.createElement("div");
  titleRow.className = "snapshot-row-title";
  const name = document.createElement("h3");
  name.textContent = snapshot.name || snapshot.id;
  name.title = snapshot.name || snapshot.id;
  const badge = document.createElement("span");
  badge.className = "snapshot-type-badge";
  if (snapshot.corrupt) {
    badge.classList.add("is-corrupt");
    badge.textContent = "损坏";
  } else {
    badge.textContent = snapshot.type === "full" ? "完整备份" : "文件名快照";
  }
  titleRow.append(name, badge);

  const meta = document.createElement("p");
  meta.className = "snapshot-row-meta";
  if (snapshot.corrupt) {
    meta.textContent = snapshot.error || "快照清单损坏，无法读取内容";
  } else {
    meta.textContent = `${formatDate(snapshot.createdAt)} · ${snapshot.itemCount} 个 Mod · ${formatBytes(snapshot.totalBytes)}`;
  }
  main.append(titleRow, meta);

  const actions = document.createElement("div");
  actions.className = "snapshot-row-actions";
  if (!snapshot.corrupt) {
    const restoreBtn = createButton("恢复", "btn btn-primary btn-small", () =>
      showPreview(snapshot)
    );
    restoreBtn.prepend(createIcon("history"));
    actions.appendChild(restoreBtn);
  }
  actions.append(
    createRowIconButton("pencil", "重命名", "", () => showRename(snapshot)),
    createRowIconButton("trash", "删除", "is-danger", () =>
      confirmDeleteSnapshot(snapshot)
    )
  );

  row.append(iconWrap, main, actions);
  return row;
}

function createRowIconButton(iconName, label, extraClass, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "snapshot-icon-btn";
  if (extraClass) button.classList.add(extraClass);
  button.title = label;
  button.setAttribute("aria-label", label);
  button.appendChild(createIcon(iconName));
  button.addEventListener("click", onClick);
  return button;
}

function createEmptyState() {
  const empty = document.createElement("div");
  empty.className = "snapshot-empty";
  const iconWrap = document.createElement("div");
  iconWrap.className = "snapshot-empty-icon";
  iconWrap.appendChild(createIcon("camera"));
  const title = document.createElement("strong");
  title.textContent = "暂无快照";
  const text = document.createElement("p");
  text.textContent =
    "创建快照以保存当前的 Mod 启用状态，整理或更新前也可以做完整备份。";
  const action = createButton("新建快照", "btn btn-primary", () =>
    showCreate()
  );
  action.prepend(createIcon("plus"));
  empty.append(iconWrap, title, text, action);
  return empty;
}

function showCreate() {
  setView("create", {
    title: "新建快照",
    subtitle: "选择快照类型，创建后可随时从列表恢复",
    showBack: true,
  });
  refs.body.replaceChildren();

  let kind = "filename";
  let nameEdited = false;

  const form = document.createElement("div");
  form.className = "snapshot-create";

  const kindFieldset = document.createElement("fieldset");
  kindFieldset.className = "snapshot-kind-selector";
  const kindLegend = document.createElement("legend");
  kindLegend.textContent = "快照类型";
  const kindOptions = document.createElement("div");
  kindOptions.className = "snapshot-kind-options";
  Object.entries(SNAPSHOT_KINDS).forEach(([value, config]) => {
    kindOptions.appendChild(createKindOption(value, config, value === kind));
  });
  kindFieldset.append(kindLegend, kindOptions);

  const detail = document.createElement("div");
  detail.className = "snapshot-kind-detail";
  const updateDetail = (nextKind) => {
    const config = SNAPSHOT_KINDS[nextKind];
    detail.replaceChildren();
    const heading = document.createElement("div");
    heading.className = "snapshot-kind-detail-title";
    heading.append(
      createIcon("info"),
      createTextElement("strong", config.detailTitle)
    );
    const list = document.createElement("ul");
    config.points.forEach((point) => {
      const item = document.createElement("li");
      item.textContent = point;
      list.appendChild(item);
    });
    detail.append(heading, list);
  };

  const warning = document.createElement("div");
  warning.className = "snapshot-form-warning";
  const workshopCount = (appState.allVpkFiles || []).filter(
    (file) => file.location === "workshop"
  ).length;
  if (workshopCount > 0) {
    warning.append(
      createIcon("alert"),
      createTextElement(
        "span",
        `创意工坊目录中有 ${workshopCount} 个 VPK 不在快照范围内，建议先转移到根目录。`
      )
    );
  } else {
    warning.classList.add("hidden");
  }

  const nameField = document.createElement("div");
  nameField.className = "snapshot-name-field";
  const label = document.createElement("label");
  label.className = "snapshot-form-label";
  label.textContent = "快照名称";
  label.htmlFor = "snapshot-name-input";
  const input = document.createElement("input");
  input.className = "form-input";
  input.id = "snapshot-name-input";
  input.type = "text";
  input.maxLength = 80;
  input.value = defaultSnapshotName(kind);
  input.addEventListener("input", () => {
    nameEdited = true;
  });
  nameField.append(label, input);

  kindFieldset.addEventListener("change", (event) => {
    if (event.target?.name !== "snapshot-kind" || !event.target.checked) return;
    kind = event.target.value;
    updateDetail(kind);
    if (!nameEdited) input.value = defaultSnapshotName(kind);
  });
  updateDetail(kind);

  form.append(kindFieldset, detail, warning, nameField);
  refs.body.appendChild(form);

  setFooter("", [
    createButton("取消", "btn btn-secondary", () => showList()),
    createButton("创建快照", "btn btn-primary", async (button) => {
      const name = input.value.trim();
      if (!name) {
        showError("快照名称不能为空");
        input.focus();
        return;
      }
      setButtonPending(button, "正在创建...");
      setBusy(true);
      showProgress("正在准备...");
      listenProgress("snapshot_progress");
      try {
        await CreateSnapshot(name, kind);
        showNotification(
          kind === "full" ? "完整备份已创建" : "文件名快照已创建",
          "success"
        );
        await showList();
      } catch (error) {
        showError("创建快照失败: " + formatError(error));
        setButtonReady(button, "创建快照");
      } finally {
        hideProgress();
        cleanupProgressListener();
        setBusy(false);
      }
    }),
  ]);
  input.focus();
  input.select();
}

function createKindOption(value, config, checked) {
  const option = document.createElement("label");
  option.className = "snapshot-kind-option";
  const input = document.createElement("input");
  input.type = "radio";
  input.name = "snapshot-kind";
  input.value = value;
  input.checked = checked;
  const iconWrap = document.createElement("span");
  iconWrap.className = `snapshot-kind-option-icon is-${value}`;
  iconWrap.appendChild(createIcon(value === "full" ? "archive" : "camera"));
  const content = document.createElement("span");
  content.className = "snapshot-kind-option-text";
  const title = document.createElement("strong");
  title.textContent = config.title;
  const description = document.createElement("small");
  description.textContent = config.short;
  content.append(title, description);
  option.append(input, iconWrap, content);
  return option;
}

function showRename(snapshot) {
  setView("rename", {
    title: "重命名快照",
    subtitle: snapshot.name || snapshot.id,
    showBack: true,
  });
  refs.body.replaceChildren();

  const form = document.createElement("div");
  form.className = "snapshot-create";
  const nameField = document.createElement("div");
  nameField.className = "snapshot-name-field";
  const label = document.createElement("label");
  label.className = "snapshot-form-label";
  label.textContent = "快照名称";
  label.htmlFor = "snapshot-rename-input";
  const input = document.createElement("input");
  input.className = "form-input";
  input.id = "snapshot-rename-input";
  input.type = "text";
  input.maxLength = 80;
  input.value = snapshot.name || "";
  nameField.append(label, input);
  form.appendChild(nameField);
  refs.body.appendChild(form);

  setFooter("", [
    createButton("取消", "btn btn-secondary", () => showList()),
    createButton("保存", "btn btn-primary", async (button) => {
      const name = input.value.trim();
      if (!name) {
        showError("快照名称不能为空");
        input.focus();
        return;
      }
      setButtonPending(button, "正在保存...");
      try {
        await RenameSnapshot(snapshot.id, name);
        showNotification("快照名称已更新", "success");
        await showList();
      } catch (error) {
        showError("重命名失败: " + formatError(error));
        setButtonReady(button, "保存");
      }
    }),
  ]);
  input.focus();
  input.select();
}

function confirmDeleteSnapshot(snapshot) {
  showConfirmModal(
    "删除快照",
    `确定删除“${snapshot.name || snapshot.id}”吗？快照将移动到回收站，不会影响 addons 中的 Mod。`,
    async () => {
      try {
        await DeleteSnapshot(snapshot.id);
        showNotification("快照已移至回收站", "success");
        await showList();
      } catch (error) {
        showError("删除快照失败: " + formatError(error));
        return false;
      }
      return true;
    }
  );
}

async function showPreview(snapshot) {
  setView("preview", {
    title: "恢复预览",
    subtitle: snapshot.name || snapshot.id,
    showBack: true,
  });
  setFooter("", []);
  refs.body.replaceChildren(
    createLoading("正在生成恢复计划", "此过程只读取文件，不会修改 addons。")
  );
  setBusy(true);
  showProgress("正在检查快照...");
  listenProgress("snapshot_restore_progress");

  try {
    const plan = await PreviewSnapshotRestore(snapshot.id);
    renderRestorePlan(plan);
  } catch (error) {
    showError("生成恢复预览失败: " + formatError(error));
    await showList();
  } finally {
    hideProgress();
    cleanupProgressListener();
    setBusy(false);
  }
}

function renderRestorePlan(plan) {
  refs.body.replaceChildren();
  state.previewFilter = "all";
  state.actionFoldOverrides = new Map();
  state.planActions = Array.isArray(plan.actions) ? plan.actions : [];

  const intro = document.createElement("p");
  intro.className = "snapshot-preview-intro";
  intro.textContent = `确认后将按以下计划恢复“${plan.snapshotName}”，执行前会再次校验文件状态。`;
  refs.body.appendChild(intro);

  appendMessageBox(refs.body, plan.blockers, "error", "无法执行恢复");
  appendMessageBox(refs.body, plan.warnings, "warning", "注意事项");

  const actionsHeading = document.createElement("div");
  actionsHeading.className = "snapshot-actions-heading";
  actionsHeading.append(
    createTextElement("h3", `恢复计划（${state.planActions.length} 项）`),
    createFilterChips(state.planActions)
  );
  refs.body.appendChild(actionsHeading);

  const list = document.createElement("div");
  list.className = "snapshot-action-list";
  refs.body.appendChild(list);
  renderActionRows(list);

  const executeButton = createButton(
    plan.canExecute ? "确认并执行恢复" : "存在阻塞项",
    "btn btn-primary",
    async (button) => {
      if (!plan.canExecute) return;
      setButtonPending(button, "正在恢复...");
      setBusy(true);
      showProgress("正在恢复，请勿关闭窗口...", { indeterminate: true });
      try {
        const result = await ExecuteSnapshotRestore(plan.id);
        const warning = result.warnings?.length
          ? `。${result.warnings.join("；")}`
          : "";
        showNotification(result.message + warning, "success");
        if (typeof state.refreshFilesKeepFilter === "function") {
          await state.refreshFilesKeepFilter();
        }
        hideProgress();
        await showList();
      } catch (error) {
        showError("恢复失败: " + formatError(error));
        hideProgress();
        setButtonReady(button, "确认并执行恢复");
      } finally {
        setBusy(false);
      }
    }
  );
  if (!plan.canExecute) executeButton.disabled = true;

  setFooter(plan.targetRoot ? `目标目录：${plan.targetRoot}` : "", [
    createButton("返回列表", "btn btn-secondary", () => showList()),
    executeButton,
  ]);
}

function createFilterChips(actions) {
  const counts = new Map();
  actions.forEach((action) => {
    actionKinds(action).forEach((kind) => {
      counts.set(kind, (counts.get(kind) || 0) + 1);
    });
  });

  const wrap = document.createElement("div");
  wrap.className = "snapshot-chips";
  wrap.appendChild(createChip("全部", actions.length, "all"));
  [
    "enable",
    "disable",
    "add",
    "overwrite",
    "cleanup",
    "missing",
    "skip",
    "addonlist",
  ].forEach((kind) => {
    if (!counts.has(kind)) return;
    wrap.appendChild(createChip(actionKindLabel(kind), counts.get(kind), kind));
  });
  return wrap;
}

function createChip(label, count, kind) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "snapshot-chip";
  chip.dataset.kind = kind;
  if (state.previewFilter === kind) chip.classList.add("is-active");
  chip.append(
    createTextElement("span", label),
    createTextElement("strong", String(count))
  );
  chip.addEventListener("click", () => {
    state.previewFilter = kind;
    chip.parentElement
      ?.querySelectorAll(".snapshot-chip")
      .forEach((item) => item.classList.toggle("is-active", item === chip));
    const list = refs.body.querySelector(".snapshot-action-list");
    if (list) renderActionRows(list);
  });
  return chip;
}

function renderActionRows(list) {
  const actions = state.planActions || [];
  list.replaceChildren();

  if (!actions.length) {
    list.appendChild(
      createMessage("没有需要执行的变化", "当前状态已经与快照计划一致。")
    );
    return;
  }

  const visible =
    state.previewFilter === "all"
      ? actions
      : actions.filter((action) =>
          actionKinds(action).includes(state.previewFilter)
        );

  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "snapshot-filter-empty";
    empty.textContent = "该类型下没有恢复动作";
    list.appendChild(empty);
    return;
  }
  visible.forEach((action) => list.appendChild(createActionRow(action)));
}

function createActionRow(action) {
  const row = document.createElement("div");
  row.className = "snapshot-action-row";
  if (action.destructive) row.classList.add("is-destructive");

  const badge = document.createElement("span");
  badge.className = `snapshot-action-badge is-${action.kind}`;
  badge.textContent = actionKindLabel(action.kind);

  const files = Array.isArray(action.files) ? action.files : [];
  const main = document.createElement("div");
  main.className = "snapshot-action-main";
  const title = document.createElement("strong");
  title.textContent = action.modName || action.fileName || "addonlist.txt";
  title.title = title.textContent;
  main.appendChild(title);
  if (files.length > 1) {
    const summary = document.createElement("span");
    summary.textContent = describeActionFiles(files);
    summary.title = summary.textContent;
    main.appendChild(summary);
  } else if (action.detail) {
    const detail = document.createElement("span");
    detail.textContent = action.detail;
    detail.title = detail.textContent;
    main.appendChild(detail);
  }

  const size = document.createElement("span");
  size.className = "snapshot-action-size";
  size.textContent = action.size ? formatBytes(action.size) : "";

  row.append(badge, main, size);
  if (files.length > 1) {
    row.classList.add("is-collapsible");
    const chevron = document.createElement("span");
    chevron.className = "snapshot-action-chevron";
    chevron.appendChild(createIcon("chevron"));
    row.append(chevron, createActionFileList(files));

    const toggle = () => {
      const expanded = !row.classList.contains("is-expanded");
      setActionExpanded(action, row, expanded);
    };
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.addEventListener("click", toggle);
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggle();
    });
    setActionExpanded(action, row, isActionExpanded(action));
  }
  return row;
}

function actionKey(action) {
  return String(action.modName || action.fileName || "").toLowerCase();
}

// 动作类型一致的多文件 Mod 默认收起，混合类型的默认展开。
function isActionExpanded(action) {
  const key = actionKey(action);
  if (state.actionFoldOverrides.has(key)) {
    return state.actionFoldOverrides.get(key);
  }
  return actionKinds(action).length > 1;
}

function setActionExpanded(action, row, expanded) {
  state.actionFoldOverrides.set(actionKey(action), expanded);
  row.classList.toggle("is-expanded", expanded);
  row.setAttribute("aria-expanded", expanded ? "true" : "false");
  const chevron = row.querySelector(".snapshot-action-chevron");
  if (chevron) chevron.title = expanded ? "收起文件明细" : "展开文件明细";
}

function createActionFileList(files) {
  const list = document.createElement("div");
  list.className = "snapshot-action-files";
  files.forEach((file) => {
    const row = document.createElement("div");
    row.className = "snapshot-file-row";

    const kind = document.createElement("span");
    kind.className = `snapshot-action-badge is-${file.kind}`;
    kind.textContent = actionKindLabel(file.kind);

    const main = document.createElement("div");
    main.className = "snapshot-file-main";
    const name = document.createElement("strong");
    name.textContent = file.fileName;
    name.title = file.fileName;
    main.appendChild(name);
    if (file.detail) {
      const detail = document.createElement("span");
      detail.textContent = file.detail;
      detail.title = file.detail;
      main.appendChild(detail);
    }

    const size = document.createElement("span");
    size.className = "snapshot-file-size";
    size.textContent = file.size ? formatBytes(file.size) : "";

    row.append(kind, main, size);
    list.appendChild(row);
  });
  return list;
}

function actionKinds(action) {
  const kinds = Array.isArray(action.kinds)
    ? action.kinds.filter(Boolean)
    : [];
  if (kinds.length) return kinds;
  return action.kind ? [action.kind] : [];
}

function describeActionFiles(files) {
  const counts = new Map();
  files.forEach((file) => {
    counts.set(file.kind, (counts.get(file.kind) || 0) + 1);
  });
  const parts = [];
  counts.forEach((count, kind) => {
    parts.push(`${actionKindLabel(kind)} ${count}`);
  });
  return `包含 ${files.length} 个文件 · ${parts.join(" · ")}`;
}

function createIcon(name) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "icon-svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  (ICONS[name] || []).forEach(([tag, attrs]) => {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([key, value]) =>
      node.setAttribute(key, String(value))
    );
    svg.appendChild(node);
  });
  return svg;
}

function createTextElement(tag, text) {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}

function createButton(label, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", () => onClick(button));
  return button;
}

function createLoading(titleText, messageText = "") {
  const box = document.createElement("div");
  box.className = "snapshot-loading";
  const spinner = document.createElement("div");
  spinner.className = "loading-spinner";
  box.appendChild(spinner);
  box.appendChild(createTextElement("strong", titleText));
  if (messageText) {
    const text = document.createElement("p");
    text.textContent = messageText;
    box.appendChild(text);
  }
  return box;
}

function createMessage(titleText, messageText, type = "") {
  const box = document.createElement("div");
  box.className = "snapshot-message";
  if (type) box.classList.add(`is-${type}`);
  box.append(
    createTextElement("strong", titleText),
    createTextElement("p", messageText)
  );
  return box;
}

function appendMessageBox(container, messages, type, label) {
  if (!messages?.length) return;
  const section = document.createElement("div");
  section.className = `snapshot-message-box is-${type}`;
  const heading = document.createElement("strong");
  heading.textContent = label;
  const list = document.createElement("ul");
  messages.forEach((message) => {
    const item = document.createElement("li");
    item.textContent = message;
    list.appendChild(item);
  });
  section.append(heading, list);
  container.appendChild(section);
}

function showProgress(message, { indeterminate = false } = {}) {
  refs.progress.classList.remove("hidden");
  refs.progressFill.classList.toggle("is-indeterminate", indeterminate);
  refs.progressFill.style.width = indeterminate ? "" : "0%";
  refs.progressMessage.textContent = message || "";
  refs.progressCount.textContent = "";
}

function updateProgress(progress) {
  const current = Number(progress?.current || 0);
  const total = Number(progress?.total || 0);
  if (progress?.message) refs.progressMessage.textContent = progress.message;
  if (total > 0) {
    refs.progressFill.classList.remove("is-indeterminate");
    const percent = Math.min(100, Math.round((current / total) * 100));
    refs.progressFill.style.width = `${percent}%`;
    refs.progressCount.textContent = `${current}/${total}`;
  }
}

function hideProgress() {
  refs.progress.classList.add("hidden");
  refs.progressFill.classList.remove("is-indeterminate");
  refs.progressFill.style.width = "0%";
}

function listenProgress(eventName) {
  cleanupProgressListener();
  progressCleanup = EventsOn(eventName, (progress) => updateProgress(progress));
}

function cleanupProgressListener() {
  if (typeof progressCleanup === "function") progressCleanup();
  progressCleanup = null;
}

function setBusy(value) {
  busy = Boolean(value);
  modal?.classList.toggle("is-busy", busy);
  if (refs) setFooterDisabled(busy);
}

function setButtonPending(button, label) {
  if (!button) return;
  button.disabled = true;
  button.dataset.originalText = button.textContent;
  button.textContent = label;
}

function setButtonReady(button, label) {
  if (!button) return;
  button.disabled = false;
  button.textContent = label || button.dataset.originalText || "确定";
}

function defaultSnapshotName(kind) {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate()
  )} ${pad(now.getHours())}-${pad(now.getMinutes())}`;
  return `${kind === "full" ? "完整备份" : "文件名快照"} ${stamp}`;
}

function actionKindLabel(kind) {
  const labels = {
    enable: "启用",
    disable: "禁用",
    add: "新增",
    overwrite: "覆盖",
    cleanup: "清理",
    skip: "跳过",
    missing: "缺失",
    addonlist: "列表",
  };
  return labels[kind] || kind;
}

function formatDate(value) {
  if (!value) return "未知时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatBytes(value) {
  const size = Number(value || 0);
  if (size < 1024) return `${size} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let number = size / 1024;
  let index = 0;
  while (number >= 1024 && index < units.length - 1) {
    number /= 1024;
    index++;
  }
  return `${number.toFixed(number >= 10 ? 0 : 1)} ${units[index]}`;
}

function formatError(error) {
  return String(error?.message || error || "未知错误");
}
