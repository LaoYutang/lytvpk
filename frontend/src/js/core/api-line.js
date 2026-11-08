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

const hiddenAddress = "[地址已隐藏]";
const hiddenCredential = "[凭据已隐藏]";
const maxErrorLength = 8192;
const maxDetailLength = 800;

function isIPv6(value) {
  const address = value.replace(/%[a-z0-9_.-]+$/iu, "");
  if (!address.includes(":")) return false;
  const compressed = address.split("::");
  if (compressed.length > 2) return false;
  let count = 0;
  for (const part of compressed) {
    if (!part) continue;
    const groups = part.split(":");
    for (let index = 0; index < groups.length; index++) {
      const group = groups[index];
      if (/^[0-9a-f]{1,4}$/iu.test(group)) {
        count++;
      } else if (index === groups.length - 1 && /^(?:\d{1,3}\.){3}\d{1,3}$/u.test(group) && group.split(".").every((value) => Number(value) <= 255)) {
        count += 2;
      } else {
        return false;
      }
    }
  }
  return compressed.length === 2 ? count < 8 : count === 8;
}

// This text can also reach older toast callers. Keep it plain text even when
// an upstream exception contains HTML, encoded addresses or credential headers.
function safeErrorText(value) {
  let text = value.slice(0, maxErrorLength);
  const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", colon: ":", sol: "/", commat: "@", period: ".", tab: " ", newline: " " };
  for (let pass = 0; pass < 2; pass++) {
    text = text.replace(/&(#(?:x[0-9a-f]{1,6}|[0-9]{1,7})|amp|lt|gt|quot|apos|colon|sol|commat|period|tab|newline);/giu, (match, entity) => {
      if (entity[0] !== "#") return entities[entity.toLowerCase()];
      const code = entity[1].toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
    });
    text = text.replace(/(?:%[0-9a-f]{2})+/giu, (match) => {
      try { return decodeURIComponent(match); } catch { return match; }
    });
  }
  text = text
    .replace(/\u001b\[[0-9;]*[a-z]/giu, " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu, "")
    .replace(/<\/?[a-z][^>]*(?:>|$)/giu, " ")
    .replace(/<!--[^]*?(?:-->|$)/gu, " ")
    .replace(/\b[a-z][a-z0-9+.-]{0,31}:\/\/[^\s"'<>，；]+/giu, hiddenAddress)
    .replace(/\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*:\s*[^\r\n]+/giu, hiddenCredential)
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;"'<>]+/giu, hiddenCredential)
    .replace(/(?:["']?\b(?:[a-z0-9_-]*(?:token|secret|password|passwd|api[_-]?key|access[_-]?key|private[_-]?key)(?:[_-]?(?:id|key|value))?|pwd|credentials?|session(?:id|[_-]?token)?|signature|authorization|x[_-]?auth|auth|cookie)["']?|令牌|密钥|密码|签名)\s*(?:[:=]\s*|\s+)(?:"(?:\\.|[^"\\])*(?:"|$)|'(?:\\.|[^'\\])*(?:'|$)|[^\s,;，；}\])<>]+)/giu, hiddenCredential)
    .replace(/\b(?:eyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+|(?:gh[pousr]_|github_pat_|sk-)[a-z0-9_-]{16,}|(?:AKIA|ASIA)[A-Z0-9]{16})\b/giu, hiddenCredential)
    .replace(/(\b(?:getaddrinfo\s+(?:ENOTFOUND|EAI_AGAIN)|lookup|dial\s+(?:tcp|udp)|connect(?:ing)?\s+to)\s+)[a-z][a-z0-9_.-]*(?::\d{1,5})?(?=[:\s,;]|$)/giu, `$1${hiddenAddress}`)
    .replace(/(\b(?:host(?:name)?|server(?:name)?)\s*[:=]\s*["']?)[a-z][a-z0-9_.-]*(?::\d{1,5})?(?=["':\s,;]|$)/giu, `$1${hiddenAddress}`)
    .replace(/(?<![\p{L}\p{N}_.+%-])[\p{L}\p{N}_.+%-]+@[\p{L}\p{N}_.-]+(?::\d{1,5})?/gu, hiddenAddress)
    .replace(/\[([0-9a-f:.]+(?:%[a-z0-9_.-]+)?)\](?::\d{1,5})?/giu, (match, address) => isIPv6(address) ? hiddenAddress : match)
    .replace(/[0-9a-f:.]+(?:%[a-z0-9_.-]+)?/giu, (match) => {
      if (isIPv6(match.replace(/\.$/u, ""))) return hiddenAddress;
      if (match.endsWith(":") && isIPv6(match.slice(0, -1))) return `${hiddenAddress}:`;
      if (match.startsWith(":") && isIPv6(match.slice(1))) return `:${hiddenAddress}`;
      return match;
    })
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/gu, hiddenAddress)
    .replace(/(?<![\p{L}\p{N}_-])(?:[\p{L}\p{N}_](?:[\p{L}\p{N}_-]{0,61}[\p{L}\p{N}_])?\.){1,126}(?:[\p{L}]{2,63}|xn--[a-z0-9-]+)\.?(?::\d{1,5})?(?![\p{L}\p{N}_-])/giu, hiddenAddress)
    .replace(/\b[a-z][a-z0-9_-]*:\d{1,5}\b/giu, (match) => /^(?:HTTP|status|code|[a-z_-]*id|batch|item|page|count|retry):/iu.test(match) ? match : hiddenAddress)
    .replace(/\blocalhost\b/giu, hiddenAddress)
    .replace(/</gu, "＜").replace(/>/gu, "＞")
    .replace(/\s+/gu, " ").trim();
  return text;
}

function readableText(value) {
  return value.replace(/\[(?:地址|凭据)已隐藏\]/gu, "").replace(/[\s:：,，;；.。!！?？()（）\[\]{}"'`-]/gu, "");
}

function errorStatus(error, text) {
  for (const value of [error?.status, error?.statusCode, error?.response?.status]) {
    if (Number.isInteger(value) && value >= 100 && value <= 599) return value;
  }
  const match = text.match(/\bHTTP(?:\/\d(?:\.\d)?)?(?:\s+status(?:\s+code)?)?\s*[:：=]?\s*([1-5]\d{2})(?!\d)|\bstatus\s+code\s*[:：=]?\s*([1-5]\d{2})(?!\d)|\b(?:API|request|response|server|upstream)\s+(?:(?:returned|received|responded\s+with|failed\s+with)\s+)?status\s*[:：=]?\s*([1-5]\d{2})(?!\d)/iu);
  return match ? Number(match[1] ?? match[2] ?? match[3]) : null;
}

function retrySeconds(error, raw) {
  if (typeof error?.retryAfterSeconds === "number" && Number.isInteger(error.retryAfterSeconds) && error.retryAfterSeconds >= 0) {
    return Math.min(3600, Math.max(1, error.retryAfterSeconds));
  }
  const match = raw.match(/请至少等待\s+([0-9]{1,4})\s+秒后重试|\bretry-after\s*:\s*([0-9]{1,4})(?=$|[\s,;，；])/iu);
  return match ? Math.min(3600, Math.max(1, Number(match[1] ?? match[2]))) : null;
}

/** Return a translated summary and bounded, redacted original error context. */
export function getAPILineErrorInfo(error, fallback = "请求失败，请稍后重试。") {
  const raw = (typeof error === "string" ? error : typeof error?.message === "string" ? error.message : "").slice(0, maxErrorLength);
  const text = safeErrorText(raw);
  const safeFallback = typeof fallback === "string" ? safeErrorText(fallback).slice(0, 180) : "";
  let message = readableText(safeFallback) ? safeFallback : "请求失败，请稍后重试。";
  const line = text.match(/(主线路|备用线路)(?=请求|暂时不可用|服务|连接)/u)?.[1] ?? null;
  const prefix = line ?? "";
  let status = errorStatus(error, text);
  let kind = "unknown";
  let retryAfterSeconds = null;
  const code = typeof error?.code === "string" ? error.code.slice(0, 80) : "";
  const name = typeof error?.name === "string" ? error.name.slice(0, 80) : "";
  const signals = `${name} ${code} ${text}`;
  const knownMessage = text.match(/(?:主线路|备用线路)(?:请求过于频繁（HTTP 429）(?:，请至少等待\s+[0-9]{1,4}\s+秒后重试|，请稍后重试)?|请求超时（HTTP 504），请稍后重试|暂时不可用（HTTP (?:502|503)），请稍后重试|请求失败（HTTP [1-5]\d{2}），请稍后重试|请求已取消|请求(?:失败|超时)，请稍后重试(?:，或在设置中手动切换(?:主线路|备用线路)后重试)?)/u)?.[0];

  if (/\b(?:AbortError|ECANCELED|ERR_CANCELED)\b|\bcontext cancel(?:led|ed)\b|\b(?:request|operation) (?:was )?(?:cancel(?:led|ed)|aborted)\b|(?:请求|操作)已取消/u.test(signals)) {
    kind = "canceled";
    status = null;
    message = `${prefix}请求已取消。`;
  } else if (/工坊\s*ID不能为空|工坊\s*ID列表包含空项|无效的工坊\s*ID片段|请输入有效的工坊\s*ID|(?:^|:\s*)invalid URL(?:$|[.。\s])|could not find valid workshop ID in URL/iu.test(text)) {
    kind = "validation";
    status = null;
    message = /列表包含空项/u.test(text) ? "工坊 ID 列表包含空项，请检查输入。" : /ID不能为空/u.test(text) ? "请输入工坊 ID。" : /could not find valid workshop ID/iu.test(text) ? "未能从链接中识别工坊 ID。" : /invalid URL/iu.test(text) ? "工坊链接格式不正确。" : "请输入有效的工坊 ID。";
  } else if (status === 429) {
    kind = "rate-limit";
    retryAfterSeconds = retrySeconds(error, raw);
    message = `${prefix}请求过于频繁（HTTP 429），${retryAfterSeconds === null ? "请稍后重试" : `请至少等待${retryAfterSeconds}秒后重试`}。`;
  } else if (status === 408 || status === 504) {
    kind = "timeout";
    message = `${prefix}请求超时（HTTP ${status}），请稍后重试。`;
  } else if (status !== null && status >= 500) {
    kind = "server";
    message = status === 502 || status === 503 ? `${prefix}暂时不可用（HTTP ${status}），请稍后重试。` : `${prefix}服务发生${status === 500 ? "内部" : ""}错误（HTTP ${status}），请稍后重试。`;
  } else if (status !== null && (status < 200 || status >= 300)) {
    kind = "http";
    const descriptions = { 400: "服务未能处理此请求", 401: "请求未获授权", 403: "请求被服务拒绝", 404: "未找到请求的资源", 413: "请求内容过大", 422: "请求内容未通过校验" };
    message = `${prefix}${descriptions[status] ?? "请求返回异常状态"}（HTTP ${status}）。`;
  } else if (/\b(?:ETIMEDOUT|TimeoutError)\b|\bcontext deadline exceeded\b|\bi\/o timeout\b|\b(?:connection|request|read|write|connect|socket) timed out\b|\btimeout of \d+\s*m?s exceeded\b|(?:主线路|备用线路)请求超时/iu.test(signals)) {
    kind = "timeout";
    message = `${prefix}请求超时，请稍后重试。`;
  } else if (/\b(?:ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|EPIPE|ERR_NETWORK|ERR_CONNECTION_[A-Z_]+|NetworkError)\b|\bfailed to fetch\b|\bnetwork request failed\b|\bconnection reset by peer\b|\bno such host\b|\b(?:TLS|SSL) handshake (?:failure|failed|error)\b/iu.test(signals)) {
    kind = "network";
    message = /\b(?:ENOTFOUND|EAI_AGAIN)\b|\bno such host\b/iu.test(signals) ? `${prefix}网络地址解析失败，请检查网络后重试。` : /\bECONNRESET\b|\bconnection reset by peer\b/iu.test(signals) ? `${prefix}连接被中断，请稍后重试。` : `${prefix}网络连接失败，请检查网络后重试。`;
  } else if (/(?:主线路|备用线路)请求失败，请稍后重试/u.test(text)) {
    message = `${prefix}请求失败，请稍后重试。`;
  }

  const detailText = kind === "canceled" || kind === "validation"
    ? text.replace(/(?:[，,；;]\s*)?(?:请稍后重试|或?请?(?:在设置中)?(?:手动)?切换(?:主线路|备用线路|线路)(?:后重试)?|\b(?:please\s+)?(?:try again|retry)(?: later)?\b)/giu, "")
    : text;
  const additional = knownMessage ? detailText.replace(knownMessage, "") : detailText;
  const comparable = (value) => value.replace(/[\s。.!！]/gu, "");
  let detail = readableText(additional) && comparable(detailText) !== comparable(message) ? detailText : "";
  if (detail.length > maxDetailLength) detail = `${detail.slice(0, maxDetailLength - 1)}…`;
  return { message, detail, kind, status, line, retryAfterSeconds };
}

// Keep the summary API for existing callers, including plain-text toast output.
export function formatAPILineError(error, fallback) {
  const { message, detail, kind } = getAPILineErrorInfo(error, fallback);
  return kind === "unknown" && detail ? `${message}\n${detail}` : message;
}
