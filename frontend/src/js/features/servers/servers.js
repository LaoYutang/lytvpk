import {
  configureFormModal,
  openServerFormModal,
  closeServerFormModal,
  saveServerForm,
  setupFormModalListeners as setupFormListeners,
} from "./form-modal.js";
import {
  configureDetailsModal,
  openServerDetailsModal,
  setupDetailsModalListeners as setupDetailsListeners,
} from "./details-modal.js";
import {
  configurePanelModal,
  setupPanelModalListeners as setupPanelListeners,
} from "./panel-modal.js";
import { normalizePanelUrl } from "./panel-url.js";

let showError;
let showNotification;
let showConfirmModal;
let switchAppPage;
let FetchServerInfo;
let FetchPlayerList;
let ConnectToServer;
let ExportServersToFile;
let GetMapName;
let GetServerStorage;
let SaveServerStorage;
let BrowserOpenURL;
let FetchPanelServerStatus;
let RestartPanelServer;
let FetchPanelMapList;
let ClearPanelMaps;
let ChangePanelMap;
let ChangePanelDifficulty;
let SendPanelRconCommand;
let SelectPanelMapUploadFiles;
let StartPanelMapUpload;
let GetPanelMapUploadTasks;
let RetryPanelMapUpload;
let CancelPanelMapUpload;
let ClearCompletedPanelMapUploads;

export function configureServers(deps) {
  ({
    showError,
    showNotification,
    showConfirmModal,
    switchAppPage,
    FetchServerInfo,
    FetchPlayerList,
    ConnectToServer,
    ExportServersToFile,
    GetMapName,
    GetServerStorage,
    SaveServerStorage,
    BrowserOpenURL,
    FetchPanelServerStatus,
    RestartPanelServer,
    FetchPanelMapList,
    ClearPanelMaps,
    ChangePanelMap,
    ChangePanelDifficulty,
    SendPanelRconCommand,
    SelectPanelMapUploadFiles,
    StartPanelMapUpload,
    GetPanelMapUploadTasks,
    RetryPanelMapUpload,
    CancelPanelMapUpload,
    ClearCompletedPanelMapUploads,
  } = deps);

  configureFormModal({
    showError,
    showNotification,
    getServers,
    saveServers,
    initServerStorage,
    renderServers,
    renderLaunchServerMenu,
    fetchServerInfo,
  });

  configureDetailsModal({
    showError,
    FetchServerInfo,
    FetchPlayerList,
    resolveMapName,
    escapeHtml,
    formatDuration,
    getServers,
    SERVER_ICONS,
  });

  configurePanelModal({
    showError,
    showNotification,
    showConfirmModal,
    FetchPanelServerStatus,
    RestartPanelServer,
    FetchPanelMapList,
    ClearPanelMaps,
    ChangePanelMap,
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
  });
}

const RECENT_SERVER_LIMIT = 2;
let serverStorage = {
  servers: [],
  recentServers: [],
};

export const SERVER_ICONS = {
  play: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`,
  refresh: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"></path><path d="M21 3v6h-6"></path></svg>`,
  more: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>`,
  server: `<svg class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="6" rx="2"></rect><rect x="3" y="14" width="18" height="6" rx="2"></rect><path d="M7 7h.01"></path><path d="M7 17h.01"></path></svg>`,
  mode: `<svg class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="2"></rect><path d="M6 12h4"></path><path d="M8 10v4"></path><path d="M15 11h.01"></path><path d="M18 13h.01"></path></svg>`,
  map: `<svg class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l-6 3V6l6-3 6 3 6-3v15l-6 3z"></path><path d="M9 3v15"></path><path d="M15 6v15"></path></svg>`,
  users: `<svg class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`,
  panel: `<svg class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="14" rx="2"></rect><path d="M8 20h8"></path><path d="M12 18v2"></path><path d="M7 8h.01"></path><path d="M10 8h7"></path><path d="M7 12h4"></path><path d="M14 12h3"></path></svg>`,
};

