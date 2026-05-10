const SETTINGS_NAV_ICONS = {
  network: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 0 20"/><path d="M12 2a15.3 15.3 0 0 0 0 20"/></svg>`,
  interface: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 20h8"/><path d="M12 18v2"/></svg>`,
  workshop: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z"/><path d="M9 21h6"/></svg>`,
};

export async function renderSettingsPage({
  appState,
  getConfig,
  saveConfig,
  renderFileList,
  refreshFilesKeepFilter,
  showNotification,
  GetWorkshopPreferredIP,
  GetWorkshopFixedIP,
  GetWorkshopMetaEnabled,
  GetWorkshopBrowserTarget,
  IsSelectingIP,
  GetCurrentBestIP,
  SetWorkshopPreferredIP,
  SetWorkshopFixedIP,
  SetWorkshopMetaEnabled,
  SetWorkshopBrowserTarget,
}) {
  const container = document.getElementById("settings-page-content");
  if (!container) return;

  const enabled = await GetWorkshopPreferredIP();
  const fixedIP = await GetWorkshopFixedIP();
  const useFixedIP = enabled && fixedIP !== "";
  const metaEnabled = await GetWorkshopMetaEnabled();
  const browserTarget = await GetWorkshopBrowserTarget();
  const isSelecting = enabled ? await IsSelectingIP() : false;
  const bestIP = enabled && !isSelecting ? await GetCurrentBestIP() : "";

  let ipStatusText = "";
  if (enabled) {
    if (isSelecting) {
      ipStatusText = "正在优选最佳线路...";
    } else if (bestIP) {
      ipStatusText = useFixedIP ? `当前固定 IP: ${bestIP}` : `当前优选 IP: ${bestIP}`;
    } else {
      ipStatusText = "尚未获取到优选 IP";
    }
  }

  container.innerHTML = `
    <div class="settings-layout embedded-settings">
      <div class="settings-sidebar">
        <button class="settings-nav-item active" data-panel="network">网络设置</button>
        <button class="settings-nav-item" data-panel="interface">界面设置</button>
        <button class="settings-nav-item" data-panel="workshop">工坊设置</button>
      </div>
      <div class="settings-content">
        <div class="settings-panels-track">
        <div class="settings-panel active" id="settings-panel-network">
          <div class="setting-card">
            <div class="setting-card-title">网络加速</div>
            <div class="setting-row">
              <div class="setting-row-info">
                <div class="setting-row-label">开启优选 IP 加速</div>
                <div class="setting-row-desc">加速创意工坊图片与文件下载</div>
                ${ipStatusText ? `<div class="setting-row-status">${ipStatusText}</div>` : ""}
              </div>
              <label class="toggle-switch">
                <input type="checkbox" id="settings-preferred-ip" ${enabled ? "checked" : ""}>
                <span class="toggle-slider"></span>
              </label>
            </div>
            <div id="settings-ip-mode-section" class="setting-indent" style="${enabled ? "" : "display:none"}">
              <div class="setting-row-label">加速模式</div>
              <div class="setting-radio-group">
                <label class="setting-radio-label"><input type="radio" name="settings-ip-mode" value="auto" ${useFixedIP ? "" : "checked"}><span>自动优选最佳 IP（推荐）</span></label>
                <label class="setting-radio-label"><input type="radio" name="settings-ip-mode" value="fixed" ${useFixedIP ? "checked" : ""}><span>手动指定 IP</span></label>
              </div>
              <input type="text" id="settings-fixed-ip" class="form-input" value="${escapeAttr(fixedIP)}" placeholder="例如: 23.59.72.59" style="${useFixedIP ? "" : "display:none"}">
            </div>
          </div>
        </div>

        <div class="settings-panel" id="settings-panel-interface">
          <div class="setting-card">
            <div class="setting-card-title">显示偏好</div>
            <div class="setting-row">
              <div class="setting-row-info">
                <div class="setting-row-label">显示模式</div>
                <div class="setting-row-desc">切换文件列表的显示布局</div>
              </div>
              <div class="mode-toggle-group">
                <label class="mode-option ${appState.displayMode === "list" ? "active" : ""}">
                  <input type="radio" name="settings-display-mode" value="list" ${appState.displayMode === "list" ? "checked" : ""}>
                  <span class="mode-text">列表</span>
                </label>
                <label class="mode-option ${appState.displayMode === "card" ? "active" : ""}">
                  <input type="radio" name="settings-display-mode" value="card" ${appState.displayMode === "card" ? "checked" : ""}>
                  <span class="mode-text">卡片</span>
                </label>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-row-info">
                <div class="setting-row-label">框选模式</div>
                <div class="setting-row-desc">拖拽绘制选择框，批量选择 VPK 文件</div>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" id="settings-box-selection" ${appState.boxSelectionEnabled ? "checked" : ""}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
        </div>

        <div class="settings-panel" id="settings-panel-workshop">
          <div class="setting-card">
            <div class="setting-card-title">工坊数据</div>
            <div class="setting-row">
              <div class="setting-row-info">
                <div class="setting-row-label">开启工坊信息存储</div>
                <div class="setting-row-desc">为工坊文件创建 .meta 文件，存储名称、作者等信息</div>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" id="settings-meta-enabled" ${metaEnabled ? "checked" : ""}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
          <div class="setting-card">
            <div class="setting-card-title">浏览器跳转</div>
            <div class="setting-row">
              <div class="setting-row-info">
                <div class="setting-row-label">跳转目标</div>
                <div class="setting-row-desc">选择“使用浏览器打开”时跳转的网站</div>
              </div>
              <div class="setting-radio-group">
                <label class="setting-radio-label"><input type="radio" name="settings-browser-target" value="mirror" ${browserTarget === "mirror" ? "checked" : ""}><span>镜像站 l4d2ws.com</span></label>
                <label class="setting-radio-label"><input type="radio" name="settings-browser-target" value="steam" ${browserTarget === "steam" ? "checked" : ""}><span>Steam 官方工坊</span></label>
              </div>
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  `;

  bindSettingsPage({
    enabled,
    fixedIP,
    metaEnabled,
    browserTarget,
    appState,
    getConfig,
    saveConfig,
    renderFileList,
    refreshFilesKeepFilter,
    showNotification,
    SetWorkshopPreferredIP,
    SetWorkshopFixedIP,
    SetWorkshopMetaEnabled,
    SetWorkshopBrowserTarget,
  });
}

