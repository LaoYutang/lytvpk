import { appState } from "../state.js";
import { showError, showNotification } from "../../core/toast.js";
import { GetVPKLoadOrder, SetVPKLoadOrder } from "../../../../wailsjs/go/app/App";

let currentLoadOrderFile = null;

export function openLoadOrderModal(filePath) {
  const file = appState.vpkFiles.find((f) => f.path === filePath);
  if (!file) return;

  currentLoadOrderFile = filePath;
  const modal = document.getElementById("load-order-modal");
  const filenameEl = document.getElementById("load-order-filename");
  const currentOrderEl = document.getElementById("load-order-current");
  const input = document.getElementById("load-order-input");

  filenameEl.textContent = file.name;
  currentOrderEl.textContent = "正在获取...";
  input.value = "";

  GetVPKLoadOrder(file.name)
    .then((order) => {
      modal.classList.remove("hidden");
      input.focus();

      if (order > 0) {
        currentOrderEl.textContent = order;
        input.placeholder = order;
      } else {
        currentOrderEl.textContent = "未生成";
        input.placeholder = "输入新的序号";
      }
    })
    .catch((err) => {
      console.error("获取加载顺序失败:", err);
      if (err && err.includes && err.includes("addonlist.txt 不存在")) {
        showError("未找到 addonlist.txt 文件，无法设置加载顺序");
        return;
      }
      showError("获取加载顺序失败: " + err);
    });
}

export function closeLoadOrderModal() {
  document.getElementById("load-order-modal").classList.add("hidden");
  currentLoadOrderFile = null;
}

export async function saveLoadOrder() {
  if (!currentLoadOrderFile) return;

  const input = document.getElementById("load-order-input");
  const orderStr = input.value.trim();

  if (!orderStr) {
    showError("请输入有效的序号");
    return;
  }

  const order = parseInt(orderStr, 10);
  if (isNaN(order)) {
    showError("序号必须是数字");
    return;
  }

  const file = appState.vpkFiles.find((f) => f.path === currentLoadOrderFile);
  if (!file) return;

  try {
    await SetVPKLoadOrder(file.name, order);
    showNotification("加载顺序已保存", "success");
    closeLoadOrderModal();
  } catch (err) {
    console.error("保存加载顺序失败:", err);
    showError("保存失败: " + err);
  }
}
