const MEASUREMENT_BATCH_SIZE = 50;

function rowAtOffset(offsets, offset) {
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (offsets[middle] <= offset) low = middle;
    else high = middle - 1;
  }
  return Math.min(low, offsets.length - 2);
}

export function getWorkshopRowWindow(offsets, scrollTop, viewportHeight) {
  if (offsets.length < 2) return { first: 0, end: 0 };
  // Keep one viewport on either side for native wheel and scrollbar movement.
  return {
    first: rowAtOffset(offsets, scrollTop - viewportHeight),
    end: rowAtOffset(offsets, scrollTop + 2 * viewportHeight) + 1,
  };
}

export function createWorkshopVirtualGrid(grid, scroll, createCard) {
  const makeSpacer = () => {
    const spacer = document.createElement("div");
    spacer.className = "workshop-grid-spacer";
    spacer.setAttribute("aria-hidden", "true");
    return spacer;
  };
  const topSpacer = makeSpacer();
  const bottomSpacer = makeSpacer();
  const mounted = new Map();
  let items = [];
  let offsets = [0];
  let measuredCount = 0;
  let layout;
  let resizeAnchor;
  let lastVisibleTop = 0;
  let wasHidden = false;

  function measureRows() {
    const { columns, tracks, gap } = layout;
    const firstRow = Math.floor(measuredCount / columns);
    offsets.length = firstRow + 1;
    const wrapper = document.createElement("div");
    wrapper.className = "workshop-grid-measure";
    wrapper.setAttribute("aria-hidden", "true");
    const probe = document.createElement("div");
    probe.className = "workshop-grid";
    probe.style.gridTemplateColumns = tracks;
    wrapper.appendChild(probe);
    scroll.appendChild(wrapper);
    const batchSize = columns * Math.max(1, Math.floor(MEASUREMENT_BATCH_SIZE / columns));

    // Use the same grid and text as the visible cards, without images or events.
    for (let start = firstRow * columns; start < items.length; start += batchSize) {
      const end = Math.min(items.length, start + batchSize);
      probe.replaceChildren(...items.slice(start, end).map((item) => createCard(item, true)));
      for (let index = 0; index < end - start; index += columns) {
        offsets.push(offsets.at(-1) + probe.children[index].getBoundingClientRect().height + gap);
      }
    }
    wrapper.remove();
    measuredCount = items.length;
  }

  function placeSpacer(spacer, height, before) {
    if (height <= 0) {
      spacer.remove();
      return;
    }
    const size = `${height}px`;
    if (spacer.style.height !== size) spacer.style.height = size;
    if (spacer.parentElement !== grid || spacer.nextSibling !== before) {
      grid.insertBefore(spacer, before);
    }
  }

  function render(scrollTop) {
    if (offsets.length < 2 || !scroll.clientHeight) return;
    const { columns, gap, inset } = layout;
    const { first, end } = getWorkshopRowWindow(offsets, scrollTop - inset, scroll.clientHeight);
    const firstItem = first * columns;
    const endItem = Math.min(items.length, end * columns);
    for (const [index, card] of mounted) {
      if (index < firstItem || index >= endItem) {
        card.remove();
        mounted.delete(index);
      }
    }

    // Grid adds a gap next to each spacer. Leave that gap to the CSS grid.
    const footer = grid.querySelector(".error-state");
    placeSpacer(bottomSpacer, offsets.at(-1) - offsets[end] - gap, footer);
    let before = bottomSpacer.parentElement === grid ? bottomSpacer : footer;
    for (let index = endItem - 1; index >= firstItem; index--) {
      let card = mounted.get(index);
      if (!card) {
        card = createCard(items[index]);
        mounted.set(index, card);
      }
      if (card.parentElement !== grid || card.nextSibling !== before) grid.insertBefore(card, before);
      before = card;
    }
    placeSpacer(topSpacer, offsets[first] - gap, before);
  }

  function getResizeAnchor(scrollTop) {
    if (resizeAnchor && Math.abs(resizeAnchor.scrollTop - scrollTop) <= 1) return resizeAnchor;
    const top = scrollTop - layout.inset;
    let row = rowAtOffset(offsets, top);
    if (row < offsets.length - 2 && top >= offsets[row + 1] - layout.gap) row++;
    return { item: row * layout.columns, offset: top - offsets[row] };
  }

  function reconcile() {
    if (!items.length) return;
    if (!scroll.clientHeight) {
      wasHidden = true;
      return;
    }
    const rect = grid.getBoundingClientRect();
    const style = getComputedStyle(grid);
    const tracks = style.gridTemplateColumns;
    if (!rect.width || !tracks || tracks === "none") return;
    const gap = parseFloat(style.rowGap);
    const columns = tracks.split(/\s+/).length;
    const columnsChanged = layout?.tracks !== tracks || layout?.gap !== gap;
    if (columnsChanged) measuredCount = 0;
    const scrollTop = wasHidden ? lastVisibleTop : scroll.scrollTop;
    const anchor = measuredCount === 0 && offsets.length > 1 && scrollTop > 0
      ? getResizeAnchor(scrollTop)
      : null;
    const inset = rect.top - scroll.getBoundingClientRect().top - scroll.clientTop + scroll.scrollTop;
    layout = { tracks, columns, gap, inset };
    if (measuredCount !== items.length) measureRows();
    const target = anchor ? inset + offsets[Math.floor(anchor.item / columns)] + anchor.offset : scrollTop;
    render(target);
    // Reveal the old position only after the new scroll height is in the DOM.
    if (anchor || wasHidden) scroll.scrollTop = target;
    wasHidden = false;
    lastVisibleTop = scroll.scrollTop;
    if (anchor) resizeAnchor = { ...anchor, scrollTop: lastVisibleTop };
  }

  function invalidate() {
    measuredCount = 0;
    reconcile();
  }

  const observer = new ResizeObserver(reconcile);
  observer.observe(scroll);
  document.fonts?.addEventListener("loadingdone", invalidate);

  return {
    setItems(nextItems) {
      items = nextItems;
      reconcile();
    },
    clear() {
      items = [];
      offsets = [0];
      measuredCount = 0;
      resizeAnchor = undefined;
      lastVisibleTop = 0;
      wasHidden = false;
      mounted.clear();
      grid.replaceChildren();
    },
    onScroll() {
      if (!scroll.clientHeight) return;
      if (wasHidden) {
        reconcile();
        return;
      }
      const scrollTop = scroll.scrollTop;
      if (resizeAnchor && Math.abs(scrollTop - resizeAnchor.scrollTop) > 1) resizeAnchor = undefined;
      lastVisibleTop = scrollTop;
      render(scrollTop);
    },
    invalidate,
  };
}
