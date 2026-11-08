import assert from "node:assert/strict";
import test from "node:test";
import { getAPILineSnapshot, setAPILineState } from "../src/js/core/api-line.js";
import { createWorkshopRequestError, getWorkshopMetadataWarning, showWorkshopRequestError } from "../src/js/features/workshop/request-error.js";

class Node {
  constructor(tag) {
    this.tagName = tag;
    this.childNodes = [];
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.className = "";
    this.classList = { add: (...names) => { this.className += ` ${names.join(" ")}`; } };
  }
  appendChild(node) { node.parentNode = this; this.childNodes.push(node); return node; }
  remove() { if (this.parentNode) this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1); this.parentNode = null; }
  set textContent(value) { this.text = String(value); this.childNodes = []; }
  get textContent() { return (this.text || "") + this.childNodes.map((node) => node.textContent).join(" "); }
  set innerHTML(_) { assert.fail("error cards must insert plain text"); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name); }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  click() { return this.listeners.get("click")?.(); }
  querySelector(selector) { return this.childNodes.find((node) => node.className.split(" ").includes(selector.slice(1))) || this.childNodes.map((node) => node.querySelector(selector)).find(Boolean); }
}

function fixture(t) {
  setAPILineState("primary");
  const events = [];
  const body = new Node("body");
  const previous = globalThis.document;
  globalThis.document = { body, createElement: (tag) => new Node(tag), getElementById: () => null, dispatchEvent: (event) => { events.push(event.type); } };
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  return { body, events };
}

test("error cards expose the original status and safe detail in an accessible text region", (t) => {
  fixture(t);
  let retries = 0;
  const card = createWorkshopRequestError({ title: "工坊查询失败", error: "批次 2 工坊 ID 123: 主线路请求失败（HTTP 500），请稍后重试", onRetry: () => { retries++; } });
  assert.equal(card.getAttribute("role"), "alert");
  assert.ok(card.getAttribute("aria-labelledby"));
  assert.match(card.textContent, /HTTP 500/);
  assert.match(card.textContent, /批次 2 工坊 ID 123/);
  assert.match(card.textContent, /查询/);
  assert.match(card.textContent, /设置/);
  assert.equal(retries, 0);
  card.querySelector(".workshop-request-error__retry").click();
  assert.equal(retries, 1);
});

test("settings is an explicit navigation event and never changes the selected line", (t) => {
  const { events } = fixture(t);
  const before = getAPILineSnapshot();
  const card = createWorkshopRequestError({ error: "主线路请求超时，请稍后重试" });
  assert.deepEqual(events, []);
  card.querySelector(".workshop-request-error__settings").click();
  assert.deepEqual(events, ["workshop:open-line-settings"]);
  assert.deepEqual(getAPILineSnapshot(), before);
});

test("stale cards cannot request or navigate after a line change", (t) => {
  const { events } = fixture(t);
  let retries = 0;
  let backs = 0;
  const card = createWorkshopRequestError({ error: "HTTP 503", onRetry: () => { retries++; }, onBack: () => { backs++; } });
  setAPILineState("backup");
  card.querySelector(".workshop-request-error__retry").click();
  card.querySelector(".workshop-request-error__settings").click();
  card.querySelector(".workshop-request-error__back").click();
  assert.equal(retries + backs, 0);
  assert.deepEqual(events, []);
});

test("cancellation and local validation do not suggest changing lines", (t) => {
  fixture(t);
  for (const error of ["主线路请求已取消", "工坊ID不能为空"]) {
    const card = createWorkshopRequestError({ error });
    assert.equal(card.querySelector(".workshop-request-error__advice"), undefined);
    assert.equal(card.querySelector(".workshop-request-error__settings"), undefined);
    assert.doesNotMatch(card.textContent, /切换线路/);
  }
});

test("unknown readable errors retain their cause while addresses and credentials stay hidden", (t) => {
  fixture(t);
  const card = createWorkshopRequestError({ error: "批次 3: 返回数据解析失败，invalid character at https://private.invalid/192.0.2.1?token=secret" });
  assert.match(card.textContent, /批次 3/);
  assert.match(card.textContent, /invalid character/);
  assert.doesNotMatch(card.textContent, /private\.invalid|192\.0\.2\.1|token=secret/);
});

test("background errors persist until dismissal, an explicit retry, or a line change", (t) => {
  const { body } = fixture(t);
  let retries = 0;
  const notice = showWorkshopRequestError({ error: "HTTP 503", onRetry: () => { retries++; } });
  assert.equal(body.childNodes.length, 1);
  assert.equal(retries, 0);
  notice.querySelector(".workshop-request-error__retry").click();
  assert.equal(retries, 1);
  assert.equal(body.childNodes.length, 0);
  const second = showWorkshopRequestError({ error: "HTTP 503" });
  second.querySelector(".workshop-request-error__close").click();
  assert.equal(body.childNodes.length, 0);
  showWorkshopRequestError({ error: "HTTP 503" });
  setAPILineState("backup");
  assert.equal(body.childNodes.length, 0);
});

test("metadata API warnings remain visible alongside unrelated transfer warnings or failures", () => {
  const result = getWorkshopMetadataWarning([
    { error: "移动文件失败", warnings: ["缩略图不可用", "获取工坊信息失败 123: 主线路暂时不可用（HTTP 503），请稍后重试"] },
    { warnings: ["获取工坊详情失败 456: 主线路请求超时，请稍后重试"] },
  ]);
  assert.equal(result.count, 2);
  assert.match(result.error, /123/);
  assert.match(result.error, /456/);
  assert.doesNotMatch(result.error, /缩略图|移动文件/);
  assert.equal(getWorkshopMetadataWarning([{ warnings: ["写入 meta 失败"] }]), null);
});
