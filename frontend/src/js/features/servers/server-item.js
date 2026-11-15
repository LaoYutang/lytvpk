function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const CARD_ICONS = {
  person: '<svg class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="7" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></svg>',
  copy: '<svg class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>',
  external: '<svg class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10"/></svg>',
};

function icon(icons, name) {
  // Only the application's static SVG constants are parsed, never server data.
  const source = icons[name].replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ');
  const svg = new DOMParser().parseFromString(source, "image/svg+xml");
  return document.importNode(svg.documentElement, true);
}

function badge(icons, name, className, text, title, tag = "span") {
  const node = element(tag, `stat-badge ${className}`);
  node.title = title;
  node.append(icon(icons, name), element("span", "", text));
  return node;
}

export function createServerItem(server, index, icons) {
  const item = element("li", "server-item");
  item.dataset.address = server.address;

  const info = element("div", "server-info");
  const heading = element("div", "server-item-heading");
  const name = element("span", "server-name", server.name);
  name.id = `server-name-${index}`;
  name.title = server.name;
  const population = element("div", "server-population");
  population.append(
    icon(CARD_ICONS, "person"),
    element("span", "server-population-count", "—"),
    element("span", "server-population-label", "查询中"),
  );
  heading.append(name, population, element("span", "server-live-name"));

  const addressRow = element("div", "server-address-row");
  const address = element("span", "server-address", server.address);
  address.title = server.address;
  addressRow.appendChild(address);
  const copy = element("button", "server-card-control copy-server-address-btn");
  copy.type = "button";
  copy.title = "复制服务器地址";
  copy.setAttribute("aria-label", `复制服务器地址 ${server.address}`);
  copy.appendChild(icon(CARD_ICONS, "copy"));
  addressRow.appendChild(copy);
  if (server.panelUrl && server.panelPasswordSet) {
    const panel = element("span", "server-panel-badge");
    panel.title = "已配置面板高级控制";
    panel.append(icon(icons, "panel"), element("span", "", "面板"));
    addressRow.appendChild(panel);
    const panelLink = element("button", "server-card-control server-panel-link", "面板");
    panelLink.type = "button";
    panelLink.title = "打开面板详情";
    panelLink.setAttribute("aria-label", "打开面板详情");
    panelLink.appendChild(icon(CARD_ICONS, "external"));
    addressRow.appendChild(panelLink);
  }
  const details = element("div", "server-details");
  details.id = `server-details-${index}`;
  info.append(heading, addressRow, details);

  const actions = element("div", "server-actions");
  const connect = element("button", "btn btn-small btn-primary connect-server-btn");
  connect.type = "button";
  connect.dataset.address = server.address;
  connect.append(icon(icons, "play"), element("span", "", "连接"));
  actions.appendChild(connect);
  for (const [className, iconName, title] of [
    ["refresh-server-btn", "refresh", "刷新服务器"],
    ["server-more-btn", "more", "更多操作"],
  ]) {
    const button = element("button", `btn btn-small btn-secondary server-action-icon ${className}`);
    button.type = "button";
    button.title = title;
    button.setAttribute("aria-label", title);
    button.dataset.address = server.address;
    button.dataset.index = index;
    button.appendChild(icon(icons, iconName));
    actions.appendChild(button);
  }
  item.append(info, actions);
  renderServerQueryState(item, { status: "loading" }, icons);
  return item;
}

export function createEmptyServerItem(icons) {
  const item = element("li", "server-empty-state");
  const image = element("div", "server-empty-icon");
  image.appendChild(icon(icons, "server"));
  item.append(
    image,
    element("div", "server-empty-title", "还没有收藏服务器"),
    element("div", "server-empty-text", "添加一个常用服务器后，它会显示在这里。"),
  );
  return item;
}

export function renderServerQueryState(item, state, icons, resolveMapName) {
  const details = item.querySelector(".server-details");
  const count = item.querySelector(".server-population-count");
  const label = item.querySelector(".server-population-label");
  const population = item.querySelector(".server-population");
  const liveName = item.querySelector(".server-live-name");
  details.replaceChildren();
  details.setAttribute("aria-busy", String(state.status === "loading"));

  if (state.status !== "success") {
    const failed = state.status === "error";
    const text = failed ? "查询失败" : "查询中";
    item.dataset.queryState = failed ? "error" : "loading";
    count.textContent = "—";
    label.textContent = text;
    population.title = text;
    liveName.textContent = "";
    details.appendChild(element("span", failed ? "error-text" : "server-loading-text", failed ? "查询失败，可点击刷新重试" : "加载中..."));
    return;
  }

  const info = state.info;
  liveName.textContent = info.name;
  liveName.title = info.name;
  const players = `${info.players}/${info.max_players}`;
  item.dataset.queryState = info.players > 0 ? "online" : "empty";
  count.textContent = players;
  label.textContent = info.players > 0 ? "在线人数" : "暂无玩家";
  population.title = `服务器报告人数：${players}，可能包含机器人`;

  const stats = element("div", "server-stats-grid");
  const map = badge(icons, "map", "map-badge", info.map, `地图: ${info.map} (点击解析)`, "button");
  map.type = "button";
  map.dataset.mapCode = info.map;
  map.setAttribute("aria-label", `解析地图名称：${info.map}`);
  map.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (map.dataset.resolved === "true" || map.disabled) return;
    const text = map.querySelector("span");
    text.textContent = "解析中...";
    map.disabled = true;
    try {
      const name = await resolveMapName(info.map);
      if (!map.isConnected) return;
      text.textContent = name || info.map;
      if (name && name !== info.map) {
        map.dataset.resolved = "true";
        map.title = `地图: ${info.map}`;
        map.setAttribute("aria-label", `地图：${name} (${info.map})`);
      }
    } catch {
      if (map.isConnected) text.textContent = info.map;
    } finally {
      map.disabled = false;
    }
  });
  stats.append(
    badge(icons, "server", "name-badge", info.name, info.name),
    badge(icons, "mode", "mode-badge", info.mode, "游戏模式"),
    map,
    badge(icons, "users", "players-badge", players, population.title),
  );
  details.appendChild(stats);
}
