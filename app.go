package main

import (
	"archive/zip"
	"context"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	rt "runtime"
	"strings"
	"sync"
	"time"

	"vpk-manager/parser"

	"bytes"
	"encoding/binary"
	"encoding/json"
	"net"

	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/transform"

	"github.com/hymkor/trash-go"
	"github.com/panjf2000/ants/v2"

	"github.com/go-resty/resty/v2"

	"github.com/bodgit/sevenzip"
	"github.com/nwaples/rardecode"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// VPKFile 类型别名,用于Wails绑定
type VPKFile = parser.VPKFile

// ServerInfo 服务器信息
type ServerInfo struct {
	Name       string `json:"name"`
	Map        string `json:"map"`
	Players    int    `json:"players"`
	MaxPlayers int    `json:"max_players"`
	GameDir    string `json:"gamedir"`
	Mode       string `json:"mode"`
}

// ProgressInfo 加载进度信息
type ProgressInfo struct {
	Current int    `json:"current"`
	Total   int    `json:"total"`
	Message string `json:"message"`
}

// ErrorInfo 错误信息
type ErrorInfo struct {
	Type    string `json:"type"`
	Message string `json:"message"`
	File    string `json:"file"`
}

// VPKFileCache 缓存的VPK文件信息
type VPKFileCache struct {
	File         VPKFile
	ModTime      time.Time
	Size         int64
	ImageModTime time.Time // 外部图片修改时间
	CachedAt     time.Time
}

// App struct
type App struct {
	ctx           context.Context
	vpkCache      sync.Map // map[string]*VPKFileCache, key是文件路径
	mu            sync.RWMutex
	rootDir       string
	goroutinePool *ants.Pool
	forceClose    bool
	restyClient   *resty.Client
	proxyServer   *ImageProxyServer

	// 配置项
	modRotationConfig   RotationConfig
	workshopPreferredIP bool
	migrationVersion    int
	configPath          string
}

// ConfigFile 定义配置文件结构
type ConfigFile struct {
	ModRotationConfig   RotationConfig `json:"modRotationConfig"`
	WorkshopPreferredIP bool           `json:"workshopPreferredIP"`
	// 记录已完成的迁移版本，例如: 1 表示已完成逗号到加号的迁移
	MigrationVersion int `json:"migrationVersion"`
}

// RotationConfig Mod轮换配置
type RotationConfig struct {
	EnableCharacters bool `json:"enableCharacters"`
	EnableWeapons    bool `json:"enableWeapons"`
}

// NewApp creates a new App application struct
func NewApp() *App {
	cores := rt.GOMAXPROCS(0)
	// 确保至少有 4 个并发，提升体验
	if cores < 4 {
		cores = 4
	}
	log.Printf("应用启动，CPU核心数: %d, 协程池大小: %d", rt.GOMAXPROCS(0), cores)

	pool, _ := ants.NewPool(cores) // 创建协程池

	// 初始化 Resty 客户端
	client := resty.New()
	client.SetTimeout(2 * time.Second)

	// 启动本地图片代理
	proxy := NewImageProxyServer(globalIPSelector)
	proxy.Start()

	// 确定配置文件路径
	configDir, _ := os.UserConfigDir()
	appConfigDir := filepath.Join(configDir, "LytVPK")
	os.MkdirAll(appConfigDir, 0755)
	configPath := filepath.Join(appConfigDir, "config.json")

	app := &App{
		goroutinePool: pool,
		restyClient:   client,
		proxyServer:   proxy,
		configPath:    configPath,
	}

	// 加载配置
	app.loadConfig()

	return app
}

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
	a.workshopPreferredIP = config.WorkshopPreferredIP
	a.migrationVersion = config.MigrationVersion
	a.mu.Unlock()

	log.Printf("已加载配置: 优选IP=%v, 轮换=%v, 迁移版本=%d", a.workshopPreferredIP, a.modRotationConfig, a.migrationVersion)
}

func (a *App) saveConfig() {
	a.mu.RLock()
	config := ConfigFile{
		ModRotationConfig:   a.modRotationConfig,
		WorkshopPreferredIP: a.workshopPreferredIP,
		MigrationVersion:    a.migrationVersion,
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
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	// 清理旧版本文件
	go func() {
		// 稍微延迟一下，确保旧进程完全退出
		time.Sleep(2 * time.Second)

		// 如果开启了优选IP，启动时自动触发
		if a.GetWorkshopPreferredIP() {
			log.Println("检测到优选IP已开启，后台启动IP优选...")
			// 设置状态为正在选择
			runtime.EventsEmit(a.ctx, "ip_selection_start", nil)

			go func() {
				// 使用一个典型的工坊图片域名来测试
				globalIPSelector.GetBestIP("https://steamuserimages-a.akamaihd.net/ugc/test")
				// 完成后通知前端
				runtime.EventsEmit(a.ctx, "ip_selection_end", nil)
			}()
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

// ForceExit forces the application to exit
func (a *App) ForceExit() {
	a.forceClose = true
	runtime.Quit(a.ctx)
}

// beforeClose is called when the application is about to close
func (a *App) beforeClose(ctx context.Context) (prevent bool) {
	if a.forceClose {
		return false
	}

	if a.HasActiveDownloads() {
		runtime.EventsEmit(a.ctx, "show_exit_confirmation", nil)
		return true
	}
	return false
}

// SetRootDirectory 设置根目录
func (a *App) SetRootDirectory(path string) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	if _, err := os.Stat(path); os.IsNotExist(err) {
		return fmt.Errorf("目录不存在: %s", path)
	}

	a.rootDir = path
	return nil
}

// GetRootDirectory 获取根目录
func (a *App) GetRootDirectory() string {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.rootDir
}

// GetAppVersion 获取当前版本号
func (a *App) GetAppVersion() string {
	return AppVersion
}

// ScanVPKFiles 扫描所有VPK文件（智能缓存版本）
func (a *App) ScanVPKFiles() error {
	if a.rootDir == "" {
		return fmt.Errorf("请先设置根目录")
	}

	var wg sync.WaitGroup

	// 首先扫描所有VPK文件路径
	vpkPaths := make([]string, 0)

	// 扫描根目录（仅扫描根目录本身的VPK文件，不包含子目录）
	err := a.scanRootDirectory(a.rootDir, &vpkPaths)
	if err != nil {
		return err
	}

	// 扫描workshop目录
	workshopDir := filepath.Join(a.rootDir, "workshop")
	if _, err := os.Stat(workshopDir); err == nil {
		err = a.scanDirectory(workshopDir, &vpkPaths)
		if err != nil {
			return err
		}
	}

	// 扫描disabled目录
	disabledDir := filepath.Join(a.rootDir, "disabled")
	if _, err := os.Stat(disabledDir); err == nil {
		err = a.scanDirectory(disabledDir, &vpkPaths)
		if err != nil {
			return err
		}
	}

	// 自动迁移：检查并重命名旧的逗号分隔符文件
	// 仅当迁移版本小于1时执行
	currentMigrationVersion := 1
	if a.migrationVersion < currentMigrationVersion {
		log.Printf("开始执行文件格式迁移 (v%d -> v%d)...", a.migrationVersion, currentMigrationVersion)
		migratedCount := 0

		migratedPaths := make([]string, 0, len(vpkPaths))
		for _, path := range vpkPaths {
			newPath := a.migrateLegacyTagFilename(path)
			migratedPaths = append(migratedPaths, newPath)
			if newPath != path {
				migratedCount++
			}
		}
		vpkPaths = migratedPaths

		log.Printf("迁移完成，处理了 %d 个文件", migratedCount)

		// 更新迁移版本并保存配置
		a.mu.Lock()
		a.migrationVersion = currentMigrationVersion
		a.mu.Unlock()
		a.saveConfig()
	}

	// 创建当前文件路径集合，用于清理不存在的缓存
	currentPaths := make(map[string]bool)
	for _, path := range vpkPaths {
		currentPaths[path] = true
	}

	// 清理缓存中不存在的文件
	a.vpkCache.Range(func(key, value interface{}) bool {
		path := key.(string)
		if !currentPaths[path] {
			a.vpkCache.Delete(path)
			log.Printf("清理缓存: 文件已删除 %s", path)
		}
		return true
	})

	// 并发处理所有文件（使用智能缓存）
	for _, path := range vpkPaths {
		wg.Add(1)
		filePath := path // 捕获变量
		a.goroutinePool.Submit(func() {
			a.processVPKFileWithCache(filePath)
			wg.Done()
		})
	}
	wg.Wait()

	return nil
}

// scanRootDirectory 扫描根目录中的VPK文件（不包含子目录）
func (a *App) scanRootDirectory(dir string, vpkPaths *[]string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(strings.ToLower(entry.Name()), ".vpk") {
			fullPath := filepath.Join(dir, entry.Name())
			*vpkPaths = append(*vpkPaths, fullPath)
		}
	}
	return nil
}

// scanDirectory 扫描指定目录中的VPK文件（递归扫描所有子目录）
func (a *App) scanDirectory(dir string, vpkPaths *[]string) error {
	return filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		if !d.IsDir() && strings.HasSuffix(strings.ToLower(path), ".vpk") {
			*vpkPaths = append(*vpkPaths, path)
		}
		return nil
	})
}

