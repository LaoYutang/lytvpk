import { updateConfigCache } from "../../core/config.js";
import { getAPILineSnapshot, isCurrentAPILine, subscribeAPILineChange } from "../../core/api-line.js";
import { updateAPILineStatus } from "./api-line.js";

let pendingSave = Promise.resolve();
let activeCard;
let confirmedSettings;
let savedRevision = 0;
let queuedWrites = 0;
let activeIPDropdown;
const candidateRequests = new WeakMap();
subscribeAPILineChange(() => activeIPDropdown?.invalidate());

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function normalizeFixedIP(value) {
  if (typeof value !== "string") return null;
  const address = value.trim();
  if (!address || address.length > 45 || /[^0-9a-fA-F:.]/.test(address)) return null;
  if (!address.includes(":")) {
    const parts = address.split(".");
    if (parts.length !== 4 || parts.some((part) => !/^(0|[1-9][0-9]{0,2})$/.test(part) || Number(part) > 255)) return null;
    const bytes = parts.map(Number);
    return bytes.join(".");
  }
  if (address.includes(".")) {
    const tail = address.slice(address.lastIndexOf(":") + 1);
    if (!normalizeFixedIP(tail)) return null;
  }
  try {
    const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1).toLowerCase();
    if (normalized.startsWith("::ffff:")) {
      const words = normalized.slice(7).split(":");
      if (words.length === 2) {
        const [a, b] = words.map((word) => Number.parseInt(word, 16));
        return normalizeFixedIP(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`);
      }
    }
    return normalized;
  } catch {
    return null;
  }
}

function settingsPair(value) {
  if (typeof value?.enabled !== "boolean" || typeof value?.fixedIP !== "string") throw new Error("invalid settings");
  return { enabled: value.enabled, fixedIP: value.fixedIP.trim() };
}

export async function appendPreferredIPSettings(container, {
  isCurrentRender = () => true,
  GetWorkshopIPSettings,
  SetWorkshopIPSettings,
  GetWorkshopIPOptions,
  GetAPILineStatus,
  IsSelectingIP,
  GetCurrentBestIP,
  GetCurrentBestIPOption,
  EventsOn,
  showNotification,
  deferCandidateLoad = false,
}) {
  const panel = container.querySelector("#settings-panel-network");
  if (!panel) return null;
  activeCard?.dispose();
  const form = element("form", "setting-card settings-dns-card");
  form.id = "settings-preferred-ip-form";
  form.noValidate = true;
  form.append(element("div", "setting-card-title", "网络加速"));
  const error = element("div", "settings-dns-error");
  error.id = "settings-preferred-ip-error";
  error.setAttribute("role", "alert");
  error.hidden = true;
  panel.append(form);
  let disposed = false;
  const isCurrentPage = () => !disposed && form.isConnected && isCurrentRender();
  const revisionAtRead = savedRevision;
  let saved;
  try {
    const loaded = settingsPair(await GetWorkshopIPSettings());
    saved = savedRevision !== revisionAtRead && confirmedSettings ? { ...confirmedSettings } : loaded;
  } catch {
    if (isCurrentPage()) {
      error.textContent = "读取 IP 设置失败，请重新打开设置。";
      error.hidden = false;
      form.append(error);
    }
    return isCurrentPage() ? form : null;
  }
  if (!isCurrentPage()) return null;
  confirmedSettings = { ...saved };
  let saving = false;
  let dirty = false;
  let renderedMode = saved.fixedIP ? "fixed" : "auto";
  let options = [];
  let statusSequence = 0;
  let stopSelection;

  const row = element("div", "setting-row");
  const info = element("div", "setting-row-info");
  info.append(element("div", "setting-row-label", "开启优选 IP 加速"), element("div", "setting-row-desc", "加速创意工坊图片与文件下载"));
  const status = element("div", "setting-row-status");
  status.id = "settings-ip-status";
  status.setAttribute("role", "status");
  const statusLine = element("div", "setting-row-status-line");
  statusLine.append(status);
  info.append(statusLine);
  const toggleLabel = element("label", "toggle-switch");
  const enabled = element("input");
  enabled.type = "checkbox";
  enabled.id = "settings-preferred-ip";
  enabled.setAttribute("aria-label", "开启优选 IP 加速");
  toggleLabel.append(enabled, element("span", "toggle-slider"));
  row.append(info, toggleLabel);

  const modeSection = element("div", "setting-indent");
  modeSection.id = "settings-ip-mode-section";
  const modes = element("div", "setting-radio-group");
  const radios = [["auto", "自动优选最佳 IP（推荐）"], ["fixed", "手动指定 IP"]].map(([value, text]) => {
    const label = element("label", "setting-radio-label");
    const radio = element("input");
    radio.type = "radio";
    radio.name = "settings-ip-mode";
    radio.value = value;
    label.append(radio, element("span", "", text));
    modes.append(label);
    return radio;
  });
  const tools = element("div", "settings-fixed-ip-tools");
  tools.id = "settings-fixed-ip-tools";
  const dropdown = element("div", "single-select-dropdown settings-ip-option-dropdown");
  const trigger = element("button", "select-trigger", "正在加载推荐固定 IP...");
  trigger.type = "button";
  trigger.id = "settings-ip-option-trigger";
  trigger.setAttribute("aria-label", "选择推荐固定 IP");
  trigger.dataset.ipPoolState = "loading";
  trigger.disabled = true;
  const menu = element("div", "select-menu settings-ip-option-menu hidden");
  menu.id = "settings-ip-option-menu";
  dropdown.append(trigger, menu);
  const input = element("input", "form-input");
  input.type = "text";
  input.id = "settings-fixed-ip";
  input.setAttribute("aria-label", "固定 IP 地址");
  input.placeholder = "例如: 23.59.72.59";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-describedby", error.id);
  tools.append(dropdown, input);
  modeSection.append(element("div", "setting-row-label", "加速模式"), modes, tools);
  form.append(row, modeSection, error);

  const isFixed = () => radios.find((radio) => radio.checked)?.value === "fixed";
  const updateDraftView = () => {
    renderedMode = isFixed() ? "fixed" : "auto";
    modeSection.style.display = enabled.checked ? "" : "none";
    tools.style.display = isFixed() ? "" : "none";
    if (!["loading", "error", "idle"].includes(trigger.dataset.ipPoolState)) {
      updateIPOptionTrigger(trigger, options, input.value.trim());
    }
    syncIPOptionMenuActive(menu, input.value.trim());
  };
  const clearError = () => {
    error.hidden = true;
    error.textContent = "";
    input.removeAttribute("aria-invalid");
  };
  const restoreSaved = () => {
    enabled.checked = saved.enabled;
    radios.forEach((radio) => { radio.checked = radio.value === (saved.fixedIP ? "fixed" : "auto"); });
    input.value = saved.fixedIP;
    dirty = false;
    menu.classList.add("hidden");
    updateDraftView();
  };
  const setSaving = (value) => {
    saving = value;
    [...radios, enabled, input, ...menu.querySelectorAll(".settings-ip-option")].forEach((node) => { node.disabled = value; });
    updateTriggerAvailability(trigger, () => saving);
    form.setAttribute("aria-busy", String(value));
    if (value) menu.classList.add("hidden");
  };
  const markDirty = () => {
    if (saving || !isCurrentPage()) return false;
    dirty = true;
    clearError();
    updateDraftView();
    return true;
  };
  const refreshStatus = async () => {
    const request = ++statusSequence;
    const current = () => isCurrentPage() && request === statusSequence;
    if (!current()) return;
    if (!saved.enabled) {
      status.textContent = "优选 IP 加速未开启";
      return;
    }
    if (saved.fixedIP) {
      status.textContent = `当前固定 IP: ${formatIPOptionLabel(findIPOption(options, saved.fixedIP) || { ip: saved.fixedIP, category: "自定义" })}`;
      return;
    }
    try {
      const selecting = await IsSelectingIP();
      if (!current()) return;
      if (selecting) {
        status.textContent = "正在优选最佳线路...";
        return;
      }
      const best = await GetCurrentBestIPOption();
      const ip = getIPOptionIP(best) || await GetCurrentBestIP();
      if (!current()) return;
      status.textContent = ip ? `当前优选 IP: ${formatIPOptionLabel(best || findIPOption(options, ip) || { ip })}` : "尚未获取到优选 IP";
    } catch {
      if (current()) status.textContent = "读取当前 IP 状态失败，请重新打开设置。";
    }
  };
  const closeMenu = (event) => {
    if (!dropdown.contains(event.target)) menu.classList.add("hidden");
  };
  const leavePage = (event) => { if (event.detail?.page !== "settings") controller.dispose(); };
  const controller = {
    dispose() {
      disposed = true;
      statusSequence++;
      try { stopSelection?.(); } catch { /* An old event source must not retain this card. */ }
      document.removeEventListener("click", closeMenu);
      document.removeEventListener("app:page-change", leavePage);
      if (activeCard === controller) activeCard = null;
    },
    acceptSaved(value) {
      saved = { ...value };
      if (!isCurrentPage()) return;
      if (!dirty && !saving) restoreSaved();
      void refreshStatus();
    },
  };
  activeCard = controller;
  const samePair = (left, right) => left.enabled === right.enabled && left.fixedIP === right.fixedIP;
  const applyChange = async (source, override) => {
    if (saving || !isCurrentPage()) return;
    clearError();
    const fixedIP = override ? override.fixedIP : isFixed() ? normalizeFixedIP(input.value) : "";
    if (fixedIP === null) {
      error.textContent = "请输入单个有效的 IPv4 或 IPv6 地址后，手动指定模式才会生效。";
      error.hidden = false;
      input.setAttribute("aria-invalid", "true");
      return;
    }
    const next = override || { enabled: enabled.checked, fixedIP };
    if (samePair(next, saved) && queuedWrites === 0) {
      restoreSaved();
      return;
    }
    setSaving(true);
    queuedWrites++;
    try {
      const operation = pendingSave.then(async () => {
        const applied = override
          ? { enabled: false, fixedIP: confirmedSettings?.fixedIP ?? saved.fixedIP }
          : next;
        await SetWorkshopIPSettings(applied);
        confirmedSettings = { ...applied };
        savedRevision++;
        updateConfigCache({ workshopPreferredIP: applied.enabled, workshopFixedIP: applied.fixedIP });
        activeCard?.acceptSaved(applied);
        return applied;
      });
      pendingSave = operation.catch(() => {}).finally(() => { queuedWrites--; });
      saved = { ...await operation };
      if (isCurrentPage()) restoreSaved();
    } catch {
      if (isCurrentPage()) {
        if (source === "discrete") restoreSaved();
        error.textContent = source === "discrete"
          ? "更新 IP 设置失败，已恢复原设置，请重试。"
          : "更新 IP 设置失败，请按 Enter 或离开输入框重试。";
        error.hidden = false;
      }
    } finally {
      if (isCurrentPage()) setSaving(false);
      else saving = false;
    }
  };
  enabled.addEventListener("change", async () => {
    if (!markDirty()) return;
    // Turning acceleration off discards unconfirmed text without changing the
    // last effective fixed address or publishing an incomplete manual mode.
    const next = enabled.checked ? undefined : { enabled: false, fixedIP: saved.fixedIP };
    await applyChange("discrete", next);
  });
  radios.forEach((radio) => {
    radio.addEventListener("change", async () => {
      if (radio.checked && markDirty()) await applyChange("discrete");
    });
    // A checked radio emits no change event. An explicit same-value choice on
    // a newer page must still follow an older page's pending write.
    radio.addEventListener("click", async () => {
      if (!radio.checked || saving || !isCurrentPage()) return;
      const fixedIP = isFixed() ? normalizeFixedIP(input.value) : "";
      if (radio.value === "fixed" && renderedMode === "fixed" &&
          (fixedIP === null || !samePair({ enabled: enabled.checked, fixedIP }, saved))) {
        if (markDirty()) await applyChange("manual");
        return;
      }
      if (queuedWrites === 0) return;
      if (fixedIP === null || !samePair({ enabled: enabled.checked, fixedIP }, saved)) return;
      if (markDirty()) await applyChange("discrete");
    });
  });
  input.addEventListener("input", markDirty);
  input.addEventListener("change", markDirty);
  input.addEventListener("blur", async (event) => {
    const target = event.relatedTarget;
    if (target === enabled || radios.includes(target) || target === trigger || target?.closest?.(".settings-ip-option")) return;
    await applyChange("manual");
  });
  form.addEventListener("focusout", async (event) => {
    if (!dirty || (event.relatedTarget && form.contains(event.relatedTarget))) return;
    await applyChange("manual");
  });
  document.addEventListener("click", closeMenu);
  document.addEventListener("app:page-change", leavePage);
  if (typeof EventsOn === "function") {
    try { stopSelection = EventsOn("ip_selection_end", refreshStatus); } catch { /* Current state remains readable without push events. */ }
  }
  restoreSaved();
  void refreshStatus();
  let initialCandidateLoad;
  form.loadIPOptions = () => {
    if (!isCurrentPage()) return Promise.resolve();
    initialCandidateLoad ??= loadIPOptionsForDropdown({
      isCurrentPage, layout: container, GetAPILineStatus, GetWorkshopIPOptions,
      trigger, menu, fixedInput: input, getFixedIP: () => input.value.trim(),
      isLocked: () => saving,
      setOptions(next) { options = next; },
      onSelect: async () => {
        if (!markDirty()) return;
        radios.forEach((radio) => { radio.checked = radio.value === "fixed"; });
        updateDraftView();
        await applyChange("discrete");
      },
      onStatusUpdate: refreshStatus,
    });
    return initialCandidateLoad;
  };
  if (!deferCandidateLoad) void form.loadIPOptions();
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await applyChange("manual");
  });
  return form;
}

function updateTriggerAvailability(trigger, isLocked) {
  const unavailable = isLocked() || trigger.dataset.ipPoolState === "loading" || trigger.dataset.ipPoolState === "empty";
  trigger.disabled = unavailable;
  trigger.classList.toggle("is-disabled", unavailable);
}

function renderIPOptionDropdown({ options, trigger, menu, fixedInput, getFixedIP, onSelect, isLocked, isCurrentPage }) {
  const selected = getFixedIP();
  updateIPOptionTrigger(trigger, options, selected);
  menu.textContent = "";
  options.forEach((option) => {
    const button = element("button", "select-option settings-ip-option");
    button.type = "button";
    button.disabled = isLocked();
    button.dataset.value = option.ip;
    const content = element("span", "settings-ip-option-main");
    content.append(element("span", "settings-ip-option-category", option.category), element("span", "settings-ip-option-address", option.ip));
    button.append(content);
    button.classList.toggle("active", option.ip === selected);
    button.addEventListener("click", async () => {
      if (isLocked() || !isCurrentPage()) return;
      fixedInput.value = option.ip;
      await onSelect?.(option.ip);
      if (!isCurrentPage()) return;
      updateIPOptionTrigger(trigger, options, getFixedIP());
      syncIPOptionMenuActive(menu, getFixedIP());
      menu.classList.add("hidden");
    });
    menu.append(button);
  });
  trigger.dataset.ipPoolState = options.length ? "loaded" : "empty";
  updateTriggerAvailability(trigger, isLocked);
  trigger.onclick = (event) => {
    event.stopPropagation();
    if (!isLocked() && isCurrentPage()) menu.classList.toggle("hidden");
  };
}

// Candidate refreshes only read metadata; selection uses the atomic change path.
export async function loadIPOptionsForDropdown({
  isCurrentPage = () => true, layout, GetAPILineStatus, GetWorkshopIPOptions,
  fixedIP = "", trigger, menu, fixedInput, setOptions = () => {},
  getFixedIP = () => fixedInput?.value.trim() || fixedIP,
  isLocked = () => false, onSelect, onStatusUpdate,
}) {
  if (!trigger || !menu || typeof GetWorkshopIPOptions !== "function") return;
  const line = getAPILineSnapshot();
  const sequence = (candidateRequests.get(trigger) || 0) + 1;
  candidateRequests.set(trigger, sequence);
  const isCurrentRequest = () => isCurrentPage() && trigger.isConnected && isCurrentAPILine(line) && candidateRequests.get(trigger) === sequence;
  const reload = () => loadIPOptionsForDropdown({
    isCurrentPage, layout, GetAPILineStatus, GetWorkshopIPOptions,
    trigger, menu, fixedInput, getFixedIP, setOptions, isLocked, onSelect, onStatusUpdate,
  });
  activeIPDropdown = {
    invalidate() {
      if (!isCurrentPage() || !trigger.isConnected) {
        activeIPDropdown = null;
        return;
      }
      candidateRequests.set(trigger, sequence + 1);
      setOptions([]);
      menu.textContent = "";
      menu.classList.add("hidden");
      trigger.dataset.ipPoolState = "idle";
      trigger.textContent = "点击加载候选列表";
      updateTriggerAvailability(trigger, isLocked);
      trigger.onclick = async (event) => {
        event.stopPropagation();
        if (!isCurrentPage() || trigger.disabled || isLocked()) return;
        menu.classList.remove("hidden");
        await reload();
      };
    },
  };
  trigger.dataset.ipPoolState = "loading";
  trigger.textContent = "正在加载推荐固定 IP...";
  updateTriggerAvailability(trigger, isLocked);
  menu.textContent = "";
  let nextOptions;
  try {
    nextOptions = normalizeIPOptions(await GetWorkshopIPOptions());
  } catch {
    if (!isCurrentRequest()) return;
    trigger.dataset.ipPoolState = "error";
    trigger.textContent = "候选 IP 加载失败，点击重试或手动填写 IP";
    updateTriggerAvailability(trigger, isLocked);
    trigger.onclick = async (event) => {
      event.stopPropagation();
      if (isCurrentRequest() && !isLocked()) await reload();
    };
    if (layout) await updateAPILineStatus(layout, GetAPILineStatus, isCurrentRequest);
    return;
  }
  if (!isCurrentRequest()) return;
  setOptions(nextOptions);
  renderIPOptionDropdown({ options: nextOptions, trigger, menu, fixedInput, getFixedIP, onSelect, isLocked, isCurrentPage: isCurrentRequest });
  try { await onStatusUpdate?.(); } catch { /* A status-read failure must not disable valid candidates. */ }
  if (!isCurrentRequest()) return;
  const fallback = layout && await updateAPILineStatus(layout, GetAPILineStatus, isCurrentRequest);
  if (!isCurrentRequest() || !fallback) return;
  const toggle = trigger.onclick;
  let retrying = false;
  trigger.onclick = async (event) => {
    if (!isCurrentRequest() || retrying || isLocked()) return;
    const opening = menu.classList.contains("hidden");
    toggle?.(event);
    if (!opening) return;
    retrying = true;
    try { await reload(); } finally { retrying = false; }
  };
}

function normalizeIPOptions(options) {
  const seen = new Set();
  return (Array.isArray(options) ? options : []).flatMap((option) => {
    const ip = getIPOptionIP(option);
    if (!ip || seen.has(ip)) return [];
    seen.add(ip);
    return [{ ip, category: String(option?.category ?? option?.Category ?? "未分类").trim() || "未分类" }];
  });
}

function getIPOptionIP(option) { return String(option?.ip || option?.IP || "").trim(); }
function findIPOption(options, ip) { return options.find((option) => option.ip === ip) || null; }
function formatIPOptionLabel(option) {
  const ip = getIPOptionIP(option);
  return option?.category ? `${option.category} / ${ip}` : ip;
}
function updateIPOptionTrigger(trigger, options, ip) {
  const option = findIPOption(options, ip);
  if (option) trigger.textContent = formatIPOptionLabel(option);
  else if (ip) trigger.textContent = formatIPOptionLabel({ ip, category: "自定义" });
  else trigger.textContent = options.length ? "选择优选 IP，也可自建服务器并填写 IP" : "暂无候选 IP，可自建服务器并填写 IP";
}
function syncIPOptionMenuActive(menu, ip) {
  menu.querySelectorAll(".settings-ip-option").forEach((button) => { button.classList.toggle("active", button.dataset.value === ip); });
}