function bindSettingsPage(deps) {
  enhanceSettingsNav();

  document.querySelectorAll("#settings-page-content .settings-nav-item").forEach((item) => {
    item.addEventListener("click", () => {
      const target = item.dataset.panel;
      updateSettingsPanelDirection(item);
      document.querySelectorAll("#settings-page-content .settings-nav-item").forEach((nav) => nav.classList.remove("active"));
      document.querySelectorAll("#settings-page-content .settings-panel").forEach((panel) => panel.classList.remove("active"));
      item.classList.add("active");
      document.getElementById(`settings-panel-${target}`)?.classList.add("active");
      updateSettingsNavIndicator();
    });
  });

  const ipToggle = document.getElementById("settings-preferred-ip");
  const ipSection = document.getElementById("settings-ip-mode-section");
  const fixedInput = document.getElementById("settings-fixed-ip");
  ipToggle?.addEventListener("change", async () => {
    ipSection.style.display = ipToggle.checked ? "block" : "none";
    await deps.SetWorkshopPreferredIP(ipToggle.checked);
    const config = deps.getConfig();
    config.workshopPreferredIP = ipToggle.checked;
    deps.saveConfig(config);
    deps.showNotification(ipToggle.checked ? "已开启优选 IP 加速" : "已关闭优选 IP 加速", ipToggle.checked ? "success" : "info");
  });

  document.querySelectorAll('input[name="settings-ip-mode"]').forEach((radio) => {
    radio.addEventListener("change", async () => {
      const useFixed = radio.value === "fixed" && radio.checked;
      fixedInput.style.display = useFixed ? "block" : "none";
      if (!useFixed) {
        await deps.SetWorkshopFixedIP("");
      }
    });
  });

  fixedInput?.addEventListener("change", async () => {
    await deps.SetWorkshopFixedIP(fixedInput.value.trim());
    deps.showNotification("已更新固定 IP 设置", "success");
  });

  document.querySelectorAll('input[name="settings-display-mode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      deps.appState.displayMode = radio.value;
      const config = deps.getConfig();
      config.displayMode = radio.value;
      deps.saveConfig(config);
      document.querySelectorAll("#settings-page-content .mode-option").forEach((option) => option.classList.remove("active"));
      radio.closest(".mode-option")?.classList.add("active");
      deps.renderFileList();
    });
  });

  document.getElementById("settings-box-selection")?.addEventListener("change", (e) => {
    deps.appState.boxSelectionEnabled = e.target.checked;
    const config = deps.getConfig();
    config.boxSelectionEnabled = e.target.checked;
    deps.saveConfig(config);
    deps.showNotification(e.target.checked ? "已开启框选模式" : "已关闭框选模式", "info");
  });

  document.getElementById("settings-meta-enabled")?.addEventListener("change", async (event) => {
    await deps.SetWorkshopMetaEnabled(event.target.checked);
    deps.showNotification(event.target.checked ? "已开启工坊信息存储" : "已关闭工坊信息存储", event.target.checked ? "success" : "info");
    await deps.refreshFilesKeepFilter();
  });

  document.querySelectorAll('input[name="settings-browser-target"]').forEach((radio) => {
    radio.addEventListener("change", async () => {
      if (!radio.checked) return;
      await deps.SetWorkshopBrowserTarget(radio.value);
      deps.showNotification(radio.value === "mirror" ? "已切换到镜像站" : "已切换到 Steam 官方", "success");
    });
  });
}

