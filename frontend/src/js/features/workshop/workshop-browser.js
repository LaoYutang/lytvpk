let switchAppPage;
let showNotification;
let showError;
let BrowserOpenURL;
let FetchWorkshopList;
let FetchWorkshopDetail;
let GetWorkshopBrowserTarget;
let IsSelectingIP;
let closeModal;
let openWorkshopModal;
let EventsOn;

export function configureWorkshopBrowser(deps) {
  ({ switchAppPage, showNotification, showError, BrowserOpenURL, FetchWorkshopList, FetchWorkshopDetail, GetWorkshopBrowserTarget, IsSelectingIP, closeModal, openWorkshopModal, EventsOn } = deps);
}

export const browserState = {
  page: 1,
  query: "",
  sort: "trend",
  tags: [],
  loading: false,
  hasMore: true,
  loadFailed: false,
  data: [],
};

function resetWorkshopPaging() {
  browserState.page = 1;
  browserState.data = [];
  browserState.hasMore = true;
  browserState.loadFailed = false;
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

function renderWorkshopLoading(message = "正在加载创意工坊列表...", hint = "") {
  const hintHtml = hint ? `<span class="workshop-loading-hint">${hint}</span>` : "";

  return `
    <div class="file-list-loading-content workshop-loading-card">
      <div class="file-list-loading-spinner"></div>
      <p>${message}</p>
      ${hintHtml}
    </div>
  `;
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

// 初始化
document.addEventListener("DOMContentLoaded", () => {
  // 入口按钮
  const openBrowserBtn = document.getElementById("open-browser-btn");
  if (openBrowserBtn) {
    openBrowserBtn.addEventListener("click", () => {
      document.getElementById("workshop-modal").classList.add("hidden"); // 暂时隐藏现有弹窗
      openBrowser({ fromWorkshopModal: true });
    });
  }

  // 搜索
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

  // 排序筛选
  document
    .querySelectorAll("#browser-sort-list .filter-item")
    .forEach((item) => {
      item.addEventListener("click", () => {
        document
          .querySelectorAll("#browser-sort-list .filter-item")
          .forEach((i) => i.classList.remove("active"));
        item.classList.add("active");
        browserState.sort = item.dataset.sort;
        resetWorkshopPaging();
        loadWorkshopList();
      });
    });

  // 初始化动态侧边栏
  renderWorkshopSidebar();

  // 加载更多
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

  // 工坊设置按钮
  const settingsBtn = document.getElementById("global-settings-btn");
  if (settingsBtn) {
    settingsBtn.addEventListener("click", showGlobalSettings);
  }
});

let browserOpenedFromWorkshopModal = false;

export function openBrowser(options = {}) {
  const { fromWorkshopModal = false } = options;
  browserOpenedFromWorkshopModal = fromWorkshopModal;

  switchAppPage("workshop");

  // 如果是第一次打开且没数据，加载
  if (browserState.data.length === 0 && !browserState.loading) {
    browserState.page = 1; // 确保从第一页开始
    loadWorkshopList();
  }
}

export async function loadWorkshopList() {
  // 防止重复请求锁
  if (browserState.loading) return;
  browserState.loading = true;

  // 检查是否正在优选IP
  const isSelecting = await IsSelectingIP();
  if (isSelecting) {
    // 释放锁以便后续重试
    browserState.loading = false;

    const grid = document.getElementById("browser-grid");
    const loadingEl = document.getElementById("browser-loading");
    const loadMoreBtn = document.getElementById("browser-load-more");

    // 隐藏加载更多按钮
    browserState.loadFailed = false;
    if (loadMoreBtn) updateWorkshopLoadMoreButton();

    // 清空现有内容 (仅当第一页时)
    if (grid && browserState.page === 1) grid.innerHTML = "";

    // 显示加载状态
    if (loadingEl) {
      loadingEl.classList.remove("hidden");
      loadingEl.innerHTML = renderWorkshopLoading(
        "正在优选最佳网络线路...",
        "优选完成后将自动加载创意工坊列表"
      );
    }

    // 轮询等待优选结束
    const checkInterval = setInterval(async () => {
      const stillSelecting = await IsSelectingIP();
      if (!stillSelecting) {
        clearInterval(checkInterval);
        // 恢复默认加载提示
        if (loadingEl) loadingEl.innerHTML = renderWorkshopLoading();
        // 重新触发加载
        loadWorkshopList();
      }
    }, 1000);

    return;
  }

  // 隐藏详情页
  const detailView = document.getElementById("browser-detail-view");
  if (detailView) {
    resetWorkshopDetailView(detailView);
  }

  const grid = document.getElementById("browser-grid");
  const loadingEl = document.getElementById("browser-loading");
  const loadMoreBtn = document.getElementById("browser-load-more");

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
    // 如果是加载更多，先移除可能存在的错误提示
    const errorEl = grid.querySelector(".error-state");
    if (errorEl) errorEl.remove();

    // 移除"未找到结果"提示
    const emptyEl = grid.querySelector(".empty-state");
    if (emptyEl) emptyEl.remove();
  }

  try {
    console.log(
      `[Frontend] Fetching Workshop List: Page=${browserState.page}, Query=${browserState.query}, Sort=${browserState.sort}`
    );

    // 调用 Go 后端
    const opts = {
      page: browserState.page,
      search_text: browserState.query,
      sort: browserState.sort,
      tags: browserState.tags,
    };

    const result = await FetchWorkshopList(opts);

    // 渲染
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
    const card = document.createElement("div");
    card.className = "workshop-card";
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
                  item.preview_url || "assets/images/no-preview.png"
                }" loading="lazy" alt="${item.title}"
                style="opacity: 0; transition: opacity 0.3s; position: relative; z-index: 2;"
                onload="this.style.opacity='1'; this.parentElement.classList.remove('skeleton-anim'); this.previousElementSibling.style.display='none';">
            </div>
            <div class="card-info">
                <div class="card-title">${item.title}</div>
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

function formatNumber(num) {
  if (!num) return "0";
  if (num > 10000) return (num / 10000).toFixed(1) + "w";
  if (num > 1000) return (num / 1000).toFixed(1) + "k";
  return num;
}

// 切换预览图
let workshopPreviewImages = [];
let workshopPreviewIndex = 0;

function getWorkshopPreviewImages(detail) {
  let images = detail.previews || [];
  images = images.map((p) => p.preview_url || p).filter(Boolean);

  if (detail.preview_url) {
    images.unshift(detail.preview_url);
  }

  return [...new Set(images)];
}

function updateImageModalControls() {
  const prevBtn = document.getElementById("image-modal-prev");
  const nextBtn = document.getElementById("image-modal-next");
  const counter = document.getElementById("image-modal-counter");
  const hasMultiple = workshopPreviewImages.length > 1;

  prevBtn?.classList.toggle("hidden", !hasMultiple);
  nextBtn?.classList.toggle("hidden", !hasMultiple);
  counter?.classList.toggle("hidden", !hasMultiple);

  if (counter && hasMultiple) {
    counter.textContent = `${workshopPreviewIndex + 1} / ${workshopPreviewImages.length}`;
  }
}

function setFullImageAt(index) {
  const modalImg = document.getElementById("full-image");
  if (!modalImg || workshopPreviewImages.length === 0) return;

  workshopPreviewIndex =
    (index + workshopPreviewImages.length) % workshopPreviewImages.length;
  modalImg.src = workshopPreviewImages[workshopPreviewIndex];
  updateImageModalControls();
}

function closeFullImageModal() {
  const modal = document.getElementById("image-preview-modal");
  if (modal) {
    modal.style.display = "none";
  }
}

function changeFullImage(step) {
  if (workshopPreviewImages.length <= 1) return;
  setFullImageAt(workshopPreviewIndex + step);
}

window.switchPreview = function (url, element) {
  const mainImg = document.getElementById("main-preview-img");
  if (mainImg) {
    mainImg.src = url;
  }
  document
    .querySelectorAll(".thumbnail-item")
    .forEach((el) => el.classList.remove("active"));
  if (element) {
    element.classList.add("active");
  }

  const index = workshopPreviewImages.indexOf(url);
  if (index >= 0) {
    workshopPreviewIndex = index;
  }
};

// 全屏图片预览
window.openFullImage = function (src) {
  const modal = document.getElementById("image-preview-modal");
  if (modal) {
    if (!workshopPreviewImages.includes(src)) {
      workshopPreviewImages = [src].filter(Boolean);
    }
    const index = Math.max(0, workshopPreviewImages.indexOf(src));
    setFullImageAt(index);
    modal.style.display = "flex"; // 修改为 flex 以配合 CSS 居中
  }
};

// 初始化全屏图片模态框事件
document.addEventListener("DOMContentLoaded", () => {
  const modal = document.getElementById("image-preview-modal");
  const span = document.getElementsByClassName("image-modal-close")[0];
  const prevBtn = document.getElementById("image-modal-prev");
  const nextBtn = document.getElementById("image-modal-next");

  if (modal && span) {
    span.onclick = closeFullImageModal;

    prevBtn?.addEventListener("click", (event) => {
      event.stopPropagation();
      changeFullImage(-1);
    });

    nextBtn?.addEventListener("click", (event) => {
      event.stopPropagation();
      changeFullImage(1);
    });

    document.addEventListener("keydown", (event) => {
      if (modal.style.display !== "flex") return;
      if (event.key === "Escape") closeFullImageModal();
      if (event.key === "ArrowLeft") changeFullImage(-1);
      if (event.key === "ArrowRight") changeFullImage(1);
    });

    modal.onclick = function (event) {
      if (event.target === modal) {
        closeFullImageModal();
      }
    };
  }
});

function renderThumbnails(detail) {
  const images = getWorkshopPreviewImages(detail);
  /*
  let images = detail.previews || [];
  // 提取 URL (处理 previews 是对象数组的情况)
  images = images.map((p) => p.preview_url || p);

  // 去重
  images = [...new Set(images)];
  */

  // 如果没有 previews 列表，或者列表为空，且只有单张预览图，则不显示缩略图栏
  if (images.length <= 1) return "";

  return `
    <div class="detail-thumbnails">
        ${images
          .map(
            (img, index) => `
            <div class="thumbnail-item skeleton-anim ${
              index === 0 ? "active" : ""
            }" onclick="window.switchPreview('${img}', this)">
                <img src="${img}" loading="lazy" style="opacity: 0; transition: opacity 0.3s;"
                onload="this.style.opacity='1'; this.parentElement.classList.remove('skeleton-anim')">
            </div>
        `
          )
          .join("")}
    </div>
    `;
}

function showWorkshopDetailView(detailView, browserBody) {
  if (!detailView) return;

  browserBody?.classList.add("detail-open");
  detailView.classList.remove(
    "hidden",
    "workshop-detail-enter",
    "workshop-detail-leave"
  );
  void detailView.offsetWidth;
  detailView.classList.add("workshop-detail-enter");
  detailView.addEventListener(
    "animationend",
    () => detailView.classList.remove("workshop-detail-enter"),
    { once: true }
  );
}

function hideWorkshopDetailView(detailView, browserBody) {
  if (!detailView || detailView.classList.contains("hidden")) {
    browserBody?.classList.remove("detail-open");
    return;
  }

  detailView.classList.remove("workshop-detail-enter");
  detailView.classList.add("workshop-detail-leave");
  browserBody?.classList.remove("detail-open");

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    detailView.classList.add("hidden");
    detailView.classList.remove("workshop-detail-leave");
  };

  detailView.addEventListener("animationend", finish, { once: true });
  setTimeout(finish, 360);
}

