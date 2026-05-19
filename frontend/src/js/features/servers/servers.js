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

export function configureServers(deps) {
  ({ showError, showNotification, showConfirmModal, switchAppPage, FetchServerInfo, FetchPlayerList, ConnectToServer, ExportServersToFile, GetMapName, GetServerStorage, SaveServerStorage } = deps);
}

const RECENT_SERVER_LIMIT = 2;
let serverStorage = {
  servers: [],
  recentServers: [],
};
const SERVER_ICONS = {
  play: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`,
  refresh: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"></path><path d="M21 3v6h-6"></path></svg>`,
  more: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>`,
  server: `<svg class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="6" rx="2"></rect><rect x="3" y="14" width="18" height="6" rx="2"></rect><path d="M7 7h.01"></path><path d="M7 17h.01"></path></svg>`,
  mode: `<svg class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="2"></rect><path d="M6 12h4"></path><path d="M8 10v4"></path><path d="M15 11h.01"></path><path d="M18 13h.01"></path></svg>`,
  map: `<svg class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l-6 3V6l6-3 6 3 6-3v15l-6 3z"></path><path d="M9 3v15"></path><path d="M15 6v15"></path></svg>`,
  users: `<svg class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`,
};

export async function initServerStorage() {
  try {
    const storage = await GetServerStorage();
    serverStorage = normalizeServerStorage(storage);
  } catch (e) {
    console.error("读取服务器配置失败:", e);
    serverStorage = { servers: [], recentServers: [] };
  }
}

function getServers() {
  // 按权重降序排序
  return [...serverStorage.servers].sort((a, b) => (b.weight || 0) - (a.weight || 0));
}

function saveServers(servers) {
  serverStorage = normalizeServerStorage({
    ...serverStorage,
    servers,
  });
  persistServerStorage();
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
  SaveServerStorage?.(serverStorage).catch((e) => {
    console.error("保存服务器配置失败:", e);
    showError?.("保存服务器配置失败: " + e);
  });
}

