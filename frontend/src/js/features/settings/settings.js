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
let GetWorkshopIPOptions;
let GetWorkshopMetaEnabled;
let GetWorkshopUpdateCheckEnabled;
let GetWorkshopBrowserTarget;
let GetWorkshopTranslateProvider;
let GetWorkshopTranslateCustomBaseURL;
let GetWorkshopTranslateCustomModelId;
let HasWorkshopTranslateCustomAPIKey;
let IsSelectingIP;
let GetCurrentBestIP;
let GetCurrentBestIPOption;
let SetWorkshopPreferredIP;
let SetWorkshopFixedIP;
let SetWorkshopMetaEnabled;
let SetWorkshopUpdateCheckEnabled;
let SetWorkshopBrowserTarget;
let SetWorkshopTranslateProvider;
let SetWorkshopTranslateCustomBaseURL;
let SetWorkshopTranslateCustomModelId;
let SetWorkshopTranslateCustomAPIKey;
let CheckModUpdates;
let EventsOn;
let switchAppPage;

export function configureSettings(deps) {
  ({ appState, getConfig, saveConfig, renderFileList, renderTagFilters, refreshFilesKeepFilter, showNotification, renderSettingsPage, GetWorkshopPreferredIP, GetWorkshopFixedIP, GetWorkshopIPOptions, GetWorkshopMetaEnabled, GetWorkshopUpdateCheckEnabled, GetWorkshopBrowserTarget, GetWorkshopTranslateProvider, GetWorkshopTranslateCustomBaseURL, GetWorkshopTranslateCustomModelId, HasWorkshopTranslateCustomAPIKey, IsSelectingIP, GetCurrentBestIP, GetCurrentBestIPOption, SetWorkshopPreferredIP, SetWorkshopFixedIP, SetWorkshopMetaEnabled, SetWorkshopUpdateCheckEnabled, SetWorkshopBrowserTarget, SetWorkshopTranslateProvider, SetWorkshopTranslateCustomBaseURL, SetWorkshopTranslateCustomModelId, SetWorkshopTranslateCustomAPIKey, CheckModUpdates, EventsOn, switchAppPage } = deps);
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
      GetWorkshopIPOptions,
      GetWorkshopMetaEnabled,
      GetWorkshopUpdateCheckEnabled,
      GetWorkshopBrowserTarget,
      GetWorkshopTranslateProvider,
      GetWorkshopTranslateCustomBaseURL,
      GetWorkshopTranslateCustomModelId,
      HasWorkshopTranslateCustomAPIKey,
      IsSelectingIP,
      GetCurrentBestIP,
      GetCurrentBestIPOption,
      SetWorkshopPreferredIP,
      SetWorkshopFixedIP,
      SetWorkshopMetaEnabled,
      SetWorkshopUpdateCheckEnabled,
      SetWorkshopBrowserTarget,
      SetWorkshopTranslateProvider,
      SetWorkshopTranslateCustomBaseURL,
      SetWorkshopTranslateCustomModelId,
      SetWorkshopTranslateCustomAPIKey,
      CheckModUpdates,
      EventsOn,
    });
  } catch (error) {
    console.error("设置页面渲染失败:", error);
  }
}
