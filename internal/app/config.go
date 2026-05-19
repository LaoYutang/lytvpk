package app

import (
	"encoding/json"
	"errors"
	"log"
	"os"
	"path/filepath"

	"vpk-manager/internal/network"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const configMigrationVersion = 2

type legacyFrontendConfig struct {
	DefaultDirectory          *string          `json:"defaultDirectory"`
	SavedDirectories          []SavedDirectory `json:"savedDirectories"`
	LastActiveDirectory       *string          `json:"lastActiveDirectory"`
	DisplayMode               *string          `json:"displayMode"`
	FilterLayoutMode          *string          `json:"filterLayoutMode"`
	BoxSelectionEnabled       *bool            `json:"boxSelectionEnabled"`
	CtrlClickSelectionEnabled *bool            `json:"ctrlClickSelectionEnabled"`
	WorkshopPreferredIP       *bool            `json:"workshopPreferredIP"`
	ModRotationConfig         *RotationConfig  `json:"modRotationConfig"`
	ModRotationEnabled        *bool            `json:"modRotationEnabled"`
	IgnoredVersion            *string          `json:"ignoredVersion"`
}

func (a *App) ensureConfigPaths() {
	if a.configDir == "" && a.configPath != "" {
		a.configDir = filepath.Dir(a.configPath)
	}
	if a.configDir == "" {
		return
	}
	if a.configPath == "" {
		a.configPath = filepath.Join(a.configDir, "config.json")
	}
	if a.serversPath == "" {
		a.serversPath = filepath.Join(a.configDir, "servers.json")
	}
	if a.workshopWatchLaterPath == "" {
		a.workshopWatchLaterPath = filepath.Join(a.configDir, "workshop_watch_later.json")
	}
}

func (a *App) loadConfig() {
	a.ensureConfigPaths()
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
	a.defaultDirectory = config.DefaultDirectory
	a.savedDirectories = cloneSavedDirectories(config.SavedDirectories)
	a.lastActiveDirectory = config.LastActiveDirectory
	if config.DisplayMode != "" {
		a.displayMode = config.DisplayMode
	}
	if config.FilterLayoutMode != "" {
		a.filterLayoutMode = config.FilterLayoutMode
	}
	a.boxSelectionEnabled = config.BoxSelectionEnabled
	a.ctrlClickSelectionEnabled = config.CtrlClickSelectionEnabled
	a.theme = config.Theme
	a.ignoredVersion = config.IgnoredVersion
	a.lastUpdateCheckTime = config.LastUpdateCheckTime
	a.migrationVersion = config.MigrationVersion
	a.mu.Unlock()

	log.Printf("已加载配置: 优选IP=%v, 固定IP=%s, 轮换=%v, 迁移版本=%d, meta存储=%v, 浏览器目标=%s", a.workshopPreferredIP, a.workshopFixedIP, a.modRotationConfig, a.migrationVersion, a.workshopMetaEnabled, a.workshopBrowserTarget)
}

func (a *App) saveConfig() {
	if err := a.writeConfigFile(a.snapshotConfig()); err != nil {
		log.Printf("写入配置文件失败: %v", err)
	}
}

func (a *App) snapshotConfig() ConfigFile {
	a.mu.RLock()
	defer a.mu.RUnlock()

	preferredIP := a.workshopPreferredIP
	fixedIP := a.workshopFixedIP
	metaEnabled := a.workshopMetaEnabled
	updateCheckEnabled := a.workshopUpdateCheckEnabled
	browserTarget := a.workshopBrowserTarget

	return ConfigFile{
		ModRotationConfig:          a.modRotationConfig,
		WorkshopPreferredIP:        &preferredIP,
		WorkshopFixedIP:            &fixedIP,
		WorkshopMetaEnabled:        &metaEnabled,
		WorkshopUpdateCheckEnabled: &updateCheckEnabled,
		WorkshopBrowserTarget:      &browserTarget,
		DefaultDirectory:           a.defaultDirectory,
		SavedDirectories:           cloneSavedDirectories(a.savedDirectories),
		LastActiveDirectory:        a.lastActiveDirectory,
		DisplayMode:                defaultString(a.displayMode, "list"),
		FilterLayoutMode:           defaultString(a.filterLayoutMode, "compact"),
		BoxSelectionEnabled:        a.boxSelectionEnabled,
		CtrlClickSelectionEnabled:  a.ctrlClickSelectionEnabled,
		Theme:                      a.theme,
		IgnoredVersion:             a.ignoredVersion,
		LastUpdateCheckTime:        a.lastUpdateCheckTime,
		MigrationVersion:           a.migrationVersion,
	}
}

func (a *App) writeConfigFile(config ConfigFile) error {
	a.ensureConfigPaths()
	if a.configDir != "" {
		if err := os.MkdirAll(a.configDir, 0755); err != nil {
			return err
		}
	}

	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(a.configPath, data, 0644)
}

func (a *App) GetConfigMigrationVersion() int {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.migrationVersion
}

func (a *App) GetAppConfig() ConfigFile {
	return a.snapshotConfig()
}

func (a *App) SaveAppConfig(config ConfigFile) error {
	a.mu.Lock()
	a.defaultDirectory = config.DefaultDirectory
	a.savedDirectories = cloneSavedDirectories(config.SavedDirectories)
	a.lastActiveDirectory = config.LastActiveDirectory
	a.displayMode = defaultString(config.DisplayMode, "list")
	a.filterLayoutMode = defaultString(config.FilterLayoutMode, "compact")
	a.boxSelectionEnabled = config.BoxSelectionEnabled
	a.ctrlClickSelectionEnabled = config.CtrlClickSelectionEnabled
	a.theme = config.Theme
	a.ignoredVersion = config.IgnoredVersion
	a.lastUpdateCheckTime = config.LastUpdateCheckTime
	if config.MigrationVersion > a.migrationVersion {
		a.migrationVersion = config.MigrationVersion
	}
	a.mu.Unlock()

	return a.writeConfigFile(a.snapshotConfig())
}

func (a *App) MigrateLocalStorageConfig(payload LocalStorageMigrationPayload) error {
	a.mu.RLock()
	alreadyMigrated := a.migrationVersion >= configMigrationVersion
	a.mu.RUnlock()
	if alreadyMigrated {
		return nil
	}

	var legacyConfig legacyFrontendConfig
	if payload.Config != "" {
		if err := json.Unmarshal([]byte(payload.Config), &legacyConfig); err != nil {
			return err
		}
	}

	if payload.Servers != "" || payload.RecentServers != "" {
		serverStorage, err := parseLegacyServerStorage(payload.Servers, payload.RecentServers)
		if err != nil {
			return err
		}
		if err := a.SaveServerStorage(serverStorage); err != nil {
			return err
		}
	}
	if payload.WatchLaterItems != "" {
		watchLaterStorage, err := parseLegacyWatchLaterStorage(payload.WatchLaterItems)
		if err != nil {
			return err
		}
		if err := a.SaveWorkshopWatchLaterStorage(watchLaterStorage); err != nil {
			return err
		}
	}

	a.mu.Lock()
	if legacyConfig.DefaultDirectory != nil {
		a.defaultDirectory = *legacyConfig.DefaultDirectory
	}
	if legacyConfig.SavedDirectories != nil {
		a.savedDirectories = cloneSavedDirectories(legacyConfig.SavedDirectories)
	}
	if legacyConfig.LastActiveDirectory != nil {
		a.lastActiveDirectory = *legacyConfig.LastActiveDirectory
	}
	if legacyConfig.DisplayMode != nil && *legacyConfig.DisplayMode != "" {
		a.displayMode = *legacyConfig.DisplayMode
	}
	if legacyConfig.FilterLayoutMode != nil && *legacyConfig.FilterLayoutMode != "" {
		a.filterLayoutMode = *legacyConfig.FilterLayoutMode
	}
	if legacyConfig.BoxSelectionEnabled != nil {
		a.boxSelectionEnabled = *legacyConfig.BoxSelectionEnabled
	}
	if legacyConfig.CtrlClickSelectionEnabled != nil {
		a.ctrlClickSelectionEnabled = *legacyConfig.CtrlClickSelectionEnabled
	}
	if legacyConfig.WorkshopPreferredIP != nil {
		a.workshopPreferredIP = *legacyConfig.WorkshopPreferredIP
	}
	if legacyConfig.ModRotationConfig != nil {
		a.modRotationConfig = *legacyConfig.ModRotationConfig
	} else if legacyConfig.ModRotationEnabled != nil {
		a.modRotationConfig = RotationConfig{
			EnableCharacters: *legacyConfig.ModRotationEnabled,
			EnableWeapons:    *legacyConfig.ModRotationEnabled,
		}
	}
	if legacyConfig.IgnoredVersion != nil {
		a.ignoredVersion = *legacyConfig.IgnoredVersion
	}
	if payload.Theme != "" {
		a.theme = payload.Theme
	}
	if payload.LastUpdateCheckTime != "" {
		a.lastUpdateCheckTime = payload.LastUpdateCheckTime
	}
	a.migrationVersion = configMigrationVersion
	a.mu.Unlock()

	if err := a.writeConfigFile(a.snapshotConfig()); err != nil {
		return err
	}

	return nil
}

func (a *App) GetServerStorage() ServerStorage {
	a.ensureConfigPaths()
	var storage ServerStorage
	if err := readJSONFile(a.serversPath, &storage); err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			log.Printf("读取服务器配置失败，已使用空配置: %v", err)
		}
		return ServerStorage{Servers: []SavedServer{}, RecentServers: []RecentServer{}}
	}
	storage.Servers = cloneSavedServers(storage.Servers)
	storage.RecentServers = cloneRecentServers(storage.RecentServers)
	return storage
}

