import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

let fixtureSequence = 0;

async function rateLimitFixture(t, env = {}) {
  const source = await readFile(new URL("./steam_workshop_worker.js", import.meta.url), "utf8");
  const exposedSource = `${source}\nexport { normalizeClientIP, parseHighLimitConfig, getHighLimitClientIP };\n`;
  const worker = await import(`data:text/javascript;base64,${Buffer.from(exposedSource).toString("base64")}#fixture-${++fixtureSequence}`);
  let now = 1_700_000_000_000;
  let cacheMatches = 0;
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async () => assert.fail("rate-limit tests must not call Steam"));
  const previousCaches = globalThis.caches;
  globalThis.caches = {
    default: {
      async match(request) {
        cacheMatches++;
        const path = new URL(request.url).pathname;
        if (path !== "/list" && path !== "/detail") return undefined;
        return Response.json({ fixture: "cached workshop metadata" }, {
          headers: { "Access-Control-Allow-Origin": "*", "X-Fixture-Cache": "hit" },
        });
      },
      async put() { assert.fail("cached rate-limit fixtures must not write upstream responses"); },
    },
  };
  t.after(() => {
    if (previousCaches === undefined) delete globalThis.caches;
    else globalThis.caches = previousCaches;
  });
  const pending = [];
  const ctx = { waitUntil: (promise) => pending.push(promise) };
  return {
    worker,
    advance(milliseconds) { now += milliseconds; },
    get cacheMatches() { return cacheMatches; },
    fetch(request, overrideEnv = env) { return worker.default.fetch(request, overrideEnv, ctx); },
    async flush() { await Promise.all(pending); },
  };
}

function clientRequest(source = "203.0.113.7", {
  path = "/detail?id=123", method = "GET", trusted = true, cf = { colo: "SJC" }, headers = {},
} = {}) {
  const request = new Request(`https://workshop.invalid${path}`, {
    method, headers: { "CF-Connecting-IP": source, ...headers },
  });
  if (trusted) Object.defineProperty(request, "cf", { value: cf });
  return request;
}

// The Fetch Headers constructor strips surrounding whitespace. Use an exact
// header fixture when testing the source parser's refusal to trim client input.
function rawClientRequest(source, { cf = { colo: "SJC" }, headers = {} } = {}) {
  const values = new Map(Object.entries({ "CF-Connecting-IP": source, ...headers })
    .map(([key, value]) => [key.toLowerCase(), value]));
  return {
    cf,
    headers: {
      get(name) { return values.get(name.toLowerCase()) ?? null; },
      has(name) { return values.has(name.toLowerCase()); },
    },
  };
}

async function expectRequests(fixture, count, expectedStatus, request = () => clientRequest()) {
  for (let index = 0; index < count; index++) {
    const response = await fixture.fetch(request(index));
    assert.equal(response.status, expectedStatus, `request ${index + 1} of ${count}`);
  }
}

test("ordinary cached list and detail requests share the original 500-request burst", async (t) => {
  const fixture = await rateLimitFixture(t);
  await expectRequests(fixture, 500, 200, (index) => clientRequest("203.0.113.7", {
    path: index % 2 === 0 ? "/list?page=0" : "/detail?id=123",
  }));
  assert.equal(fixture.cacheMatches, 500);
  const limited = await fixture.fetch(clientRequest());
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("Access-Control-Allow-Origin"), "*");
  assert.ok(Number(limited.headers.get("Retry-After")) > 0);
  assert.equal(fixture.cacheMatches, 500, "cached responses must not bypass admission");
  await fixture.flush();
});

test("ordinary tokens refill at 50 per minute", async (t) => {
  const fixture = await rateLimitFixture(t);
  await expectRequests(fixture, 500, 200);
  await expectRequests(fixture, 1, 429);
  fixture.advance(60_000);
  await expectRequests(fixture, 50, 200);
  await expectRequests(fixture, 1, 429);
});

test("OPTIONS bypasses both token consumption and metadata cache lookup", async (t) => {
  const fixture = await rateLimitFixture(t);
  for (let index = 0; index < 10; index++) {
    const response = await fixture.fetch(clientRequest("203.0.113.7", { method: "OPTIONS" }));
    assert.ok(response.ok);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  }
  assert.equal(fixture.cacheMatches, 0);
  await expectRequests(fixture, 500, 200);
  const response = await fixture.fetch(clientRequest("203.0.113.7", { method: "OPTIONS" }));
  assert.ok(response.ok);
  await expectRequests(fixture, 1, 429);
  assert.equal(fixture.cacheMatches, 500);
});

