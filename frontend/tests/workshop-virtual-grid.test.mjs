import assert from "node:assert/strict";
import test from "node:test";
import { getWorkshopRowWindow } from "../src/js/features/workshop/virtual-grid.js";

test("the workshop window jumps to the measured rows at a distant scroll position", () => {
  const offsets = [0, 145, 312, 457, 624, 769, 936, 1081, 1248, 1393];
  assert.deepEqual(getWorkshopRowWindow(offsets, 0, 150), { first: 0, end: 2 });
  assert.deepEqual(getWorkshopRowWindow(offsets, 790, 150), { first: 4, end: 8 });
  assert.deepEqual(getWorkshopRowWindow(offsets, 0, 150), { first: 0, end: 2 });
});

test("the workshop window includes the last partial row without exceeding the row count", () => {
  const offsets = [0, 120, 244.5, 364.5, 495];
  assert.deepEqual(getWorkshopRowWindow(offsets, 380, 80), { first: 2, end: 4 });
  assert.deepEqual(getWorkshopRowWindow(offsets, 600, 80), { first: 3, end: 4 });
  assert.deepEqual(getWorkshopRowWindow([0], 0, 80), { first: 0, end: 0 });
});
