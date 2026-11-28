import assert from "node:assert/strict";
import test from "node:test";
import { workshopDeps } from "../src/js/features/workshop/deps.js";
import { appendWorkshopDetailId } from "../src/js/features/workshop/detail-id.js";

class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.attributes = new Map();
  }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.append(node); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  addEventListener(type, listener) {
    assert.equal(type, "click");
    this.click = listener;
  }
}

let clipboard;
let notices;
let errors;
let documentBeforeTest;
let depsBeforeTest;
test.beforeEach(() => {
  clipboard = [];
  notices = [];
  errors = [];
  documentBeforeTest = globalThis.document;
  depsBeforeTest = { ...workshopDeps };
  globalThis.document = { createElement: (tagName) => new Element(tagName) };
  Object.assign(workshopDeps, {
    ClipboardSetText: async (value) => { clipboard.push(value); return true; },
    showNotification: (...args) => notices.push(args),
    showError: (message) => errors.push(message),
  });
});

test.afterEach(() => {
  Object.assign(workshopDeps, depsBeforeTest);
  if (documentBeforeTest === undefined) delete globalThis.document;
  else globalThis.document = documentBeforeTest;
});

function detail(responseId, requestedId, isCurrent = () => true) {
  const stats = new Element("div");
  const view = {
    querySelector(selector) {
      assert.equal(selector, ".detail-stats-bar");
      return stats;
    },
    contains: (node) => stats.children.includes(node),
  };
  appendWorkshopDetailId(view, responseId, requestedId, isCurrent);
  return { stats, button: stats.children[0] };
}

test("the native button displays and copies an exact unsigned 64-bit string", async () => {
  const id = "18446744073709551615";
  const { button } = detail(id, id);
  assert.equal(button.tagName, "button");
  assert.equal(button.type, "button");
  assert.equal(button.attributes.get("aria-label"), `复制工坊 ID ${id}`);
  assert.deepEqual(button.children.map((child) => child.textContent), [id, "工坊 ID"]);
  assert.deepEqual(clipboard, []);
  await button.click();
  assert.deepEqual(clipboard, [id]);
  assert.deepEqual(notices, [["工坊 ID 已复制", "success"]]);
});

test("missing or malformed responses use a valid current request string", () => {
  for (const response of [undefined, "", "invalid", 123456]) {
    assert.equal(detail(response, "300001").button.children[0].textContent, "300001");
  }
  assert.equal(detail("300002", undefined).button.children[0].textContent, "300002");
});

test("unusable and conflicting IDs never offer a copy action", () => {
  for (const id of ["", "0", "0300001", " 300001 ", "300001\n", "18446744073709551616", 300001, undefined]) {
    assert.equal(detail(id, id).button, undefined, String(id));
  }
  assert.equal(detail("300001", "300002").button, undefined);
  assert.deepEqual(clipboard, []);
});

test("false, a rejection or a truthy non-boolean result never reports success", async () => {
  const { button } = detail("300001", "300001");
  for (const result of [false, "true"]) {
    workshopDeps.ClipboardSetText = async () => result;
    await button.click();
  }
  workshopDeps.ClipboardSetText = async () => { throw new Error("fixture clipboard error"); };
  await button.click();
  assert.deepEqual(notices, []);
  assert.deepEqual(errors, Array(3).fill("复制工坊 ID 失败"));
});

test("stale clicks and stale clipboard completion cannot update another detail", async () => {
  const pending = Promise.withResolvers();
  let active = true;
  const { button, stats } = detail("300001", "300001", () => active);
  workshopDeps.ClipboardSetText = (value) => {
    clipboard.push(value);
    return pending.promise;
  };
  const copy = button.click();
  active = false;
  await button.click();
  pending.resolve(true);
  await copy;
  assert.deepEqual(clipboard, ["300001"]);
  assert.deepEqual(notices, []);
  assert.deepEqual(errors, []);

  active = true;
  stats.children = [];
  await button.click();
  assert.deepEqual(clipboard, ["300001"]);
});