// processVPKFileWithCache 处理单个VPK文件（智能缓存版本）
func (a *App) processVPKFileWithCache(filePath string) {
	info, err := os.Stat(filePath)
	if err != nil {
		log.Printf("无法读取文件信息: %s, 错误: %v", filePath, err)
		return
	}

	modTime := info.ModTime()
	size := info.Size()

	// 检查外部图片状态
	var imgModTime time.Time
	basePath := strings.TrimSuffix(filePath, filepath.Ext(filePath))
	exts := []string{".jpg", ".png", ".jpeg"}
	for _, ext := range exts {
		if imgInfo, statErr := os.Stat(basePath + ext); statErr == nil {
			imgModTime = imgInfo.ModTime()
			break
		}
	}

	// 检查缓存
	if cached, ok := a.vpkCache.Load(filePath); ok {
		cache := cached.(*VPKFileCache)

		// 判断文件是否变化（通过修改时间和大小）以及图片是否变化
		if cache.ModTime.Equal(modTime) && cache.Size == size && cache.ImageModTime.Equal(imgModTime) {
			// 文件和图片都未变化，使用缓存
			// 但需要更新位置信息（因为文件可能被移动）
			location := a.getLocationFromPath(filePath)
			cache.File.Location = location
			cache.File.Enabled = location != "disabled"
			cache.File.Path = filePath // 更新路径（处理移动情况）

			// 更新缓存
			a.vpkCache.Store(filePath, cache)
			log.Printf("使用缓存: %s (未变化)", filepath.Base(filePath))
			return
		}

		log.Printf("文件或图片已变化，重新解析: %s", filepath.Base(filePath))
	}

	// 文件不在缓存中或已变化，需要重新解析
	vpkFile, err := parser.ParseVPKFile(filePath)
	if err != nil {
		a.LogError("VPK解析", err.Error(), filePath)
		return
	}

	// 设置文件系统相关信息
	location := a.getLocationFromPath(filePath)
	vpkFile.Size = size
	vpkFile.Location = location
	vpkFile.Enabled = location != "disabled"
	vpkFile.LastModified = modTime.Format(time.RFC3339)
	vpkFile.Path = filePath

	// 存入缓存
	cache := &VPKFileCache{
		File:         *vpkFile,
		ModTime:      modTime,
		Size:         size,
		ImageModTime: imgModTime,
		CachedAt:     time.Now(),
	}
	a.vpkCache.Store(filePath, cache)

	log.Printf("已解析并缓存: %s", filepath.Base(filePath))
}

// getLocationFromPath 根据文件路径判断位置
func (a *App) getLocationFromPath(filePath string) string {
	rel, _ := filepath.Rel(a.rootDir, filePath)
	parts := strings.Split(rel, string(filepath.Separator))

	if len(parts) > 0 {
		switch parts[0] {
		case "workshop":
			return "workshop"
		case "disabled":
			return "disabled"
		default:
			return "root"
		}
	}
	return "root"
}

// GetVPKFiles 获取所有VPK文件（从缓存中读取）
func (a *App) GetVPKFiles() []VPKFile {
	result := make([]VPKFile, 0)

	a.vpkCache.Range(func(key, value interface{}) bool {
		cache := value.(*VPKFileCache)
		file := cache.File
		// 性能优化：列表请求不返回预览图数据，由前端按需加载
		file.PreviewImage = ""
		result = append(result, file)
		return true
	})

	return result
}

// GetVPKPreviewImage 获取指定VPK文件的预览图（按需加载）
func (a *App) GetVPKPreviewImage(filePath string) string {
	if cached, ok := a.vpkCache.Load(filePath); ok {
		cache := cached.(*VPKFileCache)
		return cache.File.PreviewImage
	}
	return ""
}

// ToggleVPKFile 切换VPK文件的启用状态（智能缓存版本）
// 注意：workshop文件不能直接启用/禁用，需要先转移到root目录
func (a *App) ToggleVPKFile(filePath string) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	// 从缓存中获取文件信息
	cached, ok := a.vpkCache.Load(filePath)
	if !ok {
		return fmt.Errorf("文件未找到: %s", filePath)
	}

	cache := cached.(*VPKFileCache)
	vpkFile := cache.File

	// workshop文件不能直接启用/禁用
	if vpkFile.Location == "workshop" {
		return fmt.Errorf("workshop文件需要先转移到插件目录才能启用/禁用")
	}

	var newPath string
	var err error

	if vpkFile.Enabled && vpkFile.Location == "root" {
		// 禁用文件：从root移动到disabled目录
		disabledDir := filepath.Join(a.rootDir, "disabled")
		os.MkdirAll(disabledDir, 0755)

		newPath = filepath.Join(disabledDir, vpkFile.Name)
		err = os.Rename(vpkFile.Path, newPath)
		if err != nil {
			return err
		}
		// 同步移动同名图片
		a.handleSidecarFile(vpkFile.Path, newPath, "move")

		// 更新文件信息
		vpkFile.Path = newPath
		vpkFile.Enabled = false
		vpkFile.Location = "disabled"

	} else if !vpkFile.Enabled && vpkFile.Location == "disabled" {
		// 启用文件：从disabled移动回root目录
		newPath = filepath.Join(a.rootDir, vpkFile.Name)
		err = os.Rename(vpkFile.Path, newPath)
		if err != nil {
			return err
		}
		// 同步移动同名图片
		a.handleSidecarFile(vpkFile.Path, newPath, "move")

		// 更新文件信息
		vpkFile.Path = newPath
		vpkFile.Enabled = true
		vpkFile.Location = "root"

	} else {
		return fmt.Errorf("无效的文件状态转换")
	}

	// 删除旧路径的缓存
	a.vpkCache.Delete(filePath)

	// 在新路径下存储缓存
	cache.File = vpkFile
	a.vpkCache.Store(newPath, cache)

	log.Printf("文件已移动: %s -> %s", filePath, newPath)

	return nil
}

