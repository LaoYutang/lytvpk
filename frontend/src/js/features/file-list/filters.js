import { appState, updateStatusBar, showFileListLoading, hideFileListLoading } from "../state.js";
import { showError } from "../../core/toast.js";
import { renderFileList } from "./render.js";
import { getLocationDisplayName, escapeHtml } from "../../core/utils.js";
import { applySort, updateSortButtonUI } from "./sorting.js";
import { resetBoxSelection } from "./box-selection.js";
import { GetPrimaryTags, GetSecondaryTags, SearchVPKFiles, ScanVPKFiles, GetVPKFiles } from "../../../../wailsjs/go/app/App";

const LOCATION_FILTERS = ["root", "workshop", "disabled"];

document.addEventListener("app:page-change", (event) => {
  if (event.detail?.page === "mods") {
    requestAnimationFrame(updateClassicSecondaryTagsCollapse);
  }
});

window.addEventListener("resize", () => {
  requestAnimationFrame(updateClassicSecondaryTagsCollapse);
});

export async function renderTagFilters() {
  const tagContainer = document.getElementById("tag-filters");
  const locationContainer = document.getElementById("location-filter-section");
  const filterRow = tagContainer?.closest(".filter-row-filters");

  if (!tagContainer || !locationContainer) return;
  tagContainer.innerHTML = "";
  locationContainer.innerHTML = "";
  filterRow?.classList.toggle("filter-layout-classic", appState.filterLayoutMode === "classic");
  tagContainer.classList.toggle("classic-tag-filters", appState.filterLayoutMode === "classic");
  locationContainer.classList.toggle("classic-location-placeholder", appState.filterLayoutMode === "classic");

  try {
    const primaryTags = await GetPrimaryTags();
    if (appState.filterLayoutMode === "classic") {
      renderClassicFilters(tagContainer, locationContainer, primaryTags);
    } else {
      renderSelectBasedFilters(tagContainer, locationContainer, primaryTags);
    }
    await renderSecondaryTags(appState.selectedPrimaryTag);
  } catch (error) {
    console.error("渲染标签筛选器失败:", error);
  }
}

function renderSelectBasedFilters(tagContainer, locationContainer, primaryTags) {
  const primaryGroup = document.createElement("div");
  primaryGroup.className = "filter-select-group primary-tag-group";
  primaryGroup.innerHTML = '<span class="filter-label">标签</span>';

  const dropdown = document.createElement("div");
  dropdown.className = "single-select-dropdown primary-filter-dropdown";
  dropdown.innerHTML = `
    <button type="button" id="primary-tag-filter-trigger" class="select-trigger"></button>
    <div id="primary-tag-filter-menu" class="select-menu hidden"></div>
  `;

  const trigger = dropdown.querySelector("#primary-tag-filter-trigger");
  const menu = dropdown.querySelector("#primary-tag-filter-menu");
  const options = [{ value: "", text: "全部" }, ...primaryTags.map((tag) => ({ value: tag, text: tag }))];

  options.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "select-option";
    button.dataset.value = option.value;
    button.textContent = option.text;
    button.addEventListener("click", async () => {
      appState.selectedPrimaryTag = option.value;
      appState.selectedSecondaryTags = [];
      updatePrimaryTagDropdownUI();
      menu.classList.add("hidden");
      await renderSecondaryTags(appState.selectedPrimaryTag);
      performSearch();
    });
    menu.appendChild(button);
  });

  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleFilterMenu(trigger, menu);
  });

  primaryGroup.appendChild(dropdown);
  tagContainer.appendChild(primaryGroup);
  updatePrimaryTagDropdownUI();

  const secondaryGroup = document.createElement("div");
  secondaryGroup.className = "filter-select-group secondary-tag-group";
  secondaryGroup.id = "secondary-tag-group";
  secondaryGroup.innerHTML = '<span class="filter-label">子标签</span>';
  tagContainer.appendChild(secondaryGroup);

  renderLocationFilterDropdown(locationContainer);
}

