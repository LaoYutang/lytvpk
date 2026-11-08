import assert from "node:assert/strict";
import test from "node:test";
import { formatAPILineError } from "../src/js/core/api-line.js";

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

test("cancellation has no switch or retry advice and unknown messages stay generic", () => {
  assert.equal(formatAPILineError(new Error(privatePrefix + "备用线路请求已取消" + privateSuffix), fallback), "备用线路请求已取消。");
  for (const error of [privatePrefix, new Error("request failed with HTTP 429 17"), "未知线路请求超时（HTTP 504）", "主线路请求失败（HTTP 500），请稍后重试", null, {}, { message: 42 }]) {
    assert.equal(formatAPILineError(error, fallback), fallback);
  }
});
