import { workshopDeps } from "./deps.js";
import {
  getWorkshopPreviewImages,
  renderThumbnails,
  setWorkshopPreviewImages,
} from "./detail-images.js";
import {
  createWatchLaterItem,
  getWatchLaterItems,
  isInWatchLater,
  saveWatchLaterItems,
  toggleWatchLaterItem,
  updateWatchLaterDetailButton,
} from "./watch-later.js";
import {
  escapeHtml,
  formatNumber,
  formatSize,
  formatWorkshopDate,
  getWorkshopItemId,
  isWorkshopCollection,
  renderWorkshopLoading,
} from "./utils.js";

const descriptionTranslationCache = new Map();
const TRANSLATE_ICON_SVG = `
  <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="m5 8 6 6"></path>
    <path d="m4 14 6-6 2-3"></path>
    <path d="M2 5h12"></path>
    <path d="M7 2h1"></path>
    <path d="m22 22-5-10-5 10"></path>
    <path d="M14 18h6"></path>
  </svg>
`;

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

export function resetWorkshopDetailView(detailView) {
  if (!detailView) return;

  detailView.classList.add("hidden");
  detailView.classList.remove("workshop-detail-enter", "workshop-detail-leave");
  detailView.closest(".browser-body")?.classList.remove("detail-open");
}

function getDetailPreviewUrl(detail) {
  const images = getWorkshopPreviewImages(detail);
  return images[0] || detail.preview_url || "assets/images/no-preview.png";
}

function renderDetailBackButton(parentDetail) {
  return `
    <button class="btn btn-outline detail-back-btn" id="back-to-list-btn">
        <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M19 12H5"></path>
            <path d="m12 19-7-7 7-7"></path>
        </svg>
        <span>${parentDetail ? "返回合集" : "返回列表"}</span>
    </button>
  `;
}

function renderDetailHeader(parentDetail) {
  return `
    <div class="detail-header-action">
        ${renderDetailBackButton(parentDetail)}
        <div class="detail-header-actions-right">
            <button class="btn btn-outline watch-later-detail-btn" id="add-to-watch-later-btn" type="button">
                <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M12 6v6l4 2"></path>
                    <circle cx="12" cy="12" r="9"></circle>
                </svg>
                <span class="watch-later-label">添加到稍后再看</span>
            </button>
            <a href="javascript:void(0)" id="open-in-steam-browser" class="btn btn-outline">
                <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M15 3h6v6"></path>
                    <path d="M10 14 21 3"></path>
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                </svg>
                <span>在浏览器打开</span>
            </a>
        </div>
    </div>
  `;
}

function renderDetailPreview(detail) {
  const previewUrl = getDetailPreviewUrl(detail);
  return `
    <div class="detail-preview-wrapper">
        <div class="main-preview-container skeleton-anim">
             <div class="skeleton-image-placeholder">
                 <svg class="icon-svg" style="width: 48px; height: 48px; opacity: 0.5;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                     <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                     <circle cx="8.5" cy="8.5" r="1.5"></circle>
                     <polyline points="21 15 16 10 5 21"></polyline>
                 </svg>
             </div>
             <img src="${escapeHtml(previewUrl)}" class="detail-preview-img-large" id="main-preview-img"
             style="opacity: 0; transition: opacity 0.3s; position: relative; z-index: 2;"
             onclick="window.openFullImage(this.src)"
             onload="this.style.opacity='1'; this.parentElement.classList.remove('skeleton-anim'); this.previousElementSibling.style.display='none';">
        </div>
        ${renderThumbnails(detail)}
    </div>
  `;
}

function renderDetailTags(detail, extraHtml = "") {
  const tagsHtml = (detail.tags || [])
    .map((t) => `<span class="tag-badge">${escapeHtml(t.tag)}</span>`)
    .join("");
  return `<div class="detail-tags-row">${extraHtml}${tagsHtml}</div>`;
}