function normalizeServerStorage(storage = {}) {
  return {
    servers: Array.isArray(storage.servers)
      ? storage.servers
          .map((server) => ({
            name: String(server?.name || "").trim(),
            address: normalizeAddress(server?.address),
            weight: Number(server?.weight) || 0,
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

// --- 编辑/添加服务器功能 ---
let currentEditIndex = -1;
let isEditMode = false;

function openServerFormModal(index = -1) {
  const modal = document.getElementById("server-form-modal");
  const title = document.getElementById("server-form-title");
  const nameInput = document.getElementById("form-server-name");
  const addressInput = document.getElementById("form-server-address");
  const weightInput = document.getElementById("form-server-weight");

  // 重置表单
  nameInput.value = "";
  addressInput.value = "";
  weightInput.value = "0";

  if (index >= 0) {
    // 编辑模式
    isEditMode = true;
    currentEditIndex = index;
    title.textContent = "编辑服务器";

    const servers = getServers();
    const server = servers[index];
    if (server) {
      nameInput.value = server.name;
      addressInput.value = server.address;
      weightInput.value = server.weight || 0;
    }
  } else {
    // 添加模式
    isEditMode = false;
    currentEditIndex = -1;
    title.textContent = "添加服务器";
  }

  modal.classList.remove("hidden");
  document.getElementById("global-dropdown").classList.add("hidden");
}

function closeServerFormModal() {
  document.getElementById("server-form-modal").classList.add("hidden");
  currentEditIndex = -1;
  isEditMode = false;
}

function saveServerForm() {
  const name = document.getElementById("form-server-name").value.trim();
  const address = document.getElementById("form-server-address").value.trim();
  const weight =
    parseInt(document.getElementById("form-server-weight").value) || 0;

  if (!name || !address) {
    showError("请输入服务器名称和地址");
    return;
  }

  const servers = getServers();

  if (isEditMode) {
    // 编辑模式
    if (currentEditIndex >= 0 && currentEditIndex < servers.length) {
      servers[currentEditIndex] = {
        ...servers[currentEditIndex],
        name,
        address,
        weight,
      };
      saveServers(servers);
      showNotification("服务器修改成功", "success");
    }
  } else {
    // 添加模式
    servers.push({ name, address, weight });
    saveServers(servers);
    showNotification("服务器添加成功", "success");
  }

  renderServers();
  renderLaunchServerMenu();
  closeServerFormModal();

  // 尝试刷新该服务器信息
  // 重新获取列表以找到新位置（因为可能排序了）
  const newServers = getServers();
  const newIndex = newServers.findIndex(
    (s) => s.address === address && s.name === name
  );
  if (newIndex !== -1) {
    fetchServerInfo(address, newIndex);
  }
}

export function setupServerModalListeners() {
  document
    .getElementById("open-add-server-modal-btn")
    .addEventListener("click", () => openServerFormModal(-1));

  // 编辑/添加服务器相关
  document
    .getElementById("close-server-form-modal-btn")
    .addEventListener("click", closeServerFormModal);
  document
    .getElementById("cancel-server-form-btn")
    .addEventListener("click", closeServerFormModal);
  document
    .getElementById("save-server-form-btn")
    .addEventListener("click", saveServerForm);

  document
    .getElementById("global-edit-server-btn")
    .addEventListener("click", () => {
      const dropdown = document.getElementById("global-dropdown");
      const index = parseInt(dropdown.dataset.index);
      if (!isNaN(index)) {
        openServerFormModal(index);
      }
    });

  // 详情按钮
  document
    .getElementById("global-details-server-btn")
    .addEventListener("click", () => {
      const dropdown = document.getElementById("global-dropdown");
      const index = parseInt(dropdown.dataset.index);
      if (!isNaN(index)) {
        openServerDetailsModal(index);
        dropdown.classList.add("hidden");
      }
    });

  document
    .getElementById("close-server-details-modal-btn")
    .addEventListener("click", () => {
      document.getElementById("server-details-modal").classList.add("hidden");
    });

  // 点击详情模态框外部关闭
  document
    .getElementById("server-details-modal")
    .addEventListener("click", function (e) {
      if (e.target === this) {
        this.classList.add("hidden");
      }
    });

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
      fileInput.value = ""; // 重置以便再次选择同一文件
    };
    reader.onerror = () => showError("读取文件失败");
    reader.readAsText(file);
  });

  // 全局删除按钮事件
  document
    .getElementById("global-delete-server-btn")
    .addEventListener("click", (e) => {
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

    // 点击任意位置关闭全局下拉菜单
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

export function openServerModal() {
  switchAppPage("servers");

  renderServers();

  // 自动刷新所有服务器信息
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

    // 初始渲染时，获取信息
    fetchServerInfo(server.address, index);
  });
}

function createServerListItem(server, index) {
  const li = document.createElement("li");
  li.className = "server-item";
  li.dataset.address = server.address;

  let detailsHtml = `
        <div class="server-details" id="server-details-${index}">
          <span class="server-loading-text">加载中...</span>
        </div>
      `;
  li.innerHTML = `
      <div class="server-info">
        <span class="server-name" id="server-name-${index}">
          ${server.name}
        </span>
        <span class="server-address">${server.address}</span>
        ${detailsHtml}
      </div>
      <div class="server-actions">
        <button class="btn btn-small btn-primary connect-server-btn" data-address="${server.address}">
          ${SERVER_ICONS.play}
          <span>连接</span>
        </button>
        <button class="btn btn-small btn-secondary server-action-icon refresh-server-btn" title="刷新" data-address="${server.address}" data-index="${index}" aria-label="刷新服务器">
            ${SERVER_ICONS.refresh}
        </button>
        <button class="btn btn-small btn-secondary server-action-icon server-more-btn" title="更多操作" data-index="${index}" aria-label="更多操作">
            ${SERVER_ICONS.more}
        </button>
      </div>
    `;

  // 双击进入详情
  li.addEventListener("dblclick", (e) => {
    // 如果点击的是按钮，不触发详情
    if (e.target.closest("button")) return;
    openServerDetailsModal(index);
  });

  // 绑定连接按钮事件
  const connectBtn = li.querySelector(".connect-server-btn");
  if (connectBtn) {
    connectBtn.addEventListener("click", (e) => {
      const target = e.target.closest(".connect-server-btn");
      const address = target.dataset.address;
      connectServer(address);
    });
  }

  // 绑定刷新按钮事件
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

  // 绑定更多按钮事件
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

// 全局函数以便在HTML中调用
// window.refreshServerInfo 已废弃，因为移除了单个刷新按钮

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

async function resolveMapName(mapCode) {
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
  return mapCode; // Fallback to original
}

async function fetchServerInfo(address, index) {
  let detailsContainer = null;

  // 优先通过地址查找，以避免索引变化导致的错位
  // 遍历查找比querySelector更安全（防止特殊字符破坏选择器）
  const listItems = document.querySelectorAll("li.server-item");
  for (const li of listItems) {
    if (li.dataset.address === address) {
      detailsContainer = li.querySelector(".server-details");
      break;
    }
  }

  // 回退到通过ID查找
  if (!detailsContainer) {
    detailsContainer = document.getElementById(`server-details-${index}`);
  }

  if (!detailsContainer) return;

  try {
    const info = await FetchServerInfo(address);

    // 再次检查元素是否存在（防止异步期间被删除）
    if (!document.body.contains(detailsContainer)) return;

    detailsContainer.innerHTML = `
      <div class="server-stats-grid">
        <span class="stat-badge name-badge" title="${info.name}">${SERVER_ICONS.server}<span>${info.name}</span></span>
        <span class="stat-badge mode-badge" title="游戏模式">${SERVER_ICONS.mode}<span>${info.mode}</span></span>
        <span class="stat-badge map-badge" title="地图: ${info.map} (点击解析)" data-map-code="${info.map}">${SERVER_ICONS.map}<span>${info.map}</span></span>
        <span class="stat-badge players-badge" title="在线人数">${SERVER_ICONS.users}<span>${info.players}/${info.max_players}</span></span>
      </div>
    `;

    // 绑定地图点击事件
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
            mapBadge.innerHTML = `${SERVER_ICONS.map}<span>${realName}</span>`;
            mapBadge.dataset.resolved = "true";
            mapBadge.title = `地图: ${info.map}`;
            mapBadge.style.cursor = "default";
            // 移除 hover 效果
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

// function addServer() { ... } 已被整合到 saveServerForm 中，此处保留空函数或删除以避免引用错误
// 但为了安全起见，如果还有其他地方调用 addServer，可以保留一个兼容版本
function addServer() {
  openServerFormModal(-1);
}

function deleteServer(index) {
  console.log("deleteServer called with index:", index);
  const servers = getServers();
  const server = servers[index];

  if (!server) {
    console.error("Server not found at index:", index);
    showError("无法找到要删除的服务器");
    return;
  }

  showConfirmModal(
    "删除服务器",
    `确定要删除服务器 "${server.name}" 吗？`,
    () => {
      console.log("Confirm callback executed for index:", index);
      const currentServers = getServers();
      // 确保 index 是数字
      const idx = parseInt(index);

      if (!isNaN(idx) && idx >= 0 && idx < currentServers.length) {
        currentServers.splice(idx, 1);
        saveServers(currentServers);
        renderLaunchServerMenu();

        // 直接从DOM中移除元素，而不是重新渲染整个列表
        const list = document.getElementById("server-list");
        const itemToRemove = list.children[idx];
        if (itemToRemove) {
          list.removeChild(itemToRemove);

          // 更新剩余项的索引
          Array.from(list.children).forEach((li, newIndex) => {
            // 更新更多按钮的索引
            const moreBtn = li.querySelector(".server-more-btn");
            if (moreBtn) moreBtn.dataset.index = newIndex;

            // 更新详情容器ID (如果需要的话，虽然不更新也不影响显示，但为了保持一致性)
            const details = li.querySelector(".server-details");
            if (details) details.id = `server-details-${newIndex}`;

            // 更新名称ID
            const nameEl = li.querySelector(".server-name");
            if (nameEl) nameEl.id = `server-name-${newIndex}`;
          });
        } else {
          // 如果DOM操作失败，回退到重新渲染（但不自动刷新信息）
          renderServers(false);
        }

        showNotification("服务器已删除", "success");
      } else {
        console.error("Invalid index in callback:", idx);
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
  const servers = getServers();
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
  const servers = getServers();
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
        // 检查是否存在
        const existingIndex = currentServers.findIndex(
          (s) => s.address === server.address
        );

        if (existingIndex === -1) {
          currentServers.push({
            name: server.name,
            address: server.address,
            weight: server.weight || 0,
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

async function openServerDetailsModal(index) {
  const servers = getServers();
  const server = servers[index];
  if (!server) return;

  const modal = document.getElementById("server-details-modal");
  const title = document.getElementById("details-server-name");
  const loading = document.getElementById("server-details-loading");
  const content = document.getElementById("server-details-content");
  const mapEl = document.getElementById("details-map");
  const playersEl = document.getElementById("details-players");
  const listEl = document.getElementById("details-player-list");

  title.textContent = server.name;
  loading.classList.remove("hidden");
  content.classList.add("hidden");
  modal.classList.remove("hidden");

  try {
    // Fetch basic info first
    const info = await FetchServerInfo(server.address);
    mapEl.textContent = info.map;
    mapEl.title = `地图: ${info.map}`;
    playersEl.textContent = `${info.players}/${info.max_players}`;

    // 异步尝试解析地图名
    resolveMapName(info.map).then((realName) => {
      if (realName !== info.map && document.body.contains(mapEl)) {
        mapEl.textContent = realName;
        mapEl.title = `地图: ${info.map}`;
      }
    });

    const players = await FetchPlayerList(server.address);

    listEl.innerHTML = "";
    if (players && players.length > 0) {
      // Sort by score desc
      players.sort((a, b) => b.score - a.score);

      players.forEach((p) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
                    <td class="player-name">${escapeHtml(p.name)}</td>
                    <td class="text-right">${p.score}</td>
                    <td class="text-right">${formatDuration(p.duration)}</td>
                `;
        listEl.appendChild(tr);
      });
    } else {
      listEl.innerHTML =
        '<tr><td colspan="3" class="empty-state">暂无玩家信息</td></tr>';
    }

    loading.classList.add("hidden");
    content.classList.remove("hidden");
  } catch (err) {
    console.error(err);
    loading.textContent = "获取失败: " + err;
  }
}

function formatDuration(seconds) {
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

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text) {
  return escapeHtml(text).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
