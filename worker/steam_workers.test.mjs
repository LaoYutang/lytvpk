import assert from "node:assert/strict";
import test from "node:test";
import parser from "./steam_api_worker.js";
import browser from "./steam_workshop_worker.js";

const env = { STEAM_API_KEY: "fixture-key" };
const json = (value) => Response.json(value);

function fixtureRuntime(t, upstream, cache = { match: async () => undefined, put: async () => {} }, legacyCache = cache) {
  const log = t.mock.method(console, "log", () => {});
  const warn = t.mock.method(console, "warn", () => {});
  const previousCaches = globalThis.caches;
  globalThis.caches = {
    default: legacyCache,
    async open(name) {
      assert.equal(name, "workshop-list-sorting-v2");
      return cache;
    },
  };
  t.after(() => {
    if (previousCaches === undefined) delete globalThis.caches;
    else globalThis.caches = previousCaches;
  });
  const steamFetch = t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    assert.equal(url.origin, "https://api.steampowered.com");
    return upstream(url, init);
  });
  t.after(() => {
    let attempts = 0;
    for (const call of log.mock.calls) {
      assert.equal(call.arguments.length, 1);
      const [summary] = call.arguments;
      assert.equal(summary.event, "steam_request_summary");
      const isParser = summary.worker === "l4d2-workshop-to-url";
      if (isParser) assert.equal(summary.route, "parse");
      else {
        assert.equal(summary.worker, "l4d2-workshop");
        assert.ok(["/list", "/detail", "/updates", "other"].includes(summary.route));
      }
      assert.ok(["hit", "miss", "error", "not_checked"].includes(summary.cache));
      const fields = ["event", "worker", "route", "cache", "http_status", "steam_keyed", "steam_unkeyed",
        "steam_fetch_errors", "steam_endpoints", "steam_http"];
      if (summary.cache === "hit" || summary.cache === "miss") {
        fields.push("cache_hit");
        assert.equal(summary.cache_hit, Number(summary.cache === "hit"));
      }
      assert.deepEqual(Object.keys(summary).sort(), fields.sort());
      assert.deepEqual(Object.keys(summary.steam_endpoints).sort(), isParser ? ["get_details"] :
        ["collection_details", "get_details", "published_file_details", "query_files"]);
      for (const status of Object.keys(summary.steam_http)) assert.match(status, /^(keyed|unkeyed)_[1-5][0-9]{2}$/);
      const sum = counts => Object.values(counts).reduce((total, count) => total + count, 0);
      const total = summary.steam_keyed + summary.steam_unkeyed;
      assert.equal(total, sum(summary.steam_endpoints));
      assert.equal(total, sum(summary.steam_http) + summary.steam_fetch_errors);
      attempts += total;
    }
    assert.equal(attempts, steamFetch.mock.callCount(), "totals must match actual fetch invocations");
    assert.equal(warn.mock.callCount(), 0, "raw upstream errors must never be logged");
  });
  const pending = [];
  return {
    log,
    get summaries() { return log.mock.calls.map(call => call.arguments[0]); },
    ctx: { waitUntil: (promise) => pending.push(promise) },
    flush: () => Promise.all(pending),
  };
}

function assertSummary(summary, expected) {
  assert.ok(summary, "expected a request summary");
  for (const [field, value] of Object.entries(expected)) assert.deepEqual(summary[field], value, field);
}

function parserRequest(ids) {
  return new Request("https://worker.invalid/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ids),
  });
}

function listItems(count, start = 1, prefix = "") {
  return Array.from({ length: count }, (_, index) => ({
    publishedfileid: `${prefix}${start + index}`,
    title: `Fixture ${start + index}`,
    children: [{ publishedfileid: "dependency" }],
  }));
}

function listData(items, total = items.length) {
  return { response: { publishedfiledetails: items, total } };
}

test("browser combines keyword filtering with each explicit Web API sort for items and collections", async (t) => {
  for (const filetype of ["0", "1"]) {
    for (const q of ["", " 未花 "]) {
      for (const [sort, expected] of [["relevance", q ? "12" : "3"], ["trend", "3"], ["recent", "1"], ["top", "0"], ["subs", "9"]]) {
        await t.test(`${filetype}-${q || "browse"}-${sort}`, async (t) => {
          const runtime = fixtureRuntime(t, (url) => {
            assert.equal(url.searchParams.get("query_type"), expected);
            assert.equal(url.searchParams.get("search_text"), q ? "未花" : null);
            assert.equal(url.searchParams.get("page"), "2");
            assert.equal(url.searchParams.get("numperpage"), "50");
            assert.equal(url.searchParams.get("filetype"), filetype);
            assert.equal(url.searchParams.get("requiredtags[0]"), "Map");
            assert.equal(url.searchParams.get("match_all_tags"), "true");
            return json(listData([{ publishedfileid: "2" }, { publishedfileid: "1" }]));
          });
          const request = new URL("https://worker.invalid/list");
          request.search = new URLSearchParams({ q, sort, filetype, page: "2", tags: "Map" });
          const response = await browser.fetch(new Request(request), env, runtime.ctx);
          assert.equal(response.status, 200);
          assert.deepEqual((await response.json()).response.publishedfiledetails.map((item) => item.publishedfileid), ["2", "1"]);
          await runtime.flush();
        });
      }
    }
  }
});

