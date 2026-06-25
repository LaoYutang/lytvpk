export async function renderDiagnosticsPage({
  GetProblemModScanSession,
  openProblemModScanIntro,
  openModelStatsScanModal,
  showConflictModal,
  openVPKUnpackTool,
  openMDMPReportTool,
  openVPKPackTool,
  refreshFilesKeepFilter,
} = {}) {
  const container = document.getElementById("diagnostics-page-content");
  if (!container) return;

  let problemScanSession = null;
  try {
    problemScanSession = GetProblemModScanSession
      ? await GetProblemModScanSession()
      : null;
  } catch (error) {
    console.warn("读取问题 Mod 查找状态失败:", error);
  }

  const problemScanActive = Boolean(problemScanSession?.active);

  container.innerHTML = `
    <div class="diagnostics-page-shell toolbox-page-shell">
      <div class="diagnostics-page-header">
        <div>
          <h2>工具箱</h2>
          <p>集中放置 Mod 排查、状态验证和常用维护工具。</p>
        </div>
      </div>

      <section class="toolbox-section">
        <div class="toolbox-section-header">
          <h3>诊断工具</h3>
          <p>用于排查 Mod 问题、冲突和资源状态。</p>
        </div>
        <div class="diagnostics-tool-grid">
          <section class="diagnostics-tool-card">
            <div class="diagnostics-tool-icon">${boltIcon()}</div>
            <div class="diagnostics-tool-main">
              <div class="diagnostics-tool-title-row">
                <h3>问题 Mod 查找</h3>
                <span class="diagnostics-status ${problemScanActive ? "is-active" : ""}">
                  ${problemScanActive ? "查找中" : "待开始"}
                </span>
              </div>
              <p>按二分法保留当前测试半区，逐轮缩小单个问题 Mod 的范围。</p>
              ${
                problemScanActive
                  ? `<div class="diagnostics-inline-status">第 ${problemScanSession.round || 1} 轮，剩余 ${problemScanSession.currentCandidates?.length || 0} 个候选</div>`
                  : ""
              }
            </div>
            <button type="button" class="btn btn-primary diagnostics-tool-action" id="diagnostics-problem-scan-btn">
              ${problemScanActive ? "继续查找" : "打开查找工具"}
            </button>
          </section>

          <section class="diagnostics-tool-card">
            <div class="diagnostics-tool-icon is-warning">${conflictIcon()}</div>
            <div class="diagnostics-tool-main">
              <div class="diagnostics-tool-title-row">
                <h3>Mod 冲突检测</h3>
                <span class="diagnostics-status">可检测</span>
              </div>
              <p>扫描当前 Mod 文件覆盖关系，按严重程度查看可能冲突的文件组。</p>
            </div>
            <button type="button" class="btn btn-primary diagnostics-tool-action" id="diagnostics-conflict-check-btn">
              开始检测
            </button>
          </section>

          <section class="diagnostics-tool-card">
            <div class="diagnostics-tool-icon is-model">${modelIcon()}</div>
            <div class="diagnostics-tool-main">
              <div class="diagnostics-tool-title-row">
                <h3>Mod 模型面数检测 <span class="diagnostics-beta-badge">Beta</span></h3>
                <span class="diagnostics-status">可检测</span>
              </div>
              <p>读取启用和创意工坊 Mod 内模型的 LOD0 顶点数与三角形数量，快速定位高面数资源。</p>
            </div>
            <button type="button" class="btn btn-primary diagnostics-tool-action" id="diagnostics-model-stats-btn">
              打开检测工具
            </button>
          </section>
        </div>
      </section>

      <section class="toolbox-section">
        <div class="toolbox-section-header">
          <h3>通用工具</h3>
          <p>用于处理单个 VPK 文件和常见文件维护操作。</p>
        </div>
        <div class="diagnostics-tool-grid">
          <section class="diagnostics-tool-card">
            <div class="diagnostics-tool-icon is-general">${unpackIcon()}</div>
            <div class="diagnostics-tool-main">
              <div class="diagnostics-tool-title-row">
                <h3>VPK 解包</h3>
                <span class="diagnostics-status">可使用</span>
              </div>
              <p>选择一个系统中的 VPK 文件，再选择目标位置，按 VPK 内部目录结构解包到同名文件夹。</p>
            </div>
            <button type="button" class="btn btn-primary diagnostics-tool-action" id="toolbox-vpk-unpack-btn">
              选择并解包
            </button>
          </section>

          <section class="diagnostics-tool-card">
            <div class="diagnostics-tool-icon is-general">${packIcon()}</div>
            <div class="diagnostics-tool-main">
              <div class="diagnostics-tool-title-row">
                <h3>VPK 打包</h3>
                <span class="diagnostics-status">可使用</span>
              </div>
              <p>选择一个目录（VPK 根目录，即 materials/scripts 等的父目录），打包为 .vpk 文件，可放入 addons 或自选位置。</p>
            </div>
            <button type="button" class="btn btn-primary diagnostics-tool-action" id="toolbox-vpk-pack-btn">
              选择并打包
            </button>
          </section>
        </div>
      </section>
    </div>
  `;

  appendMDMPReportTool(container, openMDMPReportTool);

  document
    .getElementById("diagnostics-problem-scan-btn")
    ?.addEventListener("click", () => {
      openProblemModScanIntro?.();
    });

  document
    .getElementById("diagnostics-conflict-check-btn")
    ?.addEventListener("click", () => {
      showConflictModal?.();
    });

  document
    .getElementById("diagnostics-model-stats-btn")
    ?.addEventListener("click", () => {
      openModelStatsScanModal?.();
    });

  document
    .getElementById("toolbox-vpk-unpack-btn")
    ?.addEventListener("click", () => {
      openVPKUnpackTool?.();
    });

  document
    .getElementById("toolbox-vpk-pack-btn")
    ?.addEventListener("click", () => {
      openVPKPackTool?.({ refreshFilesKeepFilter });
    });
}

