import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

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
  set innerHTML(_) { throw new Error("DNS settings must create DOM nodes"); }
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

globalThis.document = {
  body: new Element("body"),
  createElement: (tag) => new Element(tag),
};
globalThis.window = { addEventListener() {} };

const configURL = new URL("../src/js/core/config.js", import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === configURL && specifier.endsWith("wailsjs/go/app/App")) {
      const source = ["GetAppConfig", "GetConfigMigrationVersion", "MigrateLocalStorageConfig", "SaveAppConfig"]
        .map((name) => `export const ${name} = (...args) => globalThis.__dnsAutosaveTest.${name}(...args);`).join("\n");
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { initConfig, getConfig } = await import(configURL);
const { appendWorkshopDNSSettings } = await import("../src/js/features/settings/workshop-dns.js");
hooks.deregister();

let persisted;
let writes;
let notifications;
let mounted;
let genericSaves;
test.beforeEach(async () => {
  document.body.replaceChildren();
  persisted = { mode: "alidns", customAddress: "" };
  writes = [];
  notifications = [];
  mounted = [];
  genericSaves = 0;
  globalThis.__dnsAutosaveTest = {
    GetAppConfig: async () => ({ theme: "dark", apiLine: "backup", workshopPreferredIP: false, workshopFixedIP: "192.0.2.20", workshopDNS: { ...persisted } }),
    SaveAppConfig: async () => { genericSaves++; },
  };
  await initConfig();
});
test.afterEach(() => { mounted.forEach((entry) => entry.leave()); });
test.after(() => { delete globalThis.document; delete globalThis.window; delete globalThis.__dnsAutosaveTest; });

async function mount({ get, set } = {}) {
  const container = new Element();
  const panel = new Element();
  panel.id = "settings-panel-network";
  container.append(panel);
  document.body.append(container);
  let current = true;
  await appendWorkshopDNSSettings(container, {
    isCurrentRender: () => current && container.isConnected,
    GetWorkshopDNSConfig: get || (async () => ({ ...persisted })),
    SetWorkshopDNSConfig: async (next) => {
      writes.push({ ...next });
      await set?.(next);
      persisted = { ...next };
    },
    showNotification: (...args) => notifications.push(args),
  });
  const form = panel.querySelector("#settings-workshop-dns-form");
  const entry = { container, panel, form, leave() { current = false; container.remove(); } };
  mounted.push(entry);
  return entry;
}
function address(h) { return h.form.querySelector("#settings-workshop-dns-address"); }
function radio(h, value) { return h.form.querySelector(`input[name="settings-workshop-dns-mode"][value="${value}"]`); }
function error(h) { return h.form.querySelector("#settings-workshop-dns-error"); }
function select(h, value) {
  for (const item of h.form.querySelectorAll('input[name="settings-workshop-dns-mode"]')) item.checked = item.value === value;
}
async function choose(h, value) { select(h, value); await radio(h, value).dispatch("change"); }
async function type(h, value) { address(h).value = value; await address(h).dispatch("input"); }
async function settle() { for (let index = 0; index < 20; index++) await Promise.resolve(); }

test("DNS loads without Save or Cancel controls and does not write on render", async () => {
  const h = await mount();
  assert.equal(h.form.querySelectorAll("button").length, 0);
  assert.equal(radio(h, "alidns").checked, true);
  assert.deepEqual(writes, []);
  assert.deepEqual(notifications, []);
});

test("preset changes are pending until durable success and do not touch other preferences", async () => {
  const gate = Promise.withResolvers();
  const h = await mount({ set: () => gate.promise });
  select(h, "system");
  const saving = radio(h, "system").dispatch("change");
  await settle();
  assert.deepEqual(writes, [{ mode: "system", customAddress: "" }]);
  assert.equal(getConfig().workshopDNS.mode, "alidns");
  assert.equal(h.form.querySelectorAll("input").every((item) => item.disabled), true);
  await radio(h, "system").dispatch("change");
  assert.equal(writes.length, 1);
  gate.resolve();
  await saving;
  assert.deepEqual(getConfig().workshopDNS, { mode: "system", customAddress: "" });
  assert.equal(getConfig().theme, "dark");
  assert.equal(getConfig().apiLine, "backup");
  assert.equal(getConfig().workshopFixedIP, "192.0.2.20");
  assert.equal(getConfig().workshopPreferredIP, false);
  assert.equal(genericSaves, 0);
  assert.equal(notifications.length, 1);
  assert.equal(h.form.querySelectorAll("input").every((item) => !item.disabled), true);
});

test("custom mode waits for a confirmed valid address without saving each character", async () => {
  const h = await mount();
  await choose(h, "custom");
  assert.deepEqual(writes, []);
  assert.equal(address(h).focused, true);
  for (const value of ["1", "192.", "192.0.2.9"]) {
    await type(h, value);
    await address(h).dispatch("change");
  }
  assert.deepEqual(writes, []);
  await address(h).dispatch("blur");
  assert.deepEqual(writes, [{ mode: "custom", customAddress: "192.0.2.9" }]);
  await address(h).dispatch("blur");
  await address(h).dispatch("keydown", { key: "Enter" });
  assert.equal(writes.length, 1, "reconfirming the same value is a no-op");
});

test("invalid custom confirmations never write and remain editable without a focus trap", async () => {
  const h = await mount();
  await choose(h, "custom");
  address(h).focused = false;
  for (const value of ["", "0.0.0.0", "224.0.0.1", "::", "ff02::1", "::ffff:0.0.0.0", "::ffff:224.0.0.1", "001.2.3.4", "192.0.2.1:53", "192.0.2.0/24", "host.invalid", "[2001:db8::1]", "fe80::1%eth0"]) {
    await type(h, value);
    await address(h).dispatch("blur");
    assert.equal(error(h).hidden, false, value);
    assert.match(error(h).textContent, /尚未生效/);
    assert.equal(address(h).value, value);
    assert.equal(address(h).focused, false, "blur validation must not refocus the field");
  }
  assert.deepEqual(writes, []);
  assert.equal(getConfig().workshopDNS.mode, "alidns");
});

test("Enter confirms canonical IPv6 or mapped addresses and ignores IME composition", async () => {
  const h = await mount();
  await choose(h, "custom");
  await type(h, " 2001:0DB8:0:0:0:0:0:53 ");
  await address(h).dispatch("keydown", { key: "Enter", isComposing: true });
  assert.deepEqual(writes, []);
  await address(h).dispatch("keydown", { key: "Enter" });
  assert.deepEqual(persisted, { mode: "custom", customAddress: "2001:db8::53" });
  assert.equal(address(h).value, "2001:db8::53");
  await type(h, "::ffff:192.0.2.53");
  await address(h).dispatch("keydown", { key: "Enter" });
  assert.deepEqual(persisted, { mode: "custom", customAddress: "192.0.2.53" });
});

test("a failed discrete change restores the effective choice with a safe error and permits retry", async () => {
  let fail = true;
  const h = await mount({ set: async () => { if (fail) throw new Error("write C:\\private\\profile failed: fixture-secret"); } });
  await choose(h, "system");
  assert.equal(radio(h, "alidns").checked, true);
  assert.deepEqual(persisted, { mode: "alidns", customAddress: "" });
  assert.equal(getConfig().workshopDNS.mode, "alidns");
  assert.match(error(h).textContent, /已恢复原设置/);
  assert.doesNotMatch(h.form.textContent, /private|profile|fixture-secret|C:/);
  assert.deepEqual(notifications, []);
  fail = false;
  await choose(h, "system");
  assert.equal(getConfig().workshopDNS.mode, "system");
  assert.equal(error(h).hidden, true);
  assert.equal(notifications.length, 1);
});

test("a failed text save keeps its draft and retries the same value on blur", async () => {
  let fail = true;
  const h = await mount({ set: async () => { if (fail) throw new Error("https://private.invalid/ fixture-secret"); } });
  await choose(h, "custom");
  await type(h, "192.0.2.53");
  await address(h).dispatch("blur");
  assert.equal(address(h).value, "192.0.2.53");
  assert.equal(radio(h, "custom").checked, true);
  assert.equal(getConfig().workshopDNS.mode, "alidns");
  assert.match(error(h).textContent, /Enter.*重试/);
  assert.doesNotMatch(h.form.textContent, /https?:|private|fixture-secret/);
  assert.deepEqual(notifications, []);
  fail = false;
  await address(h).dispatch("blur");
  assert.deepEqual(persisted, { mode: "custom", customAddress: "192.0.2.53" });
  assert.equal(writes.length, 2);
  assert.equal(notifications.length, 1);
});

test("blurring toward a different local radio leaves that radio to commit once", async () => {
  persisted = { mode: "custom", customAddress: "192.0.2.9" };
  await initConfig();
  const h = await mount();
  await type(h, "192.0.2.8");
  await address(h).dispatch("change");
  await address(h).dispatch("blur", { relatedTarget: radio(h, "system") });
  assert.deepEqual(writes, []);
  assert.equal(radio(h, "system").disabled, false, "the following click must remain usable");
  await choose(h, "system");
  assert.deepEqual(writes, [{ mode: "system", customAddress: "192.0.2.9" }]);
});

test("blurring toward the already checked custom radio still confirms the address", async () => {
  persisted = { mode: "custom", customAddress: "192.0.2.9" };
  await initConfig();
  const h = await mount();
  await type(h, "192.0.2.8");
  await address(h).dispatch("blur", { relatedTarget: radio(h, "custom") });
  assert.deepEqual(writes, [{ mode: "custom", customAddress: "192.0.2.8" }]);
});

test("confirmed blur finishes after leaving without a stale toast and survives reopening", async () => {
  const gate = Promise.withResolvers();
  const old = await mount({ set: () => gate.promise });
  await choose(old, "custom");
  await type(old, "192.0.2.53");
  const saving = address(old).dispatch("blur");
  await settle();
  old.leave();
  gate.resolve();
  await saving;
  const reopened = await mount();
  assert.equal(radio(reopened, "custom").checked, true);
  assert.equal(address(reopened).value, "192.0.2.53");
  assert.deepEqual(getConfig().workshopDNS, persisted);
  assert.deepEqual(notifications, []);
});

test("unconfirmed invalid drafts disappear on reopening and detached events cannot save", async () => {
  const old = await mount();
  await choose(old, "custom");
  await type(old, "invalid");
  old.leave();
  await address(old).dispatch("blur");
  await address(old).dispatch("keydown", { key: "Enter" });
  const reopened = await mount();
  assert.equal(radio(reopened, "alidns").checked, true);
  assert.equal(address(reopened).value, "");
  assert.deepEqual(writes, []);
});

test("older responses never replace a new page's dirty text or show an old toast", async () => {
  const gate = Promise.withResolvers();
  const old = await mount({ set: () => gate.promise });
  await choose(old, "custom");
  await type(old, "192.0.2.9");
  const saving = address(old).dispatch("blur");
  await settle();
  old.leave();
  const latest = await mount();
  await choose(latest, "custom");
  await type(latest, "192.0.2.8");
  gate.resolve();
  await saving;
  assert.equal(address(latest).value, "192.0.2.8");
  assert.equal(radio(latest, "custom").checked, true);
  assert.deepEqual(notifications, []);
  latest.leave();
  const reopened = await mount();
  assert.equal(address(reopened).value, "192.0.2.9");
});

test("cross-page writes serialize and a newer preset preserves the latest durable custom address", async () => {
  const gate = Promise.withResolvers();
  const old = await mount({ set: () => gate.promise });
  await choose(old, "custom");
  await type(old, "192.0.2.9");
  const first = address(old).dispatch("blur");
  await settle();
  old.leave();
  const latest = await mount();
  select(latest, "system");
  const second = radio(latest, "system").dispatch("change");
  await settle();
  assert.deepEqual(writes, [{ mode: "custom", customAddress: "192.0.2.9" }]);
  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(writes, [
    { mode: "custom", customAddress: "192.0.2.9" },
    { mode: "system", customAddress: "192.0.2.9" },
  ]);
  assert.deepEqual(getConfig().workshopDNS, persisted);
  assert.equal(radio(latest, "system").checked, true);
});

test("an explicit click on the same checked mode queues behind an earlier page's write", async () => {
  const gate = Promise.withResolvers();
  const old = await mount({ set: () => gate.promise });
  select(old, "system");
  const first = radio(old, "system").dispatch("change");
  await settle();
  old.leave();
  const latest = await mount();
  const second = radio(latest, "alidns").dispatch("click");
  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(writes.map((entry) => entry.mode), ["system", "alidns"]);
  assert.equal(persisted.mode, "alidns");
});

test("a getter started before an older write finishes cannot load an obsolete mode", async () => {
  const saveGate = Promise.withResolvers();
  const readGate = Promise.withResolvers();
  const old = await mount({ set: () => saveGate.promise });
  select(old, "system");
  const saving = radio(old, "system").dispatch("change");
  await settle();
  old.leave();
  const opening = mount({ get: () => readGate.promise });
  saveGate.resolve();
  await saving;
  readGate.resolve({ mode: "alidns", customAddress: "" });
  const latest = await opening;
  assert.equal(radio(latest, "system").checked, true);
  assert.equal(getConfig().workshopDNS.mode, "system");
  assert.deepEqual(notifications, []);
});

test("repeated Enter and blur during a pending text save produce one atomic write", async () => {
  const gate = Promise.withResolvers();
  const h = await mount({ set: () => gate.promise });
  await choose(h, "custom");
  await type(h, "192.0.2.53");
  const saving = address(h).dispatch("keydown", { key: "Enter" });
  await settle();
  await address(h).dispatch("blur");
  await address(h).dispatch("keydown", { key: "Enter" });
  assert.equal(writes.length, 1);
  assert.equal(h.form.querySelectorAll("input").every((item) => item.disabled), true);
  gate.resolve();
  await saving;
  assert.equal(notifications.length, 1);
});

test("a failed older write does not block the next page's queued selection", async () => {
  const gate = Promise.withResolvers();
  const old = await mount({ set: () => gate.promise });
  select(old, "system");
  const first = radio(old, "system").dispatch("change");
  await settle();
  old.leave();
  const latest = await mount();
  select(latest, "dnspod");
  const second = radio(latest, "dnspod").dispatch("change");
  await settle();
  assert.equal(writes.length, 1);
  gate.reject(new Error("fixture-secret"));
  await Promise.all([first, second]);
  assert.deepEqual(writes.map((entry) => entry.mode), ["system", "dnspod"]);
  assert.equal(persisted.mode, "dnspod");
  assert.equal(getConfig().workshopDNS.mode, "dnspod");
  assert.equal(radio(latest, "dnspod").checked, true);
  assert.equal(error(latest).hidden, true);
  assert.equal(notifications.length, 1, "only the current successful page announces its result");
});

test("a read failure is safe and abandoned async reads never append controls", async () => {
  const failed = await mount({ get: async () => { throw new Error("https://private.invalid/fixture-secret"); } });
  assert.equal(failed.form, null);
  assert.match(failed.panel.textContent, /读取工坊 DNS 设置失败/);
  assert.doesNotMatch(failed.panel.textContent, /https?:|private|fixture-secret/);
  const gate = Promise.withResolvers();
  const opening = mount({ get: () => gate.promise });
  await settle();
  document.body.replaceChildren();
  gate.resolve({ mode: "system", customAddress: "" });
  const latest = await opening;
  assert.equal(latest.form, null);
});
