// The reference is bound by the local-file refresh lifecycle. Before the first
// scan, installation status is unknown and every badge stays hidden.
let installationState;

export function normalizeWorkshopID(value) {
  if (typeof value !== "string" && !(typeof value === "number" && Number.isSafeInteger(value))) return "";
  const id = String(value).trim();
  if (!/^\d+$/.test(id)) return "";
  const number = BigInt(id);
  if (number < 100000n || number > 9223372036854775807n) return "";
  return id.replace(/^0+/, "");
}

export function setWorkshopInstallationState(state, status, files = []) {
  installationState = state;
  state.workshopInstallationStatus = status;
  state.installedWorkshopIds = new Set(
    status === "ready" ? files.map((file) => normalizeWorkshopID(file?.workshopId)).filter(Boolean) : [],
  );
  globalThis.document?.querySelectorAll?.("[data-installed-workshop-id]").forEach(updateInstalledBadge);
}

export function isWorkshopItemInstalled(id) {
  return installationState?.workshopInstallationStatus === "ready" &&
    installationState.installedWorkshopIds.has(normalizeWorkshopID(id));
}

export function updateInstalledBadge(badge) {
  badge.hidden = !isWorkshopItemInstalled(badge.dataset.installedWorkshopId);
}

export function appendInstalledBadge(parent, item) {
  if (!parent || Number(item?.file_type ?? item?.fileType) === 2) return null;
  const id = normalizeWorkshopID(item?.publishedfileid ?? item?.workshop_id ?? item?.rootId ?? item);
  if (!id) return null;
  const badge = document.createElement("span");
  badge.className = "workshop-installed-badge";
  badge.dataset.installedWorkshopId = id;
  badge.textContent = "已安装";
  badge.title = "当前游戏目录中已安装（含已禁用项）";
  updateInstalledBadge(badge);
  parent.appendChild(badge);
  return badge;
}
