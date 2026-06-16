package app

import (
	"context"
	"log"
	"os"
	"time"

	"vpk-manager/internal/network"
	"vpk-manager/internal/platform/protocol"
	"vpk-manager/internal/platform/urlregistry"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

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

	default:
		log.Printf("未知的协议操作: %s", protocolURL.Action)
		runtime.EventsEmit(a.ctx, "protocol:error", map[string]string{
			"url":     url,
			"message": "未知的协议操作",
		})
	}
}

// ForceExit forces the application to exit
func (a *App) ForceExit() {
	a.forceClose = true
	runtime.Quit(a.ctx)
}

// beforeClose is called when the application is about to close
func (a *App) beforeClose() (prevent bool) {
	if a.forceClose {
		// 关闭单例监听器
		if a.singletonMgr != nil {
			a.singletonMgr.Close()
		}
		return false
	}

	if a.HasActiveDownloads() || a.HasActivePanelUploads() {
		runtime.EventsEmit(a.ctx, "show_exit_confirmation", nil)
		return true
	}

	// 关闭单例监听器
	if a.singletonMgr != nil {
		a.singletonMgr.Close()
	}
	return false
}

func (a *App) BeforeClose(ctx context.Context) (prevent bool) {
	return a.beforeClose()
}

// SetRootDirectory 设置根目录
