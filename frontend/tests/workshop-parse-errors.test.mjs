import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { getAPILineSnapshot, setAPILineState } from "../src/js/core/api-line.js";

const modalURL = new URL("../src/js/features/downloads/workshop-modal.js", import.meta.url).href;
const imports = {
  "../../core/ui-shell.js": ["switchAppPage"],
  "../../core/toast.js": ["showError", "showNotification", "showInfo"],
  "../../core/config.js": ["getConfig"],
  "../../core/utils.js": ["escapeHtml"],
  "../workshop/request-error.js": ["createWorkshopRequestError"],
  "./task-list.js": ["refreshTaskList"],
  "./workshop-history.js": ["closeWorkshopHistory", "recordWorkshopHistory"],
  "./downloads-page.js": [
    "selectDownloadsTab", "captureDownloadOrigin", "beginDownloadSubmission",
    "notifyDownloadTaskCreated", "finishDownloadSubmission", "cancelDownloadFeedback",
  ],
  "../../../../wailsjs/go/app/App": ["GetWorkshopDetailsGrouped", "StartDownloadTask", "IsSelectingIP"],
};
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === modalURL && imports[specifier]) {
      const source = imports[specifier].map((name) =>
        `export const ${name} = (...args) => globalThis.__workshopParseErrors.${name}(...args);`
      ).join("\n");
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { checkWorkshopUrl, openWorkshopParse, closeWorkshopModal, applyWorkshopGroups } = await import(modalURL);
hooks.deregister();

class Element {
  constructor() {
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
    };
    this.childNodes = [];
    this.nodes = new Map();
    this.listeners = new Map();
    this.attributes = new Map();
    this.dataset = {};
    this.value = "";
    this.disabled = false;
  }
  set innerHTML(value) { this.html = value; this.childNodes = []; }
  get innerHTML() { return this.html || ""; }
  set textContent(value) { this.text = value; this.childNodes = []; }
  get textContent() { return this.text || this.childNodes.map((node) => node.textContent || "").join(""); }
  replaceChildren(...nodes) { this.childNodes = nodes; this.text = ""; }
  appendChild(node) { this.childNodes.push(node); return node; }
  querySelector(selector) {
    if (!this.nodes.has(selector)) this.nodes.set(selector, new Element());
    return this.nodes.get(selector);
  }
  querySelectorAll() { return []; }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  dispatchEvent(event) { this.listeners.get(event.type)?.({ currentTarget: this, target: this }); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  focus() {}
}

let elements;
let calls;
let fixtureSequence = 0;
const element = (id) => document.getElementById(id);

test.beforeEach(() => {
  elements = new Map();
  globalThis.document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    },
    createElement: () => new Element(),
    createTextNode: (text) => ({ textContent: text }),
  };
  calls = { errors: [], requests: [], pages: [], cards: [], history: [] };
  globalThis.__workshopParseErrors = {
    switchAppPage: (page) => calls.pages.push(page),
    showError: (message) => calls.errors.push(message),
    showNotification() {},
    showInfo() {},
    getConfig: () => ({ workshopPreferredIP: false }),
    escapeHtml: (value) => String(value),
    refreshTaskList() {},
    closeWorkshopHistory() {},
    recordWorkshopHistory: (groups) => calls.history.push(groups),
    selectDownloadsTab() {},
    captureDownloadOrigin() {},
    beginDownloadSubmission() {},
    notifyDownloadTaskCreated() {},
    finishDownloadSubmission() {},
    cancelDownloadFeedback() {},
    GetWorkshopDetailsGrouped: async (input) => { calls.requests.push(input); throw new Error("request failed"); },
    StartDownloadTask: async () => "unused",
    IsSelectingIP: async () => false,
    // Exercise the modal's lifecycle and callbacks independently of the shared
    // component's formatting tests; the real component owns safe error text.
    createWorkshopRequestError: (options) => {
      const node = new Element();
      node.className = "workshop-request-error";
      calls.cards.push({ node, options });
      return node;
    },
  };
  setAPILineState("primary");
  applyWorkshopGroups([]);
  calls.errors.length = 0;
  element("check-workshop-btn").replaceChildren(document.createTextNode("解析"));
  element("workshop-url").value = String(910_000 + ++fixtureSequence);
});

