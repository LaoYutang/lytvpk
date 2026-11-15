let getConfig = () => ({});
let saveConfig;
let updateConfigCache;
let pendingSave = null;
let pendingMode = null;

export function configureServerViewMode(deps) {
  if (typeof deps.getConfig === "function") getConfig = deps.getConfig;
  if (typeof deps.saveConfig === "function") saveConfig = deps.saveConfig;
  if (typeof deps.updateConfigCache === "function") {
    updateConfigCache = deps.updateConfigCache;
  }
}

export function getServerDisplayMode() {
  return getConfig().serverDisplayMode === "card" ? "card" : "list";
}

export function setServerDisplayMode(mode) {
  const next = mode === "card" ? "card" : "list";
  if (pendingSave && pendingMode === next) return pendingSave;
  if (!pendingSave && next === getServerDisplayMode()) return Promise.resolve(next);

  // Saves from different controls/page visits finish in request order.
  const preceding = pendingSave ? pendingSave.catch(() => {}) : Promise.resolve();
  const saving = preceding.then(async () => {
    const previous = getServerDisplayMode();
    if (next === previous) return next;
    if (typeof saveConfig !== "function" || typeof updateConfigCache !== "function") {
      throw new Error("服务器视图设置尚未初始化");
    }
    try {
      updateConfigCache({ serverDisplayMode: next });
      await saveConfig({ serverDisplayMode: next });
    } catch (error) {
      if (getServerDisplayMode() === next) {
        updateConfigCache({ serverDisplayMode: previous });
      }
      throw error;
    }
    window.dispatchEvent(new CustomEvent("server-display-mode-changed", {
      detail: { mode: next },
    }));
    return next;
  }).finally(() => {
    if (pendingSave === saving) {
      pendingSave = null;
      pendingMode = null;
    }
  });
  pendingSave = saving;
  pendingMode = next;
  return saving;
}
