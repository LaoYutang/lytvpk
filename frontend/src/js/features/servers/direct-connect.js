import { parseClipboardAddress, parseServerInput } from "./address.js";

let showError;
let connectServer;
let ClipboardGetText;

// 每次打开弹窗递增，用于丢弃过期剪贴板读取结果
let openToken = 0;

export function configureDirectConnect(deps) {
  ({ showError, connectServer, ClipboardGetText } = deps);
}

export function openDirectConnectModal() {
  const modal = document.getElementById("direct-connect-modal");
  const addressInput = document.getElementById("direct-connect-address");
  if (!modal) return;

  addressInput.value = "";
  modal.classList.remove("hidden");
  document.getElementById("global-dropdown").classList.add("hidden");
  addressInput.focus();
  void prefillFromClipboard(++openToken);
}

// 剪贴板里如果有可用的服务器地址就自动填入，读不到或格式不符时保持为空
async function prefillFromClipboard(token) {
  const address = parseClipboardAddress(await readClipboardText());
  const modal = document.getElementById("direct-connect-modal");
  const addressInput = document.getElementById("direct-connect-address");
  if (!address || !modal || !addressInput) return;
  if (token !== openToken || modal.classList.contains("hidden")) return;
  if (addressInput.value) return;

  addressInput.value = address;
  addressInput.select();
}

async function readClipboardText() {
  try {
    return await ClipboardGetText();
  } catch (err) {
    console.error("读取剪贴板失败:", err);
    return "";
  }
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