function renderDetailDownloadButton(label) {
  return `
    <div class="action-bar-large">
        <button class="btn btn-success btn-large" id="browser-download-btn">
            <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span>${label}</span>
        </button>
    </div>
  `;
}

function renderItemStats(detail) {
  return `
    <div class="detail-stats-bar">
        <div class="stat-item">
            <span class="stat-value">${formatNumber(detail.views)}</span>
            <span class="stat-label">点击</span>
        </div>
        <div class="stat-item">
            <span class="stat-value">${formatNumber(detail.subscriptions)}</span>
            <span class="stat-label">订阅</span>
        </div>
        <div class="stat-item">
            <span class="stat-value">${formatNumber(detail.favorited)}</span>
            <span class="stat-label">收藏</span>
        </div>
        <div class="stat-item">
            <span class="stat-value">${formatSize(detail.file_size)}</span>
            <span class="stat-label">大小</span>
        </div>
        <div class="stat-item">
            <span class="stat-value">${formatWorkshopDate(detail.time_updated)}</span>
            <span class="stat-label">更新</span>
        </div>
    </div>
  `;
}

function renderCollectionStats(detail) {
  const childCount = Array.isArray(detail.child_items) ? detail.child_items.length : 0;
  return `
    <div class="detail-stats-bar">
        <div class="stat-item">
            <span class="stat-value">${formatNumber(detail.views)}</span>
            <span class="stat-label">点击</span>
        </div>
        <div class="stat-item">
            <span class="stat-value">${formatNumber(detail.subscriptions)}</span>
            <span class="stat-label">订阅</span>
        </div>
        <div class="stat-item">
            <span class="stat-value">${formatNumber(detail.favorited)}</span>
            <span class="stat-label">收藏</span>
        </div>
        <div class="stat-item">
            <span class="stat-value">${childCount}</span>
            <span class="stat-label">物品</span>
        </div>
        <div class="stat-item">
            <span class="stat-value">${formatWorkshopDate(detail.time_updated)}</span>
            <span class="stat-label">更新</span>
        </div>
    </div>
  `;
}