function resetWorkshopDetailView(detailView) {
  if (!detailView) return;

  detailView.classList.add("hidden");
  detailView.classList.remove("workshop-detail-enter", "workshop-detail-leave");
  detailView.closest(".browser-body")?.classList.remove("detail-open");
}

async function openWorkshopDetail(item) {
  const detailView = document.getElementById("browser-detail-view");
  const browserBody = detailView.closest(".browser-body");
  showWorkshopDetailView(detailView, browserBody);
  detailView.innerHTML = `<div class="workshop-detail-loading">${renderWorkshopLoading("正在加载物品详情...")}</div>`;

  try {
    // 请求详情
    const detail = await FetchWorkshopDetail(item.publishedfileid);
    workshopPreviewImages = getWorkshopPreviewImages(detail);
    workshopPreviewIndex = 0;

    detailView.innerHTML = `
            <div class="detail-container">
                <div class="detail-header-action">
                    <button class="btn btn-outline" id="back-to-list-btn">← 返回列表</button>
                    <a href="javascript:void(0)" id="open-in-steam-browser" class="btn btn-outline">
                        🔗 在浏览器打开
                    </a>
                </div>

                <div class="detail-scroll-content">
                <div class="detail-top-section">
                    <div class="detail-preview-wrapper">
                        <div class="main-preview-container skeleton-anim">
                             <div class="skeleton-image-placeholder">
                                 <svg class="icon-svg" style="width: 48px; height: 48px; opacity: 0.5;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                     <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                                     <circle cx="8.5" cy="8.5" r="1.5"></circle>
                                     <polyline points="21 15 16 10 5 21"></polyline>
                                 </svg>
                             </div>
                             <img src="${
                               detail.previews && detail.previews.length > 0
                                 ? detail.previews[0].preview_url ||
                                   detail.previews[0]
                                 : detail.preview_url
                             }" class="detail-preview-img-large" id="main-preview-img" 
                             style="opacity: 0; transition: opacity 0.3s; position: relative; z-index: 2;"
                             onclick="window.openFullImage(this.src)"
                             onload="this.style.opacity='1'; this.parentElement.classList.remove('skeleton-anim'); this.previousElementSibling.style.display='none';">
                        </div>
                        ${renderThumbnails(detail)}
                    </div>
                    
                    <div class="detail-info-wrapper">
                         <h1 class="detail-title-large">${detail.title}</h1>
                         
                         <div class="detail-stats-bar">
                             <div class="stat-item">
                                <span class="stat-value">${formatNumber(
                                  detail.subscriptions
                                )}</span>
                                <span class="stat-label">订阅</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-value">${formatNumber(
                                  detail.favorited
                                )}</span>
                                <span class="stat-label">收藏</span>
                            </div>
                             <div class="stat-item">
                                <span class="stat-value">${formatSize(
                                  detail.file_size
                                )}</span>
                                <span class="stat-label">大小</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-value">${new Date(
                                  detail.time_updated * 1000
                                ).toLocaleDateString()}</span>
                                <span class="stat-label">更新</span>
                            </div>
                        </div>

                         <div class="detail-tags-row">
                            ${(detail.tags || [])
                              .map(
                                (t) => `<span class="tag-badge">${t.tag}</span>`
                              )
                              .join("")}
                        </div>

                         <div class="action-bar-large">
                            <button class="btn btn-success btn-large" id="browser-download-btn" style="width: 100%;">
                                <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                    <polyline points="7 10 12 15 17 10"></polyline>
                                    <line x1="12" y1="15" x2="12" y2="3"></line>
                                </svg>
                                <span>下载并安装</span>
                            </button>
                         </div>
                    </div>
                </div>

                <div class="detail-description-box">
                    <h3>MOD 介绍</h3>
                    <div class="detail-description-text">${
                      detail.description
                        ? formatDescription(detail.description)
                        : "暂无描述"
                    }</div>
                </div>
                </div>
            </div>
        `;

    // 绑定事件
    document
      .getElementById("back-to-list-btn")
      .addEventListener("click", () => {
        // 隐藏详情，因为我们现在是单页覆盖
        hideWorkshopDetailView(detailView, browserBody);
      });

    document
      .getElementById("browser-download-btn")
      .addEventListener("click", () => {
        startDownloadFromBrowser(detail.publishedfileid);
      });

    document
      .getElementById("open-in-steam-browser")
      .addEventListener("click", async () => {
        const target = await GetWorkshopBrowserTarget();
        let url;
        if (target === "mirror") {
          url = `https://l4d2ws.com?workshop-id=${detail.publishedfileid}`;
        } else {
          url = `https://steamcommunity.com/sharedfiles/filedetails/?id=${detail.publishedfileid}`;
        }
        BrowserOpenURL(url);
      });

    // 绑定缩略图滚轮事件
    const thumbContainer = detailView.querySelector(".detail-thumbnails");
    if (thumbContainer) {
      thumbContainer.addEventListener("wheel", (evt) => {
        if (evt.deltaY !== 0) {
          evt.preventDefault();
          thumbContainer.scrollLeft += evt.deltaY;
        }
      });
    }
  } catch (err) {
    detailView.innerHTML = `
            <div class="loading-placeholder">
                <p>加载详情失败: ${err}</p>
                <button class="btn btn-primary" id="detail-error-back-btn">返回</button>
            </div>`;
    document
      .getElementById("detail-error-back-btn")
      ?.addEventListener("click", () => {
        hideWorkshopDetailView(detailView, browserBody);
      });
  }
}