export const PANEL_MODE_LABELS = {
  coop: "合作",
  realism: "写实",
  versus: "对抗",
  survival: "生还",
  scavenge: "清道夫",
  mutation: "突变",
  mutations: "突变",
};

export const OFFICIAL_CAMPAIGNS = [
  {
    title: "死亡中心",
    chapters: [
      { code: "c1m1_hotel", title: "旅馆" },
      { code: "c1m2_streets", title: "街道" },
      { code: "c1m3_mall", title: "购物中心" },
      { code: "c1m4_atrium", title: "中庭" },
    ],
  },
  {
    title: "黑色狂欢节",
    chapters: [
      { code: "c2m1_highway", title: "公路" },
      { code: "c2m2_fairgrounds", title: "游乐场" },
      { code: "c2m3_coaster", title: "过山车" },
      { code: "c2m4_barns", title: "谷仓" },
      { code: "c2m5_concert", title: "音乐会" },
    ],
  },
  {
    title: "沼泽激战",
    chapters: [
      { code: "c3m1_plankcountry", title: "乡村" },
      { code: "c3m2_swamp", title: "沼泽" },
      { code: "c3m3_shantytown", title: "贫民窟" },
      { code: "c3m4_plantation", title: "种植园" },
    ],
  },
  {
    title: "暴风骤雨",
    chapters: [
      { code: "c4m1_milltown_a", title: "密尔城" },
      { code: "c4m2_sugarmill_a", title: "糖厂" },
      { code: "c4m3_sugarmill_b", title: "逃离工厂" },
      { code: "c4m4_milltown_b", title: "返回小镇" },
      { code: "c4m5_milltown_escape", title: "逃离小镇" },
    ],
  },
  {
    title: "教区",
    chapters: [
      { code: "c5m1_waterfront", title: "河岸" },
      { code: "c5m2_park", title: "公园" },
      { code: "c5m3_cemetery", title: "墓地" },
      { code: "c5m4_quarter", title: "特区" },
      { code: "c5m5_bridge", title: "桥" },
    ],
  },
  {
    title: "短暂时刻",
    chapters: [
      { code: "c6m1_riverbank", title: "河岸" },
      { code: "c6m2_bedlam", title: "地下通道" },
      { code: "c6m3_port", title: "港口" },
    ],
  },
  {
    title: "牺牲",
    chapters: [
      { code: "c7m1_docks", title: "码头" },
      { code: "c7m2_barge", title: "船舶" },
      { code: "c7m3_port", title: "港口" },
    ],
  },
  {
    title: "毫不留情",
    chapters: [
      { code: "c8m1_apartment", title: "公寓" },
      { code: "c8m2_subway", title: "地铁" },
      { code: "c8m3_sewers", title: "下水道" },
      { code: "c8m4_interior", title: "医院" },
      { code: "c8m5_rooftop", title: "屋顶" },
    ],
  },
  {
    title: "坠机险途",
    chapters: [
      { code: "c9m1_alleys", title: "小巷" },
      { code: "c9m2_lots", title: "卡车站" },
    ],
  },
  {
    title: "死亡丧钟",
    chapters: [
      { code: "c10m1_caves", title: "收费公路" },
      { code: "c10m2_drainage", title: "排水沟" },
      { code: "c10m3_ranchhouse", title: "教堂" },
      { code: "c10m4_mainstreet", title: "小镇" },
      { code: "c10m5_houseboat", title: "船屋" },
    ],
  },
  {
    title: "死亡机场",
    chapters: [
      { code: "c11m1_greenhouse", title: "温室" },
      { code: "c11m2_offices", title: "办公室" },
      { code: "c11m3_garage", title: "车库" },
      { code: "c11m4_terminal", title: "航站楼" },
      { code: "c11m5_runway", title: "跑道" },
    ],
  },
  {
    title: "血腥收获",
    chapters: [
      { code: "c12m1_hilltop", title: "森林" },
      { code: "c12m2_traintunnel", title: "隧道" },
      { code: "c12m3_bridge", title: "桥" },
      { code: "c12m4_barn", title: "火车站" },
      { code: "c12m5_cornfield", title: "农舍" },
    ],
  },
  {
    title: "刺骨寒溪",
    chapters: [
      { code: "c13m1_alpinecreek", title: "阿尔卑斯溪" },
      { code: "c13m2_southpinestream", title: "南松溪" },
      { code: "c13m3_memorialbridge", title: "纪念桥" },
      { code: "c13m4_cutthroatcreek", title: "割喉溪" },
    ],
  },
  {
    title: "临死一搏",
    chapters: [
      { code: "c14m1_junkyard", title: "垃圾场" },
      { code: "c14m2_lighthouse", title: "灯塔" },
    ],
  },
];

