let appState;
let getConfig;
let saveConfig;
let renderFileList;
let renderTagFilters;
let refreshFilesKeepFilter;
let showNotification;
let renderSettingsPage;
let GetWorkshopPreferredIP;
let GetWorkshopFixedIP;
let GetWorkshopMetaEnabled;
let GetWorkshopBrowserTarget;
let IsSelectingIP;
let GetCurrentBestIP;
let SetWorkshopPreferredIP;
let SetWorkshopFixedIP;
let SetWorkshopMetaEnabled;
let SetWorkshopBrowserTarget;
let refreshActiveIndicator;
let switchAppPage;
let showConfirmModal;
let showError;

export function configureSettings(deps) {
  ({ appState, getConfig, saveConfig, renderFileList, renderTagFilters, refreshFilesKeepFilter, showNotification, renderSettingsPage, GetWorkshopPreferredIP, GetWorkshopFixedIP, GetWorkshopMetaEnabled, GetWorkshopBrowserTarget, IsSelectingIP, GetCurrentBestIP, SetWorkshopPreferredIP, SetWorkshopFixedIP, SetWorkshopMetaEnabled, SetWorkshopBrowserTarget, refreshActiveIndicator, switchAppPage, showConfirmModal, showError } = deps);
}

export async function showGlobalSettings() {
  switchAppPage("settings", { silent: true });
  await renderSettingsPageWithDeps();
}

export async function renderSettingsPageWithDeps() {
  try {
    await renderSettingsPage({
      appState,
      getConfig,
      saveConfig,
      renderFileList,
      renderTagFilters,
      refreshFilesKeepFilter,
      showNotification,
      GetWorkshopPreferredIP,
      GetWorkshopFixedIP,
      GetWorkshopMetaEnabled,
      GetWorkshopBrowserTarget,
      IsSelectingIP,
      GetCurrentBestIP,
      SetWorkshopPreferredIP,
      SetWorkshopFixedIP,
      SetWorkshopMetaEnabled,
      SetWorkshopBrowserTarget,
    });
  } catch (error) {
    console.error("设置页面渲染失败:", error);
  }
}
