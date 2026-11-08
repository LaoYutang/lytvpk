import { normalizePanelUrl } from "./panel-url.js";
import { getAPILineSnapshot, isCurrentAPILine } from "../../core/api-line.js";

let showError;
let showNotification;
let showConfirmModal;
let FetchPanelServerStatus;
let RestartPanelServer;
let FetchPanelMapList;
let FetchPanelMapFiles;
let FetchPanelMapIssues;
let ClearPanelMaps;
let DeletePanelMapFile;
let ChangePanelMap;
let FetchPanelMapHotReloadStatus;
let HotReloadPanelMaps;
let ChangePanelDifficulty;
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
    FetchPanelMapFiles,
    FetchPanelMapIssues,
    ClearPanelMaps,
    DeletePanelMapFile,
    ChangePanelMap,
    FetchPanelMapHotReloadStatus,
    HotReloadPanelMaps,
    ChangePanelDifficulty,
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
let panelStatusGeneration = 0;
let currentPanelMaps = [];
let currentPanelMapFiles = [];
const currentPanelMapIssues = new Map();
const deletingPanelMapFiles = new Set();
let currentPanelDifficulty = "";
let panelOfficialMapsHidden = false;
let panelMapRequestToken = 0;
let panelMapFileRequestToken = 0;
let panelMapFilesRefreshTimer = null;
const completedPanelUploadNotifications = new Set();

const PANEL_MAP_ISSUE_BATCH_SIZE = 10;

const PANEL_DIFFICULTIES = [
  { value: "简单", desc: "Easy" },
  { value: "普通", desc: "Normal" },
  { value: "高级", desc: "Hard" },
  { value: "专家", desc: "Impossible" },
];

const PANEL_UPLOAD_ICON = `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>`;
const PANEL_CANCEL_ICON = `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
const PANEL_RETRY_ICON = `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"></path><path d="M21 3v6h-6"></path></svg>`;

export function openPanelServerDetailsModal(index) {
  const server = getServers()[index];
  if (!server) return;

  currentPanelServer = server;
  currentPanelServerIndex = index;
  currentPanelDifficulty = "";

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
  panelStatusGeneration++;
  document.getElementById("panel-server-details-modal")?.classList.add("hidden");
  currentPanelServer = null;
  currentPanelServerIndex = -1;
}

