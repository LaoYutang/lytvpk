export async function renderDiagnosticsPage({
  GetProblemModScanSession,
  openProblemModScanIntro,
  showConflictModal,
} = {}) {
  const container = document.getElementById("diagnostics-page-content");
  if (!container) return;

  let problemScanSession = null;
  try {
    problemScanSession = GetProblemModScanSession ? await GetProblemModScanSession() : null;
  } catch (error) {
    console.warn("读取问题 Mod 查找状态失败:", error);
  }

  const problemScanActive = Boolean(problemScanSession?.active);

  container.innerHTML = `
    <div class="diagnostics-page-shell">
      <div class="diagnostics-page-header">
        <div>
          <h2>诊断工具</h2>
          <p>集中处理 Mod 排查、冲突检测和状态验证。</p>
        </div>
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
      </div>
    </div>
  `;

  document.getElementById("diagnostics-problem-scan-btn")?.addEventListener("click", () => {
    openProblemModScanIntro?.();
  });

  document.getElementById("diagnostics-conflict-check-btn")?.addEventListener("click", () => {
    showConflictModal?.();
  });
}

function boltIcon() {
  return `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2 4 14h7l-1 8 10-12h-7l1-8z"/></svg>`;
}

function conflictIcon() {
  return `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.6 2.5 18a2 2 0 0 0 1.8 3h15.4a2 2 0 0 0 1.8-3L13.7 3.6a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`;
}
