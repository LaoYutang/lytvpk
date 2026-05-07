package app

import (
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"vpk-manager/internal/parser"
	"vpk-manager/internal/platform/protocol"
)

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
	exts := []string{".jpg", ".png", ".jpeg", ".gif"}
	for _, ext := range exts {
		if imgInfo, statErr := os.Stat(basePath + ext); statErr == nil {
			imgModTime = imgInfo.ModTime()
			break
		}
	}

	// 检查meta文件状态
	var metaModTime time.Time
	if metaInfo, statErr := os.Stat(basePath + ".meta"); statErr == nil {
		metaModTime = metaInfo.ModTime()
	}

	// 检查缓存
	if cached, ok := a.vpkCache.Load(filePath); ok {
		cache := cached.(*VPKFileCache)

		// 判断文件是否变化（通过修改时间和大小）以及图片/meta是否变化
		if cache.ModTime.Equal(modTime) && cache.Size == size && cache.ImageModTime.Equal(imgModTime) && cache.MetaModTime.Equal(metaModTime) {
			// 文件、图片和meta都未变化，使用缓存
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

	// 应用meta数据（如果开启且存在）
	if a.workshopMetaEnabled {
		if meta, err := LoadWorkshopMeta(filePath); meta != nil && err == nil {
			if meta.Title != "" {
				vpkFile.Title = meta.Title
			}
			if meta.Author != "" {
				vpkFile.Author = meta.Author
			}
			if meta.Description != "" {
				vpkFile.Desc = meta.Description
			}
			if meta.WorkshopID != "" && !strings.HasPrefix(meta.WorkshopID, "direct-") && protocol.IsValidWorkshopID(meta.WorkshopID) {
				vpkFile.WorkshopID = meta.WorkshopID
			}
		}
	}

	// 存入缓存
	cache := &VPKFileCache{
		File:         *vpkFile,
		ModTime:      modTime,
		Size:         size,
		ImageModTime: imgModTime,
		MetaModTime:  metaModTime,
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
