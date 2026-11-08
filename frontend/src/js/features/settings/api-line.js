import { updateConfigCache } from "../../core/config.js";
import { getAPILineSnapshot, isCurrentAPILine, normalizeAPILine, subscribeAPILineChange } from "../../core/api-line.js";

let activeCard;
let pendingSave = Promise.resolve();
subscribeAPILineChange(({ line }) => activeCard?.syncLine(line));

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export async function appendAPILineSettings(container, {
  isCurrentRender = () => true,
  GetAPILine,
  SetAPILine,
  showNotification,
}) {
  const panel = container.querySelector("#settings-panel-network");
  if (!panel) return;
  const isCurrentPage = () => panel.isConnected && isCurrentRender();
  let savedLine;
  try {
    savedLine = normalizeAPILine(await GetAPILine());
  } catch {
    if (isCurrentPage()) {
      const error = element("div", "setting-card settings-dns-error", "读取线路设置失败，请重新打开设置。");
      error.setAttribute("role", "alert");
      panel.append(error);
    }
    return;
  }
  if (!isCurrentPage()) return;

  const form = element("form", "setting-card settings-dns-card");
  form.id = "settings-api-line-form";
  form.append(
    element("div", "setting-card-title", "API 线路"),
    element("div", "setting-row-desc", "手动选择并保存后，新请求使用所选线路；进行中的请求保持原线路。"),
  );
  const modes = element("div", "setting-radio-group setting-indent");
  const radios = [["primary", "主线路"], ["backup", "备用线路"]].map(([value, title]) => {
    const label = element("label", "setting-radio-label");
    const radio = element("input");
    radio.type = "radio";
    radio.name = "settings-api-line";
    radio.value = value;
    radio.checked = value === savedLine;
    label.append(radio, element("span", "", title));
    modes.append(label);
    return radio;
  });
  const error = element("div", "settings-dns-error");
  error.hidden = true;
  error.setAttribute("role", "alert");
  const actions = element("div", "settings-dns-actions");
  const status = element("div", "setting-row-desc");
  status.id = "settings-api-line-status";
  status.setAttribute("role", "status");
  status.hidden = true;
  const save = element("button", "btn btn-primary", "保存");
  save.type = "submit";
  actions.append(save);
  form.append(modes, error, status, actions);
  panel.append(form);

  let saving = false;
  activeCard = {
    syncLine(line) {
      if (!isCurrentPage()) {
        activeCard = null;
        return;
      }
      savedLine = line;
      status.hidden = true;
      if (!saving) radios.forEach((radio) => { radio.checked = radio.value === line; });
    },
  };
  radios.forEach((radio) => radio.addEventListener("change", () => { error.hidden = true; }));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (saving || !isCurrentPage()) return;
    const next = radios.find((radio) => radio.checked)?.value || savedLine;
    saving = true;
    error.hidden = true;
    [...radios, save].forEach((control) => { control.disabled = true; });
    save.textContent = "保存中…";
    try {
      // Serialize saves across page visits: an older bridge response must not
      // overwrite the real choice after a newer page has saved another line.
      const saveOperation = pendingSave.then(async () => {
        await SetAPILine(next);
        updateConfigCache({ apiLine: next });
      });
      pendingSave = saveOperation.catch(() => {});
      await saveOperation;
      savedLine = next;
      if (isCurrentPage()) showNotification("API 线路已更新", "success");
    } catch {
      if (isCurrentPage()) {
        radios.forEach((radio) => { radio.checked = radio.value === savedLine; });
        error.textContent = "保存线路设置失败，请重试。";
        error.hidden = false;
      }
    } finally {
      saving = false;
      if (isCurrentPage()) {
        [...radios, save].forEach((control) => { control.disabled = false; });
        save.textContent = "保存";
      }
    }
  });
}

export async function updateAPILineStatus(container, GetAPILineStatus, isCurrentRender = () => true) {
  if (typeof GetAPILineStatus !== "function") return false;
  const line = getAPILineSnapshot();
  const status = container.querySelector("#settings-api-line-status");
  if (!status) return false;
  try {
    const result = await GetAPILineStatus();
    if (!status.isConnected || !isCurrentRender() || !isCurrentAPILine(line) || result?.line !== line.line) return false;
    const fallback = result.ipPoolFallback === true;
    status.textContent = fallback ? "IP 列表获取失败，当前使用内置候选；可重新打开列表重试。" : "";
    status.hidden = !fallback;
    return fallback;
  } catch {
    if (status.isConnected && isCurrentRender() && isCurrentAPILine(line)) {
      status.textContent = "读取线路状态失败，请重新打开设置。";
      status.hidden = false;
    }
    return false;
  }
}
