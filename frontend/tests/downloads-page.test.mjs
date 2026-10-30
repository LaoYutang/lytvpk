import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const moduleUrl = new URL("../src/js/features/downloads/downloads-page.js", import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === moduleUrl) {
      const names = specifier === "../../core/ui-shell.js" ? ["getCurrentPage"]
        : specifier === "./task-list.js" ? ["refreshTaskList", "subscribeToDownloadTasks"] : null;
      if (names) {
        const source = names.map((name) =>
          `export const ${name} = (...args) => globalThis.__downloadsPageTest.${name}(...args);`
        ).join("\n");
        return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});
const {
  initDownloadsPage, selectDownloadsTab, getDownloadsTab,
  captureDownloadOrigin, beginDownloadSubmission, notifyDownloadTaskCreated,
  finishDownloadSubmission, cancelDownloadFeedback,
} = await import(moduleUrl);
hooks.deregister();

class Element {
  constructor(tag = "div", id = "") {
    this.tagName = tag;
    this.id = id;
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.className = "";
    this.hidden = false;
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.rect = { left: 20, top: 30, width: 160, height: 42 };
    this.classList = {
      toggle: (name, enabled) => {
        const classes = new Set(this.className.split(" ").filter(Boolean));
        if (enabled) classes.add(name); else classes.delete(name);
        this.className = [...classes].join(" ");
      },
      contains: (name) => this.className.split(" ").includes(name),
    };
  }
  appendChild(node) { node.remove(); this.children.push(node); node.parentElement = this; return node; }
  remove() {
    if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
    this.parentElement = null;
  }
  querySelector(selector) {
    return this.children.find((child) => selector === "svg" ? child.tagName === "svg"
      : selector.startsWith(".") && child.classList.contains(selector.slice(1))) || null;
  }
  querySelectorAll(selector) {
    return selector === "[data-downloads-tab]" ? this.children.filter((child) => child.dataset.downloadsTab) : [];
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  focus() { document.activeElement = this; }
  getBoundingClientRect() { return this.rect; }
  cloneNode() { const copy = new Element(this.tagName); copy.rect = { ...this.rect }; return copy; }
  scrollIntoView() { throw new Error("Task feedback must not scroll panels"); }
  animate(frames, options) {
    if (state.failGhostAnimation && this.className === "download-transfer-badge") throw new Error("animation unavailable");
    const gate = Promise.withResolvers();
    const animation = {
      target: this, frames, options, finished: gate.promise, pending: true, cancelled: false,
      complete() { if (this.pending) { this.pending = false; gate.resolve(); } },
      cancel() {
        this.cancelled = true;
        if (this.pending) { this.pending = false; gate.reject(new Error("cancelled")); }
      },
    };
    state.animations.push(animation);
    return animation;
  }
}

let state;
let elements;
let nav;
let body;
let pageListeners;
let windowListeners;
let taskListener;

test.beforeEach(() => {
  state = { page: "downloads", reducedMotion: false, animations: [], refreshes: 0, failGhostAnimation: false };
  elements = new Map();
  body = new Element("body");
  nav = new Element();
  const indicator = new Element();
  indicator.className = "settings-active-indicator";
  nav.appendChild(indicator);
  for (const name of ["parse", "tasks"]) {
    const button = new Element("button", `downloads-tab-${name}`);
    button.dataset.downloadsTab = name;
    const icon = new Element("svg");
    icon.rect = { left: 32, top: name === "parse" ? 35 : 83, width: 18, height: 18 };
    button.appendChild(icon);
    nav.appendChild(button);
    elements.set(button.id, button);
    const panel = new Element("section", `downloads-panel-${name}`);
    panel.scrollTop = name === "parse" ? 1700 : 300;
    elements.set(panel.id, panel);
  }
  elements.set("workshop-url", new Element("input"));
  const count = new Element("span", "downloads-task-count");
  count.rect = { left: 146, top: 82, width: 22, height: 20 };
  count.textContent = "0";
  elements.set(count.id, count);
  elements.get("downloads-tab-tasks").appendChild(count);
  const content = new Element();
  pageListeners = new Map();
  windowListeners = new Map();
  globalThis.document = {
    body,
    activeElement: elements.get("workshop-url"),
    createElement: (tag) => new Element(tag),
    getElementById: (id) => elements.get(id),
    querySelector: (selector) => selector === ".downloads-tabs" ? nav : selector === ".downloads-content" ? content : null,
    addEventListener: (name, callback) => pageListeners.set(name, callback),
  };
  globalThis.window = {
    matchMedia: (query) => ({ matches: query.includes("prefers-reduced-motion") && state.reducedMotion }),
    addEventListener: (name, callback) => windowListeners.set(name, callback),
  };
  globalThis.requestAnimationFrame = (callback) => { queueMicrotask(callback); return 1; };
  globalThis.__downloadsPageTest = {
    getCurrentPage: () => state.page,
    refreshTaskList: () => { state.refreshes++; return Promise.resolve(); },
    subscribeToDownloadTasks: (listener) => { taskListener = listener; listener([]); return () => {}; },
  };
  selectDownloadsTab("parse");
});

test.afterEach(async () => {
  cancelDownloadFeedback();
  await settle();
  assert.equal(body.children.length, 0, "no floating feedback survives cleanup");
  assert(state.animations.every((animation) => !animation.pending), "no unfinished animation survives cleanup");
});

test.after(() => {
  delete globalThis.__downloadsPageTest;
  delete globalThis.document;
  delete globalThis.window;
  delete globalThis.requestAnimationFrame;
});

async function settle() { for (let index = 0; index < 12; index++) await Promise.resolve(); }
async function completeFeedback() {
  for (let index = 0; index < 8; index++) {
    state.animations.filter((animation) => animation.pending).forEach((animation) => animation.complete());
    await settle();
  }
}
async function completeSubmission(context) {
  for (let index = 0; index < 8 && context.transfer; index++) {
    context.transfer.animations.forEach((animation) => animation.complete());
    await settle();
  }
}
function origin() {
  const button = new Element("button");
  const svg = new Element("svg");
  svg.rect = { left: 800, top: 470, width: 20, height: 20 };
  button.appendChild(svg);
  return captureDownloadOrigin(button);
}
function parserState() {
  return {
    tab: getDownloadsTab(),
    parseHidden: elements.get("downloads-panel-parse").hidden,
    tasksHidden: elements.get("downloads-panel-tasks").hidden,
    scroll: elements.get("downloads-panel-parse").scrollTop,
    focus: document.activeElement,
  };
}

test("a successful batch flies one icon and never selects or scrolls the task panel", async () => {
  const before = parserState();
  const context = beginDownloadSubmission(origin());
  notifyDownloadTaskCreated(context, "task-1");
  notifyDownloadTaskCreated(context, "task-2");
  finishDownloadSubmission(context);
  assert.equal(body.children.length, 1, "one batch has one flying icon");
  assert.deepEqual(parserState(), before);
  await completeFeedback();
  const flight = state.animations.find((animation) => animation.target.className === "download-transfer");
  assert(flight.options.duration >= 700 && flight.options.duration <= 850, "the flight remains readable with the quicker timing");
  assert.equal(flight.options.easing, "linear", "the parabola is not compressed by a global ease-out");
  assert(state.animations.some((animation) => animation.target === elements.get("downloads-tab-tasks")));
  assert.deepEqual(parserState(), before);
  assert.equal(state.refreshes, 0, "visual feedback never opens or fetches the task panel");
  assert.equal(context.transfer, null);
  assert(state.animations.every((animation) => animation.cancelled));
});

test("separate downloads can fly concurrently and finishing one does not cancel the other", async () => {
  const first = beginDownloadSubmission(origin());
  const second = beginDownloadSubmission(origin());
  notifyDownloadTaskCreated(first, "first");
  notifyDownloadTaskCreated(second, "second");
  finishDownloadSubmission(first);
  finishDownloadSubmission(second);
  assert.equal(body.children.length, 2);
  assert.equal(state.animations.length, 2);
  await completeSubmission(first);
  assert.equal(body.children.length, 1, "the other download is still flying");
  assert.equal(second.transfer.cancelled, false);
  await completeFeedback();
  assert.equal(body.children.length, 0);
  assert.equal(getDownloadsTab(), "parse");
});

test("manual tab selection cancels flights and suppresses late successes from the previous visit", async () => {
  const active = beginDownloadSubmission(origin());
  const waiting = beginDownloadSubmission(origin());
  notifyDownloadTaskCreated(active, "accepted");
  selectDownloadsTab("tasks", { focus: true });
  notifyDownloadTaskCreated(waiting, "late");
  await settle();
  assert.equal(body.children.length, 0);
  assert(state.animations.every((animation) => animation.cancelled));
  assert.equal(getDownloadsTab(), "tasks");
  assert.equal(document.activeElement, elements.get("downloads-tab-tasks"));
  assert.equal(active.transfer, null);
  assert.equal(waiting.transfer, null);
  assert.equal(state.refreshes, 1);
  finishDownloadSubmission(active);
  finishDownloadSubmission(waiting);
});

test("reduced motion and absent source icons only flash the tab without switching it", async () => {
  const before = parserState();
  state.reducedMotion = true;
  const reduced = beginDownloadSubmission(origin());
  notifyDownloadTaskCreated(reduced, "reduced");
  finishDownloadSubmission(reduced);
  assert.equal(body.children.length, 0);
  assert.equal(state.animations[0].options.duration, 120);
  await completeFeedback();
  state.reducedMotion = false;
  const noOrigin = beginDownloadSubmission(null);
  notifyDownloadTaskCreated(noOrigin, "without-origin");
  finishDownloadSubmission(noOrigin);
  assert.equal(body.children.length, 0);
  await completeFeedback();
  assert.deepEqual(parserState(), before);
});

test("animation errors restore cleanup and allow a subsequent download", async (t) => {
  const errors = t.mock.method(console, "error", () => {});
  state.failGhostAnimation = true;
  const failed = beginDownloadSubmission(origin());
  notifyDownloadTaskCreated(failed, "failed-animation");
  finishDownloadSubmission(failed);
  await settle();
  assert.equal(body.children.length, 0);
  assert.equal(failed.transfer, null);
  assert.equal(errors.mock.callCount(), 1);
  state.failGhostAnimation = false;
  const next = beginDownloadSubmission(origin());
  notifyDownloadTaskCreated(next, "next");
  finishDownloadSubmission(next);
  assert.equal(body.children.length, 1);
  await completeFeedback();
  assert.equal(getDownloadsTab(), "parse");
});

test("leaving the page and resizing cancel current feedback without late navigation", async () => {
  initDownloadsPage();
  const leaving = beginDownloadSubmission(origin());
  notifyDownloadTaskCreated(leaving, "before-leaving");
  state.page = "settings";
  pageListeners.get("app:page-change")({ detail: { page: "settings" } });
  await settle();
  assert.equal(body.children.length, 0);
  assert.equal(getDownloadsTab(), "parse");
  state.page = "downloads";
  pageListeners.get("app:page-change")({ detail: { page: "downloads" } });
  const resizing = beginDownloadSubmission(origin());
  notifyDownloadTaskCreated(resizing, "before-resize");
  windowListeners.get("resize")();
  await settle();
  assert.equal(body.children.length, 0);
  assert.equal(getDownloadsTab(), "parse");
  const fresh = beginDownloadSubmission(origin());
  notifyDownloadTaskCreated(fresh, "after-resize");
  finishDownloadSubmission(leaving);
  finishDownloadSubmission(resizing);
  finishDownloadSubmission(fresh);
  assert.equal(body.children.length, 1);
  await completeFeedback();
});

test("the total increments on landing and only decreases when records are removed", async () => {
  taskListener(["existing"]);
  const badge = elements.get("downloads-task-count");
  assert.equal(badge.textContent, "1");
  const context = beginDownloadSubmission(origin());
  taskListener(["existing", "new"]);
  assert.equal(badge.textContent, "1", "an early backend event waits for its flying feedback");
  notifyDownloadTaskCreated(context, "new");
  finishDownloadSubmission(context);
  context.transfer.animations.forEach((animation) => animation.complete());
  await settle();
  assert.equal(badge.textContent, "1", "takeoff is not yet an arrival");
  context.transfer.animations.forEach((animation) => animation.complete());
  await settle();
  assert.equal(badge.textContent, "2");
  assert.equal(getDownloadsTab(), "parse");
  await completeFeedback();
  taskListener(["existing", "new"]);
  assert.equal(badge.textContent, "2", "a completed or paused record still contributes to the total");
  taskListener(["existing"]);
  assert.equal(badge.textContent, "1");
  assert.equal(elements.get("downloads-tab-tasks").attributes.get("aria-label"), "下载任务，共 1 个任务");
});
