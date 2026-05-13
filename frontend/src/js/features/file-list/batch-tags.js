import {
  appState,
  showLoadingScreen,
  showMainScreen,
  updateLoadingMessage,
} from "../state.js";
import { showError, showNotification } from "../../core/toast.js";
import { SetVPKTags } from "../../../../wailsjs/go/app/App";
import { refreshFilesKeepFilter } from "./filters.js";

let primaryMode = "keep";
let secondaryMode = "keep";
let batchPrimaryTag = "";
let batchSecondaryTags = [];

const PRIMARY_FALLBACK_LABEL = "无";

const HINTS = {
  append: (count, fileCount) =>
    count === 0
      ? "请输入要追加的标签"
      : `将这 ${count} 个标签追加到 ${fileCount} 个文件的现有标签`,
  set: (count, fileCount) =>
    count === 0
      ? `将清空 ${fileCount} 个文件的二级标签`
      : `用这 ${count} 个标签覆盖 ${fileCount} 个文件的现有标签`,
};

function getPrimaryDropdownElements() {
  return {
    valueInput: document.getElementById("batch-primary-select"),
    trigger: document.getElementById("batch-primary-trigger"),
    menu: document.getElementById("batch-primary-menu"),
    dropdown: document.getElementById("batch-primary-dropdown"),
  };
}

function closePrimaryDropdown() {
  const { trigger, menu } = getPrimaryDropdownElements();
  if (!trigger || !menu) return;
  menu.classList.add("hidden");
  trigger.setAttribute("aria-expanded", "false");
}

function updatePrimaryDropdownUI() {
  const { valueInput, trigger, menu } = getPrimaryDropdownElements();
  if (!valueInput || !trigger || !menu) return;

  const selectedValue = valueInput.value || "";
  const selectedOption = Array.from(
    menu.querySelectorAll(".select-option"),
  ).find((option) => option.dataset.value === selectedValue);

  trigger.textContent =
    selectedOption?.textContent.trim() || PRIMARY_FALLBACK_LABEL;
  menu.querySelectorAll(".select-option").forEach((option) => {
    const isActive = option.dataset.value === selectedValue;
    option.classList.toggle("active", isActive);
    option.setAttribute("aria-selected", String(isActive));
  });
}

function setPrimaryValue(value) {
  const { valueInput } = getPrimaryDropdownElements();
  if (!valueInput) return;
  valueInput.value = value || "";
  batchPrimaryTag = valueInput.value;
  updatePrimaryDropdownUI();
}

function setupPrimaryDropdown() {
  const { trigger, menu, dropdown } = getPrimaryDropdownElements();
  if (!trigger || !menu || !dropdown) return;
  if (dropdown.dataset.initialized === "true") {
    updatePrimaryDropdownUI();
    return;
  }
  dropdown.dataset.initialized = "true";

  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    const isOpening = menu.classList.contains("hidden");
    menu.classList.toggle("hidden", !isOpening);
    trigger.setAttribute("aria-expanded", String(isOpening));
  });

  menu.querySelectorAll(".select-option").forEach((option) => {
    option.addEventListener("click", (event) => {
      event.stopPropagation();
      setPrimaryValue(option.dataset.value || "");
      closePrimaryDropdown();
    });
  });

  document.addEventListener("click", (event) => {
    if (!dropdown.contains(event.target)) {
      closePrimaryDropdown();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closePrimaryDropdown();
    }
  });

  updatePrimaryDropdownUI();
}

function renderSecondaryList() {
  const container = document.getElementById("batch-secondary-tags-list");
  if (!container) return;
  container.innerHTML = "";

  batchSecondaryTags.forEach((tag, index) => {
    const tagEl = document.createElement("span");
    tagEl.className = "tag-badge";
    tagEl.innerHTML = `
      ${tag}
      <span class="tag-remove-btn" title="删除">&times;</span>
    `;
    tagEl.querySelector(".tag-remove-btn").addEventListener("click", () => {
      batchSecondaryTags.splice(index, 1);
      renderSecondaryList();
      updateSecondaryHint();
      updateSaveButtonState();
    });
    container.appendChild(tagEl);
  });
}

function getSelectedFileCount() {
  return appState.selectedFiles.size;
}

function updateSecondaryHint() {
  const hintEl = document.getElementById("batch-secondary-hint");
  if (!hintEl) return;
  const count = batchSecondaryTags.length;
  const fileCount = getSelectedFileCount();

  if (secondaryMode === "append" || secondaryMode === "set") {
    hintEl.textContent = HINTS[secondaryMode](count, fileCount);
    hintEl.classList.toggle("empty", count === 0);
  } else {
    hintEl.textContent = "";
    hintEl.classList.remove("empty");
  }
}

function updateActionAreasVisibility() {
  const primaryArea = document.getElementById("batch-primary-action-area");
  const secondaryArea = document.getElementById("batch-secondary-action-area");
  if (primaryArea) {
    primaryArea.classList.toggle("hidden", primaryMode !== "set");
  }
  if (secondaryArea) {
    const visible = secondaryMode === "append" || secondaryMode === "set";
    secondaryArea.classList.toggle("hidden", !visible);
  }
}

function updateModeSlider(group) {
  if (!group) return;
  const slider = group.querySelector(".mode-toggle-slider");
  const active = group.querySelector(".mode-option.active");
  if (!slider || !active) return;

  const groupRect = group.getBoundingClientRect();
  const activeRect = active.getBoundingClientRect();
  if (groupRect.width === 0 || activeRect.width === 0) return;

  const offsetX = activeRect.left - groupRect.left;
  slider.style.width = `${activeRect.width}px`;
  slider.style.transform = `translateX(${offsetX}px)`;
  slider.classList.add("ready");
}

