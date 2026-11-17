import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { workshopDeps } from "../src/js/features/workshop/deps.js";
import { setWorkshopInstallationState } from "../src/js/features/workshop/installed.js";

const moduleURL = new URL("../src/js/features/workshop/watch-later.js", import.meta.url).href;
let opened = [];
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === moduleURL && specifier === "./detail.js") {
      return { url: "data:text/javascript,export const openWorkshopDetail = x => globalThis.__watchLaterOpened(x);", shortCircuit: true };
    }
    if (context.parentURL === moduleURL && specifier === "./detail-images.js") {
      return { url: "data:text/javascript,export const getWorkshopPreviewImages = () => [];", shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { initWatchLaterStorage, getWatchLaterItems } = await import(moduleURL);
hooks.deregister();

class Element {
  constructor() {
    this.children = [];
    this.dataset = {};
    this.classes = new Set();
    this.classList = {
      add: (name) => this.classes.add(name), remove: (name) => this.classes.delete(name),
      toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name),
    };
    this.listeners = new Map();
  }
  set innerHTML(value) { this.html = value; this.children = []; }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.children.push(node); return node; }
  setAttribute() {}
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  querySelector(selector) {
    for (const child of this.children) {
      if (child.className === selector.slice(1)) return child;
      const match = child.querySelector(selector);
      if (match) return match;
    }
    return null;
  }
}

let elements;
let saves;
let reads;
test.beforeEach(async () => {
  opened = [];
  saves = [];
  reads = 0;
  elements = new Map();
  globalThis.__watchLaterOpened = (item) => opened.push(item.publishedfileid);
  const badges = (node) => [
    ...(node.dataset.installedWorkshopId ? [node] : []), ...node.children.flatMap(badges),
  ];
  globalThis.document = {
    getElementById(id) {
      if (id === "add-to-watch-later-btn") return null;
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    },
    createElement: () => new Element(),
    querySelectorAll: () => [...elements.values()].flatMap(badges),
  };
  workshopDeps.GetWorkshopWatchLaterStorage = async () => {
    reads++;
    return { items: [
      { publishedfileid: "123456", title: "Mod", addedAt: "2026-01-03" },
      { publishedfileid: "234567", title: "Collection", file_type: 2, addedAt: "2026-01-02" },
      { publishedfileid: "345678", title: "Other", addedAt: "2026-01-01" },
    ] };
  };
  workshopDeps.SaveWorkshopWatchLaterStorage = async (storage) => saves.push(storage);
  workshopDeps.showNotification = () => {};
  setWorkshopInstallationState({}, "unknown");
  await initWatchLaterStorage();
});
test.after(() => { delete globalThis.document; delete globalThis.__watchLaterOpened; });

test("watch-later installation updates preserve rows, item order and storage", () => {
  const list = document.getElementById("browser-watch-later-list");
  const rows = [...list.children];
  const badge = rows[0].querySelector(".workshop-installed-badge");
  assert.equal(badge.hidden, true);
  assert.equal(rows[1].querySelector(".workshop-installed-badge"), null);
  const state = {};
  setWorkshopInstallationState(state, "ready", [{ workshopId: "123456" }, { workshopId: "234567" }]);
  assert.equal(badge.hidden, false);
  assert.equal(rows[2].querySelector(".workshop-installed-badge").hidden, true);
  setWorkshopInstallationState(state, "ready", []);
  assert.equal(badge.hidden, true);
  assert.deepEqual(list.children, rows);
  assert.deepEqual(getWatchLaterItems().map((item) => item.publishedfileid), ["123456", "234567", "345678"]);
  assert.equal(reads, 1);
  assert.deepEqual(saves, []);
});

test("installed watch-later rows keep navigation and removal separate from local installation", () => {
  const state = {};
  setWorkshopInstallationState(state, "ready", [{ workshopId: "123456" }]);
  const list = document.getElementById("browser-watch-later-list");
  const row = list.children[0];
  row.listeners.get("click")();
  assert.deepEqual(opened, ["123456"]);
  let stopped = false;
  row.querySelector(".watch-later-remove").listeners.get("click")({ stopPropagation: () => { stopped = true; } });
  assert.equal(stopped, true);
  assert.equal(state.installedWorkshopIds.has("123456"), true);
  assert.deepEqual(getWatchLaterItems().map((item) => item.publishedfileid), ["234567", "345678"]);
  assert.equal(saves.length, 1);
  assert.doesNotMatch(JSON.stringify(saves), /installedWorkshop|已安装/);
});
