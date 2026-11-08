let line = "primary";
let generation = 0;
const listeners = new Set();

export function normalizeAPILine(value) {
  return value === "backup" ? "backup" : "primary";
}

export function getAPILineSnapshot() {
  return { line, generation };
}

export function isCurrentAPILine(snapshot) {
  return snapshot.line === line && snapshot.generation === generation;
}

export function setAPILineState(value) {
  const next = normalizeAPILine(value);
  if (next === line) return getAPILineSnapshot();
  line = next;
  generation++;
  const snapshot = getAPILineSnapshot();
  for (const listener of listeners) listener(snapshot);
  return snapshot;
}

export function subscribeAPILineChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Rebuild only the backend's known public error categories. A bridge error can
// contain surrounding transport details; none of that text is returned here.
export function formatAPILineError(error, fallback) {
  const message = typeof error === "string" ? error : typeof error?.message === "string" ? error.message : "";
  const limited = message.match(/(主线路|备用线路)请求过于频繁（HTTP 429）(?:，请至少等待 ([0-9]{1,4}) 秒后重试)?/u);
  if (limited) {
    const wait = limited[2] === undefined ? null : Math.min(3600, Math.max(1, Number(limited[2])));
    return `${limited[1]}请求过于频繁（HTTP 429），${wait === null ? "请稍后重试" : `请至少等待${wait}秒后重试`}。`;
  }
  const timeout = message.match(/(主线路|备用线路)请求超时（HTTP 504）/u);
  if (timeout) return `${timeout[1]}请求超时（HTTP 504），请稍后重试。`;
  const unavailable = message.match(/(主线路|备用线路)暂时不可用（HTTP (502|503)）/u);
  if (unavailable) return `${unavailable[1]}暂时不可用（HTTP ${unavailable[2]}），请稍后重试。`;
  const canceled = message.match(/(主线路|备用线路)请求已取消/u);
  if (canceled) return `${canceled[1]}请求已取消。`;
  const failed = message.match(/(主线路|备用线路)(请求失败|请求超时)，请稍后重试(?:，或在设置中手动切换(?:主线路|备用线路)后重试)?/u);
  if (failed) return `${failed[1]}${failed[2]}，请稍后重试。`;
  return fallback;
}