function renderClassicFilters(tagContainer, locationContainer, primaryTags) {
  const primaryLine = document.createElement("div");
  primaryLine.className = "classic-filter-line classic-primary-line";

  const locationGroup = document.createElement("div");
  locationGroup.className = "classic-filter-group classic-location-group";
  locationGroup.innerHTML = '<span class="filter-label">位置</span>';
  const locationList = document.createElement("div");
  locationList.className = "classic-filter-chip-list";
  LOCATION_FILTERS.forEach((location) => {
    locationList.appendChild(createLocationTagButton(location));
  });
  locationGroup.appendChild(locationList);

  const primaryGroup = document.createElement("div");
  primaryGroup.className = "classic-filter-group classic-primary-group";
  primaryGroup.innerHTML = '<span class="filter-label">标签</span>';
  const primaryList = document.createElement("div");
  primaryList.className = "classic-filter-chip-list";
  [{ value: "", text: "全部" }, ...primaryTags.map((tag) => ({ value: tag, text: tag }))].forEach((option) => {
    primaryList.appendChild(createPrimaryTagButton(option.value, option.text));
  });
  primaryGroup.appendChild(primaryList);

  const secondarySearchGroup = document.createElement("div");
  secondarySearchGroup.id = "classic-secondary-search-group";
  secondarySearchGroup.className = "classic-secondary-search-group";
  secondarySearchGroup.innerHTML = `
    <input
      id="classic-secondary-filter-input"
      class="classic-secondary-filter-input"
      type="text"
      placeholder="筛选子标签..."
      aria-label="筛选子标签"
      autocomplete="off"
    >
  `;
  secondarySearchGroup.querySelector("input").addEventListener("input", (event) => {
    filterClassicSecondaryTagButtons(event.target.value);
  });
  primaryGroup.appendChild(secondarySearchGroup);

  const secondaryGroup = document.createElement("div");
  secondaryGroup.id = "secondary-tag-group";
  secondaryGroup.className = "classic-filter-line classic-secondary-row";
  secondaryGroup.innerHTML = `
    <span class="filter-label">子标签</span>
    <div class="classic-secondary-tags-slot"></div>
    <div class="classic-secondary-action-slot"></div>
  `;

  primaryLine.appendChild(locationGroup);
  primaryLine.appendChild(primaryGroup);
  tagContainer.appendChild(primaryLine);
  tagContainer.appendChild(secondaryGroup);
}

export function updatePrimaryTagDropdownUI() {
  const trigger = document.getElementById("primary-tag-filter-trigger");
  const menu = document.getElementById("primary-tag-filter-menu");
  if (!trigger || !menu) return;

  trigger.textContent = appState.selectedPrimaryTag || "全部";
  menu.querySelectorAll(".select-option").forEach((option) => {
    option.classList.toggle("active", option.dataset.value === appState.selectedPrimaryTag);
  });
}

export function createPrimaryTagButton(value, text) {
  const button = document.createElement("button");
  button.className = "primary-tag-btn";
  button.textContent = text;
  button.dataset.value = value;

  if (appState.selectedPrimaryTag === value) {
    button.classList.add("active");
  }

  button.addEventListener("click", async function () {
    document.querySelectorAll(".primary-tag-btn").forEach((btn) => {
      btn.classList.remove("active");
    });
    button.classList.add("active");
    appState.selectedPrimaryTag = value;
    appState.selectedSecondaryTags = [];
    const secondaryFilterInput = document.getElementById("classic-secondary-filter-input");
    if (secondaryFilterInput) secondaryFilterInput.value = "";
    await renderSecondaryTags(appState.selectedPrimaryTag);
    performSearch();
  });

  return button;
}

export async function renderSecondaryTags(primaryTag) {
  const secondaryGroup = document.getElementById("secondary-tag-group");
  if (!secondaryGroup) return;

  if (secondaryGroup?.classList.contains("filter-select-group")) {
    await renderSecondaryTagDropdown(secondaryGroup, primaryTag);
    return;
  }

  await renderSecondaryTagButtons(secondaryGroup, primaryTag);
}

