import { workshopDeps } from "./deps.js";
import { appendInstalledBadge, subscribeWorkshopInstallationChange } from "./installed.js";
import { getAPILineSnapshot, isCurrentAPILine, subscribeAPILineChange } from "../../core/api-line.js";
import { openWorkshopDetail, resetWorkshopDetailView } from "./detail.js";
import { createWorkshopRequestError } from "./request-error.js";
import { setupWorkshopIdJump } from "./id-jump.js";
import {
  addFilterIcons,
  initBrowserIndicators,
  updateBrowserCategoryIndicator,
  updateBrowserSortIndicator,
} from "./sidebar.js";
import { browserState, resetWorkshopPaging, setWorkshopSearchQuery } from "./state.js";
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
import { createWorkshopVirtualGrid } from "./virtual-grid.js";

let browserOpenedFromWorkshopModal = false;
let listRequestSequence = 0;
let ipSelectionTimer;
let searchDebounceTimer;
let virtualGrid;

subscribeAPILineChange(() => {
  listRequestSequence++;
  clearInterval(ipSelectionTimer);
  clearTimeout(searchDebounceTimer);
  browserState.loading = false;
  resetWorkshopPaging();
  virtualGrid?.clear();
  document.getElementById("browser-loading")?.classList.add("hidden");
  updateWorkshopLoadMoreButton();
});

subscribeWorkshopInstallationChange(() => virtualGrid?.invalidate());

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

function updateWorkshopSortSelection() {
  document.querySelectorAll("#browser-sort-list .filter-item").forEach((item) => {
    const available = item.dataset.sort !== "relevance" || Boolean(browserState.query);
    item.classList.toggle("hidden", !available);
    item.classList.toggle("active", item.dataset.sort === browserState.sort);
    item.setAttribute("aria-current", item.dataset.sort === browserState.sort ? "true" : "false");
  });
  updateBrowserSortIndicator();
}

function updateWorkshopLoadMoreButton() {
  const loadMoreBtn = document.getElementById("browser-load-more");
  if (!loadMoreBtn) return;

  const hasErrorCard = Boolean(document.getElementById("browser-grid")?.querySelector(".workshop-request-error"));
  if (browserState.loadFailed && !hasErrorCard) {
    loadMoreBtn.textContent = "重新查询";
    loadMoreBtn.classList.remove("hidden");
  } else {
    loadMoreBtn.textContent = "加载更多";
    loadMoreBtn.classList.add("hidden");
  }
}

function renderWorkshopListRequestError(error, { page, line, isCurrentRequest, fallback }) {
  const grid = document.getElementById("browser-grid");
  browserState.loadFailed = true;
  document.getElementById("browser-loading")?.classList.add("hidden");
  if (!grid) {
    updateWorkshopLoadMoreButton();
    return;
  }

  const view = createWorkshopRequestError({
    title: page === 1 ? "工坊列表加载失败" : "更多内容加载失败",
    error,
    fallback: fallback || "加载失败，请稍后重新查询。",
    line: line.line,
    compact: page > 1,
    retryLabel: "重新查询",
    retryHint: page === 1
      ? "可以点击“查询”再次刷新，或在设置中切换线路后重试。"
      : "点击“重新查询”继续加载本页，也可以在设置中手动切换线路后再试。",
    onRetry: () => {
      if (!isCurrentRequest() || browserState.loading) return;
      browserState.page = page;
      return loadWorkshopList();
    },
  });
  if (page === 1) {
    virtualGrid.clear();
    grid.appendChild(view);
  } else {
    grid.querySelector(".error-state")?.remove();
    grid.appendChild(view);
  }
  updateWorkshopLoadMoreButton();
}

