import { showWorkshopRequestError } from "../workshop/request-error.js";

// A missing remote item is a completed lookup. Only other failures require a retry.
export function showWorkshopUpdateResult(result, { line, onRetry, notify, announceSuccess = false }) {
  const updated = result?.total_updates;
  const failed = result?.failed_count;
  const unavailable = result?.unavailable_count === undefined ? 0 : result.unavailable_count;
  const valid = [updated, failed, unavailable].every(count => Number.isSafeInteger(count) && count >= 0);
  const unavailableText = unavailable > 0 && valid
    ? `${unavailable} 个工坊项目云端已失效，可能已被作者删除或设为私人。` : "";

  if (!valid || failed > 0) {
    const summary = valid ? [
      updated > 0 ? `发现 ${updated} 个Mod有更新。` : "",
      unavailableText,
      `${failed} 个本地 Mod 未能完成检查。`,
    ].join("") : "";
    showWorkshopRequestError({
      title: "更新检查未完成", summary, error: result?.first_error, line: result?.line || line,
      fallback: "部分工坊项目未取得有效检查结果，请重新检查。",
      retryLabel: "重新检查",
      retryHint: "可以点击“重新检查”再次检查，或在设置中切换线路后重试。",
      onRetry,
    });
    return false;
  }
  if (unavailableText) {
    notify(`检测完成，发现 ${updated} 个Mod有更新。${unavailableText}`, "info");
  } else if (announceSuccess) {
    notify(updated > 0 ? `检测完成，发现 ${updated} 个Mod有更新` : "检测完成，所有Mod均为最新版本", updated > 0 ? "info" : "success");
  }
  return true;
}