// Helper to format bbcode-like description roughly or just preserve whitespace
function formatDescription(text) {
  if (!text) return "";

  // 1. 转义 HTML 特殊字符，防止 XSS
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  // 2. 基础 BBCode 替换
  const tags = [
    { regex: /\[h1\](.*?)\[\/h1\]/gi, replace: "<h3>$1</h3>" },
    { regex: /\[h2\](.*?)\[\/h2\]/gi, replace: "<h4>$1</h4>" },
    { regex: /\[h3\](.*?)\[\/h3\]/gi, replace: "<h5>$1</h5>" },
    { regex: /\[b\](.*?)\[\/b\]/gi, replace: "<strong>$1</strong>" },
    { regex: /\[u\](.*?)\[\/u\]/gi, replace: "<u>$1</u>" },
    { regex: /\[i\](.*?)\[\/i\]/gi, replace: "<em>$1</em>" },
    { regex: /\[strike\](.*?)\[\/strike\]/gi, replace: "<del>$1</del>" },
    {
      regex: /\[spoiler\](.*?)\[\/spoiler\]/gi,
      replace: '<span class="spoiler">$1</span>',
    },
    { regex: /\[hr\]/gi, replace: "<hr>" },
    {
      regex: /\[code\](.*?)\[\/code\]/gis,
      replace: "<pre><code>$1</code></pre>",
    },
    {
      regex: /\[quote\](.*?)\[\/quote\]/gis,
      replace: "<blockquote>$1</blockquote>",
    },
    { regex: /\[noparse\](.*?)\[\/noparse\]/gis, replace: "$1" },
    // 新增：表格
    {
      regex: /\[table\](.*?)\[\/table\]/gis,
      replace: '<table class="bbcode-table">$1</table>',
    },
    { regex: /\[tr\](.*?)\[\/tr\]/gis, replace: "<tr>$1</tr>" },
    { regex: /\[td\](.*?)\[\/td\]/gis, replace: "<td>$1</td>" },
    { regex: /\[th\](.*?)\[\/th\]/gis, replace: "<th>$1</th>" },
    // 新增：样式
    {
      regex: /\[size=(\d+)\](.*?)\[\/size\]/gi,
      replace: '<span style="font-size:$1pt">$2</span>',
    },
    {
      regex: /\[color=([^\]]+)\](.*?)\[\/color\]/gi,
      replace: '<span style="color:$1">$2</span>',
    },
    {
      regex: /\[font=([^\]]+)\](.*?)\[\/font\]/gi,
      replace: '<span style="font-family:$1">$2</span>',
    },
    // 新增：对齐
    {
      regex: /\[center\](.*?)\[\/center\]/gis,
      replace: '<div style="text-align:center">$1</div>',
    },
    {
      regex: /\[left\](.*?)\[\/left\]/gis,
      replace: '<div style="text-align:left">$1</div>',
    },
    {
      regex: /\[right\](.*?)\[\/right\]/gis,
      replace: '<div style="text-align:right">$1</div>',
    },
    {
      regex: /\[indent\](.*?)\[\/indent\]/gis,
      replace: '<div style="margin-left:2em">$1</div>',
    },
  ];

  tags.forEach((tag) => {
    html = html.replace(tag.regex, tag.replace);
  });

  // 3. 链接替换
  // [url=...]text[/url]
  html = html.replace(
    /\[url=(.*?)\](.*?)\[\/url\]/gi,
    (match, url, content) => {
      return `<a href="javascript:void(0)" onclick="window.BrowserOpenURL('${url}')" class="bbcode-link">${content}</a>`;
    }
  );
  // [url]...[/url]
  html = html.replace(/\[url\](.*?)\[\/url\]/gi, (match, url) => {
    return `<a href="javascript:void(0)" onclick="window.BrowserOpenURL('${url}')" class="bbcode-link">${url}</a>`;
  });

  // 4. 图片替换
  html = html.replace(
    /\[img\](.*?)\[\/img\]/gi,
    '<img src="$1" class="bbcode-img" loading="lazy" />'
  );

  // 5. 列表替换
  // [list]...[/list]
  html = html.replace(/\[list\](.*?)\[\/list\]/gis, (match, content) => {
    const items = content.split("[*]").filter((s) => s.trim().length > 0);
    const listItems = items.map((item) => `<li>${item.trim()}</li>`).join("");
    return `<ul class="bbcode-list">${listItems}</ul>`;
  });
  // [olist]...[/olist]
  html = html.replace(/\[olist\](.*?)\[\/olist\]/gis, (match, content) => {
    const items = content.split("[*]").filter((s) => s.trim().length > 0);
    const listItems = items.map((item) => `<li>${item.trim()}</li>`).join("");
    return `<ol class="bbcode-list">${listItems}</ol>`;
  });
  // 新增：[list=1]...[/list]
  html = html.replace(/\[list=1\](.*?)\[\/list\]/gis, (match, content) => {
    const items = content.split("[*]").filter((s) => s.trim().length > 0);
    const listItems = items.map((item) => `<li>${item.trim()}</li>`).join("");
    return `<ol class="bbcode-list">${listItems}</ol>`;
  });
  // 新增：[list=a]...[/list]
  html = html.replace(/\[list=a\](.*?)\[\/list\]/gis, (match, content) => {
    const items = content.split("[*]").filter((s) => s.trim().length > 0);
    const listItems = items.map((item) => `<li>${item.trim()}</li>`).join("");
    return `<ol type="a" class="bbcode-list">${listItems}</ol>`;
  });

  // 6. 兜底清理：移除未匹配的 BBCode 标签（保留内容）
  html = html.replace(/\[\/?[a-zA-Z]+(?:=[^\]]*)?\]/g, "");

  // 7. 处理换行并压缩多余空行
  html = html.replace(/\n/g, "<br>");
  // 压缩 3 个及以上连续 <br> 为 2 个
  html = html.replace(/(<br>){3,}/g, "<br><br>");
  // 去掉首尾多余的 <br>
  html = html.replace(/^(<br>)+|(<br>)+$/g, "");

  return html;
}

