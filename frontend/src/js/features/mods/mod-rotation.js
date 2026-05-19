import { showError, showNotification } from "../../core/toast.js";
import { showLoadingScreen, showMainScreen, updateLoadingMessage } from "../state.js";
import { getConfig, saveConfig } from "../../core/config.js";
import { refreshFilesKeepFilter } from "../file-list/filters.js";
import { showConfirmModal } from "../modals/confirm.js";
import { GetModRotation, ManualRotateMods, SetModRotation } from "../../../../wailsjs/go/app/App";

const ROTATION_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-svg">
  <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
  <path d="M3 3v5h5"></path>
  <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"></path>
  <path d="M16 21h5v-5"></path>
</svg>`;

export async function manualRotate(type) {
  try {
    document.getElementById("confirm-modal")?.classList.add("hidden");
    showLoadingScreen();

    let config = {
      enableCharacters: false,
      enableWeapons: false,
    };

    let typeName = "";
    if (type === "weapon") {
      config.enableWeapons = true;
      typeName = "武器";
    } else if (type === "character") {
      config.enableCharacters = true;
      typeName = "人物";
    } else {
      config.enableCharacters = true;
      config.enableWeapons = true;
      typeName = "所有";
    }

    updateLoadingMessage(`正在执行${typeName}轮换...`);
    await ManualRotateMods(config);
    await refreshFilesKeepFilter();

    showMainScreen();
    showNotification(`${typeName}轮换已完成`, "success");
  } catch (e) {
    showMainScreen();
    console.error("手动轮换失败:", e);
  }
}

export async function initModRotationState() {
  if (typeof GetModRotation !== "function") {
    console.warn("后端 GetModRotation 方法不可用");
    return;
  }

  const config = getConfig();
  let rotationConfig = config.modRotationConfig;

  if (!rotationConfig) {
    const enabled = config.modRotationEnabled || false;
    rotationConfig = {
      enableCharacters: enabled,
      enableWeapons: enabled,
    };
  }

  try {
    rotationConfig = await GetModRotation();
    config.modRotationConfig = rotationConfig;
    saveConfig(config);
    updateModRotationUI(rotationConfig);
  } catch (e) {
    console.error("初始化Mod轮换状态失败:", e);
  }
}

export function updateModRotationUI(config) {
  const btn = document.getElementById("mod-rotation-btn");
  if (!btn) return;

  const charEnabled = config.enableCharacters;
  const weaponEnabled = config.enableWeapons;
  const anyEnabled = charEnabled || weaponEnabled;

  if (anyEnabled) {
    btn.classList.add("btn-rotation-enabled");
    btn.classList.remove("btn-outline");

    let text = "轮换已启用";
    if (charEnabled && weaponEnabled) {
      text = "轮换已启用";
    } else if (charEnabled) {
      text = "人物轮换已启用";
    } else if (weaponEnabled) {
      text = "武器轮换已启用";
    }

    btn.innerHTML = `<span class="icon">${ROTATION_ICON_SVG}</span> ${text}`;
  } else {
    btn.classList.remove("btn-rotation-enabled");
    btn.classList.add("btn-outline");
    btn.innerHTML = `<span class="icon">${ROTATION_ICON_SVG}</span> 轮换已关闭`;
  }
}

export async function toggleModRotation() {
  if (typeof SetModRotation !== "function") {
    showError("功能暂不可用：后端未实现轮换接口");
    return;
  }

  const config = getConfig();
  let currentConfig = config.modRotationConfig;
  if (!currentConfig) {
    const enabled = config.modRotationEnabled || false;
    currentConfig = {
      enableCharacters: enabled,
      enableWeapons: enabled,
    };
  }

  const htmlContent = `
    <div class="rotation-settings">
      <p class="rotation-title">请选择要启用的轮换类型：</p>
      <div class="rotation-options">
        <label class="rotation-option-item">
          <span class="option-label">人物轮换</span>
          <div class="rotation-switch">
            <input type="checkbox" id="rotation-char-check" ${currentConfig.enableCharacters ? "checked" : ""}>
            <span class="rotation-slider round"></span>
          </div>
        </label>
        <label class="rotation-option-item">
          <span class="option-label">武器轮换</span>
          <div class="rotation-switch">
            <input type="checkbox" id="rotation-weapon-check" ${currentConfig.enableWeapons ? "checked" : ""}>
            <span class="rotation-slider round"></span>
          </div>
        </label>
        <div style="margin-top: 8px; border-top: 1px solid var(--border-light); padding-top: 12px; display: flex; gap: 10px;">
           <button onclick="window.manualRotate('character')" class="btn btn-outline btn-small" style="flex: 1; justify-content: center;">
             <span class="icon">
               <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-svg"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
             </span> 手动轮换人物
           </button>
           <button onclick="window.manualRotate('weapon')" class="btn btn-outline btn-small" style="flex: 1; justify-content: center;">
             <span class="icon">
               <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-svg"><circle cx="12" cy="12" r="10"></circle><line x1="22" y1="12" x2="18" y2="12"></line><line x1="6" y1="12" x2="2" y2="12"></line><line x1="12" y1="6" x2="12" y2="2"></line><line x1="12" y1="22" x2="12" y2="18"></line></svg>
             </span> 手动轮换武器
           </button>
        </div>
        <div style="font-size: 0.85em; color: var(--text-tertiary); margin-top: 6px; text-align: center;">即便未开启自动轮换，也可以手动执行</div>
      </div>
      <div class="rotation-desc-container">
        <p>开启后，每次启动游戏将自动从已安装的Mod中随机选择并替换。</p>
        <p>系统会按具体子分类（如 AK47、M16、Nick 等）进行随机，确保每个子分类只有一个 Mod 生效。</p>
        <p><strong>注意：仅当某个子分类至少有一个Mod处于启用状态时，该分类才会参与轮换。</strong></p>
        <p>若都不选择，则相当于关闭轮换功能。</p>
      </div>
    </div>
  `;

  showConfirmModal(
    "设置Mod随机轮换",
    htmlContent,
    async () => {
      const charCheck = document.getElementById("rotation-char-check");
      const weaponCheck = document.getElementById("rotation-weapon-check");

      const newConfig = {
        enableCharacters: charCheck ? charCheck.checked : false,
        enableWeapons: weaponCheck ? weaponCheck.checked : false,
      };

      try {
        config.modRotationConfig = newConfig;
        config.modRotationEnabled =
          newConfig.enableCharacters || newConfig.enableWeapons;
        saveConfig(config);
        await SetModRotation(newConfig);
        updateModRotationUI(newConfig);

        if (newConfig.enableCharacters || newConfig.enableWeapons) {
          showNotification("Mod随机轮换设置已更新", "success");
        } else {
          showNotification("Mod随机轮换已关闭", "info");
        }
      } catch (e) {
        showError("操作失败: " + e);
      }
    },
    true
  );
}
