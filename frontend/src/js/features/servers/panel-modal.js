let showError;
let showNotification;
let showConfirmModal;
let FetchPanelServerStatus;
let RestartPanelServer;
let FetchPanelMapList;
let ClearPanelMaps;
let ChangePanelMap;
let SendPanelRconCommand;
let SelectPanelMapUploadFiles;
let StartPanelMapUpload;
let GetPanelMapUploadTasks;
let RetryPanelMapUpload;
let CancelPanelMapUpload;
let ClearCompletedPanelMapUploads;
let BrowserOpenURL;
let resolveMapName;
let escapeHtml;
let escapeAttr;
let getIPHost;
let getServers;
let SERVER_ICONS;
let PANEL_MODE_LABELS;
let OFFICIAL_CAMPAIGNS;

export function configurePanelModal(deps) {
  ({
    showError,
    showNotification,
    showConfirmModal,
    FetchPanelServerStatus,
    RestartPanelServer,
    FetchPanelMapList,
    ClearPanelMaps,
    ChangePanelMap,
    SendPanelRconCommand,
    SelectPanelMapUploadFiles,
    StartPanelMapUpload,
    GetPanelMapUploadTasks,
    RetryPanelMapUpload,
    CancelPanelMapUpload,
    ClearCompletedPanelMapUploads,
    BrowserOpenURL,
    resolveMapName,
    escapeHtml,
    escapeAttr,
    getIPHost,
    getServers,
    SERVER_ICONS,
    PANEL_MODE_LABELS,
    OFFICIAL_CAMPAIGNS,
  } = deps);
}

let currentPanelServer = null;
let currentPanelServerIndex = -1;
let currentPanelMaps = [];
let panelOfficialMapsHidden = false;
const completedPanelUploadNotifications = new Set();

const PANEL_UPLOAD_ICON = `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>`;
const PANEL_CANCEL_ICON = `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
const PANEL_RETRY_ICON = `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"></path><path d="M21 3v6h-6"></path></svg>`;

export function openPanelServerDetailsModal(index) {
  const server = getServers()[index];
  if (!server) return;

  currentPanelServer = server;
  currentPanelServerIndex = index;

  const modal = document.getElementById("panel-server-details-modal");
  const title = document.getElementById("panel-details-server-name");
  const loading = document.getElementById("panel-details-loading");
  const content = document.getElementById("panel-details-content");
  const error = document.getElementById("panel-details-error");

  title.textContent = server.name;
  loading.textContent = "正在获取玩家信息...";
  loading.classList.remove("hidden");
  content.classList.add("hidden");
  error.classList.add("hidden");
  error.innerHTML = "";
  modal.classList.remove("hidden");

  loadPanelStatus(server);
}

export function closePanelServerDetailsModal() {
  document.getElementById("panel-server-details-modal")?.classList.add("hidden");
  currentPanelServer = null;
  currentPanelServerIndex = -1;
}

async function loadPanelStatus(server = currentPanelServer) {
  if (!server) return;

  const loading = document.getElementById("panel-details-loading");
  const content = document.getElementById("panel-details-content");
  const error = document.getElementById("panel-details-error");
  const refreshBtn = document.getElementById("panel-refresh-btn");

  loading.classList.remove("hidden");
  content.classList.add("hidden");
  error.classList.add("hidden");
  error.innerHTML = "";
  refreshBtn?.setAttribute("disabled", "true");

  try {
    const status = await FetchPanelServerStatus(server.id);
    await renderPanelStatus(server, status || {});
    loading.classList.add("hidden");
    content.classList.remove("hidden");
  } catch (err) {
    console.error("获取面板状态失败:", err);
    loading.classList.add("hidden");
    error.textContent = "获取面板状态失败: " + err;
    error.classList.remove("hidden");
    renderPanelStatusError(err);
  } finally {
    refreshBtn?.removeAttribute("disabled");
  }
}