async function renderSecondaryTagButtons(secondaryGroup, primaryTag) {
  const tagsSlot = secondaryGroup.querySelector(".classic-secondary-tags-slot") || secondaryGroup;
  const actionSlot = secondaryGroup.querySelector(".classic-secondary-action-slot") || secondaryGroup;
  const existingContainer = secondaryGroup.querySelector(".secondary-tags-container");
  if (existingContainer) existingContainer.remove();

  const existingExpandBtn = secondaryGroup.querySelector(".expand-tags-btn");
  if (existingExpandBtn) existingExpandBtn.remove();

  const existingEmptyHint = secondaryGroup.querySelector(".classic-secondary-empty-hint");
  if (existingEmptyHint) existingEmptyHint.remove();

  try {
    const secondaryTags = await GetSecondaryTags(primaryTag || "");

    if (secondaryTags.length > 0) {
      secondaryTags.sort((a, b) => a.localeCompare(b, "zh-CN"));
      secondaryGroup.style.display = "flex";
      setClassicSecondarySearchVisible(true);

      const container = document.createElement("div");
      container.className = "secondary-tags-container";

      secondaryTags.forEach((tag) => {
        const tagBtn = createSecondaryTagButton(tag);
        container.appendChild(tagBtn);
      });

      tagsSlot.appendChild(container);

      const emptyHint = document.createElement("span");
      emptyHint.className = "classic-secondary-empty-hint hidden";
      emptyHint.textContent = "没有匹配的子标签";
      tagsSlot.appendChild(emptyHint);

      filterClassicSecondaryTagButtons();
      scheduleSecondaryTagsCollapse(container, actionSlot);
    } else {
      secondaryGroup.style.display = "none";
      setClassicSecondarySearchVisible(false);
    }
  } catch (error) {
    console.error("获取二级标签失败:", error);
    secondaryGroup.style.display = "none";
    setClassicSecondarySearchVisible(false);
  }
}

function setClassicSecondarySearchVisible(isVisible) {
  const searchGroup = document.getElementById("classic-secondary-search-group");
  if (searchGroup) {
    searchGroup.classList.toggle("is-empty", !isVisible);
  }
}

function filterClassicSecondaryTagButtons(filterText) {
  const secondaryGroup = document.getElementById("secondary-tag-group");
  if (!secondaryGroup || secondaryGroup.classList.contains("filter-select-group")) return;

  const container = secondaryGroup.querySelector(".secondary-tags-container");
  if (!container) return;

  const searchInput = document.getElementById("classic-secondary-filter-input");
  const normalizedFilter = (filterText ?? searchInput?.value ?? "").trim().toLowerCase();
  let visibleCount = 0;

  container.querySelectorAll(".secondary-tag-btn").forEach((button) => {
    const tag = button.dataset.tag || button.textContent || "";
    const isVisible = !normalizedFilter || tag.toLowerCase().includes(normalizedFilter);
    button.hidden = !isVisible;
    if (isVisible) visibleCount += 1;
  });

  secondaryGroup
    .querySelector(".classic-secondary-empty-hint")
    ?.classList.toggle("hidden", visibleCount > 0);

  updateClassicSecondaryTagsCollapse();
}

function scheduleSecondaryTagsCollapse(container, actionSlot) {
  const run = () => updateSecondaryTagsCollapse(container, actionSlot);
  requestAnimationFrame(() => {
    if (!run()) {
      setTimeout(run, 80);
    }
  });
}

function updateClassicSecondaryTagsCollapse() {
  const container = document.querySelector(".filter-row-filters.filter-layout-classic .secondary-tags-container");
  const actionSlot = document.querySelector(".filter-row-filters.filter-layout-classic .classic-secondary-action-slot");
  if (container && actionSlot) {
    updateSecondaryTagsCollapse(container, actionSlot);
  }
}

function updateSecondaryTagsCollapse(container, actionSlot) {
  if (!document.body.contains(container)) return true;

  const rect = container.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  let expandBtn = actionSlot.querySelector(".expand-tags-btn");
  const tagButtons = Array.from(container.children).filter((button) => !button.hidden);
  if (tagButtons.length === 0) {
    container.classList.remove("collapsed");
    container.dataset.expanded = "";
    expandBtn?.remove();
    return true;
  }

  const firstRowTop = tagButtons[0]?.offsetTop ?? 0;
  const hasMultipleRows = tagButtons.some((button) => button.offsetTop > firstRowTop);

  if (!hasMultipleRows) {
    container.classList.remove("collapsed");
    container.dataset.expanded = "";
    expandBtn?.remove();
    return true;
  }

  if (!expandBtn) {
    container.classList.add("collapsed");
    container.dataset.expanded = "false";

    expandBtn = document.createElement("button");
    expandBtn.className = "expand-tags-btn";
    expandBtn.onclick = () => {
      const willExpand = container.classList.contains("collapsed");
      container.classList.toggle("collapsed", !willExpand);
      container.dataset.expanded = willExpand ? "true" : "false";
      syncExpandButton(expandBtn, willExpand);
    };
    actionSlot.appendChild(expandBtn);
  } else if (container.dataset.expanded !== "true") {
    container.classList.add("collapsed");
  }

  syncExpandButton(expandBtn, container.dataset.expanded === "true");
  return true;
}

