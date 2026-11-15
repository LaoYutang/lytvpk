import { workshopDeps } from "./deps.js";
import { openWorkshopDetail } from "./detail.js";
import { ParseWorkshopID } from "../../../../wailsjs/go/app/App";

const MODAL_ID = "workshop-id-jump-modal";
const INPUT_ID = "workshop-id-jump-input";
let modalSequence = 0;
let inputRevision = 0;
let pastePending = false;
let jumpPending = false;

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
  document
    .getElementById("workshop-id-jump-paste-btn")
    ?.addEventListener("click", pasteWorkshopId);
  document.getElementById(INPUT_ID)?.addEventListener("input", () => {
    inputRevision++;
  });
  document.getElementById(INPUT_ID)?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing && !event.repeat) {
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

  const sequence = ++modalSequence;
  pastePending = false;
  jumpPending = false;
  updatePendingButtons();
  input.value = "";
  modal.classList.remove("hidden");
  setTimeout(() => {
    if (sequence === modalSequence && isJumpModalOpen()) input.focus();
  }, 30);
}

export function closeWorkshopIdJumpModal() {
  modalSequence++;
  pastePending = false;
  jumpPending = false;
  updatePendingButtons();
  document.getElementById(MODAL_ID)?.classList.add("hidden");
}

function isJumpModalOpen() {
  const modal = document.getElementById(MODAL_ID);
  return modal && !modal.classList.contains("hidden");
}

function updatePendingButtons() {
  for (const id of ["workshop-id-jump-paste-btn", "workshop-id-jump-confirm-btn"]) {
    const button = document.getElementById(id);
    if (button) button.disabled = pastePending || jumpPending;
  }
}

function normalizeWorkshopJumpInput(value) {
  const text = String(value || "").trim();
  return text.match(/[?&]id=(\d+)/)?.[1] || text;
}

async function pasteWorkshopId() {
  const input = document.getElementById(INPUT_ID);
  if (!input || !isJumpModalOpen() || pastePending || jumpPending) return;
  const sequence = modalSequence;
  const revision = inputRevision;
  const isCurrent = () => sequence === modalSequence && revision === inputRevision && isJumpModalOpen();
  pastePending = true;
  updatePendingButtons();

  try {
    const text = normalizeWorkshopJumpInput(await workshopDeps.ClipboardGetText());
    if (!isCurrent()) return;
    if (!text) {
      workshopDeps.showError?.("剪贴板中没有文本，请复制工坊 ID 或链接后再试");
      input.focus();
      return;
    }
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  } catch {
    if (isCurrent()) {
      workshopDeps.showError?.("读取剪贴板失败，请在输入框中手动粘贴");
      input.focus();
    }
  } finally {
    if (sequence === modalSequence) {
      pastePending = false;
      updatePendingButtons();
    }
  }
}

async function jumpToWorkshopId() {
  const input = document.getElementById(INPUT_ID);
  if (!input || !isJumpModalOpen() || pastePending || jumpPending) return;
  const raw = normalizeWorkshopJumpInput(input.value);
  if (!raw) {
    workshopDeps.showError?.("请输入工坊 ID 或链接");
    return;
  }

  const sequence = modalSequence;
  const revision = inputRevision;
  const isCurrent = () => sequence === modalSequence && revision === inputRevision && isJumpModalOpen();
  jumpPending = true;
  updatePendingButtons();
  try {
    // 复用客户端的解析逻辑，兼容纯 ID 与各种工坊链接
    const id = String((await ParseWorkshopID(raw)) || "");
    if (!isCurrent()) return;
    if (!id) {
      workshopDeps.showError?.("无法识别工坊 ID");
      return;
    }

    closeWorkshopIdJumpModal();
    openWorkshopDetail({ publishedfileid: id });
  } catch (err) {
    if (isCurrent()) workshopDeps.showError?.(`无法识别工坊 ID: ${err}`);
  } finally {
    if (sequence === modalSequence) {
      jumpPending = false;
      updatePendingButtons();
    }
  }
}