test("strict IP normalization merges IPv6 spellings and IPv4-mapped aliases", async (t) => {
  const { worker } = await rateLimitFixture(t);
  const normalize = worker.normalizeClientIP;
  assert.equal(normalize("203.0.113.7"), "v4:203.0.113.7");
  assert.equal(normalize("0.0.0.0"), "v4:0.0.0.0");
  assert.equal(normalize("255.255.255.255"), "v4:255.255.255.255");
  const ipv6 = "v6:2001:db8:0:0:0:0:0:7";
  for (const value of ["2001:db8::7", "2001:0DB8:0000:0:0000:0000:0000:0007"]) {
    assert.equal(normalize(value), ipv6, value);
  }
  for (const value of ["::ffff:203.0.113.7", "0:0:0:0:0:FFFF:CB00:7107"]) {
    assert.equal(normalize(value), "v4:203.0.113.7", value);
  }
  assert.equal(normalize("::"), "v6:0:0:0:0:0:0:0:0");
  assert.equal(normalize("::1"), "v6:0:0:0:0:0:0:0:1");
  assert.equal(normalize("2001:db8::192.0.2.1"), "v6:2001:db8:0:0:0:0:c000:201");
  assert.notEqual(normalize("::203.0.113.7"), normalize("203.0.113.7"), "IPv4-compatible is not IPv4-mapped");
});

test("strict IP normalization rejects aliases, whitespace, networks and malformed input", async (t) => {
  const { worker } = await rateLimitFixture(t);
  for (const value of [
    null, undefined, 203, {}, [], "", " ", "203.0.113.7 ", " 203.0.113.7", "203.0.113.7\n",
    "203.0.113", "203.0.113.256", "256.0.0.1", "203.0.113.-1", "203.0.113.+7", "203.0.113.007",
    "127.1", "2130706433", "0x7f000001", "0x7f.0.0.1", "203.0.113.7/32", "203.0.113.*",
    "203.0.113.7:443", "203.0.113.7,203.0.113.8", "[2001:db8::7]", "[2001:db8::7]:443",
    "fe80::1%eth0", "2001:db8::7/64", "2001:::db8", "2001:db8", "2001:db8::7:", "1::2::3",
    "1:2:3:4:5:6:7:8:9", "1:2:3:4:5:6:7:8::", "fffff::1", "::ffff:203.0.113.007", "::ffff:203.0.113.256",
  ]) {
    assert.equal(worker.normalizeClientIP(value), null, String(value));
  }
});

test("allowlist CSV trims entries, ignores invalid values and deduplicates equivalent addresses", async (t) => {
  const { worker } = await rateLimitFixture(t);
  for (const env of [undefined, null, {}, { WORKSHOP_HIGH_LIMIT_IPS: " , \n,\t " }]) {
    const config = worker.parseHighLimitConfig(env);
    assert.ok(config.ips instanceof Set);
    assert.equal(config.ips.size, 0);
    assert.equal(config.burst, 5000);
    assert.equal(config.refillPerMin, 500);
  }
  const config = worker.parseHighLimitConfig({
    WORKSHOP_HIGH_LIMIT_IPS: " 203.0.113.7 , ::ffff:203.0.113.7, \n2001:DB8::7 , 2001:db8:0:0:0:0:0:7,invalid,203.0.113.0/24,203.0.113.*,203.0.113.7:443,[2001:db8::7],fe80::1%eth0,, ",
  });
  assert.deepEqual([...config.ips].sort(), ["v4:203.0.113.7", "v6:2001:db8:0:0:0:0:0:7"]);
  assert.equal(worker.parseHighLimitConfig({ WORKSHOP_HIGH_LIMIT_IPS: 123 }).ips.size, 0);
});

test("high limits are fixed and configuration only reads the IP Secret", async (t) => {
  let reads = 0;
  const env = new Proxy({ WORKSHOP_HIGH_LIMIT_IPS: "203.0.113.7" }, {
    get(target, property) {
      assert.equal(property, "WORKSHOP_HIGH_LIMIT_IPS", "rate-limit configuration read an unrelated environment property");
      reads++;
      return target[property];
    },
  });
  const fixture = await rateLimitFixture(t, env);
  const config = fixture.worker.parseHighLimitConfig(env);
  assert.deepEqual([...config.ips], ["v4:203.0.113.7"]);
  assert.equal(config.burst, 5000);
  assert.equal(config.refillPerMin, 500);
  await expectRequests(fixture, 1, 200);
  assert.ok(reads > 0);
});

