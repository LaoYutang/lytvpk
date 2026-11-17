import assert from "node:assert/strict";
import test from "node:test";
import { createFileScanCoordinator } from "../src/js/features/file-list/scan.js";
import { setWorkshopInstallationState } from "../src/js/features/workshop/installed.js";

function setup() {
  const state = { currentDirectory: "A" };
  const loads = [];
  const applied = [];
  const errors = [];
  const statuses = [];
  let idle = 0;
  const coordinator = createFileScanCoordinator({
    getDirectory: () => state.currentDirectory,
    load(directory, isCurrent) {
      const deferred = Promise.withResolvers();
      loads.push({ directory, isCurrent, ...deferred });
      return deferred.promise;
    },
    apply(snapshot, isCurrent) {
      if (isCurrent()) {
        applied.push(snapshot);
        state.currentDirectory = snapshot.directory || state.currentDirectory;
      }
    },
    onState(status, files) {
      statuses.push(status);
      setWorkshopInstallationState(state, status, files);
    },
    onError: (error) => errors.push(error),
    onIdle: () => idle++,
  });
  return { coordinator, state, loads, applied, errors, statuses, idle: () => idle };
}

async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
const snapshot = (directory, id = "123456") => ({ directory, files: [{ workshopId: id }], primaryTags: [] });

test("startup remains unconfirmed until a complete snapshot is applied", async () => {
  const h = setup();
  const pending = h.coordinator.request();
  assert.equal(h.state.workshopInstallationStatus, "loading");
  assert.equal(h.state.installedWorkshopIds.size, 0);
  h.loads[0].resolve(snapshot("A"));
  assert.equal((await pending).directory, "A");
  assert.equal(h.state.workshopInstallationStatus, "ready");
  assert.equal(h.state.installedWorkshopIds.has("123456"), true);
  assert.equal(h.idle(), 1);
});

test("install invalidations during scanning coalesce into one trailing scan", async () => {
  const h = setup();
  const first = h.coordinator.request();
  const second = h.coordinator.request();
  const third = h.coordinator.request();
  assert.equal(h.loads.length, 1, "no concurrent scans");
  h.loads[0].resolve(snapshot("A", "111111"));
  await settle();
  assert.equal(h.loads.length, 2);
  assert.equal(h.applied.length, 0, "superseded scan is never published");
  h.loads[1].resolve(snapshot("A", "222222"));
  assert.deepEqual(await Promise.all([first, second]), [null, null]);
  assert.equal((await third).directory, "A");
  assert.deepEqual([...h.state.installedWorkshopIds], ["222222"]);
  assert.deepEqual(h.statuses, ["loading", "loading", "loading", "ready"]);
});

test("ordinary refreshes follow a pending directory switch instead of returning to the old directory", async () => {
  const h = setup();
  const switching = h.coordinator.request({ directory: "B" });
  const refresh = h.coordinator.request();
  h.loads[0].resolve(snapshot("B"));
  await settle();
  assert.equal(h.loads[1].directory, "B");
  h.loads[1].resolve(snapshot("B", "234567"));
  assert.equal((await switching).directory, "B", "directory caller still gets the committed switch result");
  await refresh;
  assert.equal(h.state.currentDirectory, "B");
});

test("A to B to A uses generations, including when the old request fails late", async () => {
  const h = setup();
  const first = h.coordinator.request({ directory: "A" });
  const middle = h.coordinator.request({ directory: "B" });
  const latest = h.coordinator.request({ directory: "A" });
  assert.equal(h.loads[0].isCurrent(), false);
  h.loads[0].reject(new Error("old directory is unavailable"));
  await settle();
  assert.equal(h.loads[1].directory, "A");
  assert.deepEqual(h.errors, []);
  assert.equal(h.idle(), 0, "old failure cannot release the latest loading state");
  h.loads[1].resolve(snapshot("A", "345678"));
  await Promise.all([first, middle, latest]);
  assert.deepEqual([...h.state.installedWorkshopIds], ["345678"]);
  assert.equal(h.applied.length, 1);
});

test("scan failure clears old confirmation and a later refresh can recover", async () => {
  const h = setup();
  setWorkshopInstallationState(h.state, "ready", [{ workshopId: "123456" }]);
  const failed = h.coordinator.request();
  h.loads[0].reject(new Error("cannot read directory"));
  assert.equal(await failed, null);
  assert.equal(h.state.workshopInstallationStatus, "error");
  assert.equal(h.state.installedWorkshopIds.size, 0);
  assert.equal(h.errors.length, 1);
  const retry = h.coordinator.request();
  h.loads[1].resolve(snapshot("A", "234567"));
  await retry;
  assert.equal(h.state.workshopInstallationStatus, "ready");
  assert.deepEqual([...h.state.installedWorkshopIds], ["234567"]);
});

test("an invalidation during an asynchronous apply cannot confirm stale results", async () => {
  const wait = Promise.withResolvers();
  let applyCount = 0;
  const statuses = [];
  const coordinator = createFileScanCoordinator({
    getDirectory: () => "A",
    load: async () => snapshot("A"),
    apply: () => ++applyCount === 1 ? wait.promise : undefined,
    onState: (status) => statuses.push(status),
    onError: (error) => { throw error; },
    onIdle() {},
  });
  const first = coordinator.request();
  await settle();
  const second = coordinator.request();
  wait.resolve();
  await Promise.all([first, second]);
  assert.equal(applyCount, 2);
  assert.deepEqual(statuses, ["loading", "loading", "ready"]);
});

test("no directory does not scan and a failed switch restores the normal refresh target", async () => {
  let currentDirectory = "";
  const seen = [];
  const coordinator = createFileScanCoordinator({
    getDirectory: () => currentDirectory,
    load: async (directory) => {
      seen.push(directory);
      if (directory === "bad") throw new Error("invalid directory");
      return snapshot(directory);
    },
    apply() {}, onState() {}, onError() {}, onIdle() {},
  });
  assert.equal(await coordinator.request(), null);
  currentDirectory = "A";
  await coordinator.request({ directory: "bad" });
  await coordinator.request();
  assert.deepEqual(seen, ["bad", "A"]);
});
