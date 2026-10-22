import assert from "node:assert/strict";
import test from "node:test";
import {
  configureSettings,
  invalidateSettingsPageRender,
  renderSettingsPageWithDeps,
} from "../src/js/features/settings/settings.js";

test.afterEach(() => invalidateSettingsPageRender());

test("rapid requests share one unfinished settings render", async () => {
  const gate = Promise.withResolvers();
  let calls = 0;
  let current;
  configureSettings({ renderSettingsPage: async ({ isCurrentRender }) => {
    calls++;
    current = isCurrentRender;
    await gate.promise;
  } });

  const pending = renderSettingsPageWithDeps();
  for (let i = 0; i < 20; i++) assert.equal(renderSettingsPageWithDeps(), pending);
  await Promise.resolve();
  assert.equal(calls, 1);
  gate.resolve();
  await pending;
  assert.equal(current(), true, "completed page remains current for path refreshes");
  await renderSettingsPageWithDeps();
  assert.equal(calls, 2, "a later visit can refresh settings");
});

test("leaving before rendering starts cancels the queued render", async () => {
  let calls = 0;
  configureSettings({ renderSettingsPage: async () => { calls++; } });
  const pending = renderSettingsPageWithDeps();
  invalidateSettingsPageRender();
  await pending;
  assert.equal(calls, 0);
});

test("old completion cannot invalidate or release a newer pending render", async () => {
  const calls = [];
  configureSettings({ renderSettingsPage: ({ isCurrentRender }) => {
    const gate = Promise.withResolvers();
    calls.push({ ...gate, isCurrentRender });
    return gate.promise;
  } });
  const old = renderSettingsPageWithDeps();
  await Promise.resolve();
  invalidateSettingsPageRender();
  const latest = renderSettingsPageWithDeps();
  await Promise.resolve();
  assert.equal(calls[0].isCurrentRender(), false);
  assert.equal(calls[1].isCurrentRender(), true);

  calls[0].resolve();
  await old;
  assert.equal(renderSettingsPageWithDeps(), latest);
  assert.equal(calls[1].isCurrentRender(), true);
  calls[1].resolve();
  await latest;
});

test("late failure from an abandoned page does not surface on the new page", async (t) => {
  const errorLog = t.mock.method(console, "error", () => {});
  const gate = Promise.withResolvers();
  configureSettings({ renderSettingsPage: () => gate.promise });
  const old = renderSettingsPageWithDeps();
  await Promise.resolve();
  invalidateSettingsPageRender();
  configureSettings({ renderSettingsPage: async () => {} });
  await renderSettingsPageWithDeps();
  gate.reject(new Error("old request failed"));
  await old;
  assert.equal(errorLog.mock.callCount(), 0);
});

test("a current render failure is reported and permits retry", async (t) => {
  const errorLog = t.mock.method(console, "error", () => {});
  const failure = new Error("current request failed");
  configureSettings({ renderSettingsPage: async () => { throw failure; } });
  await renderSettingsPageWithDeps();
  assert.equal(errorLog.mock.callCount(), 1);
  assert.equal(errorLog.mock.calls[0].arguments[1], failure);
  let calls = 0;
  configureSettings({ renderSettingsPage: async () => { calls++; } });
  await renderSettingsPageWithDeps();
  assert.equal(calls, 1);
});