function renderCollectionItems(detail) {
  const childItems = Array.isArray(detail.child_items) ? detail.child_items : [];

  if (childItems.length === 0) {
    return `
      <div class="collection-items-section">
        <div class="collection-items-header">
          <h3>合集物品</h3>
          <span>0 个物品</span>
        </div>
        <div class="collection-empty-state">暂时无法获取合集中的物品列表</div>
      </div>
    `;
  }

  return `
    <div class="collection-items-section">
      <div class="collection-items-header">
        <h3>合集物品</h3>
        <span>${childItems.length} 个物品</span>
      </div>
      <div class="collection-items-list">
        ${childItems
          .map((child) => {
            const childId = getWorkshopItemId(child);
            const title = child.title || `工坊 #${childId}`;
            const previewUrl = child.preview_url || "assets/images/no-preview.png";
            return `
              <div class="collection-child-card" role="button" tabindex="0" data-workshop-id="${escapeHtml(childId)}">
                <div class="collection-child-thumb">
                  <img src="${escapeHtml(previewUrl)}" alt="${escapeHtml(title)}" loading="lazy">
                </div>
                <div class="collection-child-info">
                  <div class="collection-child-title">${escapeHtml(title)}</div>
                  <div class="collection-child-meta">
                    <span>ID ${escapeHtml(childId)}</span>
                    <span>点击 ${formatNumber(child.views)}</span>
                    <span>订阅 ${formatNumber(child.subscriptions)}</span>
                  </div>
                </div>
                <button class="btn btn-secondary btn-small collection-child-download-btn" type="button" data-workshop-id="${escapeHtml(childId)}" aria-label="下载 ${escapeHtml(title)}">
                  <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                  </svg>
                  <span>下载</span>
                </button>
              </div>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

function renderItemDetail(detail, parentDetail) {
  return `
    <div class="detail-container">
        ${renderDetailHeader(parentDetail)}
        <div class="detail-scroll-content">
          <div class="detail-top-section">
              ${renderDetailPreview(detail)}
              <div class="detail-info-wrapper">
                  <h1 class="detail-title-large">${escapeHtml(detail.title)}</h1>
                  ${renderItemStats(detail)}
                  ${renderDetailTags(detail)}
                  ${renderDetailDownloadButton("下载并安装")}
              </div>
          </div>
          ${renderDescriptionBox(detail, "MOD 介绍")}
        </div>
    </div>
  `;
}

function renderCollectionDetail(detail, parentDetail) {
  return `
    <div class="detail-container">
        ${renderDetailHeader(parentDetail)}
        <div class="detail-scroll-content">
          <div class="detail-top-section">
              ${renderDetailPreview(detail)}
              <div class="detail-info-wrapper">
                  <div class="detail-title-row">
                    <span class="detail-type-badge">合集</span>
                    <h1 class="detail-title-large">${escapeHtml(detail.title)}</h1>
                  </div>
                  ${renderCollectionStats(detail)}
                  ${renderDetailTags(detail, '<span class="tag-badge collection-detail-tag">合集</span>')}
                  ${renderDetailDownloadButton("下载合集")}
              </div>
          </div>
          ${renderCollectionItems(detail)}
          ${renderDescriptionBox(detail, "合集介绍")}
        </div>
    </div>
  `;
}

function renderDescriptionBox(detail, title) {
  const hasDescription = Boolean(String(detail.description || "").trim());
  return `
    <div class="detail-description-box" data-description-box>
        <div class="detail-description-header">
          <h3>${escapeHtml(title)}</h3>
          ${
            hasDescription
              ? `<button class="btn btn-outline btn-small detail-translate-btn" type="button" data-translate-description-btn>
                  ${TRANSLATE_ICON_SVG}
                  <span>翻译描述</span>
                </button>`
              : ""
          }
        </div>
        <div class="detail-description-text" data-description-text>${
          hasDescription ? formatDescriptionParagraphs(detail.description) : "暂无描述"
        }</div>
    </div>
  `;
}

function formatDescriptionParagraphs(text) {
  const paragraphs = splitDescriptionParagraphs(text);
  if (paragraphs.length === 0) {
    return "";
  }

  return paragraphs
    .map(
      (paragraph, index) => `
        <div class="detail-description-paragraph" data-description-paragraph-index="${index}">
          <div class="detail-description-original">${formatDescription(paragraph)}</div>
          <div class="detail-paragraph-translation hidden" data-description-paragraph-translation="${index}"></div>
        </div>`
    )
    .join("");
}

function splitDescriptionParagraphs(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function renderWorkshopDetail(detail, options = {}) {
  const detailView = document.getElementById("browser-detail-view");
  const browserBody = detailView.closest(".browser-body");
  const parentDetail = options.parentDetail || null;

  setWorkshopPreviewImages(getWorkshopPreviewImages(detail));
  if (isInWatchLater(detail.publishedfileid)) {
    const nextItems = getWatchLaterItems().map((savedItem) =>
      savedItem.publishedfileid === detail.publishedfileid
        ? { ...savedItem, ...createWatchLaterItem(detail), addedAt: savedItem.addedAt }
        : savedItem
    );
    saveWatchLaterItems(nextItems);
  }

  detailView.innerHTML = isWorkshopCollection(detail)
    ? renderCollectionDetail(detail, parentDetail)
    : renderItemDetail(detail, parentDetail);
  bindDescriptionTranslation(detailView, detail);

  document
    .getElementById("back-to-list-btn")
    .addEventListener("click", () => {
      if (parentDetail) {
        renderWorkshopDetail(parentDetail);
        return;
      }
      hideWorkshopDetailView(detailView, browserBody);
    });

  document
    .getElementById("browser-download-btn")
    .addEventListener("click", () => {
      startDownloadFromBrowser(detail.publishedfileid);
    });

  const watchLaterBtn = document.getElementById("add-to-watch-later-btn");
  if (watchLaterBtn) {
    watchLaterBtn.dataset.workshopId = detail.publishedfileid;
    updateWatchLaterDetailButton(watchLaterBtn, detail);
    watchLaterBtn.addEventListener("click", () => {
      toggleWatchLaterItem(detail);
      updateWatchLaterDetailButton(watchLaterBtn, detail);
    });
  }

  document
    .getElementById("open-in-steam-browser")
    .addEventListener("click", async () => {
      const target = await workshopDeps.GetWorkshopBrowserTarget();
      let url;
      if (target === "mirror") {
        url = `https://l4d2ws.com?workshop-id=${detail.publishedfileid}`;
      } else {
        url = `https://steamcommunity.com/sharedfiles/filedetails/?id=${detail.publishedfileid}`;
      }
      workshopDeps.BrowserOpenURL(url);
    });

  const thumbContainer = detailView.querySelector(".detail-thumbnails");
  if (thumbContainer) {
    thumbContainer.addEventListener("wheel", (evt) => {
      if (evt.deltaY !== 0) {
        evt.preventDefault();
        thumbContainer.scrollLeft += evt.deltaY;
      }
    });
  }

  detailView.querySelectorAll(".collection-child-card").forEach((card) => {
    const openChild = () => {
      const childId = card.dataset.workshopId;
      const child = (detail.child_items || []).find(
        (item) => getWorkshopItemId(item) === childId
      );
      openWorkshopDetail(child || { publishedfileid: childId }, {
        parentDetail: detail,
      });
    };

    card.addEventListener("click", openChild);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openChild();
      }
    });
  });

  detailView
    .querySelectorAll(".collection-child-download-btn")
    .forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        startDownloadFromBrowser(button.dataset.workshopId);
      });
    });
}