test("browser default or unknown sorts use relevance only when a trimmed keyword exists", async (t) => {
  for (const q of ["", "  ", "未花"]) {
    for (const sort of ["", "invalid", "__proto__"]) {
      await t.test(`${q || "empty"}-${sort || "default"}`, async (t) => {
        const runtime = fixtureRuntime(t, (url) => {
          assert.equal(url.searchParams.get("query_type"), q.trim() ? "12" : "3");
          return json(listData([]));
        });
        const params = new URLSearchParams({ q, sort, filetype: "0" });
        assert.equal((await browser.fetch(new Request(`https://worker.invalid/list?${params}`), env, runtime.ctx)).status, 200);
        await runtime.flush();
      });
    }
  }
});

test("sorting cache keys isolate sort, keyword, page and filetype without leaking cache markers upstream", async (t) => {
  const entries = new Map();
  let calls = 0;
  const runtime = fixtureRuntime(t, (url) => {
    calls++;
    assert.equal(url.searchParams.has("__sort_cache"), false);
    return json(listData([{ publishedfileid: `${url.searchParams.get("query_type")}-${url.searchParams.get("page")}` }]));
  }, {
    async match(request) {
      assert.equal(new URL(request.url).searchParams.has("__sort_cache"), false);
      return entries.get(request.url)?.clone();
    },
    async put(request, response) { entries.set(request.url, response.clone()); },
  });
  const get = async (query) => {
    const response = await browser.fetch(new Request(`https://worker.invalid/list?${query}`), env, runtime.ctx);
    assert.equal(response.status, 200);
    await runtime.flush();
    return (await response.json()).response.publishedfiledetails[0].publishedfileid;
  };
  assert.equal(await get("q=river&sort=recent&page=1&filetype=0"), "1-1");
  assert.equal(await get("q=river&sort=subs&page=1&filetype=0"), "9-1");
  assert.equal(await get("q=river&sort=recent&page=1&filetype=0"), "1-1");
  assert.equal(calls, 2);
  await get("q=river&sort=recent&page=2&filetype=0");
  await get("q=coast&sort=recent&page=1&filetype=0");
  await get("q=river&sort=recent&page=1&filetype=1");
  assert.equal(calls, 5);
  assert.equal(entries.size, 5);
  assert.deepEqual(runtime.summaries.map(s => [s.cache, s.steam_keyed]), [
    ["miss", 1], ["miss", 1], ["hit", 0], ["miss", 1], ["miss", 1], ["miss", 1],
  ]);
});

test("browser requests 50 items or collections per page and preserves query filters", async (t) => {
  for (const filetype of ["0", "1"]) {
    await t.test(filetype === "0" ? "items" : "collections", async (t) => {
      const calls = [];
      const runtime = fixtureRuntime(t, (url) => {
        assert.equal(url.pathname, "/IPublishedFileService/QueryFiles/v1/");
        assert.equal(url.searchParams.get("numperpage"), "50");
        assert.equal(url.searchParams.get("filetype"), filetype);
        assert.equal(url.searchParams.get("appid"), "550");
        assert.equal(url.searchParams.get("return_details"), "true");
        const page = Number(url.searchParams.get("page"));
        calls.push(page);
        if (page === 1) {
          assert.equal(url.searchParams.get("search_text"), "coast");
          assert.equal(url.searchParams.get("query_type"), "12");
          assert.equal(url.searchParams.get("requiredtags[0]"), "Map");
          assert.equal(url.searchParams.get("requiredtags[1]"), "Campaigns");
          assert.equal(url.searchParams.get("match_all_tags"), "true");
        } else {
          assert.equal(url.searchParams.get("search_text"), null);
          assert.equal(url.searchParams.get("query_type"), "1");
        }
        return json(listData(listItems(50, (page - 1) * 50 + 1), 1000));
      });
      const ids = [];
      for (const page of [1, 2]) {
        const query = page === 1 ? "q=coast&tags=Map,Campaigns" : "sort=recent";
        const response = await browser.fetch(new Request(`https://worker.invalid/list?filetype=${filetype}&page=${page}&${query}`), env, runtime.ctx);
        assert.equal(response.status, 200);
        const { response: data } = await response.json();
        assert.equal(data.total, 1000);
        assert.equal(data.publishedfiledetails.length, 50);
        assert.ok(data.publishedfiledetails.every((item) => item.children === undefined && item.title));
        ids.push(...data.publishedfiledetails.map((item) => item.publishedfileid));
      }
      assert.deepEqual(calls, [1, 2]);
      assert.deepEqual(ids, Array.from({ length: 100 }, (_, index) => String(index + 1)));
      await runtime.flush();
    });
  }
});