test.after(() => {
  delete globalThis.__workshopParseErrors;
  delete globalThis.document;
});

function group(id) {
  const item = {
    publishedfileid: id, result: 1, title: "Parsed file", filename: "file.vpk",
    file_url: "https://cdn.invalid/file.vpk", file_size: "100", preview_url: "",
  };
  return { root_id: id, main: item, items: [item] };
}

test("request failure persists in the result area and preserves the original input and parse button", async () => {
  const original = element("workshop-url").value;
  const failure = new Error("net::ERR_CONNECTION_RESET https://private.invalid/parse");
  globalThis.__workshopParseErrors.GetWorkshopDetailsGrouped = async (input) => {
    calls.requests.push(input);
    throw failure;
  };
  await checkWorkshopUrl();
  assert.equal(calls.cards.length, 1);
  const { node, options } = calls.cards[0];
  assert.deepEqual(element("workshop-result").childNodes, [node]);
  assert.equal(element("workshop-result").classList.contains("hidden"), false);
  assert.equal(options.title, "解析失败");
  assert.equal(options.error, failure);
  assert.equal(options.fallback, "解析失败，请稍后重试。");
  assert.equal(options.retryLabel, "重新解析");
  assert.equal(options.retryHint, "可以点击“解析”再次尝试，或在设置中切换线路后重试。");
  assert.equal(options.line, "primary");
  assert.equal(options.compact, true);
  assert.deepEqual(calls.errors, [], "a short toast must not replace the persistent request error");
  assert.equal(element("workshop-url").value, original);
  assert.equal(element("check-workshop-btn").disabled, false);
  assert.equal(element("check-workshop-btn").textContent, "解析");
  assert.deepEqual(calls.requests, [original]);
});

test("retry is user triggered and replaces the error with the next parse result", async () => {
  await checkWorkshopUrl();
  const pending = Promise.withResolvers();
  const original = element("workshop-url").value;
  globalThis.__workshopParseErrors.GetWorkshopDetailsGrouped = (input) => { calls.requests.push(input); return pending.promise; };
  assert.equal(calls.requests.length, 1);
  const retrying = calls.cards[0].options.onRetry();
  assert.deepEqual(calls.requests, [original, original]);
  assert.equal(element("workshop-result").classList.contains("hidden"), true);
  assert.equal(element("workshop-result").childNodes.length, 0);
  assert.equal(element("check-workshop-btn").disabled, true);
  pending.resolve({ groups: [group(original)] });
  await retrying;
  assert.equal(element("workshop-result").childNodes.length, 1);
  assert.notEqual(element("workshop-result").childNodes[0], calls.cards[0].node);
  assert.equal(element("workshop-result").classList.contains("hidden"), false);
  assert.equal(element("check-workshop-btn").disabled, false);
  assert.equal(calls.cards.length, 1);
});

test("settings recovery uses the shared focused-settings action without changing lines automatically", async () => {
  await checkWorkshopUrl();
  const line = getAPILineSnapshot();
  assert.equal(calls.cards[0].options.onSettings, undefined, "the shared settings event must not be replaced by plain page navigation");
  assert.deepEqual(calls.pages, []);
  assert.deepEqual(getAPILineSnapshot(), line);
  assert.equal(calls.requests.length, 1);
  assert.equal(element("workshop-result").childNodes.length, 1);
});

test("editing the input clears an old error without starting another parse", async () => {
  await checkWorkshopUrl();
  element("workshop-url").value = "new input";
  element("workshop-url").dispatchEvent({ type: "input" });
  assert.equal(element("workshop-result").childNodes.length, 0);
  assert.equal(element("workshop-result").classList.contains("hidden"), true);
  assert.equal(element("check-workshop-btn").disabled, false);
  assert.equal(calls.requests.length, 1);
});

test("empty input keeps the validation toast and never suggests changing lines", async () => {
  await checkWorkshopUrl();
  element("workshop-url").value = "  ";
  await checkWorkshopUrl();
  assert.deepEqual(calls.errors, ["请输入创意工坊链接或工坊ID"]);
  assert.equal(calls.cards.length, 1, "validation must not create an API error card");
  assert.equal(calls.requests.length, 1);
  assert.equal(element("workshop-result").childNodes.length, 0);
  assert.equal(element("workshop-result").classList.contains("hidden"), true);
});

