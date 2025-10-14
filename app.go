package main

import (
	"context"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	rt "runtime"
	"strings"
	"sync"

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

// App struct
type App struct {
	ctx           context.Context
	vpkFiles      []VPKFile
	mu            sync.RWMutex
	rootDir       string
	goroutinePool *ants.Pool
}

// NewApp creates a new App application struct
func NewApp() *App {
	pool, _ := ants.NewPool(rt.GOMAXPROCS(0)) // 创建协程池
	return &App{
		vpkFiles:      make([]VPKFile, 0),
		goroutinePool: pool,
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
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

// ScanVPKFiles 扫描所有VPK文件
func (a *App) ScanVPKFiles() error {
	if a.rootDir == "" {
		return fmt.Errorf("请先设置根目录")
	}

	a.mu.Lock()
	a.vpkFiles = make([]VPKFile, 0, 128)
	a.mu.Unlock()

	var wg sync.WaitGroup

	// 首先扫描所有VPK文件
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

	for _, path := range vpkPaths {
		wg.Add(1)
		a.goroutinePool.Submit(func() {
			a.processVPKFile(path)
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

// processVPKFile 处理单个VPK文件
func (a *App) processVPKFile(filePath string) {
	info, err := os.Stat(filePath)
	if err != nil {
		return
	}

	// 使用parser包解析VPK文件
	vpkFile, err := parser.ParseVPKFile(filePath)
	if err != nil {
		a.LogError("VPK解析", err.Error(), filePath)
		return
	}

	// 设置文件系统相关信息
	location := a.getLocationFromPath(filePath)
	vpkFile.Size = info.Size()
	vpkFile.Location = location
	vpkFile.Enabled = location != "disabled"
	vpkFile.LastModified = info.ModTime()

	a.mu.Lock()
	a.vpkFiles = append(a.vpkFiles, *vpkFile)
	a.mu.Unlock()
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

// GetVPKFiles 获取所有VPK文件
func (a *App) GetVPKFiles() []VPKFile {
	a.mu.RLock()
	defer a.mu.RUnlock()

	result := make([]VPKFile, len(a.vpkFiles))
	copy(result, a.vpkFiles)
	return result
}

// ToggleVPKFile 切换VPK文件的启用状态
// 注意：workshop文件不能直接启用/禁用，需要先转移到root目录
func (a *App) ToggleVPKFile(filePath string) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	for i, vpkFile := range a.vpkFiles {
		if vpkFile.Path == filePath {
			// workshop文件不能直接启用/禁用
			if vpkFile.Location == "workshop" {
				return fmt.Errorf("workshop文件需要先转移到插件目录才能启用/禁用")
			}

			if vpkFile.Enabled && vpkFile.Location == "root" {
				// 禁用文件：从root移动到disabled目录
				disabledDir := filepath.Join(a.rootDir, "disabled")
				os.MkdirAll(disabledDir, 0755)

				newPath := filepath.Join(disabledDir, vpkFile.Name)
				err := os.Rename(vpkFile.Path, newPath)
				if err != nil {
					return err
				}

				a.vpkFiles[i].Path = newPath
				a.vpkFiles[i].Enabled = false
				a.vpkFiles[i].Location = "disabled"
			} else if !vpkFile.Enabled && vpkFile.Location == "disabled" {
				// 启用文件：从disabled移动回root目录
				newPath := filepath.Join(a.rootDir, vpkFile.Name)
				err := os.Rename(vpkFile.Path, newPath)
				if err != nil {
					return err
				}

				a.vpkFiles[i].Path = newPath
				a.vpkFiles[i].Enabled = true
				a.vpkFiles[i].Location = "root"
			} else {
				return fmt.Errorf("无效的文件状态转换")
			}
			break
		}
	}

	return nil
}

// MoveWorkshopToAddons 将workshop中的VPK移动到addons目录（root目录）
func (a *App) MoveWorkshopToAddons(filePath string) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	for i, vpkFile := range a.vpkFiles {
		if vpkFile.Path == filePath && vpkFile.Location == "workshop" {
			newPath := filepath.Join(a.rootDir, vpkFile.Name)
			err := os.Rename(vpkFile.Path, newPath)
			if err != nil {
				return err
			}

			// 转移到root目录后，文件默认为启用状态
			a.vpkFiles[i].Path = newPath
			a.vpkFiles[i].Location = "root"
			a.vpkFiles[i].Enabled = true
			break
		}
	}

	return nil
}

// SearchVPKFiles 搜索VPK文件
func (a *App) SearchVPKFiles(query string, primaryTag string, secondaryTags []string) []VPKFile {
	a.mu.RLock()
	defer a.mu.RUnlock()

	result := make([]VPKFile, 0)
	query = strings.ToLower(query)

	for _, vpkFile := range a.vpkFiles {
		// 搜索文本匹配：文件名或标签名
		textMatch := query == ""
		if query != "" {
			// 匹配文件名
			if strings.Contains(strings.ToLower(vpkFile.Name), query) {
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
	}

	return result
}

// GetPrimaryTags 获取所有主要标签
func (a *App) GetPrimaryTags() []string {
	return parser.GetPrimaryTags()
}

// GetSecondaryTags 获取指定主标签下的所有二级标签
func (a *App) GetSecondaryTags(primaryTag string) []string {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return parser.GetSecondaryTags(a.vpkFiles, primaryTag)
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