test("browser preserves short and empty final pages and does not cache failed retries", async (t) => {
  const calls = [];
  const writes = [];
  let failNextPage = true;
  const runtime = fixtureRuntime(t, (url) => {
    const page = Number(url.searchParams.get("page"));
    calls.push(page);
    if (page === 2 && failNextPage) {
      failNextPage = false;
      return new Response(null, { status: 503 });
    }
    return json(listData(listItems(page === 1 ? 50 : page === 2 ? 7 : 0, (page - 1) * 50 + 1), 57));
  }, {
    match: async () => undefined,
    put: async (request, response) => { writes.push([new URL(request.url).searchParams.get("page"), response.status]); },
  });
  for (const [page, status, count] of [[1, 200, 50], [2, 500], [2, 200, 7], [3, 200, 0]]) {
    const response = await browser.fetch(new Request(`https://worker.invalid/list?filetype=0&page=${page}`), env, runtime.ctx);
    assert.equal(response.status, status);
    if (status === 200) assert.equal((await response.json()).response.publishedfiledetails.length, count);
  }
  await runtime.flush();
  assert.deepEqual(calls, [1, 2, 2, 3]);
  assert.deepEqual(writes, [["1", 200], ["2", 200], ["3", 200]]);
  assert.deepEqual(runtime.summaries.map(s => [s.http_status, s.steam_keyed, s.steam_http]), [
    [200, 1, { keyed_200: 1 }], [500, 1, { keyed_503: 1 }], [200, 1, { keyed_200: 1 }], [200, 1, { keyed_200: 1 }],
  ]);
});

test("browser mixed lists use the 50-result limit with both sources and either fallback", async (t) => {
  for (const failedType of [null, "0", "1"]) {
    await t.test(failedType === null ? "both sources" : `type ${failedType} unavailable`, async (t) => {
      const calls = [];
      const runtime = fixtureRuntime(t, (url) => {
        const type = url.searchParams.get("filetype");
        calls.push(type);
        assert.equal(url.searchParams.get("numperpage"), "50");
        assert.equal(url.searchParams.get("page"), "2");
        if (type === failedType) return new Response(null, { status: 503 });
        return json(listData(listItems(50, 51, type === "0" ? "item-" : "collection-"), 100));
      });
      const response = await browser.fetch(new Request("https://worker.invalid/list?page=2"), env, runtime.ctx);
      assert.equal(response.status, 200);
      const data = (await response.json()).response;
      assert.deepEqual(calls.sort(), ["0", "1"]);
      assert.equal(data.publishedfiledetails.length, 50);
      assert.equal(new Set(data.publishedfiledetails.map((item) => item.publishedfileid)).size, 50);
      assert.equal(data.total, failedType === null ? 200 : 100);
      assert.equal(data.publishedfiledetails[0].publishedfileid, failedType === "0" ? "collection-51" : "item-51");
      assert.equal(data.publishedfiledetails[49].publishedfileid, failedType === null ? "collection-75" : failedType === "0" ? "collection-100" : "item-100");
      await runtime.flush();
      assert.equal(runtime.summaries.length, 1);
      assertSummary(runtime.summaries[0], {
        route: "/list", http_status: 200, cache: "miss", steam_keyed: 2, steam_unkeyed: 0,
        steam_http: failedType === null ? { keyed_200: 2 } : { keyed_200: 1, keyed_503: 1 },
      });
      assert.equal(runtime.summaries[0].steam_endpoints.query_files, 2);
    });
  }
});

test("browser mixed lists retain the existing ID filtering and deduplication", async (t) => {
  const runtime = fixtureRuntime(t, (url) => json(listData(url.searchParams.get("filetype") === "0"
    ? [{ publishedfileid: "1" }, {}, { publishedfileid: "2" }]
    : [{ publishedfileid: 1 }, { publishedfileid: "3" }, { publishedfileid: "2" }])));
  const response = await browser.fetch(new Request("https://worker.invalid/list?page=1"), env, runtime.ctx);
  assert.deepEqual((await response.json()).response.publishedfiledetails.map((item) => item.publishedfileid), ["1", "3", "2"]);
  await runtime.flush();
});

test("new sorting ignores legacy list caches without deleting them and preserves the new TTL", async (t) => {
  let now = 0;
  let upstreamCalls = 0;
  const oldURL = "https://worker.invalid/list?filetype=0&page=1";
  const legacyEntries = new Map([[oldURL, {
    expires: 3600,
    response: new Response(JSON.stringify(listData(listItems(20), 200)), {
      headers: { "Cache-Control": "public, max-age=3600, s-maxage=3600" },
    }),
  }], [`${oldURL}&__sort_cache=2`, {
    expires: 3600,
    response: json(listData([{ publishedfileid: "legacy-relevance" }])),
  }]]);
  const entries = new Map();
  const runtime = fixtureRuntime(t, (url) => {
    upstreamCalls++;
    assert.equal(url.searchParams.get("numperpage"), "50");
    const start = (Number(url.searchParams.get("page")) - 1) * 50 + 1;
    return json(listData(listItems(50, start), 200));
  }, {
    async match(request) {
      const entry = entries.get(request.url);
      return entry && entry.expires > now ? entry.response.clone() : undefined;
    },
    async put(request, response) {
      assert.equal(response.headers.get("Cache-Control"), "public, max-age=3600, s-maxage=3600");
      entries.set(request.url, { response: response.clone(), expires: now + 3600 });
    },
    async delete() { assert.fail("sorting changes must not purge existing caches"); },
  }, {
    async match(request) { return legacyEntries.get(request.url)?.response.clone(); },
    async put() { assert.fail("list requests must not write the legacy cache"); },
    async delete() { assert.fail("sorting changes must not purge existing caches"); },
  });
  const getItems = async (url) => {
    const response = await browser.fetch(new Request(url), env, runtime.ctx);
    assert.equal(response.status, 200);
    return (await response.json()).response.publishedfiledetails;
  };
  assert.equal((await getItems(oldURL)).length, 50);
  assert.equal(upstreamCalls, 1);
  assert.equal((await legacyEntries.get(oldURL).response.clone().json()).response.publishedfiledetails.length, 20);
  assert.equal((await getItems(`${oldURL}&__sort_cache=2`)).length, 50);
  assert.equal(legacyEntries.size, 2);
  const nextPage = await getItems("https://worker.invalid/list?filetype=0&page=2");
  assert.equal(nextPage.length, 50);
  assert.equal(nextPage[0].publishedfileid, "51");
  assert.equal((await getItems(`${oldURL}&verification=fresh-key`)).length, 50);
  now = 3599;
  assert.equal((await getItems(oldURL)).length, 50);
  now = 3600;
  assert.equal((await getItems(oldURL)).length, 50);
  await runtime.flush();
  assert.equal(upstreamCalls, 5);
});