test("backend input validation stays a safe Chinese toast without connection-recovery actions", async () => {
  const value = "https://input.invalid/private-value";
  element("workshop-url").value = value;
  globalThis.__workshopParseErrors.GetWorkshopDetailsGrouped = async (input) => {
    calls.requests.push(input);
    throw new Error(`无效的工坊ID片段 "${value}": could not find valid workshop ID in URL`);
  };
  await checkWorkshopUrl();
  assert.deepEqual(calls.errors, ["请输入有效的创意工坊链接或工坊ID。"]);
  assert.equal(calls.cards.length, 0);
  assert.equal(element("workshop-result").classList.contains("hidden"), true);
  assert.equal(element("check-workshop-btn").disabled, false);
  assert.equal(element("workshop-url").value, value);
  assert.deepEqual(calls.pages, []);
  assert.equal(calls.requests.length, 1);
});

test("opening different input without auto parse and closing both clear stale error cards", async () => {
  await checkWorkshopUrl();
  openWorkshopParse("new input", { autoParse: false });
  assert.equal(element("workshop-url").value, "new input");
  assert.equal(element("workshop-result").childNodes.length, 0);
  assert.equal(calls.requests.length, 1);
  await checkWorkshopUrl();
  assert.equal(calls.cards.length, 2);
  closeWorkshopModal();
  assert.equal(element("workshop-url").value, "");
  assert.equal(element("workshop-result").childNodes.length, 0);
  assert.equal(element("workshop-result").classList.contains("hidden"), true);
  assert.equal(element("check-workshop-btn").disabled, false);
  assert.equal(calls.requests.length, 2);
});

test("line changes clear the card and the next explicit error carries the new line", async () => {
  const original = element("workshop-url").value;
  await checkWorkshopUrl();
  setAPILineState("backup");
  assert.equal(element("workshop-result").childNodes.length, 0);
  assert.equal(element("workshop-result").classList.contains("hidden"), true);
  assert.equal(element("workshop-url").value, original);
  assert.equal(calls.requests.length, 1);
  await checkWorkshopUrl();
  assert.equal(calls.cards.length, 2);
  assert.equal(calls.cards[1].options.line, "backup");
  assert.equal(calls.requests.length, 2);
});

test("an old line's failure cannot replace the current error or release its pending button", async () => {
  const old = Promise.withResolvers();
  const current = Promise.withResolvers();
  globalThis.__workshopParseErrors.GetWorkshopDetailsGrouped = (input) => {
    calls.requests.push(input);
    return calls.requests.length === 1 ? old.promise : current.promise;
  };
  const first = checkWorkshopUrl();
  setAPILineState("backup");
  const second = checkWorkshopUrl();
  old.reject(new Error("old request failed"));
  await first;
  assert.equal(calls.cards.length, 0);
  assert.equal(element("check-workshop-btn").disabled, true);
  current.reject(new Error("current request failed"));
  await second;
  assert.equal(calls.cards.length, 1);
  assert.equal(calls.cards[0].options.line, "backup");
  assert.equal(element("check-workshop-btn").disabled, false);
  assert.deepEqual(calls.errors, []);
});

test("input edits invalidate a pending failure and restore the parse button immediately", async () => {
  const pending = Promise.withResolvers();
  globalThis.__workshopParseErrors.GetWorkshopDetailsGrouped = (input) => { calls.requests.push(input); return pending.promise; };
  const parsing = checkWorkshopUrl();
  assert.equal(element("check-workshop-btn").disabled, true);
  element("workshop-url").value = "different input";
  element("workshop-url").dispatchEvent({ type: "input" });
  assert.equal(element("check-workshop-btn").disabled, false);
  pending.reject(new Error("stale request failed"));
  await parsing;
  assert.equal(calls.cards.length, 0);
  assert.deepEqual(calls.errors, []);
  assert.equal(calls.requests.length, 1);
});

test("restoring parsed history removes the error without another network request", async () => {
  await checkWorkshopUrl();
  applyWorkshopGroups([group("919999")]);
  assert.equal(element("workshop-result").classList.contains("hidden"), false);
  assert.equal(element("workshop-result").childNodes.length, 1);
  assert.notEqual(element("workshop-result").childNodes[0], calls.cards[0].node);
  assert.equal(calls.requests.length, 1);
});