function startDownloadFromBrowser(id) {
  // 1. 关闭浏览弹窗
  document.getElementById("browser-modal").classList.add("hidden");

  // 2. 切换到下载页。下载页已经嵌入了原下载弹窗内容，不能再显示弹窗壳。
  switchAppPage("downloads");

  // 3. 填充 URL
  const urlInput = document.getElementById("workshop-url");
  urlInput.value = `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`;

  // 4. 触发解析
  const checkBtn = document.getElementById("check-workshop-btn");
  if (checkBtn) checkBtn.click();
}

function formatSize(bytes) {
  if (!bytes) return "N/A";
  if (bytes < 1024) return bytes + " B";
  else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  else if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + " MB";
  else return (bytes / 1073741824).toFixed(1) + " GB";
}

/* -------------------------------------------------------------------------- */
/* 创意工坊侧边栏数据与渲染                                                    */
/* -------------------------------------------------------------------------- */

const WORKSHOP_CATEGORIES = [
  {
    name: "幸存者 (Survivors)",
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
    name: "感染者 (Infected)",
    children: [
      { name: "特感 (Special Infected)", tag: "Special Infected" },
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
      { name: "战役 (Campaigns)", tag: "Campaigns" },
      { name: "合作 (Co-op)", tag: "Co-op" },
      { name: "生存 (Survival)", tag: "Survival" },
      { name: "对抗 (Versus)", tag: "Versus" },
      { name: "清道夫 (Scavenge)", tag: "Scavenge" },
      { name: "写实 (Realism)", tag: "Realism" },
      { name: "写实对抗", tag: "Realism Versus" },
      { name: "突变 (Mutations)", tag: "Mutations" },
      { name: "单人 (Single Player)", tag: "Single Player" },
    ],
  },
  {
    name: "武器 (Weapons)",
    children: [
      { name: "步枪 (Rifle)", tag: "Rifle" },
      { name: "冲锋枪 (SMG)", tag: "SMG" },
      { name: "散弹枪 (Shotgun)", tag: "Shotgun" },
      { name: "狙击枪 (Sniper)", tag: "Sniper" },
      { name: "手枪 (Pistol)", tag: "Pistol" },
      { name: "近战 (Melee)", tag: "Melee" },
      { name: "榴弹 (Grenade Launcher)", tag: "Grenade Launcher" },
      { name: "M60", tag: "M60" },
      { name: "投掷物 (Throwable)", tag: "Throwable" },
    ],
  },
  {
    name: "物品 (Items)",
    children: [
      { name: "治疗包 (Medkit)", tag: "Medkit" },
      { name: "电击器 (Defibrillator)", tag: "Defibrillator" },
      { name: "肾上腺素 (Adrenaline)", tag: "Adrenaline" },
      { name: "止痛药 (Pills)", tag: "Pills" },
    ],
  },
  {
    name: "其他资源",
    children: [
      { name: "UI", tag: "UI" },
      { name: "音效 (Sounds)", tag: "Sounds" },
      { name: "脚本 (Scripts)", tag: "Scripts" },
      { name: "模型 (Models)", tag: "Models" },
      { name: "纹理 (Textures)", tag: "Textures" },
      { name: "杂项 (Miscellaneous)", tag: "Miscellaneous" },
      { name: "其他 (Other)", tag: "Other" },
    ],
  },
];

