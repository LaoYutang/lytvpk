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

test("Chinese titles keep both Chinese prose and accompanying foreign labels", async () => {
  for (const title of [
    "【蔚蓝档案/blue archive】和乐千世[Waraku Chise]官模改UZI",
    "【明日方舟/Arknights】能天使武器替换 [VScript]",
    "星穹铁道银狼替换武器 (Silver Wolf)",
  ]) {
    const translated = await translateWorkshopText(title, () => {
      assert.fail(`already Chinese title requested translation: ${title}`);
    }, { isTitle: true, targetLanguage: "zh-Hans" });
    assert.equal(translated, title);
  }
});

test("English, Japanese with Kana and Korean titles still translate to Chinese", async () => {
  for (const title of ["Classic weapon sounds", "新しい武器の音", "새로운 무기 소리"]) {
    const calls = [];
    const translated = await translateWorkshopText(title, async (text) => {
      calls.push(text);
      return "经典武器音效";
    }, { isTitle: true, targetLanguage: "zh-Hans" });
    assert.deepEqual(calls, [title]);
    assert.equal(translated, "经典武器音效");
  }
});

test("a short Chinese tag is kept while the foreign title around it is translated", async () => {
  const title = "Classic weapon sounds [汉化]";
  const translated = await translateWorkshopText(title, async (text) => {
    assert.equal(text, "Classic weapon sounds");
    return "经典武器音效";
  }, { isTitle: true, targetLanguage: "zh-Hans" });
  assert.equal(translated, "经典武器音效 [汉化]");
  assert.equal(await translateWorkshopText(
    title,
    async () => "Different weapon audio [汉化]",
    { isTitle: true, targetLanguage: "zh-Hans" },
  ), title);
});

test("the Chinese title shortcut and result guard only apply to a Chinese target", async () => {
  const title = "【明日方舟/Arknights】能天使武器替换";
  const calls = [];
  const translated = await translateWorkshopText(title, async (text) => {
    calls.push(text);
    return "Exusiai weapon replacement";
  }, { isTitle: true, targetLanguage: "en" });
  assert.ok(calls.length > 0);
  assert.match(translated, /Exusiai weapon replacement/);
});

test("translates both parts of the Armory title and keeps its stylized name and parentheses", async () => {
  const calls = [];
  const translated = await translateWorkshopText("BlueWatery Armory (Gun SFX)", async (text) => {
    calls.push(text);
    return { Armory: "(军械库)", "Gun SFX": "（枪械音效））" }[text];
  }, { isTitle: true, targetLanguage: "zh-Hans" });
  assert.deepEqual(calls, ["Armory", "Gun SFX"]);
  assert.equal(translated, "BlueWatery 军械库 (枪械音效)");
});