export async function initServerStorage() {
  try {
    const storage = await GetServerStorage();
    serverStorage = normalizeServerStorage(storage);
  } catch (e) {
    console.error("读取服务器配置失败:", e);
    serverStorage = { servers: [], recentServers: [] };
  }
}

export function getServers() {
  return [...serverStorage.servers].sort((a, b) => (b.weight || 0) - (a.weight || 0));
}

function saveServers(servers) {
  serverStorage = normalizeServerStorage({
    ...serverStorage,
    servers,
  });
  return persistServerStorage();
}

function normalizeAddress(address) {
  return String(address || "").trim();
}

function getRawRecentServers() {
  const seen = new Set();
  return serverStorage.recentServers
    .map((server) => ({
      name: String(server?.name || "").trim(),
      address: normalizeAddress(server?.address),
      lastConnectedAt: Number(server?.lastConnectedAt) || 0,
    }))
    .filter((server) => {
      if (!server.address || seen.has(server.address)) return false;
      seen.add(server.address);
      return true;
    });
}

function saveRawRecentServers(servers) {
  serverStorage = normalizeServerStorage({
    ...serverStorage,
    recentServers: servers.slice(0, RECENT_SERVER_LIMIT),
  });
  persistServerStorage();
}

function persistServerStorage() {
  const promise = SaveServerStorage?.(serverStorage) || Promise.resolve();
  promise.catch((e) => {
    console.error("保存服务器配置失败:", e);
    showError?.("保存服务器配置失败: " + e);
  });
  return promise;
}

function normalizeServerStorage(storage = {}) {
  return {
    servers: Array.isArray(storage.servers)
      ? storage.servers
          .map((server) => ({
            id: String(server?.id || "").trim(),
            name: String(server?.name || "").trim(),
            address: normalizeAddress(server?.address),
            weight: Number(server?.weight) || 0,
            panelUrl: normalizePanelUrl(server?.panelUrl),
            panelPasswordSet: Boolean(
              server?.panelPasswordSet || server?.panelPassword
            ),
            ...(server?.panelPassword
              ? { panelPassword: String(server.panelPassword) }
              : {}),
            ...(server?.clearPanelPassword
              ? { clearPanelPassword: true }
              : {}),
          }))
          .filter((server) => server.name && server.address)
      : [],
    recentServers: Array.isArray(storage.recentServers)
      ? storage.recentServers
          .map((server) => ({
            name: String(server?.name || "").trim(),
            address: normalizeAddress(server?.address),
            lastConnectedAt: Number(server?.lastConnectedAt) || 0,
          }))
          .filter((server) => server.address)
      : [],
  };
}