export function renderWorkshopSidebar() {
  const container = document.getElementById("browser-sidebar-content");
  if (!container) return;

  container.innerHTML = "";

  // 渲染 Categories
  WORKSHOP_CATEGORIES.forEach((cat) => {
    const group = document.createElement("div");
    group.className = "filter-group";

    // 分组标题
    if (cat.name !== "全部") {
      const title = document.createElement("h4");
      title.textContent = cat.name;
      group.appendChild(title);
    }

    const list = document.createElement("ul");
    list.className = "filter-list";

    // 也是一种扁平化处理，如果 cat 本身有 tag，那它就是一个项
    if (cat.tag !== undefined) {
      renderFilterItem(list, cat.name, cat.tag, cat.searchText, true);
    }

    // 如果有 children
    if (cat.children) {
      cat.children.forEach((child) => {
        renderFilterItem(list, child.name, child.tag, child.searchText);
      });
    }

    group.appendChild(list);
    container.appendChild(group);
  });
}

function renderFilterItem(
  parentList,
  name,
  tag,
  searchText,
  isDefault = false
) {
  const li = document.createElement("li");
  li.className = "filter-item";

  // Check active state
  // Update active based on whether the PRIMARY tag matches
  const currentTag = browserState.tags[0] || "";

  // If searchText is used logic needs to be careful, but here we prioritize Tag matching significantly
  if (tag === currentTag) {
    li.classList.add("active");
  }

  // Store data
  li.dataset.tag = tag;
  li.textContent = name;

  li.addEventListener("click", () => {
    // Clear all active
    document
      .querySelectorAll("#browser-sidebar-content .filter-item")
      .forEach((i) => i.classList.remove("active"));
    li.classList.add("active");

    // Update State
    // Simplify: Just send specific tag. Avoid strict AND logic failure.
    let tagsToSend = [];
    if (tag) {
      tagsToSend.push(tag);
    }

    browserState.tags = tagsToSend;

    // Handle Search Text Override
    if (searchText) {
      browserState.query = searchText;
      const input = document.getElementById("browser-search-input");
      if (input) input.value = searchText;
    } else {
      // Clear regular search unless user typed it?
      // If we click a category, usually we want to see ALL of that category.
      // But if user typed "skins" and clicked "Coach", maybe they want "Coach Skins"?
      // Current behavior: Reset query to avoid confusion (like "AK47" query stuck on "Coach" tag)
      browserState.query = "";
      const input = document.getElementById("browser-search-input");
      if (input) input.value = "";
    }

    browserState.page = 1;
    browserState.data = [];

    loadWorkshopList();
  });

  parentList.appendChild(li);
}