test("detail requests retain the default cache namespace", async (t) => {
  const detailURL = "https://worker.invalid/detail?id=100&with_previews=1";
  const cached = { publishedfileid: "100", title: "Cached detail" };
  const runtime = fixtureRuntime(t, () => assert.fail("cached details must not call Steam"), {
    async match() { assert.fail("detail requests must not read the list cache"); },
    async put() { assert.fail("detail requests must not write the list cache"); },
  }, {
    async match(request) {
      assert.equal(request.url, detailURL);
      return json(cached);
    },
    async put() { assert.fail("cache hit must not write again"); },
  });
  assert.deepEqual(await (await browser.fetch(new Request(detailURL), env, runtime.ctx)).json(), cached);
  await runtime.flush();
});

test("parser rejects missing configuration without calling Steam", async (t) => {
  const runtime = fixtureRuntime(t, () => assert.fail("unexpected upstream call"));
  const response = await parser.fetch(parserRequest(["100"]), {}, runtime.ctx);
  assert.equal(response.status, 503);
  await runtime.flush();
  assertSummary(runtime.summaries[0], { route: "parse", http_status: 503, cache: "not_checked", steam_keyed: 0 });
});

test("parser distinguishes collections from downloadable mods with dependencies", async (t) => {
  for (const collection of [false, true]) {
    await t.test(collection ? "collection" : "dependency", async (t) => {
      const runtime = fixtureRuntime(t, (url) => {
        assert.equal(url.pathname, "/IPublishedFileService/GetDetails/v1/");
        assert.equal(url.searchParams.get("key"), env.STEAM_API_KEY);
        assert.equal(url.searchParams.get("includechildren"), "true");
        assert.equal(url.searchParams.get("publishedfileids[0]"), "100");
        return json({ response: { publishedfiledetails: [{
          result: "1", publishedfileid: 100, file_type: collection ? 2 : 0,
          filename: collection ? "cover.jpg" : "mod.vpk", file_size: 42,
          file_url: "https://cdn.invalid/mod.vpk", children: [{ publishedfileid: 200, sortorder: "1" }],
        }] } });
      });
      const response = await parser.fetch(parserRequest(["100"]), env, runtime.ctx);
      assert.equal(response.status, 200);
      const [item] = await response.json();
      assert.equal(item.result, collection ? 0 : 1);
      assert.equal(item.publishedfileid, "100");
      assert.equal(item.file_size, "42");
      assert.deepEqual(item.children, [{ publishedfileid: "200", sortorder: 1, file_type: 0 }]);
      await runtime.flush();
    });
  }
});

test("parser chunks 101 IDs without recursively expanding dependencies", async (t) => {
  const sizes = [];
  const runtime = fixtureRuntime(t, (url) => {
    assert.equal(url.searchParams.get("includechildren"), "false");
    const ids = [...url.searchParams].filter(([key]) => key.startsWith("publishedfileids["));
    sizes.push(ids.length);
    return json({ response: { publishedfiledetails: ids.map(([, id]) => ({ result: 1, publishedfileid: id, filename: "mod.vpk" })) } });
  });
  const ids = Array.from({ length: 101 }, (_, i) => String(1000 + i));
  const response = await parser.fetch(parserRequest(ids), env, runtime.ctx);
  assert.equal(response.status, 200);
  assert.deepEqual(sizes, [100, 1]);
  assert.deepEqual((await response.json()).map((item) => item.publishedfileid), ids);
  await runtime.flush();
  assert.equal(runtime.summaries.length, 1);
  assertSummary(runtime.summaries[0], { steam_keyed: 2, steam_unkeyed: 0, steam_endpoints: { get_details: 2 }, steam_http: { keyed_200: 2 } });
});