test("provider punctuation cannot alter original mixed, nested, or unbalanced parentheses", async () => {
  const translations = {
    Armory: ")军械库）",
    "Gun SFX": "（枪械音效))",
    "Extra Maps": "(额外地图）",
  };
  for (const [original, expected] of [
    ["(Armory) NightOps （Gun SFX）", "(军械库) NightOps （枪械音效）"],
    ["NightOps Armory (Gun SFX （Extra Maps）)", "NightOps 军械库 (枪械音效 （额外地图）)"],
    ["NightOps Armory) (Gun SFX", "NightOps 军械库) (枪械音效"],
  ]) {
    const translated = await translateWorkshopText(original, async (text) => {
      assert.ok(Object.hasOwn(translations, text), `unexpected provider input: ${text}`);
      return translations[text];
    }, { isTitle: true, targetLanguage: "zh-Hans" });
    assert.equal(translated, expected);
    assert.deepEqual(translated.match(/[()（）]/g), original.match(/[()（）]/g));
  }
  assert.equal(await translateWorkshopText(
    "Weapon overhaul",
    async () => "武器)改造",
    { isTitle: true, targetLanguage: "zh-Hans" },
  ), "Weapon overhaul");
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

test("description originals stay visible in bilingual and original-only modes", async (t) => {
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
  assert.equal(isHidden(fixture.originals[0]), false);
  assert.equal(isHidden(fixture.results[0]), true);
  await fixture.button.click();
  assert.deepEqual([...fixture.calls].sort(), ["Original paragraph", "Playable"]);
  assert.equal(fixture.heading.textContent, "可玩 Coach - AK-47 [VScript]");
  assert.equal(fixture.originalTitle.textContent, "Playable Coach - AK-47 [VScript]");
  assert.equal(isHidden(fixture.originalTitle), false);
  assert.equal(fixture.results[0].textContent, "原始段落");
  assert.equal(isHidden(fixture.results[0]), false);
  assert.equal(isHidden(fixture.originals[0]), false);
  assert.match(fixture.button.textContent, /查看原文/);

  await fixture.button.click();
  assert.equal(fixture.heading.textContent, "Playable Coach - AK-47 [VScript]");
  assert.equal(isHidden(fixture.originalTitle), true);
  assert.equal(isHidden(fixture.results[0]), true);
  assert.equal(isHidden(fixture.originals[0]), false);
  assert.equal(fixture.originals[0].textContent, "[b]Original paragraph[/b]");
  assert.match(fixture.button.textContent, /查看译文/);
  await fixture.button.click();
  assert.equal(fixture.heading.textContent, "可玩 Coach - AK-47 [VScript]");
  assert.equal(isHidden(fixture.results[0]), false);
  assert.equal(isHidden(fixture.originals[0]), false);
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
  assert.equal(isHidden(fixture.originals[0]), false);
  assert.match(fixture.button.textContent, /查看原文/);
});

test("the screenshot title is not sent to the provider and the description stays bilingual", async (t) => {
  const title = "【蔚蓝档案/blue archive】和乐千世[Waraku Chise]官模改UZI";
  const fixture = bindDetail(t, {
    title,
    description: "[b]Original description[/b]",
    translate(text) {
      assert.equal(text, "Original description");
      return "描述译文";
    },
  });
  await fixture.button.click();
  assert.deepEqual(fixture.calls, ["Original description"]);
  assert.equal(fixture.heading.textContent, title);
  assert.equal(isHidden(fixture.originalTitle), true);
  assert.equal(isHidden(fixture.originals[0]), false);
  assert.equal(fixture.results[0].textContent, "描述译文");
  assert.match(fixture.button.textContent, /查看原文/);
});

test("a provider response in the wrong language never replaces the title", async (t) => {
  const title = "Weapon overhaul";
  const fixture = bindDetail(t, {
    title,
    description: "Original description",
    translate(text) {
      return text === title ? "Completely different English output" : "描述译文";
    },
  });
  await fixture.button.click();
  assert.deepEqual([...fixture.calls].sort(), ["Original description", title]);
  assert.equal(fixture.heading.textContent, title);
  assert.equal(isHidden(fixture.originalTitle), true);
  assert.equal(isHidden(fixture.originals[0]), false);
  assert.equal(fixture.results[0].textContent, "描述译文");
});

test("a failed paragraph keeps its original alongside the bilingual successful paragraph", async (t) => {
  const fixture = bindDetail(t, {
    title: "原文标题",
    description: "First paragraph\n\nBroken paragraph",
    translate(text) {
      if (text === "Broken paragraph") throw new Error("fixture failure");
      return "第一段译文";
    },
  });
  await fixture.button.click();
  assert.deepEqual(fixture.originals.map((node) => node.textContent), ["First paragraph", "Broken paragraph"]);
  assert.deepEqual(fixture.originals.map(isHidden), [false, false]);
  assert.deepEqual(fixture.results.map((node) => node.textContent), ["第一段译文", "这一段翻译失败"]);
  assert.deepEqual(fixture.results.map(isHidden), [false, false]);
  await fixture.button.click();
  assert.deepEqual(fixture.originals.map(isHidden), [false, false]);
  assert.deepEqual(fixture.results.map(isHidden), [true, true]);
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
