import { bindFileActionData, createTextElement } from "../../core/utils.js";

let selectedPath = "";
let findFileByPath = () => null;

export function initModInfoPanel(options = {}) {
  findFileByPath = options.findFileByPath || findFileByPath;

  const list = document.getElementById("file-list");
  if (list && !list.dataset.modPanelBound) {
    list.dataset.modPanelBound = "true";
    list.addEventListener("click", (event) => {
      if (
        event.target.closest("button") ||
        event.target.closest("input") ||
        event.target.closest(".dropdown-content")
      ) {
        return;
      }

      const item = event.target.closest(".file-item, .file-card");
      if (!item?.dataset.path) return;
      selectModFile(item.dataset.path);
    });
  }

  renderModInfoPanel(null);
}

export function selectModFile(filePath) {
  selectedPath = filePath || "";
  const file = selectedPath ? findFileByPath(selectedPath) : null;
  renderModInfoPanel(file);
  syncSelectedRow();
}

export function refreshModInfoPanel() {
  const file = selectedPath ? findFileByPath(selectedPath) : null;
  renderModInfoPanel(file);
  syncSelectedRow();
}

export function renderModInfoPanel(file) {
  const panel = document.getElementById("mod-info-panel");
  if (!panel) return;

  if (!file) {
    panel.innerHTML = `
      <div class="mod-info-empty">
        <div class="mod-info-empty-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
        </div>
        <h3>选择一个 VPK</h3>
        <p>文件信息和可用操作会显示在这里。</p>
      </div>
    `;
    return;
  }

  const hidden = file.name?.startsWith("_");
  const firstAction = file.location === "workshop"
    ? `<button class="panel-action move-btn primary" data-file-path data-action="move">转移</button>`
    : `<button class="panel-action toggle-btn primary" data-file-path data-action="toggle">${file.enabled ? "禁用" : "启用"}</button>`;

  panel.innerHTML = `
    <div class="mod-info-card">
      <div class="mod-info-header">
        <div class="mod-file-icon"></div>
        <div class="mod-info-title-wrap">
          <h3></h3>
          <span class="mod-info-status ${file.enabled ? "enabled" : "disabled"}">${file.enabled ? "已启用" : "已禁用"}</span>
        </div>
      </div>

      <div class="mod-info-section">
        <h4>基本信息</h4>
      </div>

      <div class="mod-info-section">
        <h4>标签</h4>
        <div class="mod-info-tags"></div>
      </div>

      <div class="mod-info-section">
        <h4>快捷操作</h4>
        <div class="mod-panel-actions">
          ${firstAction}
          ${file.workshopId ? `<button class="panel-action workshop-btn" data-file-path data-workshop-id>查看工坊</button>` : ""}
          <button class="panel-action open-location-btn" data-file-path data-action="open-location">打开目录</button>
          <button class="panel-action set-tags-btn" data-file-path data-action="set-tags">设置标签</button>
          <button class="panel-action rename-btn" data-file-path data-action="rename">重命名</button>
          <button class="panel-action load-order-btn" data-file-path data-action="load-order">加载顺序</button>
          <button class="panel-action hide-btn" data-file-path data-action="hide">${hidden ? "取消隐藏" : "隐藏文件"}</button>
          <button class="panel-action delete-btn danger" data-file-path data-action="delete">删除文件</button>
        </div>
      </div>
    </div>
  `;

  const title = panel.querySelector(".mod-info-title-wrap h3");
  title.textContent = file.title || file.name || "";
  title.title = title.textContent;
  panel.querySelector(".mod-file-icon").textContent = getLocationGlyph(file.location);

  const info = panel.querySelector(".mod-info-section");
  info.append(
    infoRow("文件名", file.name || ""),
    infoRow("大小", formatFileSize(file.size)),
    infoRow("位置", getLocationName(file.location)),
    infoRow("最后修改", file.lastModified || "N/A")
  );
  if (file.workshopId) info.appendChild(infoRow("工坊 ID", file.workshopId));
  info.appendChild(infoRow("路径", file.path || "", "path"));

  const tags = panel.querySelector(".mod-info-tags");
  if (file.primaryTag) tags.appendChild(createTextElement("span", "tag primary-tag", file.primaryTag));
  for (const tag of file.secondaryTags || []) {
    tags.appendChild(createTextElement("span", "tag secondary-tag", tag));
  }
  if (!tags.childElementCount) tags.appendChild(createTextElement("span", "tag muted", "未设置"));
  bindFileActionData(panel, file);
}

function syncSelectedRow() {
  document.querySelectorAll(".file-item, .file-card").forEach((item) => {
    item.classList.toggle("active-inspect", item.dataset.path === selectedPath);
  });
}

function infoRow(label, value, variant = "") {
  const row = document.createElement("div");
  row.className = variant ? `mod-info-row ${variant}` : "mod-info-row";
  const strong = createTextElement("strong", "", value);
  strong.title = value;
  row.append(createTextElement("span", "", label), " ", strong);
  return row;
}

function formatFileSize(bytes) {
  if (!bytes) return "N/A";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function getLocationName(location) {
  const names = {
    root: "根目录",
    workshop: "创意工坊",
    disabled: "已禁用",
  };
  return names[location] || location || "未知";
}

function getLocationGlyph(location) {
  const glyphs = {
    root: "✓",
    workshop: "▦",
    disabled: "−",
  };
  return glyphs[location] || "•";
}
