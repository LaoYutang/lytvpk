import { showError, showNotification } from "../../core/toast.js";

let packRunning = false;

export async function openVPKPackTool({ refreshFilesKeepFilter } = {}) {
  if (packRunning) {
    showNotification("已有 VPK 正在打包", "info");
    return;
  }

  let sourceDir = "";
  try {
    sourceDir = await callApp("SelectVPKPackSourceDirectory");
  } catch (error) {
    showError("选择打包目录失败: " + formatError(error));
    return;
  }
  if (!sourceDir) return;

  let outputDir = "";
  let isAddons = false;
  try {
    const choice = await choosePackOutput(sourceDir);
    outputDir = choice.outputDir;
    isAddons = !!choice.isAddons;
  } catch (error) {
    showError("选择输出位置失败: " + formatError(error));
    return;
  }
  if (!outputDir) return;

  packRunning = true;
  showNotification("正在打包 VPK...", "info");

  try {
    const result = await callApp("PackVPKDirectory", sourceDir, outputDir, isAddons);
    showVPKPackResult(result);
    showNotification("VPK 打包完成", "success");
    if (result.outputIsAddons && typeof refreshFilesKeepFilter === "function") {
      await refreshFilesKeepFilter();
    }
  } catch (error) {
    showError("打包失败: " + formatError(error));
  } finally {
    packRunning = false;
  }
}

// choosePackOutput shows a two-option modal: pack into current addons, or pick another location.
// Resolves with { outputDir, isAddons } or { outputDir: "" } when cancelled.
function choosePackOutput(sourceDir) {
  return new Promise((resolve) => {
    const modal = document.getElementById("message-modal");
    const titleEl = document.getElementById("message-modal-title");
    const contentEl = document.getElementById("message-modal-content");
    const confirmBtn = document.getElementById("message-modal-confirm-btn");
    const closeBtn = document.getElementById("close-message-modal-btn");
    const footer = confirmBtn?.parentElement;
    if (!modal || !titleEl || !contentEl || !confirmBtn || !closeBtn || !footer) {
      resolve({ outputDir: "" });
      return;
    }

    const otherBtn = document.createElement("button");
    otherBtn.type = "button";
    otherBtn.className = "btn btn-secondary";
    otherBtn.textContent = "选择其他位置";

    titleEl.textContent = "选择打包输出位置";
    contentEl.replaceChildren(createOutputChoiceContent(sourceDir));
    confirmBtn.textContent = "放入当前 addons";
    footer.insertBefore(otherBtn, confirmBtn);

    let settled = false;

    const cleanup = () => {
      modal.classList.add("hidden");
      otherBtn.remove();
      contentEl.replaceChildren();
      confirmBtn.textContent = "确定";
      confirmBtn.onclick = null;
      closeBtn.onclick = null;
      otherBtn.onclick = null;
    };

    const done = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    closeBtn.onclick = () => done({ outputDir: "" });

    confirmBtn.onclick = async () => {
      try {
        const addons = await callApp("GetRootDirectory");
        if (!addons) {
          showError("未设置 addons 目录，请先在主界面选择 L4D2 addons 目录");
          return;
        }
        done({ outputDir: addons, isAddons: true });
      } catch (error) {
        showError("获取 addons 目录失败: " + formatError(error));
      }
    };

    otherBtn.onclick = async () => {
      try {
        const dir = await callApp("SelectDirectory");
        if (!dir) return;
        done({ outputDir: dir, isAddons: false });
      } catch (error) {
        showError("选择目录失败: " + formatError(error));
      }
    };

    modal.classList.remove("hidden");
  });
}

function createOutputChoiceContent(sourceDir) {
  const wrapper = document.createElement("div");
  wrapper.className = "vpk-unpack-result";

  const note = document.createElement("p");
  note.textContent = "请选择打包后的 VPK 输出位置。";

  const pathBlock = document.createElement("div");
  pathBlock.className = "vpk-unpack-result-path";
  const label = document.createElement("span");
  label.textContent = "打包目录";
  const value = document.createElement("strong");
  value.textContent = sourceDir || "";
  value.title = sourceDir || "";
  pathBlock.append(label, value);

  wrapper.append(note, pathBlock);
  return wrapper;
}

function showVPKPackResult(result = {}) {
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

  titleEl.textContent = "打包完成";
  contentEl.replaceChildren(createPackResultContent(result));
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
    if (!result.outputPath) return;
    try {
      await callApp("OpenFileLocation", result.outputPath);
    } catch (error) {
      showError("打开目标位置失败: " + formatError(error));
    }
  };

  modal.classList.remove("hidden");
}

function createPackResultContent(result = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "vpk-unpack-result";

  const summary = document.createElement("p");
  const total = Number(result.totalFiles || 0);
  const packed = Number(result.packedFiles || 0);
  summary.textContent = `已打包 ${packed} / ${total} 个文件。`;

  const pathBlock = document.createElement("div");
  pathBlock.className = "vpk-unpack-result-path";
  const label = document.createElement("span");
  label.textContent = "输出文件";
  const value = document.createElement("strong");
  value.textContent = result.outputPath || "";
  value.title = result.outputPath || "";
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