export function getRecentServers() {
  const savedServers = getServers();
  const savedByAddress = new Map(
    savedServers.map((server) => [normalizeAddress(server.address), server])
  );

  return getRawRecentServers()
    .map((recent) => {
      const saved = savedByAddress.get(recent.address);
      if (!saved) return null;

      return {
        name: saved.name || recent.name || recent.address,
        address: saved.address,
        lastConnectedAt: recent.lastConnectedAt,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.lastConnectedAt - a.lastConnectedAt)
    .slice(0, RECENT_SERVER_LIMIT);
}

function recordRecentServer(address) {
  const normalizedAddress = normalizeAddress(address);
  if (!normalizedAddress) return;

  const saved = getServers().find(
    (server) => normalizeAddress(server.address) === normalizedAddress
  );
  const nextServer = {
    name: saved?.name || normalizedAddress,
    address: saved?.address || normalizedAddress,
    lastConnectedAt: Date.now(),
  };
  const nextRecent = [
    nextServer,
    ...getRawRecentServers().filter(
      (server) => normalizeAddress(server.address) !== normalizedAddress
    ),
  ];

  saveRawRecentServers(nextRecent);
  renderLaunchServerMenu();
}

export async function resolveMapName(mapCode) {
  if (!mapCode) return mapCode;
  try {
    if (typeof GetMapName === "function") {
      const name = await GetMapName(mapCode);
      if (name && name.length > 0) {
        return name;
      }
    }
  } catch (e) {
    console.error("Failed to resolve map name via backend", e);
  }
  return mapCode;
}

export async function fetchServerInfo(address, index) {
  let detailsContainer = null;

  const listItems = document.querySelectorAll("li.server-item");
  for (const li of listItems) {
    if (li.dataset.address === address) {
      detailsContainer = li.querySelector(".server-details");
      break;
    }
  }

  if (!detailsContainer) {
    detailsContainer = document.getElementById(`server-details-${index}`);
  }

  if (!detailsContainer) return;

  try {
    const info = await FetchServerInfo(address);

    if (!document.body.contains(detailsContainer)) return;

    detailsContainer.innerHTML = `
      <div class="server-stats-grid">
        <span class="stat-badge name-badge" title="${escapeAttr(info.name)}">${SERVER_ICONS.server}<span>${escapeHtml(info.name)}</span></span>
        <span class="stat-badge mode-badge" title="游戏模式">${SERVER_ICONS.mode}<span>${escapeHtml(info.mode)}</span></span>
        <span class="stat-badge map-badge" title="地图: ${escapeAttr(info.map)} (点击解析)" data-map-code="${escapeAttr(info.map)}">${SERVER_ICONS.map}<span>${escapeHtml(info.map)}</span></span>
        <span class="stat-badge players-badge" title="在线人数">${SERVER_ICONS.users}<span>${info.players}/${info.max_players}</span></span>
      </div>
    `;

    const mapBadge = detailsContainer.querySelector(".map-badge");
    if (mapBadge) {
      mapBadge.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (mapBadge.dataset.resolved === "true") return;

        const originalHtml = mapBadge.innerHTML;
        mapBadge.innerHTML = `${SERVER_ICONS.map}<span>解析中...</span>`;
        mapBadge.style.cursor = "wait";

        try {
          const realName = await resolveMapName(info.map);
          if (realName && realName !== info.map) {
            mapBadge.innerHTML = `${SERVER_ICONS.map}<span>${escapeHtml(realName)}</span>`;
            mapBadge.dataset.resolved = "true";
            mapBadge.title = `地图: ${info.map}`;
            mapBadge.style.cursor = "default";
            mapBadge.style.textDecoration = "none";
            mapBadge.style.color = "inherit";
          } else {
            mapBadge.innerHTML = originalHtml;
            mapBadge.style.cursor = "pointer";
          }
        } catch (err) {
          mapBadge.innerHTML = originalHtml;
          mapBadge.style.cursor = "pointer";
        }
      });
    }
  } catch (err) {
    console.error("获取服务器信息失败:", err);
    if (document.body.contains(detailsContainer)) {
      detailsContainer.innerHTML = `<span class="error-text">获取失败</span>`;
    }
  }
}

export function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s
      .toString()
      .padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text == null ? "" : String(text);
  return div.innerHTML;
}

