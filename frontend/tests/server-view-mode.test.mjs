import assert from "node:assert/strict";
import test from "node:test";
import {
  configureServerViewMode,
  getServerDisplayMode,
  setServerDisplayMode,
} from "../src/js/features/servers/view-mode.js";

let config;
let writes;
let cacheUpdates;
let events;
let persist;

test.beforeEach(() => {
  config = { serverDisplayMode: "list", displayMode: "card", theme: "light" };
  writes = [];
  cacheUpdates = [];
  events = [];
  persist = async () => {};
  globalThis.window = new EventTarget();
  window.addEventListener("server-display-mode-changed", (event) => events.push(event));
  configureServerViewMode({
    getConfig: () => structuredClone(config),
    saveConfig: async (patch) => {
      writes.push(structuredClone(patch));
      config = { ...config, ...patch };
      await persist();
    },
    updateConfigCache: (patch) => {
      cacheUpdates.push(structuredClone(patch));
      config = { ...config, ...patch };
    },
  });
});

test.after(() => { delete globalThis.window; });

test("missing and invalid server preferences default to list independently of the Mod view", () => {
  delete config.serverDisplayMode;
  assert.equal(getServerDisplayMode(), "list");
  for (const value of ["", "grid", "CARD", " card ", null, 1, false]) {
    config.serverDisplayMode = value;
    assert.equal(getServerDisplayMode(), "list");
    assert.equal(config.displayMode, "card");
  }
  config.serverDisplayMode = "card";
  assert.equal(getServerDisplayMode(), "card");
});

test("a successful save publishes one event only after persistence completes", async () => {
  const gate = Promise.withResolvers();
  persist = () => gate.promise;
  const saving = setServerDisplayMode("card");
  await Promise.resolve();
  assert.deepEqual(writes, [{ serverDisplayMode: "card" }]);
  assert.deepEqual(events, []);
  assert.equal(config.displayMode, "card");
  gate.resolve();
  assert.equal(await saving, "card");
  assert.equal(getServerDisplayMode(), "card");
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "server-display-mode-changed");
  assert.deepEqual(events[0].detail, { mode: "card" });
  assert.deepEqual(cacheUpdates, [{ serverDisplayMode: "card" }]);
});

test("failed persistence rolls back only the server preference and emits no success event", async () => {
  const gate = Promise.withResolvers();
  const failure = new Error("fixture disk write failed");
  persist = () => gate.promise;
  const saving = setServerDisplayMode("card");
  await Promise.resolve();
  assert.equal(getServerDisplayMode(), "card", "the shared config cache updates optimistically");
  config.theme = "dark";
  gate.reject(failure);
  await assert.rejects(saving, (error) => error === failure);
  assert.equal(getServerDisplayMode(), "list");
  assert.equal(config.displayMode, "card");
  assert.equal(config.theme, "dark");
  assert.deepEqual(cacheUpdates, [{ serverDisplayMode: "card" }, { serverDisplayMode: "list" }]);
  assert.deepEqual(events, []);

  persist = async () => {};
  assert.equal(await setServerDisplayMode("card"), "card", "a failed save releases the pending operation for retry");
  assert.equal(writes.length, 2);
  assert.equal(events.length, 1);
});

test("repeated requests during a save share the operation and do not duplicate writes or events", async () => {
  const gate = Promise.withResolvers();
  persist = () => gate.promise;
  const first = setServerDisplayMode("card");
  for (let index = 0; index < 8; index++) assert.equal(setServerDisplayMode("card"), first);
  await Promise.resolve();
  assert.equal(setServerDisplayMode("card"), first, "deduplication continues after the optimistic cache update");
  assert.equal(writes.length, 1);
  assert.deepEqual(events, []);
  gate.resolve();
  await first;
  assert.equal(events.length, 1);
  assert.equal(await setServerDisplayMode("list"), "list", "a completed operation releases the next preference save");
  assert.equal(writes.length, 2);
  assert.equal(events.length, 2);
});

test("requesting the current mode is a no-op and invalid requested modes use list", async () => {
  assert.equal(await setServerDisplayMode("list"), "list");
  assert.equal(await setServerDisplayMode("grid"), "list");
  assert.deepEqual(writes, []);
  assert.deepEqual(events, []);
  config.serverDisplayMode = "card";
  assert.equal(await setServerDisplayMode("grid"), "list");
  assert.deepEqual(writes, [{ serverDisplayMode: "list" }]);
  assert.equal(config.displayMode, "card");
  assert.deepEqual(events[0].detail, { mode: "list" });
});

test("different pending choices are saved in request order across controls", async () => {
  const gate = Promise.withResolvers();
  let call = 0;
  persist = () => ++call === 1 ? gate.promise : Promise.resolve();
  const first = setServerDisplayMode("card");
  const second = setServerDisplayMode("list");
  const latest = setServerDisplayMode("card");
  assert.equal(setServerDisplayMode("card"), latest);
  await Promise.resolve();
  assert.deepEqual(writes, [{ serverDisplayMode: "card" }]);
  gate.resolve();
  assert.deepEqual(await Promise.all([first, second, latest]), ["card", "list", "card"]);
  assert.deepEqual(writes.map((patch) => patch.serverDisplayMode), ["card", "list", "card"]);
  assert.deepEqual(events.map((event) => event.detail.mode), ["card", "list", "card"]);
  assert.equal(getServerDisplayMode(), "card");
});

test("a failed pending choice does not cancel a later choice", async () => {
  const gate = Promise.withResolvers();
  persist = () => gate.promise;
  const first = setServerDisplayMode("card");
  const latest = setServerDisplayMode("list");
  const failure = new Error("fixture queued write failed");
  gate.reject(failure);
  await assert.rejects(first, (error) => error === failure);
  assert.equal(await latest, "list");
  assert.equal(getServerDisplayMode(), "list");
  assert.deepEqual(events, []);
});

test("server list and card changes preserve an existing Mod list preference", async () => {
  config.displayMode = "list";
  await setServerDisplayMode("card");
  assert.equal(config.displayMode, "list");
  await setServerDisplayMode("list");
  assert.equal(config.displayMode, "list");
  assert.deepEqual(writes, [{ serverDisplayMode: "card" }, { serverDisplayMode: "list" }]);
});
