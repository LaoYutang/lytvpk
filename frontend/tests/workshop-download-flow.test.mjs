import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const modalUrl = new URL("../src/js/features/downloads/workshop-modal.js", import.meta.url).href;
const importNames = {
  "../../core/ui-shell.js": ["switchAppPage"],
  "../../core/toast.js": ["showError", "showNotification", "showInfo"],
  "../../core/config.js": ["getConfig"],
  "../../core/utils.js": ["escapeHtml"],
  "./task-list.js": ["refreshTaskList"],
  "./workshop-history.js": ["closeWorkshopHistory", "recordWorkshopHistory"],
  "./downloads-page.js": [
    "selectDownloadsTab", "captureDownloadOrigin", "beginDownloadSubmission",
    "notifyDownloadTaskCreated", "finishDownloadSubmission", "cancelDownloadFeedback",
  ],
  "../../../../wailsjs/go/app/App": [
    "GetWorkshopDetailsGrouped", "StartDownloadTask", "IsSelectingIP",
  ],
};

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === modalUrl && importNames[specifier]) {
      const source = importNames[specifier].map((name) =>
        `export const ${name} = (...args) => globalThis.__workshopFlowTest.${name}(...args);`
      ).join("\n");
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { openWorkshopParse, checkWorkshopUrl, applyWorkshopGroups, downloadWorkshopFile, updateDownloadButtonLabel } =
  await import(modalUrl);
hooks.deregister();

class Element {
  constructor() {
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
    };
    this.childNodes = [];
    this.attributes = new Map();
    this.dataset = {};
    this.value = "";
    this.disabled = false;
    this.nodes = new Map();
    this.listeners = new Map();
  }
  set innerHTML(value) { this.html = value; this.childNodes = []; }
  get innerHTML() { return this.html || ""; }
  replaceChildren(...nodes) { this.childNodes = nodes; }
  appendChild(node) { this.childNodes.push(node); return node; }
  querySelector(selector) {
    if (!this.nodes.has(selector)) this.nodes.set(selector, new Element());
    return this.nodes.get(selector);
  }
  querySelectorAll() { return []; }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  click() { return this.listeners.get("click")?.({ currentTarget: this }); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  focus() { this.focused = true; }
}

let elements;
let calls;
let config;
test.beforeEach(() => {
  elements = new Map();
  globalThis.document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    },
    createElement: () => new Element(),
    createTextNode: (text) => ({ textContent: text }),
  };
  calls = { errors: [], info: [], created: [], history: [], tabs: [], tasks: [], finished: [] };
  config = { workshopPreferredIP: false };
  globalThis.__workshopFlowTest = {
    switchAppPage() {},
    showError: (value) => calls.errors.push(value),
    showInfo: (value) => calls.info.push(value),
    showNotification() {},
    getConfig: () => config,
    escapeHtml: (value) => String(value),
    refreshTaskList() {},
    closeWorkshopHistory() {},
    recordWorkshopHistory: (groups) => calls.history.push(groups),
    selectDownloadsTab: (tab) => calls.tabs.push(tab),
    captureDownloadOrigin: (button) => ({ button }),
    beginDownloadSubmission: (origin) => ({ origin }),
    notifyDownloadTaskCreated: (context, id) => calls.created.push({ context, id }),
    finishDownloadSubmission: (context) => calls.finished.push(context),
    cancelDownloadFeedback() {},
    GetWorkshopDetailsGrouped: async () => ({ groups: [] }),
    StartDownloadTask: async (details, optimized) => {
      calls.tasks.push({ details, optimized });
      return `task-${calls.tasks.length}`;
    },
    IsSelectingIP: async () => false,
  };
  applyWorkshopGroups([]);
  calls.errors.length = 0;
});

test.after(() => {
  delete globalThis.__workshopFlowTest;
  delete globalThis.document;
});

function input(id) { return document.getElementById(id); }
function item(id) {
  return {
    publishedfileid: id, result: 1, title: `File ${id}`, filename: `${id}.vpk`,
    file_url: `https://example.com/${id}.vpk`, file_size: "100", preview_url: "",
  };
}
function group(id) { return { root_id: id, main: item(id), items: [item(id)] }; }
async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

