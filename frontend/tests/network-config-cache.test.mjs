import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const configURL = new URL("../src/js/core/config.js", import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === configURL && specifier.endsWith("wailsjs/go/app/App")) {
      const source = ["GetAppConfig", "GetConfigMigrationVersion", "MigrateLocalStorageConfig", "SaveAppConfig"]
        .map((name) => `export const ${name} = (...args) => globalThis.__networkConfigCacheTest.${name}(...args);`).join("\n");
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { initConfig, getConfig, saveConfig, updateConfigCache, migrateLegacyLocalStorageIfNeeded } = await import(configURL);
hooks.deregister();

let loaded;
let writes;
const initialNetwork = {
  apiLine: "primary",
  workshopDNS: { mode: "dnspod", customAddress: "" },
  workshopPreferredIP: true,
  workshopFixedIP: "",
};
const changedNetwork = {
  apiLine: "backup",
  workshopDNS: { mode: "custom", customAddress: "2001:db8::53" },
  workshopPreferredIP: false,
  workshopFixedIP: "192.0.2.8",
};

function networkFields(config) {
  return Object.fromEntries(Object.keys(initialNetwork).map((key) => [key, config[key]]));
}

test.beforeEach(async () => {
  loaded = { ...structuredClone(initialNetwork), theme: "light", displayMode: "list", migrationVersion: 5 };
  writes = [];
  globalThis.__networkConfigCacheTest = {
    GetAppConfig: async () => structuredClone(loaded),
    GetConfigMigrationVersion: async () => loaded.migrationVersion,
    MigrateLocalStorageConfig: async () => {},
    SaveAppConfig: async (value) => { writes.push(structuredClone(value)); },
  };
  await initConfig();
});
test.after(() => {
  delete globalThis.__networkConfigCacheTest;
  delete globalThis.localStorage;
});

test("an old general snapshot preserves independently confirmed network settings", async () => {
  const stale = getConfig();
  updateConfigCache(changedNetwork);
  await saveConfig({ ...stale, theme: "dark", displayMode: "card" });
  assert.deepEqual(networkFields(getConfig()), changedNetwork);
  assert.deepEqual(networkFields(writes[0]), changedNetwork);
  assert.equal(getConfig().theme, "dark");
  assert.equal(getConfig().displayMode, "card");
  assert.equal(writes[0].theme, "dark");
});

test("partial ordinary preferences cannot apply unconfirmed network controls", async () => {
  await saveConfig({
    ...changedNetwork,
    sortType: "date",
    sortOrder: "desc",
    workshopMetaEnabled: false,
  });
  assert.deepEqual(networkFields(getConfig()), initialNetwork);
  assert.deepEqual(networkFields(writes[0]), initialNetwork);
  assert.equal(getConfig().sortType, "date");
  assert.equal(getConfig().sortOrder, "desc");
  assert.equal(getConfig().workshopMetaEnabled, false);
});

test("a rejected ordinary save retains confirmed network values and its existing error contract", async (t) => {
  t.mock.method(console, "error", () => {});
  const stale = getConfig();
  updateConfigCache(changedNetwork);
  const failure = new Error("local fixture write failure");
  globalThis.__networkConfigCacheTest.SaveAppConfig = async (value) => {
    writes.push(structuredClone(value));
    throw failure;
  };
  await assert.rejects(saveConfig({ ...stale, theme: "dark" }), (error) => error === failure);
  assert.deepEqual(networkFields(getConfig()), changedNetwork);
  assert.deepEqual(networkFields(writes[0]), changedNetwork);
  assert.equal(getConfig().theme, "dark", "ordinary settings keep their existing optimistic cache behavior");
});

for (const reject of [false, true]) {
  test(`an older in-flight ordinary save ${reject ? "rejection" : "completion"} cannot roll back a later network update`, async (t) => {
    t.mock.method(console, "error", () => {});
    const gate = Promise.withResolvers();
    globalThis.__networkConfigCacheTest.SaveAppConfig = (value) => {
      writes.push(structuredClone(value));
      return gate.promise;
    };
    const pending = saveConfig({ ...getConfig(), theme: "dark" });
    updateConfigCache(changedNetwork);
    if (reject) {
      const failure = new Error("deferred fixture failure");
      gate.reject(failure);
      await assert.rejects(pending, (error) => error === failure);
    } else {
      gate.resolve();
      await pending;
    }
    assert.deepEqual(networkFields(getConfig()), changedNetwork);
    assert.equal(getConfig().theme, "dark");
    assert.equal(writes.length, 1);
  });
}

test("old configuration initialization still loads explicit network settings", async () => {
  updateConfigCache(changedNetwork);
  loaded = {
    migrationVersion: 1,
    workshopPreferredIP: false,
    workshopFixedIP: "192.0.2.7",
    workshopDNS: { mode: "system" },
    theme: "dark",
  };
  const config = await initConfig();
  assert.deepEqual(networkFields(config), {
    apiLine: "primary",
    workshopPreferredIP: false,
    workshopFixedIP: "192.0.2.7",
    workshopDNS: { mode: "system", customAddress: "" },
  });
  assert.equal(config.migrationVersion, 1);
  assert.equal(config.theme, "dark");
  assert.equal(writes.length, 0);
});

test("legacy migration can still initialize network values returned by the backend", async () => {
  const legacyConfig = { workshopPreferredIP: false, workshopFixedIP: "192.0.2.7" };
  const storage = new Map([["vpk-manager-config", JSON.stringify(legacyConfig)], ["theme", "dark"]]);
  globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, removeItem: (key) => storage.delete(key) };
  loaded = { migrationVersion: 1 };
  let migrated;
  globalThis.__networkConfigCacheTest.MigrateLocalStorageConfig = async (payload) => {
    migrated = payload;
    loaded = { ...legacyConfig, theme: payload.theme, migrationVersion: 5 };
  };
  assert.equal(await migrateLegacyLocalStorageIfNeeded(), true);
  assert.deepEqual(JSON.parse(migrated.config), legacyConfig);
  const config = await initConfig();
  assert.equal(config.workshopPreferredIP, false);
  assert.equal(config.workshopFixedIP, "192.0.2.7");
  assert.deepEqual(config.workshopDNS, initialNetwork.workshopDNS);
  assert.equal(config.theme, "dark");
  assert.equal(storage.size, 0);
  assert.equal(writes.length, 0);
});

test("missing legacy fields keep defaults and network cache snapshots stay detached", async () => {
  loaded = { migrationVersion: 1, theme: "dark" };
  await initConfig();
  assert.deepEqual(networkFields(getConfig()), initialNetwork);
  const patch = structuredClone(changedNetwork);
  updateConfigCache(patch);
  patch.workshopDNS.customAddress = "192.0.2.99";
  const stale = getConfig();
  stale.workshopDNS.mode = "system";
  await saveConfig({ ...stale, filterLayoutMode: "classic" });
  assert.deepEqual(networkFields(getConfig()), changedNetwork);
  assert.equal(getConfig().filterLayoutMode, "classic");
});