function syncExpandButton(button, isExpanded) {
  button.innerHTML = isExpanded
    ? '<span class="icon">▲</span> 收起'
    : '<span class="icon">▼</span> 展开';
}

async function renderSecondaryTagDropdown(secondaryGroup, primaryTag) {
  secondaryGroup.querySelectorAll(".secondary-filter-dropdown").forEach((el) => el.remove());
  secondaryGroup.querySelectorAll(".multi-select-trigger.is-disabled").forEach((el) => el.remove());

  // 移除原有的隐藏逻辑，始终显示子标签
  // 当 primaryTag 为空时，后端会返回所有文件的二级标签去重
  secondaryGroup.classList.remove("is-empty");
  secondaryGroup.style.display = "flex";
  secondaryGroup.style.visibility = "visible";

  try {
    // 后端已支持空 primaryTag，返回所有二级标签去重
    const secondaryTags = await GetSecondaryTags(primaryTag || "");
    if (!secondaryTags.length) {
      secondaryGroup.classList.add("is-empty");
      secondaryGroup.style.visibility = "hidden";
      return;
    }

    secondaryTags.sort((a, b) => a.localeCompare(b, "zh-CN"));

    const dropdown = document.createElement("div");
    dropdown.className = "multi-select-dropdown secondary-filter-dropdown";
    const selectedCount = appState.selectedSecondaryTags.length;
    dropdown.innerHTML = `
      <button type="button" class="select-trigger multi-select-trigger">${selectedCount ? `已选 ${selectedCount} 个` : "全部"}</button>
      <div class="select-menu multi-select-menu hidden">
        <div class="multi-select-search-wrapper">
          <input type="text" class="multi-select-search-input" placeholder="筛选子标签...">
        </div>
        <div class="multi-select-options"></div>
      </div>
    `;

    const trigger = dropdown.querySelector(".multi-select-trigger");
    const menu = dropdown.querySelector(".multi-select-menu");
    const searchInput = dropdown.querySelector(".multi-select-search-input");
    const optionsContainer = dropdown.querySelector(".multi-select-options");

    // 渲染选项的函数
    const renderOptions = (filterText = "") => {
      optionsContainer.innerHTML = "";
      const filteredTags = filterText
        ? secondaryTags.filter((tag) => tag.toLowerCase().includes(filterText.toLowerCase()))
        : secondaryTags;

      filteredTags.forEach((tag) => {
        const label = document.createElement("label");
        label.className = "multi-select-option";
        label.innerHTML = `
          <input type="checkbox" value="${escapeHtml(tag)}" ${appState.selectedSecondaryTags.includes(tag) ? "checked" : ""}>
          <span>${escapeHtml(tag)}</span>
        `;
        label.querySelector("input").addEventListener("change", (event) => {
          if (event.target.checked) {
            if (!appState.selectedSecondaryTags.includes(tag)) {
              appState.selectedSecondaryTags.push(tag);
            }
          } else {
            appState.selectedSecondaryTags = appState.selectedSecondaryTags.filter((item) => item !== tag);
          }
          trigger.textContent = appState.selectedSecondaryTags.length ? `已选 ${appState.selectedSecondaryTags.length} 个` : "全部";

          // 选中后清除输入框并重新渲染所有选项
          searchInput.value = "";
          renderOptions();

          performSearch();
        });
        optionsContainer.appendChild(label);
      });
    };

    // 初始渲染所有选项
    renderOptions();

    // 输入筛选事件
    searchInput.addEventListener("input", (event) => {
      renderOptions(event.target.value);
    });

    // 阻止输入框点击事件冒泡，避免关闭菜单
    searchInput.addEventListener("click", (event) => {
      event.stopPropagation();
    });

    // 阻止输入框键盘事件冒泡
    searchInput.addEventListener("keydown", (event) => {
      event.stopPropagation();
    });

    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleFilterMenu(trigger, menu);
    });

    secondaryGroup.appendChild(dropdown);
  } catch (error) {
    console.error("获取二级标签失败:", error);
    secondaryGroup.classList.add("is-empty");
    secondaryGroup.style.display = "flex";
    secondaryGroup.style.visibility = "hidden";
  }
}

