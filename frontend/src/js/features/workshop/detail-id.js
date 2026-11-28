import { workshopDeps } from "./deps.js";

const MAX_WORKSHOP_ID = "18446744073709551615";

function validWorkshopId(value) {
  // Relay accepts positive uint64 IDs. Equal-length digit strings compare exactly.
  return typeof value === "string"
    && /^[1-9][0-9]{0,19}$/.test(value)
    && (value.length < MAX_WORKSHOP_ID.length || value <= MAX_WORKSHOP_ID);
}

export function appendWorkshopDetailId(detailView, responseId, requestedId, isCurrentDetail) {
  const fromResponse = validWorkshopId(responseId) ? responseId : "";
  const fromRequest = validWorkshopId(requestedId) ? requestedId : "";
  // Avoid offering a copy action when the response belongs to a different ID.
  if (fromResponse && fromRequest && fromResponse !== fromRequest) return;

  const id = fromResponse || fromRequest;
  const stats = detailView.querySelector(".detail-stats-bar");
  if (!id || !stats) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "stat-item detail-stat-copy";
  button.setAttribute("data-copy-workshop-id", "");
  button.setAttribute("aria-label", `复制工坊 ID ${id}`);
  button.title = `复制工坊 ID ${id}`;

  const value = document.createElement("span");
  value.className = "stat-value";
  value.textContent = id;
  const label = document.createElement("span");
  label.className = "stat-label";
  label.textContent = "工坊 ID";
  button.append(value, label);

  const isCurrent = () => isCurrentDetail() && detailView.contains(button);
  button.addEventListener("click", async () => {
    if (!isCurrent()) return;

    let copied;
    try {
      copied = await workshopDeps.ClipboardSetText(id);
    } catch {
      copied = false;
    }
    if (!isCurrent()) return;

    if (copied === true) {
      workshopDeps.showNotification?.("工坊 ID 已复制", "success");
    } else {
      workshopDeps.showError?.("复制工坊 ID 失败");
    }
  });

  stats.appendChild(button);
}