test("high-limit identity requires genuine-looking edge metadata and rejects Worker subrequests", async (t) => {
  const { worker } = await rateLimitFixture(t);
  const identify = worker.getHighLimitClientIP;
  assert.equal(identify(rawClientRequest("203.0.113.7")), "v4:203.0.113.7");
  assert.equal(identify(rawClientRequest("2001:DB8::7")), "v6:2001:db8:0:0:0:0:0:7");
  for (const cf of [undefined, null, {}, { colo: "" }, { colo: " " }, { colo: "sfo" }, { colo: "SFO1" }, { colo: "AB" }, { colo: 123 }]) {
    const request = rawClientRequest("203.0.113.7");
    request.cf = cf;
    assert.equal(identify(request), null, `invalid platform metadata ${JSON.stringify(cf)}`);
  }
  for (const headers of [{ "CF-Worker": "other.example" }, { "CF-Worker": "" }, { "CF-EW-Via": "15" }, { "CF-EW-Via": "" }]) {
    assert.equal(identify(rawClientRequest("203.0.113.7", { headers })), null);
  }
  for (const source of ["2a06:98c0:3600::103", "2A06:98C0:3600:0000:0:0:0:0103"]) {
    assert.equal(identify(rawClientRequest(source)), null, "cross-zone sentinel must not be eligible");
  }
  for (const source of ["203.0.113.7 ", " 203.0.113.7", "2001:db8::7 "]) {
    assert.equal(identify(rawClientRequest(source)), null, "source headers must not be trimmed into membership");
  }
});

test("forwarding headers and Pseudo IPv4 cannot manufacture high-limit eligibility", async (t) => {
  const { worker } = await rateLimitFixture(t);
  const fakeHeaders = { "X-Forwarded-For": "203.0.113.7", "X-Real-IP": "203.0.113.7", "CF-Connecting-IPv6": "2001:db8::7" };
  assert.equal(worker.getHighLimitClientIP(rawClientRequest(null, { headers: fakeHeaders })), null);
  assert.equal(worker.getHighLimitClientIP(rawClientRequest("203.0.113.8", { headers: fakeHeaders })), "v4:203.0.113.8");
  assert.equal(worker.getHighLimitClientIP(rawClientRequest("2001:db8::8", { headers: fakeHeaders })), "v6:2001:db8:0:0:0:0:0:8");
  for (const source of ["240.0.0.1", "255.255.255.255", "::ffff:240.0.0.1"]) {
    assert.equal(worker.getHighLimitClientIP(rawClientRequest(source, { headers: fakeHeaders })), null, "Class E source is never high-limit eligible");
  }
});

test("listed clients get exactly the fixed 5000 burst while unlisted clients retain 500", async (t) => {
  const fixture = await rateLimitFixture(t, { WORKSHOP_HIGH_LIMIT_IPS: "203.0.113.7" });
  await expectRequests(fixture, 5000, 200, (index) => clientRequest("203.0.113.7", { path: index % 2 ? "/list?page=0" : "/detail?id=123" }));
  await expectRequests(fixture, 1, 429);
  await expectRequests(fixture, 500, 200, () => clientRequest("203.0.113.8"));
  await expectRequests(fixture, 1, 429, () => clientRequest("203.0.113.8"));
  assert.equal(fixture.cacheMatches, 5500);
});

test("different listed clients receive independent high-limit buckets", async (t) => {
  const fixture = await rateLimitFixture(t, { WORKSHOP_HIGH_LIMIT_IPS: "203.0.113.7,203.0.113.8" });
  for (const source of ["203.0.113.7", "203.0.113.8"]) {
    await expectRequests(fixture, 5000, 200, () => clientRequest(source));
    await expectRequests(fixture, 1, 429, () => clientRequest(source));
  }
});

test("normalized IPv6 and mapped IPv4 aliases share each high-limit bucket", async (t) => {
  for (const [allowlist, first, equivalent] of [
    ["2001:db8::7", "2001:0DB8:0:0:0:0:0:7", "2001:db8::7"],
    ["::ffff:203.0.113.7", "::FFFF:CB00:7107", "203.0.113.7"],
  ]) {
    await t.test(first, async (t) => {
      const fixture = await rateLimitFixture(t, { WORKSHOP_HIGH_LIMIT_IPS: allowlist });
      await expectRequests(fixture, 2500, 200, () => clientRequest(first));
      await expectRequests(fixture, 2500, 200, () => clientRequest(equivalent));
      await expectRequests(fixture, 1, 429, () => clientRequest(first));
      await expectRequests(fixture, 1, 429, () => clientRequest(equivalent));
    });
  }
});

