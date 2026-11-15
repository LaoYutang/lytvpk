import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import {
  configureServerViewMode,
  getServerDisplayMode,
  setServerDisplayMode,
} from "../src/js/features/servers/view-mode.js";

const configURL = new URL("../src/js/core/config.js", import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === configURL && specifier.endsWith("wailsjs/go/app/App")) {
      const source = ["GetAppConfig", "GetConfigMigrationVersion", "MigrateLocalStorageConfig", "SaveAppConfig"]
        .map((name) => `export const ${name} = (...args) => globalThis.__serverViewConfigTest.${name}(...args);`).join("\n");
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { initConfig, getConfig, saveConfig, updateConfigCache } = await import(configURL);
hooks.deregister();

let loaded;
let writes;
let persist;
let events;
test.beforeEach(() => {
  loaded = { displayMode: "card", theme: "dark", migrationVersion: 5 };
  writes = [];
  persist = async () => {};
  events = [];
  globalThis.window = new EventTarget();
  window.addEventListener("server-display-mode-changed", (event) => events.push(event.detail));
  globalThis.__serverViewConfigTest = {
    GetAppConfig: async () => structuredClone(loaded),
    SaveAppConfig: async (value) => {
      const written = structuredClone(value);
      writes.push(written);
      await persist();
      loaded = written;
    },
  };
  configureServerViewMode({ getConfig, saveConfig, updateConfigCache });
});
test.after(() => {
  delete globalThis.__serverViewConfigTest;
  delete globalThis.window;
});

test("older user configurations keep list servers independently from the Mod card view", async () => {
  await initConfig();
  assert.equal(getConfig().serverDisplayMode, "list");
  assert.equal(getConfig().displayMode, "card");
  assert.deepEqual(writes, []);
});

test("the server card preference is restored and saved without changing other preferences", async () => {
  loaded.serverDisplayMode = "card";
  await initConfig();
  assert.equal(getConfig().serverDisplayMode, "card");
  await setServerDisplayMode("list");
  assert.equal(writes[0].serverDisplayMode, "list");
  assert.equal(writes[0].displayMode, "card");
  assert.equal(writes[0].theme, "dark");
});

test("invalid server modes normalize to list on initialization and save", async () => {
  for (const invalid of ["", "grid", "CARD", null, 1]) {
    loaded.serverDisplayMode = invalid;
    await initConfig();
    assert.equal(getConfig().serverDisplayMode, "list");
    await saveConfig({ serverDisplayMode: invalid });
    assert.equal(writes.at(-1).serverDisplayMode, "list");
  }
});

test("ordinary saves cannot change the server view outside its dedicated setter", async () => {
  loaded.serverDisplayMode = "card";
  await initConfig();
  await saveConfig({ serverDisplayMode: "list", theme: "light" });
  assert.equal(getConfig().serverDisplayMode, "card");
  assert.equal(writes[0].serverDisplayMode, "card");
  assert.equal(writes[0].theme, "light");
  assert.deepEqual(events, []);
});

test("an old whole-config snapshot cannot overwrite a newly saved server view", async () => {
  await initConfig();
  const stale = getConfig();
  assert.equal(stale.serverDisplayMode, "list");
  await setServerDisplayMode("card");
  await saveConfig({
    ...stale,
    modRotationConfig: { enableCharacters: true, enableWeapons: false },
    theme: "light",
  });
  assert.equal(getServerDisplayMode(), "card");
  assert.deepEqual(writes.map((value) => value.serverDisplayMode), ["card", "card"]);
  assert.deepEqual(getConfig().modRotationConfig, { enableCharacters: true, enableWeapons: false });
  assert.equal(getConfig().displayMode, "card");
  assert.equal(getConfig().theme, "light");
  assert.deepEqual(events, [{ mode: "card" }]);
  await initConfig();
  assert.equal(getServerDisplayMode(), "card", "the confirmed saved value survives a configuration reload");
});

test("a failed server-view save restores only its field in the real config cache", async (t) => {
  t.mock.method(console, "error", () => {});
  await initConfig();
  const gate = Promise.withResolvers();
  const failure = new Error("fixture full disk");
  persist = () => gate.promise;
  const saving = setServerDisplayMode("card");
  await Promise.resolve();
  assert.equal(getServerDisplayMode(), "card");
  updateConfigCache({ theme: "light", workshopMetaEnabled: false });
  gate.reject(failure);
  await assert.rejects(saving, (error) => error === failure);
  assert.equal(getServerDisplayMode(), "list");
  assert.equal(getConfig().theme, "light");
  assert.equal(getConfig().workshopMetaEnabled, false);
  assert.equal(getConfig().displayMode, "card");
  assert.deepEqual(events, []);

  persist = async () => {};
  await setServerDisplayMode("card");
  assert.equal(getServerDisplayMode(), "card");
  assert.deepEqual(events, [{ mode: "card" }]);
  assert.equal(writes.at(-1).theme, "light");
  assert.equal(writes.at(-1).workshopMetaEnabled, false);
});
