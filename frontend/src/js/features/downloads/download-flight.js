export const DOWNLOAD_FLIGHT_SIZE = 36;

// Sample a ballistic arc at uniform times. A global ease-out would make most of
// the travel happen immediately, even when the animation's duration is long.
export function createDownloadFlight(origin, target, { top = 48 } = {}) {
  const from = { x: origin.left + origin.width / 2, y: origin.top + origin.height / 2 };
  const to = { x: target.left + target.width / 2, y: target.top + target.height / 2 };
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const safeTop = Math.min(from.y, to.y, top + DOWNLOAD_FLIGHT_SIZE / 2 + 8);
  let height = Math.min(210, Math.max(92, distance * 0.22));
  const apexY = (arcHeight) => {
    if (!arcHeight) return Math.min(from.y, to.y);
    const t = Math.max(0, Math.min(1, (4 * arcHeight - dy) / (8 * arcHeight)));
    return from.y + dy * t - 4 * arcHeight * t * (1 - t);
  };
  if (apexY(height) < safeTop) {
    let low = 0;
    let high = height;
    for (let index = 0; index < 24; index++) {
      const middle = (low + high) / 2;
      if (apexY(middle) < safeTop) high = middle;
      else low = middle;
    }
    height = low;
  }

  const point = (t) => ({ x: dx * t, y: dy * t - 4 * height * t * (1 - t) });
  const times = Array.from({ length: 61 }, (_, index) => index / 60);
  const keyframes = times.map((t) => {
    const position = point(t);
    return { offset: t, transform: `translate(${position.x}px, ${position.y}px)` };
  });
  const badgeKeyframes = times.map((t) => ({
    offset: t,
    transform: `rotate(${Math.sign(dx) * 12 * Math.sin(Math.PI * t)}deg) scale(${1 + 0.08 * Math.sin(Math.PI * t) - 0.32 * t ** 4})`,
  }));
  const trailKeyframes = [0.045, 0.085, 0.125].map((lag, index) => times.map((t) => {
    const current = point(t);
    const previous = point(Math.max(0, t - lag));
    return {
      offset: t,
      transform: `translate(${previous.x - current.x}px, ${previous.y - current.y}px)`,
      opacity: (0.48 - index * 0.1) * Math.min(1, t / lag) * Math.min(1, (1 - t) / 0.16),
    };
  }));
  return {
    left: from.x - DOWNLOAD_FLIGHT_SIZE / 2,
    top: from.y - DOWNLOAD_FLIGHT_SIZE / 2,
    duration: Math.round(Math.min(850, Math.max(700, 640 + distance * 0.15))),
    keyframes,
    badgeKeyframes,
    trailKeyframes,
  };
}
