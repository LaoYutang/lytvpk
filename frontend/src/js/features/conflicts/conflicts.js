let EventsOn;
let showError;
let CheckConflicts;
let conflictProgressRegistered = false;

export function configureConflicts(deps) {
  ({ EventsOn, showError, CheckConflicts } = deps);
  registerConflictProgressEvents();
}

let currentConflictResult = null;
let currentSeverityFilter = "critical"; // 默认只显示严重

export function showConflictModal() {
  document.getElementById("conflict-modal").classList.remove("hidden");
  resetConflictModal();
  // 自动开始检测
  startConflictCheck();
}

export function hideConflictModal() {
  document.getElementById("conflict-modal").classList.add("hidden");
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

  // 重置筛选状态
  currentSeverityFilter = "critical";
  updateFilterButtons();
}

// 更新筛选按钮状态
function updateFilterButtons() {
  document.querySelectorAll(".filter-btn").forEach((btn) => {
    if (btn.dataset.filter === currentSeverityFilter) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
}

// 初始化筛选按钮事件
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      currentSeverityFilter = e.target.dataset.filter;
      updateFilterButtons();
      if (currentConflictResult) {
        renderConflictResults(currentConflictResult);
      }
    });
  });
});

export async function startConflictCheck() {
  document
    .getElementById("conflict-progress-container")
    .classList.remove("hidden");
  document.getElementById("conflict-results").classList.add("hidden");
  document.getElementById("conflict-empty").classList.add("hidden");

  try {
    const result = await CheckConflicts();
    currentConflictResult = result;
    renderConflictResults(result);
  } catch (err) {
    showError("冲突检测失败: " + err);
    // 出错时显示关闭按钮即可
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
  document.getElementById("conflict-count").textContent =
    result.total_conflicts;

  const list = document.getElementById("conflict-list");
  list.innerHTML = "";

  // 过滤并渲染
  let displayedCount = 0;
  result.conflict_groups.forEach((group) => {
    const severity = group.severity || "info";

    // 筛选逻辑
    if (currentSeverityFilter !== "all" && severity !== currentSeverityFilter) {
      return;
    }

    displayedCount++;
    const groupEl = document.createElement("div");
    // 添加严重程度 class
    groupEl.className = `conflict-group ${severity}`;

    // 生成垂直排列的文件名列表
    const vpkListHtml = group.vpk_files
      .map((name) => `<div>${name}</div>`)
      .join("");

    // 严重程度标签文本
    let severityText = "普通";
    if (severity === "critical") severityText = "严重";
    if (severity === "warning") severityText = "警告";

    groupEl.innerHTML = `
            <div class="conflict-header">
                <div class="conflict-title-section">
                    <span class="severity-badge ${severity}">${severityText}</span>
                    <div class="conflict-vpk-names">
                        ${vpkListHtml}
                    </div>
                </div>
                <div class="conflict-file-count">${
                  group.files.length
                } 个冲突文件</div>
            </div>
            <div class="conflict-details">
                ${(() => {
                  // 构建文件树
                  const buildTree = (paths) => {
                    const root = [];
                    paths.forEach((path) => {
                      const parts = path.replace(/\\/g, "/").split("/");
                      let currentLevel = root;
                      parts.forEach((part, index) => {
                        const isFile = index === parts.length - 1;
                        let node = currentLevel.find((n) => n.name === part);
                        if (!node) {
                          node = {
                            name: part,
                            type: isFile ? "file" : "folder",
                            children: [],
                            path: isFile ? path : null,
                          };
                          currentLevel.push(node);
                        }
                        if (!isFile) currentLevel = node.children;
                      });
                    });
                    return root;
                  };

                  // 递归渲染树
                  const renderTree = (nodes) => {
                    // 排序：文件夹在前，文件在后，按名称排序
                    nodes.sort((a, b) => {
                      if (a.type !== b.type)
                        return a.type === "folder" ? -1 : 1;
                      return a.name.localeCompare(b.name);
                    });

                    return nodes
                      .map((node) => {
                        if (node.type === "folder") {
                          return `
                                    <div class="tree-folder">
                                        <div class="tree-folder-name">
                                            <span class="folder-icon">📁</span> ${
                                              node.name
                                            }
                                        </div>
                                        <div class="tree-children">
                                            ${renderTree(node.children)}
                                        </div>
                                    </div>
                                `;
                        } else {
                          const category = getFileCategory(node.path);
                          return `
                                    <div class="tree-file">
                                        <span class="file-tag ${category.className}">${category.label}</span> ${node.name}
                                    </div>
                                `;
                        }
                      })
                      .join("");
                  };

                  const tree = buildTree(group.files);
                  return `<div class="file-tree">${renderTree(tree)}</div>`;
                })()}
            </div>
        `;

    // 点击展开/收起
    const header = groupEl.querySelector(".conflict-header");
    const details = groupEl.querySelector(".conflict-details");

    header.addEventListener("click", () => {
      details.classList.toggle("expanded");
    });

    list.appendChild(groupEl);
  });

  // 如果筛选后没有结果
  if (displayedCount === 0) {
    list.innerHTML =
      '<div class="empty-state"><p>当前筛选条件下无冲突</p></div>';
  }
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
