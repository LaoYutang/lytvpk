import assert from "node:assert/strict";
import test from "node:test";

const images = Array.from({ length: 12 }, (_, index) => `preview-${index}.jpg`);
const image = {};
const modal = Object.assign(new EventTarget(), {
  style: {},
  querySelector: (selector) => selector === ".image-modal-close" ? {} : null,
});
const elements = new Map([["image-preview-modal", modal], ["full-image", image]]);
globalThis.document = Object.assign(new EventTarget(), {
  getElementById: (id) => elements.get(id),
});
globalThis.window = {};
globalThis.WheelEvent = { DOM_DELTA_LINE: 1, DOM_DELTA_PAGE: 2 };
const { setWorkshopPreviewImages } = await import("../src/js/features/workshop/detail-images.js");
document.dispatchEvent(new Event("DOMContentLoaded"));

test.beforeEach(() => {
  setWorkshopPreviewImages(images);
  window.openFullImage(images[0]);
});

function wheel(deltaY, timeStamp, ctrlKey = false) {
  const event = Object.assign(new Event("wheel", { bubbles: true, cancelable: true }), {
    deltaX: 0, deltaY, deltaMode: 0, ctrlKey,
  });
  Object.defineProperty(event, "timeStamp", { value: timeStamp });
  modal.dispatchEvent(event);
  return event;
}

test("a steadily decaying touchpad tail stays on the first new image", () => {
  wheel(64, 0);
  assert.equal(image.src, images[1]);
  for (let step = 1; step < 64; step++) {
    wheel(64 - step, step * 16);
    assert.equal(image.src, images[1]);
  }
});

test("rounded one-pixel momentum events do not start a second turn", () => {
  const deltas = [120, 80, 50, 24, 12, 6, 3, 2, 1, ...Array(20).fill(1)];
  deltas.forEach((delta, index) => {
    wheel(delta, index * 16);
    assert.equal(image.src, images[1]);
  });
});

test("sustained lower wheel input resumes paging after an initial peak", () => {
  [120, 80, 50].forEach((distance, index) => wheel(distance, index * 40));
  assert.equal(image.src, images[1]);
  for (let time = 120; time <= 1000; time += 40) wheel(24, time);
  assert.ok(images.indexOf(image.src) >= 2);
});

test("each regular mouse wheel notch 60 ms apart advances once", () => {
  for (let step = 0; step < 6; step++) {
    const event = wheel(100, step * 60);
    assert.equal(image.src, images[step + 1]);
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.cancelBubble, true);
  }
});

test("Ctrl-wheel and wheel outside fullscreen are left to the browser", () => {
  const zoom = wheel(100, 0, true);
  assert.equal(image.src, images[0]);
  assert.equal(zoom.defaultPrevented, false);
  assert.equal(zoom.cancelBubble, false);

  modal.style.display = "none";
  const hidden = wheel(100, 60);
  assert.equal(image.src, images[0]);
  assert.equal(hidden.defaultPrevented, false);
  assert.equal(hidden.cancelBubble, false);
});