function boltIcon() {
  return `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2 4 14h7l-1 8 10-12h-7l1-8z"/></svg>`;
}

function conflictIcon() {
  return `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.6 2.5 18a2 2 0 0 0 1.8 3h15.4a2 2 0 0 0 1.8-3L13.7 3.6a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`;
}

function modelIcon() {
  return `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 7.2v9.6L12 21l8-4.2V7.2L12 3Z"/><path d="m4 7.2 8 4.2 8-4.2"/><path d="M12 11.4V21"/><path d="m8.2 5.2 8 4.2"/></svg>`;
}

function unpackIcon() {
  return `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>`;
}

function appendMDMPReportTool(container, openMDMPReportTool) {
  const grids = container.querySelectorAll(".diagnostics-tool-grid");
  const diagnosticsGrid = grids[0];
  if (!diagnosticsGrid) return;

  const card = document.createElement("section");
  card.className = "diagnostics-tool-card";

  const icon = document.createElement("div");
  icon.className = "diagnostics-tool-icon is-dump";
  icon.appendChild(createDumpIcon());

  const main = document.createElement("div");
  main.className = "diagnostics-tool-main";
  const row = document.createElement("div");
  row.className = "diagnostics-tool-title-row";
  const title = document.createElement("h3");
  title.textContent = "崩溃转储查看器";
  const status = document.createElement("span");
  status.className = "diagnostics-status";
  status.textContent = "可解析";
  row.append(title, status);
  const desc = document.createElement("p");
  desc.textContent =
    "选择 .mdmp 或 .dmp 文件，查看异常、线程、模块、内存范围和原始 stream 信息。";
  main.append(row, desc);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-primary diagnostics-tool-action";
  button.textContent = "选择并查看";
  button.addEventListener("click", () => openMDMPReportTool?.());

  card.append(icon, main, button);
  diagnosticsGrid.appendChild(card);
}

function createDumpIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "icon-svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.3");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  [
    [
      "path",
      { d: "M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" },
    ],
    ["path", { d: "M14 2v5h5" }],
    ["path", { d: "M8 13h8" }],
    ["path", { d: "M8 17h5" }],
    ["path", { d: "M9 9h1" }],
  ].forEach(([tag, attrs]) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attrs).forEach(([key, value]) =>
      node.setAttribute(key, value)
    );
    svg.appendChild(node);
  });
  return svg;
}

function packIcon() {
  return `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v8"/><path d="m9 7 3 3 3-3"/><path d="M3 14h18"/><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>`;
}
