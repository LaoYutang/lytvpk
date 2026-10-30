import assert from "node:assert/strict";
import test from "node:test";
import { createDownloadFlight, DOWNLOAD_FLIGHT_SIZE } from "../src/js/features/downloads/download-flight.js";

const point = (frame) => frame.transform.match(/translate\(([-\d.e]+)px, ([-\d.e]+)px\)/).slice(1).map(Number);
const rect = (left, top) => ({ left, top, width: 20, height: 20 });
const near = (actual, expected) => assert(Math.abs(actual - expected) < 0.00001, `${actual} != ${expected}`);

test("the flight follows a continuous parabola with exact start and end centers", () => {
  const flight = createDownloadFlight(rect(1000, 520), rect(350, 130));
  assert(flight.duration >= 700 && flight.duration <= 850);
  const points = flight.keyframes.map(point);
  assert.deepEqual(points[0], [0, 0]);
  assert.deepEqual(points.at(-1), [-650, -390]);
  near(flight.left + DOWNLOAD_FLIGHT_SIZE / 2, 1010);
  near(flight.top + DOWNLOAD_FLIGHT_SIZE / 2, 530);
  assert(points[30][1] < -390 / 2 - 100, "the arc is visibly above the straight-line path");
  const acceleration = points[2][1] - 2 * points[1][1] + points[0][1];
  assert(acceleration > 0, "the downward acceleration is consistent with a thrown object");
  for (let index = 2; index < points.length; index++) {
    near(points[index][0] - points[index - 1][0], -650 / 60);
    near(points[index][1] - 2 * points[index - 1][1] + points[index - 2][1], acceleration);
  }
});

test("high and short flights keep the badge clear of the title bar", () => {
  for (const [origin, target] of [[rect(1100, 170), rect(350, 130)], [rect(500, 210), rect(370, 80)]]) {
    const flight = createDownloadFlight(origin, target);
    for (const frame of flight.keyframes) {
      const [, y] = point(frame);
      assert(flight.top + y >= 56 - 0.01, "the floating badge stays below the title bar");
    }
  }
});

test("the three trail particles follow previous positions on the same curve and fade out on arrival", () => {
  const flight = createDownloadFlight(rect(900, 500), rect(350, 130));
  assert.equal(flight.trailKeyframes.length, 3);
  const head = point(flight.keyframes[30]);
  const positions = flight.trailKeyframes.map((frames) => point(frames[30]));
  assert(positions[0][0] > 0 && positions[1][0] > positions[0][0] && positions[2][0] > positions[1][0]);
  assert(head[0] + positions[0][0] > head[0]);
  for (const trail of flight.trailKeyframes) {
    assert.equal(trail[0].opacity, 0);
    assert.equal(trail.at(-1).opacity, 0);
    assert(trail[30].opacity > 0);
  }
});
