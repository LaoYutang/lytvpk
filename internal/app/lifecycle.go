package app

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"time"

	"vpk-manager/internal/network"
	"vpk-manager/internal/platform/protocol"
	"vpk-manager/internal/platform/urlregistry"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const exitPauseLossConfirmationRequired = "DOWNLOAD_PAUSE_LOSS_CONFIRMATION_REQUIRED"

var errExitDownloadsBecameActive = errors.New("downloads became active before exit")

type favoriteServerProtocolEvent struct {
	ServerName    string `json:"serverName"`
	ServerAddress string `json:"serverAddress"`
	Added         bool   `json:"added"`
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	// 记住窗口尺寸：恢复保存的尺寸，并监听后续变化
	a.setupWindowStateTracking()
	a.clampWindowToScreen()

	// 启动单例监听器，接收来自其他实例的URL参数
	singletonMgr, err := StartSingletonListener(a)
	if err != nil {
		log.Printf("启动单例监听器失败: %v", err)
	} else {
		a.singletonMgr = singletonMgr
	}

	// 注册 URL 协议（确保路径变化后始终正确）
	go func() {
		if err := urlregistry.EnsureURLProtocolRegistered(); err != nil {
			log.Printf("注册URL协议失败: %v", err)
		}
	}()

	// 处理启动时的命令行参数（第一个实例自己的参数）
	HandleStartupArgs(a, os.Args)

	// 清理旧版本文件
	go func() {
		// 稍微延迟一下，确保旧进程完全退出
		time.Sleep(2 * time.Second)

		// 如果开启了优选IP，启动时自动触发
		if a.GetWorkshopPreferredIP() {
			a.mu.RLock()
			fixedIP := a.workshopFixedIP
			a.mu.RUnlock()
			if fixedIP != "" {
				log.Printf("检测到优选IP已开启且设置了固定IP: %s，跳过自动优选", fixedIP)
				network.GlobalIPSelector.SetFixedIP(fixedIP)
				runtime.EventsEmit(a.ctx, "ip_selection_end", nil)
			} else {
				log.Println("检测到优选IP已开启，后台启动IP优选...")
				// 设置状态为正在选择
				runtime.EventsEmit(a.ctx, "ip_selection_start", nil)

				go func() {
					// 使用一个典型的工坊图片域名来测试
					network.GlobalIPSelector.GetBestIP("https://steamuserimages-a.akamaihd.net/ugc/test")
					// 完成后通知前端
					runtime.EventsEmit(a.ctx, "ip_selection_end", nil)
				}()
			}
		}

		exe, err := os.Executable()
		if err != nil {
			return
		}
		oldExe := exe + ".old"
		if _, err := os.Stat(oldExe); err == nil {
			if err := os.Remove(oldExe); err != nil {
				log.Printf("清理旧版本失败: %v", err)
			} else {
				log.Printf("已清理旧版本文件: %s", oldExe)
			}
		}
	}()
}

func (a *App) Startup(ctx context.Context) {
	a.startup(ctx)
}

// HandleProtocolURL 处理 lytvpk:// 协议URL
// 当从浏览器或其他来源收到URL时调用
func (a *App) HandleProtocolURL(url string) {
	log.Printf("收到协议URL: %s", url)

	// 解析URL
	protocolURL, err := protocol.ParseProtocolURL(url)
	if err != nil {
		log.Printf("解析协议URL失败: %v", err)
		// 发送错误事件给前端
		runtime.EventsEmit(a.ctx, "protocol:error", map[string]string{
			"url":     url,
			"message": err.Error(),
		})
		return
	}

	// 根据操作类型发送不同事件
	switch protocolURL.Action {
	case protocol.ProtocolActionParse:
		// 解析工坊ID
		log.Printf("触发解析工坊ID: %s", protocolURL.WorkshopID)
		runtime.EventsEmit(a.ctx, "protocol:parse", map[string]string{
			"workshopId": protocolURL.WorkshopID,
		})

	case protocol.ProtocolActionWorkshop:
		// 在管理器中打开工坊页面
		log.Printf("触发打开工坊页面: %s", protocolURL.WorkshopID)
		runtime.EventsEmit(a.ctx, "protocol:workshop", map[string]string{
			"workshopId": protocolURL.WorkshopID,
		})

	case protocol.ProtocolActionFavoriteServer:
		added, err := a.addFavoriteServer(protocolURL.ServerName, protocolURL.ServerAddress)
		if err != nil {
			log.Printf("添加收藏服务器失败: %v", err)
			runtime.EventsEmit(a.ctx, "protocol:error", map[string]string{
				"url":     url,
				"message": "添加收藏服务器失败: " + err.Error(),
			})
			return
		}

		log.Printf("收藏服务器协议处理完成: %s (%s), 新增=%v", protocolURL.ServerName, protocolURL.ServerAddress, added)
		runtime.EventsEmit(a.ctx, "protocol:favorite-server", favoriteServerProtocolEvent{
			ServerName:    protocolURL.ServerName,
			ServerAddress: protocolURL.ServerAddress,
			Added:         added,
		})

	default:
		log.Printf("未知的协议操作: %s", protocolURL.Action)
		runtime.EventsEmit(a.ctx, "protocol:error", map[string]string{
			"url":     url,
			"message": "未知的协议操作",
		})
	}
}