export function escapeAttr(text) {
  return escapeHtml(text).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function getIPHost(ip) {
  if (!ip) return "";
  return String(ip).split(":")[0];
}

export function openServerModal() {
  switchAppPage("servers");
  renderServers();
  refreshAllServers();
}

export function closeServerModal() {
  switchAppPage("mods");
}

export function renderServers() {
  const servers = getServers();
  const list = document.getElementById("server-list");
  list.innerHTML = "";

  if (servers.length === 0) {
    list.innerHTML = `
      <li class="server-empty-state">
        <div class="server-empty-icon">${SERVER_ICONS.server}</div>
        <div class="server-empty-title">还没有收藏服务器</div>
        <div class="server-empty-text">添加一个常用服务器后，它会显示在这里。</div>
      </li>
    `;
    return;
  }

  servers.forEach((server, index) => {
    const li = createServerListItem(server, index);
    list.appendChild(li);
    fetchServerInfo(server.address, index);
  });
}

function createServerListItem(server, index) {
  const li = document.createElement("li");
  li.className = "server-item";
  li.dataset.address = server.address;

  const panelBadge =
    server.panelUrl && server.panelPasswordSet
      ? `<span class="server-panel-badge" title="已配置面板高级控制">${SERVER_ICONS.panel}<span>面板</span></span>`
      : "";
  let detailsHtml = `
        <div class="server-details" id="server-details-${index}">
          <span class="server-loading-text">加载中...</span>
        </div>
      `;
  li.innerHTML = `
      <div class="server-info">
        <span class="server-name" id="server-name-${index}">
          ${escapeHtml(server.name)}
        </span>
        <div class="server-address-row">
          <span class="server-address">${escapeHtml(server.address)}</span>
          ${panelBadge}
        </div>
        ${detailsHtml}
      </div>
      <div class="server-actions">
        <button class="btn btn-small btn-primary connect-server-btn" data-address="${escapeAttr(server.address)}">
          ${SERVER_ICONS.play}
          <span>连接</span>
        </button>
        <button class="btn btn-small btn-secondary server-action-icon refresh-server-btn" title="刷新" data-address="${escapeAttr(server.address)}" data-index="${index}" aria-label="刷新服务器">
            ${SERVER_ICONS.refresh}
        </button>
        <button class="btn btn-small btn-secondary server-action-icon server-more-btn" title="更多操作" data-index="${index}" aria-label="更多操作">
            ${SERVER_ICONS.more}
        </button>
      </div>
    `;

  li.addEventListener("dblclick", (e) => {
    if (e.target.closest("button")) return;
    openServerDetailsModal(index);
  });

  const connectBtn = li.querySelector(".connect-server-btn");
  if (connectBtn) {
    connectBtn.addEventListener("click", (e) => {
      const target = e.target.closest(".connect-server-btn");
      const address = target.dataset.address;
      connectServer(address);
    });
  }

  const refreshBtn = li.querySelector(".refresh-server-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", (e) => {
      const target = e.target.closest(".refresh-server-btn");
      const icon = target.querySelector("svg");
      if (icon) icon.classList.add("spinning");
      target.disabled = true;

      const address = target.dataset.address;
      const idx = target.dataset.index;

      fetchServerInfo(address, idx).finally(() => {
        if (icon) icon.classList.remove("spinning");
        target.disabled = false;
      });
    });
  }

  const moreBtn = li.querySelector(".server-more-btn");
  if (moreBtn) {
    moreBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = moreBtn.dataset.index;
      const dropdown = document.getElementById("global-dropdown");

      if (
        !dropdown.classList.contains("hidden") &&
        dropdown.dataset.index === idx
      ) {
        dropdown.classList.add("hidden");
        return;
      }

      const rect = moreBtn.getBoundingClientRect();
      dropdown.style.top = `${rect.bottom + 5}px`;
      dropdown.style.left = `${rect.right - 100}px`;

      dropdown.dataset.index = idx;
      dropdown.classList.remove("hidden");
    });
  }

  return li;
}

