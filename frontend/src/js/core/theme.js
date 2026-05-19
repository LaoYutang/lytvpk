import { getConfig, saveConfig } from "./config.js";

export function initTheme() {
  const savedTheme = getConfig().theme;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

  if (savedTheme === "dark" || (!savedTheme && prefersDark)) {
    document.documentElement.classList.add("dark-mode");
  } else {
    document.documentElement.classList.remove("dark-mode");
  }
}

export function updateThemeIcon() {
  const isDark = document.documentElement.classList.contains("dark-mode");
  const sunIcon = document.querySelector("#theme-toggle-btn .sun-icon");
  const moonIcon = document.querySelector("#theme-toggle-btn .moon-icon");

  if (sunIcon && moonIcon) {
    if (isDark) {
      sunIcon.style.display = "block";
      moonIcon.style.display = "none";
    } else {
      sunIcon.style.display = "none";
      moonIcon.style.display = "block";
    }
  }

  const themeLabel = document.querySelector("#theme-toggle-btn .quick-label");
  if (themeLabel) {
    themeLabel.textContent = isDark ? "开灯模式" : "关灯模式";
  }
}

export function setupThemeToggle() {
  const themeBtn = document.getElementById("theme-toggle-btn");
  if (!themeBtn) return;

  themeBtn.addEventListener("click", () => {
    const isDark = document.documentElement.classList.toggle("dark-mode");
    const config = getConfig();
    config.theme = isDark ? "dark" : "light";
    saveConfig(config);
    updateThemeIcon();
  });

  updateThemeIcon();
}
