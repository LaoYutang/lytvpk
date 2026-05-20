import { loadWorkshopList } from "./list.js";
import { browserState, resetWorkshopPaging } from "./state.js";

const SORT_ICONS = {
  trend: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V4"/><path d="M17 9l-5-5-5 5"/></svg>`,
  recent: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  top: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
};

const WORKSHOP_CATEGORIES = [
  {
    name: "幸存者",
    children: [
      { name: "Bill", tag: "Bill" },
      { name: "Francis", tag: "Francis" },
      { name: "Louis", tag: "Louis" },
      { name: "Zoey", tag: "Zoey" },
      { name: "Coach", tag: "Coach" },
      { name: "Ellis", tag: "Ellis" },
      { name: "Nick", tag: "Nick" },
      { name: "Rochelle", tag: "Rochelle" },
    ],
  },
  {
    name: "感染者",
    children: [
      { name: "特感", tag: "Special Infected" },
      { name: "Tank", tag: "Tank" },
      { name: "Witch", tag: "Witch" },
      { name: "Hunter", tag: "Hunter" },
      { name: "Smoker", tag: "Smoker" },
      { name: "Boomer", tag: "Boomer" },
      { name: "Charger", tag: "Charger" },
      { name: "Jockey", tag: "Jockey" },
      { name: "Spitter", tag: "Spitter" },
      { name: "普通感染者", tag: "Common Infected" },
    ],
  },
  {
    name: "模式 & 战役",
    children: [
      { name: "战役", tag: "Campaigns" },
      { name: "合作", tag: "Co-op" },
      { name: "生存", tag: "Survival" },
      { name: "对抗", tag: "Versus" },
      { name: "清道夫", tag: "Scavenge" },
      { name: "写实", tag: "Realism" },
      { name: "写实对抗", tag: "Realism Versus" },
      { name: "突变", tag: "Mutations" },
      { name: "单人", tag: "Single Player" },
    ],
  },
  {
    name: "武器",
    children: [
      { name: "步枪", tag: "Rifle" },
      { name: "冲锋枪", tag: "SMG" },
      { name: "散弹枪", tag: "Shotgun" },
      { name: "狙击枪", tag: "Sniper" },
      { name: "手枪", tag: "Pistol" },
      { name: "近战", tag: "Melee" },
      { name: "榴弹", tag: "Grenade Launcher" },
      { name: "M60", tag: "M60" },
      { name: "投掷物", tag: "Throwable" },
    ],
  },
  {
    name: "物品",
    children: [
      { name: "治疗包", tag: "Medkit" },
      { name: "电击器", tag: "Defibrillator" },
      { name: "肾上腺素", tag: "Adrenaline" },
      { name: "止痛药", tag: "Pills" },
    ],
  },
  {
    name: "其他资源",
    children: [
      { name: "UI", tag: "UI" },
      { name: "音效", tag: "Sounds" },
      { name: "脚本", tag: "Scripts" },
      { name: "模型", tag: "Models" },
      { name: "纹理", tag: "Textures" },
      { name: "杂项", tag: "Miscellaneous" },
      { name: "其他", tag: "Other" },
    ],
  },
];

export function renderWorkshopSidebar() {
  const container = document.getElementById("browser-sidebar-content");
  if (!container) return;

  container.innerHTML = "";

  WORKSHOP_CATEGORIES.forEach((cat) => {
    const group = document.createElement("div");
    group.className = "filter-group filter-group-category";

    if (cat.name !== "全部") {
      const title = document.createElement("h4");
      title.textContent = cat.name;
      group.appendChild(title);
    }

    const list = document.createElement("ul");
    list.className = "filter-list";

    if (cat.tag !== undefined) {
      renderFilterItem(list, cat.name, cat.tag, cat.searchText, true);
    }

    if (cat.children) {
      cat.children.forEach((child) => {
        renderFilterItem(list, child.name, child.tag, child.searchText);
      });
    }

    group.appendChild(list);
    container.appendChild(group);
  });

  addFilterIcons();
  initBrowserIndicators();
}

