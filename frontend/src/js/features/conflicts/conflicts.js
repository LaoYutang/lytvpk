let EventsOn;
let showError;
let CheckConflicts;
let toggleFile;
let moveFileToAddons;
let conflictProgressRegistered = false;
let isConflictChecking = false;
let isConflictModalVisible = false;
let conflictCheckRunId = 0;

export function configureConflicts(deps) {
  ({ EventsOn, showError, CheckConflicts, toggleFile, moveFileToAddons } = deps);
  registerConflictProgressEvents();
}

let currentConflictResult = null;
let currentSeverityFilter = "critical"; // 默认只显示严重
let currentConflictPage = 1;

const CONFLICT_PAGE_SIZE = 20;

export function showConflictModal() {
  isConflictModalVisible = true;
  document.getElementById("conflict-modal").classList.remove("hidden");
  if (isConflictChecking) {
    document
      .getElementById("conflict-progress-container")
      .classList.remove("hidden");
    return;
  }
  resetConflictModal();
  // 自动开始检测
  startConflictCheck();
}

export function hideConflictModal() {
  isConflictModalVisible = false;
  document.getElementById("conflict-modal").classList.add("hidden");
  currentConflictResult = null;
  document.getElementById("conflict-list").innerHTML = "";
}

function resetConflictModal() {
  document
    .getElementById("conflict-progress-container")
    .classList.add("hidden");
  document.getElementById("conflict-results").classList.add("hidden");
  document.getElementById("conflict-empty").classList.add("hidden");
  // 隐藏开始按钮，因为自动开始
  document.getElementById("start-conflict-check-btn").style.display = "none";
  document.getElementById("conflict-list").innerHTML = "";
  document.getElementById("conflict-progress-bar").style.width = "0%";
  document.getElementById("conflict-progress-text").textContent = "准备开始...";
  currentConflictResult = null;

  // 重置筛选状态
  currentSeverityFilter = "critical";
  currentConflictPage = 1;
  updateFilterButtons();
}

function setConflictChecking(checking) {
  isConflictChecking = checking;

  const startButton = document.getElementById("start-conflict-check-btn");
  if (startButton) {
    startButton.disabled = checking;
    startButton.textContent = checking ? "检测中..." : "开始检测";
  }
}

// 筛选说明文本
const filterDescriptions = {
  critical: "大概率导致客户端崩溃，建议立即处理",
  warning: "可能导致功能异常或显示错误",
  info: "一般性冲突，通常不影响游戏体验",
  all: "显示所有冲突分组",
};

// 更新筛选按钮状态和说明
function updateFilterButtons() {
  document.querySelectorAll(".filter-btn").forEach((btn) => {
    if (btn.dataset.filter === currentSeverityFilter) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
  // 更新说明文本
  const descEl = document.getElementById("conflict-filter-desc");
  if (descEl) {
    descEl.textContent = filterDescriptions[currentSeverityFilter] || "";
  }
}

// 初始化筛选按钮事件
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      currentSeverityFilter = e.target.dataset.filter;
      currentConflictPage = 1;
      updateFilterButtons();
      if (currentConflictResult) {
        renderConflictResults(currentConflictResult);
      }
    });
  });
});

export async function startConflictCheck() {
  if (isConflictChecking) return;

  const runId = ++conflictCheckRunId;
  setConflictChecking(true);

  document
    .getElementById("conflict-progress-container")
    .classList.remove("hidden");
  document.getElementById("conflict-results").classList.add("hidden");
  document.getElementById("conflict-empty").classList.add("hidden");
  document.getElementById("conflict-list").innerHTML = "";
  currentConflictResult = null;

  try {
    const result = await CheckConflicts();
    if (runId !== conflictCheckRunId || !isConflictModalVisible) {
      currentConflictResult = null;
      return;
    }

    currentConflictResult = result;
    currentConflictPage = 1;
    renderConflictResults(result);
  } catch (err) {
    if (runId === conflictCheckRunId && isConflictModalVisible) {
      showError("冲突检测失败: " + err);
      document
        .getElementById("conflict-progress-container")
        .classList.add("hidden");
      document.getElementById("start-conflict-check-btn").style.display = "";
    }
  } finally {
    if (runId === conflictCheckRunId) {
      setConflictChecking(false);
    }
  }
}

