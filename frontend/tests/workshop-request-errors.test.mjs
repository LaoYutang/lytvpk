import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { getAPILineSnapshot, setAPILineState } from "../src/js/core/api-line.js";
import { workshopDeps } from "../src/js/features/workshop/deps.js";
import { browserState, resetWorkshopPaging } from "../src/js/features/workshop/state.js";

const listURL = new URL("../src/js/features/workshop/list.js", import.meta.url).href;
const detailURL = new URL("../src/js/features/workshop/detail.js", import.meta.url).href;
const ready = [];
const stubs = {
  "./sidebar.js": "export function addFilterIcons(){} export function initBrowserIndicators(){} export function updateBrowserCategoryIndicator(){} export function updateBrowserSortIndicator(){}",
  "./id-jump.js": "export function setupWorkshopIdJump(){}",
  "./watch-later.js": "export function renderWatchLaterDrawer(){} export function setupWatchLaterDrawerListeners(){} export function createWatchLaterItem(x){return x} export function getWatchLaterItems(){return []} export function isInWatchLater(){return false} export function saveWatchLaterItems(){} export function toggleWatchLaterItem(){} export function updateWatchLaterDetailButton(){}",
  "./detail-images.js": "export function getWorkshopPreviewImages(){return []} export function renderThumbnails(){return ''} export function setWorkshopPreviewImages(){}",
};
globalThis.document = { addEventListener(type, callback) { if (type === "DOMContentLoaded") ready.push(callback); } };
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
  constructor(tag = "div") {
    this.tagName = tag;
    this.children = [];
    this.parentElement = null;
    this.classes = new Set();
    this.classList = {
      add: (...values) => values.forEach((value) => this.classes.add(value)),
      remove: (...values) => values.forEach((value) => this.classes.delete(value)),
      contains: (value) => this.classes.has(value),
      toggle: (value, force = !this.classes.has(value)) => {
        if (force) this.classes.add(value);
        else this.classes.delete(value);
      },
    };
    this.listeners = new Map();
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.disabled = false;
    this.scrollHeight = 1000;
    this.scrollTop = 0;
    this.clientHeight = 200;
  }
  set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classes].join(" "); }
  get childNodes() { return this.children; }
  set textContent(value) { this.replaceChildren(); this.text = String(value); }
  get textContent() { return (this.text || this.html?.replace(/<[^>]*>/g, "") || "") + this.children.map((child) => child.textContent).join(""); }
  set innerHTML(value) { this.replaceChildren(); this.html = value; }
  get innerHTML() { return this.html || this.children.map((child) => child.textContent).join(""); }
  get isConnected() { return this === document.body || Boolean(this.parentElement?.isConnected); }
  append(...nodes) { nodes.forEach((node) => this.appendChild(node)); }
  appendChild(node) { node.remove(); node.parentElement = this; this.children.push(node); return node; }
  remove() {
    if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
    this.parentElement = null;
  }
  replaceChildren(...nodes) {
    this.children.forEach((child) => { child.parentElement = null; });
    this.children = [];
    this.text = "";
    this.html = "";
    this.append(...nodes);
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === "class") this.className = value; }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
  }
  async click() {
    if (this.disabled) return;
    await this.dispatch("click");
  }
  async dispatch(type, event = {}) {
    for (const callback of this.listeners.get(type) || []) await callback({ target: this, preventDefault() {}, stopPropagation() {}, ...event });
  }
  matches(selector) {
    if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    return this.tagName === selector;
  }
  querySelectorAll(selector) { return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
}

