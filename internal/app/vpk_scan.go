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
	a.vpkScanMu.Lock()
	defer a.vpkScanMu.Unlock()
	a.mu.Lock()
	defer a.mu.Unlock()

	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("无法访问目录 %s: %w", path, err)
	}
	if !info.IsDir() {
		return fmt.Errorf("路径不是目录: %s", path)
	}

	path = filepath.Clean(path)
	if a.rootDir != path {
		a.rootDir = path
		a.vpkCache.Clear()
	}
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
	a.vpkScanMu.Lock()
	defer a.vpkScanMu.Unlock()
	a.mu.RLock()
	options := a.vpkScanOptionsLocked()
	a.mu.RUnlock()
	if options.rootDir == "" {
		return fmt.Errorf("请先设置根目录")
	}

	var wg sync.WaitGroup

	// 首先扫描所有VPK文件路径
	vpkPaths := make([]string, 0)

	// 扫描根目录（仅扫描根目录本身的VPK文件，不包含子目录）
	err := a.scanRootDirectory(options.rootDir, &vpkPaths)
	if err != nil {
		return err
	}

	// 扫描workshop目录
	workshopDir := filepath.Join(options.rootDir, "workshop")
	if _, err := os.Stat(workshopDir); err == nil {
		err = a.scanDirectory(workshopDir, &vpkPaths)
		if err != nil {
			return err
		}
	} else if !os.IsNotExist(err) {
		return err
	}

	// 扫描disabled目录
	disabledDir := filepath.Join(options.rootDir, "disabled")
	if _, err := os.Stat(disabledDir); err == nil {
		err = a.scanDirectory(disabledDir, &vpkPaths)
		if err != nil {
			return err
		}
	} else if !os.IsNotExist(err) {
		return err
	}

	// 创建当前文件路径集合，用于清理不存在的缓存
	currentPaths := make(map[string]bool)
	for _, path := range vpkPaths {
		currentPaths[path] = true
	}

	// Workers build independent snapshots. Publish together after all workers
	// finish, so readers never observe a half-scanned directory.
	results := make([]*VPKFileCache, len(vpkPaths))
	var submitErr error
	for index, path := range vpkPaths {
		a.mu.RLock()
		var cached *VPKFileCache
		if value, ok := a.vpkCache.Load(path); ok {
			copy := *value.(*VPKFileCache)
			cached = &copy
		}
		a.mu.RUnlock()
		wg.Add(1)
		run := func() {
			defer wg.Done()
			cache, err := scanVPKFile(path, options, cached)
			if err != nil {
				a.logVPKScanError(path, err)
				return
			}
			results[index] = cache
		}
		if a.goroutinePool == nil {
			run()
		} else if err := a.goroutinePool.Submit(run); err != nil {
			wg.Done()
			submitErr = fmt.Errorf("无法提交 VPK 扫描任务: %w", err)
		}
	}
	wg.Wait()

	a.mu.Lock()
	defer a.mu.Unlock()
	a.vpkCache.Range(func(key, _ interface{}) bool {
		if !currentPaths[key.(string)] {
			a.vpkCache.Delete(key)
		}
		return true
	})
	for index, path := range vpkPaths {
		cache := results[index]
		info, err := os.Stat(path)
		if cache == nil || err != nil || info.Size() != cache.Size || !info.ModTime().Equal(cache.ModTime) {
			a.vpkCache.Delete(path)
			continue
		}
		a.vpkCache.Store(path, cache)
	}
	return submitErr
}

type vpkScanOptions struct {
	rootDir            string
	metaEnabled        bool
	updateCheckEnabled bool
}

// Caller holds mu (for reads or writes).
func (a *App) vpkScanOptionsLocked() vpkScanOptions {
	return vpkScanOptions{a.rootDir, a.workshopMetaEnabled, a.workshopUpdateCheckEnabled}
}

