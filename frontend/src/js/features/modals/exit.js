import { ForceExit } from "../../../../wailsjs/go/app/App";

export function showExitModal() {
  document.getElementById("exit-confirm-modal").classList.remove("hidden");
}

export function closeExitModal() {
  document.getElementById("exit-confirm-modal").classList.add("hidden");
}

export async function confirmExit() {
  try {
    await ForceExit();
  } catch (err) {
    console.error("强制退出失败:", err);
  }
}
