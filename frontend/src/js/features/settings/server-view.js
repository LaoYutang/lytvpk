import {
  getServerDisplayMode,
  setServerDisplayMode,
} from "../servers/view-mode.js";

export function appendServerViewSettings(layout, {
  isCurrentRender = () => true,
  showNotification,
  showError,
  getMode = getServerDisplayMode,
  setMode = setServerDisplayMode,
} = {}) {
  const card = layout.querySelector("#settings-panel-interface .setting-card");
  if (!card || !isCurrentRender()) return;

  const row = document.createElement("div");
  row.className = "setting-row";
  row.id = "settings-server-view-row";
  const info = document.createElement("div");
  info.className = "setting-row-info";
  const label = document.createElement("div");
  label.className = "setting-row-label";
  label.textContent = "服务器视图";
  const description = document.createElement("div");
  description.className = "setting-row-desc";
  description.textContent = "小卡片紧凑展示收藏服务器，突出服务器报告的人数；下次启动时保留选择";
  info.append(label, description);
  const group = document.createElement("div");
  group.className = "mode-toggle-group";
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", "服务器视图");
  const options = [];

  function sync() {
    const mode = getMode();
    for (const { option, radio } of options) {
      radio.checked = radio.value === mode;
      option.classList.toggle("active", radio.checked);
    }
  }

  for (const [value, title] of [["list", "列表"], ["card", "小卡片"]]) {
    const option = document.createElement("label");
    option.className = "mode-option";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "settings-server-display-mode";
    radio.value = value;
    const text = document.createElement("span");
    text.className = "mode-text";
    text.textContent = title;
    option.append(radio, text);
    group.appendChild(option);
    options.push({ option, radio });
    radio.addEventListener("change", async () => {
      if (!radio.checked || radio.disabled || !isCurrentRender() || !row.isConnected) return;
      for (const entry of options) entry.radio.disabled = true;
      try {
        await setMode(radio.value);
        if (isCurrentRender() && row.isConnected) {
          showNotification?.(radio.value === "card" ? "服务器已切换到小卡片模式" : "服务器已切换到列表模式", "success");
        }
      } catch (error) {
        if (isCurrentRender() && row.isConnected) showError?.(`保存服务器视图失败: ${error}`);
      } finally {
        sync();
        for (const entry of options) entry.radio.disabled = false;
      }
    });
  }

  sync();
  row.append(info, group);
  card.appendChild(row);
}
