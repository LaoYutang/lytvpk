import assert from "node:assert/strict";
import test from "node:test";
import { showConfirmModal } from "../src/js/features/modals/confirm.js";

function fakeElement() {
  const classes = new Set(["hidden"]);
  return {
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
    },
    dataset: {},
    textContent: "",
    disabled: false,
  };
}

function installDialogDOM() {
  const ids = [
    "confirm-modal", "confirm-title", "confirm-message", "confirm-ok-btn",
    "confirm-cancel-btn", "close-confirm-modal-btn", "exit-confirm-modal",
    "exit-confirm-message", "exit-error-message", "exit-confirm-btn",
    "exit-cancel-btn", "close-exit-modal-btn",
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, fakeElement()]));
  elements["confirm-modal"].querySelector = () => ({ classList: fakeElement().classList });
  globalThis.document = { getElementById: (id) => elements[id] };
  return elements;
}

test("dismissing pause confirmation does not invoke the pause action", async () => {
  const elements = installDialogDOM();
  let pauses = 0;
  let dismissed = 0;
  showConfirmModal("确认暂停下载", "服务器未提供可靠的文件标识", () => { pauses++; }, false, "", () => { dismissed++; });
  elements["confirm-cancel-btn"].onclick();
  assert.equal(pauses, 0);
  assert.equal(dismissed, 1);
  assert.equal(elements["confirm-modal"].classList.contains("hidden"), true);

  showConfirmModal("确认暂停下载", "服务器未提供可靠的文件标识", () => { pauses++; }, false, "", () => { dismissed++; });
  elements["close-confirm-modal-btn"].onclick();
  assert.equal(pauses, 0);
  assert.equal(dismissed, 2);
});

test("exit warning identifies the server and cancel keeps downloads running", async () => {
  const elements = installDialogDOM();
  const riskDialog = await import("../src/js/features/modals/exit.js?risk-dialog");
  const accepted = [];
  globalThis.window = { go: { app: { App: {
    ForceExitWithPauseLossAccepted: async (value) => { accepted.push(value); },
    GetDownloadExitRisk: async () => ({ downloads: true, downloadLossRisk: true, downloadIdentityUnknown: false }),
  } } } };

  riskDialog.showExitModal({ downloads: true, downloadLossRisk: true });
  assert.equal(elements["exit-confirm-message"].textContent,
    "部分文件的服务器未提供可靠的文件标识，退出并暂停下载后，这些文件的下载进度将被清空，下次需要重新下载。确定退出吗？");
  assert.equal(elements["exit-confirm-btn"].textContent, "确定退出");
  riskDialog.closeExitModal();
  assert.deepEqual(accepted, []);

  riskDialog.showExitModal({ downloads: true, downloadLossRisk: true });
  await riskDialog.confirmExit();
  assert.deepEqual(accepted, [true]);
});

test("new exit risk requires another visible confirmation", async () => {
  const elements = installDialogDOM();
  const { showExitModal, confirmExit } = await import("../src/js/features/modals/exit.js?race-dialog");
  const accepted = [];
  globalThis.window = { go: { app: { App: {
    ForceExitWithPauseLossAccepted: async (value) => {
      accepted.push(value);
      if (!value) throw new Error("DOWNLOAD_PAUSE_LOSS_CONFIRMATION_REQUIRED");
    },
    GetDownloadExitRisk: async () => ({ downloads: true, downloadLossRisk: true, downloadIdentityUnknown: false }),
  } } } };

  showExitModal({ downloads: true });
  await confirmExit();
  assert.match(elements["exit-confirm-message"].textContent, /服务器未提供可靠的文件标识/);
  assert.equal(elements["exit-confirm-btn"].textContent, "确定退出");
  assert.deepEqual(accepted, [false]);
  await confirmExit();
  assert.deepEqual(accepted, [false, true]);
});
