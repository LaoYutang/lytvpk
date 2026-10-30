import { getCurrentPage } from "../../core/ui-shell.js";
import { refreshTaskList, subscribeToDownloadTasks } from "./task-list.js";
import { createDownloadFlight } from "./download-flight.js";
import { createDownloadCounter } from "./download-count.js";

let activeTab = "parse";
let feedbackGeneration = 0;
let initialized = false;
const submissions = new Set();
const activeTransfers = new Set();
const taskCounter = createDownloadCounter(renderTaskCount);
let counterAnimation = null;

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function initDownloadsPage() {
  if (initialized) return;
  const nav = document.querySelector(".downloads-tabs");
  if (!nav) return;
  initialized = true;
  subscribeToDownloadTasks((ids) => taskCounter.update(ids));

  nav.querySelectorAll("[data-downloads-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      selectDownloadsTab(button.dataset.downloadsTab, { focus: true });
    });
    button.addEventListener("keydown", (event) => {
      const tabs = Array.from(nav.querySelectorAll("[data-downloads-tab]"));
      let index = tabs.indexOf(button);
      if (event.key === "ArrowRight" || event.key === "ArrowDown") index++;
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp") index--;
      else if (event.key === "Home") index = 0;
      else if (event.key === "End") index = tabs.length - 1;
      else return;
      event.preventDefault();
      selectDownloadsTab(tabs[(index + tabs.length) % tabs.length].dataset.downloadsTab, { focus: true });
    });
  });

  document.addEventListener("app:page-change", (event) => {
    if (event.detail.page !== "downloads") {
      cancelDownloadFeedback();
    } else {
      requestAnimationFrame(() => updateTabIndicator(true));
    }
  });
  window.addEventListener("resize", () => {
    cancelDownloadFeedback();
    updateTabIndicator(true);
  });
  nav.addEventListener("scroll", () => updateTabIndicator(true));
  selectDownloadsTab(activeTab);
}

export function getDownloadsTab() {
  return activeTab;
}

export function selectDownloadsTab(tab, { focus = false } = {}) {
  if (tab !== "parse" && tab !== "tasks") return;
  cancelDownloadFeedback();
  const previous = activeTab;
  activeTab = tab;
  const content = document.querySelector(".downloads-content");
  if (content) content.dataset.settingsDirection = tab === "tasks" ? "down" : "up";
  for (const name of ["parse", "tasks"]) {
    const button = document.getElementById(`downloads-tab-${name}`);
    const panel = document.getElementById(`downloads-panel-${name}`);
    const selected = name === tab;
    button?.classList.toggle("active", selected);
    button?.setAttribute("aria-selected", String(selected));
    if (button) button.tabIndex = selected ? 0 : -1;
    panel?.classList.toggle("active", selected);
    if (panel) panel.hidden = !selected;
  }
  updateTabIndicator(previous === tab);
  if (tab === "tasks") void refreshTaskList();
  if (focus) document.getElementById(`downloads-tab-${tab}`)?.focus({ preventScroll: true });
}

export function focusDownloadsTab() {
  const target = activeTab === "parse" ? "workshop-url" : "downloads-tab-tasks";
  document.getElementById(target)?.focus({ preventScroll: true });
}

function updateTabIndicator(skipTransition = false) {
  const nav = document.querySelector(".downloads-tabs");
  const indicator = nav?.querySelector(".settings-active-indicator");
  const selected = document.getElementById(`downloads-tab-${activeTab}`);
  if (!nav || !indicator || !selected || nav.getBoundingClientRect().width === 0) return;
  if (skipTransition) indicator.style.transition = "none";
  const navRect = nav.getBoundingClientRect();
  const rect = selected.getBoundingClientRect();
  const horizontal = window.matchMedia("(max-width: 640px)").matches;
  nav.setAttribute("aria-orientation", horizontal ? "horizontal" : "vertical");
  indicator.style.width = horizontal ? `${rect.width}px` : "";
  indicator.style.height = `${rect.height}px`;
  indicator.style.transform = horizontal
    ? `translate(${rect.left - navRect.left + nav.scrollLeft}px, ${rect.top - navRect.top}px)`
    : `translateY(${rect.top - navRect.top + nav.scrollTop}px)`;
  if (skipTransition) {
    void indicator.offsetHeight;
    indicator.style.transition = "";
  }
}