func (a *App) SaveServerStorage(storage ServerStorage) error {
	a.ensureConfigPaths()
	storage.Servers = cloneSavedServers(storage.Servers)
	storage.RecentServers = cloneRecentServers(storage.RecentServers)
	return writeJSONFile(a.configDir, a.serversPath, storage)
}

func (a *App) GetWorkshopWatchLaterStorage() WorkshopWatchLaterStorage {
	a.ensureConfigPaths()
	var storage WorkshopWatchLaterStorage
	if err := readJSONFile(a.workshopWatchLaterPath, &storage); err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			log.Printf("读取稍后再看配置失败，已使用空配置: %v", err)
		}
		return WorkshopWatchLaterStorage{Items: []WorkshopWatchLaterItem{}}
	}
	storage.Items = cloneWatchLaterItems(storage.Items)
	return storage
}

func (a *App) SaveWorkshopWatchLaterStorage(storage WorkshopWatchLaterStorage) error {
	a.ensureConfigPaths()
	storage.Items = cloneWatchLaterItems(storage.Items)
	return writeJSONFile(a.configDir, a.workshopWatchLaterPath, storage)
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
	metaEnabled := a.workshopMetaEnabled
	a.mu.Unlock()

	// 保存配置
	a.saveConfig()

	// 如果开启，立即触发一次检测
	if enabled && metaEnabled {
		go a.CheckModUpdates()
	}
}

