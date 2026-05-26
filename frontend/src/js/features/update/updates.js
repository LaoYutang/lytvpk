let getConfig;
let saveConfig;
let EventsOn;
let CheckUpdate;
let GetMirrorsInitial;
let TestMirrorsLatency;
let DoUpdate;
let RestartApplication;

export function configureUpdates(deps) {
  ({ getConfig, saveConfig, EventsOn, CheckUpdate, GetMirrorsInitial, TestMirrorsLatency, DoUpdate, RestartApplication } = deps);
}

const updateNoteCategories = [
  { key: "feat", title: "新功能", badge: "feat" },
  { key: "refactor", title: "修改", badge: "refactor" },
  { key: "fix", title: "问题修复", badge: "fix" },
];

const otherUpdateNoteCategory = {
  key: "other",
  title: "其他",
  badge: "other",
};

function parseReleaseNotes(rawNote) {
  const groups = {
    feat: [],
    refactor: [],
    fix: [],
    other: [],
  };
  let currentVersion = "";
  const lines = (rawNote || "").split(/\r?\n/);

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const versionMatch = trimmed.match(/^[【\[](.+?)[】\]]$/);
    if (versionMatch) {
      currentVersion = versionMatch[1].trim();
      return;
    }

    const listItemMatch = trimmed.match(/^[-*]\s+(.+)$/);
    const content = listItemMatch ? listItemMatch[1].trim() : trimmed;
    const typeMatch = content.match(
      /^(feat|refactor|fix)(?:\([^)]+\))?\s*:?\s*(.*)$/i
    );

    if (!typeMatch) {
      groups.other.push({ text: content, version: currentVersion });
      return;
    }

    const type = typeMatch[1].toLowerCase();
    const text = typeMatch[2].trim() || content;
    groups[type].push({ text, version: currentVersion });
  });

  return groups;
}

function renderReleaseNoteCategory(container, category, items) {
  const section = document.createElement("section");
  section.className = `update-note-category ${category.key}`;

  const header = document.createElement("div");
  header.className = "update-note-category-header";

  const badge = document.createElement("span");
  badge.className = `update-note-type-badge ${category.badge}`;
  badge.textContent = category.badge;

  const title = document.createElement("span");
  title.className = "update-note-category-title";
  title.textContent = category.title;

  const count = document.createElement("span");
  count.className = "update-note-category-count";
  count.textContent = `${items.length} 项`;

  header.append(badge, title, count);

  const list = document.createElement("ul");
  list.className = "update-note-list";

  items.forEach((item) => {
    const listItem = document.createElement("li");
    listItem.className = "update-note-item";

    const text = document.createElement("span");
    text.className = "update-note-text";
    text.textContent = item.text;

    listItem.appendChild(text);

    if (item.version) {
      const version = document.createElement("span");
      version.className = "update-note-version";
      version.textContent = item.version;
      listItem.appendChild(version);
    }

    list.appendChild(listItem);
  });

  section.append(header, list);
  container.appendChild(section);
}

function renderReleaseNotes(container, rawNote, view) {
  container.replaceChildren();
  container.classList.remove("is-category-view", "is-version-view");

  if (view === "version") {
    container.classList.add("is-version-view");
    container.textContent = rawNote || "暂无更新日志";
    return;
  }

  container.classList.add("is-category-view");
  const groups = parseReleaseNotes(rawNote);
  let hasItems = false;

  updateNoteCategories.forEach((category) => {
    const items = groups[category.key];
    if (!items.length) return;
    hasItems = true;
    renderReleaseNoteCategory(container, category, items);
  });

  if (groups.other.length) {
    hasItems = true;
    renderReleaseNoteCategory(container, otherUpdateNoteCategory, groups.other);
  }

  if (!hasItems) {
    const empty = document.createElement("div");
    empty.className = "update-note-empty";
    empty.textContent = "暂无可分类的更新内容";
    container.appendChild(empty);
  }
}

