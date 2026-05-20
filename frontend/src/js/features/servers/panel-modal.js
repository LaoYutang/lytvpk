let showError;
let showNotification;
let showConfirmModal;
let FetchPanelServerStatus;
let RestartPanelServer;
let FetchPanelMapList;
let ChangePanelMap;
let SendPanelRconCommand;
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
    ChangePanelMap,
    SendPanelRconCommand,
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

  ["panel-server-details-modal", "panel-map-modal", "panel-rcon-modal"].forEach(
    (modalId) => {
      document.getElementById(modalId)?.addEventListener("click", function (e) {
        if (e.target === this) {
          this.classList.add("hidden");
        }
      });
    }
  );
}