let elements;
let frames;
let navigations;
let sortItems;
test.beforeEach(() => {
  elements = new Map();
  frames = [];
  navigations = [];
  sortItems = new Map(["relevance", "trend", "recent", "top", "subs"].map((sort) => {
    const node = new Element("li");
    node.dataset.sort = sort;
    return [sort, node];
  }));
  const body = new Element("body");
  globalThis.document = {
    body,
    getElementById(id) {
      if (!elements.has(id)) {
        const node = new Element();
        node.id = id;
        elements.set(id, node);
        body.append(node);
      }
      return elements.get(id);
    },
    createElement: (tag) => new Element(tag),
    createElementNS: (_, tag) => new Element(tag),
    addEventListener() {},
    dispatchEvent(event) { navigations.push(event.type); return true; },
    querySelectorAll: (selector) => selector === "#browser-sort-list .filter-item" ? [...sortItems.values()] : [],
  };
  globalThis.requestAnimationFrame = (callback) => { frames.push(callback); };
  setAPILineState("primary");
  resetWorkshopPaging();
  Object.assign(browserState, { loading: false, query: "", sort: "trend", tags: [], filetype: "0" });
  workshopDeps.IsSelectingIP = async () => false;
  workshopDeps.FetchWorkshopList = async () => ({ items: [] });
  workshopDeps.FetchWorkshopDetail = async (id) => item(id);
  workshopDeps.switchAppPage = (page) => { navigations.push(page); };
  element("browser-body").className = "browser-body";
  element("browser-body").append(element("browser-detail-view"));
  element("browser-detail-view").classList.add("hidden");
  ready.forEach((callback) => callback());
});
test.afterEach(() => { setAPILineState(getAPILineSnapshot().line === "primary" ? "backup" : "primary"); });
test.after(() => { delete globalThis.document; delete globalThis.requestAnimationFrame; });

function element(id) { return document.getElementById(id); }
function item(id, title = id) { return { publishedfileid: id, title, tags: [], description: "" }; }
function errorCard(id = "browser-grid") {
  const card = element(id).querySelector(".workshop-request-error");
  assert.ok(card, "expected the shared request error view");
  return card;
}
function button(card, text) {
  const match = card.querySelectorAll("button").find((candidate) => candidate.textContent.trim() === text);
  assert.ok(match, `expected button ${text}`);
  return match;
}
async function settle() { for (let index = 0; index < 12; index++) await Promise.resolve(); }
function flushFrames() { const callbacks = frames.splice(0); callbacks.forEach((callback) => callback()); }

test("a new search selects visible relevance and clearing it restores browsing trend", async () => {
  const requests = [];
  workshopDeps.FetchWorkshopList = async (opts) => { requests.push(opts); return { items: [item("result")] }; };
  element("browser-search-input").value = "  未花  ";
  await element("browser-search-btn").click();
  await settle();
  assert.equal(requests[0].search_text, "未花");
  assert.equal(requests[0].sort, "relevance");
  assert.equal(sortItems.get("relevance").classList.contains("active"), true);
  assert.equal(sortItems.get("relevance").classList.contains("hidden"), false);
  element("browser-search-input").value = " ";
  await element("browser-search-btn").click();
  await settle();
  assert.equal(browserState.sort, "trend");
  assert.equal(sortItems.get("relevance").classList.contains("hidden"), true);
  assert.equal(sortItems.get("trend").classList.contains("active"), true);
});

for (const sort of ["trend", "recent", "top", "subs"]) {
  test(`search respects explicit ${sort} across keyword changes, paging and clearing`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const requests = [];
    workshopDeps.FetchWorkshopList = async (opts) => { requests.push(opts); return { items: [item(String(requests.length))] }; };
    const input = element("browser-search-input");
    input.value = "未花";
    await element("browser-search-btn").click();
    await settle();
    assert.equal(browserState.sort, "relevance");
    input.value = "海岸";
    await input.dispatch("input");
    await sortItems.get(sort).click();
    await settle();
    t.mock.timers.tick(1000);
    await settle();
    assert.equal(requests.length, 2, "choosing a sort consumes the pending search debounce");
    assert.equal(requests.at(-1).search_text, "海岸");
    assert.equal(requests.at(-1).sort, sort);
    assert.equal(sortItems.get(sort).classList.contains("active"), true);
    input.value = "river";
    await element("browser-search-btn").click();
    await settle();
    assert.equal(requests.at(-1).sort, sort);
    browserState.page = 2;
    await loadWorkshopList();
    assert.equal(requests.at(-1).page, 2);
    assert.equal(requests.at(-1).sort, sort);
    input.value = "";
    await element("browser-search-btn").click();
    await settle();
    assert.equal(browserState.page, 1);
    assert.equal(requests.at(-1).sort, sort);
    assert.equal(requests.at(-1).search_text, "");
    input.value = "new search";
    await element("browser-search-btn").click();
    await settle();
    assert.equal(requests.at(-1).sort, "relevance");
    await element("browser-reset-btn").click();
    await settle();
    assert.equal(browserState.sort, "trend");
    assert.equal(browserState.query, "");
  });
}