// MoveWorkshopToAddons 将workshop中的VPK移动到addons目录（root目录）
func (a *App) MoveWorkshopToAddons(filePath string) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	// 从缓存中获取文件信息
	cached, ok := a.vpkCache.Load(filePath)
	if !ok {
		return fmt.Errorf("文件未找到: %s", filePath)
	}

	cache := cached.(*VPKFileCache)
	vpkFile := cache.File

	if vpkFile.Location != "workshop" {
		return fmt.Errorf("只能转移workshop文件")
	}

	newPath := filepath.Join(a.rootDir, vpkFile.Name)
	err := os.Rename(vpkFile.Path, newPath)
	if err != nil {
		return err
	}
	// 同步移动同名图片
	a.handleSidecarFile(vpkFile.Path, newPath, "move")

	// 转移到root目录后，文件默认为启用状态
	vpkFile.Path = newPath
	vpkFile.Location = "root"
	vpkFile.Enabled = true

	// 删除旧路径的缓存
	a.vpkCache.Delete(filePath)

	// 在新路径下存储缓存
	cache.File = vpkFile
	a.vpkCache.Store(newPath, cache)

	log.Printf("文件已转移: %s -> %s", filePath, newPath)

	return nil
}

// SearchVPKFiles 搜索VPK文件（从缓存中搜索）
func (a *App) SearchVPKFiles(query string, primaryTag string, secondaryTags []string) []VPKFile {
	result := make([]VPKFile, 0)
	query = strings.ToLower(query)

	a.vpkCache.Range(func(key, value interface{}) bool {
		cache := value.(*VPKFileCache)
		vpkFile := cache.File

		// 搜索文本匹配：标题、文件名或标签名
		textMatch := query == ""
		if query != "" {
			// 匹配标题
			if fuzzyMatch(query, strings.ToLower(vpkFile.Title)) {
				textMatch = true
			}
			// 匹配文件名
			if !textMatch && fuzzyMatch(query, strings.ToLower(vpkFile.Name)) {
				textMatch = true
			}
			// 匹配主标签
			if !textMatch && fuzzyMatch(query, strings.ToLower(vpkFile.PrimaryTag)) {
				textMatch = true
			}
			// 匹配二级标签
			if !textMatch {
				for _, tag := range vpkFile.SecondaryTags {
					if fuzzyMatch(query, strings.ToLower(tag)) {
						textMatch = true
						break
					}
				}
			}
		}

		// 主标签筛选匹配
		primaryMatch := primaryTag == "" || vpkFile.PrimaryTag == primaryTag

		// 二级标签筛选匹配
		secondaryMatch := len(secondaryTags) == 0
		if len(secondaryTags) > 0 {
			for _, tag := range secondaryTags {
				for _, vpkTag := range vpkFile.SecondaryTags {
					if vpkTag == tag {
						secondaryMatch = true
						break
					}
				}
				if secondaryMatch {
					break
				}
			}
		}

		if textMatch && primaryMatch && secondaryMatch {
			// 性能优化：列表请求不返回预览图数据，由前端按需加载
			vpkFile.PreviewImage = ""
			result = append(result, vpkFile)
		}

		return true
	})

	return result
}

// GetPrimaryTags 获取所有主要标签
func (a *App) GetPrimaryTags() []string {
	return parser.GetPrimaryTags()
}

// GetSecondaryTags 获取指定主标签下的所有二级标签（从缓存中获取）
func (a *App) GetSecondaryTags(primaryTag string) []string {
	// 从缓存中收集所有文件
	vpkFiles := make([]VPKFile, 0)
	a.vpkCache.Range(func(key, value interface{}) bool {
		cache := value.(*VPKFileCache)
		vpkFiles = append(vpkFiles, cache.File)
		return true
	})

	return parser.GetSecondaryTags(vpkFiles, primaryTag)
}

// SelectDirectory 选择文件夹对话框
func (a *App) SelectDirectory() (string, error) {
	directory, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title:                "选择 L4D2 addons 目录",
		ShowHiddenFiles:      false,
		CanCreateDirectories: false,
	})

	if err != nil {
		return "", err
	}

	if directory == "" {
		return "", fmt.Errorf("未选择目录")
	}

	return directory, nil
}

// AutoDiscoverAddons 自动搜索addons目录
func (a *App) AutoDiscoverAddons() (string, error) {
	// 常见的相对路径
	commonPaths := []string{
		"Steam/steamapps/common/Left 4 Dead 2/left4dead2/addons",
		"SteamLibrary/steamapps/common/Left 4 Dead 2/left4dead2/addons",
		"Program Files (x86)/Steam/steamapps/common/Left 4 Dead 2/left4dead2/addons",
		"Program Files/Steam/steamapps/common/Left 4 Dead 2/left4dead2/addons",
		"Games/Steam/steamapps/common/Left 4 Dead 2/left4dead2/addons",
	}

	// 获取所有盘符
	drives := []string{}
	for _, drive := range "ABCDEFGHIJKLMNOPQRSTUVWXYZ" {
		drivePath := string(drive) + ":\\"
		_, err := os.Stat(drivePath)
		if err == nil {
			drives = append(drives, drivePath)
		}
	}

	// 遍历搜索
	for _, drive := range drives {
		for _, path := range commonPaths {
			fullPath := filepath.Join(drive, path)
			// 检查目录是否存在
			info, err := os.Stat(fullPath)
			if err == nil && info.IsDir() {
				return fullPath, nil
			}
		}
	}

	return "", nil
}

// SelectFiles 选择文件对话框 (支持多选)
func (a *App) SelectFiles() ([]string, error) {
	files, err := runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择文件 (VPK, ZIP, RAR, 7Z)",
		Filters: []runtime.FileFilter{
			{
				DisplayName: "支持的文件 (*.vpk;*.zip;*.rar;*.7z)",
				Pattern:     "*.vpk;*.zip;*.rar;*.7z",
			},
			{
				DisplayName: "VPK 文件 (*.vpk)",
				Pattern:     "*.vpk",
			},
			{
				DisplayName: "压缩包 (*.zip;*.rar;*.7z)",
				Pattern:     "*.zip;*.rar;*.7z",
			},
			{
				DisplayName: "所有文件 (*.*)",
				Pattern:     "*.*",
			},
		},
	})
	if err != nil {
		return nil, err
	}
	return files, nil
}

// LogError 记录错误
func (a *App) LogError(errorType, message, file string) {
	errorInfo := ErrorInfo{
		Type:    errorType,
		Message: message,
		File:    file,
	}

	log.Printf("[%s] %s: %s", errorType, file, message)
	runtime.EventsEmit(a.ctx, "error", errorInfo)
}

// ValidateDirectory 验证目录是否有效
func (a *App) ValidateDirectory(path string) error {
	if path == "" {
		return fmt.Errorf("路径不能为空")
	}

	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("目录不存在: %s", path)
		}
		return fmt.Errorf("无法访问目录: %s", err.Error())
	}

	if !info.IsDir() {
		return fmt.Errorf("路径不是一个目录: %s", path)
	}

	// 检查是否有读取权限
	testFile := filepath.Join(path, ".vpk-manager-test")
	if err := os.WriteFile(testFile, []byte("test"), 0644); err != nil {
		return fmt.Errorf("没有写入权限: %s", err.Error())
	}
	os.Remove(testFile)

	return nil
}

// LaunchL4D2 启动L4D2游戏
func (a *App) LaunchL4D2() error {
	// 尝试执行 Mod 轮换
	if err := a.RotateMods(); err != nil {
		// 仅记录日志，不弹窗，因为 RotateMods 内部已经弹窗报错了
		log.Printf("Mod轮换失败: %v", err)
		// 即使轮换失败，也继续启动游戏
	}

	// 使用 Steam 协议启动游戏
	steamURL := "steam://rungameid/550"

	// 使用 Wails 的 BrowserOpenURL 方法打开 Steam 链接
	runtime.BrowserOpenURL(a.ctx, steamURL)

	return nil
}

