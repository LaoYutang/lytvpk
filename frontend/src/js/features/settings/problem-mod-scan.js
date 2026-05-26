import {
  GetProblemModScanSession,
  LaunchL4D2ForProblemScan,
  RestoreProblemModScan,
  StartProblemModScan,
  SubmitProblemModScanResult,
} from "../../../../wailsjs/go/app/App";
import { showError, showNotification } from "../../core/toast.js";
import { refreshFilesKeepFilter } from "../file-list/filters.js";

let activeSession = null;

export async function initProblemModScanAutoRestore() {
  try {
    const session = await GetProblemModScanSession();
    if (session?.active) {
      renderActiveSession(session, { resumed: true });
    }
  } catch (error) {
    console.warn("恢复问题 Mod 查找会话失败:", error);
  }
}

export async function openProblemModScanIntro() {
  try {
    const session = await GetProblemModScanSession();
    if (session?.active) {
      renderActiveSession(session);
      return;
    }
  } catch (error) {
    console.warn("读取问题 Mod 查找会话失败:", error);
  }

  activeSession = null;
  const modal = getModal();
  setModalMode("intro");
  setTitle("问题 Mod 查找");

  getBody().innerHTML = `
    <div class="problem-scan-intro">
      <div class="problem-scan-hero">
        <div class="problem-scan-hero-icon" aria-hidden="true">${boltIcon()}</div>
        <div>
          <h3>用二分法缩小问题 Mod 范围</h3>
          <p>工具会记录当前启用列表，每轮只保留当前测试半区在根目录中，让你进游戏验证问题是否还存在，然后继续缩小候选范围。</p>
        </div>
      </div>
      <div class="problem-scan-note-grid">
        <section class="problem-scan-note">
          <span class="problem-scan-note-icon">${checkIcon()}</span>
          <div>
            <h4>适合的情况</h4>
            <p>单个根目录 Mod 导致客户端崩溃、贴图异常、数据混乱或其他可复现问题。</p>
          </div>
        </section>
        <section class="problem-scan-note">
          <span class="problem-scan-note-icon">${folderIcon()}</span>
          <div>
            <h4>参与范围</h4>
            <p>只处理 addons 根目录中当前已启用的 VPK；创意工坊目录和 disabled 目录中的文件不会参与。</p>
          </div>
        </section>
        <section class="problem-scan-note">
          <span class="problem-scan-note-icon">${alertIcon()}</span>
          <div>
            <h4>结果边界</h4>
            <p>多个 Mod 组合冲突、随机复现、服务器脚本或游戏本体问题可能无法准确定位。</p>
          </div>
        </section>
        <section class="problem-scan-note">
          <span class="problem-scan-note-icon">${lockIcon()}</span>
          <div>
            <h4>查找期间</h4>
            <p>开始后弹框不能直接关闭。退出查找模式会先恢复开始前的启用列表，避免误改你的 Mod 状态。</p>
          </div>
        </section>
      </div>
      <div class="problem-scan-warning">
        每轮切换 Mod 前请确认游戏已关闭；切换完成后再启动游戏验证。
      </div>
    </div>
  `;

  getFooter().innerHTML = `
    <button type="button" class="btn btn-secondary" id="problem-scan-intro-cancel">稍后再说</button>
    <button type="button" class="btn btn-primary" id="problem-scan-start">开始查找</button>
  `;

  document.getElementById("problem-scan-intro-cancel")?.addEventListener("click", hideModal);
  document.getElementById("problem-scan-start")?.addEventListener("click", startProblemScan);
  modal.classList.remove("hidden");
}

async function startProblemScan() {
  const startBtn = document.getElementById("problem-scan-start");
  setButtonPending(startBtn, "正在准备...");
  try {
    const session = await StartProblemModScan();
    await safeRefreshFiles();
    if (session?.status === "found") {
      renderFoundSession(session);
    } else {
      renderActiveSession(session);
    }
  } catch (error) {
    showError("开始查找失败: " + error);
    setButtonReady(startBtn, "开始查找");
  }
}