// GetWorkshopUpdateCheckEnabled 获取当前是否开启工坊Mod更新检测
func (a *App) GetWorkshopUpdateCheckEnabled() bool {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.workshopUpdateCheckEnabled
}

func parseLegacyServerStorage(serversJSON string, recentServersJSON string) (ServerStorage, error) {
	storage := ServerStorage{Servers: []SavedServer{}, RecentServers: []RecentServer{}}
	if serversJSON != "" {
		if err := json.Unmarshal([]byte(serversJSON), &storage.Servers); err != nil {
			return storage, err
		}
	}
	if recentServersJSON != "" {
		if err := json.Unmarshal([]byte(recentServersJSON), &storage.RecentServers); err != nil {
			return storage, err
		}
	}
	storage.Servers = cloneSavedServers(storage.Servers)
	storage.RecentServers = cloneRecentServers(storage.RecentServers)
	return storage, nil
}

func parseLegacyWatchLaterStorage(itemsJSON string) (WorkshopWatchLaterStorage, error) {
	storage := WorkshopWatchLaterStorage{Items: []WorkshopWatchLaterItem{}}
	if itemsJSON == "" {
		return storage, nil
	}
	if err := json.Unmarshal([]byte(itemsJSON), &storage.Items); err != nil {
		return storage, err
	}
	storage.Items = cloneWatchLaterItems(storage.Items)
	return storage, nil
}

func readJSONFile(path string, dest interface{}) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, dest)
}

func writeJSONFile(dir string, path string, value interface{}) error {
	if dir != "" {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return err
		}
	}
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}

func cloneSavedDirectories(dirs []SavedDirectory) []SavedDirectory {
	if dirs == nil {
		return []SavedDirectory{}
	}
	next := make([]SavedDirectory, len(dirs))
	copy(next, dirs)
	return next
}

func cloneSavedServers(servers []SavedServer) []SavedServer {
	if servers == nil {
		return []SavedServer{}
	}
	next := make([]SavedServer, len(servers))
	copy(next, servers)
	return next
}

func cloneRecentServers(servers []RecentServer) []RecentServer {
	if servers == nil {
		return []RecentServer{}
	}
	next := make([]RecentServer, len(servers))
	copy(next, servers)
	return next
}

func cloneWatchLaterItems(items []WorkshopWatchLaterItem) []WorkshopWatchLaterItem {
	if items == nil {
		return []WorkshopWatchLaterItem{}
	}
	next := make([]WorkshopWatchLaterItem, len(items))
	copy(next, items)
	return next
}

func defaultString(value string, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
