import { workshopDeps } from "./deps.js";
import { openWorkshopDetail } from "./detail.js";
import { openBrowser } from "./list.js";
import { getCurrentPage } from "../../core/ui-shell.js";
import { getAPILineSnapshot, isCurrentAPILine, subscribeAPILineChange } from "../../core/api-line.js";

let pendingWorkshopOpen;

function cancelPendingWorkshopOpen() {
  pendingWorkshopOpen?.abort();
  pendingWorkshopOpen = null;
}

subscribeAPILineChange(cancelPendingWorkshopOpen);
document.addEventListener("app:page-change", (event) => {
  if (event.detail?.page !== "workshop") cancelPendingWorkshopOpen();
});

export async function handleProtocolParse(workshopId) {
  cancelPendingWorkshopOpen();
  workshopDeps.showNotification(`正在解析工坊ID: ${workshopId}`, "info");
  return workshopDeps.openWorkshopParse(workshopId);
}

export async function handleProtocolWorkshop(workshopId) {
  cancelPendingWorkshopOpen();
  const controller = new AbortController();
  pendingWorkshopOpen = controller;
  const line = getAPILineSnapshot();
  const isCurrentOpen = () => !controller.signal.aborted &&
    pendingWorkshopOpen === controller && isCurrentAPILine(line) && getCurrentPage() === "workshop";

  const fileDetailModal = document.getElementById("file-detail-modal");
  if (fileDetailModal && !fileDetailModal.classList.contains("hidden")) {
    workshopDeps.closeModal();
  }

  workshopDeps.showNotification(`正在打开工坊: ${workshopId}`, "info");
  openBrowser();

  try {
    let isSelecting = false;
    try {
      isSelecting = await workshopDeps.IsSelectingIP();
    } catch {
      // This optional readiness check must not become a second error surface.
      // The detail view owns the real request and its safe error feedback.
    }
    if (!isCurrentOpen()) return;
    if (isSelecting) {
      workshopDeps.showNotification("正在等待IP优选完成...", "info");
      await waitForIPSelection(controller.signal);
    }
    if (!isCurrentOpen()) return;
    await waitForLayout(controller.signal);
    if (!isCurrentOpen()) return;
    return await openWorkshopDetail({ publishedfileid: workshopId });
  } finally {
    if (pendingWorkshopOpen === controller) pendingWorkshopOpen = null;
    controller.abort();
  }
}

function waitForIPSelection(signal) {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    let finished = false;
    let unsubscribe;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      try { unsubscribe?.(); } catch { /* Optional event cleanup must not block opening or cancellation. */ }
      resolve();
    };
    const timeout = setTimeout(finish, 30000);
    signal.addEventListener("abort", finish, { once: true });
    try {
      const cleanup = workshopDeps.EventsOn("ip_selection_end", finish);
      if (typeof cleanup === "function") unsubscribe = cleanup;
      // An event source may complete synchronously while registering.
      if (finished) unsubscribe?.();
    } catch {
      finish();
    }
  });
}

function waitForLayout(signal) {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const finish = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timeout = setTimeout(finish, 500);
    signal.addEventListener("abort", finish, { once: true });
  });
}
