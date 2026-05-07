import { appState } from "../state.js";
import { showError, showNotification } from "../../core/toast.js";
import { SetVPKTags } from "../../../../wailsjs/go/app/App";
import { refreshFilesKeepFilter } from "./filters.js";

let currentEditingTagsFile = null;
let currentSecondaryTags = [];

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
  const primarySelect = document.getElementById("primary-tag-select");
  const input = document.getElementById("new-secondary-tag-input");

  if (primarySelect) primarySelect.value = file.primaryTag || "";
  renderEditTagsList();
  if (input) input.value = "";

  if (modal) modal.classList.remove("hidden");
}

export function renderEditTagsList() {
  const container = document.getElementById("secondary-tags-list");
  if (!container) return;
  container.innerHTML = "";

  currentSecondaryTags.forEach((tag, index) => {
    const tagEl = document.createElement("span");
    tagEl.className = "tag-badge";
    tagEl.innerHTML = `
      ${tag}
      <span class="tag-remove-btn" title="删除">&times;</span>
    `;
    tagEl.querySelector(".tag-remove-btn").addEventListener("click", () => {
      currentSecondaryTags.splice(index, 1);
      renderEditTagsList();
    });
    container.appendChild(tagEl);
  });
}

export function setupTagModalListeners() {
  const clearTagsBtn = document.getElementById("clear-tags-btn");
  if (clearTagsBtn) {
    clearTagsBtn.addEventListener("click", () => {
      const primarySelect = document.getElementById("primary-tag-select");
      if (primarySelect) primarySelect.value = "";
      currentSecondaryTags = [];
      renderEditTagsList();
    });
  }

  const addTagBtn = document.getElementById("add-secondary-tag-btn");
  if (addTagBtn) {
    addTagBtn.addEventListener("click", () => {
      const input = document.getElementById("new-secondary-tag-input");
      const val = input.value.trim();
      if (val && !currentSecondaryTags.includes(val)) {
        currentSecondaryTags.push(val);
        input.value = "";
        renderEditTagsList();
      }
    });
  }

  const newTagInput = document.getElementById("new-secondary-tag-input");
  if (newTagInput) {
    newTagInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const val = e.target.value.trim();
        if (val && !currentSecondaryTags.includes(val)) {
          currentSecondaryTags.push(val);
          e.target.value = "";
          renderEditTagsList();
        }
      }
    });
  }

  const saveTagsBtn = document.getElementById("save-tags-btn");
  if (saveTagsBtn) {
    saveTagsBtn.addEventListener("click", async () => {
      const modal = document.getElementById("set-tags-modal");
      const primarySelect = document.getElementById("primary-tag-select");

      const pTag = primarySelect.value;
      const sTags = currentSecondaryTags;

      try {
        await SetVPKTags(currentEditingTagsFile, pTag, sTags);
        modal.classList.add("hidden");
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
      });
    }
  });
}
