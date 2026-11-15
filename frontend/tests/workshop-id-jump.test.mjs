import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { workshopDeps } from "../src/js/features/workshop/deps.js";

const moduleURL = new URL("../src/js/features/workshop/id-jump.js", import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === moduleURL) {
      const source = specifier === "./detail.js"
        ? "export function openWorkshopDetail(item){globalThis.__jumpTest.opened.push(item)}"
        : specifier.endsWith("/go/app/App")
          ? "export function ParseWorkshopID(raw){globalThis.__jumpTest.parsed.push(raw); return globalThis.__jumpTest.parse(raw)}"
          : null;
      if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { setupWorkshopIdJump, closeWorkshopIdJumpModal } = await import(moduleURL);
hooks.deregister();

class Element {
  constructor(id) {
    this.id = id;
    this.value = "";
    this.disabled = false;
    this.listeners = new Map();
    const classes = new Set();
    this.classList = {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
    };
  }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
  }
  dispatchEvent(event) {
    for (const callback of this.listeners.get(event.type) || []) callback(event);
    return true;
  }
  async emit(type, data = {}) {
    const event = { target: this, preventDefault() { this.prevented = true; }, ...data };
    for (const callback of this.listeners.get(type) || []) await callback(event);
    return event;
  }
  async click() { if (!this.disabled) await this.emit("click"); }
  focus() { document.activeElement = this; }
}

let elements;
let calls;
const input = () => elements.get("workshop-id-jump-input");
const modal = () => elements.get("workshop-id-jump-modal");
const paste = () => elements.get("workshop-id-jump-paste-btn");
const confirm = () => elements.get("workshop-id-jump-confirm-btn");
async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
function edit(text) { input().value = text; input().dispatchEvent(new Event("input")); }
async function enter(data = {}) { await input().emit("keydown", { key: "Enter", ...data }); await settle(); }
async function open(t) { await elements.get("browser-id-jump-btn").click(); t.mock.timers.tick(30); }

test.beforeEach(async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  elements = new Map([
    "browser-id-jump-btn", "workshop-id-jump-modal", "close-workshop-id-jump-btn",
    "workshop-id-jump-cancel-btn", "workshop-id-jump-confirm-btn", "workshop-id-jump-paste-btn", "workshop-id-jump-input",
  ].map((id) => [id, new Element(id)]));
  const events = new Element("document");
  globalThis.document = {
    getElementById: (id) => elements.get(id),
    addEventListener: (...args) => events.addEventListener(...args),
    dispatchEvent: (event) => events.dispatchEvent(event),
    activeElement: null,
  };
  calls = { parsed: [], opened: [], errors: [], parse: async (raw) => raw };
  globalThis.__jumpTest = calls;
  workshopDeps.showError = (message) => calls.errors.push(message);
  workshopDeps.ClipboardGetText = async () => "3803082047";
  closeWorkshopIdJumpModal();
  setupWorkshopIdJump();
  await open(t);
});
test.afterEach(() => { closeWorkshopIdJumpModal(); });
test.after(() => { delete globalThis.document; delete globalThis.__jumpTest; });

test("opening focuses the input and pasting fills it without opening a detail", async () => {
  assert.equal(document.activeElement, input());
  await paste().click();
  assert.equal(input().value, "3803082047");
  assert.equal(document.activeElement, input());
  assert.deepEqual(calls.parsed, []);
  assert.deepEqual(calls.opened, []);
  assert.equal(paste().disabled, false);
});

for (const [name, text, expected] of [
  ["plain ID", "  3803082047\n", "3803082047"],
  ["Steam URL", "https://steamcommunity.com/sharedfiles/filedetails/?id=3803082047&searchtext=", "3803082047"],
  ["mixed text", "2026 年推荐 https://steamcommunity.com/sharedfiles/filedetails/?id=3803082047 和 ?id=222222", "3803082047"],
  ["large ID", "9007199254740993", "9007199254740993"],
]) {
  test(`pasting ${name} keeps the intended ID as a string and Enter uses the existing parser`, async () => {
    workshopDeps.ClipboardGetText = async () => text;
    await paste().click();
    assert.equal(input().value, expected);
    await enter();
    assert.deepEqual(calls.parsed, [expected]);
    assert.deepEqual(calls.opened, [{ publishedfileid: expected }]);
    assert.ok(modal().classList.contains("hidden"));
  });
}

