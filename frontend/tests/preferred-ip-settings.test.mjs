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
async function setEnabled(form, value) {
  toggle(form).checked = value;
  await toggle(form).dispatch("change");
}
async function typeIP(form, value) {
  input(form).value = value;
  await input(form).dispatch("input");
}
async function choose(form, value) {
  for (const candidate of form.querySelectorAll('input[name="settings-ip-mode"]')) candidate.checked = candidate.value === value;
  await mode(form, value).dispatch("change");
}
async function fixedDraft(form, value) {
  await choose(form, "fixed");
  await typeIP(form, value);
}
async function settle() { for (let index = 0; index < 20; index++) await Promise.resolve(); }

test("the IP card has no Save, Cancel or unsaved-guidance surface", async () => {
  const h = await mount();
  assert.ok(h.form);
  assert.equal(h.optionCalls, 1, "the existing asynchronous preload remains enabled");
  assert.equal(h.form.querySelectorAll("button").some((node) => /^(?:保存|取消)$/.test(node.textContent.trim())), false);
  assert.doesNotMatch(h.form.textContent, /点击[“”\s]*保存|尚未保存|取消/);
  assert.equal(notifications.length, 0);
  await mode(h.form, "auto").click();
  await h.form.dispatch("submit");
  assert.deepEqual(writes, [], "confirming an unchanged pair without queued work is a no-op");
});

test("the enable toggle immediately applies one atomic pair and only updates the two IP cache fields", async () => {
  const h = await mount();
  await setEnabled(h.form, false);
  await settle();
  assert.deepEqual(writes, [{ enabled: false, fixedIP: "" }]);
  assert.deepEqual(persisted, writes[0]);
  assert.equal(getConfig().workshopPreferredIP, false);
  assert.equal(getConfig().workshopFixedIP, "");
  assert.equal(getConfig().theme, "dark");
  assert.equal(getConfig().apiLine, "primary");
  assert.deepEqual(getConfig().workshopDNS, { mode: "alidns", customAddress: "" });
  assert.equal(genericSaves, 0);
  assert.equal(notifications.length, 0, "ordinary successful autosaves stay quiet");
});

test("automatic mode immediately clears the fixed IP while disabled fixed settings retain their mode", async () => {
  persisted = { enabled: false, fixedIP: "192.0.2.9" };
  const h = await mount();
  assert.equal(toggle(h.form).checked, false);
  assert.equal(mode(h.form, "fixed").checked, true);
  assert.equal(input(h.form).value, "192.0.2.9");
  await setEnabled(h.form, true);
  await choose(h.form, "auto");
  await settle();
  assert.deepEqual(writes, [{ enabled: true, fixedIP: "192.0.2.9" }, { enabled: true, fixedIP: "" }]);
  assert.equal(input(h.form).value, "");
  assert.deepEqual(persisted, { enabled: true, fixedIP: "" });
});

test("fixed mode and each typed character remain pending until a valid address is confirmed", async () => {
  const h = await mount();
  const previousStatus = status(h.form).textContent;
  await choose(h.form, "fixed");
  assert.equal(error(h.form).hidden, false);
  for (const value of ["1", "192.", "192.0.2.", "192.0.2.9"]) await typeIP(h.form, value);
  assert.deepEqual(writes, []);
  assert.equal(getConfig().workshopFixedIP, "");
  assert.equal(status(h.form).textContent, previousStatus);
  await input(h.form).dispatch("change");
  assert.deepEqual(writes, [], "native change must remain a draft until blur or Enter");
  await input(h.form).dispatch("blur");
  await h.form.dispatch("submit");
  await settle();
  assert.deepEqual(writes, [{ enabled: true, fixedIP: "192.0.2.9" }]);
  assert.match(status(h.form).textContent, /当前固定 IP.*192\.0\.2\.9/);
  assert.equal(notifications.length, 0);
});

test("Enter confirms a valid manual address and later change or blur does not duplicate it", async () => {
  const h = await mount();
  await fixedDraft(h.form, " 2001:0DB8:0:0:0:0:0:1 ");
  await h.form.dispatch("submit");
  await input(h.form).dispatch("change");
  await input(h.form).dispatch("blur");
  await settle();
  assert.deepEqual(writes, [{ enabled: true, fixedIP: "2001:db8::1" }]);
  assert.equal(input(h.form).value, "2001:db8::1");
});

