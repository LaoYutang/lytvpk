import { updateConfigCache } from "../../core/config.js";
import { getAPILineSnapshot, isCurrentAPILine, normalizeAPILine, subscribeAPILineChange } from "../../core/api-line.js";

let activeCard;
let pendingSave = Promise.resolve();
let pendingOperations = 0;
let confirmedLine;
let savedRevision = 0;
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
  let form;
  const isCurrentPage = () => panel.isConnected && (!form || form.isConnected) && isCurrentRender();
  let savedLine;
  const revisionAtRead = savedRevision;
  try {
    const loadedLine = normalizeAPILine(await GetAPILine());
    savedLine = savedRevision !== revisionAtRead && confirmedLine ? confirmedLine : loadedLine;
  } catch {
    if (isCurrentPage()) {
      const error = element("div", "setting-card settings-dns-error", "读取线路设置失败，请重新打开设置。");
      error.setAttribute("role", "alert");
      panel.append(error);
    }
    return;
  }
  if (!isCurrentPage()) return;

  confirmedLine = savedLine;
  form = element("form", "setting-card settings-dns-card");
  form.id = "settings-api-line-form";
  form.append(
    element("div", "setting-card-title", "API 线路"),
    element("div", "setting-row-desc", "修改线路后，新请求使用所选线路；进行中的请求保持原线路。"),
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
  error.id = "settings-api-line-error";
  error.hidden = true;
  error.setAttribute("role", "alert");
  const status = element("div", "setting-row-desc");
  status.id = "settings-api-line-status";
  status.setAttribute("role", "status");
  status.hidden = true;
  form.append(modes, error, status);
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
  const persistSelection = async () => {
    if (saving || !isCurrentPage()) return;
    const next = radios.find((radio) => radio.checked)?.value || savedLine;
    if (next === savedLine && pendingOperations === 0) return;
    saving = true;
    error.hidden = true;
    radios.forEach((control) => { control.disabled = true; });
    form.setAttribute("aria-busy", "true");
    pendingOperations++;
    try {
      // Serialize saves across page visits: an older bridge response must not
      // overwrite the real choice after a newer page has saved another line.
      const saveOperation = pendingSave.then(async () => {
        await SetAPILine(next);
        confirmedLine = next;
        savedRevision++;
        updateConfigCache({ apiLine: next });
      });
      pendingSave = saveOperation.catch(() => {});
      await saveOperation;
      savedLine = next;
      if (isCurrentPage()) showNotification("API 线路已更新", "success");
    } catch {
      if (isCurrentPage()) {
        radios.forEach((radio) => { radio.checked = radio.value === savedLine; });
        error.textContent = "保存线路设置失败，已恢复原线路，请重新选择重试。";
        error.hidden = false;
      }
    } finally {
      saving = false;
      pendingOperations--;
      if (isCurrentPage()) {
        radios.forEach((control) => { control.disabled = false; });
        form.setAttribute("aria-busy", "false");
      }
    }
  };
  radios.forEach((radio) => {
    radio.addEventListener("change", persistSelection);
    radio.addEventListener("click", () => {
      // Clicking an already checked choice still expresses a newer choice
      // while another settings page's write is pending.
      if (radio.checked && radio.value === savedLine && pendingOperations > 0) return persistSelection();
    });
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    return persistSelection();
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