for (const staleFailure of [false, true]) {
  test(`changing sort supersedes a pending page and ignores stale ${staleFailure ? "failure" : "success"}`, async () => {
    const old = Promise.withResolvers();
    const latest = Promise.withResolvers();
    element("browser-search-input").value = "未花";
    browserState.query = "未花";
    browserState.sort = "relevance";
    browserState.page = 2;
    workshopDeps.FetchWorkshopList = () => old.promise;
    const request = loadWorkshopList();
    await settle();
    workshopDeps.FetchWorkshopList = () => latest.promise;
    await sortItems.get("subs").click();
    await settle();
    assert.equal(browserState.page, 1);
    assert.equal(browserState.sort, "subs");
    if (staleFailure) old.reject(new Error("stale error"));
    else old.resolve({ items: [item("stale")] });
    await request;
    assert.equal(browserState.loading, true);
    assert.equal(element("browser-grid").children.length, 0);
    latest.resolve({ items: [item("latest")] });
    await settle();
    assert.deepEqual(browserState.data.map((entry) => entry.publishedfileid), ["latest"]);
    assert.equal(element("browser-loading").classList.contains("hidden"), true);
  });
}

test("initial list failures show shared error details and retry only after a user query", async () => {
  const pages = [];
  workshopDeps.FetchWorkshopList = async ({ page }) => {
    pages.push(page);
    if (pages.length === 1) throw new Error("主线路请求失败（HTTP 500），请稍后重试");
    return { items: [] };
  };
  await loadWorkshopList();
  const card = errorCard();
  assert.match(card.textContent, /HTTP 500/);
  assert.match(card.textContent, /查询/);
  assert.match(card.textContent, /设置/);
  assert.equal(browserState.loadFailed, true);
  assert.equal(element("browser-load-more").classList.contains("hidden"), true);
  flushFrames();
  await settle();
  assert.deepEqual(pages, [1]);
  await button(card, "重新查询").click();
  await settle();
  assert.deepEqual(pages, [1, 1]);
  assert.equal(browserState.loadFailed, false);
  assert.equal(element("browser-grid").querySelector(".workshop-request-error"), null);
});

test("list settings action only navigates and stale error actions cannot issue requests", async () => {
  let requests = 0;
  workshopDeps.FetchWorkshopList = async () => { requests++; throw new Error("主线路请求超时，请稍后重试"); };
  await loadWorkshopList();
  const card = errorCard();
  const retry = button(card, "重新查询");
  const settings = card.querySelectorAll("button").find((candidate) => /设置/.test(candidate.textContent));
  assert.ok(settings);
  await settings.click();
  assert.deepEqual(navigations, ["workshop:open-line-settings"]);
  assert.equal(getAPILineSnapshot().line, "primary");
  assert.equal(requests, 1);
  setAPILineState("backup");
  await retry.click();
  assert.equal(requests, 1);
  assert.deepEqual(navigations, ["workshop:open-line-settings"]);
});

test("manual query or Enter consumes a pending search debounce and does not retry after failure", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let requests = 0;
  workshopDeps.FetchWorkshopList = async () => { requests++; throw new Error("主线路请求失败（HTTP 500），请稍后重试"); };
  const search = element("browser-search-input");
  search.value = "coast";
  await search.dispatch("input");
  await element("browser-search-btn").click();
  await settle();
  assert.equal(requests, 1);
  const first = errorCard();
  t.mock.timers.tick(800);
  await settle();
  assert.equal(requests, 1);
  assert.equal(errorCard(), first);
  search.value = "river";
  await search.dispatch("input");
  await search.dispatch("keydown", { key: "Enter" });
  await settle();
  await search.dispatch("keyup", { key: "Enter" });
  await settle();
  assert.equal(requests, 2, "one Enter press must issue one query");
  const second = errorCard();
  t.mock.timers.tick(800);
  await settle();
  assert.equal(requests, 2);
  assert.equal(errorCard(), second);
});

