import { showError, showNotification } from "../../core/toast.js";

let unpackRunning = false;

export async function openVPKUnpackTool() {
  if (unpackRunning) {
    showNotification("已有 VPK 正在解包", "info");
    return;
  }

  try {
    const vpkPath = await callApp("SelectVPKFile");
    if (!vpkPath) return;
    await unpackVPKFromPath(vpkPath);
  } catch (error) {
    showError("选择 VPK 失败: " + formatError(error));
  }
}

export async function unpackVPKFromPath(vpkPath) {
  if (unpackRunning) {
    showNotification("已有 VPK 正在解包", "info");
    return;
  }

  if (!vpkPath) {
    showError("VPK 文件路径不能为空");
    return;
  }

  let targetRoot = "";
  try {
    targetRoot = await callApp("SelectVPKUnpackOutputDirectory");
  } catch (error) {
    showError("选择解包位置失败: " + formatError(error));
    return;
  }

  if (!targetRoot) return;

  unpackRunning = true;
  showNotification("正在解包 VPK...", "info");

  try {
    const result = await callApp("UnpackVPKFile", vpkPath, targetRoot);
    showVPKUnpackResult(result);
    showNotification("VPK 解包完成", "success");
  } catch (error) {
    showError("解包失败: " + formatError(error));
  } finally {
    unpackRunning = false;
  }
}

function showVPKUnpackResult(result = {}) {
  const modal = document.getElementById("message-modal");
  const titleEl = document.getElementById("message-modal-title");
  const contentEl = document.getElementById("message-modal-content");
  const confirmBtn = document.getElementById("message-modal-confirm-btn");
  const closeBtn = document.getElementById("close-message-modal-btn");
  const footer = confirmBtn?.parentElement;
  if (!modal || !titleEl || !contentEl || !confirmBtn || !closeBtn || !footer) return;

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn btn-secondary";
  cancelBtn.textContent = "关闭";

  titleEl.textContent = "解包完成";
  contentEl.replaceChildren(createResultContent(result));
  confirmBtn.textContent = "打开目标位置";
  footer.insertBefore(cancelBtn, confirmBtn);

  const cleanup = () => {
    modal.classList.add("hidden");
    cancelBtn.remove();
    contentEl.replaceChildren();
    confirmBtn.textContent = "确定";
    confirmBtn.onclick = null;
    closeBtn.onclick = null;
  };

  cancelBtn.onclick = cleanup;
  closeBtn.onclick = cleanup;
  confirmBtn.onclick = async () => {
    cleanup();
    if (!result.outputDir) return;
    try {
      await callApp("OpenFileLocation", result.outputDir);
    } catch (error) {
      showError("打开目标位置失败: " + formatError(error));
    }
  };

  modal.classList.remove("hidden");
}

function createResultContent(result = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "vpk-unpack-result";

  const summary = document.createElement("p");
  const total = Number(result.totalFiles || 0);
  const extracted = Number(result.extractedFiles || 0);
  summary.textContent = `已解包 ${extracted} / ${total} 个文件。`;

  const pathBlock = document.createElement("div");
  pathBlock.className = "vpk-unpack-result-path";
  const label = document.createElement("span");
  label.textContent = "输出目录";
  const value = document.createElement("strong");
  value.textContent = result.outputDir || "";
  value.title = result.outputDir || "";
  pathBlock.append(label, value);

  wrapper.append(summary, pathBlock);
  return wrapper;
}

function callApp(methodName, ...args) {
  const method = window?.go?.app?.App?.[methodName];
  if (typeof method !== "function") {
    return Promise.reject(new Error(`当前后端不支持 ${methodName}`));
  }
  return method(...args);
}

function formatError(error) {
  if (error?.message) return error.message;
  return String(error || "未知错误");
}