test("ordinary bucket identity remains the original raw Cloudflare source header", async (t) => {
  const fixture = await rateLimitFixture(t);
  await expectRequests(fixture, 500, 200);
  await expectRequests(fixture, 1, 429);
  await expectRequests(fixture, 500, 200, () => clientRequest("::ffff:203.0.113.7"));
  await expectRequests(fixture, 1, 429, () => clientRequest("::ffff:203.0.113.7"));
});

test("spoofed or ambiguous clients keep ordinary limits despite matching configured addresses", async (t) => {
  const cases = [
    ["no platform metadata", "203.0.113.7", { trusted: false }],
    ["invalid colo", "203.0.113.7", { cf: { colo: "sfo" } }],
    ["same-zone Worker", "203.0.113.7", { headers: { "CF-Worker": "other.example" } }],
    ["empty Worker marker", "203.0.113.7", { headers: { "CF-Worker": "" } }],
    ["EW marker", "203.0.113.7", { headers: { "CF-EW-Via": "15" } }],
    ["cross-zone sentinel", "2a06:98c0:3600::103", {}],
    ["forged forwarding headers", "203.0.113.8", { headers: { "X-Forwarded-For": "203.0.113.7", "X-Real-IP": "203.0.113.7", "CF-Connecting-IPv6": "2001:db8::7" } }],
    ["Pseudo IPv4 with IPv6 header", "240.0.0.1", { headers: { "CF-Connecting-IPv6": "2001:db8::7" } }],
  ];
  for (const [name, source, options] of cases) {
    await t.test(name, async (t) => {
      const fixture = await rateLimitFixture(t, { WORKSHOP_HIGH_LIMIT_IPS: "203.0.113.7,2001:db8::7,240.0.0.1,2a06:98c0:3600::103" });
      await expectRequests(fixture, 500, 200, () => clientRequest(source, options));
      await expectRequests(fixture, 1, 429, () => clientRequest(source, options));
    });
  }
});

test("fixed high-limit refill is exactly 500 per minute while ordinary refill stays 50", async (t) => {
  const fixture = await rateLimitFixture(t, { WORKSHOP_HIGH_LIMIT_IPS: "203.0.113.7" });
  await expectRequests(fixture, 5000, 200);
  await expectRequests(fixture, 1, 429);
  await expectRequests(fixture, 500, 200, () => clientRequest("203.0.113.8"));
  fixture.advance(60_000);
  await expectRequests(fixture, 500, 200);
  await expectRequests(fixture, 1, 429);
  await expectRequests(fixture, 50, 200, () => clientRequest("203.0.113.8"));
  await expectRequests(fixture, 1, 429, () => clientRequest("203.0.113.8"));
});

test("one high token needs 120ms while one ordinary token needs 1200ms", async (t) => {
  for (const [name, env, burst, interval] of [
    ["listed", { WORKSHOP_HIGH_LIMIT_IPS: "203.0.113.7" }, 5000, 120],
    ["ordinary", {}, 500, 1200],
  ]) {
    await t.test(name, async (t) => {
      const fixture = await rateLimitFixture(t, env);
      await expectRequests(fixture, burst, 200);
      fixture.advance(interval - 1);
      await expectRequests(fixture, 1, 429);
      fixture.advance(1);
      await expectRequests(fixture, 1, 200);
      await expectRequests(fixture, 1, 429);
    });
  }
});

test("fixed ten-minute refill and idle sweeping never exceed the 5000-token cap", async (t) => {
  for (const [name, elapsed, available] of [
    ["one millisecond before full refill", 599_999, 4999],
    ["idle bucket eligible for cleanup", 600_001, 5000],
  ]) {
    await t.test(name, async (t) => {
      const fixture = await rateLimitFixture(t, { WORKSHOP_HIGH_LIMIT_IPS: "203.0.113.7" });
      await expectRequests(fixture, 5000, 200);
      await expectRequests(fixture, 1, 429);
      fixture.advance(elapsed);
      // Other traffic crosses a full sweep interval before this identity is
      // read again, covering both the retained and the fully refilled case.
      await expectRequests(fixture, 500, 200, () => clientRequest("203.0.113.8"));
      await expectRequests(fixture, 500, 429, () => clientRequest("203.0.113.8"));
      await expectRequests(fixture, available, 200);
      await expectRequests(fixture, 1, 429);
    });
  }
});