test("empty or malformed fixed confirmations show an inline Chinese error and send no pair", async () => {
  const h = await mount();
  await choose(h.form, "fixed");
  for (const value of ["", "host.invalid", "192.0.2.1:443", "192.0.2.0/24", "001.2.3.4", "1::2::3", "[2001:db8::1]", "fe80::1%eth0"]) {
    await typeIP(h.form, value);
    await input(h.form).dispatch("change");
    await input(h.form).dispatch("blur");
    await h.form.dispatch("submit");
    assert.equal(error(h.form).hidden, false, value);
    assert.match(error(h.form).textContent, /有效.*IPv4.*IPv6/);
  }
  assert.deepEqual(writes, []);
  assert.deepEqual(persisted, { enabled: true, fixedIP: "" });
});

test("invalid blur reports validation without stealing focus back from the next control", async () => {
  const h = await mount();
  await fixedDraft(h.form, "invalid address");
  input(h.form).focused = false;
  await input(h.form).dispatch("blur", { relatedTarget: new Element("outside") });
  assert.equal(error(h.form).hidden, false);
  assert.equal(input(h.form).focused, false);
  assert.deepEqual(writes, []);
});

for (const action of ["candidate", "auto mode", "disable", "dropdown trigger"]) {
  test(`blur toward ${action} defers the manual draft and lets the discrete action own its one pair`, async () => {
    persisted = { enabled: true, fixedIP: "192.0.2.9" };
    const h = await mount();
    await typeIP(h.form, "192.0.2.8");
    const target = action === "candidate" ? menu(h.form).querySelector(".settings-ip-option")
      : action === "auto mode" ? mode(h.form, "auto")
      : action === "disable" ? toggle(h.form) : trigger(h.form);
    await input(h.form).dispatch("change");
    await input(h.form).dispatch("blur", { relatedTarget: target });
    assert.deepEqual(writes, [], "focus transfer must not apply the intermediate typed address");
    if (action === "candidate") await target.click();
    else if (action === "auto mode") await choose(h.form, "auto");
    else if (action === "disable") await setEnabled(h.form, false);
    else await target.click();
    await settle();
    const expected = action === "candidate" ? [{ enabled: true, fixedIP: "192.0.2.4" }]
      : action === "auto mode" ? [{ enabled: true, fixedIP: "" }]
      : action === "disable" ? [{ enabled: false, fixedIP: "192.0.2.9" }] : [];
    assert.deepEqual(writes, expected);
    if (action === "dropdown trigger") assert.equal(input(h.form).value, "192.0.2.8");
  });
}

for (const priorFixedIP of ["", "192.0.2.9"]) {
  test(`explicit disable discards an invalid manual draft and retains saved fixed IP ${priorFixedIP || '(auto)'}`, async () => {
    persisted = { enabled: true, fixedIP: priorFixedIP };
    const h = await mount();
    await fixedDraft(h.form, "invalid address");
    await setEnabled(h.form, false);
    await settle();
    assert.deepEqual(writes, [{ enabled: false, fixedIP: priorFixedIP }]);
    assert.deepEqual(persisted, { enabled: false, fixedIP: priorFixedIP });
    assert.equal(input(h.form).value, priorFixedIP);
    assert.equal(mode(h.form, priorFixedIP ? "fixed" : "auto").checked, true);
  });
}

test("a candidate choice immediately applies its pair while opening and closing menus do not write", async () => {
  const h = await mount();
  await choose(h.form, "fixed");
  await trigger(h.form).click();
  document.dispatchEvent({ type: "click", target: new Element("outside") });
  assert.equal(menu(h.form).classList.contains("hidden"), true);
  assert.deepEqual(writes, []);
  await trigger(h.form).click();
  await menu(h.form).querySelector(".settings-ip-option").click();
  await settle();
  assert.deepEqual(writes, [{ enabled: true, fixedIP: "192.0.2.4" }]);
  assert.equal(input(h.form).value, "192.0.2.4");
  assert.equal(menu(h.form).classList.contains("hidden"), true);
  await trigger(h.form).click();
  await trigger(h.form).click();
  assert.equal(writes.length, 1);
  assert.equal(h.optionCalls, 1);
});