function renderPanelStatusError(err) {
  const error = document.getElementById("panel-details-error");
  if (!error) return;

  error.innerHTML = `
    <div class="panel-error-content">
      <span>获取面板状态失败: ${escapeHtml(err)}</span>
      <button id="panel-details-retry-btn" class="btn btn-secondary btn-small panel-action-btn" type="button">
        刷新
      </button>
    </div>
  `;
  error
    .querySelector("#panel-details-retry-btn")
    ?.addEventListener("click", refreshCurrentPanelStatus);
  error.classList.remove("hidden");
}

async function renderPanelStatus(server, status) {
  const summary = document.getElementById("panel-status-summary");
  const playerList = document.getElementById("panel-player-list");
  const rawMap = status.map || "Unknown";
  let displayMap = rawMap;
  try {
    const resolved = await resolveMapName(rawMap);
    if (resolved && resolved !== rawMap) {
      displayMap = resolved;
    }
  } catch {
    displayMap = rawMap;
  }

  summary.innerHTML = `
    ${renderPanelStatusItem("服务器", status.hostname || server.name)}
    ${renderPanelStatusItem("地图", displayMap, rawMap)}
    ${renderPanelStatusItem("玩家", status.players || "0/0")}
    ${renderPanelStatusItem("模式", status.gameMode || "未知")}
    ${renderPanelStatusItem("难度", status.difficulty || "未知")}
  `;

  const users = Array.isArray(status.users) ? status.users : [];
  if (users.length === 0) {
    playerList.innerHTML =
      '<tr><td colspan="6" class="empty-state">暂无在线玩家</td></tr>';
    return;
  }

  playerList.innerHTML = users
    .map(
      (user) => `
        <tr>
          <td class="player-name">${escapeHtml(user.name || "Unknown")}</td>
          <td class="panel-player-steamid">${escapeHtml(user.steamid || "-")}</td>
          <td>${escapeHtml(user.location || getIPHost(user.ip) || "-")}</td>
          <td class="text-right">${Number(user.delay) || 0}ms</td>
          <td class="text-right">${Number(user.loss) || 0}%</td>
          <td class="text-right">${escapeHtml(user.duration || "-")}</td>
        </tr>
      `
    )
    .join("");
}

function renderPanelStatusItem(label, value, title = "") {
  return `
    <div class="server-info-item panel-status-item" title="${escapeAttr(title || value)}">
      <span class="server-info-label">${escapeHtml(label)}</span>
      <span class="server-info-value">${escapeHtml(value)}</span>
    </div>
  `;
}

export function refreshCurrentPanelStatus() {
  loadPanelStatus(currentPanelServer);
}

export function restartCurrentPanelServer() {
  if (!currentPanelServer) return;
  showConfirmModal(
    "重启服务器",
    `确定要重启 "${currentPanelServer.name}" 吗？当前玩家会断开连接。`,
    async () => {
      const btn = document.getElementById("panel-restart-btn");
      btn.disabled = true;
      try {
        const text = await RestartPanelServer(currentPanelServer.id);
        showNotification(text || "重启指令已发送", "success");
      } catch (err) {
        console.error("重启失败:", err);
        showError("重启失败: " + err);
      } finally {
        btn.disabled = false;
      }
    }
  );
}

export function openCurrentPanelInBrowser() {
  if (!currentPanelServer?.panelUrl) return;
  if (typeof BrowserOpenURL === "function") {
    BrowserOpenURL(currentPanelServer.panelUrl);
  }
}

export function openPanelMapModal() {
  if (!currentPanelServer) return;
  const modal = document.getElementById("panel-map-modal");
  const title = document.getElementById("panel-map-title");
  const search = document.getElementById("panel-map-search");
  title.textContent = `切换地图 - ${currentPanelServer.name}`;
  search.value = "";
  currentPanelMaps = [];
  updatePanelOfficialToggle();
  modal.classList.remove("hidden");
  loadPanelMaps();
}

export function closePanelMapModal() {
  document.getElementById("panel-map-modal")?.classList.add("hidden");
}

