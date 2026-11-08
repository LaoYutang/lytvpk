import assert from "node:assert/strict";
import test from "node:test";
import { formatAPILineError, getAPILineErrorInfo } from "../src/js/core/api-line.js";

const fallback = "加载失败，请稍后重试。";
const privatePrefix = "https://private.invalid/path?token=secret-token 192.0.2.10 <script> ";
const privateSuffix = " https://another.invalid/203.0.113.9 token=other-secret </script>";

test("known line errors are rebuilt without surrounding addresses, tokens or markup", () => {
  const cases = [
    ["备用线路请求过于频繁（HTTP 429），请至少等待 17 秒后重试", "备用线路请求过于频繁（HTTP 429），请至少等待17秒后重试。"],
    ["主线路请求过于频繁（HTTP 429），请稍后重试", "主线路请求过于频繁（HTTP 429），请稍后重试。"],
    ["备用线路请求超时（HTTP 504），请稍后重试", "备用线路请求超时（HTTP 504），请稍后重试。"],
    ["主线路暂时不可用（HTTP 502），请稍后重试", "主线路暂时不可用（HTTP 502），请稍后重试。"],
    ["备用线路暂时不可用（HTTP 503），请稍后重试", "备用线路暂时不可用（HTTP 503），请稍后重试。"],
    ["备用线路请求失败，请稍后重试，或在设置中手动切换主线路后重试", "备用线路请求失败，请稍后重试。"],
    ["主线路请求超时，请稍后重试，或在设置中手动切换备用线路后重试", "主线路请求超时，请稍后重试。"],
  ];
  for (const [message, expected] of cases) {
    for (const value of [message, new Error(privatePrefix + message + privateSuffix), privatePrefix + message + privateSuffix]) {
      assert.equal(formatAPILineError(value, fallback), expected);
      assert.doesNotMatch(formatAPILineError(value, fallback), /https?:|invalid|token|secret|\d+\.\d+\.|<|>/i);
    }
  }
});

test("retry hints are restricted to bounded numeric seconds", () => {
  const formatted = (wait) => formatAPILineError(`主线路请求过于频繁（HTTP 429），请至少等待 ${wait} 秒后重试`, fallback);
  assert.match(formatted("0"), /等待1秒/);
  assert.match(formatted("9999"), /等待3600秒/);
  for (const wait of ["99999999999999999999", "-3", "3.5", "https://private.invalid/", "token", "3<script>"]) {
    assert.equal(formatted(wait), "主线路请求过于频繁（HTTP 429），请稍后重试。");
  }
});

test("cancellation has no switch or retry advice", () => {
  assert.equal(formatAPILineError(new Error(privatePrefix + "备用线路请求已取消" + privateSuffix), fallback), "备用线路请求已取消。");
  for (const error of ["context canceled", { name: "AbortError", message: "The operation was aborted" }, { code: "ERR_CANCELED", message: "canceled" }]) {
    const info = getAPILineErrorInfo(error, fallback);
    assert.equal(info.kind, "canceled");
    assert.doesNotMatch(info.message, /重试|切换/u);
    assert.equal(info.status, null);
    assert.equal(info.retryAfterSeconds, null);
  }
});

test("empty and privacy-only errors use a safe fallback", () => {
  for (const error of [privatePrefix, null, {}, { message: 42 }]) {
    assert.equal(formatAPILineError(error, fallback), fallback);
  }
  assert.deepEqual(getAPILineErrorInfo(null, fallback), { message: fallback, detail: "", kind: "unknown", status: null, line: null, retryAfterSeconds: null });
  const info = getAPILineErrorInfo(null, "https://private.invalid/?token=secret <img src=x>");
  assert.equal(info.message, "请求失败，请稍后重试。");
  assert.equal(info.detail, "");
});

