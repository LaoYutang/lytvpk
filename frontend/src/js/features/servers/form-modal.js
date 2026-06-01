import { normalizePanelUrl } from "./panel-url.js";

let showError;
let showNotification;
let getServers;
let saveServers;
let initServerStorage;
let renderServers;
let renderLaunchServerMenu;
let fetchServerInfo;

export function configureFormModal(deps) {
  ({
    showError,
    showNotification,
    getServers,
    saveServers,
    initServerStorage,
    renderServers,
    renderLaunchServerMenu,
    fetchServerInfo,
  } = deps);
}

let currentEditIndex = -1;
let isEditMode = false;

export function openServerFormModal(index = -1) {
  const modal = document.getElementById("server-form-modal");
  const title = document.getElementById("server-form-title");
  const nameInput = document.getElementById("form-server-name");
  const addressInput = document.getElementById("form-server-address");
  const weightInput = document.getElementById("form-server-weight");
  const panelUrlInput = document.getElementById("form-server-panel-url");
  const panelPasswordInput = document.getElementById("form-server-panel-password");
  const clearPasswordInput = document.getElementById("form-clear-panel-password");
  const passwordStatus = document.getElementById("panel-password-status");
  const advancedContent = document.getElementById("server-advanced-content");
  const advancedToggle = document.getElementById("server-advanced-toggle");

  nameInput.value = "";
  addressInput.value = "";
  weightInput.value = "0";
  if (panelUrlInput) panelUrlInput.value = "";
  if (panelPasswordInput) {
    panelPasswordInput.value = "";
    panelPasswordInput.placeholder = "面板访问密码";
  }
  if (clearPasswordInput) clearPasswordInput.checked = false;
  if (passwordStatus) {
    passwordStatus.textContent = "未保存密码";
    passwordStatus.classList.remove("active");
  }
  advancedContent?.classList.add("hidden");
  advancedToggle?.setAttribute("aria-expanded", "false");

  if (index >= 0) {
    isEditMode = true;
    currentEditIndex = index;
    title.textContent = "编辑服务器";

    const servers = getServers();
    const server = servers[index];
    if (server) {
      nameInput.value = server.name;
      addressInput.value = server.address;
      weightInput.value = server.weight || 0;
      if (panelUrlInput) panelUrlInput.value = server.panelUrl || "";
      if (panelPasswordInput && server.panelPasswordSet) {
        panelPasswordInput.placeholder = "留空则保留已保存密码";
      }
      if (passwordStatus) {
        passwordStatus.textContent = server.panelPasswordSet
          ? "已保存密码"
          : "未保存密码";
        passwordStatus.classList.toggle("active", Boolean(server.panelPasswordSet));
      }
    }
  } else {
    isEditMode = false;
    currentEditIndex = -1;
    title.textContent = "添加服务器";
  }

  modal.classList.remove("hidden");
  document.getElementById("global-dropdown").classList.add("hidden");
}

export function closeServerFormModal() {
  document.getElementById("server-form-modal").classList.add("hidden");
  currentEditIndex = -1;
  isEditMode = false;
}

export async function saveServerForm() {
  const name = document.getElementById("form-server-name").value.trim();
  const address = document.getElementById("form-server-address").value.trim();
  const weight =
    parseInt(document.getElementById("form-server-weight").value) || 0;
  const panelUrl = normalizePanelUrl(
    document.getElementById("form-server-panel-url")?.value
  );
  const panelPassword =
    document.getElementById("form-server-panel-password")?.value.trim() || "";
  const clearPanelPassword = Boolean(
    document.getElementById("form-clear-panel-password")?.checked
  );

  if (!name || !address) {
    showError("请输入服务器名称和地址");
    return;
  }

  const servers = getServers();
  const buildServerPayload = (existing = {}) => {
    const next = {
      ...existing,
      name,
      address,
      weight,
      panelUrl,
      panelPasswordSet: clearPanelPassword
        ? false
        : Boolean(existing.panelPasswordSet || panelPassword),
    };
    if (panelPassword) {
      next.panelPassword = panelPassword;
      next.clearPanelPassword = false;
    } else if (clearPanelPassword) {
      next.clearPanelPassword = true;
    }
    return next;
  };

  try {
    if (isEditMode) {
      if (currentEditIndex >= 0 && currentEditIndex < servers.length) {
        servers[currentEditIndex] = buildServerPayload(servers[currentEditIndex]);
        await saveServers(servers);
        await initServerStorage();
        showNotification("服务器修改成功", "success");
      }
    } else {
      servers.push(buildServerPayload());
      await saveServers(servers);
      await initServerStorage();
      showNotification("服务器添加成功", "success");
    }
  } catch (err) {
    console.error("保存服务器失败:", err);
    return;
  }

  renderServers();
  renderLaunchServerMenu();
  closeServerFormModal();

  const newServers = getServers();
  const newIndex = newServers.findIndex(
    (s) => s.address === address && s.name === name
  );
  if (newIndex !== -1) {
    fetchServerInfo(address, newIndex);
  }
}

function toggleServerAdvancedConfig() {
  const content = document.getElementById("server-advanced-content");
  const toggle = document.getElementById("server-advanced-toggle");
  const expanded = content.classList.toggle("hidden") === false;
  toggle.setAttribute("aria-expanded", String(expanded));
}

export function setupFormModalListeners() {
  document
    .getElementById("open-add-server-modal-btn")
    .addEventListener("click", () => openServerFormModal(-1));

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

  document
    .getElementById("server-advanced-toggle")
    ?.addEventListener("click", toggleServerAdvancedConfig);
}
