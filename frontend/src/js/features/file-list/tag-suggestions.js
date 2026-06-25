import { appState } from "../state.js";

const MAX_VISIBLE_SUGGESTIONS = 10;

function normalizeTag(tag) {
  return String(tag || "").trim();
}

function getExistingSecondaryTags() {
  const tagSet = new Set();
  const files = [...(appState.allVpkFiles || []), ...(appState.vpkFiles || [])];

  files.forEach((file) => {
    (file.secondaryTags || []).forEach((tag) => {
      const normalized = normalizeTag(tag);
      if (normalized) tagSet.add(normalized);
    });
  });

  return Array.from(tagSet).sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function createSuggestionButton(tag, onChoose) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tag-suggestion-option";
  button.setAttribute("role", "option");
  button.textContent = tag;
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  button.addEventListener("click", () => {
    onChoose(tag);
  });
  return button;
}

export function createSecondaryTagPicker({
  input,
  menu,
  getSelectedTags,
  addTag,
}) {
  if (!input || !menu || !getSelectedTags || !addTag) return null;

  let visibleTags = [];
  let activeIndex = -1;

  const close = () => {
    menu.classList.add("hidden");
    input.setAttribute("aria-expanded", "false");
    activeIndex = -1;
  };

  const setActiveIndex = (nextIndex) => {
    activeIndex = nextIndex;
    menu.querySelectorAll(".tag-suggestion-option").forEach((option, index) => {
      option.classList.toggle("active", index === activeIndex);
    });
  };

  const getFilteredTags = () => {
    const query = normalizeTag(input.value).toLowerCase();
    const selectedTags = new Set((getSelectedTags() || []).map(normalizeTag));

    return getExistingSecondaryTags()
      .filter((tag) => !selectedTags.has(tag))
      .filter((tag) => !query || tag.toLowerCase().includes(query))
      .sort((a, b) => {
        const aStarts = a.toLowerCase().startsWith(query);
        const bStarts = b.toLowerCase().startsWith(query);
        if (aStarts !== bStarts) return aStarts ? -1 : 1;
        return a.localeCompare(b, "zh-CN");
      })
      .slice(0, MAX_VISIBLE_SUGGESTIONS);
  };

  const render = () => {
    activeIndex = -1;
    visibleTags = getFilteredTags();
    menu.replaceChildren();

    if (visibleTags.length === 0) {
      close();
      return;
    }

    visibleTags.forEach((tag) => {
      menu.appendChild(
        createSuggestionButton(tag, (selectedTag) => {
          if (addTag(selectedTag) !== false) {
            input.value = "";
          }
          input.focus();
          close();
        }),
      );
    });
  };

  const open = () => {
    render();
    if (visibleTags.length === 0) return;
    menu.classList.remove("hidden");
    input.setAttribute("aria-expanded", "true");
  };

  const refresh = () => {
    if (document.activeElement === input || !menu.classList.contains("hidden")) {
      open();
    }
  };

  input.addEventListener("focus", open);
  input.addEventListener("click", open);
  input.addEventListener("input", open);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      close();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (menu.classList.contains("hidden")) {
        open();
      }
      if (visibleTags.length === 0) return;
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex =
        (activeIndex + direction + visibleTags.length) % visibleTags.length;
      setActiveIndex(nextIndex);
      return;
    }

    if (event.key === "Enter" && activeIndex >= 0 && visibleTags[activeIndex]) {
      event.preventDefault();
      if (addTag(visibleTags[activeIndex]) !== false) {
        input.value = "";
      }
      close();
    }
  });

  document.addEventListener("click", (event) => {
    if (event.target !== input && !menu.contains(event.target)) {
      close();
    }
  });

  return { close, refresh };
}