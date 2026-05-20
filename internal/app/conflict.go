package app

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	rt "runtime"
	"sort"
	"strings"
	"sync"
	"vpk-manager/internal/parser"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type ConflictVPKFile struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	Title    string `json:"title"`
	Location string `json:"location"`
}

type ConflictGroup struct {
	VpkFiles       []ConflictVPKFile `json:"vpk_files"`
	Files          []string          `json:"files"`
	FileCount      int               `json:"file_count"`
	FilesTruncated bool              `json:"files_truncated"`
	Severity       string            `json:"severity"` // "critical", "warning", "info"
}

type ConflictResult struct {
	TotalConflicts int             `json:"total_conflicts"`
	ConflictGroups []ConflictGroup `json:"conflict_groups"`
}

const (
	conflictWorkerLimit        = 4
	conflictGroupFileListLimit = 2000
)

type conflictGroupAccumulator struct {
	files     []string
	fileCount int
	severity  string
}

// getConflictSeverity 判断文件冲突严重程度
func getConflictSeverity(filePath string) string {
	lower := strings.ToLower(filePath)
	lower = strings.ReplaceAll(lower, "\\", "/")

	// 🔴 严重
	// 完全匹配
	if lower == "particles/particles_manifest.txt" {
		return "critical"
	}
	if lower == "scripts/soundmixers.txt" {
		return "critical"
	}
	// 后缀匹配
	if strings.HasSuffix(lower, ".bsp") || strings.HasSuffix(lower, ".nav") {
		return "critical"
	}
	// 前缀+后缀匹配
	if strings.HasPrefix(lower, "missions/") && strings.HasSuffix(lower, ".txt") {
		return "critical"
	}
	if strings.HasPrefix(lower, "scripts/") && strings.HasSuffix(lower, ".txt") {
		// 特殊情况：vscripts 属于告警
		if strings.HasPrefix(lower, "scripts/vscripts/") {
			return "warning"
		}
		return "critical"
	}

	// 🟡 告警
	if lower == "sound/sound.cache" {
		return "warning"
	}
	if strings.HasSuffix(lower, ".phy") {
		return "warning"
	}
	if strings.HasPrefix(lower, "resource/") && strings.HasSuffix(lower, ".res") {
		return "warning"
	}
	if strings.HasPrefix(lower, "scripts/vscripts/") {
		return "warning"
	}
	if strings.HasSuffix(lower, ".vscript") || strings.HasSuffix(lower, ".nut") || strings.HasSuffix(lower, ".nuc") {
		return "warning"
	}
	if strings.HasSuffix(lower, ".db") {
		return "warning"
	}
	if strings.HasSuffix(lower, ".vtx") || strings.HasSuffix(lower, ".vvd") {
		return "warning"
	}
	if strings.HasSuffix(lower, ".ttf") || strings.HasSuffix(lower, ".otf") {
		return "warning"
	}

	// 🟢 一般 (其他所有文件)
	return "info"
}

func getConflictSeverityRank(severity string) int {
	switch severity {
	case "critical":
		return 3
	case "warning":
		return 2
	default:
		return 1
	}
}

func isIgnoredConflictFile(filePath string) bool {
	if filePath == "" {
		return true
	}
	if filePath == "addoninfo.txt" || filePath == "addonimage.vtf" || filePath == "addonimage.jpg" {
		return true
	}
	return strings.HasPrefix(filePath, "materials/dev/") || strings.HasPrefix(filePath, "materials/temp/")
}

func normalizeConflictFilePath(filePath string) string {
	filePath = strings.ReplaceAll(filePath, "\\", "/")
	filePath = strings.TrimSpace(filePath)
	return strings.ToLower(filePath)
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func getVPKFileListSafely(filePath string) (files []string, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("解析VPK文件时发生异常: %v", r)
		}
	}()

	return parser.GetVPKFileList(filePath)
}