test("browser uses official collection and dependency endpoints and preserves child order", async (t) => {
  for (const collection of [true, false]) {
    await t.test(collection ? "collection" : "dependency", async (t) => {
      const paths = [];
      const runtime = fixtureRuntime(t, (url, init) => {
        paths.push(url.pathname);
        if (url.pathname === "/IPublishedFileService/GetDetails/v1/") {
          assert.equal(url.searchParams.get("includechildren"), "true");
          assert.equal(url.searchParams.get("includeadditionalpreviews"), "true");
          return json({ response: { publishedfiledetails: [{
            file_type: collection ? 2 : 0, children: [{ publishedfileid: "201" }, { publishedfileid: "200" }],
            previews: [{ url: "https://images.invalid/full.jpg", preview_type: 0 }],
          }] } });
        }
        assert.equal(init.method, "POST");
        assert.ok(init.body instanceof FormData);
        assert.equal(init.body.has("key"), false);
        if (url.pathname === "/ISteamRemoteStorage/GetCollectionDetails/v1/") {
          assert.ok(collection);
          assert.equal(init.body.get("collectioncount"), "1");
          return json({ response: { collectiondetails: [{ result: 1, publishedfileid: "100", children: [{ publishedfileid: "201" }, { publishedfileid: "200" }] }] } });
        }
        assert.equal(url.pathname, "/ISteamRemoteStorage/GetPublishedFileDetails/v1/");
        const ids = [...init.body].filter(([key]) => key.startsWith("publishedfileids[")).map(([, value]) => value);
        return json({ response: { publishedfiledetails: ids.reverse().map((id) => ({
          result: 1, publishedfileid: id, file_type: id === "100" && collection ? 2 : 0,
          title: `Fixture ${id}`, preview_url: "https://images.invalid/main.jpg",
        })) } });
      });
      const response = await browser.fetch(new Request("https://worker.invalid/detail?id=100&with_previews=1"), env, runtime.ctx);
      assert.equal(response.status, 200);
      const item = (await response.json()).response.publishedfiledetails[0];
      assert.deepEqual(item[collection ? "child_items" : "required_items"].map((child) => child.publishedfileid), ["201", "200"]);
      assert.equal(item[collection ? "required_items" : "child_items"], undefined);
      assert.equal(item.preview_url, "https://images.invalid/full.jpg");
      assert.equal(paths.includes("/ISteamRemoteStorage/GetCollectionDetails/v1/"), collection);
      await runtime.flush();
      assert.equal(runtime.summaries.length, 1);
      assertSummary(runtime.summaries[0], {
        route: "/detail", cache: "miss", http_status: 200, steam_keyed: 1,
        steam_unkeyed: collection ? 3 : 2, steam_http: { keyed_200: 1, unkeyed_200: collection ? 3 : 2 },
        steam_endpoints: { get_details: 1, published_file_details: 2, collection_details: collection ? 1 : 0, query_files: 0 },
      });
    });
  }
});

test("100 update IDs use one Steam call and share a cache key across orderings", async (t) => {
  const anonymousEnv = { get STEAM_API_KEY() { throw new Error("updates must not read the Steam key"); } };
  const ids = Array.from({ length: 99 }, (_, i) => String(i + 1)).concat("18446744073709551615");
  const stored = new Map();
  const cache = {
    match: async request => stored.get(request.url)?.clone(),
    put: async (request, response) => stored.set(request.url, response.clone()),
  };
  let calls = 0;
  const runtime = fixtureRuntime(t, (url, init) => {
    calls++;
    assert.equal(url.pathname, "/ISteamRemoteStorage/GetPublishedFileDetails/v1/");
    assert.equal(init.method, "POST");
    assert.equal(init.body.get("itemcount"), "100");
    const sent = Array.from({ length: 100 }, (_, i) => init.body.get(`publishedfileids[${i}]`));
    assert.deepEqual(sent, [...ids].sort());
    return json({ response: { result: 1, resultcount: sent.length, publishedfiledetails: sent.reverse().map(id => ({
      publishedfileid: id, result: 1, time_updated: "1700000000", description: "unused",
    })) } });
  }, cache);
  for (const group of [ids, [...ids].reverse()]) {
    const res = await browser.fetch(new Request("https://worker.invalid/updates?ids=" + group.join(",")), anonymousEnv, runtime.ctx);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("cache-control"), /s-maxage=3600/);
    const { items } = await res.json();
    assert.deepEqual(items, [...ids].sort().map(id => ({ publishedfileid: id, result: 1, time_updated: 1700000000 })));
    await runtime.flush();
  }
  assert.equal(calls, 1);
  assert.equal(stored.size, 1);
  assert.deepEqual(runtime.summaries.map(s => [s.route, s.cache, s.steam_keyed, s.steam_unkeyed, s.steam_http]), [
    ["/updates", "miss", 0, 1, { unkeyed_200: 1 }], ["/updates", "hit", 0, 0, {}],
  ]);
});

test("update batches isolate unavailable, missing, duplicate and malformed rows and do not cache them", async (t) => {
  let calls = 0;
  const runtime = fixtureRuntime(t, (url, init) => {
    calls++;
    assert.equal(url.pathname, "/ISteamRemoteStorage/GetPublishedFileDetails/v1/");
    assert.equal(init.body.get("itemcount"), "6");
    return json({ response: { result: 1, publishedfiledetails: [
      { publishedfileid: "99", result: 9 },
      { publishedfileid: "5", result: 1, time_updated: 0 },
      { publishedfileid: "3", result: 15 },
      { publishedfileid: "6", result: 9 },
      { publishedfileid: "2", result: 9, time_updated: 1800000000 },
      { publishedfileid: "1", result: 1, time_updated: 1700000000 },
      { publishedfileid: "6", result: 1, time_updated: 1700000000 },
    ] } });
  }, { match: async () => undefined, put: async () => assert.fail("partial responses cannot be cached") });
  for (let n = 0; n < 2; n++) {
    const res = await browser.fetch(new Request("https://worker.invalid/updates?ids=2,1,3,2,4,5,6"), {}, runtime.ctx);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual((await res.json()).items, [
      { publishedfileid: "1", result: 1, time_updated: 1700000000 },
      { publishedfileid: "2", result: 9 }, { publishedfileid: "3", result: 15 },
      { publishedfileid: "4", result: 0 }, { publishedfileid: "5", result: 1 }, { publishedfileid: "6", result: 0 },
    ]);
    await runtime.flush();
  }
  assert.equal(calls, 2);
});

