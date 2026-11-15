import assert from "node:assert/strict";
import test from "node:test";
import { appendServerViewSettings } from "../src/js/features/settings/server-view.js";

class Element {
  constructor() {
    this.children = [];
    this.listeners = new Map();
    this.connected = true;
    this.checked = false;
    this.disabled = false;
    this.classes = new Set();
    this.classList = {
      toggle: (name, active) => active ? this.classes.add(name) : this.classes.delete(name),
      contains: (name) => this.classes.has(name),
    };
  }
  get isConnected() { return this.connected; }
  set innerHTML(_) { throw new Error("Server view settings must create DOM nodes"); }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.children.push(node); }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  async change() { await this.listeners.get("change")?.(); }
}

let card;
let layout;
test.beforeEach(() => {
  card = new Element();
  layout = { querySelector: (selector) => selector === "#settings-panel-interface .setting-card" ? card : null };
  globalThis.document = { createElement: () => new Element() };
});
test.after(() => { delete globalThis.document; });

function controls() {
  return card.children.at(-1).children[1].children.map((option) => ({ option, radio: option.children[0] }));
}

test("server view settings restore their preference independently from the Mod controls", () => {
  appendServerViewSettings(layout, { getMode: () => "card" });
  const [list, cardMode] = controls();
  assert.equal(list.radio.name, "settings-server-display-mode");
  assert.equal(list.radio.checked, false);
  assert.equal(cardMode.radio.checked, true);
  assert.equal(cardMode.option.classList.contains("active"), true);
});

test("changing server view waits for persistence and updates active controls", async () => {
  const gate = Promise.withResolvers();
  let mode = "list";
  const writes = [];
  const notifications = [];
  appendServerViewSettings(layout, {
    getMode: () => mode,
    setMode: async (value) => { writes.push(value); await gate.promise; mode = value; },
    showNotification: (...args) => notifications.push(args),
  });
  const [list, cardMode] = controls();
  cardMode.radio.checked = true;
  const pending = cardMode.radio.change();
  assert.deepEqual(writes, ["card"]);
  assert.equal(list.radio.disabled, true);
  assert.equal(cardMode.radio.disabled, true);
  gate.resolve();
  await pending;
  assert.equal(list.radio.checked, false);
  assert.equal(cardMode.radio.checked, true);
  assert.equal(list.radio.disabled, false);
  assert.equal(cardMode.option.classList.contains("active"), true);
  assert.equal(notifications.length, 1);
});

test("failed preference saves restore the confirmed control and show the error", async () => {
  const errors = [];
  appendServerViewSettings(layout, {
    getMode: () => "list",
    setMode: async () => { throw new Error("disk full"); },
    showError: (message) => errors.push(message),
  });
  const [list, cardMode] = controls();
  cardMode.radio.checked = true;
  await cardMode.radio.change();
  assert.equal(list.radio.checked, true);
  assert.equal(cardMode.radio.checked, false);
  assert.equal(cardMode.radio.disabled, false);
  assert.match(errors[0], /保存服务器视图失败.*disk full/);
});

test("late completion of an abandoned settings page does not notify on the current page", async () => {
  const gate = Promise.withResolvers();
  const notifications = [];
  let current = true;
  appendServerViewSettings(layout, {
    isCurrentRender: () => current,
    getMode: () => "list",
    setMode: () => gate.promise,
    showNotification: (...args) => notifications.push(args),
  });
  const [, cardMode] = controls();
  cardMode.radio.checked = true;
  const pending = cardMode.radio.change();
  current = false;
  gate.resolve();
  await pending;
  assert.deepEqual(notifications, []);
});
