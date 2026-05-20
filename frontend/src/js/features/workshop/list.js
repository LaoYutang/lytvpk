import { showGlobalSettings } from "../settings/settings.js";
import { workshopDeps } from "./deps.js";
import { openWorkshopDetail, resetWorkshopDetailView } from "./detail.js";
import {
  addFilterIcons,
  initBrowserIndicators,
  updateBrowserCategoryIndicator,
  updateBrowserSortIndicator,
} from "./sidebar.js";
import { browserState, resetWorkshopPaging } from "./state.js";
import {
  escapeHtml,
  formatNumber,
  isWorkshopCollection,
  renderWorkshopLoading,
} from "./utils.js";
import {
  renderWatchLaterDrawer,
  setupWatchLaterDrawerListeners,
} from "./watch-later.js";

let browserOpenedFromWorkshopModal = false;

function updateWorkshopTypeToggle() {
  const toggle = document.getElementById("browser-type-toggle");
  if (!toggle) return;

  const activeFileType = String(browserState.filetype ?? "0");
  toggle.dataset.active = activeFileType === "1" ? "collection" : "item";

  toggle.querySelectorAll(".workshop-type-toggle-btn").forEach((button) => {
    const isActive = button.dataset.filetype === activeFileType;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  });
}

function setupWorkshopTypeToggle() {
  const toggle = document.getElementById("browser-type-toggle");
  if (!toggle) return;

  updateWorkshopTypeToggle();

  toggle.querySelectorAll(".workshop-type-toggle-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const nextFileType = button.dataset.filetype || "0";
      if (browserState.filetype === nextFileType) return;

      browserState.filetype = nextFileType;
      updateWorkshopTypeToggle();
      resetWorkshopPaging();
      loadWorkshopList();
    });
  });
}

function updateWorkshopLoadMoreButton() {
  const loadMoreBtn = document.getElementById("browser-load-more");
  if (!loadMoreBtn) return;

  if (browserState.loadFailed) {
    loadMoreBtn.textContent = "加载失败，点击重试";
    loadMoreBtn.classList.remove("hidden");
  } else {
    loadMoreBtn.textContent = "加载更多";
    loadMoreBtn.classList.add("hidden");
  }
}

function maybeAutoLoadNextWorkshopPage() {
  const scrollContainer = document.getElementById("browser-scroll-container");
  const detailView = document.getElementById("browser-detail-view");
  if (
    !scrollContainer ||
    browserState.loading ||
    browserState.loadFailed ||
    !browserState.hasMore ||
    !detailView?.classList.contains("hidden")
  ) {
    return;
  }

  const distanceToBottom =
    scrollContainer.scrollHeight -
    scrollContainer.scrollTop -
    scrollContainer.clientHeight;

  if (distanceToBottom <= 360) {
    browserState.page++;
    loadWorkshopList();
  }
}

export function openBrowser(options = {}) {
  const { fromWorkshopModal = false } = options;
  browserOpenedFromWorkshopModal = fromWorkshopModal;

  workshopDeps.switchAppPage("workshop");

  setTimeout(() => {
    addFilterIcons();
    initBrowserIndicators();
    updateWorkshopTypeToggle();
    renderWatchLaterDrawer();
  }, 100);

  if (browserState.data.length === 0 && !browserState.loading) {
    browserState.page = 1;
    loadWorkshopList();
  }
}

