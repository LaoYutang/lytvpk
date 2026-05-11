package app

import (
	"encoding/json"
	"log"
	"os"

	"vpk-manager/internal/network"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func (a *App) loadConfig() {
	if _, err := os.Stat(a.configPath); os.IsNotExist(err) {
		return
	}

	data, err := os.ReadFile(a.configPath)
	if err != nil {
		log.Printf("读取配置文件失败: %v", err)
		return
	}

	var config ConfigFile
	if err := json.Unmarshal(data, &config); err != nil {
		log.Printf("解析配置文件失败: %v", err)
		return
	}

	a.mu.Lock()
	a.modRotationConfig = config.ModRotationConfig
	if config.WorkshopPreferredIP != nil {
		a.workshopPreferredIP = *config.WorkshopPreferredIP
	}
	if config.WorkshopFixedIP != nil {
		a.workshopFixedIP = *config.WorkshopFixedIP
		network.GlobalIPSelector.SetFixedIP(a.workshopFixedIP)
	}
	if config.WorkshopMetaEnabled != nil {
		a.workshopMetaEnabled = *config.WorkshopMetaEnabled
	}
	if config.WorkshopUpdateCheckEnabled != nil {
		a.workshopUpdateCheckEnabled = *config.WorkshopUpdateCheckEnabled
	}
	if config.WorkshopBrowserTarget != nil {
		a.workshopBrowserTarget = *config.WorkshopBrowserTarget
	}
	a.migrationVersion = config.MigrationVersion
	a.mu.Unlock()

	log.Printf("已加载配置: 优选IP=%v, 固定IP=%s, 轮换=%v, 迁移版本=%d, meta存储=%v, 浏览器目标=%s", a.workshopPreferredIP, a.workshopFixedIP, a.modRotationConfig, a.migrationVersion, a.workshopMetaEnabled, a.workshopBrowserTarget)
}

func (a *App) saveConfig() {
	a.mu.RLock()
	v := a.workshopPreferredIP
	fixedIP := a.workshopFixedIP
	metaEnabled := a.workshopMetaEnabled
	updateCheckEnabled := a.workshopUpdateCheckEnabled
	browserTarget := a.workshopBrowserTarget
	config := ConfigFile{
		ModRotationConfig:        a.modRotationConfig,
		WorkshopPreferredIP:      &v,
		WorkshopFixedIP:          &fixedIP,
		WorkshopMetaEnabled:      &metaEnabled,
		WorkshopUpdateCheckEnabled: &updateCheckEnabled,
		WorkshopBrowserTarget:    &browserTarget,
		MigrationVersion:         a.migrationVersion,
	}
	a.mu.RUnlock()

	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		log.Printf("序列化配置失败: %v", err)
		return
	}

	if err := os.WriteFile(a.configPath, data, 0644); err != nil {
		log.Printf("写入配置文件失败: %v", err)
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods

func (a *App) SetWorkshopPreferredIP(enabled bool) {
	a.mu.Lock()
	a.workshopPreferredIP = enabled
	fixedIP := a.workshopFixedIP
	a.mu.Unlock()

	// 保存配置
	a.saveConfig()

	// 如果开启，立即触发一次IP优选（如果尚未优选）
	if enabled {
		runtime.EventsEmit(a.ctx, "ip_selection_start", nil)
		go func() {
			if fixedIP != "" {
				network.GlobalIPSelector.SetFixedIP(fixedIP)
			} else {
				// 使用一个典型的工坊图片域名来测试
				// 实际上 IPSelector 目前是硬编码了获取 IP 的逻辑，这里只需要触发一下
				network.GlobalIPSelector.GetBestIP("https://steamuserimages-a.akamaihd.net/ugc/test")
			}
			runtime.EventsEmit(a.ctx, "ip_selection_end", nil)
		}()
	}
}

// GetWorkshopPreferredIP 获取当前是否开启优选IP
func (a *App) GetWorkshopPreferredIP() bool {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.workshopPreferredIP
}

// SetWorkshopMetaEnabled 开启/关闭工坊meta信息存储
func (a *App) SetWorkshopMetaEnabled(enabled bool) {
	a.mu.Lock()
	a.workshopMetaEnabled = enabled
	a.mu.Unlock()

	// 保存配置
	a.saveConfig()

	// 清空缓存，确保下次扫描应用新规则
	a.vpkCache.Range(func(key, value interface{}) bool {
		a.vpkCache.Delete(key)
		return true
	})
}

// GetWorkshopMetaEnabled 获取当前是否开启工坊meta信息存储
func (a *App) GetWorkshopMetaEnabled() bool {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.workshopMetaEnabled
}

// IsSelectingIP 检查是否正在优选IP
func (a *App) IsSelectingIP() bool {
	return network.GlobalIPSelector.IsSelecting()
}

// GetCurrentBestIP 获取当前优选IP
func (a *App) GetCurrentBestIP() string {
	return network.GlobalIPSelector.GetCachedBestIP()
}

// SetWorkshopFixedIP 设置工坊固定IP（留空则使用自动优选）
func (a *App) SetWorkshopFixedIP(ip string) {
	a.mu.Lock()
	a.workshopFixedIP = ip
	a.mu.Unlock()

	network.GlobalIPSelector.SetFixedIP(ip)
	a.saveConfig()
}

// GetWorkshopFixedIP 获取当前设置的固定IP
func (a *App) GetWorkshopFixedIP() string {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.workshopFixedIP
}

// SetWorkshopBrowserTarget 设置浏览器跳转目标
func (a *App) SetWorkshopBrowserTarget(target string) {
	a.mu.Lock()
	a.workshopBrowserTarget = target
	a.mu.Unlock()
	a.saveConfig()
}

// GetWorkshopBrowserTarget 获取浏览器跳转目标
func (a *App) GetWorkshopBrowserTarget() string {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.workshopBrowserTarget
}

// SetWorkshopUpdateCheckEnabled 开启/关闭工坊Mod更新检测
func (a *App) SetWorkshopUpdateCheckEnabled(enabled bool) {
	a.mu.Lock()
	a.workshopUpdateCheckEnabled = enabled
	a.mu.Unlock()

	// 保存配置
	a.saveConfig()

	// 如果开启，立即触发一次检测
	if enabled && a.workshopMetaEnabled {
		go a.CheckModUpdates()
	}
}

// GetWorkshopUpdateCheckEnabled 获取当前是否开启工坊Mod更新检测
func (a *App) GetWorkshopUpdateCheckEnabled() bool {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.workshopUpdateCheckEnabled
}
