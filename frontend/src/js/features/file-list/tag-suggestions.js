import { appState } from "../state.js";
import { GetSecondaryTags } from "../../../../wailsjs/go/app/App";

function normalizeTag(tag) {
  return String(tag || "").trim();
}

async function getExistingSecondaryTags(primaryTag = "") {
  const tagSet = new Set();

  try {
    const tags = await GetSecondaryTags(primaryTag || "");
    (tags || []).forEach((tag) => {
      const normalized = normalizeTag(tag);
      if (normalized) tagSet.add(normalized);
    });
  } catch (error) {
    const files = [...(appState.allVpkFiles || []), ...(appState.vpkFiles || [])];

    files.forEach((file) => {
      if (primaryTag && file.primaryTag !== primaryTag) return;
      (file.secondaryTags || []).forEach((tag) => {
        const normalized = normalizeTag(tag);
        if (normalized) tagSet.add(normalized);
      });
    });
  }

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
  getPrimaryTag = () => "",
}) {
  if (!input || !menu || !getSelectedTags || !addTag) return null;

  let visibleTags = [];
  let activeIndex = -1;
  let renderRequestId = 0;

  const hideMenu = () => {
    menu.classList.add("hidden");
    input.setAttribute("aria-expanded", "false");
    activeIndex = -1;
  };

  const close = () => {
    renderRequestId += 1;
    hideMenu();
  };

  const setActiveIndex = (nextIndex) => {
    activeIndex = nextIndex;
    menu.querySelectorAll(".tag-suggestion-option").forEach((option, index) => {
      option.classList.toggle("active", index === activeIndex);
    });
  };

  const getFilteredTags = async () => {
    const query = normalizeTag(input.value).toLowerCase();
    const selectedTags = new Set((getSelectedTags() || []).map(normalizeTag));

    return (await getExistingSecondaryTags(normalizeTag(getPrimaryTag())))
      .filter((tag) => !selectedTags.has(tag))
      .filter((tag) => !query || tag.toLowerCase().includes(query))
      .sort((a, b) => {
        const aStarts = a.toLowerCase().startsWith(query);
        const bStarts = b.toLowerCase().startsWith(query);
        if (aStarts !== bStarts) return aStarts ? -1 : 1;
        return a.localeCompare(b, "zh-CN");
      });
  };

  const render = async () => {
    const requestId = ++renderRequestId;
    activeIndex = -1;
    visibleTags = await getFilteredTags();
    if (requestId !== renderRequestId) return false;

    menu.replaceChildren();

    if (visibleTags.length === 0) {
      hideMenu();
      return false;
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

    return true;
  };

  const open = async () => {
    const didRender = await render();
    if (!didRender || visibleTags.length === 0 || document.activeElement !== input) return;
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
