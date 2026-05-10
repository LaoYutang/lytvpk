import { appState, updateStatusBar, showFileListLoading, hideFileListLoading } from "../state.js";
import { showError } from "../../core/toast.js";
import { renderFileList } from "./render.js";
import { getLocationDisplayName, escapeHtml } from "../../core/utils.js";
import { applySort, updateSortButtonUI } from "./sorting.js";
import { resetBoxSelection } from "./box-selection.js";
import { GetPrimaryTags, GetSecondaryTags, SearchVPKFiles, ScanVPKFiles, GetVPKFiles } from "../../../../wailsjs/go/app/App";

export async function renderTagFilters() {
  const tagContainer = document.getElementById("tag-filters");
  const locationContainer = document.getElementById("location-filter-section");

  tagContainer.innerHTML = "";
  locationContainer.innerHTML = "";

  try {
    const primaryTags = await GetPrimaryTags();
    renderSelectBasedFilters(tagContainer, locationContainer, primaryTags);
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
    await renderSecondaryTags(appState.selectedPrimaryTag);
    performSearch();
  });

  return button;
}

export async function renderSecondaryTags(primaryTag) {
  const secondaryGroup = document.getElementById("secondary-tag-group");
  if (secondaryGroup?.classList.contains("filter-select-group")) {
    await renderSecondaryTagDropdown(secondaryGroup, primaryTag);
    return;
  }

  const existingContainer = secondaryGroup.querySelector(".secondary-tags-container");
  if (existingContainer) existingContainer.remove();

  const existingExpandBtn = secondaryGroup.querySelector(".expand-tags-btn");
  if (existingExpandBtn) existingExpandBtn.remove();

  if (!primaryTag) {
    secondaryGroup.style.display = "none";
    return;
  }

  try {
    const secondaryTags = await GetSecondaryTags(primaryTag);

    if (secondaryTags.length > 0) {
      secondaryTags.sort((a, b) => a.localeCompare(b, "zh-CN"));
      secondaryGroup.style.display = "flex";

      const container = document.createElement("div");
      container.className = "secondary-tags-container";

      secondaryTags.forEach((tag) => {
        const tagBtn = createSecondaryTagButton(tag);
        container.appendChild(tagBtn);
      });

      secondaryGroup.appendChild(container);

      if (container.scrollHeight > 30) {
        container.classList.add("collapsed");
        const expandBtn = document.createElement("button");
        expandBtn.className = "expand-tags-btn";
        expandBtn.innerHTML = '<span class="icon">▼</span> 展开';
        expandBtn.onclick = () => {
          container.classList.toggle("collapsed");
          const isCollapsed = container.classList.contains("collapsed");
          expandBtn.innerHTML = isCollapsed
            ? '<span class="icon">▼</span> 展开'
            : '<span class="icon">▲</span> 收起';
        };
        secondaryGroup.appendChild(expandBtn);
      }
    } else {
      secondaryGroup.style.display = "none";
    }
  } catch (error) {
    console.error("获取二级标签失败:", error);
    secondaryGroup.style.display = "none";
  }
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

  ["root", "workshop", "disabled"].forEach((tag) => {
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