test("losing high-limit eligibility clamps the existing balance to ordinary capacity", async (t) => {
  const fixture = await rateLimitFixture(t, { WORKSHOP_HIGH_LIMIT_IPS: "203.0.113.7" });
  await expectRequests(fixture, 1, 200);
  const downgrade = () => clientRequest("203.0.113.7", { headers: { "CF-Worker": "other.example" } });
  await expectRequests(fixture, 500, 200, downgrade);
  await expectRequests(fixture, 1, 429, downgrade);
  await expectRequests(fixture, 1, 429);
});

test("becoming trusted only credits the ordinary rate and cap for the preceding idle time", async (t) => {
  const fixture = await rateLimitFixture(t, { WORKSHOP_HIGH_LIMIT_IPS: "203.0.113.7" });
  await expectRequests(fixture, 500, 200, () => clientRequest("203.0.113.7", { trusted: false }));
  fixture.advance(600_000);
  await expectRequests(fixture, 500, 200);
  await expectRequests(fixture, 1, 429);
  fixture.advance(120);
  await expectRequests(fixture, 1, 200);
  await expectRequests(fixture, 1, 429);
});

test("an exhausted listed client cannot obtain another ordinary burst by hiding edge eligibility", async (t) => {
  const fixture = await rateLimitFixture(t, { WORKSHOP_HIGH_LIMIT_IPS: "203.0.113.7" });
  await expectRequests(fixture, 5000, 200);
  await expectRequests(fixture, 1, 429);
  for (const options of [
    { headers: { "CF-Worker": "other.example" } },
    { headers: { "CF-Worker": "" } },
    { headers: { "CF-EW-Via": "15" } },
    { trusted: false },
    {},
  ]) {
    await expectRequests(fixture, 1, 429, () => clientRequest("203.0.113.7", options));
  }
});

test("a listed client cannot reset an exhausted ordinary bucket by becoming trusted", async (t) => {
  const fixture = await rateLimitFixture(t, { WORKSHOP_HIGH_LIMIT_IPS: "203.0.113.7" });
  await expectRequests(fixture, 500, 200, () => clientRequest("203.0.113.7", { trusted: false }));
  await expectRequests(fixture, 1, 429, () => clientRequest("203.0.113.7", { trusted: false }));
  await expectRequests(fixture, 1, 429);
  await expectRequests(fixture, 1, 429, () => clientRequest("::ffff:203.0.113.7"));
});

test("removing and restoring membership never borrows tokens between bucket classes", async (t) => {
  const env = { WORKSHOP_HIGH_LIMIT_IPS: "203.0.113.7" };
  const fixture = await rateLimitFixture(t, env);
  await expectRequests(fixture, 5000, 200);
  await expectRequests(fixture, 1, 429);
  env.WORKSHOP_HIGH_LIMIT_IPS = "";
  await expectRequests(fixture, 500, 200);
  await expectRequests(fixture, 1, 429);
  env.WORKSHOP_HIGH_LIMIT_IPS = "203.0.113.7";
  await expectRequests(fixture, 1, 429, () => clientRequest());
});

test("rate-limit responses and preflight never expose secret membership", async (t) => {
  const secret = "203.0.113.7,2001:db8::7,203.0.113.99";
  const fixture = await rateLimitFixture(t, { WORKSHOP_HIGH_LIMIT_IPS: secret });
  await expectRequests(fixture, 5000, 200);
  const responses = [
    await fixture.fetch(clientRequest()),
    await fixture.fetch(clientRequest("203.0.113.7", { method: "OPTIONS" })),
    await fixture.fetch(clientRequest("203.0.113.99", { path: "/not-found" })),
  ];
  assert.equal(responses[0].status, 429);
  assert.ok(responses[1].ok);
  assert.equal(responses[2].status, 404);
  for (const response of responses) {
    const serialized = JSON.stringify([...response.headers]) + await response.text();
    for (const value of [...secret.split(","), "WORKSHOP_HIGH_LIMIT_IPS", "v4:", "v6:"]) {
      assert.equal(serialized.includes(value), false, `response exposed secret data ${value}`);
    }
  }
});