test("pagination errors retain cards and retry the failed page without skipping or auto loading", async () => {
  const pages = [];
  const pending = Promise.withResolvers();
  workshopDeps.FetchWorkshopList = ({ page }) => {
    pages.push(page);
    if (pages.length === 1) return Promise.resolve({ items: [item("first")] });
    if (pages.length === 2) return Promise.reject(new Error("备用线路暂时不可用（HTTP 503），请稍后重试"));
    return pending.promise;
  };
  await loadWorkshopList();
  const existing = element("browser-grid").querySelector(".workshop-card");
  browserState.page = 2;
  await loadWorkshopList();
  const card = errorCard();
  assert.equal(element("browser-grid").querySelector(".workshop-card"), existing);
  assert.equal(element("browser-load-more").classList.contains("hidden"), true);
  assert.equal(browserState.page, 2);
  assert.deepEqual(browserState.data.map((entry) => entry.publishedfileid), ["first"]);
  assert.match(card.textContent, /本页/);
  element("browser-scroll-container").scrollHeight = 200;
  flushFrames();
  await settle();
  assert.deepEqual(pages, [1, 2]);
  element("browser-scroll-container").scrollHeight = 1000;
  const retry = button(card, "重新查询");
  const retrying = retry.click();
  await element("browser-load-more").click();
  await settle();
  assert.equal(element("browser-grid").querySelector(".workshop-request-error"), card, "keep the error's space until retry completes");
  assert.deepEqual(pages, [1, 2, 2]);
  assert.equal(browserState.page, 2);
  pending.resolve({ items: [item("second")] });
  await retrying;
  await settle();
  assert.equal(element("browser-grid").querySelector(".workshop-request-error"), null);
  assert.equal(element("browser-grid").querySelectorAll(".workshop-card").length, 2);
  assert.deepEqual(browserState.data.map((entry) => entry.publishedfileid), ["first", "second"]);
});

test("initial loading and successive append requests use distinct modes without replacing cards or scrolling", async () => {
  let pending = Promise.withResolvers();
  workshopDeps.FetchWorkshopList = () => pending.promise;
  element("browser-scroll-container").scrollTop = 150;
  const first = loadWorkshopList();
  await settle();
  assert.equal(element("browser-loading").dataset.loadingMode, "initial");
  assert.equal(element("browser-scroll-container").scrollTop, 0);
  pending.resolve({ items: [item("first")] });
  await first;
  const existing = element("browser-grid").querySelector(".workshop-card");
  element("browser-scroll-container").scrollTop = 250;

  for (const page of [2, 3]) {
    pending = Promise.withResolvers();
    browserState.page = page;
    const request = loadWorkshopList();
    await settle();
    assert.equal(element("browser-loading").dataset.loadingMode, "more");
    assert.equal(element("browser-loading").classList.contains("hidden"), false);
    assert.equal(element("browser-grid").querySelector(".workshop-card"), existing);
    assert.equal(element("browser-scroll-container").scrollTop, 250);
    pending.resolve({ items: [item(String(page))] });
    await request;
    assert.equal(element("browser-grid").querySelectorAll(".workshop-card").length, page);
    assert.equal(element("browser-scroll-container").scrollTop, 250);
    assert.equal(element("browser-loading").classList.contains("hidden"), true);
  }
});

