import { appState } from "../state.js";
import { showNotification, showError } from "../../core/toast.js";
import { renderFileList } from "./render.js";
import { GetAddonListOrder } from "../../../../wailsjs/go/app/App";

export function setupSortEvents() {
  const sortBtn = document.getElementById("sort-btn");
  const dropdown = document.getElementById("sort-dropdown-content");

  if (sortBtn && dropdown) {
    sortBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.classList.toggle("hidden");
    });

    document.addEventListener("click", (e) => {
      if (!sortBtn.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.add("hidden");
      }
    });
  }

  document
    .getElementById("sort-name-btn")
    ?.addEventListener("click", () => handleSortChange("name"));
  document
    .getElementById("sort-date-btn")
    ?.addEventListener("click", () => handleSortChange("date"));
  document
    .getElementById("sort-load-order-btn")
    ?.addEventListener("click", () => handleLoadOrderSort());

  updateSortButtonUI();
}

export async function handleLoadOrderSort() {
  document.getElementById("sort-dropdown-content")?.classList.add("hidden");

  try {
    const orderList = await GetAddonListOrder();
    console.log("获取到加载顺序:", orderList.length, "个条目");

    appState.loadOrderMap.clear();
    orderList.forEach((name, index) => {
      appState.loadOrderMap.set(name.toLowerCase(), index);
    });

    appState.sortType = "loadOrder";
    appState.sortOrder = "asc";

    updateSortButtonUI();
    applySort(appState.vpkFiles);
    renderFileList();

    showNotification("已按加载顺序排序", "success");
  } catch (err) {
    console.error("获取加载顺序失败:", err);
    showError("addonlist.txt 错误: " + err);
  }
}

export function handleSortChange(type) {
  if (appState.sortType === type) {
    appState.sortOrder = appState.sortOrder === "asc" ? "desc" : "asc";
  } else {
    appState.sortType = type;
    appState.sortOrder = type === "date" ? "desc" : "asc";
  }

  updateSortButtonUI();
  document.getElementById("sort-dropdown-content")?.classList.add("hidden");

  applySort(appState.vpkFiles);
  renderFileList();
}

export function updateSortButtonUI() {
  const btnText = document.getElementById("sort-btn-text");
  const nameBtn = document.getElementById("sort-name-btn");
  const dateBtn = document.getElementById("sort-date-btn");
  const loadOrderBtn = document.getElementById("sort-load-order-btn");

  let text = "文件名排序";
  let arrow = "";

  if (appState.sortType === "name") {
    text = "文件名排序";
    arrow = appState.sortOrder === "asc" ? "(A-Z)" : "(Z-A)";
  } else if (appState.sortType === "date") {
    text = "更新时间排序";
    arrow = appState.sortOrder === "desc" ? "(最新)" : "(最旧)";
  } else if (appState.sortType === "loadOrder") {
    text = "加载顺序排序";
    arrow = appState.sortOrder === "asc" ? "(顺序)" : "(倒序)";
  }

  if (btnText) btnText.textContent = `${text} ${arrow}`;

  if (nameBtn) {
    nameBtn.classList.toggle("active", appState.sortType === "name");
  }
  if (dateBtn) {
    dateBtn.classList.toggle("active", appState.sortType === "date");
  }
  if (loadOrderBtn) {
    loadOrderBtn.classList.toggle("active", appState.sortType === "loadOrder");
  }
}

export function applySort(files) {
  return files.sort((a, b) => {
    let result = 0;

    if (appState.sortType === "date") {
      const dateA = a.lastModified ? new Date(a.lastModified).getTime() : 0;
      const dateB = b.lastModified ? new Date(b.lastModified).getTime() : 0;
      result = dateA - dateB;
    } else if (appState.sortType === "loadOrder") {
      const nameA = a.name.toLowerCase();
      const nameB = b.name.toLowerCase();

      const inListA = appState.loadOrderMap.has(nameA);
      const inListB = appState.loadOrderMap.has(nameB);

      if (inListA && inListB) {
        result = appState.loadOrderMap.get(nameA) - appState.loadOrderMap.get(nameB);
      } else if (!inListA && !inListB) {
        result = nameA.localeCompare(nameB, "zh-CN", {
          numeric: true,
          sensitivity: "accent",
        });
      } else {
        if (inListA) {
          result = -1;
        } else {
          result = 1;
        }
      }
      return result;
    } else {
      const nameA = a.name.toLowerCase();
      const nameB = b.name.toLowerCase();

      result = nameA.localeCompare(nameB, "zh-CN", {
        numeric: true,
        sensitivity: "accent",
      });
    }

    if (appState.sortOrder === "desc") {
      result = -result;
    }

    if (result === 0) {
      if (appState.sortType === "date") {
        return a.name.localeCompare(b.name, "zh-CN", { numeric: true });
      }
      return a.path.localeCompare(b.path);
    }

    return result;
  });
}