function createSecondaryTagButton(tag) {
  const button = document.createElement("button");
  button.className = "secondary-tag-btn";
  button.textContent = tag;
  button.dataset.tag = tag;

  if (appState.selectedSecondaryTags.includes(tag)) {
    button.classList.add("active");
  }

  button.addEventListener("click", function () {
    toggleSecondaryTag(tag, button);
  });

  return button;
}

function createLocationTagButton(location) {
  const button = document.createElement("button");
  button.className = "location-tag-btn";
  button.textContent = getLocationDisplayName(location);
  button.dataset.location = location;

  if (appState.selectedLocations.includes(location)) {
    button.classList.add("active");
  }

  button.addEventListener("click", function () {
    toggleLocationFilter(location, button);
  });

  return button;
}

function toggleSecondaryTag(tag, button) {
  const index = appState.selectedSecondaryTags.indexOf(tag);
  if (index > -1) {
    appState.selectedSecondaryTags.splice(index, 1);
    button.classList.remove("active");
  } else {
    appState.selectedSecondaryTags.push(tag);
    button.classList.add("active");
  }
  performSearch();
}

export function renderLocationFilterDropdown(locationContainer) {
  const group = document.createElement("div");
  group.className = "filter-select-group location-filter-group";
  group.innerHTML = '<span class="filter-label">位置</span>';

  const dropdown = document.createElement("div");
  dropdown.className = "multi-select-dropdown location-filter-dropdown";
  dropdown.innerHTML = `
    <button type="button" id="location-filter-trigger" class="select-trigger multi-select-trigger"></button>
    <div id="location-filter-menu" class="select-menu multi-select-menu hidden"></div>
  `;

  const trigger = dropdown.querySelector("#location-filter-trigger");
  const menu = dropdown.querySelector("#location-filter-menu");

  LOCATION_FILTERS.forEach((tag) => {
    const label = document.createElement("label");
    label.className = "multi-select-option";
    label.innerHTML = `
      <input type="checkbox" value="${tag}" ${appState.selectedLocations.includes(tag) ? "checked" : ""}>
      <span>${getLocationDisplayName(tag)}</span>
    `;
    label.querySelector("input").addEventListener("change", (event) => {
      if (event.target.checked) {
        if (!appState.selectedLocations.includes(tag)) {
          appState.selectedLocations.push(tag);
        }
      } else {
        appState.selectedLocations = appState.selectedLocations.filter((item) => item !== tag);
      }
      updateLocationFilterDropdownUI();
      performSearch();
    });
    menu.appendChild(label);
  });

  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleFilterMenu(trigger, menu);
  });

  group.appendChild(dropdown);
  locationContainer.appendChild(group);
  updateLocationFilterDropdownUI();
}

export function updateLocationFilterDropdownUI() {
  const trigger = document.getElementById("location-filter-trigger");
  const menu = document.getElementById("location-filter-menu");
  if (!trigger || !menu) return;

  trigger.textContent = appState.selectedLocations.length
    ? `已选 ${appState.selectedLocations.length} 个`
    : "全部";

  menu.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
    checkbox.checked = appState.selectedLocations.includes(checkbox.value);
  });
}

export function toggleLocationFilter(location, button) {
  const index = appState.selectedLocations.indexOf(location);
  if (index > -1) {
    appState.selectedLocations.splice(index, 1);
    button.classList.remove("active");
  } else {
    appState.selectedLocations.push(location);
    button.classList.add("active");
  }
  performSearch();
}

export async function resetFilters() {
  if (appState.isLoading) {
    console.log("正在加载中，请稍候...");
    return;
  }

  appState.isLoading = true;
  showFileListLoading("正在重置筛选...");

  try {
    document.getElementById("search-input").value = "";
    appState.searchQuery = "";

    document.querySelectorAll(".primary-tag-btn").forEach((btn) => {
      btn.classList.remove("active");
      if (btn.dataset.value === "") {
        btn.classList.add("active");
      }
    });
    appState.selectedPrimaryTag = "";
    updatePrimaryTagDropdownUI();
    const secondaryFilterInput = document.getElementById("classic-secondary-filter-input");
    if (secondaryFilterInput) secondaryFilterInput.value = "";

    appState.selectedSecondaryTags = [];
    appState.selectedLocations = [];
    document.querySelectorAll(".location-tag-btn").forEach((btn) => {
      btn.classList.remove("active");
    });
    updateLocationFilterDropdownUI();

    await renderSecondaryTags("");

    appState.sortType = "name";
    appState.sortOrder = "asc";
    updateSortButtonUI();

    await performSearch();
  } finally {
    appState.isLoading = false;
    hideFileListLoading();
  }
}