for (const page of [1, 2]) {
  test(`page ${page} keeps its loading mode and blocks duplicate paging while IP selection is pending`, async (t) => {
    t.mock.timers.enable({ apis: ["setInterval"] });
    if (page === 2) await loadWorkshopList();
    const existing = element("browser-grid").children.slice();
    const pending = Promise.withResolvers();
    let selecting = true;
    const pages = [];
    workshopDeps.IsSelectingIP = async () => selecting;
    workshopDeps.FetchWorkshopList = (opts) => { pages.push(opts.page); return pending.promise; };
    browserState.page = page;
    element("browser-scroll-container").scrollTop = page === 2 ? 450 : 0;
    await loadWorkshopList();
    assert.equal(browserState.loading, true);
    assert.equal(element("browser-loading").dataset.loadingMode, page > 1 ? "more" : "initial");
    assert.match(element("browser-loading").textContent, /正在优选/);
    await element("browser-scroll-container").dispatch("scroll");
    await element("browser-load-more").click();
    assert.equal(browserState.page, page);
    assert.deepEqual(pages, []);

    selecting = false;
    t.mock.timers.tick(1000);
    await settle();
    assert.deepEqual(pages, [page]);
    assert.equal(browserState.loading, true);
    assert.equal(element("browser-loading").dataset.loadingMode, page > 1 ? "more" : "initial");
    if (page === 2) {
      assert.deepEqual(element("browser-grid").children, existing);
      assert.equal(element("browser-scroll-container").scrollTop, 450);
      assert.match(element("browser-loading").textContent, /正在加载更多/);
    }
    pending.resolve({ items: [item("resolved")] });
    await settle();
    assert.equal(browserState.loading, false);
    assert.equal(element("browser-loading").classList.contains("hidden"), true);
  });
}

test("a failed IP wait on an append page unlocks a footer-mode retry without discarding cards", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  workshopDeps.FetchWorkshopList = async () => ({ items: [item("first")] });
  await loadWorkshopList();
  const existing = element("browser-grid").querySelector(".workshop-card");
  let checks = 0;
  workshopDeps.IsSelectingIP = async () => {
    if (++checks === 1) return true;
    throw new Error("metadata unavailable");
  };
  browserState.page = 2;
  await loadWorkshopList();
  t.mock.timers.tick(1000);
  await settle();
  assert.equal(browserState.loading, false);
  assert.equal(element("browser-loading").classList.contains("hidden"), true);
  assert.equal(element("browser-grid").querySelector(".workshop-card"), existing);
  const pending = Promise.withResolvers();
  workshopDeps.IsSelectingIP = async () => false;
  workshopDeps.FetchWorkshopList = () => pending.promise;
  const retry = button(errorCard(), "重新查询").click();
  await settle();
  assert.equal(element("browser-loading").dataset.loadingMode, "more");
  assert.equal(element("browser-loading").classList.contains("hidden"), false);
  pending.resolve({ items: [item("second")] });
  await retry;
  assert.equal(element("browser-grid").querySelector(".workshop-card"), existing);
});

for (const change of ["search", "type"]) {
  test(`replacing an active append request with a new ${change} ignores the old result and cleanup`, async () => {
    workshopDeps.FetchWorkshopList = async () => ({ items: [item("first")] });
    await loadWorkshopList();
    const old = Promise.withResolvers();
    const latest = Promise.withResolvers();
    workshopDeps.FetchWorkshopList = ({ page }) => page === 2 ? old.promise : latest.promise;
    browserState.page = 2;
    const append = loadWorkshopList();
    await settle();
    assert.equal(element("browser-loading").dataset.loadingMode, "more");
    if (change === "search") {
      element("browser-search-input").value = "new query";
      await element("browser-search-btn").click();
    } else {
      browserState.filetype = "1";
      resetWorkshopPaging();
      loadWorkshopList();
    }
    await settle();
    assert.equal(element("browser-loading").dataset.loadingMode, "initial");
    assert.equal(element("browser-grid").querySelectorAll(".workshop-card").length, 0);
    if (change === "search") old.resolve({ items: [item("stale")] });
    else old.reject(new Error("stale failure"));
    await append;
    assert.equal(browserState.loading, true);
    assert.equal(element("browser-loading").classList.contains("hidden"), false);
    assert.equal(element("browser-loading").dataset.loadingMode, "initial");
    assert.equal(element("browser-grid").children.length, 0);
    latest.resolve({ items: [item("latest")] });
    await settle();
    assert.deepEqual(browserState.data.map((entry) => entry.publishedfileid), ["latest"]);
    assert.equal(element("browser-loading").classList.contains("hidden"), true);
  });
}

