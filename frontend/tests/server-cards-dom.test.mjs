import assert from "node:assert/strict";
import test from "node:test";
import {
  applyServerDisplayMode,
  applyServerSearch,
  configureServers,
  fetchServerInfo,
  initServerStorage,
  renderServers,
} from "../src/js/features/servers/servers.js";

class Element {
  constructor(tagName = "div") {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = {};
    this.className = "";
    this.value = "";
    this.classList = {
      contains: (name) => this.className.split(/\s+/).includes(name),
      toggle: (name, active = !this.classList.contains(name)) => {
        const names = new Set(this.className.split(/\s+/).filter(Boolean));
        if (active) names.add(name); else names.delete(name);
        this.className = [...names].join(" ");
        return active;
      },
      add: (...names) => names.forEach((name) => this.classList.toggle(name, true)),
      remove: (...names) => names.forEach((name) => this.classList.toggle(name, false)),
    };
  }
  set innerHTML(_) { throw new Error("Server rendering must create DOM nodes"); }
  set textContent(value) {
    this.replaceChildren();
    this.value = String(value ?? "");
  }
  get textContent() { return this.value + this.children.map((child) => child.textContent).join(""); }
  get isConnected() { return this === document.body || Boolean(this.parentElement?.isConnected); }
  append(...nodes) { nodes.forEach((node) => this.appendChild(node)); }
  appendChild(node) {
    node.remove();
    node.parentElement = this;
    this.children.push(node);
    return node;
  }
  remove() {
    if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
    this.parentElement = null;
  }
  replaceChildren(...nodes) {
    for (const child of [...this.children]) child.remove();
    this.value = "";
    this.append(...nodes);
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  matches(selector) {
    if (selector === "[data-server-view-mode]") return "serverViewMode" in this.dataset;
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    const [tag, ...classes] = selector.split(".");
    return (!tag || this.tagName === tag) && classes.every((name) => this.classList.contains(name));
  }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) {
    return this.matches(selector) ? this : this.parentElement?.closest(selector) || null;
  }
  getBoundingClientRect() { return { top: 0, bottom: 40, right: 240 }; }
  cloneNode(deep) {
    const clone = new Element(this.tagName);
    clone.className = this.className;
    clone.value = this.value;
    if (deep) this.children.forEach((child) => clone.appendChild(child.cloneNode(true)));
    return clone;
  }
}

let list;
let config;
let storage;
let queries;
let query;
let lookupMap;
let parsedIcons;
let connections;
let playerQueries;
let clipboardWrites;
let clipboardWrite;
let feedback;

function server(overrides = {}) {
  return { id: "favorite-one", name: "Favorite server", address: "127.0.0.1:27015", ...overrides };
}
function status(overrides = {}) {
  return { name: "Reported server", mode: "coop", map: "c1m1_hotel", players: 4, max_players: 8, ...overrides };
}
async function settle() { for (let index = 0; index < 8; index++) await Promise.resolve(); }
function row() { return list.querySelector("li.server-item"); }
function count(item = row()) { return item.querySelector(".server-population-count").textContent; }
function label(item = row()) { return item.querySelector(".server-population-label").textContent; }

test.beforeEach(async (t) => {
  t.mock.method(console, "error", () => {});
  const body = new Element("body");
  list = new Element("ul");
  list.id = "server-list";
  body.appendChild(list);
  for (const id of [
    "server-search-input", "global-dropdown",
    "server-details-modal", "details-server-name", "server-details-loading",
    "server-details-content", "details-map", "details-players", "details-player-list",
  ]) {
    const node = new Element();
    node.id = id;
    if (id.endsWith("modal") || id === "global-dropdown") node.classList.add("hidden");
    body.appendChild(node);
  }
  globalThis.document = {
    body,
    createElement: (tag) => new Element(tag),
    importNode: (node, deep) => node.cloneNode(deep),
    querySelectorAll: (selector) => body.querySelectorAll(selector),
    getElementById: (id) => body.querySelector(`#${id}`),
  };
  parsedIcons = [];
  globalThis.DOMParser = class {
    parseFromString(source, type) {
      parsedIcons.push({ source, type });
      const svg = new Element("svg");
      svg.className = source.match(/class="([^"]*)"/)?.[1] || "";
      return { documentElement: svg };
    }
  };
  config = { displayMode: "card", serverDisplayMode: "list" };
  storage = { servers: [server()], recentServers: [] };
  queries = [];
  connections = [];
  playerQueries = [];
  clipboardWrites = [];
  feedback = [];
  clipboardWrite = async (address) => { clipboardWrites.push(address); };
  query = async () => status();
  lookupMap = async (code) => code;
  configureServers({
    getConfig: () => config,
    ClipboardSetText: (address) => clipboardWrite(address),
    showNotification: (message) => feedback.push({ type: "success", message }),
    showError: (message) => feedback.push({ type: "error", message }),
    GetServerStorage: async () => structuredClone(storage),
    FetchServerInfo: (address) => { queries.push(address); return query(address); },
    FetchPlayerList: (address) => { playerQueries.push(address); return new Promise(() => {}); },
    ConnectToServer: async (address) => { connections.push(address); },
    GetMapName: (code) => lookupMap(code),
  });
  await initServerStorage();
});
test.after(() => {
  delete globalThis.document;
  delete globalThis.DOMParser;
});

