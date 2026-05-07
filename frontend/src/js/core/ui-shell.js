const NAV_ICONS = {
  mods: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`,
  workshop: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z"/><path d="M9 21h6"/></svg>`,
  downloads: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13"/><path d="M7 12l5 5 5-5"/><path d="M5 21h14"/></svg>`,
  servers: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v0a2 2 0 0 1 2-2z"/><path d="M4 14h16a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v0a2 2 0 0 1 2-2z"/><path d="M8 9h.01"/><path d="M8 17h.01"/></svg>`,
  settings: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.68 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  about: `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`,
};

const MENU_ITEMS = [
  { page: "mods", id: "app-nav-mods", label: "MOD 管理", icon: NAV_ICONS.mods },
  { page: "workshop", sourceId: "browser-btn", label: "创意工坊", icon: NAV_ICONS.workshop },
  { page: "downloads", sourceId: "workshop-btn", label: "下载与解析", icon: NAV_ICONS.downloads },
  { page: "servers", sourceId: "server-favorites-btn", label: "收藏服务器", icon: NAV_ICONS.servers },
  { page: "settings", sourceId: "global-settings-btn", label: "设置", icon: NAV_ICONS.settings },
  { page: "about", sourceId: "info-btn", label: "关于", icon: NAV_ICONS.about },
];

let activePage = "mods";
let activeIndicator = null;
let pageContainer = null;
let pageTrack = null;

export function getCurrentPage() {
  return activePage;
}

export function initAppShell() {
  const mainScreen = document.getElementById("main-screen");
  if (!mainScreen || mainScreen.querySelector(".app-shell")) return;

  const shell = document.createElement("div");
  shell.className = "app-shell";

  const sidebar = document.createElement("aside");
  sidebar.className = "app-sidebar";
  sidebar.innerHTML = `
    <nav class="sidebar-nav" aria-label="主菜单">
      <div class="sidebar-active-indicator" aria-hidden="true"></div>
    </nav>
    <div class="sidebar-footer"></div>
  `;

  const appMain = document.createElement("main");
  appMain.className = "app-main";
  pageContainer = document.createElement("div");
  pageContainer.className = "page-container";
  pageTrack = document.createElement("div");
  pageTrack.className = "page-track";
  pageContainer.appendChild(pageTrack);
  appMain.appendChild(pageContainer);

  shell.append(sidebar, appMain);
  mainScreen.appendChild(shell);

  activeIndicator = sidebar.querySelector(".sidebar-active-indicator");
  buildSidebar(sidebar);
  buildPages(pageTrack);
  switchAppPage("mods", { silent: true, skipTransition: true });

  window.addEventListener("resize", () => {
    updateActiveIndicator(true);
  });
}

export function switchAppPage(page, options = {}) {
  const previousPage = activePage;
  activePage = page || "mods";
  updatePageDirection(previousPage, activePage);
  hideEmbeddedModalSources();

  document.querySelectorAll(".page-view").forEach((view) => {
    view.classList.toggle("active", view.dataset.page === activePage);
  });

  document.querySelectorAll(".sidebar-nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.page === activePage);
  });

  updateActiveIndicator(options.skipTransition);

  if (!options.silent) {
    document.dispatchEvent(
      new CustomEvent("app:page-change", { detail: { page: activePage } })
    );
  }
}

export function isEmbeddedPageOpen(page) {
  return activePage === page;
}

export function refreshActiveIndicator() {
  updateActiveIndicator(true);
}

function buildSidebar(sidebar) {
  const nav = sidebar.querySelector(".sidebar-nav");

  MENU_ITEMS.forEach((item) => {
    const button = item.sourceId
      ? document.getElementById(item.sourceId)
      : document.createElement("button");

    if (!button) return;

    if (!item.sourceId) {
      button.id = item.id;
      button.type = "button";
      button.innerHTML = `${item.icon}<span>${item.label}</span>`;
    } else {
      button.innerHTML = `${item.icon}<span>${item.label}</span>`;
    }

    button.className = "sidebar-nav-item";
    button.dataset.page = item.page;
    button.title = item.label;
    button.setAttribute("type", "button");
    button.addEventListener("click", () => switchAppPage(item.page));
    nav.appendChild(button);
  });

  const footer = sidebar.querySelector(".sidebar-footer");
  const launchBtn = document.getElementById("launch-l4d2-btn");
  const themeBtn = document.getElementById("theme-toggle-btn");

  if (launchBtn) {
    launchBtn.className = "sidebar-quick-action launch-action";
    const span = launchBtn.querySelector("span");
    if (span) span.textContent = "启动L4D2";
    footer.appendChild(launchBtn);
  }

  if (themeBtn) {
    themeBtn.className = "sidebar-quick-action theme-action";
    if (!themeBtn.querySelector(".quick-label")) {
      const label = document.createElement("span");
      label.className = "quick-label";
      const isDark = document.documentElement.classList.contains("dark-mode");
      label.textContent = isDark ? "开灯模式" : "关灯模式";
      themeBtn.appendChild(label);
    }
    footer.appendChild(themeBtn);
  }
}