test("autosave locks every IP control and candidate and coalesces repeated confirmations", async () => {
  const gate = Promise.withResolvers();
  const h = await mount({ SetWorkshopIPSettings: async (next) => { writes.push({ ...next }); await gate.promise; persisted = { ...next }; } });
  await fixedDraft(h.form, "192.0.2.9");
  const pending = input(h.form).dispatch("blur");
  await settle();
  for (const control of h.form.querySelectorAll("input, button")) assert.equal(control.disabled, true, control.id || control.textContent);
  await input(h.form).dispatch("blur");
  await h.form.dispatch("submit");
  assert.equal(writes.length, 1);
  gate.resolve();
  await pending;
  await settle();
  await input(h.form).dispatch("blur");
  assert.equal(writes.length, 1);
  assert.equal(input(h.form).disabled, false);
});

test("late candidate loading cannot unlock controls or alter input during an autosave", async () => {
  const pool = Promise.withResolvers();
  const saving = Promise.withResolvers();
  const h = await mount({
    GetWorkshopIPOptions: () => pool.promise,
    SetWorkshopIPSettings: async (next) => { writes.push({ ...next }); await saving.promise; persisted = { ...next }; },
  });
  const pending = setEnabled(h.form, false);
  await settle();
  pool.resolve([{ ip: "192.0.2.4", category: "迟到候选" }]);
  await settle();
  const candidate = menu(h.form).querySelector(".settings-ip-option");
  assert.ok(candidate);
  assert.equal(trigger(h.form).disabled, true);
  assert.equal(candidate.disabled, true);
  await candidate.click();
  assert.equal(input(h.form).value, "");
  assert.equal(writes.length, 1);
  saving.resolve();
  await pending;
  await settle();
  assert.equal(trigger(h.form).disabled, false);
  assert.equal(candidate.disabled, false);
});

for (const action of ["toggle", "mode", "candidate"]) {
  test(`a failed discrete ${action} action rolls controls back to the saved pair`, async () => {
    persisted = { enabled: true, fixedIP: "192.0.2.9" };
    const h = await mount({ SetWorkshopIPSettings: async (next) => { writes.push({ ...next }); throw new Error("https://private.invalid/ secret=fixture-secret"); } });
    const oldCache = getConfig();
    const oldStatus = status(h.form).textContent;
    if (action === "toggle") await setEnabled(h.form, false);
    else if (action === "mode") await choose(h.form, "auto");
    else {
      await trigger(h.form).click();
      await menu(h.form).querySelector(".settings-ip-option").click();
    }
    await settle();
    assert.equal(writes.length, 1);
    assert.equal(toggle(h.form).checked, true);
    assert.equal(mode(h.form, "fixed").checked, true);
    assert.equal(input(h.form).value, "192.0.2.9");
    assert.equal(error(h.form).hidden, false);
    assert.doesNotMatch(error(h.form).textContent, /private|https?:|fixture-secret/);
    assert.deepEqual(getConfig(), oldCache);
    assert.equal(status(h.form).textContent, oldStatus);
    assert.equal(notifications.length, 0);
  });
}

test("a failed manual confirmation retains input, cache and effective status and can retry on blur", async () => {
  let attempts = 0;
  const h = await mount({ SetWorkshopIPSettings: async (next) => {
    writes.push({ ...next });
    if (++attempts === 1) throw new Error("https://private.invalid/ secret=fixture-secret");
    persisted = { ...next };
  } });
  const oldStatus = status(h.form).textContent;
  await fixedDraft(h.form, "192.0.2.9");
  await input(h.form).dispatch("blur");
  await settle();
  assert.equal(error(h.form).hidden, false);
  assert.match(error(h.form).textContent, /失败|未能/);
  assert.doesNotMatch(error(h.form).textContent, /private|https?:|fixture-secret/);
  assert.equal(input(h.form).value, "192.0.2.9");
  assert.equal(mode(h.form, "fixed").checked, true);
  assert.equal(getConfig().workshopFixedIP, "");
  assert.equal(status(h.form).textContent, oldStatus);
  assert.equal(notifications.length, 0);
  await input(h.form).dispatch("blur");
  await settle();
  assert.equal(writes.length, 2);
  assert.deepEqual(persisted, { enabled: true, fixedIP: "192.0.2.9" });
});