test("reported population is shown unchanged in both views, including capacity overflow and bots", async () => {
  query = async () => status({ players: 9, max_players: 8, bots: 7 });
  renderServers();
  await settle();
  assert.equal(count(), "9/8", "population must not subtract guessed bot counts or clamp to capacity");
  assert.equal(row().querySelector(".players-badge").textContent, "9/8");
  assert.equal(row().dataset.queryState, "online");
  assert.match(row().querySelector(".server-population").title, /可能包含机器人/);
  assert.doesNotMatch(row().textContent, /真人/);
  config.serverDisplayMode = "card";
  applyServerDisplayMode();
  assert.equal(count(), "9/8");
  assert.equal(config.displayMode, "card", "the Mod view remains independent");
});

test("copying a card address targets that favorite without opening details or querying players", async () => {
  config.serverDisplayMode = "card";
  renderServers();
  await settle();
  const button = row().querySelector(".copy-server-address-btn");
  let stopped = false;
  await button.listeners.get("click")({ stopPropagation() { stopped = true; } });
  assert.equal(stopped, true);
  assert.deepEqual(clipboardWrites, [server().address]);
  assert.equal(queries.length, 1);
  assert.equal(playerQueries.length, 0);
  assert.equal(document.getElementById("server-details-modal").classList.contains("hidden"), true);
  assert.deepEqual(feedback, [{ type: "success", message: "服务器地址已复制" }]);
});

test("clipboard failures show an error without reporting success", async () => {
  clipboardWrite = async () => { throw new Error("fixture clipboard unavailable"); };
  renderServers();
  await settle();
  await row().querySelector(".copy-server-address-btn").listeners.get("click")({ stopPropagation() {} });
  assert.equal(feedback.length, 1);
  assert.equal(feedback[0].type, "error");
  assert.match(feedback[0].message, /复制服务器地址失败/);
  assert.equal(playerQueries.length, 0);
});

test("the card subtitle uses literal live-server text and clears on query failure", async () => {
  const name = '<img src=x onerror="unexpected()">';
  query = async () => status({ name });
  renderServers();
  await settle();
  assert.equal(row().querySelector(".server-live-name").textContent, name);
  assert.equal(row().querySelector(".server-live-name").title, name);
  query = async () => { throw new Error("fixture timeout"); };
  await fetchServerInfo(server().address, 0);
  assert.equal(row().querySelector(".server-live-name").textContent, "");
  assert.equal(label(), "查询失败");
});

test("zero population, a failed query and an unfinished retry remain distinct", async () => {
  query = async () => status({ players: 0 });
  renderServers();
  await settle();
  assert.equal(count(), "0/8");
  assert.equal(label(), "暂无玩家");
  assert.equal(row().dataset.queryState, "empty");

  query = async () => { throw new Error("fixture query timeout"); };
  await fetchServerInfo(server().address, 0);
  assert.equal(count(), "—");
  assert.equal(label(), "查询失败");
  assert.equal(row().dataset.queryState, "error");
  assert.match(row().querySelector(".server-details").textContent, /刷新重试/);
  assert.equal(row().querySelector(".players-badge"), null, "stale zero must not survive a failed query");

  const retry = Promise.withResolvers();
  query = () => retry.promise;
  const pending = fetchServerInfo(server().address, 0);
  assert.equal(count(), "—");
  assert.equal(label(), "查询中");
  assert.equal(row().querySelector(".server-details").attributes.get("aria-busy"), "true");
  retry.resolve(status({ players: 0 }));
  await pending;
  assert.equal(count(), "0/8");
  assert.equal(row().querySelector(".server-details").attributes.get("aria-busy"), "false");
});