function setReleaseNotesView(container, buttons, rawNote, view) {
  buttons.forEach((button) => {
    const isActive = button.dataset.updateNotesView === view;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  renderReleaseNotes(container, rawNote, view);
}

export async function checkAndInstallUpdate() {
  try {
    const info = await CheckUpdate();

    // 更新关于页面的版本显示
    const verDisplay = document.getElementById("current-version-display");
    if (verDisplay) {
      verDisplay.textContent = `v${info.current_ver}`;
    }

    if (info.error) {
      console.error("检查更新出错:", info.error);
      return;
    }

    if (info.has_update) {
      // 检查是否已忽略此版本
      const config = getConfig();
      if (config.ignoredVersion === info.latest_ver) {
        console.log("已忽略版本:", info.latest_ver);
        return;
      }
      showUpdateModal(info);
    } else {
      console.log("当前已是最新版本");
    }
  } catch (e) {
    console.error(e);
  }
}

// 手动检查更新 (按钮触发)
export async function manualCheckUpdate() {
  const btn = document.getElementById("check-update-btn");
  const msgDiv = document.getElementById("update-status-msg");
  const verDisplay = document.getElementById("current-version-display");

  if (!btn) return;

  btn.disabled = true;
  btn.textContent = "检查中...";
  msgDiv.classList.add("hidden");
  msgDiv.className = "update-msg hidden"; // reset classes

  try {
    const info = await CheckUpdate();

    if (verDisplay) {
      verDisplay.textContent = `v${info.current_ver}`;
    }

    if (info.error) {
      msgDiv.textContent = "检查失败: " + info.error;
      msgDiv.classList.add("error");
      msgDiv.classList.remove("hidden");
    } else if (info.has_update) {
      msgDiv.innerHTML = `发现新版本: <strong>v${info.latest_ver}</strong>`;
      msgDiv.classList.add("success");
      msgDiv.classList.remove("hidden");

      showUpdateModal(info);
    } else {
      msgDiv.textContent = `当前已是最新版本 (v${info.latest_ver})`;
      msgDiv.classList.add("success");
      msgDiv.classList.remove("hidden");
    }
  } catch (e) {
    msgDiv.textContent = "发生错误: " + e;
    msgDiv.classList.add("error");
    msgDiv.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "检查更新";
  }
}

// 显示更新弹窗
export async function showUpdateModal(info) {
  const modal = document.getElementById("update-modal");
  const newVer = document.getElementById("new-version-number");
  const curVer = document.getElementById("current-version-number");
  const notes = document.getElementById("release-notes-content");
  const noteViewButtons = modal.querySelectorAll("[data-update-notes-view]");

  // Custom Dropdown Elements
  const mirrorSelectContainer = document.getElementById(
    "mirror-select-container"
  );
  const mirrorSelectedDisplay = document.getElementById(
    "mirror-selected-display"
  );
  const mirrorOptionsList = document.getElementById("mirror-options-list");
  const mirrorSelectValue = document.getElementById("mirror-select-value");
  const refreshBtn = document.getElementById("refresh-mirrors-btn");

  const customInput = document.getElementById("custom-mirror-input");
  const confirmBtn = document.getElementById("confirm-update-btn");
  const cancelBtn = document.getElementById("cancel-update-btn");
  const closeBtn = document.getElementById("close-update-modal-btn");
  const progressContainer = document.getElementById(
    "update-progress-container"
  );
  const progressFill = document.getElementById("update-progress-fill");
  const progressText = document.getElementById("update-progress-text");
  const modalFooter = document.getElementById("update-modal-footer");
  const ignoreBtn = document.getElementById("ignore-update-btn");

  newVer.textContent = info.latest_ver;
  curVer.textContent = info.current_ver;
  const releaseNote = info.release_note || "暂无更新日志";
  setReleaseNotesView(notes, noteViewButtons, releaseNote, "category");

  noteViewButtons.forEach((button) => {
    button.onclick = () => {
      setReleaseNotesView(
        notes,
        noteViewButtons,
        releaseNote,
        button.dataset.updateNotesView || "category"
      );
    };
  });

  // Helper to set selected option
  const setSelected = (value, htmlContent) => {
    mirrorSelectValue.value = value;
    // Keep arrow
    mirrorSelectedDisplay.innerHTML =
      `<div class="selected-content">${htmlContent}</div>` +
      '<span class="select-arrow">▼</span>';

    if (value === "custom") {
      customInput.classList.remove("hidden");
    } else {
      customInput.classList.add("hidden");
    }
    mirrorOptionsList.classList.add("hidden");
  };

  // Move dropdown to body to avoid overflow/z-index issues
  document.body.appendChild(mirrorOptionsList);

  // Toggle dropdown
  const toggleDropdown = (e) => {
    e.stopPropagation(); // Prevent document click
    if (e.target.closest(".selected-option")) {
      if (mirrorOptionsList.classList.contains("hidden")) {
        // Opening - Calculate fixed position
        const rect = mirrorSelectContainer.getBoundingClientRect();
        mirrorOptionsList.style.top = rect.bottom + 4 + "px";
        mirrorOptionsList.style.left = rect.left + "px";
        mirrorOptionsList.style.width = rect.width + "px";
        mirrorOptionsList.classList.remove("hidden");
      } else {
        mirrorOptionsList.classList.add("hidden");
      }
    }
  };

  // Use addEventListener instead of onclick assignment
  mirrorSelectContainer.addEventListener("click", toggleDropdown);

  // Close when clicking outside
  const clickOutsideHandler = (e) => {
    // Check if the click is outside the dropdown list AND the container
    if (
      !mirrorSelectContainer.contains(e.target) &&
      !mirrorOptionsList.contains(e.target)
    ) {
      mirrorOptionsList.classList.add("hidden");
    }
  };

  // Close on scroll or resize
  const closeDropdown = () => {
    mirrorOptionsList.classList.add("hidden");
  };

  document.addEventListener("click", clickOutsideHandler);
  window.addEventListener("resize", closeDropdown);
  // Capture scroll events to handle scrolling in modal or any parent
  window.addEventListener("scroll", closeDropdown, true);

  let cancelLatencyListener = null;
  let userInteracted = false;
  let currentBestLatency = Infinity;

  // 加载镜像列表
  try {
    const mirrors = await GetMirrorsInitial();
    mirrorOptionsList.innerHTML = "";

    let defaultSelected = false;

    if (mirrors && mirrors.length > 0) {
      mirrors.forEach((item) => {
        const div = document.createElement("div");
        div.className = "custom-option";

        let latencyClass = "unknown";
        let latencyText = "检测中...";

        let displayName = item.url;
        if (item.url === "") {
          displayName = "GitHub 直连";
        }

        const innerHTML = `
            <span class="mirror-url" title="${item.url || "GitHub 直连"}">${displayName}</span>
            <span class="latency-tag ${latencyClass}">测试中</span>
        `;

        div.innerHTML = innerHTML;

        div.onclick = () => {
          userInteracted = true;
          // Re-fetch current innerHTML to get updated latency tag
          const currentTag = div.querySelector(".latency-tag").outerHTML;
          const currentUrlHtml = `<span class="mirror-url" title="${item.url || "GitHub 直连"}">${displayName}</span>`;
          setSelected(item.url, currentUrlHtml + currentTag);
        };
        mirrorOptionsList.appendChild(div);

        // Auto select the first one (will update later)
        if (!defaultSelected) {
          setSelected(item.url, innerHTML);
          defaultSelected = true;
        }
      });
    }

    const customOption = document.createElement("div");
    customOption.className = "custom-option";
    customOption.innerHTML = `<span class="mirror-url">自定义镜像源...</span>`;
    customOption.onclick = () => {
      userInteracted = true;
      setSelected("custom", `<span class="mirror-url">自定义镜像源...</span>`);
    };
    mirrorOptionsList.appendChild(customOption);

    // If no mirrors found or default not set, select custom or fallback
    if (!defaultSelected) {
      setSelected(
        "",
        `<span class="mirror-url">GitHub 直连</span><span class="latency-tag unknown">未知</span>`
      );
    }

    // Start async test
    TestMirrorsLatency();

    // Listen for updates
    cancelLatencyListener = EventsOn("mirror_latency_result", (result) => {
      const options = mirrorOptionsList.querySelectorAll(".custom-option");
      options.forEach((div) => {
        const urlSpan = div.querySelector(".mirror-url");
        if (!urlSpan) return;

        let isMatch = false;
        // Handle Direct connection (empty URL) case
        if (result.url === "" && urlSpan.title === "GitHub 直连") {
          isMatch = true;
        } else if (result.url === urlSpan.title) {
          isMatch = true;
        }

        if (isMatch) {
          const tag = div.querySelector(".latency-tag");
          if (tag) {
            let latencyClass = "unknown";
            let latencyText = "测试中";

            if (result.latency === -1) {
              latencyClass = "bad";
              latencyText = "超时";
            } else if (result.latency < 200) {
              latencyClass = "good";
              latencyText = result.latency + "ms";
            } else if (result.latency < 500) {
              latencyClass = "medium";
              latencyText = result.latency + "ms";
            } else {
              latencyClass = "bad";
              latencyText = result.latency + "ms";
            }

            tag.className = `latency-tag ${latencyClass}`;
            tag.textContent = latencyText;

            let justAutoSelected = false;
            // Auto-select lowest latency (if user hasn't interacted)
            if (
              !userInteracted &&
              result.latency !== -1 &&
              result.latency < currentBestLatency
            ) {
              currentBestLatency = result.latency;
              mirrorSelectValue.value = result.url;

              mirrorSelectedDisplay.innerHTML =
                `<div class="selected-content">${urlSpan.outerHTML}${tag.outerHTML}</div>` +
                '<span class="select-arrow">▼</span>';

              customInput.classList.add("hidden");
              justAutoSelected = true;
            }

            // If this option is currently selected (and not just auto-selected), update the display too
            if (!justAutoSelected && mirrorSelectValue.value === result.url) {
              const displayTag =
                mirrorSelectedDisplay.querySelector(".latency-tag");
              if (displayTag) {
                displayTag.className = `latency-tag ${latencyClass}`;
                displayTag.textContent = latencyText;
              }
            }
          }
        }
      });
    });
  } catch (e) {
    console.error("Failed to load mirrors:", e);
    // Fallback
    setSelected("", `<span class="mirror-url">GitHub 直连</span>`);
  }

  // Refresh Handler
  const refreshHandler = () => {
    userInteracted = false;
    currentBestLatency = Infinity;

    const tags = mirrorOptionsList.querySelectorAll(".latency-tag");
    tags.forEach((tag) => {
      tag.className = "latency-tag unknown";
      tag.textContent = "测试中";
    });

    const displayTag = mirrorSelectedDisplay.querySelector(".latency-tag");
    if (displayTag) {
      displayTag.className = "latency-tag unknown";
      displayTag.textContent = "测试中";
    }

    TestMirrorsLatency();
  };

  if (refreshBtn) {
    refreshBtn.addEventListener("click", refreshHandler);
  }

  // 重置状态
  customInput.value = "";
  progressContainer.classList.add("hidden");
  modalFooter.classList.remove("hidden");
  confirmBtn.disabled = false;
  confirmBtn.textContent = "立即更新";

  let cancelProgress = null;

  // 清理函数
  const cleanup = () => {
    document.removeEventListener("click", clickOutsideHandler);
    mirrorSelectContainer.removeEventListener("click", toggleDropdown);
    window.removeEventListener("resize", closeDropdown);
    window.removeEventListener("scroll", closeDropdown, true);

    if (refreshBtn) {
      refreshBtn.removeEventListener("click", refreshHandler);
    }

    if (cancelLatencyListener) {
      cancelLatencyListener();
      cancelLatencyListener = null;
    }

    // Put mirrorOptionsList back to container to avoid DOM detaching issues on next open
    if (document.body.contains(mirrorOptionsList)) {
      mirrorSelectContainer.appendChild(mirrorOptionsList);
    }
    mirrorOptionsList.classList.add("hidden");

    if (cancelProgress) {
      cancelProgress();
      cancelProgress = null;
    }
    modal.classList.add("hidden");
  };

  // 不再提醒
  ignoreBtn.onclick = () => {
    const config = getConfig();
    config.ignoredVersion = info.latest_ver;
    saveConfig(config);
    console.log("已设置忽略版本:", info.latest_ver);
    cleanup();
  };

  // 确认更新
  confirmBtn.onclick = async () => {
    let mirror = mirrorSelectValue.value;
    if (mirror === "custom") {
      mirror = customInput.value.trim();
      if (!mirror) {
        showMessageModal("提示", "请输入自定义镜像地址");
        return;
      }
    }

    // 切换到进度条模式
    modalFooter.classList.add("hidden");
    progressContainer.classList.remove("hidden");
    progressFill.style.width = "0%";
    progressText.textContent = "0%";

    // 监听进度
    if (cancelProgress) cancelProgress();
    cancelProgress = EventsOn("update_progress", (percent) => {
      progressFill.style.width = percent + "%";
      progressText.textContent = percent + "%";
    });

    await performUpdate(mirror);

    // 恢复状态 (如果失败)
    modalFooter.classList.remove("hidden");
    progressContainer.classList.add("hidden");

    if (cancelProgress) {
      cancelProgress();
      cancelProgress = null;
    }
  };

  // 关闭弹窗
  cancelBtn.onclick = cleanup;
  closeBtn.onclick = cleanup;

  modal.classList.remove("hidden");
}

// 显示通用消息弹窗
export function showMessageModal(title, message, onConfirm) {
  const modal = document.getElementById("message-modal");
  const titleEl = document.getElementById("message-modal-title");
  const contentEl = document.getElementById("message-modal-content");
  const confirmBtn = document.getElementById("message-modal-confirm-btn");
  const closeBtn = document.getElementById("close-message-modal-btn");

  titleEl.textContent = title;
  contentEl.textContent = message;

  const closeModal = () => {
    modal.classList.add("hidden");
    if (onConfirm) onConfirm();
  };

  confirmBtn.onclick = closeModal;
  closeBtn.onclick = () => modal.classList.add("hidden"); // 关闭按钮不触发回调

  modal.classList.remove("hidden");
}

// 执行更新逻辑
export async function performUpdate(mirrorUrl) {
  // 显示全局加载提示
  const btn = document.getElementById("refresh-btn");
  if (btn) btn.textContent = "正在更新...";

  // 也可以在关于页面显示状态
  const updateBtn = document.getElementById("check-update-btn");
  if (updateBtn) {
    updateBtn.disabled = true;
    updateBtn.textContent = "正在下载...";
  }

  // 调用后端 DoUpdate，传入镜像地址
  const result = await DoUpdate(mirrorUrl || "");

  if (result === "success") {
    // 清除忽略版本设置，以便下次更新提醒
    const config = getConfig();
    config.ignoredVersion = "";
    saveConfig(config);

    showMessageModal("更新成功", "程序将自动重启以应用更新。", async () => {
      try {
        // 尝试调用重启方法
        if (typeof RestartApplication === "function") {
          await RestartApplication();
        } else {
          // 兼容旧版本或未生成绑定的情况
          window.runtime.Quit();
        }
      } catch (e) {
        console.error("重启失败:", e);
        window.runtime.Quit();
      }
    });
  } else {
    showMessageModal("更新失败", result);
    if (btn) btn.textContent = "刷新";
    if (updateBtn) {
      updateBtn.disabled = false;
      updateBtn.textContent = "检查更新";
    }
  }
}