export async function openWorkshopDetail(item, options = {}) {
  const detailView = document.getElementById("browser-detail-view");
  const browserBody = detailView.closest(".browser-body");
  showWorkshopDetailView(detailView, browserBody);
  detailView.innerHTML = `<div class="workshop-detail-loading">${renderWorkshopLoading("正在加载物品详情...")}</div>`;

  try {
    const detail = await workshopDeps.FetchWorkshopDetail(getWorkshopItemId(item));
    renderWorkshopDetail(detail, options);
  } catch (err) {
    detailView.innerHTML = `
            <div class="loading-placeholder">
                <p>加载详情失败: ${err}</p>
                <button class="btn btn-primary" id="detail-error-back-btn">${options.parentDetail ? "返回合集" : "返回"}</button>
            </div>`;
    document
      .getElementById("detail-error-back-btn")
      ?.addEventListener("click", () => {
        if (options.parentDetail) {
          renderWorkshopDetail(options.parentDetail);
          return;
        }
        hideWorkshopDetailView(detailView, browserBody);
      });
  }
}

function formatDescription(text) {
  if (!text) return "";

  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

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
    {
      regex: /\[table\](.*?)\[\/table\]/gis,
      replace: '<table class="bbcode-table">$1</table>',
    },
    { regex: /\[tr\](.*?)\[\/tr\]/gis, replace: "<tr>$1</tr>" },
    { regex: /\[td\](.*?)\[\/td\]/gis, replace: "<td>$1</td>" },
    { regex: /\[th\](.*?)\[\/th\]/gis, replace: "<th>$1</th>" },
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

  html = html.replace(
    /\[url=(.*?)\](.*?)\[\/url\]/gi,
    (match, url, content) => {
      return `<a href="javascript:void(0)" onclick="window.BrowserOpenURL('${url}')" class="bbcode-link">${content}</a>`;
    }
  );
  html = html.replace(/\[url\](.*?)\[\/url\]/gi, (match, url) => {
    return `<a href="javascript:void(0)" onclick="window.BrowserOpenURL('${url}')" class="bbcode-link">${url}</a>`;
  });

  html = html.replace(
    /\[img\](.*?)\[\/img\]/gi,
    '<img src="$1" class="bbcode-img" loading="lazy" />'
  );

  html = html.replace(/\[list\](.*?)\[\/list\]/gis, (match, content) => {
    const items = content.split("[*]").filter((s) => s.trim().length > 0);
    const listItems = items.map((item) => `<li>${item.trim()}</li>`).join("");
    return `<ul class="bbcode-list">${listItems}</ul>`;
  });
  html = html.replace(/\[olist\](.*?)\[\/olist\]/gis, (match, content) => {
    const items = content.split("[*]").filter((s) => s.trim().length > 0);
    const listItems = items.map((item) => `<li>${item.trim()}</li>`).join("");
    return `<ol class="bbcode-list">${listItems}</ol>`;
  });
  html = html.replace(/\[list=1\](.*?)\[\/list\]/gis, (match, content) => {
    const items = content.split("[*]").filter((s) => s.trim().length > 0);
    const listItems = items.map((item) => `<li>${item.trim()}</li>`).join("");
    return `<ol class="bbcode-list">${listItems}</ol>`;
  });
  html = html.replace(/\[list=a\](.*?)\[\/list\]/gis, (match, content) => {
    const items = content.split("[*]").filter((s) => s.trim().length > 0);
    const listItems = items.map((item) => `<li>${item.trim()}</li>`).join("");
    return `<ol type="a" class="bbcode-list">${listItems}</ol>`;
  });

  html = html.replace(/\[\/?[a-zA-Z]+(?:=[^\]]*)?\]/g, "");
  html = html.replace(/\n/g, "<br>");
  html = html.replace(/(<br>){3,}/g, "<br><br>");
  html = html.replace(/^(<br>)+|(<br>)+$/g, "");

  return html;
}