// ForceExitWithPauseLossAccepted starts the confirmed exit sequence without
// blocking the Wails event loop. The risk is rechecked and workers are stopped
// under the same locks, before the confirmation result can become stale.
func (a *App) ForceExitWithPauseLossAccepted(accepted bool) error {
	_, err := a.beginExit(accepted, false)
	return err
}

// ForceExit remains a safe entry point for callers that have not explicitly
// acknowledged possible download progress loss.
func (a *App) ForceExit() {
	_ = a.ForceExitWithPauseLossAccepted(false)
}

func (a *App) beginExit(accepted bool, requireIdleDownloads bool) (DownloadExitRisk, error) {
	a.exitMu.Lock()
	if a.exitInProgress || a.forceClose {
		a.exitMu.Unlock()
		return DownloadExitRisk{}, nil
	}
	a.downloadExitMu.Lock()
	taskManager.mu.Lock()
	risk := downloadExitRiskLocked()
	if requireIdleDownloads && risk.Downloads {
		taskManager.mu.Unlock()
		a.downloadExitMu.Unlock()
		a.exitMu.Unlock()
		return risk, errExitDownloadsBecameActive
	}
	if !accepted && (risk.DownloadLossRisk || risk.DownloadIdentityUnknown) {
		taskManager.mu.Unlock()
		a.downloadExitMu.Unlock()
		a.exitMu.Unlock()
		return risk, errors.New(exitPauseLossConfirmationRequired)
	}
	a.exitInProgress = true
	a.downloadExitRequested = true
	changed := requestPauseDownloadsForExitLocked()
	taskManager.mu.Unlock()
	a.downloadExitMu.Unlock()
	a.exitMu.Unlock()

	// Closing must not wait for a busy application worker pool. A timer runs
	// this bounded shutdown callback independently of the Wails UI thread.
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	time.AfterFunc(0, func() {
		defer cancel()
		for _, task := range changed {
			a.emitDownloadTaskEvent("task_updated", task)
		}
		a.finishExit(ctx)
	})
	return risk, nil
}

func (a *App) finishExit(ctx context.Context) {
	if err := a.pauseDownloadsForExit(ctx); err != nil {
		a.failExit(err)
		return
	}
	if a.ctx == nil {
		a.failExit(fmt.Errorf("窗口运行环境不可用"))
		return
	}
	a.exitMu.Lock()
	a.forceClose = true
	a.exitMu.Unlock()
	runtime.Quit(a.ctx)
}

func (a *App) failExit(err error) {
	log.Printf("退出前保存下载任务失败: %v", err)
	a.cancelDownloadExit()
	a.exitMu.Lock()
	a.exitInProgress = false
	a.exitMu.Unlock()
	if a.ctx != nil && a.ctx.Value("events") != nil {
		runtime.EventsEmit(a.ctx, "exit_save_failed", err.Error())
	}
}

// A paused download still has bytes to save, but it is no longer running and
// needs no confirmation about being paused again.
func (a *App) hasRunningDownloads() bool {
	return a.GetDownloadExitRisk().Downloads
}

func (a *App) showExitConfirmation(risk DownloadExitRisk, uploads bool) {
	if a.ctx != nil && a.ctx.Value("events") != nil {
		runtime.EventsEmit(a.ctx, "show_exit_confirmation", map[string]bool{
			"downloads": risk.Downloads, "uploads": uploads,
			"downloadLossRisk":        risk.DownloadLossRisk,
			"downloadIdentityUnknown": risk.DownloadIdentityUnknown,
		})
	}
}

// beforeClose is called when the application is about to close
func (a *App) beforeClose() (prevent bool) {
	// 窗口此时尚未销毁，先记住当前尺寸
	a.rememberWindowState()

	a.exitMu.Lock()
	forceClose := a.forceClose
	exitInProgress := a.exitInProgress
	a.exitMu.Unlock()
	if forceClose {
		// 退出前同步落盘，进程随后即结束，异步写入没有机会完成
		a.saveConfig()

		// 关闭单例监听器
		if a.singletonMgr != nil {
			a.singletonMgr.Close()
		}
		return false
	}
	if exitInProgress {
		return true
	}

	risk := a.GetDownloadExitRisk()
	uploads := a.HasActivePanelUploads()
	if risk.Downloads || uploads {
		a.showExitConfirmation(risk, uploads)
		return true
	}
	// Recheck after acquiring the admission gate. A download may have been
	// added between the initial read and this no-confirmation exit path.
	if current, err := a.beginExit(false, true); err != nil {
		if errors.Is(err, errExitDownloadsBecameActive) {
			a.showExitConfirmation(current, uploads)
		} else {
			log.Printf("退出前检查下载任务失败: %v", err)
		}
	}
	return true
}

func (a *App) BeforeClose(ctx context.Context) (prevent bool) {
	return a.beforeClose()
}

// SetRootDirectory 设置根目录