test("HTTP errors retain the status and accurately translated explanation", () => {
  const cases = [
    [429, "rate-limit", /请求过于频繁/u],
    [500, "server", /服务发生内部错误/u],
    [501, "server", /服务发生错误/u],
    [502, "server", /暂时不可用/u],
    [503, "server", /暂时不可用/u],
    [504, "timeout", /请求超时/u],
    [400, "http", /未能处理/u],
    [401, "http", /未获授权/u],
    [403, "http", /被服务拒绝/u],
    [404, "http", /未找到请求的资源/u],
    [408, "timeout", /请求超时/u],
    [413, "http", /请求内容过大/u],
    [422, "http", /未通过校验/u],
    [418, "http", /异常状态/u],
    [302, "http", /异常状态/u],
  ];
  for (const [status, kind, description] of cases) {
    for (const error of [`主线路请求失败（HTTP ${status}），请稍后重试`, `request failed with HTTP ${status}`, { message: "request rejected", status }, { message: `status code: ${status}` }]) {
      const info = getAPILineErrorInfo(error, fallback);
      assert.equal(info.kind, kind);
      assert.equal(info.status, status);
      assert.match(info.message, description);
      assert.match(info.message, new RegExp(`HTTP ${status}`));
    }
  }
  assert.equal(getAPILineErrorInfo("备用线路请求失败（HTTP 500）", fallback).line, "备用线路");
  assert.equal(getAPILineErrorInfo("未知线路请求超时（HTTP 504）", fallback).line, null);
  assert.equal(getAPILineErrorInfo({ response: { status: 503 } }, fallback).status, 503);
  const returnedStatus = getAPILineErrorInfo("API returned status: 500; https://private.invalid/request 203.0.113.9", fallback);
  assert.equal(returnedStatus.status, 500);
  assert.equal(returnedStatus.kind, "server");
  assert.match(returnedStatus.message, /内部错误（HTTP 500）/u);
  assert.match(returnedStatus.detail, /API returned status: 500/u);
  assert.doesNotMatch(returnedStatus.detail, /private|203\.0\.113/u);
  for (const status of [200, 201, 204]) {
    const info = getAPILineErrorInfo(`batch 2 / workshop ID 123 (v2.10.0): HTTP ${status}, invalid character 'x'`, fallback);
    assert.equal(info.kind, "unknown");
    assert.equal(info.status, status);
    assert.doesNotMatch(info.message, /异常状态/u);
    assert.match(info.detail, /batch 2 \/ workshop ID 123 \(v2\.10\.0\).*invalid character/u);
  }
});

test("numbers in payloads, IDs, URLs and credential values are not HTTP evidence", () => {
  for (const error of [
    "解析工坊 ID 429 失败: item number 500，批次 504",
    "unknown code 429 after loading item 503",
    "status code: 4290",
    "HTTP 5030",
    "item status: 500",
    "status: 500",
    "request failed with 429",
    "https://private.invalid/HTTP%20429?token=secret",
    "token='HTTP 429'",
    { message: "unknown error", status: "429" },
    { message: "unknown error", status: 600 },
  ]) {
    const info = getAPILineErrorInfo(error, fallback);
    assert.equal(info.kind, "unknown");
    assert.equal(info.status, null);
    assert.equal(info.retryAfterSeconds, null);
  }
});

test("common transport errors are translated only with explicit signals", () => {
  const cases = [
    ["read: ETIMEDOUT", "timeout", /请求超时/u],
    ["context deadline exceeded", "timeout", /请求超时/u],
    ["read tcp: i/o timeout", "timeout", /请求超时/u],
    [{ name: "TimeoutError", message: "operation failed" }, "timeout", /请求超时/u],
    [{ code: "ECONNRESET", message: "read failed" }, "network", /连接被中断/u],
    ["connection reset by peer", "network", /连接被中断/u],
    ["getaddrinfo ENOTFOUND private.invalid", "network", /地址解析失败/u],
    ["dial tcp: no such host", "network", /地址解析失败/u],
    ["Failed to fetch", "network", /网络连接失败/u],
    ["Network request failed", "network", /网络连接失败/u],
    ["ECONNREFUSED", "network", /网络连接失败/u],
    ["主线路请求超时，请稍后重试", "timeout", /主线路请求超时/u],
  ];
  for (const [error, kind, message] of cases) {
    const info = getAPILineErrorInfo(error, fallback);
    assert.equal(info.kind, kind);
    assert.match(info.message, message);
    assert.equal(info.status, null);
  }
  assert.equal(getAPILineErrorInfo("主线路请求失败，请稍后重试", fallback).kind, "unknown");
  assert.equal(getAPILineErrorInfo("上游返回无效数据", fallback).kind, "unknown");
});

