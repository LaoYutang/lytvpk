package app

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"vpk-manager/internal/platform/protocol"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	workshopTransferStatusSuccess = "success"
	workshopTransferStatusFailed  = "failed"
	workshopTransferStatusSkipped = "skipped"
	workshopMetaFetchConcurrency  = 4
)

type WorkshopTransferResult struct {
	Total         int                          `json:"total"`
	EligibleCount int                          `json:"eligibleCount"`
	SuccessCount  int                          `json:"successCount"`
	FailCount     int                          `json:"failCount"`
	SkippedCount  int                          `json:"skippedCount"`
	WarningCount  int                          `json:"warningCount"`
	Items         []WorkshopTransferItemResult `json:"items"`
}

type WorkshopTransferItemResult struct {
	SourcePath string   `json:"sourcePath"`
	TargetPath string   `json:"targetPath"`
	Name       string   `json:"name"`
	Status     string   `json:"status"`
	MetaSaved  bool     `json:"metaSaved"`
	Warnings   []string `json:"warnings"`
	Error      string   `json:"error"`
}

type WorkshopTransferProgress struct {
	Current int    `json:"current"`
	Total   int    `json:"total"`
	Name    string `json:"name"`
	Phase   string `json:"phase"`
	Message string `json:"message"`
}

type workshopMetaTransferTask struct {
	resultIndex int
	targetPath  string
	workshopID  string
}

// MoveWorkshopFilesToAddons 批量将 workshop VPK 转移至根目录。
// VPK 移动失败计为失败；缩略图和 meta 失败只作为警告返回。
func (a *App) MoveWorkshopFilesToAddons(filePaths []string) (WorkshopTransferResult, error) {
	paths := uniqueWorkshopTransferPaths(filePaths)
	result := WorkshopTransferResult{
		Total: len(paths),
		Items: make([]WorkshopTransferItemResult, 0, len(paths)),
	}

	a.mu.RLock()
	rootDir := a.rootDir
	metaEnabled := a.workshopMetaEnabled
	a.mu.RUnlock()
	if rootDir == "" {
		return result, fmt.Errorf("请先设置根目录")
	}

	eligiblePaths := make([]string, 0, len(paths))
	for _, filePath := range paths {
		if a.isWorkshopTransferCandidate(filePath) {
			eligiblePaths = append(eligiblePaths, filePath)
			continue
		}
		result.SkippedCount++
		result.Items = append(result.Items, WorkshopTransferItemResult{
			SourcePath: filePath,
			Name:       filepath.Base(filePath),
			Status:     workshopTransferStatusSkipped,
		})
	}
	result.EligibleCount = len(eligiblePaths)

	metaTasks := make([]workshopMetaTransferTask, 0, len(eligiblePaths))
	completed := 0
	for _, filePath := range eligiblePaths {
		name := filepath.Base(filePath)
		a.emitWorkshopTransferProgress(completed, result.EligibleCount, name, "moving", "正在移动 VPK")

		item, eligible, err := a.moveWorkshopVPKToAddons(filePath)
		if !eligible {
			result.SkippedCount++
			result.EligibleCount--
			item.Status = workshopTransferStatusSkipped
			result.Items = append(result.Items, item)
			continue
		}
		if err != nil {
			item.Status = workshopTransferStatusFailed
			item.Error = err.Error()
			result.FailCount++
			result.Items = append(result.Items, item)
			completed++
			a.emitWorkshopTransferProgress(completed, result.EligibleCount, item.Name, "completed", "VPK 移动失败")
			continue
		}

		item.Status = workshopTransferStatusSuccess
		result.SuccessCount++
		a.emitWorkshopTransferProgress(completed, result.EligibleCount, item.Name, "thumbnail", "正在移动缩略图")
		item.Warnings = append(item.Warnings, moveWorkshopThumbnails(item.SourcePath, item.TargetPath)...)
		result.WarningCount += len(item.Warnings)
		result.Items = append(result.Items, item)
		itemIndex := len(result.Items) - 1

		if !metaEnabled {
			completed++
			a.emitWorkshopTransferProgress(completed, result.EligibleCount, item.Name, "completed", "转移完成")
			continue
		}

		workshopID := strings.TrimSuffix(item.Name, filepath.Ext(item.Name))
		metaTasks = append(metaTasks, workshopMetaTransferTask{
			resultIndex: itemIndex,
			targetPath:  item.TargetPath,
			workshopID:  workshopID,
		})
	}

	if metaEnabled && len(metaTasks) > 0 {
		a.processWorkshopTransferMeta(&result, metaTasks, &completed)
	}

	return result, nil
}

func uniqueWorkshopTransferPaths(filePaths []string) []string {
	paths := make([]string, 0, len(filePaths))
	seen := make(map[string]bool, len(filePaths))
	for _, rawPath := range filePaths {
		filePath := strings.TrimSpace(rawPath)
		if filePath == "" || seen[filePath] {
			continue
		}
		seen[filePath] = true
		paths = append(paths, filePath)
	}
	return paths
}

func (a *App) isWorkshopTransferCandidate(filePath string) bool {
	if cached, ok := a.vpkCache.Load(filePath); ok {
		return cached.(*VPKFileCache).File.Location == "workshop"
	}
	return a.getLocationFromPath(filePath) == "workshop"
}