document.addEventListener("DOMContentLoaded", () => {
  const browseBtn = document.getElementById("browse-workshop-btn");
  if (browseBtn) {
    browseBtn.addEventListener("click", () => {
      openBrowser({ fromWorkshopModal: true });
    });
  }

  // Wire up search in browser
  const browserSearch = document.getElementById("browser-search-input");
  const browserSearchBtn = document.getElementById("browser-search-btn");
  const browserResetBtn = document.getElementById("browser-reset-btn");

  const performBrowserSearch = () => {
    if (browserSearch) {
      browserState.query = browserSearch.value.trim();
    }
    browserState.page = 1;
    browserState.data = [];
    loadWorkshopList();
  };

  if (browserSearch) {
    let debounceTimer;

    // 回车搜索
    browserSearch.addEventListener("keyup", (e) => {
      if (e.key === "Enter") {
        clearTimeout(debounceTimer);
        performBrowserSearch();
      }
    });

    // 输入延迟搜索
    browserSearch.addEventListener("input", (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        performBrowserSearch();
      }, 800);
    });
  }

  // 查询按钮
  if (browserSearchBtn) {
    browserSearchBtn.addEventListener("click", () => {
      performBrowserSearch();
    });
  }

  // 重置按钮
  if (browserResetBtn) {
    browserResetBtn.addEventListener("click", () => {
      // 清空搜索框
      if (browserSearch) browserSearch.value = "";

      // 清空状态
      browserState.query = "";
      browserState.tags = [];
      browserState.page = 1;
      browserState.data = [];

      // 清空侧边栏选中
      document
        .querySelectorAll("#browser-sidebar-content .filter-item")
        .forEach((i) => i.classList.remove("active"));

      loadWorkshopList();
    });
  }
});

