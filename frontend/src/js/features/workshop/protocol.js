import { workshopDeps } from "./deps.js";
import { openWorkshopDetail } from "./detail.js";
import { openBrowser } from "./list.js";

export async function handleProtocolParse(workshopId) {
  console.log("处理协议解析:", workshopId);

  workshopDeps.showNotification(`正在解析工坊ID: ${workshopId}`, "info");
  workshopDeps.openWorkshopModal();

  document.getElementById("workshop-url").value = workshopId;

  setTimeout(() => {
    const checkBtn = document.getElementById("check-workshop-btn");
    if (checkBtn) {
      checkBtn.click();
    }
  }, 300);
}

export async function handleProtocolWorkshop(workshopId) {
  console.log("处理协议打开工坊:", workshopId);

  const fileDetailModal = document.getElementById("file-detail-modal");
  if (fileDetailModal && !fileDetailModal.classList.contains("hidden")) {
    workshopDeps.closeModal();
  }

  workshopDeps.showNotification(`正在打开工坊: ${workshopId}`, "info");
  openBrowser();

  const isSelecting = await workshopDeps.IsSelectingIP();
  if (isSelecting) {
    console.log("正在优选IP，等待完成...");
    workshopDeps.showNotification("正在等待IP优选完成...", "info");

    await waitForIPSelection();
    console.log("IP优选已完成，继续获取详情");
  }

  setTimeout(async () => {
    try {
      const detail = await workshopDeps.FetchWorkshopDetail(workshopId);
      if (detail && detail.publishedfileid) {
        openWorkshopDetail(detail);
      } else {
        openWorkshopDetail({
          publishedfileid: workshopId,
          title: `工坊 #${workshopId}`,
          preview_url: "",
          description: "无法获取详细信息，请检查网络连接",
        });
      }
    } catch (err) {
      console.error("获取工坊详情失败:", err);
      openWorkshopDetail({
        publishedfileid: workshopId,
        title: `工坊 #${workshopId}`,
        preview_url: "",
        description: `获取详情失败: ${err}\n\n请检查网络连接或稍后重试`,
      });
      workshopDeps.showError(`获取工坊详情失败: ${err}`);
    }
  }, 500);
}

function waitForIPSelection() {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.log("等待IP优选超时，继续执行");
      resolve();
    }, 30000);

    const cleanup = workshopDeps.EventsOn("ip_selection_end", () => {
      clearTimeout(timeout);
      cleanup();
      resolve();
    });
  });
}