function buildPages(container) {
  const modsPage = createPage("mods", "mod-management-page");
  const header = document.querySelector(".header");
  const filterBar = document.querySelector(".filter-bar");
  const listContainer = document.querySelector(".file-list-container");
  const statusBar = document.querySelector(".status-bar");
  const filterActions = document.querySelector(".filter-actions");
  const filterRow = document.querySelector(".filter-row-main");
  const directorySelector = document.querySelector(".directory-selector");
  const locationSection = document.getElementById("location-filter-section");
  const tagFilters = document.getElementById("tag-filters");
  const sortContainer = document.querySelector(".sort-container");
  const uploadBtn = document.getElementById("upload-btn");

  if (directorySelector && filterRow) {
    filterRow.insertBefore(directorySelector, filterRow.firstChild);
  }

  if (tagFilters && filterRow) {
    if (locationSection?.parentElement === filterRow) {
      locationSection.after(tagFilters);
    } else {
      filterRow.appendChild(tagFilters);
    }
  }

  if (uploadBtn && filterActions) {
    uploadBtn.className = "btn btn-small btn-outline";
    filterActions.insertBefore(uploadBtn, filterActions.firstChild);
  }

  if (sortContainer && filterActions) {
    sortContainer.removeAttribute("style");
    filterActions.appendChild(sortContainer);
  }

  if (header) modsPage.appendChild(header);
  if (filterBar) modsPage.appendChild(filterBar);
  if (listContainer) modsPage.appendChild(listContainer);
  if (statusBar) modsPage.appendChild(statusBar);
  container.appendChild(modsPage);

  container.appendChild(embedModalAsPage("browser-modal", "workshop", "workshop-page"));
  container.appendChild(embedModalAsPage("workshop-modal", "downloads", "downloads-page"));
  container.appendChild(embedModalAsPage("server-modal", "servers", "servers-page"));

  const settingsPage = createPage("settings", "settings-page");
  settingsPage.innerHTML = `<div id="settings-page-content" class="page-body"></div>`;
  container.appendChild(settingsPage);

  const aboutPage = createPage("about", "about-page");
  aboutPage.innerHTML = `<div id="about-page-content" class="page-body"></div>`;
  container.appendChild(aboutPage);
}

function createPage(page, className = "") {
  const view = document.createElement("section");
  view.className = `page-view ${className}`.trim();
  view.dataset.page = page;
  return view;
}

function embedModalAsPage(modalId, page, className) {
  const view = createPage(page, className);
  const modal = document.getElementById(modalId);
  const content = modal?.querySelector(".modal-content");
  if (!modal || !content) return view;

  content.classList.add("embedded-page-content");
  view.appendChild(content);
  modal.classList.add("embedded-modal-source", "hidden");
  return view;
}

function hideEmbeddedModalSources() {
  document
    .querySelectorAll(".embedded-modal-source")
    .forEach((modal) => modal.classList.add("hidden"));
}

function updateActiveIndicator(skipTransition = false) {
  if (!activeIndicator) return;
  const activeItem = document.querySelector(`.sidebar-nav-item[data-page="${activePage}"]`);
  const nav = activeIndicator.parentElement;
  if (!activeItem || !nav) return;

  if (skipTransition) {
    activeIndicator.style.transition = "none";
  }

  const navRect = nav.getBoundingClientRect();
  const itemRect = activeItem.getBoundingClientRect();
  activeIndicator.style.transform = `translateY(${itemRect.top - navRect.top}px)`;
  activeIndicator.style.height = `${itemRect.height}px`;

  if (skipTransition) {
    activeIndicator.offsetHeight; // force reflow
    activeIndicator.style.transition = "";
  }
}

function updatePageDirection(previousPage, nextPage) {
  if (!pageContainer || previousPage === nextPage) return;
  const previousIndex = MENU_ITEMS.findIndex((item) => item.page === previousPage);
  const nextIndex = MENU_ITEMS.findIndex((item) => item.page === nextPage);
  pageContainer.dataset.pageDirection = nextIndex >= previousIndex ? "down" : "up";
}