function renderActiveSession(session, options = {}) {
  activeSession = session;
  const modal = getModal();
  const disabledNames = new Set((session.currentDisabled || []).map((item) => item.name));
  const candidateCount = session.currentCandidates?.length || 0;
  const appliedDisabled = getAppliedDisabled(session);
  const disabledCount = appliedDisabled.length;
  const enabledCandidates = session.currentEnabled || [];

  setModalMode("active");
  setTitle(options.resumed ? "继续问题 Mod 查找" : "问题 Mod 查找中");
  getBody().innerHTML = `
    <div class="problem-scan-active">
      <div class="problem-scan-progress">
        <div class="problem-scan-stat">
          <span>当前轮次</span>
          <strong>${session.round || 1}</strong>
        </div>
        <div class="problem-scan-stat">
          <span>候选 Mod</span>
          <strong>${candidateCount}</strong>
        </div>
        <div class="problem-scan-stat">
          <span>当前已禁用</span>
          <strong>${disabledCount}</strong>
        </div>
      </div>
      <div class="problem-scan-round-card">
        <div class="problem-scan-round-title">
          <div>
            <h3>当前测试列表</h3>
            <p id="problem-scan-list-desc">默认显示当前仍留在根目录中参与验证的 Mod；点击显示全部候选可查看本轮二分状态。</p>
          </div>
          <button type="button" class="btn btn-small btn-outline problem-scan-toggle-list" id="problem-scan-toggle-candidates">
            显示全部候选
          </button>
        </div>
        <div class="problem-scan-candidate-list" id="problem-scan-candidate-list">
          ${renderCandidateList(enabledCandidates, disabledNames)}
        </div>
      </div>
      <div class="problem-scan-actions">
        <button type="button" class="btn btn-primary" id="problem-scan-launch">${playIcon()}<span>启动 L4D2 验证</span></button>
        <button type="button" class="btn btn-outline" id="problem-scan-tested">我已完成验证</button>
      </div>
      <div class="problem-scan-feedback hidden" id="problem-scan-feedback">
        <label class="problem-scan-closed-check">
          <input type="checkbox" id="problem-scan-game-closed">
          <span>我确认 Left 4 Dead 2 已关闭，可以继续切换 Mod 状态</span>
        </label>
        <div class="problem-scan-result-actions">
          <button type="button" class="btn btn-primary problem-scan-result-btn" data-result="still_exists" disabled>问题还在</button>
          <button type="button" class="btn btn-success problem-scan-result-btn" data-result="gone" disabled>问题不见了</button>
          <button type="button" class="btn btn-secondary" id="problem-scan-exit" disabled>退出查找模式</button>
        </div>
      </div>
    </div>
  `;
  getFooter().innerHTML = `<div class="problem-scan-footer-hint">查找模式进行中，弹框会保持打开以保护当前排查状态。</div>`;

  document.getElementById("problem-scan-launch")?.addEventListener("click", launchProblemScanGame);
  document.getElementById("problem-scan-tested")?.addEventListener("click", showProblemScanFeedback);
  document.getElementById("problem-scan-toggle-candidates")?.addEventListener("click", () => {
    toggleProblemScanCandidateList(session, disabledNames);
  });
  document.getElementById("problem-scan-game-closed")?.addEventListener("change", syncProblemScanFeedbackButtons);
  document.querySelectorAll(".problem-scan-result-btn").forEach((button) => {
    button.addEventListener("click", () => submitProblemScanResult(button.dataset.result, button));
  });
  document.getElementById("problem-scan-exit")?.addEventListener("click", exitProblemScan);

  modal.classList.remove("hidden");
  if (options.resumed) {
    showNotification("已恢复未完成的问题 Mod 查找", "info");
  }
}

function renderFoundSession(session) {
  activeSession = null;
  const suspect = session.suspiciousMod;
  setModalMode("found");
  setTitle("已找到可疑 Mod");
  getBody().innerHTML = `
    <div class="problem-scan-found">
      <div class="problem-scan-found-icon">${checkIcon()}</div>
      <h3>${suspect ? escapeHtml(displayName(suspect)) : "已缩小到最后一个候选"}</h3>
      ${suspect ? `<p class="problem-scan-found-path">${escapeHtml(suspect.name)}</p>` : ""}
      <p>已恢复查找开始前的启用列表。这个结果基于单个 Mod 导致问题的假设；如果问题仍不稳定，可能是组合冲突或非 Mod 原因。</p>
    </div>
  `;
  getFooter().innerHTML = `<button type="button" class="btn btn-primary" id="problem-scan-finish">完成</button>`;
  document.getElementById("problem-scan-finish")?.addEventListener("click", hideModal);
  getModal().classList.remove("hidden");
}

function toggleProblemScanCandidateList(session, disabledNames) {
  const list = document.getElementById("problem-scan-candidate-list");
  const button = document.getElementById("problem-scan-toggle-candidates");
  const desc = document.getElementById("problem-scan-list-desc");
  if (!list || !button) return;

  const showingAll = list.dataset.showingAll === "true";
  if (showingAll) {
    list.dataset.showingAll = "false";
    list.innerHTML = renderCandidateList(session.currentEnabled || [], disabledNames);
    button.textContent = "显示全部候选";
    if (desc) desc.textContent = "默认显示当前仍留在根目录中参与验证的 Mod；点击显示全部候选可查看本轮二分状态。";
  } else {
    list.dataset.showingAll = "true";
    list.innerHTML = renderCandidateList(session.currentCandidates || [], disabledNames);
    button.textContent = "只看当前启用";
    if (desc) desc.textContent = "当前显示本轮候选；带“本轮禁用测试”标记的 Mod 已移入 disabled，已排除的其他 Mod 也会保持禁用。";
  }
}

