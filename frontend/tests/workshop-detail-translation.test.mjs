import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { workshopDeps } from "../src/js/features/workshop/deps.js";
import { bindWorkshopDetailTranslation } from "../src/js/features/workshop/detail-translation.js";
import { translateWorkshopText } from "../src/js/features/workshop/detail-translation-text.js";

test("falls back to translating around terms that the provider changes", async () => {
  const title = "New Ellis with AK-47 [VScript]";
  const calls = [];
  const translated = await translateWorkshopText(title, async (text) => {
    calls.push(text);
    return {
      [title]: "新版艾利斯搭配步枪 [脚本]",
      New: "新款",
      with: "搭配",
    }[text];
  }, { isTitle: true });
  assert.deepEqual(calls, [title, "New", "with"]);
  assert.equal(translated, "新款 Ellis 搭配 AK-47 [VScript]");
});

function element(text = "") {
  let listener;
  let ownText = text;
  const classes = new Set();
  return {
    disabled: false,
    hidden: false,
    children: [],
    classList: {
      add(...names) { for (const name of names) classes.add(name); },
      remove(...names) { for (const name of names) classes.delete(name); },
      toggle(name, force) {
        const enabled = force === undefined ? !classes.has(name) : force;
        if (enabled) classes.add(name);
        else classes.delete(name);
        return enabled;
      },
      contains(name) { return classes.has(name); },
    },
    get textContent() { return ownText + this.children.map((child) => child.textContent).join(""); },
    set textContent(value) { ownText = value; this.children = []; },
    set className(value) {
      classes.clear();
      for (const name of value.split(/\s+/).filter(Boolean)) classes.add(name);
    },
    setAttribute() {},
    addEventListener(type, callback) { if (type === "click") listener = callback; },
    appendChild(child) { this.children.push(child); },
    prepend(child) { this.children.unshift(child); },
    replaceChildren(...children) { this.textContent = ""; this.children = children; },
    querySelector(selector) { return selector === "span" ? this.children.at(-1) : null; },
    click() { return this.disabled ? undefined : listener?.(); },
  };
}

const isHidden = (node) => node.hidden || node.classList.contains("hidden");

let nextID = 1_000_000;
function bindDetail(t, { title, description, translate, isCurrent = () => true }) {
  const detail = Object.freeze({ publishedfileid: String(nextID++), title, description });
  const calls = [];
  const notices = [];
  const button = element();
  const icon = element();
  const label = element("翻译");
  button.appendChild(icon);
  button.appendChild(label);
  button.querySelector = (selector) => ({ svg: icon, span: label })[selector] ?? null;
  const heading = element(title);
  let originalTitle;
  heading.after = (node) => { originalTitle = node; };
  const paragraphs = description.trim() ? description.trim().split(/\n\n+/) : [];
  const originals = paragraphs.map((paragraph) => element(paragraph));
  const results = paragraphs.map(() => {
    const result = element();
    result.classList.add("hidden");
    return result;
  });
  const selectors = new Map([
    ["[data-translate-description-btn]", button],
    [".detail-title-large", heading],
  ]);
  const view = {
    querySelector: (selector) => selectors.get(selector) ?? null,
    contains: (node) => node === button,
    querySelectorAll(selector) {
      assert.equal(selector, "[data-description-paragraph-index]");
      return originals.map((original, index) => ({
        querySelector: (childSelector) => ({
          ".detail-description-original": original,
          ".detail-paragraph-translation": results[index],
        })[childSelector],
      }));
    },
  };
  const previous = { ...workshopDeps };
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => element(), createElementNS: () => element() };
  Object.assign(workshopDeps, {
    GetWorkshopTranslateProvider: async () => "microsoft",
    TranslateWorkshopDescription: async (text) => {
      calls.push(text);
      return { provider: "microsoft", text: await translate(text) };
    },
    showNotification: (message) => notices.push(message),
    showError: (message) => notices.push(message),
  });
  t.after(() => {
    Object.assign(workshopDeps, previous);
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });
  bindWorkshopDetailTranslation(view, detail, isCurrent);
  return { detail, button, heading, originalTitle, originals, results, calls, notices };
}