async function loadPanelMaps() {
  if (!currentPanelServer) return;
  const loading = document.getElementById("panel-map-loading");
  const list = document.getElementById("panel-map-list");
  const refreshBtn = document.getElementById("panel-map-refresh-btn");
  loading.classList.remove("hidden");
  list.innerHTML = "";
  refreshBtn.disabled = true;

  try {
    const customMaps = await FetchPanelMapList(currentPanelServer.id);
    currentPanelMaps = [
      ...OFFICIAL_CAMPAIGNS.map((campaign) => normalizeCampaign(campaign, false)),
      ...(Array.isArray(customMaps) ? customMaps : []).map((campaign) =>
        normalizeCampaign(campaign, true)
      ),
    ];
    renderPanelMapList();
  } catch (err) {
    console.error("获取地图列表失败:", err);
    list.innerHTML = `<div class="panel-error-box">获取地图列表失败: ${escapeHtml(err)}</div>`;
  } finally {
    loading.classList.add("hidden");
    refreshBtn.disabled = false;
  }
}

export function openPanelUploadModal() {
  if (!currentPanelServer) return;

  const modal = document.getElementById("panel-upload-modal");
  const title = document.getElementById("panel-upload-title");
  if (title) {
    title.textContent = `地图 - ${currentPanelServer.name}`;
  }
  modal?.classList.remove("hidden");
  refreshPanelUploadTasks();
}

export function closePanelUploadModal() {
  document.getElementById("panel-upload-modal")?.classList.add("hidden");
}

async function selectPanelUploadFiles() {
  if (!currentPanelServer) {
    showError("请先打开已配置面板的服务器详情");
    return;
  }

  const btn = document.getElementById("panel-select-upload-files-btn");
  btn?.setAttribute("disabled", "true");
  try {
    const paths = await SelectPanelMapUploadFiles();
    if (!paths || paths.length === 0) return;

    await StartPanelMapUpload(currentPanelServer.id, paths);
    showNotification(`已添加 ${paths.length} 个上传任务`, "success");
    await refreshPanelUploadTasks();
  } catch (err) {
    console.error("添加上传任务失败:", err);
    showError("添加上传任务失败: " + err);
  } finally {
    btn?.removeAttribute("disabled");
  }
}

export async function refreshPanelUploadTasks() {
  const list = document.getElementById("panel-upload-tasks-list");
  if (!list || typeof GetPanelMapUploadTasks !== "function") return;

  try {
    const tasks = await GetPanelMapUploadTasks();
    renderPanelUploadTasks(tasks || []);
  } catch (err) {
    console.error("刷新上传任务失败:", err);
    list.innerHTML = `<div class="panel-error-box">刷新上传任务失败: ${escapeHtml(err)}</div>`;
  }
}

function renderPanelUploadTasks(tasks) {
  const list = document.getElementById("panel-upload-tasks-list");
  if (!list) return;

  if (!tasks || tasks.length === 0) {
    list.innerHTML = `
      <div class="panel-upload-empty">
        <div class="panel-upload-empty-icon">${PANEL_UPLOAD_ICON}</div>
        <div class="panel-upload-empty-title">暂无上传任务</div>
        <div class="panel-upload-empty-text">选择 .vpk 或压缩包后，任务会显示在这里。</div>
      </div>
    `;
    return;
  }

  list.innerHTML = "";
  tasks.forEach((task) => {
    list.appendChild(createPanelUploadTaskElement(task));
    handlePanelUploadCompletion(task);
  });
}

