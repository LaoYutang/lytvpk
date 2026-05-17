export function showConfirmModal(title, message, onConfirm, useHtml = false, extraClass = "") {
  const modal = document.getElementById("confirm-modal");
  const modalContent = modal.querySelector(".modal-content");
  const titleEl = document.getElementById("confirm-title");
  const messageEl = document.getElementById("confirm-message");
  const okBtn = document.getElementById("confirm-ok-btn");
  const cancelBtn = document.getElementById("confirm-cancel-btn");
  const closeBtn = document.getElementById("close-confirm-modal-btn");
  let isConfirming = false;

  const setPending = (pending) => {
    isConfirming = pending;
    okBtn.disabled = pending;
    cancelBtn.disabled = pending;
    closeBtn.disabled = pending;
    modal.dataset.confirming = pending ? "true" : "false";
  };

  if (extraClass) {
    extraClass.split(" ").filter(Boolean).forEach((c) => modalContent.classList.add(c));
  }

  setPending(false);
  titleEl.textContent = title;
  if (useHtml) {
    messageEl.innerHTML = message;
  } else {
    messageEl.textContent = message;
  }
  modal.classList.remove("hidden");

  const cleanup = () => {
    setPending(false);
    modal.classList.add("hidden");
    okBtn.onclick = null;
    cancelBtn.onclick = null;
    closeBtn.onclick = null;
    if (extraClass) {
      extraClass.split(" ").filter(Boolean).forEach((c) => modalContent.classList.remove(c));
    }
  };

  okBtn.onclick = async () => {
    if (isConfirming) return;

    setPending(true);
    try {
      const result = await onConfirm();
      if (result !== false) {
        cleanup();
      } else {
        setPending(false);
      }
    } catch (error) {
      setPending(false);
      console.error("Confirm action failed:", error);
    }
  };

  cancelBtn.onclick = () => {
    if (!isConfirming) cleanup();
  };
  closeBtn.onclick = () => {
    if (!isConfirming) cleanup();
  };
}