test("updates reject bad batches before Steam and preserve retryable upstream failures", async (t) => {
  let calls = 0;
  const runtime = fixtureRuntime(t, () => {
    calls++;
    if (calls === 1) return new Response("", { status: 429, headers: { "Retry-After": "7" } });
    return json({ response: { result: 2, publishedfiledetails: [{ publishedfileid: "1", result: 9 }] } });
  });
  for (const qs of ["", "ids=0", "ids=01", "ids=1,,3", "ids=-1", "ids=18446744073709551616", "ids=1&ids=2", "ids=2&foo=1", "ids=" + Array(101).fill("1").join(",")]) {
    const r = await browser.fetch(new Request("https://worker.invalid/updates?" + qs), {}, runtime.ctx);
    assert.equal(r.status, 400, qs);
  }
  const endpoint = "https://worker.invalid/updates?ids=1";
  assert.equal((await browser.fetch(new Request(endpoint, { method: "POST" }), {}, runtime.ctx)).status, 405);
  assert.equal(calls, 0);
  const limited = await browser.fetch(new Request(endpoint), {}, runtime.ctx);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("Retry-After"), "7");
  assert.equal((await browser.fetch(new Request(endpoint), {}, runtime.ctx)).status, 502);
  await runtime.flush();
  assert.equal(runtime.summaries.length, 12);
  for (const s of runtime.summaries.slice(0, -2)) {
    assertSummary(s, { cache: "not_checked", steam_keyed: 0, steam_unkeyed: 0, steam_http: {} });
  }
  assertSummary(runtime.summaries.at(-2), { cache: "miss", http_status: 429, steam_unkeyed: 1, steam_http: { unkeyed_429: 1 } });
  assertSummary(runtime.summaries.at(-1), { cache: "miss", http_status: 502, steam_unkeyed: 1, steam_http: { unkeyed_200: 1 } });
});

test("legacy detail clients still receive the Steam result 9 envelope", async (t) => {
  const row = { publishedfileid: "767890855", result: 9 };
  const calls = [];
  const runtime = fixtureRuntime(t, (url) => {
    const method = url.pathname.split("/")[2];
    calls.push(method);
    const key = method === "GetPublishedFileDetails" ? "publishedfiledetails" : "collectiondetails";
    return json({ response: { result: 1, resultcount: 1, [key]: [row] } });
  });
  const r = await browser.fetch(new Request("https://worker.invalid/detail?id=767890855"), {}, runtime.ctx);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { response: { result: 1, resultcount: 1, publishedfiledetails: [row] } });
  assert.deepEqual(calls, ["GetPublishedFileDetails", "GetCollectionDetails"]);
  await runtime.flush();
});

test("early returns and unknown paths keep bounded labels and reflect where validation happens", async (t) => {
  const runtime = fixtureRuntime(t, () => assert.fail("unexpected Steam call"));
  const base = "https://worker.invalid";
  const opaqueURL = base + "/private-path-sentinel?q=private-query-sentinel";
  for (const [worker, request, route, status, cache] of [
    [browser, new Request(opaqueURL), "other", 404, "miss"],
    [browser, new Request(base + "/detail"), "/detail", 500, "miss"],
    [browser, new Request(base + "/list", { method: "OPTIONS" }), "/list", 200, "not_checked"],
    [parser, new Request(opaqueURL, { method: "OPTIONS" }), "parse", 200, "not_checked"],
    [parser, new Request(opaqueURL), "parse", 405, "not_checked"],
    [parser, new Request(opaqueURL, { method: "POST", body: "invalid JSON" }), "parse", 400, "not_checked"],
    [parser, parserRequest([]), "parse", 400, "not_checked"],
  ]) {
    assert.equal((await worker.fetch(request, env, runtime.ctx)).status, status);
    assertSummary(runtime.summaries.at(-1), { route, http_status: status, cache, steam_keyed: 0, steam_unkeyed: 0 });
  }
  assert.equal(runtime.summaries.length, 7);
  assert.doesNotMatch(JSON.stringify(runtime.summaries), /sentinel|worker\.invalid|fixture-key/);
});

test("HTTP 409 from a cached response has zero attempts; Steam 409 is counted with its actual client status", async (t) => {
  let hit = true;
  const conflict = () => new Response(null, { status: 409 });
  const runtime = fixtureRuntime(t, conflict, { match: async () => hit ? conflict() : undefined });
  const updates = () => new Request("https://worker.invalid/updates?ids=123");
  for (const [worker, makeRequest] of [[browser, updates], [parser, () => parserRequest(["123"])]]) {
    hit = true;
    assert.equal((await worker.fetch(makeRequest(), env, runtime.ctx)).status, 409);
    assertSummary(runtime.summaries.at(-1), { cache: "hit", http_status: 409, steam_keyed: 0, steam_unkeyed: 0, steam_http: {} });
    hit = false;
    assert.equal((await worker.fetch(makeRequest(), env, runtime.ctx)).status, 502);
    assertSummary(runtime.summaries.at(-1), { cache: "miss", http_status: 502, steam_keyed: Number(worker === parser),
      steam_unkeyed: Number(worker === browser), steam_http: worker === browser ? { unkeyed_409: 1 } : { keyed_409: 1 } });
  }
  assert.equal(runtime.summaries.length, 4);
});