function renderConflictResults(result) {
  document
    .getElementById("conflict-progress-container")
    .classList.add("hidden");

  if (!result || result.total_conflicts === 0) {
    document.getElementById("conflict-empty").classList.remove("hidden");
    return;
  }

  document.getElementById("conflict-results").classList.remove("hidden");

  const list = document.getElementById("conflict-list");
  list.innerHTML = "";

  const groups = getFilteredConflictGroups(result);
  document.getElementById("conflict-count").textContent = groups.length;
  renderConflictPagination(groups.length);

  if (groups.length === 0) {
    list.innerHTML =
      '<div class="empty-state"><p>当前筛选条件下无冲突</p></div>';
    return;
  }

  const pageCount = Math.ceil(groups.length / CONFLICT_PAGE_SIZE);
  currentConflictPage = Math.min(Math.max(currentConflictPage, 1), pageCount);

  const start = (currentConflictPage - 1) * CONFLICT_PAGE_SIZE;
  const pageGroups = groups.slice(start, start + CONFLICT_PAGE_SIZE);

  pageGroups.forEach((group) => {
    const groupEl = createConflictGroupElement(group);
    list.appendChild(groupEl);
  });
}

function getFilteredConflictGroups(result) {
  return (result.conflict_groups || []).filter((group) => {
    const severity = group.severity || "info";
    return currentSeverityFilter === "all" || severity === currentSeverityFilter;
  });
}

function createConflictGroupElement(group) {
  const severity = group.severity || "info";
  const files = group.files || [];
  const fileCount = Number(group.file_count ?? files.length);
  const groupEl = document.createElement("div");
  groupEl.className = `conflict-group ${severity}`;

  const vpkListHtml = (group.vpk_files || [])
    .map((vpk) => {
      const displayName = truncateText(vpk.title || vpk.name);
      const fileName = truncateText(vpk.name);
      const isWorkshop = vpk.location === "workshop";
      const btnText = isWorkshop ? "转移" : "禁用";
      const btnClass = isWorkshop ? "btn-transfer" : "btn-disable";
      const title = isWorkshop ? "转移到插件目录后可禁用" : "禁用此Mod";

      return `
        <div class="conflict-vpk-item">
          <div class="conflict-vpk-info">
            <span class="conflict-vpk-title" title="${escapeHtml(vpk.title || vpk.name)}">${escapeHtml(displayName)}</span>
            <span class="conflict-vpk-filename" title="${escapeHtml(vpk.name)}">${escapeHtml(fileName)}</span>
          </div>
          <button
            class="btn btn-small btn-conflict-action ${btnClass}"
            data-path="${escapeHtml(vpk.path)}"
            data-location="${escapeHtml(vpk.location)}"
            title="${title}"
          >
            <span>${btnText}</span>
          </button>
        </div>
      `;
    })
    .join("");

    // 严重程度标签文本
    let severityText = "普通";
    if (severity === "critical") severityText = "严重";
    if (severity === "warning") severityText = "警告";

    groupEl.innerHTML = `
            <div class="conflict-header">
                <div class="conflict-title-section">
                    <div class="conflict-severity-row">
                        <span class="severity-badge ${severity}">${severityText}</span>
                        <span class="conflict-file-count">${fileCount} 个冲突文件</span>
                    </div>
                    <div class="conflict-vpk-names">
                        ${vpkListHtml}
                    </div>
                </div>
            </div>
            <div class="conflict-details">
                <div class="conflict-details-inner"></div>
            </div>
        `;

    // 点击展开/收起
    const header = groupEl.querySelector(".conflict-header");
    const details = groupEl.querySelector(".conflict-details");

    header.addEventListener("click", () => {
      if (!details.classList.contains("expanded")) {
        loadConflictDetails(details, group);
      }
      details.classList.toggle("expanded");
    });

    // 添加禁用/转移按钮点击处理
    groupEl.querySelectorAll(".btn-conflict-action").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation(); // 阻止触发 header click

        const path = btn.dataset.path;
        const location = btn.dataset.location;

        try {
          btn.disabled = true;
          btn.innerHTML = '<span>处理中...</span>';

          if (location === "workshop") {
            // workshop文件需要先转移到插件目录
            await moveFileToAddons(path);
          } else {
            // 其他位置直接禁用
            await toggleFile(path);
          }

          // 刷新冲突检测
          await startConflictCheck();
        } catch (err) {
          showError("操作失败: " + err);
          // 恢复按钮状态
          const isWorkshop = location === "workshop";
          btn.innerHTML = `<span>${isWorkshop ? "转移" : "禁用"}</span>`;
          btn.disabled = false;
        }
      });
    });

  return groupEl;
}

