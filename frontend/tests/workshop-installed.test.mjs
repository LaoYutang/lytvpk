import assert from "node:assert/strict";
import test from "node:test";
import {
  appendInstalledBadge, isWorkshopItemInstalled, normalizeWorkshopID,
  setWorkshopInstallationState,
} from "../src/js/features/workshop/installed.js";

let state;
let badges;
test.beforeEach(() => {
  state = {};
  badges = [];
  globalThis.document = {
    createElement: () => ({ dataset: {}, hidden: false }),
    querySelectorAll: () => badges,
  };
  setWorkshopInstallationState(state, "unknown");
});
test.after(() => { delete globalThis.document; });
const parent = () => ({ appendChild: (badge) => badges.push(badge) });

test("unknown, loading and failed scans never display installed badges", () => {
  const badge = appendInstalledBadge(parent(), "123456");
  assert.equal(badge.hidden, true);
  setWorkshopInstallationState(state, "ready", [{ workshopId: "123456" }]);
  assert.equal(badge.hidden, false);
  for (const status of ["loading", "error", "unknown"]) {
    setWorkshopInstallationState(state, status, [{ workshopId: "123456" }]);
    assert.equal(badge.hidden, true);
    assert.equal(state.installedWorkshopIds.size, 0);
  }
});

test("all local locations, disabled and hidden files count independently of display filters", () => {
  setWorkshopInstallationState(state, "ready", [
    { workshopId: "123456", location: "root", enabled: true },
    { workshopId: "234567", location: "disabled", enabled: false },
    { workshopId: "345678", location: "workshop", name: "_hidden.vpk" },
    { workshopId: "" }, { workshopId: "direct-123456" }, { workshopId: "invalid" },
  ]);
  assert.deepEqual([...state.installedWorkshopIds], ["123456", "234567", "345678"]);
  assert.equal(isWorkshopItemInstalled("234567"), true);
  assert.equal(isWorkshopItemInstalled("456789"), false);
});

test("duplicate installs stay marked until the final local copy is removed", () => {
  const badge = appendInstalledBadge(parent(), { publishedfileid: "123456" });
  const files = [{ path: "a", workshopId: "123456" }, { path: "b", workshopId: "123456" }];
  setWorkshopInstallationState(state, "ready", files);
  assert.equal(state.installedWorkshopIds.size, 1);
  setWorkshopInstallationState(state, "ready", files.slice(1));
  assert.equal(badge.hidden, false);
  setWorkshopInstallationState(state, "ready", []);
  assert.equal(badge.hidden, true);
});

test("a new directory replaces the previous set and patches existing nodes in place", () => {
  const first = appendInstalledBadge(parent(), "123456");
  const second = appendInstalledBadge(parent(), "234567");
  const original = [...badges];
  setWorkshopInstallationState(state, "ready", [{ workshopId: "123456" }]);
  setWorkshopInstallationState(state, "loading");
  setWorkshopInstallationState(state, "ready", [{ workshopId: "234567" }]);
  assert.deepEqual(badges, original);
  assert.equal(first.hidden, true);
  assert.equal(second.hidden, false);
});

test("late rendered badges use current state and collection bodies never receive a badge", () => {
  setWorkshopInstallationState(state, "ready", [{ workshopId: "123456" }]);
  assert.equal(appendInstalledBadge(parent(), { publishedfileid: "123456" }).hidden, false);
  assert.equal(appendInstalledBadge(parent(), { rootId: "123456", fileType: 2 }), null);
  assert.equal(appendInstalledBadge(parent(), { publishedfileid: "123456", file_type: "2" }), null);
  assert.equal(appendInstalledBadge(parent(), { workshop_id: "123456" }).textContent, "已安装");
  assert.equal(appendInstalledBadge(parent(), { publishedfileid: "direct-123456" }), null);
});

test("ID matching preserves large integer precision and rejects invalid identities", () => {
  assert.equal(normalizeWorkshopID("9223372036854775807"), "9223372036854775807");
  assert.equal(normalizeWorkshopID("000123456"), "123456");
  for (const id of ["", "99999", "9223372036854775808", "12e5", "123456x", true, {}, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(normalizeWorkshopID(id), "");
  }
  setWorkshopInstallationState(state, "ready", [{ workshopId: "9007199254740993" }]);
  assert.equal(isWorkshopItemInstalled("9007199254740993"), true);
  assert.equal(isWorkshopItemInstalled("9007199254740992"), false);
});