function bindDescriptionTranslation(detailView, detail) {
  const button = detailView.querySelector("[data-translate-description-btn]");
  const paragraphElements = Array.from(
    detailView.querySelectorAll("[data-description-paragraph-index]")
  );
  if (!button || paragraphElements.length === 0 || !detail.description) return;

  button.addEventListener("click", async () => {
    const rawDescription = detail.description || "";
    const paragraphs = splitDescriptionParagraphs(rawDescription);
    const segments = paragraphs
      .map((paragraph, index) => ({
        index,
        text: descriptionToPlainText(paragraph),
        resultEl: detailView.querySelector(
          `[data-description-paragraph-translation="${index}"]`
        ),
      }))
      .filter((segment) => segment.text && segment.resultEl);

    if (segments.length === 0) {
      workshopDeps.showNotification?.("没有可翻译的描述内容", "info");
      return;
    }

    const provider = (await workshopDeps.GetWorkshopTranslateProvider?.()) || "microsoft";
    setTranslateButtonLoading(button, true);
    let translatedCount = 0;
    let failedError = null;

    try {
      for (const segment of segments) {
        const cacheKey = [
          getWorkshopItemId(detail),
          provider,
          segment.text,
        ].join("::");
        const cached = descriptionTranslationCache.get(cacheKey);
        if (cached) {
          if (showParagraphTranslation(segment.resultEl, cached.text, segment.text)) {
            translatedCount += 1;
          }
          continue;
        }

        setParagraphTranslationLoading(segment.resultEl);
        try {
          const result = await workshopDeps.TranslateWorkshopDescription(segment.text);
          descriptionTranslationCache.set(cacheKey, result);
          if (showParagraphTranslation(segment.resultEl, result.text, segment.text)) {
            translatedCount += 1;
          }
        } catch (err) {
          failedError = err;
          showParagraphTranslationError(segment.resultEl);
          break;
        }
      }

      if (failedError) {
        workshopDeps.showError?.("翻译失败: " + failedError);
        return;
      }
      workshopDeps.showNotification?.(
        translatedCount > 0 ? "描述翻译完成" : "描述内容已是中文",
        translatedCount > 0 ? "success" : "info"
      );
    } finally {
      setTranslateButtonLoading(button, false);
    }
  });
}