function loadConflictDetails(details, group) {
  if (details.dataset.loaded === "true" || details.dataset.loading === "true") {
    return;
  }

  details.dataset.loading = "true";
  const inner = details.querySelector(".conflict-details-inner");
  inner.innerHTML = '<div class="file-tree-loading">正在加载文件树...</div>';

  requestAnimationFrame(() => {
    const tree = buildTree(group.files || []);
    const fileCount = Number(group.file_count ?? (group.files || []).length);
    const truncatedNote = group.files_truncated
      ? `<div class="file-tree-note">当前仅展示前 ${(group.files || []).length} 个文件，完整冲突数为 ${fileCount} 个。</div>`
      : "";
    inner.innerHTML = `<div class="file-tree">${truncatedNote}${renderTree(tree)}</div>`;
    details.dataset.loaded = "true";
    delete details.dataset.loading;
  });
}

function buildTree(paths) {
  const root = [];

  paths.forEach((path) => {
    const normalizedPath = String(path || "");
    const parts = normalizedPath.replace(/\\/g, "/").split("/").filter(Boolean);
    let currentLevel = root;

    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1;
      let node = currentLevel.find((n) => n.name === part);

      if (!node) {
        node = {
          name: part,
          type: isFile ? "file" : "folder",
          children: [],
          path: isFile ? normalizedPath : null,
        };
        currentLevel.push(node);
      }

      if (!isFile) currentLevel = node.children;
    });
  });

  return root;
}

function renderTree(nodes) {
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return nodes
    .map((node) => {
      if (node.type === "folder") {
        return `
          <div class="tree-folder">
            <div class="tree-folder-name">
              <span class="folder-icon">${folderIconSvg()}</span>
              <span class="tree-node-name">${escapeHtml(node.name)}</span>
            </div>
            <div class="tree-children">
              ${renderTree(node.children)}
            </div>
          </div>
        `;
      }

      const category = getFileCategory(node.path);
      return `
        <div class="tree-file">
          <span class="file-tag ${category.className}">${category.label}</span>
          <span class="tree-node-name">${escapeHtml(node.name)}</span>
        </div>
      `;
    })
    .join("");
}

function renderConflictPagination(totalCount) {
  let pagination = document.getElementById("conflict-pagination");

  if (!pagination) {
    const toolbar = document.querySelector("#conflict-results .conflict-toolbar");
    pagination = document.createElement("div");
    pagination.id = "conflict-pagination";
    pagination.className = "conflict-pagination";
    toolbar?.appendChild(pagination);
  }

  const pageCount = Math.ceil(totalCount / CONFLICT_PAGE_SIZE);
  if (pageCount <= 1) {
    pagination.classList.add("hidden");
    pagination.innerHTML = "";
    return;
  }

  currentConflictPage = Math.min(Math.max(currentConflictPage, 1), pageCount);

  const visiblePages = getVisiblePageNumbers(currentConflictPage, pageCount);
  const start = (currentConflictPage - 1) * CONFLICT_PAGE_SIZE + 1;
  const end = Math.min(currentConflictPage * CONFLICT_PAGE_SIZE, totalCount);

  pagination.classList.remove("hidden");
  pagination.innerHTML = `
    <div class="conflict-pagination-info">${start}-${end} / ${totalCount}</div>
    <div class="conflict-pagination-controls">
      <button class="conflict-page-btn" data-page="${currentConflictPage - 1}" ${currentConflictPage === 1 ? "disabled" : ""}>上一页</button>
      ${visiblePages
        .map((page) =>
          page === "..."
            ? '<span class="conflict-page-ellipsis">...</span>'
            : `<button class="conflict-page-btn ${page === currentConflictPage ? "active" : ""}" data-page="${page}">${page}</button>`,
        )
        .join("")}
      <button class="conflict-page-btn" data-page="${currentConflictPage + 1}" ${currentConflictPage === pageCount ? "disabled" : ""}>下一页</button>
    </div>
  `;

  pagination.querySelectorAll(".conflict-page-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const page = Number(btn.dataset.page);
      if (!page || page === currentConflictPage) return;

      currentConflictPage = Math.min(Math.max(page, 1), pageCount);
      renderConflictResults(currentConflictResult);
    });
  });
}

