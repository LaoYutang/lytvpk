import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const filtersURL = new URL("../src/js/features/file-list/filters.js", import.meta.url).href;
let generation = 0;

async function setup() {
  const state = {
    currentDirectory: "A", allVpkFiles: [], vpkFiles: [], primaryTags: [],
    selectedFiles: new Set(), selectedPrimaryTag: "", selectedSecondaryTags: [],
    selectedLocations: [], searchQuery: "", showHidden: false,
  };
  const search = { value: "", classList: { remove() {} } };
  const calls = { scans: 0, snapshots: 0, roots: [], errors: [], hides: 0, renders: 0 };
  let root = "A";
  let files = [];
  const dependencies = {
    GetRootDirectory: async () => root,
    SetRootDirectory: async (directory) => { calls.roots.push(directory); root = directory; },
    ValidateDirectory: async () => {},
    ScanVPKFiles: async () => { calls.scans++; },
    GetVPKFiles: async () => { calls.snapshots++; return files; },
    GetPrimaryTags: async () => [],
    GetSecondaryTags: async () => [],
    SearchVPKFiles: async () => files.filter((file) => file.name.includes(state.searchQuery)),
    showError: (error) => calls.errors.push(error),
    showNotification() {}, updateStatusBar() {}, showFileListLoading() {},
    hideFileListLoading: () => calls.hides++,
    renderFileList: () => calls.renders++,
    applySort: (value) => value, refreshSortData: async () => {},
    saveSortPreference() {}, updateSortButtonUI() {}, resetBoxSelection() {},
  };
  globalThis.__localRefreshTest = { state, ...dependencies };
  globalThis.document = {
    getElementById: (id) => id === "search-input" ? search : null,
    querySelectorAll: () => [], addEventListener() {},
  };
  globalThis.window = { addEventListener() {} };
  const importNames = {
    "../state.js": ["updateStatusBar", "showFileListLoading", "hideFileListLoading"],
    "../../core/toast.js": ["showError", "showNotification"],
    "./render.js": ["renderFileList"],
    "./sorting.js": ["applySort", "refreshSortData", "saveSortPreference", "updateSortButtonUI"],
    "./box-selection.js": ["resetBoxSelection"],
    "../../../../wailsjs/go/app/App": [
      "GetRootDirectory", "SetRootDirectory", "ValidateDirectory", "ScanVPKFiles",
      "GetVPKFiles", "GetPrimaryTags", "GetSecondaryTags", "SearchVPKFiles",
    ],
  };
  const moduleURL = `${filtersURL}?test=${generation++}`;
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL === moduleURL && importNames[specifier]) {
        let source = importNames[specifier].map((name) =>
          `export const ${name} = (...args) => globalThis.__localRefreshTest.${name}(...args);`
        ).join("\n");
        if (specifier === "../state.js") source += "\nexport const appState = globalThis.__localRefreshTest.state;";
        source += `\n// Fixture ${generation}`;
        return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
  const module = await import(moduleURL);
  hooks.deregister();
  return { ...module, state, search, calls, setFiles: (value) => { files = value; }, root: () => root };
}

test.after(() => {
  delete globalThis.__localRefreshTest;
  delete globalThis.document;
  delete globalThis.window;
  delete globalThis.__deleteRefreshTest;
});
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
const file = (name, id, location = "root") => ({ path: `A/${name}`, name, workshopId: id, location, enabled: location !== "disabled" });

test("real refresh builds installation IDs from the complete snapshot while preserving UI filters", async (t) => {
  t.mock.method(console, "log", () => {});
  const h = await setup();
  h.search.value = "weapon";
  h.state.searchQuery = "weapon";
  h.state.selectedLocations = ["root"];
  h.setFiles([file("weapon.vpk", "123456"), file("_hidden.vpk", "234567"), file("map.vpk", "345678", "disabled")]);
  await h.refreshFilesKeepFilter();
  assert.deepEqual(h.state.vpkFiles.map((item) => item.name), ["weapon.vpk"]);
  assert.deepEqual([...h.state.installedWorkshopIds], ["123456", "234567", "345678"]);
  assert.equal(h.search.value, "weapon");
  assert.deepEqual(h.state.selectedLocations, ["root"]);
  assert.equal(h.calls.scans, 1);
  assert.equal(h.calls.snapshots, 1);
  assert.equal(h.state.isLoading, false);
});

