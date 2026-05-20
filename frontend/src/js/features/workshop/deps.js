export const workshopDeps = {
  switchAppPage: undefined,
  showNotification: undefined,
  showError: undefined,
  BrowserOpenURL: undefined,
  FetchWorkshopList: undefined,
  FetchWorkshopDetail: undefined,
  GetWorkshopBrowserTarget: undefined,
  IsSelectingIP: undefined,
  closeModal: undefined,
  openWorkshopModal: undefined,
  EventsOn: undefined,
  GetWorkshopWatchLaterStorage: undefined,
  SaveWorkshopWatchLaterStorage: undefined,
};

export function configureWorkshopBrowser(deps) {
  Object.assign(workshopDeps, deps);
}