// ConnectToServer 连接到指定服务器
func (a *App) ConnectToServer(address string) error {
	// 尝试执行 Mod 轮换
	if err := a.RotateMods(); err != nil {
		log.Printf("Mod轮换失败: %v", err)
	}

	steamURL := fmt.Sprintf("steam://connect/%s", address)
	runtime.BrowserOpenURL(a.ctx, steamURL)
	return nil
}

// OpenFileLocation 打开文件所在位置
func (a *App) OpenFileLocation(filePath string) error {
	if filePath == "" {
		return fmt.Errorf("文件路径为空")
	}

	// 规范化路径，解决 Windows 路径分隔符不一致的问题
	cleanPath := filepath.Clean(filePath)

	absPath, err := filepath.Abs(cleanPath)
	if err == nil {
		cleanPath = absPath
	}

	// 检查文件是否存在
	if _, statErr := os.Stat(cleanPath); os.IsNotExist(statErr) {
		return fmt.Errorf("文件不存在: %s", cleanPath)
	}

	// 根据操作系统打开文件管理器
	var cmd *exec.Cmd
	switch rt.GOOS {
	case "windows":
		// Windows: 使用 explorer 并选中文件
		// 尝试先替换掉正斜杠
		winPath := strings.ReplaceAll(cleanPath, "/", "\\")

		// 如果路径包含逗号，explorer /select,path 会失败，因为逗号是分隔符
		if strings.Contains(winPath, ",") {
			// 如果包含逗号，/select, 可能无法工作。尝试只打开文件夹
			cmd = exec.Command("explorer", filepath.Dir(winPath))
		} else {
			cmd = exec.Command("explorer", "/select,", winPath)
		}
	case "darwin":
		// macOS: 使用 open 并选中文件
		cmd = exec.Command("open", "-R", cleanPath)
	case "linux":
		// Linux: 使用 xdg-open 打开目录
		dir := filepath.Dir(cleanPath)
		cmd = exec.Command("xdg-open", dir)
	default:
		return fmt.Errorf("不支持的操作系统: %s", rt.GOOS)
	}

	err = cmd.Start()
	if err != nil {
		return fmt.Errorf("打开文件位置失败: %s", err.Error())
	}

	return nil
}

// DeleteVPKFile 删除VPK文件到回收站
func (a *App) DeleteVPKFile(filePath string) error {
	if filePath == "" {
		return fmt.Errorf("文件路径为空")
	}

	// 检查文件是否存在
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return fmt.Errorf("文件不存在: %s", filePath)
	}

	// 使用 trash 库删除文件到回收站
	err := trash.Throw(filePath)
	if err != nil {
		return fmt.Errorf("删除文件失败: %s", err.Error())
	}
	// 同步删除同名图片
	a.handleSidecarFile(filePath, "", "delete")

	return nil
}

// DeleteVPKFiles 批量删除VPK文件到回收站
func (a *App) DeleteVPKFiles(filePaths []string) error {
	if len(filePaths) == 0 {
		return fmt.Errorf("文件列表为空")
	}

	var errs []string
	for _, filePath := range filePaths {
		if filePath == "" {
			continue
		}
		// 检查文件是否存在
		if _, err := os.Stat(filePath); os.IsNotExist(err) {
			errs = append(errs, fmt.Sprintf("文件不存在: %s", filePath))
			continue
		}

		// 使用 trash 库删除文件到回收站
		err := trash.Throw(filePath)
		if err != nil {
			errs = append(errs, fmt.Sprintf("删除文件 %s 失败: %v", filePath, err))
		} else {
			// 同步删除同名图片
			a.handleSidecarFile(filePath, "", "delete")
		}
	}

	if len(errs) > 0 {
		return fmt.Errorf("批量删除部分失败:\n%s", strings.Join(errs, "\n"))
	}

	return nil
}

// ExtractVPKFromZip 从ZIP文件中解压所有VPK文件到指定目录（多协程并行解压）
func (a *App) ExtractVPKFromZip(zipPath string, destDir string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return fmt.Errorf("无法打开ZIP文件: %v", err)
	}
	defer r.Close()

	// 过滤出所有VPK文件
	var vpkFiles []*zip.File
	for _, f := range r.File {
		if strings.HasSuffix(strings.ToLower(f.Name), ".vpk") {
			vpkFiles = append(vpkFiles, f)
		}
	}

	if len(vpkFiles) == 0 {
		return fmt.Errorf("ZIP文件中未找到VPK文件")
	}

	log.Printf("开始并行解压 ZIP: %s, 包含 %d 个VPK文件, 并发协程池容量: %d", filepath.Base(zipPath), len(vpkFiles), a.goroutinePool.Cap())

	var wg sync.WaitGroup
	var extractErr error
	var errMu sync.Mutex
	extractedCount := 0
	var countMu sync.Mutex

	for _, f := range vpkFiles {
		wg.Add(1)
		file := f // 闭包变量捕获

		err := a.goroutinePool.Submit(func() {
			log.Printf(">>> 开始解压: %s", file.Name)
			defer wg.Done()

			// 如果已经有错误发生，提前退出
			errMu.Lock()
			if extractErr != nil {
				errMu.Unlock()
				return
			}
			errMu.Unlock()

			filename := file.Name
			// 处理编码问题 (CP437 -> UTF-8)
			if file.Flags&0x800 == 0 { // 如果没有设置UTF-8标志位
				i := bytes.NewReader([]byte(filename))
				decoder := transform.NewReader(i, simplifiedchinese.GBK.NewDecoder())
				content, _ := io.ReadAll(decoder)
				if len(content) > 0 {
					filename = string(content)
				}
			}

			targetPath := filepath.Join(destDir, filepath.Base(filename))

			rc, err := file.Open()
			if err != nil {
				log.Printf("无法打开ZIP中的文件 %s: %v", filename, err)
				return
			}
			defer rc.Close()

			outFile, err := os.Create(targetPath)
			if err != nil {
				log.Printf("无法创建目标文件 %s: %v", targetPath, err)
				return
			}
			defer outFile.Close()

			_, err = io.Copy(outFile, rc)
			if err != nil {
				log.Printf("解压文件 %s 失败: %v", filename, err)
				os.Remove(targetPath)
				return
			}

			countMu.Lock()
			extractedCount++
			countMu.Unlock()
			log.Printf("<<< 完成解压: %s -> %s", filename, targetPath)
		})

		if err != nil {
			wg.Done() // 提交失败需要手动 Done
			log.Printf("提交解压任务失败: %v", err)
		}
	}

	wg.Wait()

	if extractErr != nil {
		return extractErr
	}

	if extractedCount == 0 {
		return fmt.Errorf("未成功解压任何VPK文件")
	}

	return nil
}