test("a completed install during the startup scan is not dropped by the loading flag", async (t) => {
  t.mock.method(console, "log", () => {});
  const h = await setup();
  const firstScan = Promise.withResolvers();
  globalThis.__localRefreshTest.ScanVPKFiles = async () => {
    h.calls.scans++;
    if (h.calls.scans === 1) await firstScan.promise;
  };
  const first = h.refreshFilesKeepFilter();
  await settle();
  assert.equal(h.state.isLoading, true);
  const completed = h.refreshFilesKeepFilter();
  h.setFiles([file("new.vpk", "123456")]);
  firstScan.resolve();
  await Promise.all([first, completed]);
  assert.equal(h.calls.scans, 2);
  assert.equal(h.calls.snapshots, 1, "obsolete scan never publishes its snapshot");
  assert.equal(h.state.installedWorkshopIds.has("123456"), true);
  assert.equal(h.calls.hides, 1);
});

test("a late SetRootDirectory cannot leave the backend in B after the UI requests A again", async (t) => {
  t.mock.method(console, "log", () => {});
  const h = await setup();
  const pendingSet = Promise.withResolvers();
  const originalSet = globalThis.__localRefreshTest.SetRootDirectory;
  globalThis.__localRefreshTest.SetRootDirectory = async (directory) => {
    if (directory === "B") await pendingSet.promise;
    await originalSet(directory);
  };
  const first = h.refreshFilesKeepFilter({ directory: "B" });
  await settle();
  const last = h.refreshFilesKeepFilter({ directory: "A" });
  pendingSet.resolve();
  assert.equal(await first, null);
  assert.equal((await last).directory, "A");
  assert.equal(h.root(), "A");
  assert.equal(h.state.currentDirectory, "A");
  assert.deepEqual(h.calls.roots, ["B", "A"]);
  assert.equal(h.calls.scans, 1);
});

test("snapshot failure leaves installation unknown and releases the loading controls", async (t) => {
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "error", () => {});
  const h = await setup();
  h.setFiles([file("old.vpk", "123456")]);
  await h.refreshFilesKeepFilter();
  globalThis.__localRefreshTest.GetVPKFiles = async () => { throw new Error("snapshot unavailable"); };
  assert.equal(await h.refreshFilesKeepFilter(), null);
  assert.equal(h.state.workshopInstallationStatus, "error");
  assert.equal(h.state.installedWorkshopIds.size, 0);
  assert.equal(h.state.isLoading, false);
  assert.equal(h.calls.errors.length, 1);
});

test("partially failed batch deletion refreshes installation state and retains only undeleted selections", async (t) => {
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "error", () => {});
  const h = await setup();
  const removed = file("removed.vpk", "123456");
  const retained = file("retained.vpk", "234567");
  h.setFiles([removed, retained]);
  await h.refreshFilesKeepFilter();
  h.state.selectedFiles = new Set([removed.path, retained.path]);
  let confirmation;
  globalThis.__deleteRefreshTest = {
    state: h.state,
    refreshFilesKeepFilter: h.refreshFilesKeepFilter,
    showConfirmModal: (_title, _message, accept) => { confirmation = accept; },
    showError: (message) => h.calls.errors.push(message),
    DeleteVPKFiles: async () => { h.setFiles([retained]); throw new Error("second file could not be deleted"); },
  };
  const actionsURL = new URL("../src/js/features/file-list/actions.js", import.meta.url).href;
  const names = {
    "../state.js": ["toggleFileSelection", "updateStatusBar", "showLoadingScreen", "showMainScreen", "updateLoadingMessage"],
    "../../core/toast.js": ["showError", "showNotification", "showSuccess"],
    "../modals/confirm.js": ["showConfirmModal"],
    "./render.js": ["renderFileList", "iconSvg", "createLocationBadge"],
    "./filters.js": ["refreshFilesKeepFilter"],
    "../../../../wailsjs/go/app/App": ["ToggleVPKFile", "ExportVPKFilesToZip", "MoveVpkFiles", "DeleteVPKFiles", "SelectDirectory", "GetVPKFiles", "ToggleVPKVisibility"],
    "../../../../wailsjs/runtime/runtime": ["EventsOn"],
    "./operations.js": ["moveWorkshopFilesToAddons"],
  };
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL === actionsURL && names[specifier]) {
        let source = names[specifier].map((name) =>
          `export const ${name} = (...args) => globalThis.__deleteRefreshTest.${name}?.(...args);`
        ).join("\n");
        if (specifier === "../state.js") source += "\nexport const appState = globalThis.__deleteRefreshTest.state;";
        return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
  const { deleteSelected } = await import(actionsURL);
  hooks.deregister();
  deleteSelected();
  await confirmation();
  assert.deepEqual([...h.state.installedWorkshopIds], ["234567"]);
  assert.deepEqual([...h.state.selectedFiles], [retained.path]);
  assert.equal(h.calls.scans, 2);
  assert.equal(h.calls.errors.length, 1);
});