/* -------------------------------------------------------------------------- */
/* URL协议处理函数 (lytvpk://parse/{id} 和 lytvpk://workshop/{id})            */
/* -------------------------------------------------------------------------- */

/**
 * 处理 lytvpk://parse/{id} 协议
 * 解析工坊ID并显示下载界面
 */
export async function handleProtocolParse(workshopId) {
  console.log("处理协议解析:", workshopId);

  // 显示通知
  showNotification(`正在解析工坊ID: ${workshopId}`, "info");

  // 打开工坊下载模态框
  openWorkshopModal();

  // 填充工坊URL（使用ID构造URL）
  const workshopUrl = `https://steamcommunity.com/sharedfiles/filedetails/?id=${workshopId}`;
  document.getElementById("workshop-url").value = workshopUrl;

  // 自动触发解析
  setTimeout(() => {
    const checkBtn = document.getElementById("check-workshop-btn");
    if (checkBtn) {
      checkBtn.click();
    }
  }, 300);
}

/**
 * 处理 lytvpk://workshop/{id} 协议
 * 在工坊浏览器中打开指定工坊详情
 */
export async function handleProtocolWorkshop(workshopId) {
  console.log("处理协议打开工坊:", workshopId);

  const fileDetailModal = document.getElementById("file-detail-modal");
  if (fileDetailModal && !fileDetailModal.classList.contains("hidden")) {
    closeModal();
  }

  // 显示通知
  showNotification(`正在打开工坊: ${workshopId}`, "info");

  // 打开工坊浏览器模态框
  openBrowser();

  // 检查是否正在优选IP，如果是则等待完成
  const isSelecting = await IsSelectingIP();
  if (isSelecting) {
    console.log("正在优选IP，等待完成...");
    showNotification("正在等待IP优选完成...", "info");

    // 等待优选IP完成
    await waitForIPSelection();
    console.log("IP优选已完成，继续获取详情");
  }

  // 等待模态框打开后，直接打开详情
  setTimeout(async () => {
    try {
      // 尝试获取详情
      const detail = await FetchWorkshopDetail(workshopId);
      if (detail && detail.publishedfileid) {
        // API成功，使用完整详情
        openWorkshopDetail(detail);
      } else {
        // API返回空，使用基本信息
        openWorkshopDetail({
          publishedfileid: workshopId,
          title: `工坊 #${workshopId}`,
          preview_url: "",
          description: "无法获取详细信息，请检查网络连接",
        });
      }
    } catch (err) {
      console.error("获取工坊详情失败:", err);
      // API失败时，使用基本信息打开（而不是显示错误）
      openWorkshopDetail({
        publishedfileid: workshopId,
        title: `工坊 #${workshopId}`,
        preview_url: "",
        description: `获取详情失败: ${err}\n\n请检查网络连接或稍后重试`,
      });
      // 显示错误提示（但不阻止用户操作）
      showError(`获取工坊详情失败: ${err}`);
    }
  }, 500);
}

/**
 * 等待IP优选完成
 * 返回Promise，在ip_selection_end事件触发后resolve
 */
function waitForIPSelection() {
  return new Promise((resolve) => {
    // 设置超时，最多等待30秒
    const timeout = setTimeout(() => {
      console.log("等待IP优选超时，继续执行");
      resolve();
    }, 30000);

    // 监听优选完成事件
    const cleanup = EventsOn("ip_selection_end", () => {
      clearTimeout(timeout);
      cleanup(); // 清理事件监听
      resolve();
    });
  });
}