// ExtractVPKFromRar 从RAR文件中解压所有VPK文件到指定目录（串行解压，rardecode库不支持并发读取）
func (a *App) ExtractVPKFromRar(rarPath string, destDir string) error {
	f, err := os.Open(rarPath)
	if err != nil {
		return fmt.Errorf("无法打开RAR文件: %v", err)
	}
	defer f.Close()

	r, err := rardecode.NewReader(f, "")
	if err != nil {
		return fmt.Errorf("无法创建RAR读取器: %v", err)
	}

	extractedCount := 0
	for {
		header, err := r.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("读取RAR内容失败: %v", err)
		}

		if header.IsDir {
			continue
		}

		filename := header.Name
		// 检查是否为GBK编码 (RAR通常使用本地编码)
		// 这里简单处理，如果包含非UTF-8字符可能需要转换，但rardecode通常处理得不错
		// 如果需要可以加上类似zip的编码转换逻辑

		if strings.HasSuffix(strings.ToLower(filename), ".vpk") {
			targetPath := filepath.Join(destDir, filepath.Base(filename))

			outFile, err := os.Create(targetPath)
			if err != nil {
				log.Printf("无法创建目标文件 %s: %v", targetPath, err)
				continue
			}

			_, err = io.Copy(outFile, r)
			outFile.Close()

			if err != nil {
				log.Printf("解压文件 %s 失败: %v", filename, err)
				os.Remove(targetPath)
				continue
			}

			extractedCount++
			log.Printf("已解压: %s -> %s", filename, targetPath)
		}
	}

	if extractedCount == 0 {
		return fmt.Errorf("RAR文件中未找到VPK文件")
	}
	return nil
}

// ExtractVPKFrom7z 从7z文件中解压所有VPK文件到指定目录（多协程并行解压）
func (a *App) ExtractVPKFrom7z(sevenZPath string, destDir string) error {
	r, err := sevenzip.OpenReader(sevenZPath)
	if err != nil {
		return fmt.Errorf("无法打开7z文件: %v", err)
	}
	defer r.Close()

	// 过滤出所有VPK文件
	var vpkFiles []*sevenzip.File
	for _, f := range r.File {
		if strings.HasSuffix(strings.ToLower(f.Name), ".vpk") {
			vpkFiles = append(vpkFiles, f)
		}
	}

	if len(vpkFiles) == 0 {
		return fmt.Errorf("7z文件中未找到VPK文件")
	}

	log.Printf("开始并行解压 7z: %s, 包含 %d 个VPK文件, 并发协程池容量: %d", filepath.Base(sevenZPath), len(vpkFiles), a.goroutinePool.Cap())

	var wg sync.WaitGroup
	var extractErr error
	var errMu sync.Mutex
	extractedCount := 0
	var countMu sync.Mutex

	for _, f := range vpkFiles {
		wg.Add(1)
		file := f // 闭包变量捕获

		err := a.goroutinePool.Submit(func() {
			log.Printf(">>> 开始解压: %s", file.Name)
			defer wg.Done()

			// 如果已经有错误发生，提前退出
			errMu.Lock()
			if extractErr != nil {
				errMu.Unlock()
				return
			}
			errMu.Unlock()

			filename := file.Name
			targetPath := filepath.Join(destDir, filepath.Base(filename))

			rc, err := file.Open()
			if err != nil {
				log.Printf("无法打开7z中的文件 %s: %v", filename, err)
				return
			}
			defer rc.Close()

			outFile, err := os.Create(targetPath)
			if err != nil {
				log.Printf("无法创建目标文件 %s: %v", targetPath, err)
				return
			}
			defer outFile.Close()

			_, err = io.Copy(outFile, rc)
			if err != nil {
				log.Printf("解压文件 %s 失败: %v", filename, err)
				os.Remove(targetPath)
				// 记录错误但不中断其他解压，除非是严重错误？这里选择记录错误
				// 如果希望只要有一个失败就全部失败：
				// errMu.Lock()
				// extractErr = err
				// errMu.Unlock()
				return
			}

			countMu.Lock()
			extractedCount++
			countMu.Unlock()
			log.Printf("<<< 完成解压: %s -> %s", filename, targetPath)
		})

		if err != nil {
			wg.Done() // 提交失败需要手动 Done
			log.Printf("提交解压任务失败: %v", err)
		}
	}

	wg.Wait()

	if extractErr != nil {
		return extractErr
	}

	if extractedCount == 0 {
		return fmt.Errorf("未成功解压任何VPK文件")
	}
	return nil
}

// ExtractVPKFromArchive 根据文件扩展名自动选择解压方式
func (a *App) ExtractVPKFromArchive(archivePath string, destDir string) error {
	ext := strings.ToLower(filepath.Ext(archivePath))
	switch ext {
	case ".zip":
		return a.ExtractVPKFromZip(archivePath, destDir)
	case ".rar":
		return a.ExtractVPKFromRar(archivePath, destDir)
	case ".7z":
		return a.ExtractVPKFrom7z(archivePath, destDir)
	default:
		return fmt.Errorf("不支持的压缩格式: %s", ext)
	}
}

// HandleFileDrop 处理文件拖拽
func (a *App) HandleFileDrop(paths []string) {
	if a.rootDir == "" {
		a.LogError("拖拽安装", "请先设置游戏根目录", "")
		return
	}

	successCount := 0
	failCount := 0
	var mu sync.Mutex
	var wg sync.WaitGroup

	for _, path := range paths {
		wg.Add(1)
		go func(p string) {
			defer wg.Done()

			lowerPath := strings.ToLower(p)
			var err error
			success := false

			if strings.HasSuffix(lowerPath, ".vpk") {
				// Copy VPK to rootDir
				err = a.installVPKFile(p)
				if err != nil {
					a.LogError("安装VPK失败", err.Error(), filepath.Base(p))
				} else {
					success = true
				}
			} else if strings.HasSuffix(lowerPath, ".zip") || strings.HasSuffix(lowerPath, ".rar") || strings.HasSuffix(lowerPath, ".7z") {
				// Extract Archive to rootDir
				err = a.ExtractVPKFromArchive(p, a.rootDir)
				if err != nil {
					a.LogError("解压压缩包失败", err.Error(), filepath.Base(p))
				} else {
					success = true
				}
			} else {
				a.LogError("不支持的文件格式", "仅支持 .vpk, .zip, .rar, .7z 文件", filepath.Base(p))
			}

			mu.Lock()
			if success {
				successCount++
			} else {
				failCount++
			}
			mu.Unlock()
		}(path)
	}

	wg.Wait()

	if successCount > 0 {
		// 刷新文件列表
		runtime.EventsEmit(a.ctx, "refresh_files", nil)

		msg := fmt.Sprintf("成功处理 %d 个文件", successCount)
		if failCount > 0 {
			msg += fmt.Sprintf("，失败 %d 个", failCount)
		}
		runtime.EventsEmit(a.ctx, "show_toast", map[string]string{"type": "success", "message": msg})
	}
}

// queryA2S 使用 UDP 协议直接查询 Source 引擎服务器信息
// PlayerInfo 玩家信息
type PlayerInfo struct {
	Name     string  `json:"name"`
	Score    int32   `json:"score"`
	Duration float32 `json:"duration"`
}

// FetchPlayerList 获取服务器玩家列表
func (a *App) FetchPlayerList(address string) ([]PlayerInfo, error) {
	var lastErr error
	for i := 0; i < 3; i++ {
		players, err := queryA2SPlayers(address)
		if err == nil {
			return players, nil
		}
		lastErr = err
		if i < 2 {
			time.Sleep(time.Duration(200*(i+1)) * time.Millisecond)
		}
	}
	return nil, fmt.Errorf("查询玩家列表失败(重试3次): %v", lastErr)
}