function setTranslateButtonLoading(button, loading) {
  button.disabled = loading;
  button.textContent = "";
  if (loading) {
    const spinner = document.createElement("span");
    spinner.className = "btn-spinner";
    button.appendChild(spinner);
    const label = document.createElement("span");
    label.textContent = "翻译中...";
    button.appendChild(label);
    return;
  }
  button.appendChild(createTranslateIconElement());
  const label = document.createElement("span");
  label.textContent = "翻译描述";
  button.appendChild(label);
}

function createTranslateIconElement() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "icon-svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  ["m5 8 6 6", "m4 14 6-6 2-3", "M2 5h12", "M7 2h1", "m22 22-5-10-5 10", "M14 18h6"].forEach((d) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  });
  return svg;
}

function setParagraphTranslationLoading(resultEl) {
  resultEl.textContent = "";
  resultEl.classList.remove("hidden", "detail-translation-enter", "is-error");
  resultEl.classList.add("is-loading");

  const spinner = document.createElement("span");
  spinner.className = "btn-spinner";
  const label = document.createElement("span");
  label.textContent = "翻译中...";
  resultEl.appendChild(spinner);
  resultEl.appendChild(label);
}

function showParagraphTranslation(resultEl, text, originalText) {
  const translatedText = String(text || "").trim();
  if (
    !translatedText ||
    normalizeTranslationComparable(translatedText) ===
      normalizeTranslationComparable(originalText)
  ) {
    hideParagraphTranslation(resultEl);
    return false;
  }

  resultEl.textContent = translatedText;
  resultEl.classList.remove("hidden", "is-loading", "is-error", "detail-translation-enter");
  void resultEl.offsetWidth;
  resultEl.classList.add("detail-translation-enter");
  return true;
}

function showParagraphTranslationError(resultEl) {
  resultEl.textContent = "这一段翻译失败";
  resultEl.classList.remove("hidden", "is-loading", "detail-translation-enter");
  resultEl.classList.add("is-error");
}

function hideParagraphTranslation(resultEl) {
  resultEl.textContent = "";
  resultEl.classList.add("hidden");
  resultEl.classList.remove("is-loading", "is-error", "detail-translation-enter");
}

function normalizeTranslationComparable(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function descriptionToPlainText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\[url=([^\]]+)\](.*?)\[\/url\]/gis, "$2 ($1)")
    .replace(/\[url\](.*?)\[\/url\]/gis, "$1")
    .replace(/\[img\](.*?)\[\/img\]/gis, "")
    .replace(/\[code\](.*?)\[\/code\]/gis, "$1")
    .replace(/\[quote\](.*?)\[\/quote\]/gis, "\n$1\n")
    .replace(/\[\*\]/g, "\n- ")
    .replace(/\[\/?(?:h1|h2|h3|b|u|i|strike|spoiler|hr|noparse|table|tr|td|th|list|olist|center|left|right|indent|size|color|font)(?:=[^\]]*)?\]/gi, "")
    .replace(/\[\/?[a-zA-Z]+(?:=[^\]]*)?\]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function startDownloadFromBrowser(id) {
  document.getElementById("browser-modal").classList.add("hidden");
  workshopDeps.switchAppPage("downloads");

  const urlInput = document.getElementById("workshop-url");
  urlInput.value = `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`;

  const checkBtn = document.getElementById("check-workshop-btn");
  if (checkBtn) checkBtn.click();
}