test("favorite and live server text never becomes parsed HTML", async () => {
  const payload = '<img src=x onerror="globalThis.unexpected = true">';
  storage.servers = [server({ name: payload })];
  await initServerStorage();
  query = async () => status({ name: payload, mode: payload, map: payload });
  renderServers();
  await settle();
  assert.equal(row().querySelector(".server-name").textContent, payload);
  assert.equal(row().querySelector(".name-badge").textContent, payload);
  assert.equal(row().querySelector(".mode-badge").textContent, payload);
  assert.equal(row().querySelector(".map-badge").textContent, payload);
  assert.equal(row().querySelector("img"), null);
  assert.ok(parsedIcons.every(({ source, type }) => source.startsWith("<svg ") && type === "image/svg+xml"));
  assert.ok(parsedIcons.every(({ source }) => !source.includes(payload)));
});

for (const rejectOld of [false, true]) {
  test(`an older refresh ${rejectOld ? "failure" : "success"} cannot replace a newer population`, async () => {
    const old = Promise.withResolvers();
    const latest = Promise.withResolvers();
    query = () => old.promise;
    renderServers();
    query = () => latest.promise;
    const pending = fetchServerInfo(server().address, 0);
    latest.resolve(status({ players: 6 }));
    await pending;
    assert.equal(count(), "6/8");
    if (rejectOld) old.reject(new Error("obsolete timeout"));
    else old.resolve(status({ players: 0 }));
    await settle();
    assert.equal(count(), "6/8");
    assert.equal(row().dataset.queryState, "online");
  });
}

test("a response for a removed row cannot alter its replacement at the same index", async () => {
  const old = Promise.withResolvers();
  query = () => old.promise;
  renderServers();
  const removed = row();
  storage.servers = [server({ id: "favorite-two", address: "127.0.0.2:27015", name: "Second server" })];
  await initServerStorage();
  query = async () => status({ players: 3 });
  renderServers();
  await settle();
  assert.equal(removed.isConnected, false);
  assert.equal(count(), "3/8");
  old.resolve(status({ players: 0 }));
  await settle();
  assert.equal(count(), "3/8");
  assert.equal(row().dataset.address, "127.0.0.2:27015");
  assert.equal(count(removed), "—", "detached content is not updated either");
});

test("view switches preserve row identity and pending work without sending more server queries", async () => {
  const pendingInfo = Promise.withResolvers();
  query = () => pendingInfo.promise;
  renderServers();
  const original = row();
  assert.equal(queries.length, 1);
  assert.equal(list.classList.contains("server-list-card"), false, "Mod card mode does not affect servers");
  config.serverDisplayMode = "card";
  applyServerDisplayMode();
  assert.equal(row(), original);
  assert.equal(list.classList.contains("server-list-card"), true);
  assert.equal(label(), "查询中");
  assert.equal(queries.length, 1);
  pendingInfo.resolve(status({ players: 5 }));
  await settle();
  assert.equal(count(), "5/8");
  const map = row().querySelector(".map-badge");
  config.serverDisplayMode = "list";
  applyServerDisplayMode();
  assert.equal(row(), original);
  assert.equal(row().querySelector(".map-badge"), map);
  assert.equal(count(), "5/8");
  assert.equal(queries.length, 1);
  assert.equal(list.classList.contains("server-list-card"), false);
  assert.equal(row().tabIndex, -1);
});

test("late map metadata does not replace metadata from a refreshed server query", async () => {
  const oldMapName = Promise.withResolvers();
  lookupMap = () => oldMapName.promise;
  renderServers();
  await settle();
  const originalMap = row().querySelector(".map-badge");
  const pendingName = originalMap.listeners.get("click")({ stopPropagation() {} });
  assert.equal(originalMap.textContent, "解析中...");
  query = async () => status({ map: "c2m1_highway" });
  await fetchServerInfo(server().address, 0);
  const currentMap = row().querySelector(".map-badge");
  oldMapName.resolve("Obsolete map title");
  await pendingName;
  assert.equal(originalMap.isConnected, false);
  assert.equal(currentMap.textContent, "c2m1_highway");
});

test("empty favorites render a single empty state without population or queries", async () => {
  storage.servers = [];
  await initServerStorage();
  config.serverDisplayMode = "card";
  renderServers();
  assert.equal(list.children.length, 1);
  assert.match(list.children[0].textContent, /还没有收藏服务器/);
  assert.equal(list.querySelector(".server-population"), null);
  assert.equal(queries.length, 0);
});

