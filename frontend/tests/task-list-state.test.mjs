import assert from "node:assert/strict";
import test from "node:test";
import { createTaskListStore } from "../src/js/features/downloads/task-list-state.js";

test("new tasks stay above older tasks regardless of download status", () => {
  const store = createTaskListStore();
  store.upsert({ id: "1900000000000000001-9", status: "downloading" });
  store.upsert({ id: "1900000000000000002-10", status: "pending" });
  store.upsert({ id: "1900000000000000002-11", status: "failed" });
  assert.deepEqual(store.values().map((task) => task.id), [
    "1900000000000000002-11", "1900000000000000002-10", "1900000000000000001-9",
  ]);
});

test("late refresh snapshots cannot overwrite newer status or progress events", () => {
  const store = createTaskListStore();
  store.upsert({ id: "1", status: "downloading", progress: 2, title: "mod" });
  const request = store.beginRefresh();
  store.upsert({ id: "1", progress: 50 });
  store.applySnapshot([{ id: "1", status: "pending", progress: 0 }], request);
  assert.deepEqual(store.get("1"), { id: "1", status: "downloading", progress: 50, title: "mod" });
});

test("new task events survive a refresh that started before their arrival", () => {
  const store = createTaskListStore();
  const request = store.beginRefresh();
  store.upsert({ id: "2", status: "pending" });
  store.applySnapshot([], request);
  assert.equal(store.get("2").status, "pending");
});

test("a cleared-task snapshot removes only entries it can authoritatively replace", () => {
  const store = createTaskListStore();
  store.upsert({ id: "1", status: "completed" });
  store.upsert({ id: "2", status: "downloading" });
  const request = store.beginRefresh();
  store.upsert({ id: "2", progress: 30 });
  store.applySnapshot([], request);
  assert.equal(store.get("1"), undefined);
  assert.equal(store.get("2").progress, 30);
});

test("an older request completing last cannot restore removed tasks", () => {
  const store = createTaskListStore();
  const old = store.beginRefresh();
  const current = store.beginRefresh();
  assert.equal(store.applySnapshot([], current), true);
  assert.equal(store.applySnapshot([{ id: "1", status: "completed" }], old), false);
  assert.deepEqual(store.values(), []);
});

test("progress patches preserve task metadata and snapshots can refresh it later", () => {
  const store = createTaskListStore();
  store.upsert({ id: "1", title: "mod", file_url: "https://example.test/mod.vpk", progress: 0 });
  store.upsert({ id: "1", progress: 10 });
  assert.equal(store.get("1").file_url, "https://example.test/mod.vpk");
  const request = store.beginRefresh();
  store.applySnapshot([{ id: "1", title: "renamed", progress: 20 }], request);
  assert.equal(store.get("1").title, "renamed");
  assert.equal(store.get("1").progress, 20);
});