test("cache errors preserve the original exception or the updates fallback", async (t) => {
  const failure = new Error("cache-error-sentinel");
  const fail = async () => { throw failure; };
  const runtime = fixtureRuntime(t, () => json({ response: { result: 1, resultcount: 1, publishedfiledetails: [
    { result: 1, publishedfileid: "123", time_updated: 1700000000 },
  ] } }), { match: fail, put: async () => {} });
  t.mock.method(caches, "open", fail);
  const base = "https://worker.invalid";
  for (const [worker, request] of [[browser, new Request(base + "/list")], [browser, new Request(base + "/detail?id=123")],
    [parser, parserRequest(["123"])]]) {
    await assert.rejects(worker.fetch(request, env, runtime.ctx), error => error === failure);
    assertSummary(runtime.summaries.at(-1), { cache: "error", http_status: null, steam_keyed: 0, steam_unkeyed: 0 });
  }
  const result = await browser.fetch(new Request(base + "/updates?ids=123"), env, runtime.ctx);
  assert.equal(result.status, 200);
  assert.equal((await result.json()).items[0].time_updated, 1700000000);
  await runtime.flush();
  assertSummary(runtime.summaries.at(-1), { route: "/updates", cache: "error", http_status: 200,
    steam_keyed: 0, steam_unkeyed: 1, steam_http: { unkeyed_200: 1 } });
  assert.equal(runtime.summaries.length, 4);
  assert.doesNotMatch(JSON.stringify(runtime.summaries), /cache-error-sentinel/);
});

test("a Fetch error response counts one attempt without inventing an HTTP status", async (t) => {
  const runtime = fixtureRuntime(t, () => Response.error());
  assert.equal((await browser.fetch(new Request("https://worker.invalid/updates?ids=123"), env, runtime.ctx)).status, 502);
  assert.equal((await parser.fetch(parserRequest(["123"]), env, runtime.ctx)).status, 502);
  assert.deepEqual(runtime.summaries.map(s => [s.steam_keyed, s.steam_unkeyed, s.steam_fetch_errors, s.steam_http]),
    [[0, 1, 1, {}], [1, 0, 1, {}]]);
});

test("a delayed preview is attributed to its own request after an early error response", async (t) => {
  const preview = Promise.withResolvers();
  const secretID = "9955227733";
  const ip = "192.0.2.71";
  const runtime = fixtureRuntime(t, (url, init) => {
    if (url.pathname.includes("/GetDetails/")) return preview.promise;
    const id = init.body.get("publishedfileids[0]");
    if (id === secretID) return new Response(null, { status: 503 });
    return json({ response: { publishedfiledetails: [{ publishedfileid: id, file_type: 0 }] } });
  });
  const first = await browser.fetch(new Request(`https://worker.invalid/detail?id=${secretID}&with_previews=1`,
    { headers: { "CF-Connecting-IP": ip } }), env, runtime.ctx);
  assert.equal(first.status, 500);
  assert.equal(runtime.summaries.length, 0);
  const second = await browser.fetch(new Request("https://worker.invalid/detail?id=123"), env, runtime.ctx);
  assert.equal(second.status, 200);
  assert.equal(runtime.summaries.length, 1);
  assertSummary(runtime.summaries[0], { http_status: 200, steam_keyed: 0, steam_unkeyed: 1, steam_http: { unkeyed_200: 1 } });
  preview.reject(new Error(`upstream-sentinel: https://api.steampowered.com/x?key=${env.STEAM_API_KEY}&id=${secretID}`));
  await runtime.flush();
  assert.equal(runtime.summaries.length, 2);
  assertSummary(runtime.summaries[1], { route: "/detail", http_status: 500, steam_keyed: 1, steam_unkeyed: 1,
    steam_http: { unkeyed_503: 1 }, steam_fetch_errors: 1 });
  const serialized = JSON.stringify(runtime.summaries);
  for (const value of [env.STEAM_API_KEY, secretID, ip, "upstream-sentinel", "https://"]) assert.ok(!serialized.includes(value));
});

test("a throttled keyed preview keeps the basic detail and reports both Steam statuses", async (t) => {
  const runtime = fixtureRuntime(t, url => url.pathname.includes("/GetDetails/")
    ? new Response(null, { status: 429 })
    : json(listData([{ publishedfileid: "123", file_type: 0, preview_url: "fixture-cover" }])));
  const response = await browser.fetch(new Request("https://worker.invalid/detail?id=123&with_previews=1"), env, runtime.ctx);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).response.publishedfiledetails[0].previews[0].preview_url, "fixture-cover");
  await runtime.flush();
  assert.equal(runtime.summaries.length, 1);
  assertSummary(runtime.summaries[0], { steam_keyed: 1, steam_unkeyed: 1, http_status: 200,
    steam_http: { keyed_429: 1, unkeyed_200: 1 } });
});

