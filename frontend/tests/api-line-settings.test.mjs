import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { getAPILineSnapshot, isCurrentAPILine, setAPILineState, subscribeAPILineChange } from "../src/js/core/api-line.js";

const configURL = new URL("../src/js/core/config.js", import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === configURL && specifier.endsWith("wailsjs/go/app/App")) {
      const source = ["GetAppConfig", "GetConfigMigrationVersion", "MigrateLocalStorageConfig", "SaveAppConfig"]
        .map((name) => `export const ${name} = (...args) => globalThis.__apiLineSettings.${name}(...args);`).join("\n");
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { initConfig, getConfig, saveConfig, updateConfigCache } = await import(configURL);
const { appendAPILineSettings, updateAPILineStatus } = await import("../src/js/features/settings/api-line.js");
globalThis.window = { addEventListener() {} };
const { loadIPOptionsForDropdown } = await import("../src/js/features/settings/settings-page.js");
hooks.deregister();

class Element {
  constructor(tag = "div") {
    this.tagName = tag;
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.connected = true;
    this.checked = false;
    this.disabled = false;
    this.value = "";
    this.dataset = {};
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
      toggle(name) { if (classes.has(name)) classes.delete(name); else classes.add(name); },
    };
  }
  get isConnected() { return this.connected && (!this.parent || this.parent.isConnected); }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return (this.text || "") + this.children.map((child) => child.textContent).join(""); }
  append(...nodes) { nodes.forEach((node) => { node.parent = this; this.children.push(node); }); }
  appendChild(node) { this.append(node); return node; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  dispatch(type) { return this.listeners.get(type)?.({ preventDefault() {} }); }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [
      ...(selector === child.tagName || selector === `#${child.id}` ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

let container;
let panel;
let stored;
let notifications;
let isCurrent;
test.beforeEach(async () => {
  container = new Element();
  panel = new Element();
  panel.id = "settings-panel-network";
  container.append(panel);
  stored = { apiLine: "primary" };
  notifications = [];
  isCurrent = true;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  globalThis.__apiLineSettings = {
    GetAppConfig: async () => stored,
    SaveAppConfig: async (config) => { stored = config; },
  };
  await initConfig();
});
test.afterEach(() => { container.connected = false; });
test.after(() => {
  delete globalThis.document;
  delete globalThis.window;
  delete globalThis.__apiLineSettings;
});

async function card(set = async () => {}, get = async () => stored.apiLine) {
  await appendAPILineSettings(container, {
    isCurrentRender: () => isCurrent,
    GetAPILine: get,
    SetAPILine: set,
    showNotification: (...args) => notifications.push(args),
  });
  return panel.querySelector("#settings-api-line-form");
}
function choose(form, value) {
  form.querySelectorAll("input").forEach((radio) => { radio.checked = radio.value === value; });
}

test("the API card defaults to the primary line and only a successful manual save changes it", async () => {
  const pending = Promise.withResolvers();
  const calls = [];
  const form = await card((value) => { calls.push(value); return pending.promise; });
  const radios = form.querySelectorAll("input");
  assert.deepEqual(radios.map(({ value, checked }) => [value, checked]), [["primary", true], ["backup", false]]);
  assert.match(form.textContent, /主线路/);
  assert.match(form.textContent, /备用线路/);
  assert.doesNotMatch(form.textContent, /https?:|\b\d{1,3}(?:\.\d{1,3}){3}\b|laoyutang|Worker/i);
  choose(form, "backup");
  await radios[1].dispatch("change");
  assert.deepEqual(calls, [], "changing the radio must not persist or send requests");
  const before = getAPILineSnapshot();
  const saving = form.dispatch("submit");
  await form.dispatch("submit");
  assert.deepEqual(calls, ["backup"]);
  assert.equal(getConfig().apiLine, "primary");
  assert.equal(isCurrentAPILine(before), true);
  assert.equal(form.querySelector("button").disabled, true);
  pending.resolve();
  await saving;
  assert.equal(getConfig().apiLine, "backup");
  assert.equal(isCurrentAPILine(before), false);
  assert.equal(form.querySelector("button").disabled, false);
  assert.equal(notifications.length, 1);
});

test("failed saves retain the prior line and never render an error address", async () => {
  const form = await card(async () => { throw new Error("request to https://private.invalid:1234/ failed at 192.0.2.10"); });
  choose(form, "backup");
  const before = getAPILineSnapshot();
  await form.dispatch("submit");
  assert.equal(getConfig().apiLine, "primary");
  assert.equal(isCurrentAPILine(before), true);
  assert.equal(form.querySelectorAll("input")[0].checked, true);
  assert.match(form.textContent, /保存线路设置失败/);
  assert.doesNotMatch(form.textContent, /private|192\.0|https?:/);
  assert.deepEqual(notifications, []);
});

test("saving after leaving updates the real global line without mutating the abandoned form", async () => {
  const pending = Promise.withResolvers();
  const form = await card(() => pending.promise);
  choose(form, "backup");
  const saving = form.dispatch("submit");
  isCurrent = false;
  const abandonedText = form.textContent;
  pending.resolve();
  await saving;
  assert.equal(getConfig().apiLine, "backup");
  assert.equal(getAPILineSnapshot().line, "backup");
  assert.equal(form.textContent, abandonedText);
  assert.equal(form.querySelector("button").disabled, true);
  assert.deepEqual(notifications, []);
});

test("a new card follows an earlier page's completed save", async () => {
  const pending = Promise.withResolvers();
  const old = await card(() => pending.promise);
  choose(old, "backup");
  const saving = old.dispatch("submit");
  panel.connected = false;
  container = new Element();
  panel = new Element();
  panel.id = "settings-panel-network";
  container.append(panel);
  const latest = await card();
  pending.resolve();
  await saving;
  assert.equal(latest.querySelectorAll("input")[1].checked, true);
  assert.equal(old.querySelector("button").disabled, true);
});

test("saves across page visits are serialized so an older response cannot roll back the latest choice", async () => {
  const pending = Promise.withResolvers();
  const calls = [];
  const old = await card((line) => {
    calls.push(line);
    stored.apiLine = line;
    return pending.promise;
  });
  choose(old, "backup");
  const first = old.dispatch("submit");
  await Promise.resolve();
  panel.connected = false;
  container = new Element();
  panel = new Element();
  panel.id = "settings-panel-network";
  container.append(panel);
  const latest = await card(async (line) => { calls.push(line); stored.apiLine = line; });
  choose(latest, "primary");
  const second = latest.dispatch("submit");
  await Promise.resolve();
  assert.deepEqual(calls, ["backup"], "the next save waits for the older bridge response");
  pending.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(calls, ["backup", "primary"]);
  assert.equal(stored.apiLine, "primary");
  assert.equal(getConfig().apiLine, "primary");
  assert.equal(getAPILineSnapshot().line, "primary");
  assert.equal(latest.querySelectorAll("input")[0].checked, true);
});

test("a same-value manual save is queued behind an older page's pending change", async () => {
  const pending = Promise.withResolvers();
  const calls = [];
  const old = await card(async (line) => { calls.push(line); await pending.promise; stored.apiLine = line; });
  choose(old, "backup");
  const first = old.dispatch("submit");
  await Promise.resolve();
  panel.connected = false;
  container = new Element();
  panel = new Element();
  panel.id = "settings-panel-network";
  container.append(panel);
  const latest = await card(async (line) => { calls.push(line); stored.apiLine = line; });
  const second = latest.dispatch("submit");
  pending.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(calls, ["backup", "primary"]);
  assert.equal(stored.apiLine, "primary");
  assert.equal(getConfig().apiLine, "primary");
});

test("loading failures are generic and stale settings pages do not receive a card", async () => {
  await card(undefined, async () => { throw new Error("https://private.invalid"); });
  assert.match(panel.textContent, /读取线路设置失败/);
  assert.doesNotMatch(panel.textContent, /https?:|private/);
  panel.children = [];
  const pending = Promise.withResolvers();
  const rendering = card(undefined, () => pending.promise);
  isCurrent = false;
  pending.resolve("backup");
  await rendering;
  assert.equal(panel.children.length, 0);
});

test("configuration defaults and stale ordinary saves preserve the separately saved line", async () => {
  stored = { apiLine: "unknown" };
  await initConfig();
  assert.equal(getConfig().apiLine, "primary");
  const stale = getConfig();
  updateConfigCache({ apiLine: "backup" });
  await saveConfig({ ...stale, theme: "dark" });
  assert.equal(getConfig().apiLine, "backup");
  assert.equal(stored.apiLine, "backup");
  assert.equal(getAPILineSnapshot().line, "backup");
});

test("a return to the same line invalidates older work and unchanged choices do not notify", () => {
  const first = getAPILineSnapshot();
  let changes = 0;
  const stop = subscribeAPILineChange(() => changes++);
  setAPILineState("primary");
  assert.equal(changes, 0);
  setAPILineState("backup");
  setAPILineState("primary");
  assert.equal(changes, 2);
  assert.equal(isCurrentAPILine(first), false);
  stop();
});

test("candidate fallback is visible and retries only when the user reopens the list", async () => {
  await card();
  const trigger = new Element("button");
  const menu = new Element();
  const fixedInput = new Element("input");
  panel.append(trigger, menu, fixedInput);
  menu.classList.add("hidden");
  let requests = 0;
  let statusReads = 0;
  await loadIPOptionsForDropdown({
    layout: container,
    isCurrentPage: () => isCurrent,
    GetWorkshopIPOptions: async () => { requests++; return [{ ip: "192.0.2.4", category: "内置" }]; },
    GetAPILineStatus: async () => { statusReads++; return { line: "primary", ipPoolFallback: requests === 1 }; },
    trigger, menu, fixedInput, fixedIP: "", setOptions() {},
    getConfig, saveConfig, showNotification() {}, SetWorkshopFixedIP() {},
  });
  const status = panel.querySelector("#settings-api-line-status");
  assert.equal(status.hidden, false);
  assert.equal(status.textContent, "IP 列表获取失败，当前使用内置候选；可重新打开列表重试。");
  assert.equal(requests, 1);
  assert.equal(statusReads, 1);
  assert.doesNotMatch(status.textContent, /192\.0|https?:/);
  await trigger.onclick({ stopPropagation() {} });
  assert.equal(requests, 2, "opening the list is the only retry trigger");
  assert.equal(statusReads, 2);
  assert.equal(status.hidden, true);
  await trigger.onclick({ stopPropagation() {} });
  assert.equal(requests, 2, "a successful pool does not need retry on close");
});

test("old candidate results and status cannot replace a newly selected line", async () => {
  await card();
  const trigger = new Element("button");
  const menu = new Element();
  const fixedInput = new Element("input");
  panel.append(trigger, menu, fixedInput);
  const old = Promise.withResolvers();
  let requests = 0;
  let statuses = 0;
  let options = [];
  const loading = loadIPOptionsForDropdown({
    layout: container, isCurrentPage: () => isCurrent,
    GetWorkshopIPOptions: () => { requests++; return requests === 1 ? old.promise : [{ ip: "192.0.2.8", category: "新候选" }]; },
    GetAPILineStatus: async () => { statuses++; return { line: "backup", ipPoolFallback: false }; },
    trigger, menu, fixedInput, fixedIP: "", setOptions: (next) => { options = next; },
    getConfig, saveConfig, showNotification() {}, SetWorkshopFixedIP() {},
  });
  setAPILineState("backup");
  assert.equal(requests, 1, "a line change does not reload candidates automatically");
  old.resolve([{ ip: "192.0.2.4", category: "旧候选" }]);
  await loading;
  assert.deepEqual(options, []);
  assert.equal(statuses, 0);
  assert.equal(trigger.disabled, false);
  await trigger.onclick({ stopPropagation() {} });
  assert.equal(requests, 2);
  assert.equal(options[0].ip, "192.0.2.8");
  assert.equal(statuses, 1);
});

test("fallback status ignores a stale line or page and never exposes raw errors", async () => {
  await card();
  const status = panel.querySelector("#settings-api-line-status");
  const old = Promise.withResolvers();
  const reading = updateAPILineStatus(container, () => old.promise, () => isCurrent);
  setAPILineState("backup");
  old.resolve({ line: "primary", ipPoolFallback: true });
  await reading;
  assert.equal(status.hidden, true);
  await updateAPILineStatus(container, async () => { throw new Error("https://private.invalid/ 192.0.2.4"); });
  assert.match(status.textContent, /读取线路状态失败/);
  assert.doesNotMatch(status.textContent, /private|https?:|192\.0/);
  isCurrent = false;
  const text = status.textContent;
  await updateAPILineStatus(container, async () => ({ line: "backup", ipPoolFallback: true }), () => isCurrent);
  assert.equal(status.textContent, text);
});