test("manually pasted links and the confirm button use the same validation", async () => {
  edit("https://steamcommunity.com/sharedfiles/filedetails/?id=3803082047");
  await confirm().click();
  assert.deepEqual(calls.parsed, ["3803082047"]);
  assert.deepEqual(calls.opened, [{ publishedfileid: "3803082047" }]);
});

test("IME confirmation, held Enter and unrelated keys do not navigate", async () => {
  edit("3803082047");
  await enter({ isComposing: true });
  await enter({ repeat: true });
  await input().emit("keydown", { key: "ArrowRight" });
  assert.deepEqual(calls.parsed, []);
  await enter();
  assert.equal(calls.opened.length, 1);
  await enter();
  assert.equal(calls.opened.length, 1, "closed modal cannot be submitted");
});

test("empty clipboard preserves existing input and shows actionable feedback", async () => {
  edit("222222");
  workshopDeps.ClipboardGetText = async () => " \n";
  await paste().click();
  assert.equal(input().value, "222222");
  assert.match(calls.errors[0], /剪贴板中没有文本/);
  assert.equal(document.activeElement, input());
  assert.equal(confirm().disabled, false);
});

test("clipboard failure preserves input and hides the underlying error", async () => {
  edit("222222");
  workshopDeps.ClipboardGetText = async () => { throw new Error("private clipboard failure"); };
  await paste().click();
  assert.equal(input().value, "222222");
  assert.match(calls.errors[0], /读取剪贴板失败.*手动粘贴/);
  assert.doesNotMatch(calls.errors[0], /private/);
  assert.equal(paste().disabled, false);
});

test("editing while clipboard reading is pending prevents an overwrite, even if text is changed back", async () => {
  const pending = Promise.withResolvers();
  workshopDeps.ClipboardGetText = () => pending.promise;
  edit("222222");
  const request = paste().click();
  assert.equal(paste().disabled, true);
  edit("333333");
  edit("222222");
  pending.resolve("3803082047");
  await request;
  assert.equal(input().value, "222222");
  assert.equal(confirm().disabled, false);
});

test("a clipboard result from a closed modal cannot overwrite or unlock a new request", async (t) => {
  const old = Promise.withResolvers();
  const current = Promise.withResolvers();
  workshopDeps.ClipboardGetText = () => old.promise;
  const first = paste().click();
  closeWorkshopIdJumpModal();
  await open(t);
  workshopDeps.ClipboardGetText = () => current.promise;
  const second = paste().click();
  old.resolve("222222");
  await first;
  assert.equal(input().value, "");
  assert.equal(paste().disabled, true);
  current.resolve("3803082047");
  await second;
  assert.equal(input().value, "3803082047");
  assert.equal(paste().disabled, false);
});

test("blank and invalid IDs keep the dialog open without fetching a detail", async () => {
  await enter();
  assert.match(calls.errors[0], /请输入工坊 ID 或链接/);
  edit("123");
  calls.parse = async () => { throw new Error("invalid workshop ID"); };
  await enter();
  assert.match(calls.errors[1], /无法识别工坊 ID/);
  assert.equal(modal().classList.contains("hidden"), false);
  assert.equal(confirm().disabled, false);
  assert.deepEqual(calls.opened, []);
});

test("pending validation accepts one submission and closing cancels its result", async () => {
  const pending = Promise.withResolvers();
  calls.parse = () => pending.promise;
  edit("3803082047");
  await enter();
  await enter();
  await confirm().click();
  assert.deepEqual(calls.parsed, ["3803082047"]);
  closeWorkshopIdJumpModal();
  pending.resolve("3803082047");
  await settle();
  assert.deepEqual(calls.opened, []);
});

test("editing during validation prevents opening the previous ID", async () => {
  const pending = Promise.withResolvers();
  calls.parse = () => pending.promise;
  edit("3803082047");
  await enter();
  edit("222222");
  pending.resolve("3803082047");
  await settle();
  assert.deepEqual(calls.opened, []);
  assert.equal(input().value, "222222");
  assert.equal(confirm().disabled, false);
});

test("Escape, cancel and overlay close still work, and reopening clears the old value", async (t) => {
  for (const close of [
    () => elements.get("workshop-id-jump-cancel-btn").click(),
    () => elements.get("close-workshop-id-jump-btn").click(),
    () => modal().emit("click"),
    () => document.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" })),
  ]) {
    edit("222222");
    await close();
    assert.ok(modal().classList.contains("hidden"));
    await open(t);
    assert.equal(input().value, "");
    assert.equal(document.activeElement, input());
  }
});