test("both fields follow the detail toggle while originals stay unchanged", async (t) => {
  const fixture = bindDetail(t, {
    title: "Playable Coach - AK-47 [VScript]",
    description: "[b]Original paragraph[/b]",
    translate(text) {
      return {
        Playable: "可玩",
        "Original paragraph": "原始段落",
      }[text];
    },
  });
  assert.deepEqual(fixture.calls, []);
  await fixture.button.click();
  assert.deepEqual([...fixture.calls].sort(), ["Original paragraph", "Playable"]);
  assert.equal(fixture.heading.textContent, "可玩 Coach - AK-47 [VScript]");
  assert.equal(fixture.originalTitle.textContent, "Playable Coach - AK-47 [VScript]");
  assert.equal(isHidden(fixture.originalTitle), false);
  assert.equal(fixture.results[0].textContent, "原始段落");
  assert.equal(isHidden(fixture.results[0]), false);
  assert.match(fixture.button.textContent, /查看原文/);

  await fixture.button.click();
  assert.equal(fixture.heading.textContent, "Playable Coach - AK-47 [VScript]");
  assert.equal(isHidden(fixture.originalTitle), true);
  assert.equal(isHidden(fixture.results[0]), true);
  assert.equal(fixture.originals[0].textContent, "[b]Original paragraph[/b]");
  assert.match(fixture.button.textContent, /查看译文/);
  await fixture.button.click();
  assert.equal(fixture.heading.textContent, "可玩 Coach - AK-47 [VScript]");
  assert.equal(isHidden(fixture.results[0]), false);
  assert.equal(fixture.calls.length, 2);
  assert.equal(fixture.detail.title, "Playable Coach - AK-47 [VScript]");
  assert.equal(fixture.detail.description, "[b]Original paragraph[/b]");
});

test("a title-only detail never sends an empty description", async (t) => {
  const fixture = bindDetail(t, {
    title: "Only a title",
    description: " \n ",
    translate: () => "只有标题",
  });
  await fixture.button.click();
  assert.deepEqual(fixture.calls, ["Only a title"]);
  assert.equal(fixture.heading.textContent, "只有标题");
  assert.deepEqual(fixture.results, []);
});

test("a failed title translation leaves the original title and keeps successful paragraphs", async (t) => {
  const fixture = bindDetail(t, {
    title: "Original heading",
    description: "Successful paragraph",
    translate(text) {
      if (text === "Original heading") throw new Error("fixture failure");
      return "成功段落";
    },
  });
  await fixture.button.click();
  assert.equal(fixture.heading.textContent, "Original heading");
  assert.equal(isHidden(fixture.originalTitle), true);
  assert.equal(fixture.results[0].textContent, "成功段落");
  assert.equal(isHidden(fixture.results[0]), false);
  assert.match(fixture.button.textContent, /查看原文/);
});

test("a stale detail cannot publish a delayed failed or successful translation", async (t) => {
  const title = Promise.withResolvers();
  const description = Promise.withResolvers();
  let active = true;
  const fixture = bindDetail(t, {
    title: "Pending title",
    description: "Pending paragraph",
    translate: (text) => text === "Pending title" ? title.promise : description.promise,
    isCurrent: () => active,
  });
  const request = fixture.button.click();
  await setImmediate();
  assert.deepEqual([...fixture.calls].sort(), ["Pending paragraph", "Pending title"]);
  active = false;
  title.resolve("过时标题");
  description.reject(new Error("fixture stale failure"));
  await request;
  assert.equal(fixture.heading.textContent, "Pending title");
  assert.equal(fixture.results[0].textContent.includes("过时"), false);
  assert.deepEqual(fixture.notices, []);
});