test("card click and keyboard open details while list mode preserves double-click behavior", async () => {
  renderServers();
  await settle();
  const item = row();
  const name = item.querySelector(".server-name");
  const modal = document.getElementById("server-details-modal");
  const trigger = (type, target = name, extra = {}) => item.listeners.get(type)({ target, ...extra });
  assert.equal(playerQueries.length, 0, "cards do not fetch player names while rendering");
  trigger("click");
  assert.equal(modal.classList.contains("hidden"), true);
  assert.equal(queries.length, 1);
  trigger("dblclick");
  assert.equal(document.getElementById("details-server-name").textContent, server().name);
  assert.equal(modal.classList.contains("hidden"), false);
  assert.equal(queries.length, 2);

  modal.classList.add("hidden");
  config.serverDisplayMode = "card";
  applyServerDisplayMode();
  trigger("dblclick");
  assert.equal(modal.classList.contains("hidden"), true);
  trigger("click");
  assert.equal(modal.classList.contains("hidden"), false);
  assert.equal(queries.length, 3);
  trigger("click", item.querySelector(".connect-server-btn"));
  trigger("click", item.querySelector(".map-badge"));
  assert.equal(queries.length, 3, "nested operation buttons never open server details");

  let prevented = false;
  trigger("keydown", item, { key: "Enter", preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(queries.length, 4);
  assert.ok(queries.every((address) => address === server().address));
  await settle();
});

test("search hides rows without changing weight order, operation targets or original menu indices", async () => {
  const alpha = server({ name: "Alpha", weight: 10 });
  const bravo = server({ id: "bravo", address: "127.0.0.2:27015", name: "Bravo", weight: 30 });
  const another = server({ id: "alpha-two", address: "127.0.0.3:27015", name: "Alpha Two", weight: 0 });
  storage.servers = [alpha, bravo, another];
  await initServerStorage();
  renderServers();
  await settle();
  const original = document.querySelectorAll("li.server-item");
  assert.deepEqual(original.map((item) => item.dataset.address), [bravo.address, alpha.address, another.address]);
  config.serverDisplayMode = "card";
  applyServerDisplayMode();
  document.getElementById("server-search-input").value = "  aLPHa  ";
  applyServerSearch();
  assert.equal(original[0].classList.contains("hidden"), true);
  assert.equal(original[1].classList.contains("hidden"), false);
  assert.equal(original[2].classList.contains("hidden"), false);
  assert.equal(queries.length, 3, "filtering does not query servers again");

  const visible = original[1];
  const more = visible.querySelector(".server-more-btn");
  more.listeners.get("click")({ stopPropagation() {} });
  assert.equal(document.getElementById("global-dropdown").dataset.index, "1", "first visible result retains its original weighted index");
  const connect = visible.querySelector(".connect-server-btn");
  connect.listeners.get("click")({ target: connect });
  await settle();
  assert.deepEqual(connections, [alpha.address]);
  visible.listeners.get("click")({ target: visible.querySelector(".server-name") });
  assert.equal(document.getElementById("details-server-name").textContent, alpha.name);
  assert.equal(queries.at(-1), alpha.address);

  document.getElementById("server-search-input").value = "";
  applyServerSearch();
  assert.deepEqual(document.querySelectorAll("li.server-item"), original, "clearing search restores the same nodes in their existing order");
  assert.ok(original.every((item) => !item.classList.contains("hidden")));
  assert.equal(document.getElementById("server-search-empty").classList.contains("hidden"), true);
  await settle();
});

test("search matches live server names as queries finish and keeps no-match distinct from no favorites", async () => {
  const gate = Promise.withResolvers();
  query = () => gate.promise;
  document.getElementById("server-search-input").value = "nightfall";
  renderServers();
  const item = row();
  assert.equal(item.classList.contains("hidden"), true);
  assert.equal(document.getElementById("server-search-empty").classList.contains("hidden"), false);
  assert.match(document.getElementById("server-search-empty").textContent, /没有匹配/);
  gate.resolve(status({ name: "Nightfall Hub" }));
  await settle();
  assert.equal(item.classList.contains("hidden"), false);
  assert.equal(document.getElementById("server-search-empty").classList.contains("hidden"), true);
  assert.equal(queries.length, 1);
  config.serverDisplayMode = "card";
  applyServerDisplayMode();
  assert.equal(item.classList.contains("hidden"), false);
  assert.equal(document.getElementById("server-search-input").value, "nightfall");
});