// queryA2SPlayers 使用 UDP 协议查询服务器玩家列表
func queryA2SPlayers(address string) ([]PlayerInfo, error) {
	conn, err := net.DialTimeout("udp", address, 3*time.Second)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	conn.SetDeadline(time.Now().Add(3 * time.Second))

	// A2S_PLAYER Request: FF FF FF FF 55 FF FF FF FF (Initial request with -1 challenge)
	req := []byte{0xFF, 0xFF, 0xFF, 0xFF, 0x55, 0xFF, 0xFF, 0xFF, 0xFF}
	_, err = conn.Write(req)
	if err != nil {
		return nil, err
	}

	resp := make([]byte, 65535)
	n, err := conn.Read(resp)
	if err != nil {
		return nil, err
	}
	resp = resp[:n]

	// Parse response header
	if n < 5 || !bytes.Equal(resp[:4], []byte{0xFF, 0xFF, 0xFF, 0xFF}) {
		return nil, fmt.Errorf("invalid response header")
	}

	// Handle Challenge (0x41 'A') - This is expected for A2S_PLAYER
	if resp[4] == 0x41 {
		if n < 9 {
			return nil, fmt.Errorf("invalid challenge response length")
		}
		challenge := resp[5:9]

		// Resend query with challenge
		// Request: FF FF FF FF 55 <Challenge>
		reqWithChallenge := []byte{0xFF, 0xFF, 0xFF, 0xFF, 0x55}
		reqWithChallenge = append(reqWithChallenge, challenge...)
		_, err = conn.Write(reqWithChallenge)
		if err != nil {
			return nil, err
		}

		// Read response again
		resp = make([]byte, 65535)
		n, err = conn.Read(resp)
		if err != nil {
			return nil, err
		}
		resp = resp[:n]

		// Check header again
		if n < 5 || !bytes.Equal(resp[:4], []byte{0xFF, 0xFF, 0xFF, 0xFF}) {
			return nil, fmt.Errorf("invalid response header after challenge")
		}
	}

	if resp[4] != 0x44 { // 'D' for Players
		return nil, fmt.Errorf("invalid response type: %x", resp[4])
	}

	reader := bytes.NewBuffer(resp[5:])

	// Number of players
	numPlayers, err := reader.ReadByte()
	if err != nil {
		return nil, err
	}

	var players []PlayerInfo
	for i := 0; i < int(numPlayers); i++ {
		// Index
		_, err := reader.ReadByte()
		if err != nil {
			break
		}

		// Name
		name, err := reader.ReadString(0x00)
		if err != nil {
			break
		}
		name = name[:len(name)-1]

		// Score
		var score int32
		err = binary.Read(reader, binary.LittleEndian, &score)
		if err != nil {
			break
		}

		// Duration
		var duration float32
		err = binary.Read(reader, binary.LittleEndian, &duration)
		if err != nil {
			break
		}

		if name != "" {
			players = append(players, PlayerInfo{
				Name:     name,
				Score:    score,
				Duration: duration,
			})
		}
	}

	return players, nil
}

func queryA2S(address string) (*ServerInfo, error) {
	conn, err := net.DialTimeout("udp", address, 3*time.Second)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	conn.SetDeadline(time.Now().Add(3 * time.Second))

	// TSource Engine Query
	req := []byte{0xFF, 0xFF, 0xFF, 0xFF, 0x54, 0x53, 0x6F, 0x75, 0x72, 0x63, 0x65, 0x20, 0x45, 0x6E, 0x67, 0x69, 0x6E, 0x65, 0x20, 0x51, 0x75, 0x65, 0x72, 0x79, 0x00}
	_, err = conn.Write(req)
	if err != nil {
		return nil, err
	}

	resp := make([]byte, 65535)
	n, err := conn.Read(resp)
	if err != nil {
		return nil, err
	}
	resp = resp[:n]

	// Parse response header
	if n < 5 || !bytes.Equal(resp[:4], []byte{0xFF, 0xFF, 0xFF, 0xFF}) {
		return nil, fmt.Errorf("invalid response header")
	}

	// Handle Challenge (0x41 'A')
	if resp[4] == 0x41 {
		if n < 9 {
			return nil, fmt.Errorf("invalid challenge response length")
		}
		challenge := resp[5:9]

		// Resend query with challenge
		// 注意：这里必须创建一个新的切片，因为 req 是字面量，append 可能会修改底层数组（虽然这里长度固定，但为了安全）
		// 实际上 req 是 []byte{...}，len=25, cap=25。append 会分配新数组。
		// 但是为了绝对安全，我们显式复制
		reqWithChallenge := make([]byte, len(req)+len(challenge))
		copy(reqWithChallenge, req)
		copy(reqWithChallenge[len(req):], challenge)

		_, err = conn.Write(reqWithChallenge)
		if err != nil {
			return nil, err
		}

		// Read response again
		// 必须重置缓冲区，否则旧数据可能残留（虽然我们用了 resp[:n]）
		// 关键：如果服务器返回的数据比缓冲区小，resp[:n] 是对的。
		// 但是如果我们在循环中重用 conn，可能会有问题。这里是单次连接。
		resp = make([]byte, 65535)
		n, err = conn.Read(resp)
		if err != nil {
			return nil, err
		}
		resp = resp[:n]

		// Check header again
		if n < 5 || !bytes.Equal(resp[:4], []byte{0xFF, 0xFF, 0xFF, 0xFF}) {
			return nil, fmt.Errorf("invalid response header after challenge")
		}
	}

	if resp[4] != 0x49 { // 'I'
		return nil, fmt.Errorf("invalid response type: %x", resp[4])
	}

	reader := bytes.NewBuffer(resp[5:])

	readString := func() (string, error) {
		str, readErr := reader.ReadString(0x00)
		if readErr != nil {
			return "", readErr
		}
		return str[:len(str)-1], nil
	}

	// Protocol
	_, err = reader.ReadByte()
	if err != nil {
		return nil, err
	}

	// Name
	name, err := readString()
	if err != nil {
		return nil, err
	}

	// Map
	mapName, err := readString()
	if err != nil {
		return nil, err
	}

	// Folder
	folder, err := readString()
	if err != nil {
		return nil, err
	}

	// Game
	_, err = readString()
	if err != nil {
		return nil, err
	}

	// ID
	var id int16
	err = binary.Read(reader, binary.LittleEndian, &id)
	if err != nil {
		return nil, err
	}

	// Players
	players, err := reader.ReadByte()
	if err != nil {
		return nil, err
	}

	// MaxPlayers
	maxPlayers, err := reader.ReadByte()
	if err != nil {
		return nil, err
	}

	// Bots
	_, err = reader.ReadByte()
	if err != nil {
		return nil, err
	}

	// ServerType
	_, err = reader.ReadByte()
	if err != nil {
		return nil, err
	}

	// Environment
	_, err = reader.ReadByte()
	if err != nil {
		return nil, err
	}

	// Visibility
	_, err = reader.ReadByte()
	if err != nil {
		return nil, err
	}

	// VAC
	_, err = reader.ReadByte()
	if err != nil {
		return nil, err
	}

	// Version
	_, err = readString()
	if err != nil {
		return nil, err
	}

	// Extra Data Flag
	edf, err := reader.ReadByte()
	if err == nil {
		if edf&0x80 != 0 {
			// Port
			var port int16
			binary.Read(reader, binary.LittleEndian, &port)
		}
		if edf&0x10 != 0 {
			// SteamID
			var steamID int64
			binary.Read(reader, binary.LittleEndian, &steamID)
		}
		if edf&0x40 != 0 {
			// SourceTV
			var port int16
			binary.Read(reader, binary.LittleEndian, &port)
			readString()
		}
		if edf&0x20 != 0 {
			// Keywords (Tags)
			tags, err := readString()
			if err == nil {
				mode := parseGameMode(tags)
				return &ServerInfo{
					Name:       name,
					Map:        mapName,
					Players:    int(players),
					MaxPlayers: int(maxPlayers),
					GameDir:    folder,
					Mode:       mode,
				}, nil
			}
		}
	}

	// Fallback if no tags found
	return &ServerInfo{
		Name:       name,
		Map:        mapName,
		Players:    int(players),
		MaxPlayers: int(maxPlayers),
		GameDir:    folder,
		Mode:       "未知模式",
	}, nil
}