async function loadPanelStatus(server = currentPanelServer) {
  if (!server) return;
  const generation = ++panelStatusGeneration;
  const isCurrentStatus = () => (
    generation === panelStatusGeneration && currentPanelServer?.id === server.id &&
    !document.getElementById("panel-server-details-modal")?.classList.contains("hidden")
  );

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
    if (!isCurrentStatus()) return;
    renderPanelStatus(server, status || {}, isCurrentStatus);
    loading.classList.add("hidden");
    content.classList.remove("hidden");
  } catch (err) {
    if (!isCurrentStatus()) return;
    console.error("获取面板状态失败:", err);
    loading.classList.add("hidden");
    error.textContent = "获取面板状态失败: " + err;
    error.classList.remove("hidden");
    renderPanelStatusError(err);
  } finally {
    if (isCurrentStatus()) refreshBtn?.removeAttribute("disabled");
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

function renderPanelStatus(server, status, isCurrentStatus) {
  const summary = document.getElementById("panel-status-summary");
  const playerList = document.getElementById("panel-player-list");
  const rawMap = status.map || "Unknown";
  currentPanelDifficulty = status.difficulty || "";
  summary.innerHTML = `
    ${renderPanelStatusItem("服务器", status.hostname || server.name)}
    ${renderPanelStatusItem("地图", rawMap, rawMap, "panel-status-map-name")}
    ${renderPanelStatusItem("玩家", status.players || "0/0")}
    ${renderPanelStatusItem("模式", status.gameMode || "未知")}
    ${renderPanelStatusItem("难度", status.difficulty || "未知")}
  `;
  const mapName = summary.querySelector("#panel-status-map-name");
  void updatePanelMapName(rawMap, mapName, isCurrentStatus, getAPILineSnapshot());

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

async function updatePanelMapName(rawMap, target, isCurrentStatus, line) {
  try {
    const name = await resolveMapName(rawMap);
    if (!isCurrentStatus() || !isCurrentAPILine(line) || !target?.isConnected) return;
    if (name && name !== rawMap) target.textContent = name;
  } catch {
    // Optional metadata never delays or replaces the actual panel status.
  }
}

function renderPanelStatusItem(label, value, title = "", valueID = "") {
  return `
    <div class="server-info-item panel-status-item" title="${escapeAttr(title || value)}">
      <span class="server-info-label">${escapeHtml(label)}</span>
      <span class="server-info-value"${valueID ? ` id="${escapeAttr(valueID)}"` : ""}>${escapeHtml(value)}</span>
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
    BrowserOpenURL(normalizePanelUrl(currentPanelServer.panelUrl));
  }
}

export function openPanelDifficultyModal() {
  if (!currentPanelServer) return;

  const modal = document.getElementById("panel-difficulty-modal");
  const title = document.getElementById("panel-difficulty-title");
  if (title) {
    title.textContent = `修改难度 - ${currentPanelServer.name}`;
  }
  renderPanelDifficultyOptions();
  modal?.classList.remove("hidden");
}

export function closePanelDifficultyModal() {
  document.getElementById("panel-difficulty-modal")?.classList.add("hidden");
}

function renderPanelDifficultyOptions() {
  const list = document.getElementById("panel-difficulty-options");
  if (!list) return;

  list.replaceChildren();
  const activeValue = normalizePanelDifficultyValue(currentPanelDifficulty);

  PANEL_DIFFICULTIES.forEach((difficulty) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "panel-difficulty-option";
    button.dataset.difficulty = difficulty.value;
    button.setAttribute("aria-pressed", String(difficulty.value === activeValue));
    if (difficulty.value === activeValue) {
      button.classList.add("active");
    }

    const label = document.createElement("span");
    label.textContent = difficulty.value;
    const desc = document.createElement("small");
    desc.textContent = difficulty.desc;
    button.append(label, desc);
    list.appendChild(button);
  });
}

function normalizePanelDifficultyValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  const aliases = {
    easy: "简单",
    "简单": "简单",
    normal: "普通",
    "普通": "普通",
    hard: "高级",
    advanced: "高级",
    "高级": "高级",
    impossible: "专家",
    expert: "专家",
    "专家": "专家",
  };
  return aliases[normalized] || "";
}

async function handlePanelDifficultyClick(event) {
  const button = event.target.closest(".panel-difficulty-option");
  if (!button || !currentPanelServer) return;

  const difficulty = button.dataset.difficulty;
  if (!difficulty) return;

  button.disabled = true;
  try {
    const text = await ChangePanelDifficulty(currentPanelServer.id, difficulty);
    currentPanelDifficulty = difficulty;
    showNotification(text || `难度已切换为 ${difficulty}`, "success");
    closePanelDifficultyModal();
  } catch (err) {
    console.error("修改难度失败:", err);
    showError("修改难度失败: " + err);
  } finally {
    button.disabled = false;
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
  panelMapRequestToken += 1;
  document.getElementById("panel-map-modal")?.classList.add("hidden");
}

async function loadPanelMaps() {
  if (!currentPanelServer) return;
  const serverID = currentPanelServer.id;
  const requestToken = ++panelMapRequestToken;
  const loading = document.getElementById("panel-map-loading");
  const list = document.getElementById("panel-map-list");
  const refreshBtn = document.getElementById("panel-map-refresh-btn");
  loading.classList.remove("hidden");
  list.innerHTML = "";
  refreshBtn.disabled = true;
  refreshBtn.querySelector(".icon-svg")?.classList.add("spinning");

  try {
    const customMaps = await FetchPanelMapList(serverID);
    if (!isCurrentPanelMapRequest(serverID, requestToken)) return;
    currentPanelMaps = [
      ...OFFICIAL_CAMPAIGNS.map((campaign) => normalizeCampaign(campaign, false)),
      ...(Array.isArray(customMaps) ? customMaps : []).map((campaign) =>
        normalizeCampaign(campaign, true)
      ),
    ];
    renderPanelMapList();
  } catch (err) {
    if (!isCurrentPanelMapRequest(serverID, requestToken)) return;
    console.error("获取地图列表失败:", err);
    list.innerHTML = `<div class="panel-error-box">获取地图列表失败: ${escapeHtml(err)}</div>`;
  } finally {
    if (!isCurrentPanelMapRequest(serverID, requestToken)) return;
    loading.classList.add("hidden");
    refreshBtn.disabled = false;
    refreshBtn.querySelector(".icon-svg")?.classList.remove("spinning");
  }
}

function isCurrentPanelMapRequest(serverID, requestToken) {
  return (
    requestToken === panelMapRequestToken &&
    currentPanelServer?.id === serverID &&
    !document.getElementById("panel-map-modal")?.classList.contains("hidden")
  );
}

function setPanelMapHotReloading(loading) {
  const button = document.getElementById("panel-map-hot-reload-btn");
  if (!button) return;

  button.disabled = loading;
  button.setAttribute("aria-busy", loading ? "true" : "false");
  button.querySelector(".icon-svg")?.classList.toggle("spinning", loading);
}

async function executePanelMapHotReload() {
  if (!currentPanelServer) return;

  setPanelMapHotReloading(true);
  try {
    const result = await HotReloadPanelMaps(currentPanelServer.id);
    showNotification(result?.message || "地图热重载指令已发送", "success");
  } catch (err) {
    console.error("热重载地图失败:", err);
    showError("热重载失败: " + err);
  } finally {
    setPanelMapHotReloading(false);
  }
}

async function confirmPanelMapHotReload() {
  if (!currentPanelServer) return;

  setPanelMapHotReloading(true);
  let status;
  try {
    status = await FetchPanelMapHotReloadStatus(currentPanelServer.id);
  } catch (err) {
    console.error("获取地图热重载状态失败:", err);
    showError("获取热重载状态失败: " + err);
    return;
  } finally {
    setPanelMapHotReloading(false);
  }

  let message =
    "热重载会重新加载地图资源。如果地图过多，会占用 CPU 并影响正在游玩的游戏。";
  if (status?.using_default) {
    message +=
      "\n\n当前使用默认指令，仅会更新游戏服务器的地图，投票插件的地图缓存不会被刷新。如需同时刷新投票插件缓存，请自定义地图插件的更新指令。";
  }

  showConfirmModal(
    "确认热重载地图？",
    message,
    executePanelMapHotReload,
    false,
    "panel-hot-reload-confirm"
  );
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
  loadPanelMapFiles();
}

export function closePanelUploadModal() {
  panelMapFileRequestToken += 1;
  currentPanelMapFiles = [];
  currentPanelMapIssues.clear();
  if (panelMapFilesRefreshTimer !== null) {
    clearTimeout(panelMapFilesRefreshTimer);
    panelMapFilesRefreshTimer = null;
  }
  document.getElementById("panel-upload-modal")?.classList.add("hidden");
}

function normalizePanelMapIssueKey(vpkName) {
  return String(vpkName || "").trim().toLowerCase();
}

function normalizePanelMapFile(file) {
  return {
    name: String(file?.name || file?.Name || "").trim(),
    size: String(file?.size || file?.Size || "unknown").trim() || "unknown",
  };
}

function getPanelMapFileDeletionKey(serverID, mapName) {
  return `${serverID}\n${normalizePanelMapIssueKey(mapName)}`;
}

function isCurrentPanelMapFileRequest(serverID, requestToken) {
  return (
    requestToken === panelMapFileRequestToken &&
    currentPanelServer?.id === serverID &&
    isPanelUploadModalOpen()
  );
}

async function loadPanelMapFiles() {
  if (
    !currentPanelServer ||
    !isPanelUploadModalOpen() ||
    typeof FetchPanelMapFiles !== "function"
  ) {
    return;
  }

  const serverID = currentPanelServer.id;
  const requestToken = ++panelMapFileRequestToken;
  const list = document.getElementById("panel-vpk-list");
  const loading = document.getElementById("panel-vpk-loading");
  const refreshBtn = document.getElementById("panel-vpk-refresh-btn");
  const count = document.getElementById("panel-vpk-count");
  if (!list) return;

  currentPanelMapFiles = [];
  currentPanelMapIssues.clear();
  list.replaceChildren();
  if (count) count.textContent = "正在读取...";
  loading?.classList.remove("hidden");
  refreshBtn?.setAttribute("disabled", "true");
  refreshBtn?.querySelector(".icon-svg")?.classList.add("spinning");

  try {
    const files = await FetchPanelMapFiles(serverID);
    if (!isCurrentPanelMapFileRequest(serverID, requestToken)) return;
    currentPanelMapFiles = (Array.isArray(files) ? files : [])
      .map(normalizePanelMapFile)
      .filter((file) => file.name);
    renderPanelMapFiles();
    void loadPanelMapFileIssues(serverID, currentPanelMapFiles, requestToken);
  } catch (err) {
    if (!isCurrentPanelMapFileRequest(serverID, requestToken)) return;
    const error = document.createElement("div");
    error.className = "panel-error-box";
    error.textContent = `读取 VPK 地图列表失败: ${err}`;
    list.replaceChildren(error);
    if (count) count.textContent = "读取失败";
  } finally {
    if (!isCurrentPanelMapFileRequest(serverID, requestToken)) return;
    loading?.classList.add("hidden");
    refreshBtn?.removeAttribute("disabled");
    refreshBtn?.querySelector(".icon-svg")?.classList.remove("spinning");
  }
}

async function loadPanelMapFileIssues(serverID, files, requestToken) {
  if (typeof FetchPanelMapIssues !== "function") return;
  const vpkNames = files.map((file) => file.name);
  for (let index = 0; index < vpkNames.length; index += PANEL_MAP_ISSUE_BATCH_SIZE) {
    if (!isCurrentPanelMapFileRequest(serverID, requestToken)) return;
    const batch = vpkNames.slice(index, index + PANEL_MAP_ISSUE_BATCH_SIZE);
    let response;
    try {
      response = await FetchPanelMapIssues(serverID, batch);
    } catch {
      return;
    }
    if (!isCurrentPanelMapFileRequest(serverID, requestToken)) return;
    if (!response?.supported) return;

    Object.entries(response.items || {}).forEach(([vpkName, issue]) => {
      const key = normalizePanelMapIssueKey(vpkName);
      if (!key) return;
      currentPanelMapIssues.set(key, {
        dictionaryMissing: Math.max(0, Number(issue?.dictionaryMissing) || 0),
        dictionaryUnreadable: Boolean(issue?.dictionaryUnreadable),
        globalScripts: Math.max(0, Number(issue?.globalScripts) || 0),
        scriptOverrides: Math.max(0, Number(issue?.scriptOverrides) || 0),
      });
    });
    renderPanelMapFiles();
  }
}

function renderPanelMapFiles() {
  const list = document.getElementById("panel-vpk-list");
  const count = document.getElementById("panel-vpk-count");
  if (!list) return;
  if (count) count.textContent = `${currentPanelMapFiles.length} 个文件`;

  if (currentPanelMapFiles.length === 0) {
    const empty = document.createElement("div");
    empty.className = "panel-vpk-empty";
    empty.textContent = "暂无 VPK 地图文件";
    list.replaceChildren(empty);
    return;
  }

  list.replaceChildren(...currentPanelMapFiles.map(createPanelMapFileElement));
}

function createPanelMapFileElement(file) {
  const item = document.createElement("div");
  item.className = "panel-vpk-item";

  const main = document.createElement("div");
  main.className = "panel-vpk-main";

  const titleRow = document.createElement("div");
  titleRow.className = "panel-vpk-title-row";
  const title = document.createElement("span");
  title.className = "panel-vpk-name";
  title.title = file.name;
  title.textContent = file.name;
  const size = document.createElement("span");
  size.className = "panel-vpk-size";
  size.textContent = file.size === "unknown" ? "大小未知" : file.size;
  titleRow.append(title, size);
  main.appendChild(titleRow);

  const issue = currentPanelMapIssues.get(normalizePanelMapIssueKey(file.name));
  const riskTags = createPanelMapRiskTags(issue);
  if (riskTags) main.appendChild(riskTags);

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "btn btn-danger btn-small panel-vpk-delete-btn";
  deleteButton.dataset.vpkName = file.name;
  const deleting = Boolean(
    currentPanelServer &&
      deletingPanelMapFiles.has(getPanelMapFileDeletionKey(currentPanelServer.id, file.name))
  );
  deleteButton.disabled = deleting;
  deleteButton.textContent = deleting ? "删除中..." : "删除";

  item.append(main, deleteButton);
  return item;
}

function createPanelMapRiskTags(issue) {
  if (!issue) return null;
  const tags = [];
  if (issue.dictionaryMissing > 0) {
    tags.push(createPanelMapRiskTag(`字典缺失 ${issue.dictionaryMissing}`, "danger"));
  }
  if (issue.dictionaryUnreadable) {
    tags.push(createPanelMapRiskTag("字典检测异常", "warning"));
  }
  if (issue.globalScripts > 0) {
    tags.push(createPanelMapRiskTag(`存在全局脚本 ${issue.globalScripts}`, "warning"));
  }
  if (issue.scriptOverrides > 0) {
    tags.push(createPanelMapRiskTag(`脚本覆盖 ${issue.scriptOverrides}`, "danger"));
  }
  if (tags.length === 0) return null;

  const container = document.createElement("div");
  container.className = "panel-map-risk-tags";
  tags.forEach((tag) => container.appendChild(tag));
  return container;
}

function handlePanelMapFileClick(event) {
  const button = event.target.closest(".panel-vpk-delete-btn");
  const mapName = String(button?.dataset.vpkName || "").trim();
  if (!button || !mapName || !currentPanelServer) return;
  const serverID = currentPanelServer.id;

  showConfirmModal(
    "删除 VPK 地图",
    `确定要删除 ${mapName} 吗？删除后无法恢复。`,
    async () => {
      const key = getPanelMapFileDeletionKey(serverID, mapName);
      let deleteSucceeded = false;
      deletingPanelMapFiles.add(key);
      renderPanelMapFiles();
      try {
        const text = await DeletePanelMapFile(serverID, mapName);
        deleteSucceeded = true;
        showNotification(text || `${mapName} 已删除`, "success");
        if (currentPanelServer?.id === serverID) {
          await loadPanelMapFiles();
          if (isPanelMapModalOpen()) loadPanelMaps();
        }
      } catch (err) {
        console.error("删除 VPK 地图失败:", err);
        showError("删除 VPK 地图失败: " + err);
      } finally {
        deletingPanelMapFiles.delete(key);
        if (!deleteSucceeded && isPanelUploadModalOpen()) renderPanelMapFiles();
      }
    }
  );
}

function schedulePanelMapFilesRefresh() {
  if (!isPanelUploadModalOpen()) return;
  if (panelMapFilesRefreshTimer !== null) clearTimeout(panelMapFilesRefreshTimer);
  panelMapFilesRefreshTimer = setTimeout(() => {
    panelMapFilesRefreshTimer = null;
    loadPanelMapFiles();
  }, 150);
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
    list.classList.remove("has-tasks");
    list.classList.remove("has-multiple-tasks");
    list.innerHTML = `<div class="panel-error-box">刷新上传任务失败: ${escapeHtml(err)}</div>`;
  }
}

function renderPanelUploadTasks(tasks) {
  const list = document.getElementById("panel-upload-tasks-list");
  if (!list) return;
  const hasTasks = Array.isArray(tasks) && tasks.length > 0;
  list.classList.toggle("has-tasks", hasTasks);
  list.classList.toggle(
    "has-multiple-tasks",
    Array.isArray(tasks) && tasks.length > 1
  );

  if (!hasTasks) {
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
        if (isPanelUploadModalOpen()) {
          await loadPanelMapFiles();
        }
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
  schedulePanelMapFilesRefresh();
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

function getFilteredPanelMaps() {
  const query = document
    .getElementById("panel-map-search")
    .value.trim()
    .toLowerCase();

  return currentPanelMaps
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
  updatePanelOfficialToggle();
  const filtered = getFilteredPanelMaps();

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

function createPanelMapRiskTag(text, level) {
  const tag = document.createElement("span");
  tag.className = `panel-map-risk-tag is-${level}`;
  tag.textContent = text;
  return tag;
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
    .getElementById("panel-difficulty-btn")
    ?.addEventListener("click", openPanelDifficultyModal);
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
    .getElementById("panel-map-hot-reload-btn")
    ?.addEventListener("click", confirmPanelMapHotReload);
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
    .getElementById("close-panel-difficulty-modal-btn")
    ?.addEventListener("click", closePanelDifficultyModal);
  document
    .getElementById("panel-difficulty-options")
    ?.addEventListener("click", handlePanelDifficultyClick);

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
    .getElementById("panel-vpk-refresh-btn")
    ?.addEventListener("click", loadPanelMapFiles);
  document
    .getElementById("panel-vpk-list")
    ?.addEventListener("click", handlePanelMapFileClick);

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

  ["panel-server-details-modal", "panel-map-modal", "panel-difficulty-modal", "panel-upload-modal", "panel-rcon-modal"].forEach(
    (modalId) => {
      document.getElementById(modalId)?.addEventListener("click", function (e) {
        if (e.target === this) {
          this.classList.add("hidden");
        }
      });
    }
  );
}