test("input validation is separate from connection failure and carries no switch advice", () => {
  const cases = [
    ["工坊ID不能为空", /请输入工坊 ID/u],
    ["工坊ID列表包含空项", /列表包含空项/u],
    ["无效的工坊ID片段 \"not-an-id\": invalid syntax", /请输入有效的工坊 ID/u],
    ["请输入有效的工坊 ID", /请输入有效的工坊 ID/u],
    ["invalid URL", /链接格式不正确/u],
    ["could not find valid workshop ID in URL", /未能从链接中识别工坊 ID/u],
  ];
  for (const [error, message] of cases) {
    const info = getAPILineErrorInfo(error, fallback);
    assert.equal(info.kind, "validation");
    assert.match(info.message, message);
    assert.doesNotMatch(info.message, /重试|切换|网络/u);
    assert.equal(info.status, null);
  }
});

test("unknown parse errors and wrapped HTTP errors preserve useful original context", () => {
  const raw = "解析返回数据失败（工坊 ID 1234567890，批次 2）: invalid character '<' looking for beginning of value";
  const parsed = getAPILineErrorInfo(raw, fallback);
  assert.equal(parsed.message, fallback);
  assert.equal(parsed.kind, "unknown");
  assert.match(parsed.detail, /解析返回数据失败/u);
  assert.match(parsed.detail, /ID 1234567890，批次 2/u);
  assert.match(parsed.detail, /invalid character/u);
  assert.doesNotMatch(parsed.detail, /[<>]/u);
  assert.equal(formatAPILineError(raw, fallback), `${fallback}\n${parsed.detail}`);

  const wrapped = getAPILineErrorInfo("解析工坊ID 1234567890 失败（批次 2）: 备用线路请求失败（HTTP 500），请稍后重试", fallback);
  assert.equal(wrapped.kind, "server");
  assert.equal(wrapped.status, 500);
  assert.equal(wrapped.line, "备用线路");
  assert.match(wrapped.detail, /1234567890.*批次 2/u);
  assert.match(wrapped.detail, /请求失败（HTTP 500）/u);
  assert.equal(getAPILineErrorInfo("主线路请求超时（HTTP 504），请稍后重试", fallback).detail, "");
  assert.match(getAPILineErrorInfo("itemID:12345 batch:2 IDs [12345]", fallback).detail, /itemID:12345 batch:2 IDs \[12345\]/u);
});

