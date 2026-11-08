import assert from "node:assert/strict";
import test from "node:test";
import { setAPILineState } from "../src/js/core/api-line.js";
import { configureServers, escapeHtml, escapeAttr, resolveMapName } from "../src/js/features/servers/servers.js";
import {
  configurePanelModal, openPanelServerDetailsModal, closePanelServerDetailsModal,
  refreshCurrentPanelStatus,
} from "../src/js/features/servers/panel-modal.js";

class Element {
  constructor() {
    const classes = new Set();
    this.classList = {
      add: (...values) => values.forEach((value) => classes.add(value)),
      remove: (...values) => values.forEach((value) => classes.delete(value)),
      contains: (value) => classes.has(value),
    };
    this.attributes = new Map();
    this.connected = true;
    this.textContent = "";
  }
  get isConnected() { return this.connected; }
  set innerHTML(value) {
    if (this.mapName) this.mapName.connected = false;
    this.html = value;
    this.mapName = null;
    const match = value.match(/id="panel-status-map-name">([^<]*)<\/span>/);
    if (match) {
      this.mapName = new Element();
      this.mapName.textContent = match[1];
    }
  }
  get innerHTML() {
    return this.html ?? String(this.textContent).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  }
  querySelector(selector) { return selector === "#panel-status-map-name" ? this.mapName : null; }
  setAttribute(key, value) { this.attributes.set(key, value); }
  removeAttribute(key) { this.attributes.delete(key); }
}

let elements;
let panelRequests;
let controlCalls;
const servers = [{ id: "one", name: "First server" }, { id: "two", name: "Second server" }];
test.beforeEach(() => {
  elements = new Map();
  globalThis.document = {
    createElement: () => new Element(),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    },
  };
  closePanelServerDetailsModal();
  setAPILineState("primary");
  panelRequests = [];
  controlCalls = 0;
});
test.after(() => { delete globalThis.document; });

function element(id) { return document.getElementById(id); }
function mapName() { return element("panel-status-summary").querySelector("#panel-status-map-name"); }
function status(map = "map_code", hostname = "Live server") {
  return {
    map, hostname, players: "1/8", gameMode: "coop", difficulty: "Normal",
    users: [{ name: "Alice", steamid: "fixture-player", delay: 15 }],
  };
}
function configure(mapLookup, fetchStatus = async () => status()) {
  configureServers({ GetMapName: mapLookup });
  configurePanelModal({
    resolveMapName, escapeHtml, escapeAttr, getIPHost: () => "",
    getServers: () => servers,
    FetchPanelServerStatus: (id) => { panelRequests.push(id); return fetchStatus(id); },
    RestartPanelServer: () => { controlCalls++; },
    ChangePanelMap: () => { controlCalls++; },
    SendPanelRconCommand: () => { controlCalls++; },
  });
}
async function settle() { for (let index = 0; index < 8; index++) await Promise.resolve(); }

test("map metadata from a previous line falls back to the original map code", async () => {
  const pending = Promise.withResolvers();
  configure(() => pending.promise);
  const resolving = resolveMapName("old_code");
  setAPILineState("backup");
  setAPILineState("primary");
  pending.resolve("A name from an older generation");
  assert.equal(await resolving, "old_code");
});

test("slow map metadata never blocks panel status, player information or the refresh button", async () => {
  const pending = Promise.withResolvers();
  configure(() => pending.promise);
  openPanelServerDetailsModal(0);
  await settle();
  assert.equal(element("panel-details-content").classList.contains("hidden"), false);
  assert.equal(element("panel-details-loading").classList.contains("hidden"), true);
  assert.equal(element("panel-refresh-btn").attributes.has("disabled"), false);
  assert.match(element("panel-status-summary").innerHTML, /Live server/);
  assert.match(element("panel-status-summary").innerHTML, /1\/8/);
  assert.match(element("panel-player-list").innerHTML, /Alice/);
  assert.equal(mapName().textContent, "map_code");
  pending.resolve("Resolved map name");
  await settle();
  assert.equal(mapName().textContent, "Resolved map name");
  assert.deepEqual(panelRequests, ["one"]);
  assert.equal(controlCalls, 0);
});

test("switching API line discards a late map name without repeating or disturbing panel status", async () => {
  const pending = Promise.withResolvers();
  configure(() => pending.promise);
  openPanelServerDetailsModal(0);
  await settle();
  setAPILineState("backup");
  pending.resolve("Stale map name");
  await settle();
  assert.equal(mapName().textContent, "map_code");
  assert.match(element("panel-player-list").innerHTML, /Alice/);
  assert.equal(element("panel-details-content").classList.contains("hidden"), false);
  assert.deepEqual(panelRequests, ["one"]);
  assert.equal(controlCalls, 0);
});

test("a refresh isolates old map names and old status responses", async () => {
  const firstMap = Promise.withResolvers();
  const latestMap = Promise.withResolvers();
  const oldStatus = Promise.withResolvers();
  let statuses = 0;
  configure((code) => code === "first_map" ? firstMap.promise : latestMap.promise, () => {
    statuses++;
    if (statuses === 1) return status("first_map");
    if (statuses === 2) return oldStatus.promise;
    return status("latest_map", "Latest status");
  });
  openPanelServerDetailsModal(0);
  await settle();
  refreshCurrentPanelStatus();
  refreshCurrentPanelStatus();
  await settle();
  assert.equal(mapName().textContent, "latest_map");
  firstMap.resolve("Obsolete first map");
  oldStatus.resolve(status("obsolete_map", "Old status"));
  await settle();
  assert.equal(mapName().textContent, "latest_map");
  assert.match(element("panel-status-summary").innerHTML, /Latest status/);
  assert.equal(element("panel-refresh-btn").attributes.has("disabled"), false);
  latestMap.resolve("Current map");
  await settle();
  assert.equal(mapName().textContent, "Current map");
});

test("closing or switching servers prevents a previous lookup from updating the status view", async () => {
  const firstMap = Promise.withResolvers();
  const secondMap = Promise.withResolvers();
  configure((code) => code === "one_map" ? firstMap.promise : secondMap.promise, async (id) => status(`${id}_map`, id));
  openPanelServerDetailsModal(0);
  await settle();
  const oldTarget = mapName();
  openPanelServerDetailsModal(1);
  await settle();
  firstMap.resolve("Wrong server map");
  await settle();
  assert.equal(mapName().textContent, "two_map");
  assert.equal(oldTarget.isConnected, false);
  const closedTarget = mapName();
  closePanelServerDetailsModal();
  secondMap.resolve("Name after closing");
  await settle();
  assert.equal(closedTarget.textContent, "two_map");
  assert.equal(element("panel-server-details-modal").classList.contains("hidden"), true);
  assert.equal(controlCalls, 0);
});