test("a replaced append's delayed readiness result cannot reopen an IP wait over a new query", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  workshopDeps.FetchWorkshopList = async () => ({ items: [item("first")] });
  await loadWorkshopList();
  const readiness = Promise.withResolvers();
  const latest = Promise.withResolvers();
  workshopDeps.IsSelectingIP = () => readiness.promise;
  browserState.page = 2;
  const append = loadWorkshopList();
  workshopDeps.IsSelectingIP = async () => false;
  workshopDeps.FetchWorkshopList = () => latest.promise;
  element("browser-search-input").value = "new query";
  await element("browser-search-btn").click();
  await settle();
  readiness.resolve(true);
  await append;
  t.mock.timers.tick(2000);
  await settle();
  assert.equal(element("browser-loading").dataset.loadingMode, "initial");
  assert.doesNotMatch(element("browser-loading").textContent, /正在优选/);
  assert.equal(browserState.loading, true);
  latest.resolve({ items: [item("latest")] });
  await settle();
  assert.deepEqual(browserState.data.map((entry) => entry.publishedfileid), ["latest"]);
});

test("list pagination accepts cached 20-item pages followed by 50 items, retries and a short final page", async () => {
  const pages = [];
  const firstItems = Array.from({ length: 20 }, (_, index) => item(String(index + 1)));
  const secondItems = Array.from({ length: 50 }, (_, index) => item(String(index + 51)));
  const lastItems = Array.from({ length: 7 }, (_, index) => item(String(index + 101)));
  let failSecondPage = true;
  workshopDeps.FetchWorkshopList = async ({ page, filetype }) => {
    pages.push(page);
    assert.equal(filetype, "0");
    if (page === 2 && failSecondPage) {
      failSecondPage = false;
      throw new Error("主线路请求失败（HTTP 503），请稍后重试");
    }
    return { items: page === 1 ? firstItems : page === 2 ? secondItems : page === 3 ? lastItems : [] };
  };
  await loadWorkshopList();
  const existing = element("browser-grid").querySelector(".workshop-card");
  assert.equal(browserState.data.length, 20);
  assert.equal(browserState.hasMore, true, "a cached 20-item response must not end pagination");
  browserState.page = 2;
  await loadWorkshopList();
  assert.equal(browserState.data.length, 20);
  await button(errorCard(), "重新查询").click();
  await settle();
  assert.equal(browserState.data.length, 70);
  assert.equal(browserState.hasMore, true);
  assert.equal(element("browser-grid").querySelector(".workshop-card"), existing);
  assert.equal(element("browser-grid").querySelectorAll(".workshop-card").length, 70);
  assert.equal(browserState.data[20].publishedfileid, "51", "the client appends the server response without compensating for mixed-size page gaps");
  browserState.page = 3;
  await loadWorkshopList();
  assert.equal(browserState.data.length, 77);
  assert.equal(browserState.hasMore, true, "only an empty page ends pagination");
  browserState.page = 4;
  await loadWorkshopList();
  assert.equal(browserState.hasMore, false);
  assert.equal(browserState.data.length, 77);
  assert.deepEqual(browserState.data.map((entry) => entry.publishedfileid), [...firstItems, ...secondItems, ...lastItems].map((entry) => entry.publishedfileid));
  assert.deepEqual(pages, [1, 2, 2, 3, 4]);
});

test("IP-selection metadata failures show a retryable error without sending a list request", async () => {
  let requests = 0;
  workshopDeps.IsSelectingIP = async () => { throw new Error("metadata unavailable"); };
  workshopDeps.FetchWorkshopList = async () => { requests++; return { items: [] }; };
  await loadWorkshopList();
  const card = errorCard();
  assert.match(card.textContent, /网络优选状态/);
  assert.equal(element("browser-load-more").classList.contains("hidden"), true);
  assert.equal(browserState.loading, false);
  assert.equal(requests, 0);
  workshopDeps.IsSelectingIP = async () => false;
  await button(card, "重新查询").click();
  await settle();
  assert.equal(requests, 1);
});

