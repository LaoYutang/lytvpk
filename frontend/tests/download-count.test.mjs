import assert from "node:assert/strict";
import test from "node:test";
import { createDownloadCounter } from "../src/js/features/downloads/download-count.js";

function counter() {
  const changes = [];
  const controller = createDownloadCounter((count, options) => changes.push({ count, ...options }));
  return { controller, changes, value: () => changes.at(-1).count };
}

test("an early creation event counts once when its flight lands", () => {
  const { controller: c, changes, value } = counter();
  c.update(["old"]);
  const token = c.begin();
  c.update(["old", "new"]);
  assert.equal(value(), 1);
  c.accept(token, "new");
  c.finish(token);
  assert.equal(value(), 1);
  c.land(token);
  assert.deepEqual(changes.at(-1), { count: 2, animate: true });
  c.update(["old", "new"]);
  assert.equal(changes.length, 2, "progress and repeated snapshots do not increase the count again");
  c.update(["old"]);
  assert.equal(value(), 1);
});

test("independent flights each release only their own count", () => {
  const { controller: c, value } = counter();
  c.update([]);
  const first = c.begin();
  const second = c.begin();
  c.update(["a", "b"]);
  c.accept(first, "a");
  c.accept(second, "b");
  c.finish(first);
  c.finish(second);
  c.land(first);
  assert.equal(value(), 1);
  c.land(second);
  assert.equal(value(), 2);
});

test("batch totals include accepted tasks created after the flight", () => {
  const { controller: c, value } = counter();
  c.update([]);
  const token = c.begin();
  c.update(["a", "b"]);
  c.accept(token, "a");
  c.accept(token, "b");
  c.land(token);
  assert.equal(value(), 2);
  c.update(["a", "b", "c"]);
  c.accept(token, "c");
  c.finish(token);
  assert.equal(value(), 3);
});

test("a task cleared before arrival is not added back by the animation", () => {
  const { controller: c, value } = counter();
  c.update([]);
  const token = c.begin();
  c.update(["quick"]);
  c.accept(token, "quick");
  c.update([]);
  c.land(token);
  c.finish(token);
  assert.equal(value(), 0);
});

test("cancellation and failed submissions never leave existing records hidden from the total", () => {
  const { controller: c, value } = counter();
  c.update([]);
  const token = c.begin();
  c.update(["created"]);
  c.cancel();
  assert.equal(value(), 1);
  c.accept(token, "created");
  c.finish(token);
  c.land(token);
  assert.equal(value(), 1);
  const failed = c.begin();
  c.update(["created", "unrelated"]);
  assert.equal(value(), 1);
  c.finish(failed);
  assert.equal(value(), 2);
  c.update([]);
  assert.equal(value(), 0);
});

test("a retained task completed before landing still contributes to the total", () => {
  const { controller: c, value } = counter();
  c.update([]);
  const token = c.begin();
  c.update(["quick"]);
  c.accept(token, "quick");
  c.update(["quick"]);
  c.land(token);
  c.finish(token);
  assert.equal(value(), 1);
  c.update([]);
  assert.equal(value(), 0);
});