// FetchServerInfo 获取服务器详细信息
func (a *App) FetchServerInfo(address string) (*ServerInfo, error) {
	// 使用 UDP 直连查询 (A2S_INFO) - 增加重试机制
	var lastErr error
	for i := 0; i < 3; i++ {
		info, err := queryA2S(address)
		if err == nil {
			return info, nil
		}
		lastErr = err
		// 简单的退避策略
		if i < 2 {
			time.Sleep(time.Duration(200*(i+1)) * time.Millisecond)
		}
	}
	return nil, fmt.Errorf("查询服务器失败(重试3次): %v", lastErr)
}

func parseGameMode(gametypeStr string) string {
	gametypeStr = strings.ToLower(gametypeStr)
	tags := strings.Split(gametypeStr, ",")
	var modeTag string
	for _, tag := range tags {
		if strings.HasPrefix(tag, "m:") {
			modeTag = strings.TrimPrefix(tag, "m:")
			break
		}
	}

	// 如果没有找到 m: 标签，尝试使用启发式匹配
	if modeTag == "" {
		if strings.Contains(gametypeStr, "realismversus") {
			return "写实对抗"
		}
		if strings.Contains(gametypeStr, "coop") {
			return "战役"
		}
		if strings.Contains(gametypeStr, "versus") {
			return "对抗"
		}
		if strings.Contains(gametypeStr, "realism") {
			return "写实"
		}
		if strings.Contains(gametypeStr, "survival") {
			return "生存"
		}
		if strings.Contains(gametypeStr, "scavenge") {
			return "清道夫"
		}
		if strings.Contains(gametypeStr, "mutation") {
			return "突变"
		}
		return "未知模式"
	}

	// 映射常见的模式名称
	switch modeTag {
	case "coop":
		return "战役"
	case "versus":
		return "对抗"
	case "realism":
		return "写实"
	case "survival":
		return "生存"
	case "scavenge":
		return "清道夫"
	case "realismversus":
		return "写实对抗"
	case "teamversus":
		return "对抗"
	case "teamscavenge":
		return "清道夫"
	case "dash":
		return "生存跑酷 (Dash)"
	case "holdout":
		return "死守 (Holdout)"
	case "shootzones":
		return "射击禁区 (Shootzones)"
	// 突变模式映射
	case "mutation1":
		return "吉布节 (Gib Fest)"
	case "mutation2":
		return "大流血 (Bleed Out)"
	case "mutation3":
		return "血流不止"
	case "mutation4":
		return "绝境求生"
	case "mutation5":
		return "四剑客 (Four Swordsmen)"
	case "mutation6":
		return "铁人 (Iron Man)"
	case "mutation7":
		return "最后一人 (Last Man on Earth)"
	case "mutation8":
		return "链锯惊魂 (Chainsaw Massacre)"
	case "mutation9":
		return "房间清理 (Room for One)"
	case "mutation10":
		return "猎头者 (Headshot!)"
	case "mutation11":
		return "对抗生存 (Versus Survival)"
	case "mutation12":
		return "写实对抗 (Realism Versus)"
	case "mutation13":
		return "跟随 (Follow the Liter)"
	case "mutation14":
		return "猎人包围 (Hunting Party)"
	case "mutation15":
		return "孤胆枪手 (Lone Gunman)"
	case "mutation16":
		return "特感速递 (Special Delivery)"
	case "mutation17":
		return "流感季节 (Flu Season)"
	case "mutation18":
		return "骑师派对 (Riding My Survivor)"
	case "mutation19":
		return "噩梦 (Nightmare)"
	case "mutation20":
		return "死亡之门"
	default:
		// 如果是社区突变或其他未映射的模式
		if strings.HasPrefix(modeTag, "mutation") {
			return fmt.Sprintf("突变 (%s)", modeTag)
		}
		if strings.HasPrefix(modeTag, "community") {
			return fmt.Sprintf("社区突变 (%s)", modeTag)
		}
		// 首字母大写
		if len(modeTag) > 0 {
			return strings.ToUpper(modeTag[:1]) + modeTag[1:]
		}
		return modeTag
	}
}

// installVPKFile 安装VPK文件（复制到根目录）
func (a *App) installVPKFile(srcPath string) error {
	src, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer src.Close()

	destPath := filepath.Join(a.rootDir, filepath.Base(srcPath))

	dst, err := os.Create(destPath)
	if err != nil {
		return err
	}
	defer dst.Close()

	_, err = io.Copy(dst, src)
	if err != nil {
		return err
	}

	log.Printf("已安装: %s -> %s", srcPath, destPath)
	return nil
}

// ExportServersToFile 导出服务器列表到文件
func (a *App) ExportServersToFile(jsonContent string) (string, error) {
	selection, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "导出服务器列表",
		DefaultFilename: "lytvpk_servers.json",
		Filters: []runtime.FileFilter{
			{
				DisplayName: "JSON Files (*.json)",
				Pattern:     "*.json",
			},
		},
	})

	if err != nil {
		return "", err
	}

	if selection == "" {
		return "", nil // 用户取消
	}

	return selection, os.WriteFile(selection, []byte(jsonContent), 0644)
}

// RestartApplication 重启应用
func (a *App) RestartApplication() error {
	self, err := os.Executable()
	if err != nil {
		return err
	}

	// 直接启动新进程
	// 之前的 cmd /c start 会导致弹黑框，因为 cmd.exe 本身是控制台程序
	// 直接运行编译为 GUI 的 exe 不会弹框
	cmd := exec.Command(self)

	// 启动但不等待
	if err := cmd.Start(); err != nil {
		return err
	}

	// 退出当前应用
	runtime.Quit(a.ctx)
	return nil
}

// ToggleVPKVisibility 切换VPK文件的隐藏状态（添加/移除 _ 前缀）
func (a *App) ToggleVPKVisibility(filePath string) (string, error) {
	dir := filepath.Dir(filePath)
	filename := filepath.Base(filePath)

	var newFilename string
	if strings.HasPrefix(filename, "_") {
		// Unhide: remove prefix
		newFilename = strings.TrimPrefix(filename, "_")
	} else {
		// Hide: add prefix
		newFilename = "_" + filename
	}

	newPath := filepath.Join(dir, newFilename)

	// Check if target exists
	if _, err := os.Stat(newPath); err == nil {
		return "", fmt.Errorf("目标文件已存在: %s", newFilename)
	}

	err := os.Rename(filePath, newPath)
	if err != nil {
		return "", err
	}
	// 同步重命名同名图片
	a.handleSidecarFile(filePath, newPath, "move")

	return newPath, nil
}