export function addFilterIcons() {
  document.querySelectorAll("#browser-sort-list .filter-item").forEach((item) => {
    const sort = item.dataset.sort;
    if (!sort || item.querySelector(".filter-item-icon")) return;
    item.insertAdjacentHTML(
      "afterbegin",
      `<span class="filter-item-icon">${SORT_ICONS[sort] || SORT_ICONS.trend}</span>`
    );
  });
}

export function initBrowserIndicators() {
  const sortList = document.querySelector("#browser-sort-list");
  if (sortList && !sortList.querySelector(".browser-sort-indicator")) {
    sortList.insertAdjacentHTML("afterbegin", `<div class="browser-sort-indicator" aria-hidden="true"></div>`);
  }

  const sidebarContent = document.getElementById("browser-sidebar-content");
  if (sidebarContent && !sidebarContent.querySelector(".browser-category-indicator")) {
    sidebarContent.insertAdjacentHTML("afterbegin", `<div class="browser-category-indicator" aria-hidden="true"></div>`);
  }

  updateBrowserSortIndicator(true);
  updateBrowserCategoryIndicator(true);
}

export function updateBrowserSortIndicator(skipTransition = false) {
  const sortList = document.querySelector("#browser-sort-list");
  const indicator = sortList?.querySelector(".browser-sort-indicator");
  const activeItem = sortList?.querySelector(".filter-item.active");

  if (!sortList || !indicator || !activeItem) return;

  if (skipTransition) {
    indicator.style.transition = "none";
  }

  const listRect = sortList.getBoundingClientRect();
  const itemRect = activeItem.getBoundingClientRect();
  const offset = itemRect.top - listRect.top;

  indicator.style.height = `${itemRect.height}px`;
  indicator.style.transform = `translateY(${offset}px)`;

  if (skipTransition) {
    indicator.offsetHeight;
    indicator.style.transition = "";
  }
}

export function updateBrowserCategoryIndicator(skipTransition = false) {
  const sidebarContent = document.getElementById("browser-sidebar-content");
  const indicator = sidebarContent?.querySelector(".browser-category-indicator");
  const activeItem = sidebarContent?.querySelector(".filter-item.active");

  if (!sidebarContent || !indicator) return;

  if (!activeItem) {
    indicator.classList.remove("visible");
    return;
  }

  const containerRect = sidebarContent.getBoundingClientRect();
  const itemRect = activeItem.getBoundingClientRect();
  const newOffset = itemRect.top - containerRect.top;
  const wasVisible = indicator.classList.contains("visible");

  if (!wasVisible || skipTransition) {
    indicator.style.transition = "none";
    indicator.style.height = `${itemRect.height}px`;
    indicator.style.transform = `translateY(${newOffset}px)`;
    indicator.offsetHeight;
    indicator.style.transition = "";
    indicator.classList.add("visible");
  } else {
    indicator.classList.add("visible");
    indicator.style.height = `${itemRect.height}px`;
    indicator.style.transform = `translateY(${newOffset}px)`;
  }
}

function renderFilterItem(parentList, name, tag, searchText) {
  const li = document.createElement("li");
  li.className = "filter-item";

  const currentTag = browserState.tags[0] || "";
  if (tag === currentTag) {
    li.classList.add("active");
  }

  li.dataset.tag = tag;
  li.textContent = name;

  li.addEventListener("click", () => {
    document.querySelectorAll("#browser-sidebar-content .filter-item").forEach((item) => item.classList.remove("active"));
    li.classList.add("active");

    updateBrowserCategoryIndicator();

    const tagsToSend = [];
    if (tag) {
      tagsToSend.push(tag);
    }
    browserState.tags = tagsToSend;

    const input = document.getElementById("browser-search-input");
    if (searchText) {
      browserState.query = searchText;
      if (input) input.value = searchText;
    } else {
      browserState.query = "";
      if (input) input.value = "";
    }

    resetWorkshopPaging();
    loadWorkshopList();
  });

  parentList.appendChild(li);
}

window.addEventListener("resize", () => {
  updateBrowserSortIndicator(true);
  updateBrowserCategoryIndicator(true);
});