function createPanelUploadTaskElement(task) {
  const div = document.createElement("div");
  const status = task.status || "pending";
  div.id = `panel-upload-task-${task.id}`;
  div.className = `panel-upload-task status-${status}`;
  div.dataset.status = status;

  const progress = Number(task.progress) || 0;
  const isActive = ["pending", "compressing", "uploading", "merging"].includes(status);
  const canRetry = status === "failed" || status === "cancelled";
  const actionHtml = isActive
    ? `
      <button class="panel-upload-icon-btn panel-upload-cancel-btn" data-id="${escapeAttr(task.id)}" title="取消上传" type="button">
        ${PANEL_CANCEL_ICON}
      </button>
    `
    : canRetry
      ? `
        <button class="panel-upload-icon-btn panel-upload-retry-btn" data-id="${escapeAttr(task.id)}" title="继续上传" type="button">
          ${PANEL_RETRY_ICON}
        </button>
      `
      : "";

  div.innerHTML = `
    <div class="panel-upload-task-icon">${PANEL_UPLOAD_ICON}</div>
    <div class="panel-upload-task-main">
      <div class="panel-upload-task-top">
        <div class="panel-upload-task-title" title="${escapeAttr(task.filename || "")}">
          ${escapeHtml(task.filename || "Unknown")}
        </div>
        <div class="panel-upload-task-actions">
          <span class="panel-upload-status">${getPanelUploadStatusText(status)}</span>
          ${actionHtml}
        </div>
      </div>
      <div class="panel-upload-task-meta">
        <span title="${escapeAttr(task.server_name || "")}">${escapeHtml(task.server_name || "面板服务器")}</span>
        <span>${formatPanelUploadBytes(task.uploaded_size || 0)} / ${formatPanelUploadBytes(task.total_size || 0)}</span>
        ${task.speed ? `<span>${escapeHtml(task.speed)}</span>` : ""}
      </div>
      <div class="panel-upload-progress">
        <div class="panel-upload-progress-fill" style="width: ${progress}%"></div>
      </div>
      <div class="panel-upload-task-foot">
        <span>${task.total_chunks ? `${(task.uploaded_chunks || []).length}/${task.total_chunks} 分片` : "等待初始化"}</span>
        <span class="panel-upload-percent">${progress}%</span>
      </div>
      ${task.error ? `<div class="panel-upload-error">${escapeHtml(task.error)}</div>` : ""}
    </div>
  `;

  div.querySelector(".panel-upload-cancel-btn")?.addEventListener("click", (event) => {
    event.stopPropagation();
    showConfirmModal("取消上传", "确定要取消这个上传任务吗？", async () => {
      try {
        await CancelPanelMapUpload(task.id);
        showNotification("上传任务已取消", "info");
      } catch (err) {
        console.error("取消上传失败:", err);
        showError("取消上传失败: " + err);
      }
    });
  });

  div.querySelector(".panel-upload-retry-btn")?.addEventListener("click", async (event) => {
    event.stopPropagation();
    try {
      await RetryPanelMapUpload(task.id);
      showNotification("上传任务已继续", "success");
    } catch (err) {
      console.error("继续上传失败:", err);
      showError("继续上传失败: " + err);
    }
  });

  return div;
}

export function updatePanelUploadTaskInList(task) {
  const existing = document.getElementById(`panel-upload-task-${task.id}`);
  if (existing) {
    existing.replaceWith(createPanelUploadTaskElement(task));
  } else if (isPanelUploadModalOpen()) {
    refreshPanelUploadTasks();
  }
  handlePanelUploadCompletion(task);
}

export function updatePanelUploadProgress(task) {
  const existing = document.getElementById(`panel-upload-task-${task.id}`);
  if (!existing) {
    if (isPanelUploadModalOpen()) refreshPanelUploadTasks();
    return;
  }

  existing.dataset.status = task.status || "uploading";
  existing.className = `panel-upload-task status-${task.status || "uploading"}`;
  const progress = Number(task.progress) || 0;
  const fill = existing.querySelector(".panel-upload-progress-fill");
  const percent = existing.querySelector(".panel-upload-percent");
  const meta = existing.querySelector(".panel-upload-task-meta");
  const foot = existing.querySelector(".panel-upload-task-foot span:first-child");
  const status = existing.querySelector(".panel-upload-status");

  if (fill) fill.style.width = `${progress}%`;
  if (percent) percent.textContent = `${progress}%`;
  if (status) status.textContent = getPanelUploadStatusText(task.status || "uploading");
  if (meta) {
    meta.innerHTML = `
      <span title="${escapeAttr(task.server_name || "")}">${escapeHtml(task.server_name || "面板服务器")}</span>
      <span>${formatPanelUploadBytes(task.uploaded_size || 0)} / ${formatPanelUploadBytes(task.total_size || 0)}</span>
      ${task.speed ? `<span>${escapeHtml(task.speed)}</span>` : ""}
    `;
  }
  if (foot) {
    foot.textContent = task.total_chunks
      ? `${(task.uploaded_chunks || []).length}/${task.total_chunks} 分片`
      : "等待初始化";
  }
}