// SetWorkshopPreferredIP 开启/关闭工坊优选IP
func (a *App) SetWorkshopPreferredIP(enabled bool) {
	a.mu.Lock()
	a.workshopPreferredIP = enabled
	a.mu.Unlock()

	// 保存配置
	a.saveConfig()

	// 如果开启，立即触发一次IP优选（如果尚未优选）
	if enabled {
		runtime.EventsEmit(a.ctx, "ip_selection_start", nil)
		go func() {
			// 使用一个典型的工坊图片域名来测试
			// 实际上 IPSelector 目前是硬编码了获取 IP 的逻辑，这里只需要触发一下
			globalIPSelector.GetBestIP("https://steamuserimages-a.akamaihd.net/ugc/test")
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

// IsSelectingIP 检查是否正在优选IP
func (a *App) IsSelectingIP() bool {
	return globalIPSelector.IsSelecting()
}

// GetCurrentBestIP 获取当前优选IP
func (a *App) GetCurrentBestIP() string {
	return globalIPSelector.GetCachedBestIP()
}

// fuzzyMatch 判断 source 是否是 target 的模糊匹配（子序列匹配）
func fuzzyMatch(source, target string) bool {
	// 转换为 rune 数组以支持 Unicode
	srcRunes := []rune(source)
	tgtRunes := []rune(target)

	sIdx := 0
	tIdx := 0

	for sIdx < len(srcRunes) && tIdx < len(tgtRunes) {
		if srcRunes[sIdx] == tgtRunes[tIdx] {
			sIdx++
		}
		tIdx++
	}

	return sIdx == len(srcRunes)
}

// ExportVPKFilesToZip 批量导出VPK文件为ZIP
func (a *App) ExportVPKFilesToZip(files []string) (string, error) {
	if len(files) == 0 {
		return "", fmt.Errorf("没有选择文件")
	}

	// 选择保存路径
	zipPath, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "导出 ZIP",
		DefaultFilename: "mods_export.zip",
		Filters: []runtime.FileFilter{
			{DisplayName: "ZIP Files (*.zip)", Pattern: "*.zip"},
		},
	})

	if err != nil {
		return "", err
	}

	if zipPath == "" {
		return "cancelled", nil // 用户取消
	}

	// 创建 ZIP 文件
	zipFile, err := os.Create(zipPath)
	if err != nil {
		return "", fmt.Errorf("创建ZIP文件失败: %v", err)
	}
	defer zipFile.Close()

	zipWriter := zip.NewWriter(zipFile)
	defer zipWriter.Close()

	totalFiles := len(files)
	for i, file := range files {
		// 发送进度事件
		runtime.EventsEmit(a.ctx, "export-progress", ProgressInfo{
			Current: i + 1,
			Total:   totalFiles,
			Message: fmt.Sprintf("正在导出: %s", filepath.Base(file)),
		})

		// 打开源文件
		srcFile, err := os.Open(file)
		if err != nil {
			log.Printf("无法打开文件 %s: %v", file, err)
			continue // 跳过错误文件，或者返回错误
		}

		// 获取文件信息
		info, err := srcFile.Stat()
		if err != nil {
			srcFile.Close()
			log.Printf("无法获取文件信息 %s: %v", file, err)
			continue
		}

		// 创建 ZIP 头
		header, err := zip.FileInfoHeader(info)
		if err != nil {
			srcFile.Close()
			log.Printf("无法创建ZIP头 %s: %v", file, err)
			continue
		}

		// 使用文件名作为 ZIP 中的路径（不包含目录结构）
		header.Name = filepath.Base(file)
		header.Method = zip.Deflate

		writer, err := zipWriter.CreateHeader(header)
		if err != nil {
			srcFile.Close()
			log.Printf("无法写入ZIP头 %s: %v", file, err)
			continue
		}

		// 写入文件内容
		_, err = io.Copy(writer, srcFile)
		srcFile.Close()
		if err != nil {
			log.Printf("无法写入文件内容 %s: %v", file, err)
			continue
		}
	}

	return fmt.Sprintf("成功导出 %d 个文件到 %s", len(files), zipPath), nil
}

// SetVPKTags 设置VPK文件的自定义标签
func (a *App) SetVPKTags(filePath string, primaryTag string, secondaryTags []string) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	if _, err := os.Stat(filePath); err != nil {
		return err
	}

	filename := filepath.Base(filePath)

	// 解析原文件名获取 "real name" 部分（包含可能的 _ 前缀）
	_, _, realName, _ := parser.ParseFilenameTags(filename)

	// 拆分 _ 前缀
	prefix := ""
	baseName := realName
	if strings.HasPrefix(realName, "_") {
		prefix = "_"
		baseName = strings.TrimPrefix(realName, "_")
	}

	// 组合新标签
	allTags := make([]string, 0)
	if primaryTag != "" {
		allTags = append(allTags, primaryTag)
	}
	for _, t := range secondaryTags {
		if t != "" {
			allTags = append(allTags, t)
		}
	}

	var newFilename string
	if len(allTags) == 0 {
		newFilename = prefix + baseName
	} else {
		// 使用 + 作为分隔符，避免使用逗号导致 Windows Explorer /select, 失效
		tagStr := strings.Join(allTags, "+")
		newFilename = fmt.Sprintf("%s[%s]%s", prefix, tagStr, baseName)
	}

	dir := filepath.Dir(filePath)
	newPath := filepath.Join(dir, newFilename)

	if newPath == filePath {
		return nil
	}

	if _, err := os.Stat(newPath); err == nil {
		return fmt.Errorf("目标文件已存在: %s", newFilename)
	}

	if err := os.Rename(filePath, newPath); err != nil {
		return err
	}
	// 同步重命名同名图片
	a.handleSidecarFile(filePath, newPath, "move")

	// Update cache
	// 如果是清除标签操作（len(allTags) == 0），则不复用旧缓存，而是强制重新解析
	// 这样可以恢复文件本身的自动检测标签（如地图、人物等）
	cachedVal, loaded := a.vpkCache.Load(filePath)
	if loaded {
		a.vpkCache.Delete(filePath)
	}

	if loaded && len(allTags) > 0 {
		cache := cachedVal.(*VPKFileCache)
		cache.File.Path = newPath
		cache.File.Name = filepath.Base(newPath)
		cache.File.PrimaryTag = primaryTag
		cache.File.SecondaryTags = secondaryTags

		a.vpkCache.Store(newPath, cache)
	} else {
		// 缓存未命中，或者清除了标签需要重新探测内容
		a.processVPKFileWithCache(newPath)
	}

	return nil
}

// RenameVPKFile 重命名VPK文件
func (a *App) RenameVPKFile(filePath string, newFilename string) (string, error) {
	// 尝试保留自定义标签
	oldName := filepath.Base(filePath)
	pTag, sTags, _, oldHasTags := parser.ParseFilenameTags(oldName)

	_, _, _, newHasTags := parser.ParseFilenameTags(newFilename)

	finalFilename := newFilename

	// 如果旧名字有标签，且新名字里没有标签，则将旧标签注入到新名字中
	if oldHasTags && !newHasTags {
		prefix := ""
		body := newFilename
		// 检查新文件名是否有 _ 前缀
		if strings.HasPrefix(newFilename, "_") {
			prefix = "_"
			body = strings.TrimPrefix(newFilename, "_")
		}

		// 组合标签
		allTags := make([]string, 0)
		if pTag != "" {
			allTags = append(allTags, pTag)
		}
		allTags = append(allTags, sTags...)

		if len(allTags) > 0 {
			// 使用 + 作为分隔符
			tagStr := strings.Join(allTags, "+")
			finalFilename = fmt.Sprintf("%s[%s]%s", prefix, tagStr, body)
		}
	}

	dir := filepath.Dir(filePath)

	// 确保新文件名以 .vpk 结尾
	if !strings.HasSuffix(strings.ToLower(finalFilename), ".vpk") {
		finalFilename += ".vpk"
	}

	newPath := filepath.Join(dir, finalFilename)

	// Check if target exists
	if _, err := os.Stat(newPath); err == nil {
		return "", fmt.Errorf("目标文件已存在: %s", finalFilename)
	}

	err := os.Rename(filePath, newPath)
	if err != nil {
		return "", err
	}
	// 同步重命名同名图片
	a.handleSidecarFile(filePath, newPath, "move")

	// 更新缓存
	if cached, ok := a.vpkCache.Load(filePath); ok {
		cache := cached.(*VPKFileCache)
		cache.File.Path = newPath
		cache.File.Name = filepath.Base(newPath)
		// Location 应该不变，因为是在同目录下重命名

		a.vpkCache.Delete(filePath)
		a.vpkCache.Store(newPath, cache)
	} else {
		// 如果不在缓存中，重新处理
		a.processVPKFileWithCache(newPath)
	}

	return newPath, nil
}
