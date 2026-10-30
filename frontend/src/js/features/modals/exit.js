let exitBusy = false;
let confirmLabel = "退出";
let exitDetails = { downloads: false, uploads: false, downloadLossRisk: false, downloadIdentityUnknown: false };
let pauseLossAccepted = false;

const forceExitWithPauseLossAccepted = (accepted) => window.go.app.App.ForceExitWithPauseLossAccepted(accepted);
const getDownloadExitRisk = () => window.go.app.App.GetDownloadExitRisk();

function setExitBusy(busy) {
  exitBusy = busy;
  const busyLabel = exitDetails.downloads ? "正在暂停并保存…" : "正在保存…";
  document.getElementById("exit-confirm-btn").disabled = busy;
  document.getElementById("exit-confirm-btn").textContent = busy ? busyLabel : confirmLabel;
  document.getElementById("exit-cancel-btn").disabled = busy;
  document.getElementById("close-exit-modal-btn").disabled = busy;
}

function showExitError(message) {
  const errorElement = document.getElementById("exit-error-message");
  errorElement.textContent = message;
  errorElement.classList.remove("hidden");
}

export function showExitModal({ downloads = false, uploads = false, downloadLossRisk = false, downloadIdentityUnknown = false } = {}) {
  if (exitBusy) return;
  exitDetails = { downloads, uploads, downloadLossRisk, downloadIdentityUnknown };
  pauseLossAccepted = downloadLossRisk || downloadIdentityUnknown;
  const warnings = [];
  if (downloadLossRisk) {
    warnings.push("部分文件的服务器未提供可靠的文件标识，退出并暂停下载后，这些文件的下载进度将被清空，下次需要重新下载。");
  }
  if (downloadIdentityUnknown) {
    warnings.push("部分下载任务尚未确认服务器是否提供可靠的文件标识；退出前暂停可能清空其进度，继续时可能需要重新下载。");
  }
  if (downloads && warnings.length === 0) {
    warnings.push("正在下载的任务会先暂停并保存进度。");
  }
  if (uploads) {
    warnings.push("正在上传的任务会中断。");
  }
  const message = warnings.length > 0 ? `${warnings.join(" ")}确定退出吗？` : "保存下载任务记录后退出。";
  document.getElementById("exit-confirm-message").textContent = message;
  document.getElementById("exit-error-message").classList.add("hidden");
  confirmLabel = pauseLossAccepted ? "确定退出" : downloads ? "暂停并退出" : "退出";
  setExitBusy(false);
  document.getElementById("exit-confirm-modal").classList.remove("hidden");
}

export function closeExitModal() {
  if (exitBusy) return;
  document.getElementById("exit-confirm-modal").classList.add("hidden");
}

export async function confirmExit() {
  if (exitBusy) return;
  document.getElementById("exit-error-message").classList.add("hidden");
  setExitBusy(true);
  try {
    await forceExitWithPauseLossAccepted(pauseLossAccepted);
  } catch (err) {
    setExitBusy(false);
    if (String(err).includes("DOWNLOAD_PAUSE_LOSS_CONFIRMATION_REQUIRED")) {
      try {
        const risk = await getDownloadExitRisk();
        showExitModal({ ...exitDetails, ...risk });
        showExitError("下载状态已变化，请查看暂停后果并再次确认退出。");
      } catch (riskErr) {
        showExitError(`无法确认下载状态：${riskErr}`);
      }
      return;
    }
    showExitError(`退出前保存失败：${err}`);
  }
}

export function showExitSaveError(message) {
  if (
    document.getElementById("exit-confirm-modal").classList.contains("hidden")
  ) {
    showExitModal(exitDetails);
  }
  setExitBusy(false);
  showExitError(message || "退出前保存失败，请重试");
}
