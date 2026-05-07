import { switchAppPage } from "../../core/ui-shell.js";
import { renderAboutPage } from "../about/about.js";
import { showUpdateModal } from "../update/updates.js";
import { BrowserOpenURL } from "../../../../wailsjs/runtime/runtime";
import { GetAppVersion, CheckUpdate } from "../../../../wailsjs/go/app/App";

export function showInfoModal() {
  switchAppPage("about", { silent: true });
  renderAboutPage({
    BrowserOpenURL,
    GetAppVersion,
    CheckUpdate,
    showUpdateModal,
  });
}

export function closeInfoModal() {
  document.getElementById("info-modal").classList.add("hidden");
}