export async function loadWorkshopList() {
  if (browserState.loading) return;
  browserState.loading = true;

  const isSelecting = await workshopDeps.IsSelectingIP();
  if (isSelecting) {
    browserState.loading = false;

    const grid = document.getElementById("browser-grid");
    const loadingEl = document.getElementById("browser-loading");
    const loadMoreBtn = document.getElementById("browser-load-more");

    browserState.loadFailed = false;
    if (loadMoreBtn) updateWorkshopLoadMoreButton();
    if (grid && browserState.page === 1) grid.innerHTML = "";

    if (loadingEl) {
      loadingEl.classList.remove("hidden");
      loadingEl.innerHTML = renderWorkshopLoading(
        "正在优选最佳网络线路...",
        "优选完成后将自动加载创意工坊列表"
      );
    }

    const checkInterval = setInterval(async () => {
      const stillSelecting = await workshopDeps.IsSelectingIP();
      if (!stillSelecting) {
        clearInterval(checkInterval);
        if (loadingEl) loadingEl.innerHTML = renderWorkshopLoading();
        loadWorkshopList();
      }
    }, 1000);

    return;
  }

  const detailView = document.getElementById("browser-detail-view");
  if (detailView) {
    resetWorkshopDetailView(detailView);
  }

  const grid = document.getElementById("browser-grid");
  const loadingEl = document.getElementById("browser-loading");

  loadingEl.classList.remove("hidden");
  loadingEl.innerHTML = renderWorkshopLoading(
    browserState.page === 1 ? "正在加载创意工坊列表..." : "正在加载更多内容..."
  );
  browserState.loadFailed = false;
  updateWorkshopLoadMoreButton();

  if (browserState.page === 1) {
    grid.innerHTML = "";
    browserState.hasMore = true;
    const scrollContainer = document.getElementById("browser-scroll-container");
    if (scrollContainer) scrollContainer.scrollTop = 0;
  } else {
    const errorEl = grid.querySelector(".error-state");
    if (errorEl) errorEl.remove();

    const emptyEl = grid.querySelector(".empty-state");
    if (emptyEl) emptyEl.remove();
  }

  try {
    console.log(
      `[Frontend] Fetching Workshop List: Page=${browserState.page}, Query=${browserState.query}, Sort=${browserState.sort}, FileType=${browserState.filetype}`
    );

    const opts = {
      page: browserState.page,
      search_text: browserState.query,
      sort: browserState.sort,
      tags: browserState.tags,
      filetype: browserState.filetype,
    };

    const result = await workshopDeps.FetchWorkshopList(opts);

    if (result.items && result.items.length > 0) {
      renderWorkshopGrid(result.items);
      browserState.data = browserState.data.concat(result.items);
    } else {
      browserState.hasMore = false;
      if (browserState.page === 1) {
        grid.innerHTML =
          '<div class="empty-state" style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-tertiary);">未找到相关结果</div>';
      }
    }
  } catch (err) {
    console.error("Fetch failed", err);
    browserState.loadFailed = true;
    if (browserState.page === 1) {
      grid.innerHTML = `<div class="error-state" style="grid-column: 1/-1; text-align: center; color: var(--danger);">加载失败: ${err}</div>`;
    }
  } finally {
    browserState.loading = false;
    loadingEl.classList.add("hidden");
    updateWorkshopLoadMoreButton();
    requestAnimationFrame(maybeAutoLoadNextWorkshopPage);
  }
}