func (a *App) logVPKScanError(path string, err error) {
	if a.ctx != nil {
		a.LogError("VPK解析", err.Error(), path)
	} else {
		log.Printf("无法扫描 VPK %s: %v", path, err)
	}
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

// processVPKFileWithCache is used by file operations while mu is held.
func (a *App) processVPKFileWithCache(filePath string) {
	var cached *VPKFileCache
	if value, ok := a.vpkCache.Load(filePath); ok {
		copy := *value.(*VPKFileCache)
		cached = &copy
	}
	cache, err := scanVPKFile(filePath, a.vpkScanOptionsLocked(), cached)
	if err != nil {
		a.vpkCache.Delete(filePath)
		a.logVPKScanError(filePath, err)
		return
	}
	a.vpkCache.Store(filePath, cache)
}

func scanVPKFile(filePath string, options vpkScanOptions, cached *VPKFileCache) (*VPKFileCache, error) {
	info, err := os.Stat(filePath)
	if err != nil {
		return nil, err
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
	var metaSize int64
	if metaInfo, statErr := os.Stat(basePath + ".meta"); statErr == nil {
		metaModTime = metaInfo.ModTime()
		metaSize = metaInfo.Size()
	}

	// 检查缓存
	if cached != nil {
		copy := *cached
		cache := &copy

		// 判断文件是否变化（通过修改时间和大小）以及图片/meta是否变化
		if cache.ModTime.Equal(modTime) && cache.Size == size && cache.ImageModTime.Equal(imgModTime) && cache.MetaModTime.Equal(metaModTime) && cache.MetaSize == metaSize {
			// 文件、图片和meta都未变化，使用缓存
			// 但需要更新位置信息（因为文件可能被移动）
			location := getLocationFromRoot(options.rootDir, filePath)
			cache.File.Location = location
			cache.File.Enabled = location != "disabled"
			cache.File.Path = filePath // 更新路径（处理移动情况）

			cache.File.WorkshopID = resolveLocalWorkshopID(options.rootDir, filePath, cache.MetaWorkshopID, cache.File.AddonURL0)
			return cache, nil
		}

		log.Printf("文件或图片已变化，重新解析: %s", filepath.Base(filePath))
	}

	// 文件不在缓存中或已变化，需要重新解析
	vpkFile, err := parser.ParseVPKFile(filePath)
	if err != nil {
		return nil, err
	}

	// 设置文件系统相关信息
	location := getLocationFromRoot(options.rootDir, filePath)
	vpkFile.Size = size
	vpkFile.Location = location
	vpkFile.Enabled = location != "disabled"
	vpkFile.LastModified = modTime.Format(time.RFC3339)
	vpkFile.Path = filePath

	// Read identity even when title/author overrides and meta writes are disabled.
	var metaWorkshopID string
	if meta, err := LoadWorkshopMeta(filePath); meta != nil && err == nil {
		metaWorkshopID = meta.WorkshopID
		if options.metaEnabled {
			if meta.Title != "" {
				vpkFile.Title = meta.Title
			}
			if meta.Author != "" {
				vpkFile.Author = meta.Author
			}
			if meta.Description != "" {
				vpkFile.Desc = meta.Description
			}
			if options.updateCheckEnabled && meta.TimeUpdated != "" && meta.DownloadedAt != "" {
				timeUpdated, tErr := time.Parse(time.RFC3339, meta.TimeUpdated)
				downloadedAt, dErr := time.Parse(time.RFC3339, meta.DownloadedAt)
				if tErr == nil && dErr == nil && timeUpdated.After(downloadedAt) {
					vpkFile.HasUpdate = true
				}
			}
		}
	}
	vpkFile.WorkshopID = resolveLocalWorkshopID(options.rootDir, filePath, metaWorkshopID, vpkFile.AddonURL0)

	// 存入缓存
	cache := &VPKFileCache{
		File:           *vpkFile,
		ModTime:        modTime,
		Size:           size,
		ImageModTime:   imgModTime,
		MetaModTime:    metaModTime,
		MetaSize:       metaSize,
		MetaWorkshopID: metaWorkshopID,
		CachedAt:       time.Now(),
	}
	log.Printf("已解析并缓存: %s", filepath.Base(filePath))
	return cache, nil
}

func resolveLocalWorkshopID(rootDir, filePath, metaID, addonURL string) string {
	if protocol.IsValidWorkshopID(metaID) {
		return metaID
	}
	if strings.HasPrefix(metaID, "direct-") {
		return ""
	}
	if rel, err := filepath.Rel(filepath.Join(rootDir, "workshop"), filePath); err == nil && filepath.Dir(rel) == "." && strings.EqualFold(filepath.Ext(rel), ".vpk") {
		id := strings.TrimSuffix(rel, filepath.Ext(rel))
		if protocol.IsValidWorkshopID(id) {
			return id
		}
	}
	id, _ := protocol.ParseWorkshopID(addonURL)
	return id
}

// getLocationFromPath 根据文件路径判断位置
func (a *App) getLocationFromPath(filePath string) string {
	return getLocationFromRoot(a.rootDir, filePath)
}

func getLocationFromRoot(rootDir, filePath string) string {
	rel, _ := filepath.Rel(rootDir, filePath)
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
	a.mu.RLock()
	defer a.mu.RUnlock()
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
	a.mu.RLock()
	defer a.mu.RUnlock()
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
	a.mu.RLock()
	defer a.mu.RUnlock()
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