export function captureDownloadOrigin(button) {
  const icon = button?.querySelector("svg");
  if (!icon) return null;
  const rect = icon.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    icon: icon.cloneNode(true),
  };
}

function renderTaskCount(count, { animate }) {
  const badge = document.getElementById("downloads-task-count");
  const tab = document.getElementById("downloads-tab-tasks");
  if (!badge || !tab) return;
  badge.textContent = String(count);
  badge.dataset.empty = String(count === 0);
  tab.setAttribute("aria-label", `下载任务，共 ${count} 个任务`);
  counterAnimation?.cancel();
  counterAnimation = null;
  if (!animate || reducedMotion() || typeof badge.animate !== "function") return;
  const animation = badge.animate([
    { transform: "scale(1)" },
    { transform: "scale(1.35)", offset: 0.35 },
    { transform: "scale(0.94)", offset: 0.7 },
    { transform: "scale(1)" },
  ], { duration: 320, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
  counterAnimation = animation;
  animation.finished.catch(() => {}).finally(() => {
    if (counterAnimation === animation) {
      counterAnimation = null;
      animation.cancel();
    }
  });
}

export function beginDownloadSubmission(origin) {
  const context = {
    generation: feedbackGeneration,
    origin,
    taskIds: new Set(),
    counter: taskCounter.begin(),
    feedbackStarted: false,
    transfer: null,
    cancelled: false,
    finished: false,
  };
  submissions.add(context);
  return context;
}

export function notifyDownloadTaskCreated(context, taskId) {
  if (!context || !taskId) return;
  context.taskIds.add(taskId);
  taskCounter.accept(context.counter, taskId);
  if (context.feedbackStarted) return;
  context.feedbackStarted = true;
  if (canPlayFeedback(context)) void flyToTasksTab(context);
  else taskCounter.land(context.counter);
}

export function finishDownloadSubmission(context) {
  if (!context) return;
  context.finished = true;
  taskCounter.finish(context.counter);
  if (!context.transfer) submissions.delete(context);
}

export function cancelDownloadFeedback() {
  feedbackGeneration++;
  submissions.forEach((context) => { context.cancelled = true; });
  submissions.clear();
  activeTransfers.forEach((transfer) => transfer.cancel());
  taskCounter.cancel();
  counterAnimation?.cancel();
  counterAnimation = null;
}

function canPlayFeedback(context) {
  return !context.cancelled && context.generation === feedbackGeneration &&
    getCurrentPage() === "downloads" && activeTab === "parse";
}

function isCurrentTransfer(transfer) {
  return !transfer.cancelled && !transfer.context.cancelled &&
    canPlayFeedback(transfer.context);
}

async function animateTransfer(transfer, element, frames, duration, easing = "cubic-bezier(0.22, 1, 0.36, 1)") {
  if (!isCurrentTransfer(transfer)) throw new Error("transfer cancelled");
  const animation = element.animate(frames, {
    duration,
    easing,
    fill: "forwards",
  });
  transfer.animations.add(animation);
  await animation.finished;
  if (!isCurrentTransfer(transfer)) throw new Error("transfer cancelled");
}

async function flyToTasksTab(context) {
  const transfer = {
    context,
    element: null,
    decorations: new Set(),
    animations: new Set(),
    cancelled: false,
    cancel() {
      this.cancelled = true;
      this.animations.forEach((animation) => animation.cancel());
      this.element?.remove();
      this.decorations.forEach((element) => element.remove());
    },
  };
  context.transfer = transfer;
  activeTransfers.add(transfer);
  try {
    const tab = document.getElementById("downloads-tab-tasks");
    const icon = tab?.querySelector("svg");
    if (!tab || !icon || typeof tab.animate !== "function") return;
    const destination = document.getElementById("downloads-task-count") || icon;
    const origin = context.origin;
    const canAnimate = origin && !reducedMotion();
    let badge = null;
    if (canAnimate) {
      const ghost = document.createElement("div");
      ghost.className = "download-transfer";
      ghost.setAttribute("aria-hidden", "true");
      const flight = createDownloadFlight(origin, destination.getBoundingClientRect());
      ghost.style.left = `${flight.left}px`;
      ghost.style.top = `${flight.top}px`;
      const trail = flight.trailKeyframes.map((_, index) => {
        const dot = document.createElement("span");
        dot.className = `download-transfer-trail download-transfer-trail-${index + 1}`;
        ghost.appendChild(dot);
        return dot;
      });
      badge = document.createElement("span");
      badge.className = "download-transfer-badge";
      badge.appendChild(origin.icon);
      ghost.appendChild(badge);
      document.body.appendChild(ghost);
      transfer.element = ghost;
      await animateTransfer(transfer, badge, [
        { transform: "scale(0.5)", opacity: 0.4 },
        { transform: "scale(1.12)", opacity: 1, offset: 0.7 },
        { transform: "scale(1)", opacity: 1 },
      ], 120);
      await Promise.all([
        animateTransfer(transfer, ghost, flight.keyframes, flight.duration, "linear"),
        animateTransfer(transfer, badge, flight.badgeKeyframes, flight.duration, "linear"),
        ...trail.map((dot, index) => animateTransfer(transfer, dot, flight.trailKeyframes[index], flight.duration, "linear")),
      ]);
    }

    if (!isCurrentTransfer(transfer)) return;
    taskCounter.land(context.counter);
    const landing = [animateTransfer(transfer, tab, [
      { backgroundColor: "rgba(79, 70, 229, 0.18)" },
      { backgroundColor: "transparent" },
    ], reducedMotion() ? 120 : 320)];
    if (canAnimate) {
      const ripple = document.createElement("span");
      ripple.className = "download-tab-ripple";
      ripple.setAttribute("aria-hidden", "true");
      const tabRect = tab.getBoundingClientRect();
      const iconRect = destination.getBoundingClientRect();
      ripple.style.left = `${iconRect.left + iconRect.width / 2 - tabRect.left}px`;
      ripple.style.top = `${iconRect.top + iconRect.height / 2 - tabRect.top}px`;
      tab.appendChild(ripple);
      transfer.decorations.add(ripple);
      landing.push(
        animateTransfer(transfer, badge, [
          { transform: "scale(0.68)", opacity: 1 },
          { transform: "scale(0.15)", opacity: 0 },
        ], 140),
        animateTransfer(transfer, icon, [
          { transform: "translateY(0) scale(1)" },
          { transform: "translateY(2px) scale(0.84)", offset: 0.2 },
          { transform: "translateY(-2px) scale(1.24)", offset: 0.55 },
          { transform: "translateY(0) scale(1)" },
        ], 320),
        animateTransfer(transfer, ripple, [
          { transform: "translate(-50%, -50%) scale(0.5)", opacity: 0.6 },
          { transform: "translate(-50%, -50%) scale(2.2)", opacity: 0 },
        ], 320),
      );
    }
    await Promise.all(landing);
  } catch (error) {
    if (!transfer.cancelled && isCurrentTransfer(transfer)) {
      console.error("下载任务图标动画失败:", error);
    }
  } finally {
    taskCounter.land(context.counter);
    transfer.animations.forEach((animation) => animation.cancel());
    transfer.element?.remove();
    transfer.decorations.forEach((element) => element.remove());
    activeTransfers.delete(transfer);
    context.transfer = null;
    if (context.finished || context.cancelled) submissions.delete(context);
  }
}
