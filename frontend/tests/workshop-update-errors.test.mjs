import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { getAPILineSnapshot, isCurrentAPILine, setAPILineState } from '../src/js/core/api-line.js';

const settings = await readFile(new URL('../src/js/features/settings/settings-page.js', import.meta.url), 'utf8');
const runtime = await readFile(new URL('../src/js/features/app-runtime.js', import.meta.url), 'utf8');
// Execute the actual production blocks with local bridge and DOM fixtures.
const manualSource = settings.slice(settings.lastIndexOf('  const manualCheckBtn = document.getElementById("settings-manual-check-btn");'), settings.indexOf('\n  document.querySelectorAll(\'input[name="settings-browser-target"]\')'));
const scheduledSource = runtime.slice(runtime.indexOf('let _updateCheckPending = false;'), runtime.indexOf('\nasync function initUpdateCheck()'));

function harness(mode) {
  const notices = [], notifications = [], saved = [];
  const config = { lastUpdateCheckTime: 'preserved', workshopUpdateCheckEnabled: true, workshopMetaEnabled: true };
  const button = { childNodes: [{ textContent: '立即触发检测' }], isConnected: true, disabled: false, style: {}, replaceChildren(...nodes) { this.childNodes = nodes; }, addEventListener() {} };
  const document = { getElementById() { return button; }, createElement() { return {}; }, createTextNode(text) { return { textContent: text }; } };
  let response = { failed_count: 1, first_error: '主线路请求失败（HTTP 500），请稍后重试', total_updates: 0, line: 'primary' };
  let calls = 0, refreshes = 0;
  const check = async () => { calls++; return typeof response === 'function' ? response() : response; };
  const common = { document, getAPILineSnapshot, isCurrentAPILine, showWorkshopRequestError(options) { notices.push(options); }, getConfig() { return config; }, saveConfig(value) { saved.push({ ...value }); }, CheckModUpdates: check };
  const context = vm.createContext(common);
  if (mode === 'manual') {
    context.deps = { ...common, showNotification(...args) { notifications.push(args); }, async refreshFilesKeepFilter() { refreshes++; } };
    vm.runInContext(`function install(deps) { ${manualSource}\nreturn runManualUpdateCheck; } globalThis.run = install(deps);`, context);
  } else {
    vm.runInContext(`${scheduledSource}\nglobalThis.run = runScheduledWorkshopUpdateCheck;`, context);
  }
  return { run: context.run, notices, notifications, saved, config, button, setResponse(value) { response = value; }, get calls() { return calls; }, get refreshes() { return refreshes; } };
}

for (const mode of ['manual', 'scheduled']) {
  test(`${mode}: partial failure keeps success time and awaits explicit retry`, async () => {
    setAPILineState('primary');
    const h = harness(mode);
    await h.run();
    assert.equal(h.calls, 1);
    assert.equal(h.config.lastUpdateCheckTime, 'preserved');
    assert.equal(h.saved.length, 0);
    assert.equal(h.notifications.length, 0);
    assert.equal(h.notices.length, 1);
    assert.equal(h.notices[0].title, '更新检查未完成');
    assert.match(h.notices[0].error, /HTTP 500/);
    assert.equal(h.notices[0].retryLabel, '重新检查');
    await Promise.resolve();
    assert.equal(h.calls, 1, 'no automatic retry');
    h.setResponse({ failed_count: 0, total_updates: 2, new_detected: 1, line: 'primary' });
    await h.notices[0].onRetry();
    assert.equal(h.calls, 2);
    assert.equal(h.saved.length, 1);
    assert.notEqual(h.config.lastUpdateCheckTime, 'preserved');
    if (mode === 'manual') assert.match(h.notifications[0][0], /发现 2 个Mod有更新/);
  });

  test(`${mode}: bridge rejection shows persistent error without successful timestamp`, async () => {
    setAPILineState('primary');
    const h = harness(mode);
    const failure = new Error('主线路请求超时，请稍后重试');
    h.setResponse(() => { throw failure; });
    await h.run();
    assert.equal(h.notices.length, 1);
    assert.equal(h.notices[0].error, failure);
    assert.equal(h.saved.length, 0);
  });

  test(`${mode}: absent result cannot claim latest or save successful timestamp`, async () => {
    setAPILineState('primary');
    const h = harness(mode);
    h.setResponse(undefined);
    await h.run();
    assert.equal(h.notices.length, 1);
    assert.equal(h.saved.length, 0);
    assert.equal(h.notifications.length, 0);
  });

  test(`${mode}: ABA line changes suppress stale result and timestamp`, async () => {
    setAPILineState('primary');
    const h = harness(mode);
    const gate = Promise.withResolvers();
    h.setResponse(() => gate.promise);
    const pending = h.run();
    setAPILineState('backup');
    setAPILineState('primary');
    gate.resolve({ failed_count: 0, total_updates: 0, line: 'primary' });
    await pending;
    assert.equal(h.notices.length, 0);
    assert.equal(h.notifications.length, 0);
    assert.equal(h.saved.length, 0);
    if (mode === 'manual') assert.equal(h.button.disabled, false);
  });

  test(`${mode}: concurrent UI actions do not launch duplicate checks`, async () => {
    setAPILineState('primary');
    const h = harness(mode);
    const gate = Promise.withResolvers();
    h.setResponse(() => gate.promise);
    const first = h.run();
    await h.run();
    assert.equal(h.calls, 1);
    gate.resolve({ failed_count: 0, total_updates: 0, line: 'primary' });
    await first;
    assert.equal(h.saved.length, 1);
  });
}

for (const setting of ['workshopUpdateCheckEnabled', 'workshopMetaEnabled']) {
  test(`scheduled: disabling ${setting} before the timer callback skips the check`, async () => {
    setAPILineState('primary');
    const h = harness('scheduled');
    h.config[setting] = false;
    await h.run();
    assert.equal(h.calls, 0);
    assert.equal(h.notices.length, 0);
    assert.equal(h.saved.length, 0);
    assert.equal(h.config.lastUpdateCheckTime, 'preserved');
  });

  for (const outcome of ['success', 'partial failure', 'bridge rejection']) {
    test(`scheduled: disabling ${setting} while awaiting ${outcome} suppresses feedback and success time`, async () => {
      setAPILineState('primary');
      const h = harness('scheduled');
      const gate = Promise.withResolvers();
      h.setResponse(() => gate.promise);
      const pending = h.run();
      assert.equal(h.calls, 1);
      h.config[setting] = false;
      if (outcome === 'bridge rejection') {
        gate.reject(new Error('工坊更新检查未启动，请先启用工坊信息与更新检测'));
      } else {
        gate.resolve(outcome === 'success'
          ? { failed_count: 0, total_updates: 0, new_detected: 0, line: 'primary' }
          : { failed_count: 1, total_updates: 0, first_error: '工坊更新检查未启动，请先启用工坊信息与更新检测', line: 'primary' });
      }
      await pending;
      await Promise.resolve();
      assert.equal(h.calls, 1, 'turning a feature off must not schedule a retry');
      assert.equal(h.notices.length, 0);
      assert.equal(h.notifications.length, 0);
      assert.equal(h.saved.length, 0);
      assert.equal(h.config.lastUpdateCheckTime, 'preserved');
    });
  }
}
