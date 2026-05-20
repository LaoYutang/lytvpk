let workshopPreviewImages = [];
let workshopPreviewIndex = 0;

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

function closeFullImageModal() {
  const modal = document.getElementById("image-preview-modal");
  if (modal) {
    modal.style.display = "none";
  }
}

function changeFullImage(step) {
  if (workshopPreviewImages.length <= 1) return;
  setFullImageAt(workshopPreviewIndex + step);
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
  document
    .querySelectorAll(".thumbnail-item")
    .forEach((el) => el.classList.remove("active"));
  if (element) {
    element.classList.add("active");
  }

  const index = workshopPreviewImages.indexOf(url);
  if (index >= 0) {
    workshopPreviewIndex = index;
  }

  scrollThumbnailsAfterEdgeClick(element);
};

window.openFullImage = function (src) {
  const modal = document.getElementById("image-preview-modal");
  if (modal) {
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
  const span = document.getElementsByClassName("image-modal-close")[0];
  const prevBtn = document.getElementById("image-modal-prev");
  const nextBtn = document.getElementById("image-modal-next");

  if (modal && span) {
    span.onclick = closeFullImageModal;

    prevBtn?.addEventListener("click", (event) => {
      event.stopPropagation();
      changeFullImage(-1);
    });

    nextBtn?.addEventListener("click", (event) => {
      event.stopPropagation();
      changeFullImage(1);
    });

    document.addEventListener("keydown", (event) => {
      if (modal.style.display !== "flex") return;
      if (event.key === "Escape") closeFullImageModal();
      if (event.key === "ArrowLeft") changeFullImage(-1);
      if (event.key === "ArrowRight") changeFullImage(1);
    });

    modal.onclick = function (event) {
      if (event.target === modal) {
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
            <div class="thumbnail-item skeleton-anim ${
              index === 0 ? "active" : ""
            }" onclick="window.switchPreview('${img}', this)">
                <img src="${img}" loading="lazy" style="opacity: 0; transition: opacity 0.3s;"
                onload="this.style.opacity='1'; this.parentElement.classList.remove('skeleton-anim')">
            </div>
        `
          )
          .join("")}
    </div>
    `;
}
