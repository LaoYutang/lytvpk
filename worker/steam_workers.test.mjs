import assert from "node:assert/strict";
import test from "node:test";
import parser from "./steam_api_worker.js";
import browser from "./steam_workshop_worker.js";

const env = { STEAM_API_KEY: "fixture-key" };
const json = (value) => Response.json(value);

function fixtureRuntime(t, upstream) {
  const previousCaches = globalThis.caches;
  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
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
