import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const moduleUrl = new URL("../src/js/features/downloads/task-list.js", import.meta.url).href;
const dependencies = {
  "../../core/toast.js": ["showError", "showNotification"],
  "../modals/confirm.js": ["showConfirmModal"],
  "../file-list/filters.js": ["refreshFilesKeepFilter"],
  "../file-list/operations.js": ["renameFile"],
  "../file-list/tags.js": ["openSetTagsModal"],
  "../../../../wailsjs/go/app/App": ["GetDownloadTasks", "CancelDownloadTask", "RetryDownloadTask", "ClearCompletedTasks"],
};
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === moduleUrl && specifier === "../state.js") {
      return { url: "data:text/javascript,export const appState = { allVpkFiles: [], vpkFiles: [] };", shortCircuit: true };
    }
    if (context.parentURL === moduleUrl && dependencies[specifier]) {
      const source = dependencies[specifier].map((name) =>
        `export const ${name} = (...args) => globalThis.__taskListTest.${name}(...args);`
      ).join("\n");
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const {
  refreshTaskList, updateTaskInList, updateTaskProgress, subscribeToDownloadTasks,
} = await import(moduleUrl);
hooks.deregister();

class Element {
  constructor(tag = "div") {
    this.tagName = tag;
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.className = "";
    this.hidden = false;
    this.classList = { contains: (name) => this.className.split(" ").includes(name) };
    this.listeners = new Map();
  }
  set innerHTML(_) { throw new Error("Task rendering must use DOM nodes"); }
  get firstElementChild() { return this.children[0] || null; }
  get nextElementSibling() {
    const siblings = this.parentElement?.children || [];
    return siblings[siblings.indexOf(this) + 1] || null;
  }
  get offsetTop() { return Math.max(0, this.parentElement?.children.indexOf(this) || 0) * 80; }
  get isConnected() { return this === document.body || Boolean(this.parentElement?.isConnected); }
  append(...nodes) { nodes.forEach((node) => this.appendChild(node)); }
  appendChild(node) { return this.insertBefore(node, null); }
  insertBefore(node, next) {
    node.remove();
    const index = next ? this.children.indexOf(next) : this.children.length;
    this.children.splice(index, 0, node);
    node.parentElement = this;
    return node;
  }
  remove() {
    if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
    this.parentElement = null;
  }
  replaceChildren(...nodes) {
    for (const child of [...this.children]) child.remove();
    this.append(...nodes);
  }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  querySelector(selector) {
    for (const child of this.children) {
      if (selector.startsWith(".") && child.classList.contains(selector.slice(1))) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
  getBoundingClientRect() {
    let ancestor = this;
    while (ancestor) {
      if (ancestor.hidden || ancestor.style.display === "none") return { top: 0, bottom: 0, height: 0 };
      ancestor = ancestor.parentElement;
    }
    const height = this.id === "download-tasks-list" ? this.children.length * 80 : 70;
    return { top: this.offsetTop, bottom: this.offsetTop + height, height };
  }
  animate(keyframes, options) {
    const result = { target: this, keyframes, options, finished: Promise.resolve(), cancel() { this.cancelled = true; } };
    animations.push(result);
    return result;
  }
}

let container;
let requests;
let animations;
let refreshes;
let frames;
let snapshot;
test.beforeEach(async () => {
  const body = new Element("body");
  container = new Element();
  container.id = "download-tasks-list";
  body.appendChild(container);
  const visit = (node, id) => node.id === id ? node : node.children.map((child) => visit(child, id)).find(Boolean);
  globalThis.document = {
    body,
    documentElement: { clientHeight: 900 },
    createElement: (tag) => new Element(tag),
    createElementNS: (_, tag) => new Element(tag),
    getElementById: (id) => visit(body, id),
  };
  globalThis.window = { innerHeight: 900, matchMedia: () => ({ matches: false }) };
  frames = new Map();
  globalThis.requestAnimationFrame = (callback) => { const id = Symbol(); frames.set(id, callback); return id; };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  requests = 0;
  animations = [];
  refreshes = 0;
  snapshot = [];
  globalThis.__taskListTest = {
    GetDownloadTasks: async () => { requests++; return snapshot; },
    refreshFilesKeepFilter: () => refreshes++,
    showError() {}, showNotification() {}, showConfirmModal() {},
    renameFile() {}, openSetTagsModal() {},
    CancelDownloadTask() {}, RetryDownloadTask() {}, ClearCompletedTasks() {},
  };
  await refreshTaskList();
  requests = 0;
});

test.after(() => {
  for (const name of ["document", "window", "requestAnimationFrame", "cancelAnimationFrame", "__taskListTest"]) delete globalThis[name];
});

const task = (id, extra = {}) => ({ id, title: `Mod ${id}`, filename: `${id}.vpk`, status: "pending", progress: 0, ...extra });

test("task totals include every status and only decrease when records are cleared", async () => {
  snapshot = ["pending", "selecting_ip", "downloading", "completed", "failed", "cancelled", "paused"]
    .map((status, index) => task(`count-${index}`, { status }));
  await refreshTaskList();
  const counts = [];
  const unsubscribe = subscribeToDownloadTasks((ids) => counts.push(ids.length));
  assert.deepEqual(counts, [7]);
  updateTaskInList({ id: "count-0", status: "completed" });
  assert.deepEqual(counts, [7]);
  updateTaskInList({ id: "count-4", status: "pending" });
  assert.deepEqual(counts, [7]);
  updateTaskProgress({ id: "count-2", progress: 70 });
  assert.deepEqual(counts, [7], "status and progress updates do not change the total");
  snapshot = [task("count-6", { status: "paused" })];
  await refreshTaskList();
  assert.deepEqual(counts, [7, 1]);
  unsubscribe();
  updateTaskInList(task("count-7"));
  assert.deepEqual(counts, [7, 1]);
});

test("pause and resume keep row identity, lock duplicate actions, and ignore late progress", async (t) => {
  snapshot = [task("pause-1", { status: "downloading", progress: 40 })];
  await refreshTaskList();
  const counts = [];
  t.after(subscribeToDownloadTasks((ids) => counts.push(ids.length)));
  const row = document.getElementById("task-pause-1");
  const pause = row.querySelector(".pause-task-btn");
  const resume = row.querySelector(".resume-task-btn");
  const gate = Promise.withResolvers();
  let pauses = 0;
  let resumes = 0;
  const emit = (patch) => {
    snapshot[0] = { ...snapshot[0], ...patch };
    updateTaskInList(snapshot[0]);
  };
  window.go = { app: { App: {
    PauseDownloadTask: async (id) => {
      assert.equal(id, "pause-1");
      pauses++;
      emit({ status: "pausing" });
      await gate.promise;
      emit({ status: "paused", notice: "已保存的下载进度" });
    },
    ResumeDownloadTask: async () => { resumes++; emit({ status: "downloading", notice: "" }); },
  } } };
  const event = { stopPropagation() {} };
  const pending = pause.listeners.get("click")(event);
  assert.equal(pause.disabled, true);
  assert.equal(row.querySelector(".cancel-task-btn").disabled, true);
  await pause.listeners.get("click")(event);
  assert.equal(pauses, 1);
  updateTaskProgress({ id: "pause-1", status: "downloading", progress: 90 });
  assert.equal(row.dataset.status, "pausing");
  assert.equal(row.querySelector(".task-percent").textContent, "40%");
  gate.resolve();
  await pending;
  assert.equal(document.getElementById("task-pause-1"), row);
  assert.equal(row.querySelector(".task-status").textContent, "已暂停");
  assert.equal(resume.hidden, false);
  assert.equal(pause.hidden, true);
  assert.equal(row.querySelector(".task-notice").textContent, "已保存的下载进度");
  assert.equal(counts.at(-1), 1, "pausing a task keeps it in the total");
  updateTaskProgress({ id: "pause-1", status: "downloading", progress: 95 });
  assert.equal(row.dataset.status, "paused");
  assert.equal(row.querySelector(".task-percent").textContent, "40%");
  await resume.listeners.get("click")(event);
  assert.equal(resumes, 1);
  assert.equal(row.dataset.status, "downloading");
  assert.equal(pause.hidden, false);
  assert.equal(resume.hidden, true);
  assert.equal(counts.at(-1), 1);
});

test("loss-risk pause confirmation can be dismissed without pausing or accepted explicitly", async () => {
  snapshot = [task("pause-risk", { status: "downloading", progress: 42 })];
  await refreshTaskList();
  const row = document.getElementById("task-pause-risk");
  const button = row.querySelector(".pause-task-btn");
  let confirmation;
  let confirmed = 0;
  globalThis.__taskListTest.showConfirmModal = (...args) => { confirmation = args; };
  window.go = { app: { App: {
    PauseDownloadTask: async () => { throw new Error("DOWNLOAD_PAUSE_CONFIRMATION_REQUIRED_KNOWN"); },
    ConfirmPauseDownloadTask: async () => {
      confirmed++;
      snapshot[0] = { ...snapshot[0], status: "paused", progress: 0, notice: "继续时需要重新下载" };
      updateTaskInList(snapshot[0]);
    },
  } } };
  const event = { stopPropagation() {} };
  await button.listeners.get("click")(event);
  assert.equal(button.disabled, true);
  assert.match(confirmation[1], /暂停将清空已下载进度/);
  confirmation[5]();
  assert.equal(button.disabled, false);
  assert.equal(confirmed, 0);
  assert.equal(row.dataset.status, "downloading");
  await refreshTaskList();
  await button.listeners.get("click")(event);
  await confirmation[2]();
  confirmation[5]();
  await refreshTaskList();
  assert.equal(confirmed, 1);
  assert.equal(row.dataset.status, "paused");
  assert.equal(row.querySelector(".task-percent").textContent, "0%");
  assert.equal(row.querySelector(".resume-task-btn").hidden, false);
});

test("restored paused tasks remain in the total and offer resume", async (t) => {
  snapshot = [task("restored", { status: "paused", progress: 65, notice: "重启后已恢复记录" })];
  await refreshTaskList();
  const counts = [];
  t.after(subscribeToDownloadTasks((ids) => counts.push(ids.length)));
  const row = document.getElementById("task-restored");
  assert.equal(row.querySelector(".resume-task-btn").hidden, false);
  assert.equal(row.querySelector(".pause-task-btn").hidden, true);
  assert.equal(row.querySelector(".cancel-task-btn").hidden, false);
  assert.equal(row.querySelector(".task-percent").textContent, "65%");
  assert.equal(row.querySelector(".task-notice").textContent, "重启后已恢复记录");
  assert.deepEqual(counts, [1]);
  updateTaskInList(task("restored", { status: "downloading", progress: 65 }));
  assert.equal(row.querySelector(".task-notice").hidden, true, "an omitted optional notice clears the restored pause message");
  assert.equal(counts.at(-1), 1);
});
function flushFrames() {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((callback) => callback());
}

test("status, progress and full refresh retain the same task and progress nodes", async () => {
  updateTaskInList(task("101"));
  flushFrames();
  const row = document.getElementById("task-101");
  const fill = row.querySelector(".progress-fill");
  updateTaskProgress({ id: "101", progress: 45, downloaded_size: 45, total_size: 100 });
  updateTaskInList(task("101", { status: "completed", progress: 100, file_path: "C:/mods/101.vpk" }));
  snapshot = [task("101", { status: "completed", progress: 100 })];
  await refreshTaskList();
  assert.equal(document.getElementById("task-101"), row);
  assert.equal(row.querySelector(".progress-fill"), fill);
  assert.equal(fill.style.width, "100%");
  assert.equal(row.querySelector(".cancel-task-btn").style.display, "none");
  assert.equal(refreshes, 1);
});

test("unknown task events are batched without requesting full snapshots and animate old rows down", () => {
  updateTaskInList(task("201"));
  flushFrames();
  const row = document.getElementById("task-201");
  updateTaskInList(task("202"));
  updateTaskInList(task("203"));
  assert.equal(frames.size, 1);
  flushFrames();
  assert.equal(requests, 0);
  assert.deepEqual(container.children.map((node) => node.id), ["task-203", "task-202", "task-201"]);
  assert.equal(document.getElementById("task-201"), row);
  assert.equal(animations[0].target, row);
  assert.equal(animations[0].keyframes[0].transform, "translateY(-160px)");
});

test("hidden panels skip list movement measurements and animation", () => {
  updateTaskInList(task("301"));
  flushFrames();
  container.hidden = true;
  updateTaskInList(task("302"));
  flushFrames();
  assert.equal(animations.length, 0);
});

test("task text is rendered as text even when metadata contains markup", () => {
  updateTaskInList(task("501", { title: "<img src=x onerror=alert(1)>", error: "<script>bad</script>" }));
  flushFrames();
  const row = document.getElementById("task-501");
  assert.equal(row.querySelector(".task-title").textContent, "<img src=x onerror=alert(1)>");
  assert.equal(row.querySelector(".task-error").textContent, "<script>bad</script>");
});

test("late snapshots cannot overwrite received progress or restore cleared rows", async () => {
  updateTaskInList(task("601"));
  flushFrames();
  const row = document.getElementById("task-601");
  const oldSnapshot = Promise.withResolvers();
  globalThis.__taskListTest.GetDownloadTasks = () => oldSnapshot.promise;
  const stale = refreshTaskList();
  updateTaskProgress({ id: "601", progress: 75 });
  oldSnapshot.resolve([task("601", { progress: 0 })]);
  await stale;
  assert.equal(document.getElementById("task-601"), row);
  assert.equal(row.querySelector(".task-percent").textContent, "75%");

  const outdated = Promise.withResolvers();
  const current = Promise.withResolvers();
  let calls = 0;
  globalThis.__taskListTest.GetDownloadTasks = () => ++calls === 1 ? outdated.promise : current.promise;
  const olderRefresh = refreshTaskList();
  const newerRefresh = refreshTaskList();
  current.resolve([]);
  await newerRefresh;
  outdated.resolve([task("601")]);
  await olderRefresh;
  assert.equal(document.getElementById("task-601"), undefined);
  assert.equal(container.firstElementChild.className, "empty-tasks");
});

test("reduced motion still inserts and updates new tasks without movement effects", () => {
  window.matchMedia = () => ({ matches: true });
  updateTaskInList(task("701"));
  flushFrames();
  updateTaskInList(task("702"));
  updateTaskInList(task("703"));
  updateTaskProgress({ id: "703", progress: 33 });
  flushFrames();
  assert.deepEqual(container.children.map((node) => node.id), ["task-703", "task-702", "task-701"]);
  assert.equal(document.getElementById("task-703").querySelector(".task-percent").textContent, "33%");
  assert.equal(animations.length, 0);
});