test("leaving discards unconfirmed text and detached controls cannot confirm it", async () => {
  const old = await mount();
  await fixedDraft(old.form, "192.0.2.9");
  old.leave();
  const latest = await mount();
  assert.equal(toggle(latest.form).checked, true);
  assert.equal(mode(latest.form, "auto").checked, true);
  assert.equal(input(latest.form).value, "");
  await input(old.form).dispatch("change");
  await old.form.dispatch("submit");
  assert.deepEqual(writes, []);
});

test("a failed settings read displays a safe error without editable controls", async () => {
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

test("an older page autosave never replaces a newer unconfirmed input draft", async () => {
  const gate = Promise.withResolvers();
  const old = await mount({ SetWorkshopIPSettings: async (next) => { writes.push({ ...next }); await gate.promise; persisted = { ...next }; } });
  const pending = setEnabled(old.form, false);
  await settle();
  old.leave();
  const latest = await mount();
  await fixedDraft(latest.form, "192.0.2.8");
  gate.resolve();
  await pending;
  await settle();
  assert.equal(input(latest.form).value, "192.0.2.8");
  assert.equal(toggle(latest.form).checked, true);
  assert.equal(mode(latest.form, "fixed").checked, true);
  assert.equal(notifications.length, 0);
  latest.leave();
  const reopened = await mount();
  assert.equal(toggle(reopened.form).checked, false);
  assert.equal(mode(reopened.form, "auto").checked, true);
  assert.equal(input(reopened.form).value, "");
});

test("a getter started before an old autosave completes cannot restore an outdated pair", async () => {
  const saveGate = Promise.withResolvers();
  const readGate = Promise.withResolvers();
  const old = await mount({ SetWorkshopIPSettings: async (next) => { writes.push({ ...next }); await saveGate.promise; persisted = { ...next }; } });
  const saving = setEnabled(old.form, false);
  await settle();
  old.leave();
  const opening = mount({ GetWorkshopIPSettings: () => readGate.promise });
  await settle();
  saveGate.resolve();
  await saving;
  readGate.resolve({ enabled: true, fixedIP: "" });
  const latest = await opening;
  assert.equal(toggle(latest.form).checked, false);
  assert.equal(mode(latest.form, "auto").checked, true);
  assert.deepEqual(writes, [{ enabled: false, fixedIP: "" }]);
});

test("clicking the already checked radio on a new page queues its pair behind an older pending change", async () => {
  const gate = Promise.withResolvers();
  const setter = async (next) => { writes.push({ ...next }); if (writes.length === 1) await gate.promise; persisted = { ...next }; };
  const old = await mount({ SetWorkshopIPSettings: setter });
  const first = setEnabled(old.form, false);
  await settle();
  old.leave();
  const latest = await mount({ SetWorkshopIPSettings: setter });
  const second = mode(latest.form, "auto").click();
  await settle();
  assert.deepEqual(writes, [{ enabled: false, fixedIP: "" }]);
  gate.resolve();
  await first;
  await second;
  await settle();
  assert.deepEqual(writes, [{ enabled: false, fixedIP: "" }, { enabled: true, fixedIP: "" }]);
  assert.deepEqual(persisted, { enabled: true, fixedIP: "" });
  assert.equal(getConfig().workshopPreferredIP, true);
  assert.equal(genericSaves, 0);
});

test("late candidates use current unconfirmed input without applying or overwriting it", async () => {
  const gate = Promise.withResolvers();
  const h = await mount({ GetWorkshopIPOptions: () => gate.promise });
  await fixedDraft(h.form, "192.0.2.9");
  assert.equal(input(h.form).disabled, false);
  await typeIP(h.form, "192.0.2.8");
  gate.resolve([{ ip: "192.0.2.9", category: "旧选择" }, { ip: "192.0.2.8", category: "新选择" }]);
  await settle();
  assert.equal(input(h.form).value, "192.0.2.8");
  assert.match(trigger(h.form).textContent, /192\.0\.2\.8/);
  const selected = menu(h.form).querySelectorAll(".settings-ip-option").find((node) => node.classList.contains("active"));
  assert.equal(selected?.dataset.value, "192.0.2.8");
  assert.deepEqual(writes, []);
});

test("line changes invalidate candidates without applying or fetching until the user reopens", async () => {
  const old = Promise.withResolvers();
  const lines = [];
  const h = await mount({ GetWorkshopIPOptions: () => { lines.push(getAPILineSnapshot().line); return lines.length === 1 ? old.promise : [{ ip: "192.0.2.8", category: "新线路" }]; } });
  await fixedDraft(h.form, "192.0.2.9");
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

test("status events describe committed mode while manual text has not been confirmed", async () => {
  const h = await mount();
  assert.match(status(h.form).textContent, /当前优选 IP/);
  await fixedDraft(h.form, "192.0.2.9");
  await h.emit("ip_selection_end");
  assert.match(status(h.form).textContent, /当前优选 IP/);
  assert.doesNotMatch(status(h.form).textContent, /当前固定 IP/);
  assert.equal(input(h.form).value, "192.0.2.9");
  assert.deepEqual(writes, []);
});

test("a late auto-status result cannot replace a newly applied fixed IP", async () => {
  const gate = Promise.withResolvers();
  const h = await mount({ GetCurrentBestIPOption: () => gate.promise });
  await fixedDraft(h.form, "192.0.2.9");
  await input(h.form).dispatch("blur");
  await settle();
  gate.resolve({ ip: "192.0.2.4", category: "旧优选" });
  await settle();
  assert.match(status(h.form).textContent, /当前固定 IP/);
  assert.match(status(h.form).textContent, /192\.0\.2\.9/);
  assert.doesNotMatch(status(h.form).textContent, /旧优选/);
});

test("deferred candidate preload waits for all network cards and shares one initial promise", async () => {
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

test("literal normalization preserves all valid IP ranges and rejects URL, network and ambiguous forms", () => {
  for (const [value, expected] of [
    ["192.0.2.9", "192.0.2.9"], [" 2001:0DB8:0:0:0:0:0:1 ", "2001:db8::1"], ["::ffff:192.0.2.9", "192.0.2.9"],
    ["0.0.0.0", "0.0.0.0"], ["224.0.0.1", "224.0.0.1"], ["::", "::"], ["FF02:0:0:0:0:0:0:1", "ff02::1"],
    ["::ffff:224.0.0.1", "224.0.0.1"], ["::ffff:0.0.0.0", "0.0.0.0"], ["::ffff:0", "::ffff:0"], ["::ffff:0:192.0.2.9", "::ffff:0:c000:209"],
  ]) assert.equal(normalizeFixedIP(value), expected, value);
  for (const value of ["", "[2001:db8::1]", "fe80::1%eth0", "192.0.2.1:443", "192.0.2.0/24", "host.invalid", "127.1", "2130706433", "001.2.3.4"]) assert.equal(normalizeFixedIP(value), null, value);
});

test("clicking the already checked fixed radio confirms manual text and keeps manual versus discrete failure semantics", async () => {
  persisted = { enabled: true, fixedIP: "192.0.2.9" };
  let fail = false;
  const setter = async (next) => {
    writes.push({ ...next });
    if (fail) throw new Error("fixture update failed");
    persisted = { ...next };
  };
  const h = await mount({ SetWorkshopIPSettings: setter });
  const fixed = mode(h.form, "fixed");
  await typeIP(h.form, "192.0.2.8");
  await input(h.form).dispatch("blur", { relatedTarget: fixed });
  assert.deepEqual(writes, []);
  await fixed.click();
  await settle();
  assert.deepEqual(writes, [{ enabled: true, fixedIP: "192.0.2.8" }]);
  assert.equal(input(h.form).value, "192.0.2.8");

  fail = true;
  await typeIP(h.form, "192.0.2.7");
  await input(h.form).dispatch("blur", { relatedTarget: fixed });
  await fixed.click();
  await settle();
  assert.equal(input(h.form).value, "192.0.2.7", "a checked-radio manual confirmation failure preserves the typed address");
  assert.equal(mode(h.form, "fixed").checked, true);
  assert.equal(error(h.form).hidden, false);
  assert.deepEqual(persisted, { enabled: true, fixedIP: "192.0.2.8" });
  assert.match(status(h.form).textContent, /192\.0\.2\.8/);

  h.leave();
  persisted = { enabled: true, fixedIP: "" };
  const next = await mount({ SetWorkshopIPSettings: setter });
  await typeIP(next.form, "192.0.2.6");
  await choose(next.form, "fixed");
  await settle();
  assert.equal(mode(next.form, "auto").checked, true, "a newly chosen fixed mode is still a discrete action and rolls back on failure");
  assert.equal(input(next.form).value, "");
  assert.equal(error(next.form).hidden, false);
  assert.deepEqual(writes, [
    { enabled: true, fixedIP: "192.0.2.8" },
    { enabled: true, fixedIP: "192.0.2.7" },
    { enabled: true, fixedIP: "192.0.2.6" },
  ]);
});

test("leaving the card after a trigger focus transfer confirms once while internal focus changes do not", async () => {
  const gate = Promise.withResolvers();
  const h = await mount({ SetWorkshopIPSettings: async (next) => { writes.push({ ...next }); await gate.promise; persisted = { ...next }; } });
  await fixedDraft(h.form, "192.0.2.9");
  await input(h.form).dispatch("blur", { relatedTarget: trigger(h.form) });
  await h.form.dispatch("focusout", { target: input(h.form), relatedTarget: trigger(h.form) });
  await trigger(h.form).click();
  assert.deepEqual(writes, []);
  const sidebar = new Element("button");
  document.body.append(sidebar);
  const pending = h.form.dispatch("focusout", { target: trigger(h.form), relatedTarget: sidebar });
  await settle();
  assert.deepEqual(writes, [{ enabled: true, fixedIP: "192.0.2.9" }]);
  await h.form.dispatch("focusout", { target: trigger(h.form), relatedTarget: sidebar });
  await input(h.form).dispatch("blur", { relatedTarget: sidebar });
  await h.form.dispatch("submit");
  assert.equal(writes.length, 1, "focusout, blur and Enter cannot duplicate an in-flight confirmation");
  gate.resolve();
  await pending;
  await settle();
  await h.form.dispatch("focusout", { relatedTarget: sidebar });
  assert.equal(writes.length, 1);
  assert.deepEqual(persisted, { enabled: true, fixedIP: "192.0.2.9" });
});

test("a queued disable preserves the newest confirmed fixed IP instead of its stale page snapshot", async () => {
  persisted = { enabled: true, fixedIP: "192.0.2.9" };
  const gate = Promise.withResolvers();
  const setter = async (next) => {
    writes.push({ ...next });
    if (writes.length === 1) await gate.promise;
    persisted = { ...next };
  };
  const old = await mount({ SetWorkshopIPSettings: setter });
  await typeIP(old.form, "192.0.2.8");
  const first = input(old.form).dispatch("blur");
  await settle();
  old.leave();
  const latest = await mount({ SetWorkshopIPSettings: setter });
  assert.equal(input(latest.form).value, "192.0.2.9", "the new page initially reads the last committed pair");
  const second = setEnabled(latest.form, false);
  await settle();
  assert.deepEqual(writes, [{ enabled: true, fixedIP: "192.0.2.8" }]);
  gate.resolve();
  await first;
  await second;
  await settle();
  assert.deepEqual(writes, [{ enabled: true, fixedIP: "192.0.2.8" }, { enabled: false, fixedIP: "192.0.2.8" }]);
  assert.deepEqual(persisted, { enabled: false, fixedIP: "192.0.2.8" });
  assert.equal(toggle(latest.form).checked, false);
  assert.equal(mode(latest.form, "fixed").checked, true);
  assert.equal(input(latest.form).value, "192.0.2.8");
  assert.equal(getConfig().workshopPreferredIP, false);
  assert.equal(getConfig().workshopFixedIP, "192.0.2.8");
  assert.equal(genericSaves, 0);
});