function renderWorkshopGrid(items) {
  const grid = document.getElementById("browser-grid");

  items.forEach((item) => {
    const isCollection = isWorkshopCollection(item);
    const card = document.createElement("div");
    card.className = `workshop-card${isCollection ? " collection" : ""}`;
    card.innerHTML = `
            <div class="card-preview skeleton-anim">
                 <div class="skeleton-image-placeholder">
                     <svg class="icon-svg" style="width: 32px; height: 32px; opacity: 0.5;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                         <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                         <circle cx="8.5" cy="8.5" r="1.5"></circle>
                         <polyline points="21 15 16 10 5 21"></polyline>
                     </svg>
                 </div>
                <img src="${
                  escapeHtml(item.preview_url || "assets/images/no-preview.png")
                }" loading="lazy" alt="${escapeHtml(item.title)}"
                style="opacity: 0; transition: opacity 0.3s; position: relative; z-index: 2;"
                onload="this.style.opacity='1'; this.parentElement.classList.remove('skeleton-anim'); this.previousElementSibling.style.display='none';">
                ${isCollection ? '<span class="collection-card-tag">合集</span>' : ""}
            </div>
            <div class="card-info">
                <div class="card-title">${escapeHtml(item.title)}</div>
                <div class="card-meta">
                    <div class="card-stats">
                        <span>🔥 ${formatNumber(item.views)}</span>
                        <span>⭐ ${formatNumber(item.favorited)}</span>
                    </div>
                </div>
            </div>
        `;

    card.addEventListener("click", () => {
      openWorkshopDetail(item);
    });

    grid.appendChild(card);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const openBrowserBtn = document.getElementById("open-browser-btn");
  if (openBrowserBtn) {
    openBrowserBtn.addEventListener("click", () => {
      document.getElementById("workshop-modal").classList.add("hidden");
      openBrowser({ fromWorkshopModal: true });
    });
  }

  const searchInput = document.getElementById("browser-search-input");
  if (searchInput) {
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        browserState.query = e.target.value.trim();
        resetWorkshopPaging();
        loadWorkshopList();
      }
    });
  }

  document
    .querySelectorAll("#browser-sort-list .filter-item")
    .forEach((item) => {
      item.addEventListener("click", () => {
        document.querySelectorAll("#browser-sort-list .filter-item").forEach((sortItem) => sortItem.classList.remove("active"));
        item.classList.add("active");

        updateBrowserSortIndicator();

        browserState.sort = item.dataset.sort;
        resetWorkshopPaging();
        loadWorkshopList();
      });
    });

  initBrowserIndicators();
  setupWorkshopTypeToggle();

  const loadMoreBtn = document.getElementById("browser-load-more");
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener("click", () => {
      if (!browserState.loadFailed) {
        browserState.page++;
      }
      loadWorkshopList();
    });
  }

  document
    .getElementById("browser-scroll-container")
    ?.addEventListener("scroll", maybeAutoLoadNextWorkshopPage, {
      passive: true,
    });

  setupWatchLaterDrawerListeners();

  const settingsBtn = document.getElementById("global-settings-btn");
  if (settingsBtn) {
    settingsBtn.addEventListener("click", showGlobalSettings);
  }

  const browseBtn = document.getElementById("browse-workshop-btn");
  if (browseBtn) {
    browseBtn.addEventListener("click", () => {
      openBrowser({ fromWorkshopModal: true });
    });
  }

  const browserSearch = document.getElementById("browser-search-input");
  const browserSearchBtn = document.getElementById("browser-search-btn");
  const browserResetBtn = document.getElementById("browser-reset-btn");

  const performBrowserSearch = () => {
    if (browserSearch) {
      browserState.query = browserSearch.value.trim();
    }
    resetWorkshopPaging();
    loadWorkshopList();
  };

  if (browserSearch) {
    let debounceTimer;

    browserSearch.addEventListener("keyup", (e) => {
      if (e.key === "Enter") {
        clearTimeout(debounceTimer);
        performBrowserSearch();
      }
    });

    browserSearch.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        performBrowserSearch();
      }, 800);
    });
  }

  if (browserSearchBtn) {
    browserSearchBtn.addEventListener("click", () => {
      performBrowserSearch();
    });
  }

  if (browserResetBtn) {
    browserResetBtn.addEventListener("click", () => {
      if (browserSearch) browserSearch.value = "";

      browserState.query = "";
      browserState.tags = [];
      browserState.sort = "trend";
      browserState.filetype = "0";
      resetWorkshopPaging();

      document.querySelectorAll("#browser-sort-list .filter-item").forEach((item) => item.classList.remove("active"));
      const defaultSortItem = document.querySelector("#browser-sort-list .filter-item[data-sort='trend']");
      if (defaultSortItem) {
        defaultSortItem.classList.add("active");
      }

      document.querySelectorAll("#browser-sidebar-content .filter-item").forEach((item) => item.classList.remove("active"));

      updateBrowserSortIndicator(true);
      updateBrowserCategoryIndicator(true);
      updateWorkshopTypeToggle();

      loadWorkshopList();
    });
  }
});