export function handlePanelUploadTasksCleared() {
  refreshPanelUploadTasks();
}

async function clearCompletedPanelUploads() {
  try {
    await ClearCompletedPanelMapUploads();
    showNotification("已清理完成、失败或取消的上传任务", "success");
  } catch (err) {
    console.error("清理上传任务失败:", err);
    showError("清理上传任务失败: " + err);
  }
}

async function clearPanelMaps() {
  if (!currentPanelServer) {
    showError("请先打开已配置面板的服务器详情");
    return;
  }

  showConfirmModal(
    "清空地图",
    "此操作会清空所有地图，确定继续吗？",
    async () => {
      const btn = document.getElementById("panel-clear-maps-btn");
      btn?.setAttribute("disabled", "true");
      try {
        const text = await ClearPanelMaps(currentPanelServer.id);
        showNotification(text || "地图已清空", "success");
        if (isPanelMapModalOpen()) {
          loadPanelMaps();
        }
      } catch (err) {
        console.error("清空地图失败:", err);
        showError("清空地图失败: " + err);
      } finally {
        btn?.removeAttribute("disabled");
      }
    }
  );
}

function handlePanelUploadCompletion(task) {
  if (task.status !== "completed" || completedPanelUploadNotifications.has(task.id)) {
    return;
  }
  completedPanelUploadNotifications.add(task.id);
  showNotification(`${task.filename || "地图"} 上传成功`, "success");
  if (isPanelMapModalOpen()) {
    loadPanelMaps();
  }
}

function isPanelUploadModalOpen() {
  const modal = document.getElementById("panel-upload-modal");
  return Boolean(modal && !modal.classList.contains("hidden"));
}

function isPanelMapModalOpen() {
  const modal = document.getElementById("panel-map-modal");
  return Boolean(modal && !modal.classList.contains("hidden"));
}

function getPanelUploadStatusText(status) {
  const labels = {
    pending: "等待中",
    compressing: "压缩中",
    uploading: "上传中",
    merging: "处理中",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
  };
  return labels[status] || status || "未知";
}

