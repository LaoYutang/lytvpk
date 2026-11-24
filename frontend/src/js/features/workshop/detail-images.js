import { escapeHtml } from "./utils.js";

let workshopPreviewImages = [];
let workshopPreviewIndex = 0;
let previewExitAnimations = null;
let previewWheelGesture = null;

const WHEEL_STEP_PX = 16;
const WHEEL_REPEAT_DISTANCE_PX = 48;
const WHEEL_IDLE_MS = 90;
const WHEEL_NOTCH_GAP_MS = 50;
const WHEEL_REPEAT_MS = 200;

export function getWorkshopPreviewImages(detail) {
  let images = detail.previews || [];
  images = images.map((p) => p.preview_url || p).filter(Boolean);

  if (detail.preview_url) {
    images.unshift(detail.preview_url);
  }

  return [...new Set(images)];
}

export function setWorkshopPreviewImages(images) {
  workshopPreviewImages = images;
  workshopPreviewIndex = 0;
}

function updateImageModalControls() {
  const prevBtn = document.getElementById("image-modal-prev");
  const nextBtn = document.getElementById("image-modal-next");
  const counter = document.getElementById("image-modal-counter");
  const hasMultiple = workshopPreviewImages.length > 1;

  prevBtn?.classList.toggle("hidden", !hasMultiple);
  nextBtn?.classList.toggle("hidden", !hasMultiple);
  counter?.classList.toggle("hidden", !hasMultiple);

  if (counter && hasMultiple) {
    counter.textContent = `${workshopPreviewIndex + 1} / ${workshopPreviewImages.length}`;
  }
}

function setFullImageAt(index) {
  const modalImg = document.getElementById("full-image");
  if (!modalImg || workshopPreviewImages.length === 0) return;

  workshopPreviewIndex =
    (index + workshopPreviewImages.length) % workshopPreviewImages.length;
  modalImg.src = workshopPreviewImages[workshopPreviewIndex];
  updateImageModalControls();
}

function clearPreviewExitAnimations() {
  previewExitAnimations?.forEach((animation) => animation.cancel());
  previewExitAnimations = null;
}

async function closeFullImageModal() {
  const modal = document.getElementById("image-preview-modal");
  if (!modal || modal.style.display !== "flex" || previewExitAnimations) return;

  const image = document.getElementById("full-image");
  if (
    image &&
    modal.animate &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    // A quick close can interrupt the opening zoom before it reaches full size.
    const { transform, opacity } = getComputedStyle(image);
    const timing = { duration: 180, easing: "ease-in", fill: "both" };
    const animations = [
      image.animate(
        [{ transform, opacity }, { transform: "scale(0.8)", opacity: 0 }],
        timing
      ),
      modal.animate([{ opacity: 1 }, { opacity: 0 }], timing),
    ];
    previewExitAnimations = animations;
    await Promise.allSettled(animations.map((animation) => animation.finished));
    if (previewExitAnimations !== animations) return;
    clearPreviewExitAnimations();
  }

  modal.style.display = "none";
  image?.removeAttribute("src");
}

function changeFullImage(step) {
  if (previewExitAnimations || workshopPreviewImages.length <= 1) return;
  setFullImageAt(workshopPreviewIndex + step);
}

function handlePreviewWheel(event) {
  const modal = event.currentTarget;
  if (event.ctrlKey || modal.style.display !== "flex") return;
  event.preventDefault();
  event.stopPropagation();
  if (previewExitAnimations || workshopPreviewImages.length <= 1) return;

  const { deltaMode, deltaX, deltaY, timeStamp } = event;
  if (!deltaY || Math.abs(deltaY) <= Math.abs(deltaX)) return;
  let distance = Math.abs(deltaY);
  if (deltaMode === WheelEvent.DOM_DELTA_LINE) distance *= WHEEL_STEP_PX;
  if (deltaMode === WheelEvent.DOM_DELTA_PAGE) distance *= modal.clientHeight;

  const direction = Math.sign(deltaY);
  const gap = timeStamp - (previewWheelGesture?.lastEvent ?? -Infinity);
  if (gap >= WHEEL_IDLE_MS || direction !== previewWheelGesture?.direction) {
    previewWheelGesture = { direction, recent: [], distance: 0, lastTurn: -Infinity };
  }
  const gesture = previewWheelGesture;
  gesture.lastEvent = timeStamp;

  // Compare nearby samples so a fading tail stops and a new steady pace can resume.
  const fading = gesture.recent.some((sample) => distance < sample);
  gesture.recent.push(distance);
  if (gesture.recent.length > 3) gesture.recent.shift();
  const hasTurned = Number.isFinite(gesture.lastTurn);
  if (hasTurned && fading) return;
  const separateNotch = gap >= WHEEL_NOTCH_GAP_MS && distance >= WHEEL_STEP_PX;
  const repeating = hasTurned && !separateNotch;
  if (repeating && timeStamp - gesture.lastTurn < WHEEL_REPEAT_MS) return;

  // Several rounded 1px events can linger at the end of a trackpad gesture.
  gesture.distance += distance;
  const threshold = repeating ? WHEEL_REPEAT_DISTANCE_PX : WHEEL_STEP_PX;
  if (gesture.distance < threshold) return;

  changeFullImage(direction);
  gesture.distance = 0;
  gesture.lastTurn = timeStamp;
}