test("IP-selection polling failures stop polling and display the shared failure view", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let checks = 0;
  workshopDeps.IsSelectingIP = async () => {
    if (++checks === 1) return true;
    throw new Error("metadata unavailable");
  };
  await loadWorkshopList();
  t.mock.timers.tick(1000);
  await settle();
  assert.match(errorCard().textContent, /网络优选状态/);
  assert.equal(element("browser-load-more").classList.contains("hidden"), true);
  assert.equal(element("browser-loading").classList.contains("hidden"), true);
  t.mock.timers.tick(5000);
  await settle();
  assert.equal(checks, 2);
});

test("detail errors retain safe specifics, manual retry and navigation without changing line", async () => {
  let requests = 0;
  workshopDeps.FetchWorkshopDetail = async (id) => {
    requests++;
    assert.equal(id, "123456");
    throw new Error("https://private.invalid/ 主线路请求过于频繁（HTTP 429），请至少等待 8 秒后重试 token=secret");
  };
  await openWorkshopDetail(item("123456"));
  const card = errorCard("browser-detail-view");
  assert.equal(element("browser-detail-view").children.length, 1);
  assert.match(card.textContent, /HTTP 429/);
  assert.match(card.textContent, /8秒/);
  assert.doesNotMatch(card.textContent, /private|https?:|token|secret/);
  assert.match(card.textContent, /重新查询.*详情/);
  assert.equal(requests, 1);
  const settings = card.querySelectorAll("button").find((candidate) => /设置/.test(candidate.textContent));
  await settings.click();
  assert.deepEqual(navigations, ["workshop:open-line-settings"]);
  assert.equal(getAPILineSnapshot().line, "primary");
  await button(card, "重新查询").click();
  await settle();
  assert.equal(requests, 2);
  assert.ok(errorCard("browser-detail-view"));
});

test("failed child detail retries retain collection return and invalidate detached error actions", async () => {
  const ids = [];
  workshopDeps.FetchWorkshopDetail = async (id) => { ids.push(id); throw new Error("主线路请求超时，请稍后重试"); };
  const parent = { ...item("parent", "Parent collection"), file_type: 2, child_items: [] };
  const parentScroll = new Element();
  document.body.append(parentScroll);
  const detailView = element("browser-detail-view");
  const querySelector = detailView.querySelector.bind(detailView);
  detailView.querySelector = (selector) => selector === ".detail-scroll-content" ? parentScroll : querySelector(selector);
  await openWorkshopDetail(item("child"), { parentDetail: parent, parentScrollTop: 1842 });
  await button(errorCard("browser-detail-view"), "重新查询").click();
  await settle();
  assert.deepEqual(ids, ["child", "child"]);
  const card = errorCard("browser-detail-view");
  await button(card, "返回合集").click();
  assert.match(element("browser-detail-view").innerHTML, /Parent collection/);
  assert.equal(parentScroll.scrollTop, 0);
  frames.shift()();
  assert.equal(parentScroll.scrollTop, 1842);
  await button(card, "重新查询").click();
  assert.deepEqual(ids, ["child", "child"]);
});

test("root detail failure returns to list and cannot retry after leaving", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let requests = 0;
  workshopDeps.FetchWorkshopDetail = async () => { requests++; throw new Error("主线路请求超时，请稍后重试"); };
  await openWorkshopDetail(item("root"));
  const card = errorCard("browser-detail-view");
  await button(card, "返回列表").click();
  t.mock.timers.tick(360);
  assert.equal(element("browser-detail-view").classList.contains("hidden"), true);
  await button(card, "重新查询").click();
  assert.equal(requests, 1);
});

test("a late detail error cannot replace a newer failure view or activate an old line action", async () => {
  const old = Promise.withResolvers();
  workshopDeps.FetchWorkshopDetail = (id) => id === "old" ? old.promise : Promise.reject(new Error("主线路请求失败（HTTP 404），请稍后重试"));
  const first = openWorkshopDetail(item("old"));
  await openWorkshopDetail(item("new"));
  const current = errorCard("browser-detail-view");
  old.reject(new Error("obsolete detail error"));
  await first;
  assert.equal(errorCard("browser-detail-view"), current);
  setAPILineState("backup");
  await button(current, "重新查询").click();
  assert.equal(element("browser-detail-view").children.length, 0);
});
