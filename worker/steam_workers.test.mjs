import assert from "node:assert/strict";
import test from "node:test";
import parser from "./steam_api_worker.js";
import browser from "./steam_workshop_worker.js";

const env = { STEAM_API_KEY: "fixture-key" };
const json = (value) => Response.json(value);

function fixtureRuntime(t, upstream, cache = { match: async () => undefined, put: async () => {} }) {
  const previousCaches = globalThis.caches;
  globalThis.caches = { default: cache };
  t.after(() => {
    if (previousCaches === undefined) delete globalThis.caches;
    else globalThis.caches = previousCaches;
  });
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    assert.equal(url.origin, "https://api.steampowered.com");
    return upstream(url, init);
  });
  const pending = [];
  return {
    ctx: { waitUntil: (promise) => pending.push(promise) },
    flush: () => Promise.all(pending),
  };
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

test("browser keeps old 20-item cache entries until expiry while new keys return 50", async (t) => {
  let now = 0;
  let upstreamCalls = 0;
  const oldURL = "https://worker.invalid/list?filetype=0&page=1";
  const entries = new Map([[oldURL, {
    expires: 3600,
    response: new Response(JSON.stringify(listData(listItems(20), 200)), {
      headers: { "Cache-Control": "public, max-age=3600, s-maxage=3600" },
    }),
  }]]);
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
    async delete() { assert.fail("page-size changes must not purge existing caches"); },
  });
  const getItems = async (url) => {
    const response = await browser.fetch(new Request(url), env, runtime.ctx);
    assert.equal(response.status, 200);
    return (await response.json()).response.publishedfiledetails;
  };
  assert.equal((await getItems(oldURL)).length, 20);
  assert.equal(upstreamCalls, 0);
  const nextPage = await getItems("https://worker.invalid/list?filetype=0&page=2");
  assert.equal(nextPage.length, 50);
  assert.equal(nextPage[0].publishedfileid, "51", "mixed-size sessions still skip 21–50 until the old first page expires");
  assert.equal((await getItems(`${oldURL}&verification=fresh-key`)).length, 50);
  now = 3599;
  assert.equal((await getItems(oldURL)).length, 20);
  now = 3600;
  assert.equal((await getItems(oldURL)).length, 50);
  await runtime.flush();
  assert.equal(upstreamCalls, 3);
});

test("parser rejects missing configuration without calling Steam", async (t) => {
  const runtime = fixtureRuntime(t, () => assert.fail("unexpected upstream call"));
  const response = await parser.fetch(parserRequest(["100"]), {}, runtime.ctx);
  assert.equal(response.status, 503);
  await runtime.flush();
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
    });
  }
});
