import { updateConfigCache } from "../../core/config.js";

const DNS_MODES = [
  ["dnspod", "腾讯 DNS · 119.29.29.29（默认）"],
  ["alidns", "阿里 DNS · 223.5.5.5"],
  ["custom", "自定义 DNS"],
  ["system", "使用系统 DNS"],
];

let pendingSave = Promise.resolve();
let pendingOperations = 0;
let confirmedConfig;
let savedRevision = 0;
let activeCard;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function normalizeDNSAddress(value) {
  const address = value.trim();
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(address)) {
    const parts = address.split(".");
    const valid = parts.every((part) => String(Number(part)) === part && Number(part) <= 255)
      && parts.some((part) => Number(part) !== 0)
      && !(Number(parts[0]) >= 224 && Number(parts[0]) <= 239);
    return valid ? parts.join(".") : null;
  }
  if (!address.includes(":") || address.length > 45 || !/^[\da-f:.]+$/i.test(address)) return null;
  try {
    const host = new URL(`http://[${address}]/`).hostname.slice(1, -1).toLowerCase();
    if (host.startsWith("::ffff:")) {
      const words = host.slice(7).split(":");
      if (words.length === 2) {
        const [a, b] = words.map((word) => Number.parseInt(word, 16));
        return normalizeDNSAddress(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`);
      }
    }
    return host !== "::" && !host.startsWith("ff") ? host : null;
  } catch {
    return null;
  }
}

export async function appendWorkshopDNSSettings(container, {
  isCurrentRender = () => true,
  GetWorkshopDNSConfig,
  SetWorkshopDNSConfig,
  showNotification,
}) {
  const panel = container.querySelector("#settings-panel-network");
  if (!panel) return;
  let form;
  const isCurrentPage = () => panel.isConnected && (!form || form.isConnected) && isCurrentRender();
  const revisionAtRead = savedRevision;
  let savedConfig;
  try {
    const loaded = await GetWorkshopDNSConfig();
    savedConfig = savedRevision !== revisionAtRead && confirmedConfig ? { ...confirmedConfig } : {
      mode: loaded.mode,
      customAddress: loaded.customAddress || "",
    };
  } catch {
    if (isCurrentPage()) {
      const error = element("div", "setting-card settings-dns-error", "读取工坊 DNS 设置失败，请重新打开设置。");
      error.setAttribute("role", "alert");
      panel.append(error);
    }
    return;
  }
  if (!isCurrentPage()) return;
  confirmedConfig = { ...savedConfig };

  form = element("form", "setting-card settings-dns-card");
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
  form.append(controls, errorText);
  panel.append(form);

  const selectedMode = () => radios.find((radio) => radio.checked)?.value || savedConfig.mode;
  const syncCustomTools = () => { customTools.hidden = selectedMode() !== "custom"; };
  const clearError = () => {
    errorText.hidden = true;
    errorText.textContent = "";
    addressInput.removeAttribute("aria-invalid");
  };
  const showError = (message, invalidAddress = false, focus = false) => {
    errorText.textContent = message;
    errorText.hidden = false;
    if (invalidAddress) {
      addressInput.setAttribute("aria-invalid", "true");
      if (focus) addressInput.focus();
    }
  };
  let saving = false;
  let dirty = false;
  const restoreSaved = () => {
    radios.forEach((radio) => { radio.checked = radio.value === savedConfig.mode; });
    addressInput.value = savedConfig.customAddress;
    dirty = false;
    syncCustomTools();
  };
  activeCard = {
    acceptSaved(config) {
      savedConfig = { ...config };
      if (isCurrentPage() && !dirty && !saving) restoreSaved();
    },
  };
  const persistSelection = async (source = "radio", focusInvalid = false) => {
    if (saving || !isCurrentPage()) return;
    clearError();
    const mode = selectedMode();
    const customAddress = mode === "custom" ? normalizeDNSAddress(addressInput.value) : savedConfig.customAddress;
    if (mode === "custom" && customAddress === null) {
      if (source === "radio") addressInput.focus();
      else showError("请输入单个有效的 IPv4 或 IPv6 地址；该设置尚未生效。", true, focusInvalid);
      return;
    }
    if (mode === savedConfig.mode && customAddress === savedConfig.customAddress && pendingOperations === 0) return;

    saving = true;
    [...radios, addressInput].forEach((control) => { control.disabled = true; });
    form.setAttribute("aria-busy", "true");
    pendingOperations++;
    try {
      const operation = pendingSave.then(async () => {
        // A newer page's preset choice keeps the last durably saved custom
        // address, including an earlier page's write which just completed.
        const next = { mode, customAddress: mode === "custom" ? customAddress : confirmedConfig?.customAddress || "" };
        await SetWorkshopDNSConfig(next);
        confirmedConfig = { ...next };
        savedRevision++;
        updateConfigCache({ workshopDNS: next });
        activeCard?.acceptSaved(next);
        return next;
      });
      pendingSave = operation.catch(() => {});
      savedConfig = await operation;
      if (isCurrentPage()) {
        restoreSaved();
        showNotification?.("工坊 DNS 已更新", "success");
      }
    } catch {
      if (isCurrentPage()) {
        if (source === "radio") restoreSaved();
        showError(source === "radio"
          ? "保存工坊 DNS 设置失败，已恢复原设置，请重新选择重试。"
          : "保存工坊 DNS 设置失败，请按 Enter 或移开焦点重试。");
      }
    } finally {
      saving = false;
      pendingOperations--;
      if (isCurrentPage()) {
        [...radios, addressInput].forEach((control) => { control.disabled = false; });
        form.setAttribute("aria-busy", "false");
      }
    }
  };
  const changeMode = () => {
    if (saving || !isCurrentPage()) return;
    dirty = true;
    syncCustomTools();
    return persistSelection("radio");
  };
  radios.forEach((radio) => {
    radio.addEventListener("change", changeMode);
    radio.addEventListener("click", () => {
      if (radio.checked && radio.value === savedConfig.mode && pendingOperations > 0) return changeMode();
    });
  });
  addressInput.addEventListener("input", () => { dirty = true; clearError(); });
  addressInput.addEventListener("change", () => { dirty = true; clearError(); });
  addressInput.addEventListener("blur", (event) => {
    // Let a following radio click commit its full choice; disabling the card
    // during the input's change/blur would otherwise swallow that click.
    if (radios.includes(event.relatedTarget) && event.relatedTarget.value !== selectedMode()) return;
    if (selectedMode() === "custom") return persistSelection("text");
  });
  addressInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    if (selectedMode() === "custom") return persistSelection("text", true);
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    return persistSelection(selectedMode() === "custom" ? "text" : "radio", true);
  });
  syncCustomTools();
}