func (a *App) moveWorkshopVPKToAddons(filePath string) (WorkshopTransferItemResult, bool, error) {
	item := WorkshopTransferItemResult{
		SourcePath: filePath,
		Name:       filepath.Base(filePath),
	}

	a.mu.Lock()
	defer a.mu.Unlock()

	cached, ok := a.vpkCache.Load(filePath)
	if !ok {
		return item, true, fmt.Errorf("文件未找到: %s", filePath)
	}

	cache := cached.(*VPKFileCache)
	if cache.File.Location != "workshop" {
		return item, false, nil
	}

	newPath := filepath.Join(a.rootDir, filepath.Base(cache.File.Path))
	item.Name = filepath.Base(cache.File.Path)
	item.TargetPath = newPath
	if _, err := os.Stat(newPath); err == nil {
		return item, true, fmt.Errorf("目标文件已存在: %s", item.Name)
	} else if !os.IsNotExist(err) {
		return item, true, fmt.Errorf("无法检查目标文件: %w", err)
	}

	if err := os.Rename(cache.File.Path, newPath); err != nil {
		return item, true, err
	}

	cache.File.Path = newPath
	cache.File.Location = "root"
	cache.File.Enabled = true
	a.vpkCache.Delete(filePath)
	a.vpkCache.Store(newPath, cache)
	log.Printf("文件已转移: %s -> %s", filePath, newPath)
	return item, true, nil
}

func moveWorkshopThumbnails(sourceVPKPath string, targetVPKPath string) []string {
	sourceBase := strings.TrimSuffix(sourceVPKPath, filepath.Ext(sourceVPKPath))
	targetBase := strings.TrimSuffix(targetVPKPath, filepath.Ext(targetVPKPath))
	warnings := make([]string, 0)

	for _, ext := range []string{".jpg", ".jpeg", ".png", ".gif"} {
		sourcePath := sourceBase + ext
		if _, err := os.Stat(sourcePath); err != nil {
			if !os.IsNotExist(err) {
				warnings = append(warnings, fmt.Sprintf("检查缩略图失败 %s: %v", filepath.Base(sourcePath), err))
			}
			continue
		}

		targetPath := targetBase + ext
		if _, err := os.Stat(targetPath); err == nil {
			warnings = append(warnings, fmt.Sprintf("移动缩略图失败 %s: 目标文件已存在", filepath.Base(sourcePath)))
			continue
		} else if !os.IsNotExist(err) {
			warnings = append(warnings, fmt.Sprintf("检查目标缩略图失败 %s: %v", filepath.Base(targetPath), err))
			continue
		}
		if err := os.Rename(sourcePath, targetPath); err != nil {
			warnings = append(warnings, fmt.Sprintf("移动缩略图失败 %s: %v", filepath.Base(sourcePath), err))
		}
	}
	return warnings
}

func (a *App) processWorkshopTransferMeta(result *WorkshopTransferResult, tasks []workshopMetaTransferTask, completed *int) {
	var wg sync.WaitGroup
	var resultMu sync.Mutex
	limit := make(chan struct{}, workshopMetaFetchConcurrency)

	run := func(task workshopMetaTransferTask) {
		defer wg.Done()
		limit <- struct{}{}
		defer func() { <-limit }()

		resultMu.Lock()
		name := result.Items[task.resultIndex].Name
		current := *completed
		total := result.EligibleCount
		resultMu.Unlock()
		a.emitWorkshopTransferProgress(current, total, name, "meta", "正在获取工坊信息")

		warning := ""
		metaSaved := false
		if !protocol.IsValidWorkshopID(task.workshopID) {
			warning = fmt.Sprintf("无法从文件名识别有效工坊 ID: %s", name)
		} else {
			detail, err := a.fetchWorkshopDetailRaw(task.workshopID, true)
			if err != nil {
				warning = fmt.Sprintf("获取工坊信息失败 %s: %v", task.workshopID, err)
			} else {
				meta, writeErr := SaveWorkshopDetailMeta(task.targetPath, task.workshopID, detail)
				if writeErr != nil {
					warning = fmt.Sprintf("写入 meta 失败 %s: %v", task.workshopID, writeErr)
				} else {
					metaSaved = true
					a.applyWorkshopMetaToCache(task.targetPath, meta)
				}
			}
		}

		resultMu.Lock()
		item := &result.Items[task.resultIndex]
		item.MetaSaved = metaSaved
		if warning != "" {
			item.Warnings = append(item.Warnings, warning)
			result.WarningCount++
		}
		(*completed)++
		current = *completed
		resultMu.Unlock()

		a.emitWorkshopTransferProgress(current, total, name, "completed", "转移完成")
	}

	for _, task := range tasks {
		wg.Add(1)
		task := task
		if a.goroutinePool == nil {
			run(task)
			continue
		}
		if err := a.goroutinePool.Submit(func() { run(task) }); err != nil {
			wg.Done()
			wg.Add(1)
			run(task)
		}
	}
	wg.Wait()
}

func (a *App) applyWorkshopMetaToCache(filePath string, meta WorkshopMeta) {
	metaInfo, _ := os.Stat(GetMetaFilePath(filePath))

	a.mu.Lock()
	defer a.mu.Unlock()
	cached, ok := a.vpkCache.Load(filePath)
	if !ok {
		return
	}
	cache := cached.(*VPKFileCache)
	if meta.Title != "" {
		cache.File.Title = meta.Title
	}
	if meta.Author != "" {
		cache.File.Author = meta.Author
	}
	if meta.Description != "" {
		cache.File.Desc = meta.Description
	}
	cache.File.WorkshopID = meta.WorkshopID
	if metaInfo != nil {
		cache.MetaModTime = metaInfo.ModTime()
	}
	a.vpkCache.Store(filePath, cache)
}

func (a *App) emitWorkshopTransferProgress(current int, total int, name string, phase string, message string) {
	if a.ctx == nil {
		return
	}
	runtime.EventsEmit(a.ctx, "workshop_transfer_progress", WorkshopTransferProgress{
		Current: current,
		Total:   total,
		Name:    name,
		Phase:   phase,
		Message: message,
	})
}