export function refreshAllServers() {
  const servers = getServers();

  const btn = document.getElementById("refresh-all-servers-btn");
  if (btn) {
    const icon = btn.querySelector(".icon-svg");
    if (icon) icon.classList.add("spinning");
    btn.disabled = true;
  }

  const promises = servers.map((server, index) =>
    fetchServerInfo(server.address, index)
  );

  Promise.allSettled(promises).finally(() => {
    if (btn) {
      const icon = btn.querySelector(".icon-svg");
      if (icon) icon.classList.remove("spinning");
      btn.disabled = false;
    }
  });
}

function addServer() {
  openServerFormModal(-1);
}

function deleteServer(index) {
  const servers = getServers();
  const server = servers[index];

  if (!server) {
    showError("无法找到要删除的服务器");
    return;
  }

  showConfirmModal(
    "删除服务器",
    `确定要删除服务器 "${server.name}" 吗？`,
    () => {
      const currentServers = getServers();
      const idx = parseInt(index);

      if (!isNaN(idx) && idx >= 0 && idx < currentServers.length) {
        currentServers.splice(idx, 1);
        saveServers(currentServers);
        renderLaunchServerMenu();

        const list = document.getElementById("server-list");
        const itemToRemove = list.children[idx];
        if (itemToRemove) {
          list.removeChild(itemToRemove);

          Array.from(list.children).forEach((li, newIndex) => {
            const moreBtn = li.querySelector(".server-more-btn");
            if (moreBtn) moreBtn.dataset.index = newIndex;

            const details = li.querySelector(".server-details");
            if (details) details.id = `server-details-${newIndex}`;

            const nameEl = li.querySelector(".server-name");
            if (nameEl) nameEl.id = `server-name-${newIndex}`;
          });
        } else {
          renderServers();
        }

        showNotification("服务器已删除", "success");
      } else {
        showError("删除失败：索引无效");
      }
    }
  );
}

function connectServer(address, options = {}) {
  const server = getServers().find(
    (item) => normalizeAddress(item.address) === normalizeAddress(address)
  );

  ConnectToServer(address)
    .then(() => {
      recordRecentServer(address);
      if (options.notify && typeof showNotification === "function") {
        showNotification(`正在连接 ${server?.name || address}...`, "success");
      }
    })
    .catch((err) => {
      console.error("连接服务器失败:", err);
      showError("连接服务器失败: " + err);
    });
}

function exportServersToClipboard() {
  const servers = getExportableServers();
  const json = JSON.stringify(servers, null, 2);
  navigator.clipboard
    .writeText(json)
    .then(() => {
      showNotification("服务器配置已复制到剪贴板", "success");
    })
    .catch((err) => {
      console.error("复制失败:", err);
      showError("复制失败: " + err);
    });
}

function exportServersToFile() {
  const servers = getExportableServers();
  const json = JSON.stringify(servers, null, 2);

  ExportServersToFile(json)
    .then((path) => {
      if (path) {
        showNotification("服务器配置已导出", "success");
      }
    })
    .catch((err) => {
      console.error("导出失败:", err);
      showError("导出失败: " + err);
    });
}

async function importServersFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) {
      showError("剪贴板为空");
      return;
    }
    importServers(text);
  } catch (err) {
    console.error("读取剪贴板失败:", err);
    showError("无法读取剪贴板: " + err);
  }
}

function importServers(jsonStr) {
  try {
    const newServers = JSON.parse(jsonStr);
    if (!Array.isArray(newServers)) {
      throw new Error("数据格式错误: 必须是服务器数组");
    }

    const currentServers = getServers();
    let addedCount = 0;

    newServers.forEach((server) => {
      if (server.name && server.address) {
        const existingIndex = currentServers.findIndex(
          (s) => s.address === server.address
        );

        if (existingIndex === -1) {
          currentServers.push({
            name: server.name,
            address: server.address,
            weight: server.weight || 0,
            panelUrl: normalizePanelUrl(server.panelUrl),
          });
          addedCount++;
        }
      }
    });

    if (addedCount > 0) {
      saveServers(currentServers);
      renderServers();
      renderLaunchServerMenu();
      showNotification(`成功导入 ${addedCount} 个新服务器`, "success");
    } else {
      showNotification("没有发现新的服务器配置", "info");
    }
  } catch (e) {
    console.error("导入失败:", e);
    showError("导入失败: " + e.message);
  }
}

