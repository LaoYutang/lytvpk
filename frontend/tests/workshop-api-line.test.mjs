import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { setAPILineState } from "../src/js/core/api-line.js";
import { workshopDeps } from "../src/js/features/workshop/deps.js";
import { browserState, resetWorkshopPaging } from "../src/js/features/workshop/state.js";

const listURL = new URL("../src/js/features/workshop/list.js", import.meta.url).href;
const detailURL = new URL("../src/js/features/workshop/detail.js", import.meta.url).href;
const stubs = {
  "./sidebar.js": "export function addFilterIcons(){} export function initBrowserIndicators(){} export function updateBrowserCategoryIndicator(){} export function updateBrowserSortIndicator(){}",
  "./id-jump.js": "export function setupWorkshopIdJump(){}",
  "./watch-later.js": "export function renderWatchLaterDrawer(){} export function setupWatchLaterDrawerListeners(){} export function createWatchLaterItem(x){return x} export function getWatchLaterItems(){return []} export function isInWatchLater(){return false} export function saveWatchLaterItems(){} export function toggleWatchLaterItem(){} export function updateWatchLaterDetailButton(){}",
  "./detail-images.js": "export function getWorkshopPreviewImages(){return []} export function renderThumbnails(){return ''} export function setWorkshopPreviewImages(){}",
};
globalThis.document = { addEventListener() {} };
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if ([listURL, detailURL].includes(context.parentURL) && stubs[specifier]) {
      return { url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { loadWorkshopList } = await import(listURL);
const { openWorkshopDetail } = await import(detailURL);
hooks.deregister();

class Element {
  constructor() {
    this.classes = new Set();
    this.classList = {
      add: (...values) => values.forEach((value) => this.classes.add(value)),
      remove: (...values) => values.forEach((value) => this.classes.delete(value)),
      contains: (value) => this.classes.has(value),
    };
    this.children = [];
    this.listeners = new Map();
    this.dataset = {};
    this.scrollHeight = 1000;
    this.scrollTop = 0;
    this.clientHeight = 200;
  }
  set innerHTML(value) { this.html = value; this.children = []; }
  get innerHTML() { return this.html || ""; }
  set textContent(value) { this.text = value; }
  get textContent() { return (this.text || "") + this.children.map((child) => child.textContent).join(""); }
  replaceChildren(...children) { this.children = children; this.html = ""; this.text = ""; }
  appendChild(child) { this.children.push(child); return child; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return document.getElementById("browser-body"); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  click() { this.listeners.get("click")?.({}); }
}

let elements;
let frames;
test.beforeEach(() => {
  elements = new Map();
  frames = [];
  globalThis.document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    },
    createElement: () => new Element(),
    addEventListener() {},
    querySelectorAll: () => [],
  };
  globalThis.requestAnimationFrame = (callback) => { frames.push(callback); };
  setAPILineState("primary");
  resetWorkshopPaging();
  browserState.loading = false;
  workshopDeps.IsSelectingIP = async () => false;
  workshopDeps.FetchWorkshopList = async () => ({ items: [] });
  element("browser-detail-view").classList.add("hidden");
});
test.after(() => {
  delete globalThis.document;
  delete globalThis.requestAnimationFrame;
});
function element(id) { return document.getElementById(id); }
function item(id, title = id) { return { publishedfileid: id, title, tags: [], description: "" }; }
async function settle() { for (let i = 0; i < 5; i++) await Promise.resolve(); }

test("an old list success and finally cannot replace a new line's pending view", async () => {
  const old = Promise.withResolvers();
  const latest = Promise.withResolvers();
  let requests = 0;
  workshopDeps.FetchWorkshopList = () => ++requests === 1 ? old.promise : latest.promise;
  const first = loadWorkshopList();
  await settle();
  setAPILineState("backup");
  assert.equal(requests, 1, "changing line must not start a list request");
  const second = loadWorkshopList();
  await settle();
  old.resolve({ items: [item("old")] });
  await first;
  assert.deepEqual(browserState.data, []);
  assert.equal(browserState.loading, true);
  assert.equal(element("browser-loading").classList.contains("hidden"), false);
  assert.equal(frames.length, 0);
  latest.resolve({ items: [item("new")] });
  await second;
  assert.deepEqual(browserState.data.map(({ publishedfileid }) => publishedfileid), ["new"]);
  assert.equal(browserState.loading, false);
  setAPILineState("primary");
  frames.forEach((callback) => callback());
  assert.equal(requests, 2, "queued callbacks from an old line cannot automatically load more");
});

test("an old list error is ignored and current errors reveal no address or switch source", async (t) => {
  t.mock.method(console, "error", () => {});
  const old = Promise.withResolvers();
  const latest = Promise.withResolvers();
  let requests = 0;
  workshopDeps.FetchWorkshopList = () => ++requests === 1 ? old.promise : latest.promise;
  const first = loadWorkshopList();
  await settle();
  setAPILineState("backup");
  const second = loadWorkshopList();
  await settle();
  old.reject(new Error("https://private.invalid/old"));
  await first;
  assert.equal(browserState.loadFailed, false);
  assert.equal(browserState.loading, true);
  latest.reject(new Error("https://private.invalid/new"));
  await second;
  assert.equal(browserState.loadFailed, true);
  assert.match(element("browser-grid").textContent, /加载失败/);
  assert.doesNotMatch(element("browser-grid").textContent, /private|https?:/);
  assert.equal(requests, 2);
});

test("changing line clears old IP-selection polling without changing IP selection", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let checks = 0;
  workshopDeps.IsSelectingIP = async () => { checks++; return true; };
  await loadWorkshopList();
  setAPILineState("backup");
  t.mock.timers.tick(2000);
  await settle();
  assert.equal(checks, 1);
  assert.equal(browserState.loading, false);
});

