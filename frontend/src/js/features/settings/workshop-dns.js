import { updateConfigCache } from "../../core/config.js";

const DNS_MODES = [
  ["dnspod", "腾讯 DNS · 119.29.29.29（默认）"],
  ["alidns", "阿里 DNS · 223.5.5.5"],
  ["custom", "自定义 DNS"],
  ["system", "使用系统 DNS"],
];

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function isDNSAddress(address) {
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(address)) {
    const parts = address.split(".");
    return parts.every((part) => String(Number(part)) === part && Number(part) <= 255)
      && parts.some((part) => Number(part) !== 0)
      && !(Number(parts[0]) >= 224 && Number(parts[0]) <= 239);
  }
  if (!address.includes(":") || !/^[\da-f:.]+$/i.test(address)) return false;
  try {
    const host = new URL(`http://[${address}]/`).hostname.toLowerCase();
    return host !== "[::]" && !host.startsWith("[ff");
  } catch {
    return false;
  }
}

export async function appendWorkshopDNSSettings(container, {
  GetWorkshopDNSConfig,
  SetWorkshopDNSConfig,
  showNotification,
}) {
  const panel = container.querySelector("#settings-panel-network");
  if (!panel) return;
  let savedConfig = await GetWorkshopDNSConfig();
  if (!panel.isConnected) return;

  const form = element("form", "setting-card settings-dns-card");
  form.id = "settings-workshop-dns-form";
  form.noValidate = true;
  form.append(
    element("div", "setting-card-title", "工坊 DNS"),
    element("div", "setting-row-desc", "用于工坊列表、详情和链接解析，新联网请求立即生效。"),
  );
  const controls = element("div", "setting-indent");
  const modes = element("div", "setting-radio-group");
  const radios = DNS_MODES.map(([value, title]) => {
    const label = element("label", "setting-radio-label");
    const radio = element("input");
    radio.type = "radio";
    radio.name = "settings-workshop-dns-mode";
    radio.value = value;
    radio.checked = value === savedConfig.mode;
    label.append(radio, element("span", "", title));
    modes.append(label);
    return radio;
  });

  const customTools = element("div", "settings-dns-custom");
  const customLabel = element("label", "setting-row-label", "自定义 DNS 地址");
  const addressInput = element("input", "form-input");
  addressInput.id = "settings-workshop-dns-address";
  addressInput.type = "text";
  addressInput.value = savedConfig.customAddress || "";
  addressInput.placeholder = "例如：119.29.29.29";
  addressInput.autocomplete = "off";
  addressInput.spellcheck = false;
  customLabel.htmlFor = addressInput.id;
  customTools.append(customLabel, addressInput);
  controls.append(modes, customTools);

  const errorText = element("div", "settings-dns-error");
  errorText.id = "settings-workshop-dns-error";
  errorText.setAttribute("role", "alert");
  errorText.hidden = true;
  addressInput.setAttribute("aria-describedby", errorText.id);
  const actions = element("div", "settings-dns-actions");
  const saveButton = element("button", "btn btn-primary", "保存");
  saveButton.type = "submit";
  actions.append(saveButton);
  form.append(controls, errorText, actions);
  panel.append(form);

  const selectedMode = () => radios.find((radio) => radio.checked)?.value || savedConfig.mode;
  const syncCustomTools = () => { customTools.hidden = selectedMode() !== "custom"; };
  const clearError = () => {
    errorText.hidden = true;
    errorText.textContent = "";
    addressInput.removeAttribute("aria-invalid");
  };
  const showError = (message, invalidAddress = false) => {
    errorText.textContent = message;
    errorText.hidden = false;
    if (invalidAddress) {
      addressInput.setAttribute("aria-invalid", "true");
      addressInput.focus();
    }
  };
  radios.forEach((radio) => radio.addEventListener("change", () => {
    syncCustomTools();
    clearError();
  }));
  addressInput.addEventListener("input", clearError);
  syncCustomTools();

  let saving = false;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (saving) return;
    clearError();
    const mode = selectedMode();
    const customAddress = mode === "custom" ? addressInput.value.trim() : savedConfig.customAddress || "";
    if (mode === "custom" && !isDNSAddress(customAddress)) {
      showError("请输入单个有效的 IPv4 或 IPv6 地址。", true);
      return;
    }

    saving = true;
    [...radios, addressInput, saveButton].forEach((control) => { control.disabled = true; });
    saveButton.textContent = "保存中…";
    try {
      await SetWorkshopDNSConfig({ mode, customAddress });
      savedConfig = { mode, customAddress };
      updateConfigCache({ workshopDNS: savedConfig });
      addressInput.value = customAddress;
      showNotification("工坊 DNS 已更新", "success");
    } catch (error) {
      showError(String(error?.message || error || "保存工坊 DNS 设置失败"));
    } finally {
      saving = false;
      [...radios, addressInput, saveButton].forEach((control) => { control.disabled = false; });
      saveButton.textContent = "保存";
    }
  });
}
