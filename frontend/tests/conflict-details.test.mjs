import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { setImmediate } from "node:timers/promises";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith("/wailsjs/go/app/App")) {
      return nextResolve(specifier + ".js", context);
    }
    if (specifier === "../workshop/workshop-browser.js") {
      return {
        url: "data:text/javascript,export function handleProtocolWorkshop(id){window.openedWorkshopId=id}",
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});
const { appState } = await import("../src/js/features/state.js");
const { showFileDetail, closeModal } = await import("../src/js/features/modals/detail.js");
hooks.deregister();

function element() {
  const el = new EventTarget();
  const classes = new Set();
  return Object.assign(el, {
    style: {}, dataset: {}, inert: false,
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    focus() { document.activeElement = el; },
    setAttribute(k, v) { el[k] = v; },
    removeAttribute(k) { delete el[k]; },
    replaceChildren(...nodes) { el.children = nodes; },
    appendChild(node) { (el.children ??= []).push(node); },
    querySelector() { return null; },
    contains(node) { return node === el; },
  });
}

const nodes = new Map();
function byId(id) {
  if (!nodes.has(id)) nodes.set(id, element());
  return nodes.get(id);
}
globalThis.document = Object.assign(new EventTarget(), {
  getElementById: byId,
  querySelectorAll: () => [],
  elementFromPoint: () => byId("file-detail-modal"),
  createElement: element,
});
const { configureConflicts, showConflictModal, hideConflictModal } =
  await import("../src/js/features/conflicts/conflicts.js");

const root = { name: "twin.vpk", title: "Twin", location: "root", author: "Root", path: "C:/addons/twin.vpk" };
const workshop = { ...root, location: "workshop", author: "Workshop", path: "C:/addons/workshop/twin.vpk" };

// The conflict renderer inserts a detail button before each action in its HTML template.
// Supply just those host elements, using the actual paths written by the renderer.
function conflictGroup() {
  const group = element();
  group.querySelector = () => element();
  group.querySelectorAll = (selector) => {
    assert.equal(selector, ".btn-conflict-action");
    const actions = [...group.innerHTML.matchAll(/data-path="([^"]+)"/g)].map(([, path]) => {
      const action = element();
      action.dataset.path = path;
      action.before = (button) => { action.detail = button; };
      return action;
    });
    group.actions = actions;
    return actions;
  };
  return group;
}

test.beforeEach(() => {
  nodes.clear();
  byId("file-detail-modal").classList.add("hidden");
  document.createElement = (tag) => tag === "div" ? conflictGroup() : element();
  appState.allVpkFiles = [root, workshop];
  appState.vpkFiles = [root];
  globalThis.window = { go: { app: { App: { GetVPKPreviewImage: async () => "" } } } };
});
test.afterEach(() => {
  closeModal();
  hideConflictModal();
});
test.after(() => {
  delete globalThis.document;
  delete globalThis.window;
});

test("each conflict row opens its own management detail by path, including a filtered-out namesake", async () => {
  let scans = 0;
  configureConflicts({
    CheckConflicts: async () => {
      scans++;
      return { total_conflicts: 1, conflict_groups: [{ severity: "critical", vpk_files: [root, workshop] }] };
    },
    showFileDetail,
    showError: assert.fail,
    refreshFilesKeepFilter: () => assert.fail("Both files are already in the full catalogue"),
  });
  showConflictModal();
  await setImmediate();
  const [group] = byId("conflict-list").children;
  assert.deepEqual(group.actions.map((action) => action.dataset.path), [root.path, workshop.path]);
  for (const [index, file] of [root, workshop].entries()) {
    const button = group.actions[index].detail;
    assert.equal(button.textContent, "详情");
    button.dispatchEvent(new Event("click"));
    assert.equal(byId("file-detail-modal").classList.contains("hidden"), false);
    assert.equal(byId("detail-vpk-author").textContent, file.author);
    assert.equal(byId("conflict-modal").inert, true);
    assert.equal(document.activeElement, byId("close-modal-header-btn"));

    const escape = Object.assign(new Event("keydown", { cancelable: true }), { key: "Escape" });
    document.dispatchEvent(escape);
    assert.equal(byId("file-detail-modal").classList.contains("hidden"), true);
    assert.equal(byId("conflict-modal").classList.contains("hidden"), false);
    assert.equal(byId("conflict-modal").inert, false);
    assert.equal(document.activeElement, button);
    assert.equal(byId("conflict-list").children[0], group);
  }
  assert.deepEqual(appState.vpkFiles, [root]);
  assert.equal(scans, 1);
});

test("late preview and workshop-ID responses cannot replace another same-name MOD's details", async () => {
  const oldPreview = Promise.withResolvers();
  const oldWorkshopId = Promise.withResolvers();
  const first = { ...root, addonURL0: "first" };
  const second = { ...workshop, addonURL0: "second" };
  appState.allVpkFiles = [first, second];
  appState.vpkFiles = [first];
  window.go.app.App.GetVPKPreviewImage = (path) => path === first.path ? oldPreview.promise : Promise.resolve("second-image");
  window.go.app.App.ParseWorkshopID = (url) => url === first.addonURL0 ? oldWorkshopId.promise : Promise.resolve("222");

  showFileDetail(first.path);
  assert.equal(byId("conflict-modal").inert, false);
  closeModal();
  showFileDetail(second.path, element());
  await setImmediate();
  oldPreview.resolve("first-image");
  oldWorkshopId.resolve("111");
  await setImmediate();

  assert.equal(byId("detail-preview-image").src, "second-image");
  const link = byId("detail-vpk-url");
  assert.match(link.textContent, /222/);
  link.onclick(new Event("click"));
  assert.equal(window.openedWorkshopId, "222");
});