function refreshAllSliders() {
  document.querySelectorAll(".batch-mode-group").forEach((group) => {
    updateModeSlider(group);
  });
}

function updateModeButtonStates() {
  document.querySelectorAll(".batch-mode-group").forEach((group) => {
    const target = group.dataset.target;
    const mode = target === "primary" ? primaryMode : secondaryMode;
    group.querySelectorAll(".mode-option").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === mode);
    });
    updateModeSlider(group);
  });
}

function shouldEnableSave() {
  if (primaryMode === "keep" && secondaryMode === "keep") return false;
  if (
    primaryMode === "keep" &&
    secondaryMode === "append" &&
    batchSecondaryTags.length === 0
  ) {
    return false;
  }
  return true;
}

function updateSaveButtonState() {
  const btn = document.getElementById("save-batch-set-tags-btn");
  if (!btn) return;
  btn.disabled = !shouldEnableSave();
}

function computePrimary(file) {
  if (primaryMode === "set") return batchPrimaryTag;
  return file.primaryTag || "";
}

function computeSecondary(file) {
  const current = file.secondaryTags || [];
  if (secondaryMode === "append") {
    const merged = [...current];
    batchSecondaryTags.forEach((t) => {
      if (!merged.includes(t)) merged.push(t);
    });
    return merged;
  }
  if (secondaryMode === "set") return [...batchSecondaryTags];
  return current;
}

async function saveBatchTags() {
  const paths = Array.from(appState.selectedFiles);
  const files = paths
    .map(
      (p) =>
        (appState.vpkFiles || []).find((f) => f.path === p) ||
        (appState.allVpkFiles || []).find((f) => f.path === p),
    )
    .filter(Boolean);

  if (files.length === 0) {
    showNotification("没有可处理的文件", "info");
    return;
  }

  const modal = document.getElementById("batch-set-tags-modal");

  updateLoadingMessage("正在批量编辑标签...");
  showLoadingScreen();

  let success = 0;
  let fail = 0;
  const errors = [];

  for (const file of files) {
    const newPrimary = computePrimary(file);
    const newSecondary = computeSecondary(file);
    try {
      await SetVPKTags(file.path, newPrimary, newSecondary);
      success++;
    } catch (e) {
      fail++;
      errors.push(`${file.name}: ${e}`);
    }
  }

  if (modal) modal.classList.add("hidden");
  await refreshFilesKeepFilter();
  showMainScreen();

  if (fail > 0) {
    showNotification(
      `完成: 成功 ${success} 个, 失败 ${fail} 个`,
      "warning",
    );
    console.error("批量编辑标签失败详情:", errors);
  } else {
    showNotification(`成功更新 ${success} 个文件的标签`, "success");
  }
}

export function openBatchSetTagsModal() {
  if (appState.selectedFiles.size === 0) {
    showNotification("请先选择文件", "info");
    return;
  }

  primaryMode = "keep";
  secondaryMode = "keep";
  setPrimaryValue("");

  const countEl = document.getElementById("batch-tags-file-count");
  if (countEl) countEl.textContent = String(appState.selectedFiles.size);

  const input = document.getElementById("batch-new-secondary-tag-input");
  if (input) input.value = "";

  updateModeButtonStates();
  updateActionAreasVisibility();
  renderSecondaryList();
  updateSecondaryHint();
  updateSaveButtonState();

  const modal = document.getElementById("batch-set-tags-modal");
  if (modal) modal.classList.remove("hidden");

  // 弹框显示后再计算滑块位置（hidden 状态下 getBoundingClientRect 返回 0）
  requestAnimationFrame(() => {
    refreshAllSliders();
  });
}

function addSecondaryTagFromInput() {
  const input = document.getElementById("batch-new-secondary-tag-input");
  if (!input) return;
  const val = input.value.trim();
  if (val && !batchSecondaryTags.includes(val)) {
    batchSecondaryTags.push(val);
    input.value = "";
    renderSecondaryList();
    updateSecondaryHint();
    updateSaveButtonState();
  }
}

function resetBatchTags() {
  primaryMode = "set";
  secondaryMode = "set";
  batchPrimaryTag = "";
  batchSecondaryTags = [];
  setPrimaryValue("");
  updateModeButtonStates();
  updateActionAreasVisibility();
  renderSecondaryList();
  updateSecondaryHint();
  updateSaveButtonState();
}

export function setupBatchTagsModalListeners() {
  setupPrimaryDropdown();

  document.querySelectorAll(".batch-mode-group .mode-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      const group = btn.closest(".batch-mode-group");
      const target = group?.dataset.target;
      const mode = btn.dataset.mode;
      if (!target || !mode) return;

      if (target === "primary") {
        primaryMode = mode;
      } else {
        secondaryMode = mode;
      }

      updateModeButtonStates();
      updateActionAreasVisibility();
      updateSecondaryHint();
      updateSaveButtonState();
    });
  });

  const addBtn = document.getElementById("batch-add-secondary-tag-btn");
  if (addBtn) {
    addBtn.addEventListener("click", () => addSecondaryTagFromInput());
  }

  const input = document.getElementById("batch-new-secondary-tag-input");
  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        addSecondaryTagFromInput();
      }
    });
  }

  const saveBtn = document.getElementById("save-batch-set-tags-btn");
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      try {
        await saveBatchTags();
      } catch (err) {
        showError("批量编辑标签失败: " + err);
      }
    });
  }

  const clearBtn = document.getElementById("clear-batch-tags-btn");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      resetBatchTags();
    });
  }

  const closeBtns = [
    "close-batch-set-tags-modal-btn",
    "cancel-batch-set-tags-btn",
  ];
  closeBtns.forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.addEventListener("click", () => {
        document
          .getElementById("batch-set-tags-modal")
          ?.classList.add("hidden");
      });
    }
  });
}