function renderCandidateList(items, disabledNames) {
  if (!items || items.length === 0) {
    return `<div class="problem-scan-empty-list">当前没有可显示的 Mod</div>`;
  }
  return items.map((item) => renderCandidateItem(item, disabledNames.has(item.name))).join("");
}

function renderCandidateItem(item, disabled) {
  const tags = [item.primaryTag, ...(item.secondaryTags || [])].filter(Boolean).slice(0, 4);
  return `
    <div class="problem-scan-candidate ${disabled ? "is-disabled-round" : ""}">
      <div class="problem-scan-candidate-main">
        <span class="problem-scan-candidate-name">${escapeHtml(displayName(item))}</span>
        <span class="problem-scan-candidate-file">${escapeHtml(item.name || "")}</span>
      </div>
      <div class="problem-scan-candidate-meta">
        ${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
        <strong>${disabled ? "本轮禁用测试" : "当前启用测试"}</strong>
      </div>
    </div>
  `;
}

async function launchProblemScanGame() {
  try {
    await LaunchL4D2ForProblemScan();
    showNotification("正在启动 Left 4 Dead 2...", "success");
  } catch (error) {
    showError("启动游戏失败: " + error);
  }
}

function showProblemScanFeedback() {
  document.querySelector(".problem-scan-active")?.classList.add("is-feedback-open");
  const feedback = document.getElementById("problem-scan-feedback");
  feedback?.classList.remove("hidden");
  document.getElementById("problem-scan-tested")?.setAttribute("disabled", "true");
}

function syncProblemScanFeedbackButtons() {
  const checked = Boolean(document.getElementById("problem-scan-game-closed")?.checked);
  document.querySelectorAll(".problem-scan-result-btn").forEach((button) => {
    button.disabled = !checked;
  });
  const exitBtn = document.getElementById("problem-scan-exit");
  if (exitBtn) exitBtn.disabled = !checked;
}

async function submitProblemScanResult(result, button) {
  if (!activeSession) return;
  setButtonPending(button, "处理中...");
  try {
    const session = await SubmitProblemModScanResult(result);
    await safeRefreshFiles();
    if (session?.status === "found") {
      renderFoundSession(session);
    } else {
      renderActiveSession(session);
    }
  } catch (error) {
    showError("提交结果失败: " + error);
    renderActiveSession(activeSession);
  }
}

async function exitProblemScan() {
  const exitBtn = document.getElementById("problem-scan-exit");
  setButtonPending(exitBtn, "正在恢复...");
  try {
    await RestoreProblemModScan();
    await safeRefreshFiles();
    hideModal();
    showNotification("已退出查找模式，并恢复开始前的启用列表", "success");
  } catch (error) {
    showError("退出查找失败: " + error);
    setButtonReady(exitBtn, "退出查找模式");
  }
}

async function safeRefreshFiles() {
  try {
    await refreshFilesKeepFilter();
  } catch (error) {
    console.warn("刷新文件列表失败:", error);
  }
}

function getModal() {
  return document.getElementById("problem-scan-modal");
}

function getBody() {
  return document.getElementById("problem-scan-body");
}

function getFooter() {
  return document.getElementById("problem-scan-footer");
}

function setTitle(title) {
  const titleEl = document.getElementById("problem-scan-title");
  if (titleEl) titleEl.textContent = title;
}

function setModalMode(mode) {
  const modal = getModal();
  modal.dataset.mode = mode;
  modal.classList.toggle("problem-scan-locked", mode === "active");
}

function hideModal() {
  getModal()?.classList.add("hidden");
}

function setButtonPending(button, label) {
  if (!button) return;
  button.disabled = true;
  button.dataset.originalText = button.textContent;
  button.innerHTML = `<span class="btn-spinner"></span>${escapeHtml(label)}`;
}

function setButtonReady(button, label) {
  if (!button) return;
  button.disabled = false;
  button.textContent = label || button.dataset.originalText || "确定";
}

function displayName(item) {
  return item?.title && item.title !== item.name ? item.title : item?.name || "未知 Mod";
}

function getAppliedDisabled(session) {
  if (Array.isArray(session?.appliedDisabled) && session.appliedDisabled.length > 0) {
    return session.appliedDisabled;
  }
  return session?.currentDisabled || [];
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function boltIcon() {
  return `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2 4 14h7l-1 8 10-12h-7l1-8z"/></svg>`;
}

function checkIcon() {
  return `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
}

function folderIcon() {
  return `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h7l2 2h9v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>`;
}

function alertIcon() {
  return `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.6 2.5 18a2 2 0 0 0 1.8 3h15.4a2 2 0 0 0 1.8-3L13.7 3.6a2 2 0 0 0-3.4 0z"/></svg>`;
}

function lockIcon() {
  return `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;
}

function playIcon() {
  return `<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
}
