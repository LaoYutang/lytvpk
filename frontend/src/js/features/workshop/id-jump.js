import { workshopDeps } from "./deps.js";
import { openWorkshopDetail } from "./detail.js";
import { ParseWorkshopID } from "../../../../wailsjs/go/app/App";

const MODAL_ID = "workshop-id-jump-modal";
const INPUT_ID = "workshop-id-jump-input";

export function setupWorkshopIdJump() {
  document
    .getElementById("browser-id-jump-btn")
    ?.addEventListener("click", openWorkshopIdJumpModal);
  document
    .getElementById("close-workshop-id-jump-btn")
    ?.addEventListener("click", closeWorkshopIdJumpModal);
  document
    .getElementById("workshop-id-jump-cancel-btn")
    ?.addEventListener("click", closeWorkshopIdJumpModal);
  document
    .getElementById("workshop-id-jump-confirm-btn")
    ?.addEventListener("click", jumpToWorkshopId);
  document.getElementById(INPUT_ID)?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      jumpToWorkshopId();
    }
  });

  // 点击遮罩关闭
  document.getElementById(MODAL_ID)?.addEventListener("click", (event) => {
    if (event.target.id === MODAL_ID) {
      closeWorkshopIdJumpModal();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeWorkshopIdJumpModal();
    }
  });
}

function openWorkshopIdJumpModal() {
  const modal = document.getElementById(MODAL_ID);
  const input = document.getElementById(INPUT_ID);
  if (!modal || !input) return;

  input.value = "";
  modal.classList.remove("hidden");
  setTimeout(() => input.focus(), 30);
}

export function closeWorkshopIdJumpModal() {
  document.getElementById(MODAL_ID)?.classList.add("hidden");
}

async function jumpToWorkshopId() {
  const input = document.getElementById(INPUT_ID);
  const raw = (input?.value || "").trim();
  if (!raw) {
    workshopDeps.showError?.("请输入工坊 ID 或链接");
    return;
  }

  try {
    // 复用客户端的解析逻辑，兼容纯 ID 与各种工坊链接
    const id = String(await ParseWorkshopID(raw));
    if (!id) {
      workshopDeps.showError?.("无法识别工坊 ID");
      return;
    }

    closeWorkshopIdJumpModal();
    openWorkshopDetail({ publishedfileid: id });
  } catch (err) {
    workshopDeps.showError?.(`无法识别工坊 ID: ${err}`);
  }
}