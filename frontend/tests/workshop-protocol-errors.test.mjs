import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { setAPILineState } from "../src/js/core/api-line.js";
import { workshopDeps } from "../src/js/features/workshop/deps.js";

class Element {
  constructor(tag = "div") {
    this.tagName = tag;
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.connected = true;
    const classes = new Set();
    this.classList = {
      add: (...values) => values.forEach((value) => classes.add(value)),
      remove: (...values) => values.forEach((value) => classes.delete(value)),
      contains: (value) => classes.has(value),
    };
  }
  get isConnected() { return this.connected && (!this.parent || this.parent.isConnected); }
  get childNodes() { return this.children; }
  set textContent(value) { this.text = String(value); this.replaceChildren(); }
  get textContent() { return (this.text || "") + this.children.map((child) => child.textContent).join(""); }
  set innerHTML(value) { this.html = value; this.text = ""; this.replaceChildren(); }
  get innerHTML() { return this.html || ""; }
  append(...nodes) { nodes.forEach((node) => { node.parent = this; this.children.push(node); }); }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) {
    this.children.forEach((child) => { child.connected = false; });
    this.children = [];
    this.append(...nodes);
  }
  remove() {
    this.connected = false;
    if (this.parent) this.parent.children = this.parent.children.filter((node) => node !== this);
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  click() { return this.listeners.get("click")?.({ currentTarget: this, preventDefault() {} }); }
  closest() { return document.getElementById("browser-body"); }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [
      ...(selector === child.tagName || selector === `#${child.id}` ||
          selector.startsWith(".") && (child.className || "").split(" ").includes(selector.slice(1)) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

let elements = new Map();
const documentListeners = new Map();
globalThis.document = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  },
  createElement: (tag) => new Element(tag),
  createTextNode: (text) => Object.assign(new Element("#text"), { textContent: text }),
  addEventListener(type, listener) { documentListeners.set(type, listener); },
};
let page = "mods";
const protocolURL = new URL("../src/js/features/workshop/protocol.js", import.meta.url).href;
const detailURL = new URL("../src/js/features/workshop/detail.js", import.meta.url).href;
const stubs = {
  "./watch-later.js": "export function createWatchLaterItem(x){return x} export function getWatchLaterItems(){return []} export function isInWatchLater(){return false} export function saveWatchLaterItems(){} export function toggleWatchLaterItem(){} export function updateWatchLaterDetailButton(){}",
  "./detail-images.js": "export function getWorkshopPreviewImages(){return []} export function renderThumbnails(){return ''} export function setWorkshopPreviewImages(){}",
};
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    let source;
    if (context.parentURL === protocolURL && specifier === "./list.js") {
      source = "export function openBrowser(){globalThis.__workshopProtocol.openBrowser()}";
    } else if (context.parentURL === protocolURL && specifier === "../../core/ui-shell.js") {
      source = "export function getCurrentPage(){return globalThis.__workshopProtocol.getCurrentPage()}";
    } else if (context.parentURL === detailURL) source = stubs[specifier];
    if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const { handleProtocolWorkshop, handleProtocolParse } = await import(protocolURL);
hooks.deregister();

let requests;
let notifications;
let errors;
let parsed;
let selectionCallback;
let selectionCleanup;
test.beforeEach((t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  elements = new Map();
  page = "mods";
  requests = [];
  notifications = [];
  errors = [];
  parsed = [];
  selectionCallback = null;
  selectionCleanup = 0;
  globalThis.__workshopProtocol = {
    getCurrentPage: () => page,
    openBrowser() { page = "workshop"; },
  };
  setAPILineState("primary");
  document.getElementById("file-detail-modal").classList.add("hidden");
  Object.assign(workshopDeps, {
    closeModal() {},
    showNotification: (message) => notifications.push(message),
    showError: (message) => errors.push(message),
    openWorkshopParse: (id) => parsed.push(id),
    IsSelectingIP: async () => false,
    EventsOn(event, listener) {
      assert.equal(event, "ip_selection_end");
      selectionCallback = listener;
      return () => { selectionCleanup++; selectionCallback = null; };
    },
    FetchWorkshopDetail: async (id) => {
      requests.push(id);
      throw new Error("https://private.invalid/ token=secret 备用线路请求超时（HTTP 504），请稍后重试 192.0.2.10");
    },
    switchAppPage(next) { leavePage(next); },
  });
});
test.afterEach(() => leavePage("mods"));
test.after(() => {
  delete globalThis.document;
  delete globalThis.__workshopProtocol;
});

function leavePage(next) {
  page = next;
  documentListeners.get("app:page-change")?.({ detail: { page: next } });
}
function view() { return document.getElementById("browser-detail-view"); }
async function settle() { for (let index = 0; index < 8; index++) await Promise.resolve(); }
async function finishLayout(t, pending) {
  await settle();
  t.mock.timers.tick(500);
  await pending;
}

test("a protocol detail failure performs one real request and delegates all feedback to the detail card", async (t) => {
  const pending = handleProtocolWorkshop("101001");
  await finishLayout(t, pending);
  assert.deepEqual(requests, ["101001"]);
  assert.match(view().textContent, /加载详情失败/);
  assert.match(view().textContent, /重新查询/);
  assert.doesNotMatch(view().textContent + notifications.join(" ") + errors.join(" "), /private|https?:|token|secret|192\.0/);
  assert.deepEqual(errors, [], "protocol must not emit a second raw-error toast");
  t.mock.timers.tick(30_000);
  await settle();
  assert.deepEqual(requests, ["101001"], "a failed request must not restart itself");
  const retry = view().querySelector(".workshop-request-error__retry");
  assert.equal(retry.textContent, "重新查询");
  retry.click();
  await settle();
  assert.deepEqual(requests, ["101001", "101001"], "only the user's detail retry issues the next query");
});

test("a readiness-check failure still delegates one request without leaking its error", async (t) => {
  workshopDeps.IsSelectingIP = async () => { throw new Error("https://private.invalid/readiness token=secret"); };
  await finishLayout(t, handleProtocolWorkshop("101002"));
  assert.deepEqual(requests, ["101002"]);
  assert.match(view().textContent, /加载详情失败/);
  assert.doesNotMatch(view().textContent + notifications.join(" ") + errors.join(" "), /private|https?:|token|secret/);
});

test("waiting for IP selection preserves the protocol flow and cleans up its event listener", async (t) => {
  workshopDeps.IsSelectingIP = async () => true;
  const pending = handleProtocolWorkshop("101003");
  await settle();
  t.mock.timers.tick(500);
  assert.deepEqual(requests, []);
  assert.match(notifications.join(" "), /等待IP优选/);
  selectionCallback();
  await finishLayout(t, pending);
  assert.deepEqual(requests, ["101003"]);
  assert.equal(selectionCleanup, 1);
});

test("the bounded IP wait continues once after thirty seconds", async (t) => {
  workshopDeps.IsSelectingIP = async () => true;
  const pending = handleProtocolWorkshop("101004");
  await settle();
  t.mock.timers.tick(30_000);
  await finishLayout(t, pending);
  assert.deepEqual(requests, ["101004"]);
  assert.equal(selectionCleanup, 1);
});

test("changing line while readiness is pending prevents any delayed detail request", async (t) => {
  const ready = Promise.withResolvers();
  workshopDeps.IsSelectingIP = () => ready.promise;
  const pending = handleProtocolWorkshop("101005");
  setAPILineState("backup");
  setAPILineState("primary");
  ready.resolve(false);
  await pending;
  t.mock.timers.tick(31_000);
  await settle();
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
});

test("changing line cancels an active IP wait and its late event cannot open a detail", async (t) => {
  workshopDeps.IsSelectingIP = async () => true;
  const pending = handleProtocolWorkshop("101006");
  await settle();
  const lateEvent = selectionCallback;
  setAPILineState("backup");
  await pending;
  lateEvent();
  t.mock.timers.tick(31_000);
  await settle();
  assert.deepEqual(requests, []);
  assert.equal(selectionCleanup, 1);
});

test("leaving the workshop page cancels a pending layout timer", async (t) => {
  const pending = handleProtocolWorkshop("101007");
  await settle();
  leavePage("mods");
  await pending;
  t.mock.timers.tick(31_000);
  await settle();
  assert.deepEqual(requests, []);
});

test("a newer protocol request or parse action invalidates an older delayed open", async (t) => {
  const old = handleProtocolWorkshop("101008");
  const latest = handleProtocolWorkshop("101009");
  await finishLayout(t, latest);
  await old;
  assert.deepEqual(requests, ["101009"]);
  const delayed = handleProtocolWorkshop("101010");
  await settle();
  await handleProtocolParse("101011");
  await delayed;
  t.mock.timers.tick(500);
  await settle();
  assert.deepEqual(requests, ["101009"]);
  assert.deepEqual(parsed, ["101011"]);
});
