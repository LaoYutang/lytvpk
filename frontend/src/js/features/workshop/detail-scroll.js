export function getWorkshopDetailScrollTop(detailView) {
  return detailView.querySelector(".detail-scroll-content")?.scrollTop ?? 0;
}

export function restoreWorkshopDetailScroll(detailView, scrollTop, isCurrent) {
  if (!Number.isFinite(scrollTop)) return;
  const scrollContent = detailView.querySelector(".detail-scroll-content");
  if (!scrollContent) return;

  requestAnimationFrame(() => {
    if (isCurrent() && scrollContent.isConnected) {
      scrollContent.scrollTop = scrollTop;
    }
  });
}