function getVisiblePageNumbers(currentPage, pageCount) {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const pages = [1];
  const start = Math.max(2, currentPage - 1);
  const end = Math.min(pageCount - 1, currentPage + 1);

  if (start > 2) pages.push("...");
  for (let page = start; page <= end; page++) pages.push(page);
  if (end < pageCount - 1) pages.push("...");

  pages.push(pageCount);
  return pages;
}

function truncateText(text, maxLen = 25) {
  if (!text || text.length <= maxLen) return text || "";
  return text.substring(0, maxLen - 2) + "..";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[char];
  });
}

function registerConflictProgressEvents() {
  if (conflictProgressRegistered || !EventsOn) return;
  conflictProgressRegistered = true;
  EventsOn("conflict_check_progress", (progress) => {
    const bar = document.getElementById("conflict-progress-bar");
    const text = document.getElementById("conflict-progress-text");
  
    if (bar && text) {
      if (progress.total > 0) {
        const percent = (progress.current / progress.total) * 100;
        bar.style.width = percent + "%";
      }
      text.textContent = progress.message;
    }
  });
}

function folderIconSvg() {
  return `<svg class="tree-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7h7l2 2h9v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"></path><path d="M3 7V5a2 2 0 0 1 2-2h4l2 2h4"></path></svg>`;
}

function getFileCategory(filePath) {
  const lower = filePath.toLowerCase().replace(/\\/g, "/");

  // 🔴 严重 (Critical)
  if (lower === "particles/particles_manifest.txt") {
    return { label: "全局特效", className: "tag-critical" };
  }
  if (lower === "scripts/soundmixers.txt") {
    return { label: "全局混音", className: "tag-critical" };
  }
  if (lower.endsWith(".bsp")) {
    return { label: "地图文件", className: "tag-critical" };
  }
  if (lower.endsWith(".nav")) {
    return { label: "导航网格", className: "tag-critical" };
  }
  if (lower.startsWith("missions/") && lower.endsWith(".txt")) {
    return { label: "任务脚本", className: "tag-critical" };
  }
  if (lower.startsWith("scripts/") && lower.endsWith(".txt")) {
    if (lower.startsWith("scripts/vscripts/")) {
      return { label: "VScript", className: "tag-warning" };
    }
    return { label: "核心脚本", className: "tag-critical" };
  }

  // 🟡 告警 (Warning)
  if (lower === "sound/sound.cache") {
    return { label: "音频缓存", className: "tag-warning" };
  }
  if (lower.endsWith(".phy")) {
    return { label: "物理模型", className: "tag-warning" };
  }
  if (lower.startsWith("resource/") && lower.endsWith(".res")) {
    return { label: "界面资源", className: "tag-warning" };
  }
  if (lower.startsWith("scripts/vscripts/")) {
    return { label: "VScript", className: "tag-warning" };
  }
  if (
    lower.endsWith(".vscript") ||
    lower.endsWith(".nut") ||
    lower.endsWith(".nuc")
  ) {
    return { label: "VScript", className: "tag-warning" };
  }
  if (lower.endsWith(".db")) {
    return { label: "数据库", className: "tag-warning" };
  }
  if (lower.endsWith(".vtx") || lower.endsWith(".vvd")) {
    return { label: "模型数据", className: "tag-warning" };
  }
  if (lower.endsWith(".ttf") || lower.endsWith(".otf")) {
    return { label: "字体文件", className: "tag-warning" };
  }

  // 🟢 一般 (Info)
  if (lower.endsWith(".vtf")) {
    return { label: "纹理", className: "tag-info" };
  }
  if (lower.endsWith(".vmt")) {
    return { label: "材质", className: "tag-info" };
  }
  if (lower.endsWith(".mdl")) {
    return { label: "模型", className: "tag-info" };
  }
  if (lower.endsWith(".wav") || lower.endsWith(".mp3")) {
    return { label: "音频", className: "tag-info" };
  }
  if (lower.endsWith(".cfg")) {
    return { label: "配置", className: "tag-info" };
  }

  return { label: "其他", className: "tag-info" };
}
