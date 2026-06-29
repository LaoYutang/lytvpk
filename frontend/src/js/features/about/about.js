import logoUrl from "../../../assets/images/logo.png";

const ABOUT_LINKS = {
  repo: "https://github.com/LaoYutang/lytvpk",
  license: "https://github.com/LaoYutang/lytvpk/blob/master/LICENSE",
  issue: "https://github.com/LaoYutang/lytvpk/issues/new",
};

export async function renderAboutPage({
  BrowserOpenURL,
  GetAppVersion,
  CheckUpdate,
  showUpdateModal,
} = {}) {
  const container = document.getElementById("about-page-content");
  if (!container) return;

  container.innerHTML = `
    <div class="about-page-shell">
      <section class="about-hero">
        <div class="about-logo-mark">
          <img src="${logoUrl}" alt="" />
        </div>
        <div class="about-hero-copy">
          <div class="about-kicker">Left 4 Dead 2 MOD Manager</div>
          <h2>LytVpk</h2>
          <p>轻量、清爽的 Left 4 Dead 2 MOD 管理工具，用来整理 VPK、创意工坊下载、服务器收藏和常用维护流程。</p>
        </div>
      </section>

      <section class="about-grid" aria-label="应用信息">
        <div class="about-info-panel">
          <div class="about-panel-title">项目信息</div>
          <dl class="about-meta-list">
            <div>
              <dt>作者</dt>
              <dd>LaoYutang</dd>
            </div>
            <div>
              <dt>开源协议</dt>
              <dd>GPL-3.0-only</dd>
            </div>
            <div>
              <dt>项目仓库</dt>
              <dd>LaoYutang/lytvpk</dd>
            </div>
            <div>
              <dt>问题反馈</dt>
              <dd>GitHub Issues</dd>
            </div>
            <div>
              <dt>当前版本</dt>
              <dd id="about-current-version">检测中...</dd>
            </div>
          </dl>
        </div>

        <div class="about-info-panel about-action-panel">
          <div class="about-panel-title">操作</div>
          <div class="about-actions">
            <button class="about-action-btn primary" type="button" data-about-url="${ABOUT_LINKS.repo}">
              <span>打开 GitHub 仓库</span>
            </button>
            <button class="about-action-btn" type="button" data-about-url="${ABOUT_LINKS.license}">
              <span>查看开源协议</span>
            </button>
            <button class="about-action-btn" type="button" data-about-url="${ABOUT_LINKS.issue}">
              <span>问题反馈</span>
            </button>
            <button id="about-check-update-btn" class="about-action-btn" type="button">
              <span>检查更新</span>
            </button>
          </div>
          <div id="about-update-status" class="about-update-status" aria-live="polite"></div>
        </div>
      </section>
    </div>
  `;

  bindAboutActions({
    BrowserOpenURL,
    CheckUpdate,
    showUpdateModal,
  });

  await hydrateVersion(GetAppVersion);
}

function bindAboutActions({ BrowserOpenURL, CheckUpdate, showUpdateModal } = {}) {
  document.querySelectorAll("#about-page-content [data-about-url]").forEach((button) => {
    button.addEventListener("click", () => {
      const url = button.dataset.aboutUrl;
      if (!url) return;
      if (typeof BrowserOpenURL === "function") {
        BrowserOpenURL(url);
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    });
  });

  document.getElementById("about-check-update-btn")?.addEventListener("click", async () => {
    await checkAboutUpdate({ CheckUpdate, showUpdateModal });
  });
}

async function hydrateVersion(GetAppVersion) {
  const versionEl = document.getElementById("about-current-version");
  if (!versionEl || typeof GetAppVersion !== "function") return;

  try {
    const version = await GetAppVersion();
    versionEl.textContent = version ? `v${version}` : "未知";
  } catch (error) {
    versionEl.textContent = "获取失败";
  }
}

async function checkAboutUpdate({ CheckUpdate, showUpdateModal } = {}) {
  const button = document.getElementById("about-check-update-btn");
  const status = document.getElementById("about-update-status");
  const versionEl = document.getElementById("about-current-version");
  if (!button || !status || typeof CheckUpdate !== "function") return;

  button.disabled = true;
  button.querySelector("span").textContent = "检查中...";
  status.className = "about-update-status";
  status.textContent = "";

  try {
    const info = await CheckUpdate();
    if (versionEl && info.current_ver) {
      versionEl.textContent = `v${info.current_ver}`;
    }

    if (info.error) {
      status.textContent = `检查失败: ${info.error}`;
      status.classList.add("error");
    } else if (info.has_update) {
      status.textContent = `发现新版本 v${info.latest_ver}`;
      status.classList.add("success");
      if (typeof showUpdateModal === "function") {
        showUpdateModal(info);
      }
    } else {
      status.textContent = `当前已是最新版本 v${info.latest_ver || info.current_ver}`;
      status.classList.add("success");
    }
  } catch (error) {
    status.textContent = `发生错误: ${error}`;
    status.classList.add("error");
  } finally {
    button.disabled = false;
    button.querySelector("span").textContent = "检查更新";
  }
}