test("failed collection probes and child chunks preserve detail fallback without logging raw errors", async (t) => {
  const children = Array.from({ length: 101 }, (_, index) => ({ publishedfileid: String(1001 + index) }));
  const runtime = fixtureRuntime(t, (url, init) => {
    const id = init?.body?.get("publishedfileids[0]");
    if (url.pathname.includes("/GetDetails/")) return json(listData([{ children }]));
    if (url.pathname.includes("/GetCollectionDetails/") || id === "1101") {
      throw new Error(`failure-sentinel ${url}?key=${env.STEAM_API_KEY}&id=${id}`);
    }
    if (id === "123") return json(listData([{ publishedfileid: id }])); // Missing type triggers a collection probe.
    assert.equal(init.body.get("itemcount"), "100");
    return json(listData([]));
  });
  const response = await browser.fetch(new Request("https://worker.invalid/detail?id=123&with_previews=1"), env, runtime.ctx);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).response.publishedfiledetails[0].required_items, []);
  await runtime.flush();
  assert.equal(runtime.summaries.length, 1);
  assertSummary(runtime.summaries[0], { steam_keyed: 1, steam_unkeyed: 4, steam_fetch_errors: 2,
    steam_http: { keyed_200: 1, unkeyed_200: 2 },
    steam_endpoints: { query_files: 0, get_details: 1, published_file_details: 3, collection_details: 1 },
  });
  assert.doesNotMatch(JSON.stringify(runtime.summaries), /failure-sentinel|fixture-key|https:\/\//);
});

test("parse stops counting at a failed chunk and counts a concurrent retry and subsequent cache hit separately", async (t) => {
  const failure = Promise.withResolvers();
  const secondChunk = Promise.withResolvers();
  let calls = 0;
  const cached = new Map();
  const runtime = fixtureRuntime(t, () => {
    if (++calls === 2) {
      secondChunk.resolve();
      return failure.promise;
    }
    return json({ response: { publishedfiledetails: [] } });
  }, {
    match: async key => cached.get(key.url)?.clone(),
    put: async (key, value) => cached.set(key.url, value.clone()),
  });
  const ids = Array.from({ length: 201 }, (_, i) => String(i + 1));
  const first = parser.fetch(parserRequest(ids), env, runtime.ctx);
  await secondChunk.promise;
  assert.equal((await parser.fetch(parserRequest(ids), env, runtime.ctx)).status, 200);
  failure.reject(new Error("parse-fetch-sentinel"));
  assert.equal((await first).status, 502);
  await runtime.flush();
  assert.equal((await parser.fetch(parserRequest(ids.reverse()), env, runtime.ctx)).status, 200);
  assert.deepEqual(runtime.summaries.map(s => [s.cache, s.http_status, s.steam_keyed, s.steam_fetch_errors, s.steam_http]), [
    ["miss", 200, 3, 0, { keyed_200: 3 }], ["miss", 502, 2, 1, { keyed_200: 1 }], ["hit", 200, 0, 0, {}],
  ]);
  assert.equal(calls, 5);
});

test("an unconfigured list or preview never charges a configured key in the summary", async (t) => {
  const runtime = fixtureRuntime(t, (url) => {
    if (url.pathname.includes("/QueryFiles/")) {
      assert.equal(url.searchParams.get("key"), "undefined"); // Existing wire behavior without a binding.
      return new Response(null, { status: 403 });
    }
    assert.equal(url.pathname, "/ISteamRemoteStorage/GetPublishedFileDetails/v1/");
    return json({ response: { publishedfiledetails: [{ publishedfileid: "123", file_type: 0 }] } });
  });
  const base = "https://worker.invalid";
  assert.equal((await browser.fetch(new Request(base + "/list?filetype=0"), {}, runtime.ctx)).status, 500);
  assert.equal((await browser.fetch(new Request(base + "/detail?id=123&with_previews=1"), {}, runtime.ctx)).status, 200);
  assert.deepEqual(runtime.summaries.map(s => [s.steam_keyed, s.steam_unkeyed, s.steam_http]), [
    [0, 1, { unkeyed_403: 1 }], [0, 1, { unkeyed_200: 1 }],
  ]);
  await runtime.flush();
});

test("a throwing log sink preserves both Workers' responses and cache exceptions", async (t) => {
  const failure = new Error("original cache failure");
  let broken = false;
  const runtime = fixtureRuntime(t, () => assert.fail("unexpected Steam call"), {
    match: async () => {
      if (broken) throw failure;
      return new Response("cached body", { headers: { "X-Fixture": "cached" } });
    },
  });
  runtime.log.mock.mockImplementation(() => { throw new Error("unavailable log sink"); });
  for (const [worker, makeRequest] of [[browser, () => new Request("https://worker.invalid/list")], [parser, () => parserRequest(["1"])]]) {
    broken = false;
    const response = await worker.fetch(makeRequest(), env, runtime.ctx);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("X-Fixture"), "cached");
    assert.equal(await response.text(), "cached body");
    broken = true;
    await assert.rejects(worker.fetch(makeRequest(), env, runtime.ctx), error => error === failure);
  }
  assert.equal(runtime.summaries.length, 4);
});