test("a response from an old line cannot replace the latest detail", async () => {
  const old = Promise.withResolvers();
  const latest = Promise.withResolvers();
  let requests = 0;
  workshopDeps.FetchWorkshopDetail = () => ++requests === 1 ? old.promise : latest.promise;
  const first = openWorkshopDetail(item("old"));
  setAPILineState("backup");
  const second = openWorkshopDetail(item("new"));
  latest.resolve(item("new", "Current detail"));
  await second;
  const current = element("browser-detail-view").innerHTML;
  assert.match(current, /Current detail/);
  old.resolve(item("old", "Old detail"));
  await first;
  assert.equal(element("browser-detail-view").innerHTML, current);
  assert.equal(requests, 2);
});

test("old detail failures are ignored while the current failure is generic", async () => {
  const old = Promise.withResolvers();
  const latest = Promise.withResolvers();
  let requests = 0;
  workshopDeps.FetchWorkshopDetail = () => ++requests === 1 ? old.promise : latest.promise;
  const first = openWorkshopDetail(item("old"));
  setAPILineState("backup");
  const second = openWorkshopDetail(item("new"));
  const loading = element("browser-detail-view").innerHTML;
  old.reject(new Error("https://private.invalid/old"));
  await first;
  assert.equal(element("browser-detail-view").innerHTML, loading);
  latest.reject(new Error("https://private.invalid/new"));
  await second;
  assert.match(element("browser-detail-view").innerHTML, /加载详情失败/);
  assert.doesNotMatch(element("browser-detail-view").innerHTML, /private|https?:/);
  assert.equal(requests, 2);
});

test("an old hide animation cannot hide a newly opened detail", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  workshopDeps.FetchWorkshopDetail = async (id) => item(id);
  await openWorkshopDetail(item("first"));
  element("back-to-list-btn").click();
  await openWorkshopDetail(item("second"));
  t.mock.timers.tick(360);
  assert.equal(element("browser-detail-view").classList.contains("hidden"), false);
  assert.match(element("browser-detail-view").innerHTML, /second/);
});

test("list and detail preserve safe rate-limit and timeout guidance", async (t) => {
  t.mock.method(console, "error", () => {});
  workshopDeps.FetchWorkshopList = async () => {
    throw new Error("https://private.invalid/ token=secret 备用线路请求过于频繁（HTTP 429），请至少等待 8 秒后重试 192.0.2.10");
  };
  await loadWorkshopList();
  assert.equal(element("browser-grid").textContent, "备用线路请求过于频繁（HTTP 429），请至少等待8秒后重试。");
  workshopDeps.FetchWorkshopDetail = async () => {
    throw new Error("https://private.invalid/ 主线路请求超时（HTTP 504），请稍后重试 token=secret");
  };
  await openWorkshopDetail(item("timed-out"));
  assert.match(element("browser-detail-view").innerHTML, /主线路请求超时（HTTP 504），请稍后重试。/);
  assert.doesNotMatch(element("browser-detail-view").innerHTML, /private|https?:|secret|token/);
});
