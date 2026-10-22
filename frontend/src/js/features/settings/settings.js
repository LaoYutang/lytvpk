let appState;
let getConfig;
let saveConfig;
let renderFileList;
let renderTagFilters;
let refreshFilesKeepFilter;
let showNotification;
let showError;
let SelectDirectory;
let GetSnapshotDirectory;
let SetSnapshotDirectory;
let OpenSnapshotDirectory;
let renderSettingsPage;
let GetWorkshopPreferredIP;
let GetWorkshopDNSConfig;
let SetWorkshopDNSConfig;
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
let settingsRenderGeneration = 0;
let pendingSettingsRender = null;

export function configureSettings(deps) {
  ({ GetWorkshopDNSConfig, SetWorkshopDNSConfig } = deps);
  ({ appState, getConfig, saveConfig, renderFileList, renderTagFilters, refreshFilesKeepFilter, showNotification, showError, SelectDirectory, GetSnapshotDirectory, SetSnapshotDirectory, OpenSnapshotDirectory, renderSettingsPage, GetWorkshopPreferredIP, GetWorkshopFixedIP, GetWorkshopIPOptions, GetWorkshopMetaEnabled, GetWorkshopUpdateCheckEnabled, GetWorkshopBrowserTarget, GetWorkshopTranslateProvider, GetWorkshopTranslateCustomBaseURL, GetWorkshopTranslateCustomModelId, HasWorkshopTranslateCustomAPIKey, IsSelectingIP, GetCurrentBestIP, GetCurrentBestIPOption, SetWorkshopPreferredIP, SetWorkshopFixedIP, SetWorkshopMetaEnabled, SetWorkshopUpdateCheckEnabled, SetWorkshopBrowserTarget, SetWorkshopTranslateProvider, SetWorkshopTranslateCustomBaseURL, SetWorkshopTranslateCustomModelId, SetWorkshopTranslateCustomAPIKey, CheckModUpdates, EventsOn, switchAppPage } = deps);
}

export async function showGlobalSettings() {
  switchAppPage("settings", { silent: true });
  await renderSettingsPageWithDeps();
}

export function invalidateSettingsPageRender() {
  settingsRenderGeneration++;
  pendingSettingsRender = null;
}

export function renderSettingsPageWithDeps() {
  if (pendingSettingsRender) return pendingSettingsRender;

  const generation = ++settingsRenderGeneration;
  const isCurrentRender = () => generation === settingsRenderGeneration;
  const pending = Promise.resolve()
    .then(() => renderCurrentSettingsPage(isCurrentRender))
    .finally(() => {
      if (pendingSettingsRender === pending) pendingSettingsRender = null;
    });
  pendingSettingsRender = pending;
  return pending;
}

async function renderCurrentSettingsPage(isCurrentRender) {
  if (!isCurrentRender()) return;
  try {
    await renderSettingsPage({
      isCurrentRender,
      appState,
      getConfig,
      saveConfig,
      renderFileList,
      renderTagFilters,
      refreshFilesKeepFilter,
      showNotification,
      showError,
      SelectDirectory,
      GetSnapshotDirectory,
      SetSnapshotDirectory,
      OpenSnapshotDirectory,
      GetWorkshopPreferredIP,
      GetWorkshopDNSConfig,
      SetWorkshopDNSConfig,
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
    if (isCurrentRender()) console.error("设置页面渲染失败:", error);
  }
}