function scrollThumbnailsAfterEdgeClick(element) {
  const container = element?.closest(".detail-thumbnails");
  if (!container) return;

  const thumbnails = Array.from(container.querySelectorAll(".thumbnail-item"));
  const clickedIndex = thumbnails.indexOf(element);
  if (clickedIndex < 0) return;

  const containerRect = container.getBoundingClientRect();
  const visibleIndexes = thumbnails.reduce((indexes, thumbnail, index) => {
    const rect = thumbnail.getBoundingClientRect();
    const isVisible =
      rect.left < containerRect.right - 1 &&
      rect.right > containerRect.left + 1;
    if (isVisible) indexes.push(index);
    return indexes;
  }, []);

  if (visibleIndexes.length === 0) return;

  const firstVisibleIndex = visibleIndexes[0];
  const lastVisibleIndex = visibleIndexes[visibleIndexes.length - 1];
  let targetIndex = clickedIndex;

  if (clickedIndex === lastVisibleIndex && clickedIndex < thumbnails.length - 1) {
    targetIndex = Math.min(clickedIndex + 2, thumbnails.length - 1);
  } else if (clickedIndex === firstVisibleIndex && clickedIndex > 0) {
    targetIndex = Math.max(clickedIndex - 2, 0);
  } else {
    return;
  }

  const scrollDistance =
    thumbnails[targetIndex].offsetLeft - thumbnails[clickedIndex].offsetLeft;

  if (scrollDistance !== 0) {
    container.scrollBy({ left: scrollDistance, behavior: "smooth" });
  }
}

window.switchPreview = function (url, element) {
  const mainImg = document.getElementById("main-preview-img");
  if (mainImg) {
    mainImg.src = url;
  }
  document.querySelectorAll(".thumbnail-item").forEach((el) => {
    el.classList.toggle("active", el === element);
    el.setAttribute("aria-pressed", String(el === element));
  });

  const index = workshopPreviewImages.indexOf(url);
  if (index >= 0) {
    workshopPreviewIndex = index;
  }

  scrollThumbnailsAfterEdgeClick(element);
};

window.openFullImage = function (src) {
  const modal = document.getElementById("image-preview-modal");
  if (modal) {
    clearPreviewExitAnimations();
    previewWheelGesture = null;
    if (!workshopPreviewImages.includes(src)) {
      workshopPreviewImages = [src].filter(Boolean);
    }
    const index = Math.max(0, workshopPreviewImages.indexOf(src));
    setFullImageAt(index);
    modal.style.display = "flex";
  }
};

document.addEventListener("DOMContentLoaded", () => {
  const modal = document.getElementById("image-preview-modal");
  const fullImage = document.getElementById("full-image");
  const closeButton = modal?.querySelector(".image-modal-close");
  const prevBtn = document.getElementById("image-modal-prev");
  const nextBtn = document.getElementById("image-modal-next");

  if (modal && closeButton) {
    modal.addEventListener("wheel", handlePreviewWheel, { passive: false });

    prevBtn?.addEventListener("click", (event) => {
      event.stopPropagation();
      changeFullImage(-1);
    });

    nextBtn?.addEventListener("click", (event) => {
      event.stopPropagation();
      changeFullImage(1);
    });

    document.addEventListener(
      "keydown",
      (event) => {
        if (modal.style.display !== "flex") return;
        if (!["Escape", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "Escape") closeFullImageModal();
        if (event.key === "ArrowLeft") changeFullImage(-1);
        if (event.key === "ArrowRight") changeFullImage(1);
      },
      true
    );

    modal.onclick = function (event) {
      event.stopPropagation();
      if ([modal, fullImage, closeButton].includes(event.target)) {
        closeFullImageModal();
      }
    };
  }
});

export function renderThumbnails(detail) {
  const images = getWorkshopPreviewImages(detail);

  if (images.length <= 1) return "";

  return `
    <div class="detail-thumbnails">
        ${images
          .map(
            (img, index) => `
            <button type="button" class="thumbnail-item skeleton-anim ${
              index === 0 ? "active" : ""
            }" aria-label="查看第 ${index + 1} 张预览图" aria-pressed="${index === 0}"
               onclick="window.switchPreview(this.firstElementChild.getAttribute('src'), this)">
                <img src="${escapeHtml(img)}" alt="" loading="lazy" style="opacity: 0; transition: opacity 0.3s;"
                onload="this.style.opacity='1'; this.parentElement.classList.remove('skeleton-anim')">
            </button>
        `
          )
          .join("")}
    </div>
    `;
}
