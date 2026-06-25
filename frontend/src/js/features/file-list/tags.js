import { appState } from "../state.js";
import { showError, showNotification } from "../../core/toast.js";
import { SetVPKTags } from "../../../../wailsjs/go/app/App";
import { refreshFilesKeepFilter } from "./filters.js";
import { createSecondaryTagPicker } from "./tag-suggestions.js";

let currentEditingTagsFile = null;
let currentSecondaryTags = [];
let secondaryTagPicker = null;

const PRIMARY_TAG_FALLBACK_LABEL = "无";

function getPrimaryTagDropdownElements() {
  return {
    valueInput: document.getElementById("primary-tag-select"),
    trigger: document.getElementById("primary-tag-trigger"),
    menu: document.getElementById("primary-tag-menu"),
    dropdown: document.getElementById("primary-tag-dropdown"),
  };
}

function closePrimaryTagDropdown() {
  const { trigger, menu } = getPrimaryTagDropdownElements();
  if (!trigger || !menu) return;

  menu.classList.add("hidden");
  trigger.setAttribute("aria-expanded", "false");
}

function updatePrimaryTagDropdownUI() {
  const { valueInput, trigger, menu } = getPrimaryTagDropdownElements();
  if (!valueInput || !trigger || !menu) return;

  const selectedValue = valueInput.value || "";
  const selectedOption = Array.from(menu.querySelectorAll(".select-option")).find(
    (option) => option.dataset.value === selectedValue,
  );

  trigger.textContent = selectedOption?.textContent.trim() || PRIMARY_TAG_FALLBACK_LABEL;
  menu.querySelectorAll(".select-option").forEach((option) => {
    const isActive = option.dataset.value === selectedValue;
    option.classList.toggle("active", isActive);
    option.setAttribute("aria-selected", String(isActive));
  });
}

function setPrimaryTagValue(value) {
  const { valueInput } = getPrimaryTagDropdownElements();
  if (!valueInput) return;

  valueInput.value = value || "";
  updatePrimaryTagDropdownUI();
}

function setupPrimaryTagDropdown() {
  const { trigger, menu, dropdown } = getPrimaryTagDropdownElements();
  if (!trigger || !menu || !dropdown) return;
  if (dropdown.dataset.initialized === "true") {
    updatePrimaryTagDropdownUI();
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
      setPrimaryTagValue(option.dataset.value || "");
      closePrimaryTagDropdown();
    });
  });

  document.addEventListener("click", (event) => {
    if (!dropdown.contains(event.target)) {
      closePrimaryTagDropdown();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closePrimaryTagDropdown();
    }
  });

  updatePrimaryTagDropdownUI();
}

export function openSetTagsModal(filePath) {
  const file =
    (appState.vpkFiles || []).find((f) => f.path === filePath) ||
    (appState.allVpkFiles || []).find((f) => f.path === filePath);

  if (!file) {
    console.error("File not found for setting tags:", filePath);
    return;
  }

  currentEditingTagsFile = filePath;
  currentSecondaryTags = [...(file.secondaryTags || [])];

  const modal = document.getElementById("set-tags-modal");
  const input = document.getElementById("new-secondary-tag-input");

  setPrimaryTagValue(file.primaryTag || "");
  renderEditTagsList();
  if (input) input.value = "";
  secondaryTagPicker?.close();

  if (modal) modal.classList.remove("hidden");
}

export function renderEditTagsList() {
  const container = document.getElementById("secondary-tags-list");
  if (!container) return;
  container.replaceChildren();

  currentSecondaryTags.forEach((tag, index) => {
    const tagEl = document.createElement("span");
    tagEl.className = "tag-badge";

    const tagText = document.createElement("span");
    tagText.textContent = tag;

    const removeBtn = document.createElement("span");
    removeBtn.className = "tag-remove-btn";
    removeBtn.title = "删除";
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", () => {
      currentSecondaryTags.splice(index, 1);
      renderEditTagsList();
    });

    tagEl.appendChild(tagText);
    tagEl.appendChild(removeBtn);
    container.appendChild(tagEl);
  });

  secondaryTagPicker?.refresh();
}

function addSecondaryTag(tag) {
  const val = String(tag || "").trim();
  if (!val || currentSecondaryTags.includes(val)) return false;

  currentSecondaryTags.push(val);
  renderEditTagsList();
  return true;
}

function addSecondaryTagFromInput(input) {
  if (!input) return;
  if (addSecondaryTag(input.value)) {
    input.value = "";
    secondaryTagPicker?.refresh();
  }
}

export function setupTagModalListeners() {
  const clearTagsBtn = document.getElementById("clear-tags-btn");
  if (clearTagsBtn) {
    clearTagsBtn.addEventListener("click", () => {
      setPrimaryTagValue("");
      currentSecondaryTags = [];
      renderEditTagsList();
    });
  }

  setupPrimaryTagDropdown();

  const addTagBtn = document.getElementById("add-secondary-tag-btn");
  if (addTagBtn) {
    addTagBtn.addEventListener("click", () => {
      const input = document.getElementById("new-secondary-tag-input");
      addSecondaryTagFromInput(input);
    });
  }

  const newTagInput = document.getElementById("new-secondary-tag-input");
  if (newTagInput) {
    secondaryTagPicker = createSecondaryTagPicker({
      input: newTagInput,
      menu: document.getElementById("secondary-tag-suggestions"),
      getSelectedTags: () => currentSecondaryTags,
      addTag: addSecondaryTag,
    });

    newTagInput.addEventListener("keydown", (e) => {
      if (e.defaultPrevented) return;
      if (e.key === "Enter") {
        addSecondaryTagFromInput(e.target);
      }
    });
  }

  const saveTagsBtn = document.getElementById("save-tags-btn");
  if (saveTagsBtn) {
    saveTagsBtn.addEventListener("click", async () => {
      const modal = document.getElementById("set-tags-modal");
      const primarySelect = document.getElementById("primary-tag-select");

      const pTag = primarySelect?.value || "";
      const sTags = currentSecondaryTags;

      try {
        await SetVPKTags(currentEditingTagsFile, pTag, sTags);
        modal.classList.add("hidden");
        secondaryTagPicker?.close();
        showNotification("标签已更新", "success");
        await refreshFilesKeepFilter();
      } catch (err) {
        showError("更新标签失败: " + err);
      }
    });
  }

  const closeTagModalBtns = ["close-set-tags-modal-btn", "cancel-set-tags-btn"];
  closeTagModalBtns.forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.addEventListener("click", () => {
        document.getElementById("set-tags-modal").classList.add("hidden");
        secondaryTagPicker?.close();
      });
    }
  });
}
