import { getAPILineErrorInfo, getAPILineSnapshot, isCurrentAPILine, subscribeAPILineChange } from "../../core/api-line.js";

let errorSequence = 0;
let activeNotice;
subscribeAPILineChange(() => {
  activeNotice?.remove();
  activeNotice = null;
});

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, className, action) {
  const node = element("button", className, label);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}

export function openWorkshopLineSettings() {
  document.dispatchEvent(new CustomEvent("workshop:open-line-settings"));
}

export function getWorkshopMetadataWarning(items) {
  const warnings = (Array.isArray(items) ? items : [])
    .flatMap((item) => Array.isArray(item?.warnings) ? item.warnings : [])
    .filter((warning) => typeof warning === "string" && /获取工坊(?:信息|详情)失败/u.test(warning));
  return warnings.length ? { count: warnings.length, error: warnings.join("\n") } : null;
}

// Shared by browsing, details and parsing. Error text is always inserted as text.
export function createWorkshopRequestError({
  title = "工坊请求未完成",
  error,
  fallback = "请求未能完成，请稍后重试。",
  line,
  onRetry,
  retryLabel = "重新查询",
  retryHint = "可以点击“查询”再次刷新，或在设置中切换线路后重试。",
  onSettings = openWorkshopLineSettings,
  onBack,
  backLabel = "返回",
  compact = false,
  onDismiss,
} = {}) {
  const info = getAPILineErrorInfo(error, fallback);
  const snapshot = getAPILineSnapshot();
  const lineLabel = info.line || ((line || snapshot.line) === "backup" ? "备用线路" : "主线路");
  const id = `workshop-request-error-${++errorSequence}`;
  const card = element("section", `workshop-request-error error-state${compact ? " workshop-request-error--compact" : ""}`);
  card.setAttribute("role", "alert");
  card.setAttribute("aria-atomic", "true");
  card.setAttribute("aria-labelledby", `${id}-title`);
  card.dataset.errorKind = info.kind;

  const header = element("div", "workshop-request-error__header");
  const icon = element("span", "workshop-request-error__icon", "!");
  icon.setAttribute("aria-hidden", "true");
  const heading = element("div", "workshop-request-error__heading");
  const titleNode = element("h3", "workshop-request-error__title", title);
  titleNode.id = `${id}-title`;
  const context = element("div", "workshop-request-error__context");
  context.appendChild(element("span", "workshop-request-error__line", lineLabel));
  if (info.status) context.appendChild(element("span", "workshop-request-error__status", `HTTP ${info.status}`));
  heading.appendChild(titleNode);
  heading.appendChild(context);
  header.appendChild(icon);
  header.appendChild(heading);
  if (onDismiss) {
    const close = button("×", "workshop-request-error__close", onDismiss);
    close.setAttribute("aria-label", "关闭错误提示");
    header.appendChild(close);
  }
  card.appendChild(header);

  const message = element("p", "workshop-request-error__message", info.message);
  message.id = `${id}-message`;
  card.appendChild(message);
  card.setAttribute("aria-describedby", message.id);
  if (info.detail && info.detail !== info.message) {
    const details = element("div", "workshop-request-error__details");
    details.appendChild(element("span", "workshop-request-error__detail-label", "错误详情"));
    details.appendChild(element("p", "workshop-request-error__detail-text", info.detail));
    card.appendChild(details);
  }

  const canSuggestLine = info.kind !== "canceled" && info.kind !== "validation";
  if (canSuggestLine) {
    const advice = element("div", "workshop-request-error__advice");
    advice.appendChild(element("span", "workshop-request-error__advice-label", "你可以这样尝试"));
    advice.appendChild(element("p", "workshop-request-error__hint", retryHint));
    card.appendChild(advice);
  }

  const actions = element("div", "workshop-request-error__actions");
  if (onRetry && info.kind !== "canceled") {
    actions.appendChild(button(retryLabel, "btn btn-primary workshop-request-error__retry", () => {
      if (isCurrentAPILine(snapshot)) onRetry();
    }));
  }
  if (onSettings && canSuggestLine) {
    actions.appendChild(button("线路设置", "btn btn-outline workshop-request-error__settings", () => {
      if (isCurrentAPILine(snapshot)) onSettings();
    }));
  }
  if (onBack) actions.appendChild(button(backLabel, "btn btn-outline workshop-request-error__back", () => {
    if (isCurrentAPILine(snapshot)) onBack();
  }));
  if (actions.childNodes.length) card.appendChild(actions);
  return card;
}

// Background checks use the same persistent error style, with an explicit close.
export function showWorkshopRequestError(options = {}) {
  activeNotice?.remove();
  const container = document.getElementById("toast-container") || document.body;
  let notice;
  notice = createWorkshopRequestError({
    compact: true,
    ...options,
    onRetry: options.onRetry ? () => {
      notice.remove();
      if (activeNotice === notice) activeNotice = null;
      return options.onRetry();
    } : undefined,
    onDismiss: () => {
      notice.remove();
      if (activeNotice === notice) activeNotice = null;
    },
  });
  notice.classList.add("workshop-request-error--notice");
  container.appendChild(notice);
  activeNotice = notice;
  return notice;
}