// CheckConflicts 检测VPK文件冲突
func (a *App) CheckConflicts() (*ConflictResult, error) {
	a.mu.RLock()
	rootDir := a.rootDir
	a.mu.RUnlock()

	if rootDir == "" {
		return nil, fmt.Errorf("未选择L4D2目录")
	}

	if !a.conflictCheckMu.TryLock() {
		return nil, fmt.Errorf("冲突检测正在进行中，请稍候")
	}
	defer a.conflictCheckMu.Unlock()

	// rootDir 已经是 addons 目录
	addonsDir := rootDir
	workshopDir := filepath.Join(addonsDir, "workshop")

	var vpkPaths []string

	// 扫描 addons 目录
	entries, err := os.ReadDir(addonsDir)
	if err == nil {
		for _, entry := range entries {
			if !entry.IsDir() && strings.HasSuffix(strings.ToLower(entry.Name()), ".vpk") {
				vpkPaths = append(vpkPaths, filepath.Join(addonsDir, entry.Name()))
			}
		}
	}

	// 扫描 workshop 目录
	entries, err = os.ReadDir(workshopDir)
	if err == nil {
		for _, entry := range entries {
			if !entry.IsDir() && strings.HasSuffix(strings.ToLower(entry.Name()), ".vpk") {
				vpkPaths = append(vpkPaths, filepath.Join(workshopDir, entry.Name()))
			}
		}
	}

	totalFiles := len(vpkPaths)
	if totalFiles == 0 {
		return &ConflictResult{}, nil
	}

	// 发送开始事件
	runtime.EventsEmit(a.ctx, "conflict_check_progress", ProgressInfo{
		Current: 0,
		Total:   totalFiles,
		Message: "开始扫描冲突...",
	})

	// 文件路径 -> VPK列表（使用完整路径）
	fileFirstOwner := make(map[string]string)
	conflictOwners := make(map[string][]string)
	var mu sync.Mutex
	var wg sync.WaitGroup
	workerCount := min(conflictWorkerLimit, rt.GOMAXPROCS(0))
	if workerCount < 1 {
		workerCount = 1
	}
	workerSlots := make(chan struct{}, workerCount)

	// 进度计数器
	var processedCount int
	var countMu sync.Mutex

	// 使用协程池并发处理
	for _, path := range vpkPaths {
		wg.Add(1)
		p := path // capture loop variable

		err := a.goroutinePool.Submit(func() {
			defer wg.Done()
			workerSlots <- struct{}{}
			defer func() { <-workerSlots }()

			files, err := getVPKFileListSafely(p)

			countMu.Lock()
			processedCount++
			current := processedCount
			countMu.Unlock()

			// 每5个文件或者最后一个文件发送一次进度，避免事件过多
			if current%5 == 0 || current == totalFiles {
				runtime.EventsEmit(a.ctx, "conflict_check_progress", ProgressInfo{
					Current: current,
					Total:   totalFiles,
					Message: fmt.Sprintf("正在分析: %s", filepath.Base(p)),
				})
			}

			if err != nil {
				log.Printf("冲突检测跳过VPK: %s, 错误: %v", p, err)
				return
			}

			mu.Lock()
			for _, f := range files {
				lowerF := normalizeConflictFilePath(f)
				if isIgnoredConflictFile(lowerF) {
					continue
				}

				firstOwner, ok := fileFirstOwner[lowerF]
				if !ok {
					fileFirstOwner[lowerF] = p
					continue
				}
				if firstOwner == p {
					continue
				}

				owners := conflictOwners[lowerF]
				if len(owners) == 0 {
					conflictOwners[lowerF] = []string{firstOwner, p}
					continue
				}
				if !containsString(owners, p) {
					conflictOwners[lowerF] = append(owners, p)
				}
			}
			mu.Unlock()
		})

		if err != nil {
			wg.Done() // Submit failed
		}
	}

	wg.Wait()

	// 分析冲突
	runtime.EventsEmit(a.ctx, "conflict_check_progress", ProgressInfo{
		Current: totalFiles,
		Total:   totalFiles,
		Message: "正在整理冲突结果...",
	})

	// VPK组合 -> 冲突摘要
	// key: "vpkFullPath1|vpkFullPath2" (sorted)
	conflictMap := make(map[string]*conflictGroupAccumulator)

	for f, vpks := range conflictOwners {
		sort.Strings(vpks)
		key := strings.Join(vpks, "|")
		acc, ok := conflictMap[key]
		if !ok {
			acc = &conflictGroupAccumulator{
				files:    make([]string, 0, min(conflictGroupFileListLimit, 16)),
				severity: "info",
			}
			conflictMap[key] = acc
		}
		acc.fileCount++
		if len(acc.files) < conflictGroupFileListLimit {
			acc.files = append(acc.files, f)
		}
		if s := getConflictSeverity(f); getConflictSeverityRank(s) > getConflictSeverityRank(acc.severity) {
			acc.severity = s
		}
	}

	var groups []ConflictGroup
	for key, acc := range conflictMap {
		files := acc.files
		vpkFullPaths := strings.Split(key, "|")
		sort.Strings(files) // 文件列表也排序

		// 从缓存获取完整VPK信息
		vpkInfos := make([]ConflictVPKFile, 0, len(vpkFullPaths))
		for _, fullPath := range vpkFullPaths {
			if cached, ok := a.vpkCache.Load(fullPath); ok {
				cache := cached.(*VPKFileCache)
				vpkInfos = append(vpkInfos, newConflictVPKFile(cache.File.Name, cache.File.Path, cache.File.Title, cache.File.Location))
			} else {
				// 缓存不存在时的兜底处理
				vpkInfos = append(vpkInfos, newConflictVPKFile(filepath.Base(fullPath), fullPath, filepath.Base(fullPath), a.getLocationFromPath(fullPath)))
			}
		}

		groups = append(groups, ConflictGroup{
			VpkFiles:       vpkInfos,
			Files:          files,
			FileCount:      acc.fileCount,
			FilesTruncated: acc.fileCount > len(files),
			Severity:       acc.severity,
		})
	}

	// 按严重程度和冲突数量排序 groups
	sort.Slice(groups, func(i, j int) bool {
		// 严重程度优先级: critical > warning > info
		si := getConflictSeverityRank(groups[i].Severity)
		sj := getConflictSeverityRank(groups[j].Severity)

		if si != sj {
			return si > sj
		}
		return groups[i].FileCount > groups[j].FileCount
	})

	return &ConflictResult{
		TotalConflicts: len(groups),
		ConflictGroups: groups,
	}, nil
}

func newConflictVPKFile(name, path, title, location string) ConflictVPKFile {
	if title == "" {
		title = name
	}
	return ConflictVPKFile{
		Name:     name,
		Path:     path,
		Title:    title,
		Location: location,
	}
}