function maybeAutoLoadNextWorkshopPage() {
  const scrollContainer = document.getElementById("browser-scroll-container");
  const detailView = document.getElementById("browser-detail-view");
  if (
    !scrollContainer ||
    !scrollContainer.clientHeight ||
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
  updateWorkshopSortSelection();
  const line = getAPILineSnapshot();
  const page = browserState.page;
  const sequence = ++listRequestSequence;
  const isCurrentRequest = () => isCurrentAPILine(line) && sequence === listRequestSequence;
  clearInterval(ipSelectionTimer);
  browserState.loading = true;
  const loadingEl = document.getElementById("browser-loading");
  if (loadingEl) loadingEl.dataset.loadingMode = page > 1 ? "more" : "initial";

  let isSelecting;
  try {
    isSelecting = await workshopDeps.IsSelectingIP();
  } catch (error) {
    if (isCurrentRequest()) {
      browserState.loading = false;
      renderWorkshopListRequestError(error, {
        page, line, isCurrentRequest,
        fallback: "无法读取网络优选状态，请点击“重新查询”再试。",
      });
    }
    return;
  }
  if (!isCurrentRequest()) return;
  if (isSelecting) {
    const loadMoreBtn = document.getElementById("browser-load-more");

    browserState.loadFailed = false;
    if (loadMoreBtn) updateWorkshopLoadMoreButton();
    if (page === 1) virtualGrid.clear();

    if (loadingEl) {
      loadingEl.classList.remove("hidden");
      loadingEl.innerHTML = renderWorkshopLoading(
        "正在优选最佳网络线路...",
        "优选完成后将自动加载创意工坊列表"
      );
    }

    clearInterval(ipSelectionTimer);
    ipSelectionTimer = setInterval(async () => {
      if (!isCurrentRequest()) return;
      let stillSelecting;
      try {
        stillSelecting = await workshopDeps.IsSelectingIP();
      } catch (error) {
        if (isCurrentRequest()) {
          clearInterval(ipSelectionTimer);
          browserState.loading = false;
          renderWorkshopListRequestError(error, {
            page, line, isCurrentRequest,
            fallback: "无法读取网络优选状态，请点击“重新查询”再试。",
          });
        }
        return;
      }
      if (!isCurrentRequest()) return;
      if (!stillSelecting) {
        clearInterval(ipSelectionTimer);
        browserState.loading = false;
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

  loadingEl.classList.remove("hidden");
  loadingEl.innerHTML = renderWorkshopLoading(
    page === 1 ? "正在加载创意工坊列表..." : "正在加载更多内容..."
  );
  browserState.loadFailed = false;
  updateWorkshopLoadMoreButton();

  if (browserState.page === 1) {
    virtualGrid.clear();
    browserState.hasMore = true;
    const scrollContainer = document.getElementById("browser-scroll-container");
    if (scrollContainer) scrollContainer.scrollTop = 0;
  } else {
    const emptyEl = grid.querySelector(".empty-state");
    if (emptyEl) emptyEl.remove();
  }

  try {
    const opts = {
      page,
      search_text: browserState.query,
      sort: browserState.sort,
      tags: browserState.tags,
      filetype: browserState.filetype,
    };

    const result = await workshopDeps.FetchWorkshopList(opts);
    if (!isCurrentRequest()) return;
    if (page > 1) grid.querySelector(".error-state")?.remove();

    if (result.items && result.items.length > 0) {
      browserState.data = browserState.data.concat(result.items);
      virtualGrid.setItems(browserState.data);
    } else {
      browserState.hasMore = false;
      if (browserState.page === 1) {
        grid.innerHTML =
          '<div class="empty-state" style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-tertiary);">未找到相关结果</div>';
      }
    }
  } catch (err) {
    if (!isCurrentRequest()) return;
    renderWorkshopListRequestError(err, { page, line, isCurrentRequest });
  } finally {
    if (isCurrentRequest()) {
      browserState.loading = false;
      loadingEl.classList.add("hidden");
      updateWorkshopLoadMoreButton();
      requestAnimationFrame(() => {
        if (isCurrentRequest()) maybeAutoLoadNextWorkshopPage();
      });
    }
  }
}

function createWorkshopCard(item, measureOnly = false) {
  const isCollection = isWorkshopCollection(item);
  const card = document.createElement("div");
  card.className = `workshop-card${isCollection ? " collection" : ""}`;
  const preview = measureOnly ? "" : `
            <div class="skeleton-image-placeholder">
                <svg class="icon-svg" style="width: 32px; height: 32px; opacity: 0.5;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                    <circle cx="8.5" cy="8.5" r="1.5"></circle>
                    <polyline points="21 15 16 10 5 21"></polyline>
                </svg>
            </div>
            <img src="${escapeHtml(item.preview_url || "assets/images/no-preview.png")}"
                loading="lazy" alt="${escapeHtml(item.title)}"
                style="opacity: 0; transition: opacity 0.3s; position: relative; z-index: 2;"
                onload="this.style.opacity='1'; this.parentElement.classList.remove('skeleton-anim'); this.previousElementSibling.style.display='none';">
            ${isCollection ? '<span class="collection-card-tag">合集</span>' : ""}
        `;
  card.innerHTML = `
            <div class="card-preview${measureOnly ? "" : " skeleton-anim"}">${preview}</div>
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

  appendInstalledBadge(card.querySelector(".card-meta"), item);
  if (!measureOnly) card.addEventListener("click", () => openWorkshopDetail(item));
  return card;
}

document.addEventListener("DOMContentLoaded", () => {
  const scrollContainer = document.getElementById("browser-scroll-container");
  const grid = document.getElementById("browser-grid");
  if (scrollContainer && grid) {
    virtualGrid = createWorkshopVirtualGrid(grid, scrollContainer, createWorkshopCard);
    scrollContainer.addEventListener("scroll", () => {
      virtualGrid.onScroll();
      maybeAutoLoadNextWorkshopPage();
    }, { passive: true });
  }
  const openBrowserBtn = document.getElementById("open-browser-btn");
  if (openBrowserBtn) {
    openBrowserBtn.addEventListener("click", () => {
      document.getElementById("workshop-modal").classList.add("hidden");
      openBrowser({ fromWorkshopModal: true });
    });
  }

  document
    .querySelectorAll("#browser-sort-list .filter-item")
    .forEach((item) => {
      item.addEventListener("click", () => {
        if (item.dataset.sort === "relevance" && !browserState.query) return;
        browserState.sort = item.dataset.sort;
        clearTimeout(searchDebounceTimer);
        const input = document.getElementById("browser-search-input");
        if (input) browserState.query = input.value.trim();
        if (!browserState.query && browserState.sort === "relevance") browserState.sort = "trend";
        resetWorkshopPaging();
        loadWorkshopList();
      });
    });

  initBrowserIndicators();
  setupWorkshopTypeToggle();

  const loadMoreBtn = document.getElementById("browser-load-more");
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener("click", () => {
      if (browserState.loading) return;
      if (!browserState.loadFailed) {
        browserState.page++;
      }
      loadWorkshopList();
    });
  }

  setupWatchLaterDrawerListeners();
  setupWorkshopIdJump();

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
    clearTimeout(searchDebounceTimer);
    if (browserSearch) {
      setWorkshopSearchQuery(browserSearch.value);
    }
    resetWorkshopPaging();
    loadWorkshopList();
  };

  if (browserSearch) {
    browserSearch.addEventListener("keyup", (e) => {
      if (e.key === "Enter") {
        clearTimeout(searchDebounceTimer);
        performBrowserSearch();
      }
    });

    browserSearch.addEventListener("input", () => {
      clearTimeout(searchDebounceTimer);
      const line = getAPILineSnapshot();
      searchDebounceTimer = setTimeout(() => {
        if (isCurrentAPILine(line)) performBrowserSearch();
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
      clearTimeout(searchDebounceTimer);
      if (browserSearch) browserSearch.value = "";

      browserState.query = "";
      browserState.tags = [];
      browserState.sort = "trend";
      browserState.filetype = "0";
      resetWorkshopPaging();

      updateWorkshopSortSelection();

      document.querySelectorAll("#browser-sidebar-content .filter-item").forEach((item) => item.classList.remove("active"));

      updateBrowserSortIndicator(true);
      updateBrowserCategoryIndicator(true);
      updateWorkshopTypeToggle();

      loadWorkshopList();
    });
  }
});
