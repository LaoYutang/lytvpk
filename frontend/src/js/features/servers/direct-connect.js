import { parseServerInput } from "./address.js";

let showError;
let connectServer;

export function configureDirectConnect(deps) {
  ({ showError, connectServer } = deps);
}

export function openDirectConnectModal() {
  const modal = document.getElementById("direct-connect-modal");
  const addressInput = document.getElementById("direct-connect-address");
  if (!modal) return;

  addressInput.value = "";
  modal.classList.remove("hidden");
  document.getElementById("global-dropdown").classList.add("hidden");
  addressInput.focus();
}

export function closeDirectConnectModal() {
  document.getElementById("direct-connect-modal").classList.add("hidden");
}

function submitDirectConnect() {
  const input = document.getElementById("direct-connect-address").value;

  let address;
  try {
    address = parseServerInput(input);
  } catch (err) {
    showError(err.message);
    return;
  }

  connectServer(address, { notify: true });
  closeDirectConnectModal();
}

export function setupDirectConnectListeners() {
  const modal = document.getElementById("direct-connect-modal");
  if (!modal) return;

  document
    .getElementById("open-direct-connect-modal-btn")
    .addEventListener("click", openDirectConnectModal);
  document
    .getElementById("close-direct-connect-modal-btn")
    .addEventListener("click", closeDirectConnectModal);
  document
    .getElementById("cancel-direct-connect-btn")
    .addEventListener("click", closeDirectConnectModal);
  document
    .getElementById("confirm-direct-connect-btn")
    .addEventListener("click", submitDirectConnect);

  document
    .getElementById("direct-connect-address")
    .addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submitDirectConnect();
      }
    });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      closeDirectConnectModal();
    }
  });
}