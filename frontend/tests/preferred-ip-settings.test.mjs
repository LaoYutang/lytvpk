import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { getAPILineSnapshot, setAPILineState } from "../src/js/core/api-line.js";

class Element {
  constructor(tag = "div") {
    this.tagName = tag;
    this.children = [];
    this.parentElement = null;
    this.connected = true;
    this.classes = new Set();
    this.attributes = new Map();
    this.listeners = new Map();
    this.dataset = {};
    this.style = {};
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.classList = {
      add: (...names) => names.forEach((name) => this.classes.add(name)),
      remove: (...names) => names.forEach((name) => this.classes.delete(name)),
      contains: (name) => this.classes.has(name),
      toggle: (name, force = !this.classes.has(name)) => {
        if (force) this.classes.add(name);
        else this.classes.delete(name);
      },
    };
  }
  get className() { return [...this.classes].join(" "); }
  set className(value) { this.classes = new Set(String(value).split(/\s+/).filter(Boolean)); }
  get childNodes() { return this.children; }
  get isConnected() { return this.connected && (!this.parentElement || this.parentElement.isConnected); }
  get textContent() { return (this.text || "") + this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this.replaceChildren(); this.text = String(value); }
  set innerHTML(_) { throw new Error("IP settings must create DOM nodes"); }
  append(...nodes) { nodes.forEach((node) => this.appendChild(node)); }
  appendChild(node) {
    if (typeof node === "string") { const text = new Element("#text"); text.text = node; node = text; }
    node.remove();
    node.connected = true;
    node.parentElement = this;
    this.children.push(node);
    return node;
  }
  remove() {
    if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
    this.parentElement = null;
    this.connected = false;
  }
  replaceChildren(...nodes) {
    this.children.forEach((child) => { child.parentElement = null; child.connected = false; });
    this.children = [];
    this.text = "";
    this.append(...nodes);
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "class") this.className = value;
    else if (name === "disabled") this.disabled = true;
    else this[name] = String(value);
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); if (name === "disabled") this.disabled = false; }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
  }
  removeEventListener(type, callback) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((listener) => listener !== callback));
  }
  async dispatch(type, extra = {}) {
    const event = { target: this, preventDefault() {}, stopPropagation() {}, ...extra };
    if (typeof this[`on${type}`] === "function") await this[`on${type}`](event);
    for (const callback of this.listeners.get(type) || []) await callback(event);
  }
  async click() { if (!this.disabled) await this.dispatch("click"); }
  focus() { this.focused = true; }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  matches(selector) {
    const attrs = [...selector.matchAll(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g)];
    const base = selector.replace(/\[[^\]]*\]/g, "");
    if (base.startsWith("#") && this.id !== base.slice(1)) return false;
    if (base.startsWith(".") && !this.classList.contains(base.slice(1))) return false;
    if (base && !/^[#.]/.test(base) && this.tagName !== base) return false;
    return attrs.every(([, key, value]) => value === undefined ? this[key] !== undefined : String(this[key] ?? this.attributes.get(key)) === value);
  }
  querySelectorAll(selector) {
    const selectors = selector.split(",").map((part) => part.trim());
    return this.children.flatMap((child) => [...(selectors.some((part) => child.matches(part)) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
}

const documentListeners = new Map();
globalThis.document = {
  body: new Element("body"),
  createElement: (tag) => new Element(tag),
  createTextNode: (value) => { const node = new Element("#text"); node.text = value; return node; },
  getElementById(id) { return this.body.querySelector(`#${id}`); },
  querySelector(selector) { return this.body.querySelector(selector); },
  querySelectorAll(selector) { return this.body.querySelectorAll(selector); },
  addEventListener(type, callback) {
    if (!documentListeners.has(type)) documentListeners.set(type, []);
    documentListeners.get(type).push(callback);
  },
  removeEventListener(type, callback) { documentListeners.set(type, (documentListeners.get(type) || []).filter((listener) => listener !== callback)); },
  dispatchEvent(event) { for (const callback of documentListeners.get(event.type) || []) callback(event); return true; },
};
globalThis.window = { addEventListener() {}, removeEventListener() {} };

const configURL = new URL("../src/js/core/config.js", import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === configURL && specifier.endsWith("wailsjs/go/app/App")) {
      const source = ["GetAppConfig", "GetConfigMigrationVersion", "MigrateLocalStorageConfig", "SaveAppConfig"]
        .map((name) => `export const ${name} = (...args) => globalThis.__preferredIPTest.${name}(...args);`).join("\n");
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { initConfig, getConfig } = await import(configURL);
const { appendPreferredIPSettings, normalizeFixedIP } = await import("../src/js/features/settings/preferred-ip.js");
hooks.deregister();

let persisted;
let writes;
let genericSaves;
let notifications;
let mounted;
test.beforeEach(async () => {
  document.body.replaceChildren();
  mounted = [];
  persisted = { enabled: true, fixedIP: "" };
  writes = [];
  genericSaves = 0;
  notifications = [];
  globalThis.__preferredIPTest = {
    GetAppConfig: async () => ({ apiLine: "primary", theme: "dark", workshopDNS: { mode: "alidns", customAddress: "" }, workshopPreferredIP: true, workshopFixedIP: "" }),
    SaveAppConfig: async () => { genericSaves++; },
  };
  await initConfig();
});
test.afterEach(() => { mounted.forEach((entry) => entry.leave()); });
test.after(() => { delete globalThis.document; delete globalThis.window; delete globalThis.__preferredIPTest; });

async function mount(overrides = {}) {
  const container = new Element();
  const panel = new Element();
  panel.id = "settings-panel-network";
  container.append(panel);
  document.body.append(container);
  let current = true;
  let optionCalls = 0;
  const events = new Map();
  const deps = {
    isCurrentRender: () => current && container.isConnected,
    GetWorkshopIPSettings: async () => ({ ...persisted }),
    SetWorkshopIPSettings: async (next) => { writes.push({ ...next }); persisted = { ...next }; },
    GetWorkshopIPOptions: async () => { optionCalls++; return [{ ip: "192.0.2.4", category: "候选" }]; },
    GetAPILineStatus: async () => ({ line: getAPILineSnapshot().line, ipPoolFallback: false }),
    IsSelectingIP: async () => false,
    GetCurrentBestIPOption: async () => ({ ip: "192.0.2.4", category: "已优选" }),
    GetCurrentBestIP: async () => "192.0.2.4",
    EventsOn(name, callback) { events.set(name, callback); return () => events.delete(name); },
    showNotification(...args) { notifications.push(args); },
    ...overrides,
  };
  const result = await appendPreferredIPSettings(container, deps);
  const form = result || panel.querySelector("#settings-preferred-ip-form");
  const entry = {
    form, container, panel,
    leave() { current = false; container.remove(); },
    async emit(name) { await events.get(name)?.(); await settle(); },
    get optionCalls() { return optionCalls; },
  };
  mounted.push(entry);
  await settle();
  return entry;
}
function input(form) { return form.querySelector("#settings-fixed-ip"); }
function toggle(form) { return form.querySelector("#settings-preferred-ip"); }
function mode(form, value) { return form.querySelector(`input[name="settings-ip-mode"][value="${value}"]`); }
function trigger(form) { return form.querySelector("#settings-ip-option-trigger"); }
function menu(form) { return form.querySelector("#settings-ip-option-menu"); }
function status(form) { return form.querySelector("#settings-ip-status"); }
function error(form) { return form.querySelector("#settings-preferred-ip-error"); }
function button(form, text) {
  const result = form.querySelectorAll("button").find((node) => node.textContent.trim() === text);
  assert.ok(result, `expected ${text} button`);
  return result;
}
async function edit(form, ip, enabled = true) {
  toggle(form).checked = true;
  await toggle(form).dispatch("change");
  await choose(form, "fixed");
  input(form).value = ip;
  await input(form).dispatch("input");
  if (!enabled) {
    toggle(form).checked = false;
    await toggle(form).dispatch("change");
  }
}
async function choose(form, value) {
  for (const candidate of form.querySelectorAll('input[name="settings-ip-mode"]')) candidate.checked = candidate.value === value;
  await mode(form, value).dispatch("change");
}
async function settle() { for (let index = 0; index < 12; index++) await Promise.resolve(); }

test("IP controls, candidate selection and menu closure edit only a draft", async () => {
  const h = await mount();
  assert.ok(h.form);
  assert.equal(h.optionCalls, 1, "the existing asynchronous preload remains enabled");
  await edit(h.form, "192.0.2.9");
  await trigger(h.form).click();
  assert.equal(h.optionCalls, 1, "opening a successful pool must reuse its preload");
  await menu(h.form).querySelector(".settings-ip-option").click();
  assert.equal(input(h.form).value, "192.0.2.4");
  await trigger(h.form).click();
  document.dispatchEvent({ type: "click", target: new Element("outside") });
  assert.equal(menu(h.form).classList.contains("hidden"), true);
  await trigger(h.form).click();
  await input(h.form).dispatch("change");
  toggle(h.form).checked = false;
  await toggle(h.form).dispatch("change");
  assert.deepEqual(writes, []);
  assert.equal(genericSaves, 0);
  assert.deepEqual(persisted, { enabled: true, fixedIP: "" });
});

test("deferred candidate preload starts after all cards exist and shares one initial promise", async () => {
  const gate = Promise.withResolvers();
  let requests = 0;
  let statusReads = 0;
  const h = await mount({
    deferCandidateLoad: true,
    GetWorkshopIPOptions: () => {
      requests++;
      assert.ok(document.getElementById("settings-api-line-form")?.isConnected);
      assert.ok(document.getElementById("settings-workshop-dns-form")?.isConnected);
      return gate.promise;
    },
    GetAPILineStatus: async () => { statusReads++; return { line: "primary", ipPoolFallback: true }; },
  });
  assert.equal(requests, 0);
  assert.equal(statusReads, 0);
  const api = new Element("form");
  api.id = "settings-api-line-form";
  const fallbackStatus = new Element();
  fallbackStatus.id = "settings-api-line-status";
  fallbackStatus.hidden = true;
  api.append(fallbackStatus);
  const dns = new Element("form");
  dns.id = "settings-workshop-dns-form";
  h.panel.append(api, dns);
  const first = h.form.loadIPOptions();
  const second = h.form.loadIPOptions();
  assert.equal(first, second);
  assert.equal(requests, 1);
  gate.resolve([{ ip: "192.0.2.4", category: "内置" }]);
  await first;
  assert.equal(statusReads, 1);
  assert.equal(fallbackStatus.hidden, false);
  assert.match(fallbackStatus.textContent, /IP 列表获取失败.*内置候选/);
  assert.equal(h.form.loadIPOptions(), first);
  assert.equal(requests, 1);
});

test("a deferred preload never starts after the settings card has been left", async () => {
  let requests = 0;
  const h = await mount({ deferCandidateLoad: true, GetWorkshopIPOptions: async () => { requests++; return []; } });
  h.leave();
  await h.form.loadIPOptions();
  assert.equal(requests, 0);
  assert.deepEqual(writes, []);
});

test("explicit save changes only the atomic IP pair and keeps unrelated card settings", async () => {
  const h = await mount();
  await edit(h.form, "192.0.2.9", false);
  await h.form.dispatch("submit");
  assert.deepEqual(writes, [{ enabled: false, fixedIP: "192.0.2.9" }]);
  assert.deepEqual(persisted, writes[0]);
  assert.equal(getConfig().workshopPreferredIP, false);
  assert.equal(getConfig().workshopFixedIP, "192.0.2.9");
  assert.equal(getConfig().theme, "dark");
  assert.equal(getConfig().apiLine, "primary");
  assert.deepEqual(getConfig().workshopDNS, { mode: "alidns", customAddress: "" });
  assert.equal(genericSaves, 0);
  assert.equal(notifications.length, 1);
});

test("disabled fixed settings retain fixed mode and Cancel restores saved values locally", async () => {
  persisted = { enabled: false, fixedIP: "192.0.2.9" };
  const h = await mount();
  assert.equal(toggle(h.form).checked, false);
  assert.equal(mode(h.form, "fixed").checked, true);
  assert.equal(input(h.form).value, "192.0.2.9");
  await edit(h.form, "192.0.2.8", true);
  await button(h.form, "取消").click();
  assert.equal(toggle(h.form).checked, false);
  assert.equal(mode(h.form, "fixed").checked, true);
  assert.equal(input(h.form).value, "192.0.2.9");
  assert.deepEqual(writes, []);
  assert.equal(genericSaves, 0);
});

test("fixed drafts require a valid literal address even when acceleration is disabled", async () => {
  const h = await mount();
  for (const value of ["", "host.invalid", "192.0.2.1:443", "192.0.2.0/24", "001.2.3.4", "1::2::3", "[2001:db8::1]", "fe80::1%eth0"]) {
    await edit(h.form, value, false);
    await h.form.dispatch("submit");
    assert.equal(error(h.form).hidden, false, value);
  }
  assert.deepEqual(writes, []);
  assert.equal(genericSaves, 0);
});

test("save locks all IP controls and candidates and duplicate submit sends one write", async () => {
  const gate = Promise.withResolvers();
  const h = await mount({ SetWorkshopIPSettings: async (next) => { writes.push({ ...next }); await gate.promise; persisted = { ...next }; } });
  await edit(h.form, "192.0.2.9");
  await trigger(h.form).click();
  const pending = h.form.dispatch("submit");
  await settle();
  for (const control of h.form.querySelectorAll("input, button")) assert.equal(control.disabled, true, control.id || control.textContent);
  await h.form.dispatch("submit");
  assert.equal(writes.length, 1);
  gate.resolve();
  await pending;
  assert.equal(button(h.form, "保存").disabled, false);
});

test("late candidate loading cannot unlock controls or alter the draft during a save", async () => {
  const pool = Promise.withResolvers();
  const saving = Promise.withResolvers();
  const h = await mount({
    GetWorkshopIPOptions: () => pool.promise,
    SetWorkshopIPSettings: async (next) => { writes.push({ ...next }); await saving.promise; persisted = { ...next }; },
  });
  await edit(h.form, "192.0.2.9");
  const pending = h.form.dispatch("submit");
  await settle();
  pool.resolve([{ ip: "192.0.2.4", category: "迟到候选" }]);
  await settle();
  assert.equal(trigger(h.form).disabled, true);
  const candidate = menu(h.form).querySelector(".settings-ip-option");
  assert.ok(candidate);
  assert.equal(candidate.disabled, true);
  await candidate.click();
  assert.equal(input(h.form).value, "192.0.2.9");
  assert.equal(writes.length, 1);
  saving.resolve();
  await pending;
  assert.equal(trigger(h.form).disabled, false);
  assert.equal(candidate.disabled, false);
});

test("failed save preserves the draft, cache and effective status for a successful retry", async () => {
  let attempts = 0;
  const h = await mount({ SetWorkshopIPSettings: async (next) => {
    writes.push({ ...next });
    if (++attempts === 1) throw new Error("https://private.invalid/ secret=fixture-secret");
    persisted = { ...next };
  } });
  const oldStatus = status(h.form).textContent;
  await edit(h.form, "192.0.2.9", false);
  await h.form.dispatch("submit");
  assert.equal(error(h.form).hidden, false);
  assert.match(error(h.form).textContent, /保存.*失败/);
  assert.doesNotMatch(error(h.form).textContent, /private|https?:|fixture-secret/);
  assert.equal(input(h.form).value, "192.0.2.9");
  assert.equal(toggle(h.form).checked, false);
  assert.equal(getConfig().workshopPreferredIP, true);
  assert.equal(getConfig().workshopFixedIP, "");
  assert.equal(status(h.form).textContent, oldStatus);
  assert.equal(notifications.length, 0);
  await h.form.dispatch("submit");
  assert.equal(writes.length, 2);
  assert.deepEqual(persisted, { enabled: false, fixedIP: "192.0.2.9" });
});

test("leaving discards unsaved controls and detached cards cannot submit", async () => {
  const old = await mount();
  await edit(old.form, "192.0.2.9", false);
  old.leave();
  const latest = await mount();
  assert.equal(toggle(latest.form).checked, true);
  assert.equal(mode(latest.form, "auto").checked, true);
  assert.equal(input(latest.form).value, "");
  await old.form.dispatch("submit");
  assert.deepEqual(writes, []);
});

test("a failed atomic settings read displays a safe error without save controls", async () => {
  const h = await mount({ GetWorkshopIPSettings: async () => { throw new Error("https://private.invalid/ secret=fixture-secret"); } });
  assert.ok(h.form);
  assert.equal(error(h.form).hidden, false);
  assert.match(error(h.form).textContent, /读取 IP 设置失败/);
  assert.doesNotMatch(h.form.textContent, /private|https?:|fixture-secret/);
  assert.equal(h.form.querySelector("#settings-preferred-ip"), null);
  assert.equal(h.form.querySelectorAll("button").length, 0);
  await h.form.dispatch("submit");
  assert.deepEqual(writes, []);
});

test("an old page save updates the saved baseline without overwriting a newer dirty draft", async () => {
  const gate = Promise.withResolvers();
  const old = await mount({ SetWorkshopIPSettings: async (next) => { writes.push({ ...next }); await gate.promise; persisted = { ...next }; } });
  await edit(old.form, "192.0.2.9", false);
  const pending = old.form.dispatch("submit");
  await settle();
  old.leave();
  const latest = await mount();
  await edit(latest.form, "192.0.2.8", true);
  gate.resolve();
  await pending;
  await settle();
  assert.equal(input(latest.form).value, "192.0.2.8");
  assert.equal(toggle(latest.form).checked, true);
  assert.equal(notifications.length, 0, "old pages cannot announce saves on the new page");
  await button(latest.form, "取消").click();
  assert.equal(input(latest.form).value, "192.0.2.9");
  assert.equal(toggle(latest.form).checked, false);
});

test("a getter started before an older save completes cannot restore an outdated saved pair", async () => {
  const saveGate = Promise.withResolvers();
  const readGate = Promise.withResolvers();
  const old = await mount({ SetWorkshopIPSettings: async (next) => { writes.push({ ...next }); await saveGate.promise; persisted = { ...next }; } });
  await edit(old.form, "192.0.2.9", false);
  const saving = old.form.dispatch("submit");
  await settle();
  old.leave();
  const opening = mount({ GetWorkshopIPSettings: () => readGate.promise });
  await settle();
  saveGate.resolve();
  await saving;
  readGate.resolve({ enabled: true, fixedIP: "" });
  const latest = await opening;
  assert.equal(toggle(latest.form).checked, false);
  assert.equal(mode(latest.form, "fixed").checked, true);
  assert.equal(input(latest.form).value, "192.0.2.9");
  assert.deepEqual(writes, [{ enabled: false, fixedIP: "192.0.2.9" }]);
});

test("same-value saves on a newer page queue behind an earlier pending change", async () => {
  const gate = Promise.withResolvers();
  const setter = async (next) => { writes.push({ ...next }); if (writes.length === 1) await gate.promise; persisted = { ...next }; };
  const old = await mount({ SetWorkshopIPSettings: setter });
  await edit(old.form, "192.0.2.9", false);
  const first = old.form.dispatch("submit");
  await settle();
  old.leave();
  const latest = await mount({ SetWorkshopIPSettings: setter });
  const second = latest.form.dispatch("submit");
  await settle();
  assert.deepEqual(writes, [{ enabled: false, fixedIP: "192.0.2.9" }]);
  gate.resolve();
  await first;
  await second;
  assert.deepEqual(writes, [{ enabled: false, fixedIP: "192.0.2.9" }, { enabled: true, fixedIP: "" }]);
  assert.deepEqual(persisted, { enabled: true, fixedIP: "" });
  assert.equal(getConfig().workshopPreferredIP, true);
  assert.equal(getConfig().workshopFixedIP, "");
});

test("late candidates use the current draft selection and never replace typed input", async () => {
  const gate = Promise.withResolvers();
  const h = await mount({ GetWorkshopIPOptions: () => gate.promise });
  await edit(h.form, "192.0.2.9");
  assert.equal(input(h.form).disabled, false);
  input(h.form).value = "192.0.2.8";
  await input(h.form).dispatch("input");
  gate.resolve([{ ip: "192.0.2.9", category: "旧选择" }, { ip: "192.0.2.8", category: "新选择" }]);
  await settle();
  assert.equal(input(h.form).value, "192.0.2.8");
  assert.match(trigger(h.form).textContent, /192\.0\.2\.8/);
  const selected = menu(h.form).querySelectorAll(".settings-ip-option").find((node) => node.classList.contains("active"));
  assert.equal(selected?.dataset.value, "192.0.2.8");
  assert.deepEqual(writes, []);
});

test("line changes invalidate candidates without saving or fetching until a user reopens", async () => {
  const old = Promise.withResolvers();
  const lines = [];
  const h = await mount({ GetWorkshopIPOptions: () => { lines.push(getAPILineSnapshot().line); return lines.length === 1 ? old.promise : [{ ip: "192.0.2.8", category: "新线路" }]; } });
  await edit(h.form, "192.0.2.9");
  setAPILineState("backup");
  assert.deepEqual(lines, ["primary"]);
  assert.equal(input(h.form).value, "192.0.2.9");
  await trigger(h.form).click();
  old.resolve([{ ip: "192.0.2.4", category: "过期线路" }]);
  await settle();
  assert.deepEqual(lines, ["primary", "backup"]);
  assert.match(menu(h.form).textContent, /新线路/);
  assert.doesNotMatch(menu(h.form).textContent, /过期线路/);
  assert.equal(input(h.form).value, "192.0.2.9");
  assert.deepEqual(writes, []);
});

test("runtime status uses saved mode while the form has an unsaved fixed draft", async () => {
  const h = await mount();
  assert.match(status(h.form).textContent, /当前优选 IP/);
  await edit(h.form, "192.0.2.9");
  await h.emit("ip_selection_end");
  assert.match(status(h.form).textContent, /当前优选 IP/);
  assert.doesNotMatch(status(h.form).textContent, /当前固定 IP/);
  assert.equal(input(h.form).value, "192.0.2.9");
  assert.deepEqual(writes, []);
});

test("an old auto-status read cannot replace a newly saved fixed setting", async () => {
  const gate = Promise.withResolvers();
  const h = await mount({ GetCurrentBestIPOption: () => gate.promise });
  await edit(h.form, "192.0.2.9");
  await h.form.dispatch("submit");
  gate.resolve({ ip: "192.0.2.4", category: "旧优选" });
  await settle();
  assert.match(status(h.form).textContent, /当前固定 IP/);
  assert.match(status(h.form).textContent, /192\.0\.2\.9/);
  assert.doesNotMatch(status(h.form).textContent, /旧优选/);
});

test("literal validation canonicalizes IPv6 and mapped addresses without accepting network or URL forms", () => {
  for (const [value, expected] of [
    ["192.0.2.9", "192.0.2.9"], [" 2001:0DB8:0:0:0:0:0:1 ", "2001:db8::1"], ["::ffff:192.0.2.9", "192.0.2.9"],
    ["0.0.0.0", "0.0.0.0"], ["224.0.0.1", "224.0.0.1"], ["::", "::"], ["FF02:0:0:0:0:0:0:1", "ff02::1"],
    ["::ffff:224.0.0.1", "224.0.0.1"], ["::ffff:0.0.0.0", "0.0.0.0"], ["::ffff:0", "::ffff:0"], ["::ffff:0:192.0.2.9", "::ffff:0:c000:209"],
  ]) assert.equal(normalizeFixedIP(value), expected, value);
  for (const value of ["", "[2001:db8::1]", "fe80::1%eth0", "192.0.2.1:443", "192.0.2.0/24", "host.invalid", "127.1", "2130706433", "001.2.3.4"]) assert.equal(normalizeFixedIP(value), null, value);
});
