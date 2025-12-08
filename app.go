package main

import (
	"context"
	"fmt"
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

	"github.com/panjf2000/ants/v2"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// VPKFile 类型别名,用于Wails绑定
type VPKFile = parser.VPKFile

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
	File     VPKFile
	ModTime  time.Time
	Size     int64
	CachedAt time.Time
}

// App struct
type App struct {
	ctx           context.Context
	vpkCache      sync.Map // map[string]*VPKFileCache, key是文件路径
	mu            sync.RWMutex
	rootDir       string
	goroutinePool *ants.Pool
	forceClose    bool
}

// NewApp creates a new App application struct
func NewApp() *App {
	pool, _ := ants.NewPool(rt.GOMAXPROCS(0)) // 创建协程池
	return &App{
		goroutinePool: pool,
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
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

// processVPKFile 处理单个VPK文件（已废弃，保留用于兼容）
func (a *App) processVPKFile(filePath string) {
	a.processVPKFileWithCache(filePath)
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

	// 检查缓存
	if cached, ok := a.vpkCache.Load(filePath); ok {
		cache := cached.(*VPKFileCache)

		// 判断文件是否变化（通过修改时间和大小）
		if cache.ModTime.Equal(modTime) && cache.Size == size {
			// 文件未变化，使用缓存
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

		log.Printf("文件已变化，重新解析: %s", filepath.Base(filePath))
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
	vpkFile.LastModified = modTime
	vpkFile.Path = filePath

	// 存入缓存
	cache := &VPKFileCache{
		File:     *vpkFile,
		ModTime:  modTime,
		Size:     size,
		CachedAt: time.Now(),
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
		result = append(result, cache.File)
		return true
	})

	return result
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
			if strings.Contains(strings.ToLower(vpkFile.Title), query) {
				textMatch = true
			}
			// 匹配文件名
			if !textMatch && strings.Contains(strings.ToLower(vpkFile.Name), query) {
				textMatch = true
			}
			// 匹配主标签
			if !textMatch && strings.Contains(strings.ToLower(vpkFile.PrimaryTag), query) {
				textMatch = true
			}
			// 匹配二级标签
			if !textMatch {
				for _, tag := range vpkFile.SecondaryTags {
					if strings.Contains(strings.ToLower(tag), query) {
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
	// 使用 Steam 协议启动游戏
	steamURL := "steam://rungameid/550"

	// 使用 Wails 的 BrowserOpenURL 方法打开 Steam 链接
	runtime.BrowserOpenURL(a.ctx, steamURL)

	return nil
}

// OpenFileLocation 打开文件所在位置
func (a *App) OpenFileLocation(filePath string) error {
	if filePath == "" {
		return fmt.Errorf("文件路径为空")
	}

	// 检查文件是否存在
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return fmt.Errorf("文件不存在: %s", filePath)
	}

	// 获取文件所在目录
	dir := filepath.Dir(filePath)

	// 根据操作系统打开文件管理器
	var cmd *exec.Cmd
	switch rt.GOOS {
	case "windows":
		// Windows: 使用 explorer 并选中文件
		cmd = exec.Command("explorer", "/select,", filePath)
	case "darwin":
		// macOS: 使用 open 并选中文件
		cmd = exec.Command("open", "-R", filePath)
	case "linux":
		// Linux: 使用 xdg-open 打开目录（大部分 Linux 文件管理器不支持选中文件）
		cmd = exec.Command("xdg-open", dir)
	default:
		return fmt.Errorf("不支持的操作系统: %s", rt.GOOS)
	}

	err := cmd.Start()
	if err != nil {
		return fmt.Errorf("打开文件位置失败: %s", err.Error())
	}

	return nil
}