function formatPanelUploadBytes(bytes, decimals = 2) {
  const value = Number(bytes) || 0;
  if (value <= 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(value) / Math.log(k)), sizes.length - 1);
  return `${parseFloat((value / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

function normalizeCampaign(campaign, isCustom) {
  return {
    title: campaign.title || campaign.Title || "Unknown Campaign",
    vpkName: campaign.vpkName || campaign.VpkName || "",
    isCustom,
    chapters: (campaign.chapters || campaign.Chapters || []).map((chapter) => ({
      code: chapter.code || chapter.Code || "",
      title: chapter.title || chapter.Title || chapter.code || chapter.Code || "",
      modes: chapter.modes || chapter.Modes || [],
    })),
  };
}

export function togglePanelOfficialMaps() {
  panelOfficialMapsHidden = !panelOfficialMapsHidden;
  renderPanelMapList();
}

function updatePanelOfficialToggle() {
  const toggleBtn = document.getElementById("panel-map-official-toggle-btn");
  if (!toggleBtn) return;

  toggleBtn.textContent = panelOfficialMapsHidden ? "显示官方" : "隐藏官方";
  toggleBtn.classList.toggle("active", panelOfficialMapsHidden);
}

function normalizePanelModes(modes) {
  const values = Array.isArray(modes)
    ? modes
    : String(modes || "").split(/[,\s/|]+/);
  return values.map((mode) => String(mode).trim()).filter(Boolean);
}

function getPanelModeLabel(mode) {
  const normalized = String(mode).trim().toLowerCase();
  return PANEL_MODE_LABELS[normalized] || String(mode).trim();
}

function getPanelModeSearchText(modes) {
  return normalizePanelModes(modes)
    .flatMap((mode) => [mode, getPanelModeLabel(mode)])
    .join(" ")
    .toLowerCase();
}

function renderPanelMapModes(modes) {
  const normalizedModes = normalizePanelModes(modes);
  if (normalizedModes.length === 0) return "";

  return `
    <span class="panel-map-mode-list" aria-label="支持模式">
      ${normalizedModes
        .map(
          (mode) =>
            `<span class="panel-map-mode" title="${escapeAttr(mode)}">${escapeHtml(getPanelModeLabel(mode))}</span>`
        )
        .join("")}
    </span>
  `;
}

function renderPanelMapList() {
  const list = document.getElementById("panel-map-list");
  const query = document
    .getElementById("panel-map-search")
    .value.trim()
    .toLowerCase();

  updatePanelOfficialToggle();

  const filtered = currentPanelMaps
    .filter((campaign) => !panelOfficialMapsHidden || campaign.isCustom)
    .map((campaign) => ({
      ...campaign,
      chapters: campaign.chapters.filter((chapter) => {
        if (!query) return true;
        return (
          campaign.title.toLowerCase().includes(query) ||
          chapter.title.toLowerCase().includes(query) ||
          chapter.code.toLowerCase().includes(query) ||
          campaign.vpkName.toLowerCase().includes(query) ||
          getPanelModeSearchText(chapter.modes).includes(query)
        );
      }),
    }))
    .filter((campaign) => campaign.chapters.length > 0);

  if (filtered.length === 0) {
    list.innerHTML = `<div class="panel-empty-state">未找到匹配地图</div>`;
    return;
  }

  list.innerHTML = filtered
    .map(
      (campaign) => `
        <section class="panel-map-campaign">
          <div class="panel-map-campaign-header">
            <div>
              <h4>${escapeHtml(campaign.title)}</h4>
              ${
                campaign.vpkName
                  ? `<span>${escapeHtml(campaign.vpkName)}</span>`
                  : ""
              }
            </div>
            <span class="panel-map-type ${campaign.isCustom ? "custom" : ""}">
              ${campaign.isCustom ? "三方" : "官方"}
            </span>
          </div>
          <div class="panel-map-chapters">
            ${campaign.chapters
              .map(
                (chapter) => `
                  <button
                    class="panel-map-chapter"
                    type="button"
                    data-map-code="${escapeAttr(chapter.code)}"
                  >
                    <span class="panel-map-chapter-main">
                      <strong>${escapeHtml(chapter.title || chapter.code)}</strong>
                      <small>${escapeHtml(chapter.code)}</small>
                      ${renderPanelMapModes(chapter.modes)}
                    </span>
                    <em>切换</em>
                  </button>
                `
              )
              .join("")}
          </div>
        </section>
      `
    )
    .join("");
}

async function handlePanelMapClick(event) {
  const button = event.target.closest(".panel-map-chapter");
  if (!button || !currentPanelServer) return;
  const mapCode = button.dataset.mapCode;
  if (!mapCode) return;

  button.disabled = true;
  try {
    await ChangePanelMap(currentPanelServer.id, mapCode);
    const text = "地图切换指令已发送，请稍后手动刷新状态";
    showNotification(text || "地图切换指令已发送", "success");
    closePanelMapModal();
  } catch (err) {
    console.error("切换地图失败:", err);
    showError("切换地图失败: " + err);
  } finally {
    button.disabled = false;
  }
}

export function openPanelRconModal() {
  if (!currentPanelServer) return;
  const output = document.getElementById("panel-rcon-output");
  document.getElementById("panel-rcon-title").textContent = `RCON - ${currentPanelServer.name}`;
  document.getElementById("panel-rcon-command").value = "";
  document.getElementById("panel-rcon-output").textContent = "等待发送指令...";
  output.classList.add("panel-rcon-output-muted");
  document.getElementById("panel-rcon-modal").classList.remove("hidden");
  document.getElementById("panel-rcon-command").focus();
}

export function closePanelRconModal() {
  document.getElementById("panel-rcon-modal")?.classList.add("hidden");
}

async function sendPanelRconCommand() {
  if (!currentPanelServer) return;
  const input = document.getElementById("panel-rcon-command");
  const output = document.getElementById("panel-rcon-output");
  const sendBtn = document.getElementById("panel-rcon-send-btn");
  const command = input.value.trim();
  if (!command) {
    showError("请输入 RCON 指令");
    return;
  }

  sendBtn.disabled = true;
  output.classList.add("panel-rcon-output-muted");
  output.textContent = "正在发送...";
  try {
    const result = await SendPanelRconCommand(currentPanelServer.id, command);
    output.classList.remove("panel-rcon-output-muted");
    output.textContent = result || "指令已发送，面板未返回内容。";
  } catch (err) {
    console.error("RCON 指令失败:", err);
    output.textContent = "发送失败: " + err;
  } finally {
    output.classList.remove("panel-rcon-output-muted");
    sendBtn.disabled = false;
  }
}

export function setupPanelModalListeners() {
  document
    .getElementById("close-panel-server-details-modal-btn")
    ?.addEventListener("click", closePanelServerDetailsModal);
  document
    .getElementById("panel-refresh-btn")
    ?.addEventListener("click", refreshCurrentPanelStatus);
  document
    .getElementById("panel-restart-btn")
    ?.addEventListener("click", restartCurrentPanelServer);
  document
    .getElementById("panel-map-btn")
    ?.addEventListener("click", openPanelMapModal);
  document
    .getElementById("panel-upload-btn")
    ?.addEventListener("click", openPanelUploadModal);
  document
    .getElementById("panel-open-btn")
    ?.addEventListener("click", openCurrentPanelInBrowser);
  document
    .getElementById("panel-rcon-btn")
    ?.addEventListener("click", openPanelRconModal);

  document
    .getElementById("close-panel-map-modal-btn")
    ?.addEventListener("click", closePanelMapModal);
  document
    .getElementById("panel-map-refresh-btn")
    ?.addEventListener("click", loadPanelMaps);
  document
    .getElementById("panel-map-official-toggle-btn")
    ?.addEventListener("click", togglePanelOfficialMaps);
  document
    .getElementById("panel-map-search")
    ?.addEventListener("input", renderPanelMapList);
  document
    .getElementById("panel-map-list")
    ?.addEventListener("click", handlePanelMapClick);

  document
    .getElementById("close-panel-upload-modal-btn")
    ?.addEventListener("click", closePanelUploadModal);
  document
    .getElementById("panel-select-upload-files-btn")
    ?.addEventListener("click", selectPanelUploadFiles);
  document
    .getElementById("panel-clear-maps-btn")
    ?.addEventListener("click", clearPanelMaps);
  document
    .getElementById("panel-upload-clear-completed-btn")
    ?.addEventListener("click", clearCompletedPanelUploads);

  document
    .getElementById("close-panel-rcon-modal-btn")
    ?.addEventListener("click", closePanelRconModal);
  document
    .getElementById("panel-rcon-send-btn")
    ?.addEventListener("click", sendPanelRconCommand);
  document
    .getElementById("panel-rcon-command")
    ?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        sendPanelRconCommand();
      }
    });

  ["panel-server-details-modal", "panel-map-modal", "panel-upload-modal", "panel-rcon-modal"].forEach(
    (modalId) => {
      document.getElementById(modalId)?.addEventListener("click", function (e) {
        if (e.target === this) {
          this.classList.add("hidden");
        }
      });
    }
  );
}