test("new parse opens the parse tab immediately and older responses cannot replace it", async () => {
  const old = Promise.withResolvers();
  const latest = Promise.withResolvers();
  globalThis.__workshopFlowTest.GetWorkshopDetailsGrouped =
    (url) => url === "111111" ? old.promise : latest.promise;
  const first = openWorkshopParse("111111");
  const second = openWorkshopParse("222222");
  assert.equal(input("workshop-url").value, "222222");
  assert.deepEqual(calls.tabs, ["parse", "parse"]);
  latest.resolve({ groups: [group("222222")] });
  await second;
  old.resolve({ groups: [group("111111")] });
  await first;
  assert.deepEqual(calls.history.map((groups) => groups[0].root_id), ["222222"]);
  assert.equal(input("check-workshop-btn").disabled, false);
  assert.equal(input("workshop-result").childNodes.length, 1);
});

test("an old parse failure is ignored while a newer request owns the button", async () => {
  const old = Promise.withResolvers();
  const latest = Promise.withResolvers();
  globalThis.__workshopFlowTest.GetWorkshopDetailsGrouped =
    (url) => url === "333333" ? old.promise : latest.promise;
  const first = openWorkshopParse("333333");
  const second = openWorkshopParse("444444");
  old.reject(new Error("stale failure"));
  await first;
  assert.equal(input("check-workshop-btn").disabled, true);
  assert.deepEqual(calls.errors, []);
  latest.resolve({ groups: [group("444444")] });
  await second;
  assert.equal(input("check-workshop-btn").disabled, false);
});

test("editing input or restoring history prevents a pending parse from replacing visible results", async () => {
  const pending = Promise.withResolvers();
  globalThis.__workshopFlowTest.GetWorkshopDetailsGrouped = () => pending.promise;
  input("workshop-url").value = "555555";
  const parsing = checkWorkshopUrl();
  input("workshop-url").value = "666666";
  applyWorkshopGroups([group("666666")]);
  pending.resolve({ groups: [group("555555")] });
  await parsing;
  assert.deepEqual(calls.history, []);
  await downloadWorkshopFile();
  assert.equal(calls.tasks[0].details.publishedfileid, "666666");
});

test("download locks the button synchronously and snapshots direct URL and config before waiting", async () => {
  const selection = Promise.withResolvers();
  globalThis.__workshopFlowTest.IsSelectingIP = () => selection.promise;
  input("download-url").value = "https://example.com/original.vpk";
  config.workshopPreferredIP = true;
  const downloading = downloadWorkshopFile();
  assert.equal(input("download-workshop-btn").disabled, true);
  assert.equal(await downloadWorkshopFile(), 0, "a repeated submission is ignored");
  input("download-url").value = "https://example.com/changed.vpk";
  config.workshopPreferredIP = false;
  selection.resolve(false);
  assert.equal(await downloading, 1);
  assert.equal(calls.tasks.length, 1);
  assert.equal(calls.tasks[0].details.file_url, "https://example.com/original.vpk");
  assert.equal(calls.tasks[0].optimized, true);
  assert.equal(input("download-url").value, "https://example.com/changed.vpk");
  assert.equal(input("download-workshop-btn").disabled, false);
  assert.equal(calls.created[0].id, "task-1");
  assert.equal(calls.finished.length, 1);
});

test("a manual direct URL takes priority over preserved parse results and clearing it restores batch downloads", async () => {
  applyWorkshopGroups([group("995555"), group("996666")]);
  await downloadWorkshopFile();
  calls.tasks.length = 0;
  input("download-url").value = "https://example.com/new-file.vpk";
  updateDownloadButtonLabel();
  assert.equal(input("download-workshop-btn").querySelector("span").textContent, "下载");
  assert.equal(await downloadWorkshopFile(), 1);
  assert.equal(calls.tasks.length, 1);
  assert.equal(calls.tasks[0].details.file_url, "https://example.com/new-file.vpk");
  assert.match(calls.tasks[0].details.publishedfileid, /^direct-/);
  assert.equal(input("workshop-result").childNodes.length, 2, "parsed groups remain available");
  input("download-url").value = "";
  updateDownloadButtonLabel();
  assert.equal(input("download-workshop-btn").querySelector("span").textContent, "全部下载");
  calls.tasks.length = 0;
  assert.equal(await downloadWorkshopFile(), 2);
  assert.deepEqual(calls.tasks.map((task) => task.details.publishedfileid), ["995555", "996666"]);
});