function enhanceSettingsNav() {
  const sidebar = document.querySelector("#settings-page-content .settings-sidebar");
  if (!sidebar) return;

  if (!sidebar.querySelector(".settings-active-indicator")) {
    sidebar.insertAdjacentHTML("afterbegin", `<div class="settings-active-indicator" aria-hidden="true"></div>`);
  }

  sidebar.querySelectorAll(".settings-nav-item").forEach((item) => {
    const panel = item.dataset.panel;
    if (!panel || item.querySelector(".settings-nav-icon")) return;
    item.insertAdjacentHTML(
      "afterbegin",
      `<span class="settings-nav-icon">${SETTINGS_NAV_ICONS[panel] || SETTINGS_NAV_ICONS.interface}</span>`
    );
  });

  updateSettingsNavIndicator(true);
  requestAnimationFrame(() => updateSettingsNavIndicator(true));
}

function updateSettingsNavIndicator(skipTransition = false) {
  const sidebar = document.querySelector("#settings-page-content .settings-sidebar");
  const indicator = sidebar?.querySelector(".settings-active-indicator");
  const activeItem = sidebar?.querySelector(".settings-nav-item.active");
  if (!sidebar || !indicator || !activeItem) return;

  if (skipTransition) {
    indicator.style.transition = "none";
  }

  const sidebarRect = sidebar.getBoundingClientRect();
  const itemRect = activeItem.getBoundingClientRect();

  if (window.matchMedia("(max-width: 640px)").matches) {
    indicator.style.width = `${itemRect.width}px`;
    indicator.style.height = `${itemRect.height}px`;
    indicator.style.transform = `translate(${itemRect.left - sidebarRect.left + sidebar.scrollLeft}px, ${itemRect.top - sidebarRect.top}px)`;
  } else {
    indicator.style.width = "";
    indicator.style.height = `${itemRect.height}px`;
    indicator.style.transform = `translateY(${itemRect.top - sidebarRect.top + sidebar.scrollTop}px)`;
  }

  if (skipTransition) {
    indicator.offsetHeight;
    indicator.style.transition = "";
  }
}

window.addEventListener("resize", () => {
  updateSettingsNavIndicator(true);
});

function updateSettingsPanelDirection(nextItem) {
  const content = document.querySelector("#settings-page-content .settings-content");
  const activeItem = document.querySelector("#settings-page-content .settings-nav-item.active");
  if (!content || !activeItem || !nextItem || activeItem === nextItem) return;
  const items = Array.from(document.querySelectorAll("#settings-page-content .settings-nav-item"));
  content.dataset.settingsDirection = items.indexOf(nextItem) >= items.indexOf(activeItem) ? "down" : "up";
}

function escapeAttr(value) {
  return String(value || "").replace(/"/g, "&quot;");
}
