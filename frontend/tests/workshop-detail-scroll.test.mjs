import assert from "node:assert/strict";
import test from "node:test";
import { getWorkshopDetailScrollTop, restoreWorkshopDetailScroll } from "../src/js/features/workshop/detail-scroll.js";

let frames;
test.beforeEach(() => {
  frames = [];
  globalThis.requestAnimationFrame = (callback) => { frames.push(callback); };
});
test.after(() => { delete globalThis.requestAnimationFrame; });

function view(scrollContent) {
  return { querySelector: (selector) => selector === ".detail-scroll-content" ? scrollContent : null };
}

test("captures the detail's own scroll position, including zero", () => {
  assert.equal(getWorkshopDetailScrollTop(view({ scrollTop: 1842 })), 1842);
  assert.equal(getWorkshopDetailScrollTop(view({ scrollTop: 0 })), 0);
  assert.equal(getWorkshopDetailScrollTop(view(null)), 0);
});

test("restores a returned detail after its content is rendered", () => {
  const content = { scrollTop: 0, isConnected: true };
  restoreWorkshopDetailScroll(view(content), 1842, () => true);
  assert.equal(content.scrollTop, 0);
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(content.scrollTop, 1842);
});

test("a pending restore cannot affect a newer detail or a changed API line", () => {
  const content = { scrollTop: 0, isConnected: true };
  let current = true;
  restoreWorkshopDetailScroll(view(content), 1842, () => current);
  current = false;
  frames.shift()();
  assert.equal(content.scrollTop, 0);
});

test("a detached detail is never scrolled by an old frame", () => {
  const content = { scrollTop: 0, isConnected: true };
  restoreWorkshopDetailScroll(view(content), 1842, () => true);
  content.isConnected = false;
  frames.shift()();
  assert.equal(content.scrollTop, 0);
});

test("returning to a detail at the top restores zero without losing that state", () => {
  const content = { scrollTop: 50, isConnected: true };
  restoreWorkshopDetailScroll(view(content), 0, () => true);
  frames.shift()();
  assert.equal(content.scrollTop, 0);
});

test("new details and absent content do not schedule restoration", () => {
  const content = { scrollTop: 0, isConnected: true };
  for (const position of [undefined, null, NaN, Infinity]) {
    restoreWorkshopDetailScroll(view(content), position, () => true);
  }
  restoreWorkshopDetailScroll(view(null), 100, () => true);
  assert.equal(frames.length, 0);
});