test("original details redact addresses and credentials without removing error context", () => {
  const sensitive = [
    "https://private.invalid/path?token=secret-token",
    "wss://user:password@private.invalid/socket",
    "https%3A%2F%2Fprivate.invalid%2F%3Ftoken%3Dsecret-token",
    "https&amp;colon;&amp;sol;&amp;sol;private.invalid/path?token=secret-token",
    "private.invalid:8443",
    "private.invalid",
    "private_backend.internal",
    "secret-user@example.invalid",
    "192.0.2.10:443",
    "[2001:db8::1]:443",
    "2001:db8::2",
    "abcd:1234:5678:9abc:def0:1234:5678:9abc",
    "[fe80::1%eth0]:443",
    "::ffff:192.0.2.12:",
    "localhost:3000",
    "private-host:8443",
    "token=secret-token",
    'access_token="secret-token"',
    "password='secret-password'",
    "api_key=secret-key",
    "access_key_id=AKIAIOSFODNN7EXAMPLE",
    "x-auth=secret-auth",
    String.raw`token="left\"secret-escaped"`,
    String.raw`password='left\'secret-escaped'`,
    "Bearer secret-bearer",
    "Basic c2VjcmV0OnNlY3JldA==",
    "eyJhbGciOiJIUzI1NiJ9.eyJzZWNyZXQiOiJ2YWx1ZSJ9.signature",
  ];
  for (const value of sensitive) {
    const error = `解析工坊 ID 1234567890 失败（批次 2）: invalid character near ${value}`;
    const info = getAPILineErrorInfo(error, fallback);
    assert.match(info.detail, /ID 1234567890.*批次 2.*invalid character/u, value);
    assert.doesNotMatch(`${info.message} ${info.detail} ${formatAPILineError(error, fallback)}`, /private|example|secret|password|signature|192\.0\.2|2001:|db8|fe80|ffff|eth0|abcd:|localhost|https?:|wss:|Bearer|Basic|eyJ|<|>/iu, value);
  }
  for (const value of ["Authorization: Bearer secret-bearer", "Cookie: session=secret-cookie; userid=secret-id", '"client_secret":"secret-value"']) {
    const info = getAPILineErrorInfo(`工坊 ID 1234567890，批次 2: ${value}`, fallback);
    assert.match(info.detail, /1234567890，批次 2/u);
    assert.doesNotMatch(info.detail, /secret|Bearer|Cookie|client_secret/iu);
  }
  for (const value of ["getaddrinfo ENOTFOUND private-server", "dial tcp private-relay: connection refused", "lookup private-server: no such host", "hostname=private-server", "lookup private_backup.internal on 192.0.2.10:53: no such host", "dial tcp private_backend.local:443: connect: connection refused"]) {
    const info = getAPILineErrorInfo(`工坊 ID 1234567890，批次 2: ${value}`, fallback);
    assert.match(info.detail, /1234567890，批次 2/u);
    assert.doesNotMatch(info.detail, /private[-_]server|private[-_]relay|private[-_]backup|private[-_]backend/iu);
  }
});

test("cancellation and validation strip stale switch and retry suggestions from details", () => {
  for (const error of [
    "工坊 ID 1234567890: 主线路请求已取消，或在设置中手动切换备用线路后重试",
    "无效的工坊ID片段 abc: 请在设置中切换备用线路后重试",
    "context canceled, please retry later",
  ]) {
    const info = getAPILineErrorInfo(error, fallback);
    assert.ok(info.kind === "canceled" || info.kind === "validation");
    assert.doesNotMatch(`${info.message} ${info.detail}`, /切换|重试|retry/iu);
  }
});

test("details remain plain text and are bounded even for hostile exceptions", () => {
  const error = `第 2 批次工坊 ID 1234567890: &lt;img src=x onerror=alert(1)&gt; <svg onload=alert(1)> ${"a".repeat(30000)} https://private.invalid/secret`;
  const info = getAPILineErrorInfo(error, fallback);
  assert.match(info.detail, /第 2 批次工坊 ID 1234567890/u);
  assert.ok(info.detail.length <= 800);
  assert.doesNotMatch(`${info.message} ${info.detail} ${formatAPILineError(error, fallback)}`, /[<>]|private\.invalid|secret|onerror|onload|&lt;|&gt;/iu);
});

test("retry metadata is numeric and only accompanies an actual rate limit", () => {
  assert.equal(getAPILineErrorInfo({ status: 429, retryAfterSeconds: 17 }, fallback).retryAfterSeconds, 17);
  assert.equal(getAPILineErrorInfo({ status: 429, retryAfterSeconds: 0 }, fallback).retryAfterSeconds, 1);
  assert.equal(getAPILineErrorInfo({ status: 429, retryAfterSeconds: 999999 }, fallback).retryAfterSeconds, 3600);
  assert.equal(getAPILineErrorInfo("HTTP 429 Retry-After: 20", fallback).retryAfterSeconds, 20);
  for (const value of ["-3", "3.5", "999999999", "3<script>"]) {
    assert.equal(getAPILineErrorInfo(`HTTP 429 Retry-After: ${value}`, fallback).retryAfterSeconds, null);
  }
  for (const status of [400, 500, 504]) {
    assert.equal(getAPILineErrorInfo({ status, retryAfterSeconds: 17 }, fallback).retryAfterSeconds, null);
  }
});