test("IP selection polling retains the submitted items even when a new parse arrives", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let selecting = true;
  globalThis.__workshopFlowTest.IsSelectingIP = async () => selecting;
  applyWorkshopGroups([group("777777")]);
  const downloading = downloadWorkshopFile();
  await settle();
  assert.equal(calls.tasks.length, 0);
  applyWorkshopGroups([group("888888")]);
  selecting = false;
  t.mock.timers.tick(1000);
  await downloading;
  assert.equal(calls.tasks[0].details.publishedfileid, "777777");
});

test("first created task is announced before the rest of a batch finishes and results remain available", async () => {
  const secondTask = Promise.withResolvers();
  applyWorkshopGroups([group("999991"), group("999992")]);
  globalThis.__workshopFlowTest.StartDownloadTask = async (details) => {
    calls.tasks.push({ details });
    return calls.tasks.length === 1 ? "first-task" : secondTask.promise;
  };
  const downloading = downloadWorkshopFile();
  await settle();
  assert.equal(calls.created.length, 1);
  assert.equal(calls.created[0].id, "first-task");
  assert.equal(input("download-workshop-btn").disabled, true);
  secondTask.resolve("second-task");
  assert.equal(await downloading, 2);
  assert.deepEqual(calls.created.map((entry) => entry.id), ["first-task", "second-task"]);
  assert.equal(calls.created[0].context, calls.created[1].context);
  assert.equal(input("workshop-result").classList.contains("hidden"), false);
  assert.equal(input("workshop-result").childNodes.length, 2);
});

test("partially accepted batches report counts and only accepted task IDs trigger feedback", async (t) => {
  t.mock.method(console, "error", () => {});
  applyWorkshopGroups([group("991111"), group("992222")]);
  globalThis.__workshopFlowTest.StartDownloadTask = async (details) => {
    if (details.publishedfileid === "991111") throw new Error("bridge unavailable");
    return "accepted-task";
  };
  assert.equal(await downloadWorkshopFile(), 1);
  assert.deepEqual(calls.created.map((entry) => entry.id), ["accepted-task"]);
  assert.match(calls.info[0], /已添加 1 个任务，1 个任务添加失败/);
  assert.deepEqual(calls.errors, []);
});

test("group and single-item actions submit the intended items and preserve their animation origins", async () => {
  const groupButton = new Element();
  groupButton.dataset.groupIndex = "0";
  const itemButton = new Element();
  itemButton.dataset = { groupIndex: "0", itemIndex: "1" };
  const result = input("workshop-result");
  result.querySelectorAll = (selector) => {
    if (selector === ".download-group-btn") return [groupButton];
    if (selector === ".download-item-btn") return [itemButton];
    return [];
  };
  applyWorkshopGroups([{
    root_id: "993333", main: item("993333"), items: [item("993333"), item("994444")],
  }]);
  await groupButton.click();
  assert.deepEqual(calls.tasks.map((task) => task.details.publishedfileid), ["993333", "994444"]);
  assert.equal(calls.created[0].context.origin.button, groupButton);
  await itemButton.click();
  assert.equal(calls.tasks[2].details.publishedfileid, "994444");
  assert.equal(calls.created[2].context.origin.button, itemButton);
  assert.equal(result.classList.contains("hidden"), false);
});

test("failed submissions release the button and never trigger task navigation", async (t) => {
  t.mock.method(console, "error", () => {});
  input("download-url").value = "https://example.com/failure.vpk";
  globalThis.__workshopFlowTest.StartDownloadTask = async () => { throw new Error("failed"); };
  assert.equal(await downloadWorkshopFile(), 0);
  assert.deepEqual(calls.created, []);
  assert.equal(input("download-workshop-btn").disabled, false);
  assert.equal(calls.finished.length, 1);
  assert.match(calls.errors[0], /添加任务失败/);
  assert.equal(input("download-url").value, "https://example.com/failure.vpk");
});