export function handleSearch(event) {
  appState.searchQuery = event.target.value;
  performSearch();
}

export async function performSearch() {
  try {
    console.log(
      "执行搜索，查询词:", appState.searchQuery,
      "一级标签:", appState.selectedPrimaryTag,
      "二级标签:", appState.selectedSecondaryTags,
      "位置:", appState.selectedLocations
    );

    if (
      !appState.searchQuery &&
      !appState.selectedPrimaryTag &&
      appState.selectedSecondaryTags.length === 0
    ) {
      appState.vpkFiles = [...appState.allVpkFiles];
    } else {
      const results = await SearchVPKFiles(
        appState.searchQuery,
        appState.selectedPrimaryTag,
        appState.selectedSecondaryTags
      );
      appState.vpkFiles = results;
    }

    if (appState.selectedLocations.length > 0) {
      appState.vpkFiles = appState.vpkFiles.filter((file) =>
        appState.selectedLocations.includes(file.location)
      );
    }

    if (!appState.showHidden) {
      appState.vpkFiles = appState.vpkFiles.filter(
        (file) => !file.name.startsWith("_")
      );
    }

    applySort(appState.vpkFiles);
    renderFileList();
    updateStatusBar();

    console.log(`搜索完成，显示 ${appState.vpkFiles.length} 个文件`);
  } catch (error) {
    console.error("搜索失败:", error);
    showError("搜索失败: " + error);
  }
}

export function toggleFilterMenu(trigger, menu) {
  const willOpen = menu.classList.contains("hidden");
  closeFilterMenus(willOpen ? menu : null);

  if (!willOpen) {
    menu.classList.add("hidden");
    return;
  }

  menu.classList.remove("hidden");
}

export function closeFilterMenus(exceptMenu = null) {
  document.querySelectorAll(".select-menu, .multi-select-menu").forEach((menu) => {
    if (menu !== exceptMenu) {
      menu.classList.add("hidden");
    }
  });
}

export async function refreshFilesKeepFilter() {
  resetBoxSelection();

  if (!appState.currentDirectory) {
    showNotification("请先选择目录", "info");
    return;
  }

  if (appState.isLoading) {
    console.log("正在加载中，请稍候...");
    return;
  }

  const currentFilters = {
    searchText: document.getElementById("search-input")?.value || "",
    primaryTag: appState.selectedPrimaryTag || "",
    secondaryTags: [...appState.selectedSecondaryTags],
    locationTags: [...appState.selectedLocations],
  };

  appState.isLoading = true;
  showFileListLoading("正在刷新文件列表...");

  try {
    await ScanVPKFiles();

    const [files, primaryTags] = await Promise.all([
      GetVPKFiles(),
      GetPrimaryTags(),
    ]);

    applySort(files);

    appState.allVpkFiles = files;
    appState.primaryTags = primaryTags;

    appState.searchQuery = currentFilters.searchText || "";
    appState.selectedPrimaryTag = currentFilters.primaryTag || "";
    appState.selectedSecondaryTags = currentFilters.secondaryTags || [];
    appState.selectedLocations = currentFilters.locationTags || [];

    await renderTagFilters();

    const searchInput = document.getElementById("search-input");
    if (searchInput) {
      searchInput.value = currentFilters.searchText || "";
    }

    await performSearch();

    const currentFilePaths = new Set(appState.allVpkFiles.map((f) => f.path));
    for (const path of appState.selectedFiles) {
      if (!currentFilePaths.has(path)) {
        appState.selectedFiles.delete(path);
      }
    }

    updateStatusBar();

    console.log("文件列表已刷新，筛选状态已恢复");
  } catch (error) {
    console.error("刷新文件列表失败:", error);
    showError("刷新失败: " + error);
  } finally {
    appState.isLoading = false;
    hideFileListLoading();
  }
}