function getExportableServers() {
  return getServers().map((server) => ({
    name: server.name,
    address: server.address,
    weight: server.weight || 0,
    ...(server.panelUrl ? { panelUrl: server.panelUrl } : {}),
  }));
}

export function setupLaunchServerMenu() {
  const popover = document.getElementById("launch-server-popover");
  const wrapper = document.querySelector(".sidebar-launch-wrapper");
  if (!popover || popover.dataset.bound === "true") return;

  popover.dataset.bound = "true";
  renderLaunchServerMenu();

  wrapper?.addEventListener("pointerenter", renderLaunchServerMenu);
  popover.addEventListener("click", (event) => {
    const option = event.target.closest(".launch-server-option");
    if (!option) return;

    event.preventDefault();
    event.stopPropagation();
    connectServer(option.dataset.address, { notify: true });
  });
}

function renderLaunchServerMenu() {
  const popover = document.getElementById("launch-server-popover");
  if (!popover) return;

  const recentServers = getRecentServers().slice().reverse();
  const content =
    recentServers.length > 0
      ? recentServers
          .map(
            (server) => `
              <button
                class="launch-server-option"
                type="button"
                role="menuitem"
                data-address="${escapeAttr(server.address)}"
              >
                <span class="launch-server-icon" aria-hidden="true">${SERVER_ICONS.server}</span>
                <span class="launch-server-name">${escapeHtml(server.name)}</span>
              </button>
            `
          )
          .join("")
      : `
          <div class="launch-server-empty" role="status">
            <span>暂无最近</span>
          </div>
        `;

  popover.innerHTML = `
    <div class="launch-server-list">${content}</div>
  `;
}

export function setupServerModalListeners() {
  setupFormListeners();
  setupDetailsListeners();
  setupPanelListeners();

  // 数据导入导出
  document
    .getElementById("export-clipboard-btn")
    .addEventListener("click", exportServersToClipboard);
  document
    .getElementById("export-file-btn")
    .addEventListener("click", exportServersToFile);
  document
    .getElementById("import-clipboard-btn")
    .addEventListener("click", importServersFromClipboard);

  const fileInput = document.getElementById("import-file-input");
  document
    .getElementById("import-file-btn")
    .addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      importServers(event.target.result);
      fileInput.value = "";
    };
    reader.onerror = () => showError("读取文件失败");
    reader.readAsText(file);
  });

  // 全局删除按钮
  document
    .getElementById("global-delete-server-btn")
    .addEventListener("click", () => {
      const dropdown = document.getElementById("global-dropdown");
      const index = parseInt(dropdown.dataset.index);
      if (!isNaN(index)) {
        deleteServer(index);
        dropdown.classList.add("hidden");
      }
    });

  // 刷新所有按钮
  const refreshAllBtn = document.getElementById("refresh-all-servers-btn");
  if (refreshAllBtn) {
    refreshAllBtn.addEventListener("click", refreshAllServers);
  }

  // 点击模态框外部关闭
  window.addEventListener("click", (event) => {
    const modal = document.getElementById("server-modal");
    if (event.target === modal) {
      closeServerModal();
    }

    if (
      !event.target.closest(".server-more-btn") &&
      !event.target.closest("#global-dropdown")
    ) {
      document.getElementById("global-dropdown").classList.add("hidden");
    }
  });

  // 滚动时关闭下拉菜单
  window.addEventListener(
    "scroll",
    () => {
      document.getElementById("global-dropdown").classList.add("hidden");
    },
    true
  );
}
