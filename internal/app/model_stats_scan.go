package app

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"vpk-manager/internal/parser"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	modelStatsScanStatusIdle    = "idle"
	modelStatsScanStatusRunning = "running"
	modelStatsScanWorkerLimit   = 4
)

type ModelStatsScanState struct {
	Status   string       `json:"status"`
	Running  bool         `json:"running"`
	ScanID   string       `json:"scanId,omitempty"`
	RootDir  string       `json:"rootDir,omitempty"`
	Progress ProgressInfo `json:"progress"`
}

type ModelStatsScanProgress struct {
	ScanID  string `json:"scanId"`
	Current int    `json:"current"`
	Total   int    `json:"total"`
	Message string `json:"message"`
}

type ModelStatsScanComplete struct {
	ScanID string                `json:"scanId"`
	Result *ModelStatsScanResult `json:"result,omitempty"`
	Error  string                `json:"error,omitempty"`
}

type ModelStatsScanResult struct {
	ScanID         string                `json:"scanId"`
	GeneratedAt    string                `json:"generatedAt"`
	TotalMods      int                   `json:"totalMods"`
	TotalModels    int                   `json:"totalModels"`
	TotalVertices  int                   `json:"totalVertices"`
	TotalTriangles int                   `json:"totalTriangles"`
	Items          []ModelStatsModResult `json:"items"`
}

type ModelStatsModResult struct {
	Name           string             `json:"name"`
	Path           string             `json:"path"`
	Title          string             `json:"title"`
	Location       string             `json:"location"`
	WorkshopID     string             `json:"workshopId,omitempty"`
	ModelCount     int                `json:"modelCount"`
	TotalVertices  int                `json:"totalVertices"`
	TotalTriangles int                `json:"totalTriangles"`
	Models         []parser.ModelStat `json:"models"`
	Message        string             `json:"message,omitempty"`
}

type modelStatsScanTarget struct {
	Name       string
	Path       string
	Title      string
	Location   string
	WorkshopID string
}

func (a *App) GetModelStatsScanState() ModelStatsScanState {
	a.modelStatsScanMu.Lock()
	defer a.modelStatsScanMu.Unlock()
	return a.modelStatsScanStateLocked()
}

func (a *App) StartModelStatsScan() (ModelStatsScanState, error) {
	a.modelStatsScanMu.Lock()
	if a.modelStatsScanRunning {
		state := a.modelStatsScanStateLocked()
		a.modelStatsScanMu.Unlock()
		return state, nil
	}
	a.modelStatsScanMu.Unlock()

	a.mu.RLock()
	rootDir := a.rootDir
	a.mu.RUnlock()
	if strings.TrimSpace(rootDir) == "" {
		return ModelStatsScanState{}, fmt.Errorf("请先选择 addons 目录")
	}
	if a.goroutinePool == nil {
		return ModelStatsScanState{}, fmt.Errorf("扫描任务池未初始化")
	}

	targets, err := collectModelStatsScanTargets(rootDir)
	if err != nil {
		return ModelStatsScanState{}, err
	}
	for i := range targets {
		a.hydrateModelStatsTarget(&targets[i], rootDir)
	}

	scanID := fmt.Sprintf("model-stats-%d", time.Now().UnixNano())
	a.modelStatsScanMu.Lock()
	a.modelStatsScanRunning = true
	a.modelStatsScanID = scanID
	a.modelStatsScanRoot = rootDir
	a.modelStatsScanProgress = ProgressInfo{
		Current: 0,
		Total:   len(targets),
		Message: "准备扫描模型面数...",
	}
	state := a.modelStatsScanStateLocked()
	a.modelStatsScanMu.Unlock()

	if err := a.goroutinePool.Submit(func() {
		a.runModelStatsScan(scanID, targets)
	}); err != nil {
		a.finishModelStatsScan(scanID)
		return ModelStatsScanState{}, err
	}

	a.emitModelStatsScanProgress(scanID, 0, len(targets), "开始扫描模型面数...")
	return state, nil
}

func (a *App) runModelStatsScan(scanID string, targets []modelStatsScanTarget) {
	defer func() {
		if r := recover(); r != nil {
			a.emitModelStatsScanComplete(scanID, nil, fmt.Sprintf("模型面数检测异常: %v", r))
			a.finishModelStatsScan(scanID)
		}
	}()

	result := &ModelStatsScanResult{
		ScanID:      scanID,
		GeneratedAt: time.Now().Format(time.RFC3339),
		TotalMods:   len(targets),
		Items:       make([]ModelStatsModResult, 0, len(targets)),
	}

	if len(targets) == 0 {
		a.emitModelStatsScanProgress(scanID, 0, 0, "没有可扫描的启用或工坊 Mod")
		a.emitModelStatsScanComplete(scanID, result, "")
		a.finishModelStatsScan(scanID)
		return
	}

	var resultMu sync.Mutex
	var wg sync.WaitGroup
	workerCount := a.modelStatsScanWorkerCount(len(targets))
	jobs := make(chan modelStatsScanTarget, workerCount)
	processed := 0

	recordItem := func(item ModelStatsModResult, targetName string) {
		resultMu.Lock()
		result.TotalModels += item.ModelCount
		result.TotalVertices += item.TotalVertices
		result.TotalTriangles += item.TotalTriangles
		result.Items = append(result.Items, item)
		processed++
		current := processed
		resultMu.Unlock()
		a.emitModelStatsScanProgress(scanID, current, len(targets), fmt.Sprintf("正在分析: %s", targetName))
	}

	a.emitModelStatsScanProgress(
		scanID,
		0,
		len(targets),
		fmt.Sprintf("使用协程池并发分析 %d 个文件...", workerCount),
	)

	for i := 0; i < workerCount; i++ {
		wg.Add(1)
		submitErr := a.goroutinePool.Submit(func() {
			defer wg.Done()
			for target := range jobs {
				recordItem(a.scanModelStatsTarget(target), target.Name)
			}
		})
		if submitErr != nil {
			wg.Done()
			close(jobs)
			wg.Wait()
			a.emitModelStatsScanComplete(scanID, nil, fmt.Sprintf("提交模型扫描任务失败: %v", submitErr))
			a.finishModelStatsScan(scanID)
			return
		}
	}

	for _, target := range targets {
		jobs <- target
	}
	close(jobs)
	wg.Wait()
	sort.SliceStable(result.Items, func(i, j int) bool {
		if result.Items[i].TotalTriangles != result.Items[j].TotalTriangles {
			return result.Items[i].TotalTriangles > result.Items[j].TotalTriangles
		}
		return strings.ToLower(result.Items[i].Name) < strings.ToLower(result.Items[j].Name)
	})

	a.emitModelStatsScanProgress(scanID, len(targets), len(targets), "模型面数检测完成")
	a.emitModelStatsScanComplete(scanID, result, "")
	a.finishModelStatsScan(scanID)
}

func (a *App) scanModelStatsTarget(target modelStatsScanTarget) ModelStatsModResult {
	item := ModelStatsModResult{
		Name:       target.Name,
		Path:       target.Path,
		Title:      target.Title,
		Location:   target.Location,
		WorkshopID: target.WorkshopID,
		Models:     []parser.ModelStat{},
	}
	if item.Title == "" {
		item.Title = item.Name
	}

	stats, err := parser.AnalyzeVPKModelStats(target.Path)
	if err != nil {
		item.Message = err.Error()
		return item
	}
	item.ModelCount = stats.ModelCount
	item.TotalVertices = stats.TotalVertices
	item.TotalTriangles = stats.TotalTriangles
	item.Models = stats.Models
	item.Message = stats.Message
	if item.Models == nil {
		item.Models = []parser.ModelStat{}
	}
	return item
}

func (a *App) modelStatsScanWorkerCount(targetCount int) int {
	if targetCount <= 0 {
		return 0
	}

	limit := modelStatsScanWorkerLimit
	if a.goroutinePool != nil {
		// The coordinator itself occupies one pool worker, so keep one slot free.
		if cap := a.goroutinePool.Cap(); cap > 1 && limit >= cap {
			limit = cap - 1
		}
	}
	if limit < 1 {
		limit = 1
	}
	if targetCount < limit {
		return targetCount
	}
	return limit
}

func collectModelStatsScanTargets(rootDir string) ([]modelStatsScanTarget, error) {
	targets := make([]modelStatsScanTarget, 0)
	if strings.TrimSpace(rootDir) == "" {
		return targets, fmt.Errorf("请先选择 addons 目录")
	}

	entries, err := os.ReadDir(rootDir)
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".vpk") {
			continue
		}
		targets = append(targets, modelStatsScanTarget{
			Name:     entry.Name(),
			Path:     filepath.Join(rootDir, entry.Name()),
			Location: "root",
		})
	}

	workshopDir := filepath.Join(rootDir, "workshop")
	if _, err := os.Stat(workshopDir); err == nil {
		if err := filepath.WalkDir(workshopDir, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() || !strings.HasSuffix(strings.ToLower(d.Name()), ".vpk") {
				return nil
			}
			targets = append(targets, modelStatsScanTarget{
				Name:     d.Name(),
				Path:     path,
				Location: "workshop",
			})
			return nil
		}); err != nil {
			return nil, err
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}

	sort.SliceStable(targets, func(i, j int) bool {
		return strings.ToLower(targets[i].Path) < strings.ToLower(targets[j].Path)
	})
	return targets, nil
}

func (a *App) hydrateModelStatsTarget(target *modelStatsScanTarget, rootDir string) {
	if target == nil {
		return
	}
	if cached, ok := a.vpkCache.Load(target.Path); ok {
		cache := cached.(*VPKFileCache)
		target.Name = cache.File.Name
		target.Title = cache.File.Title
		target.WorkshopID = cache.File.WorkshopID
		if cache.File.Location != "" {
			target.Location = cache.File.Location
		}
		return
	}
	target.Name = filepath.Base(target.Path)
	target.Location = modelStatsLocationFromPath(rootDir, target.Path)
}

func modelStatsLocationFromPath(rootDir, filePath string) string {
	rel, err := filepath.Rel(rootDir, filePath)
	if err != nil {
		return "root"
	}
	parts := strings.Split(rel, string(filepath.Separator))
	if len(parts) > 0 && parts[0] == "workshop" {
		return "workshop"
	}
	return "root"
}

func (a *App) emitModelStatsScanProgress(scanID string, current, total int, message string) {
	progress := ProgressInfo{Current: current, Total: total, Message: message}
	a.modelStatsScanMu.Lock()
	if a.modelStatsScanRunning && a.modelStatsScanID == scanID {
		a.modelStatsScanProgress = progress
	}
	a.modelStatsScanMu.Unlock()
	runtime.EventsEmit(a.ctx, "model_stats_scan_progress", ModelStatsScanProgress{
		ScanID:  scanID,
		Current: current,
		Total:   total,
		Message: message,
	})
}

func (a *App) emitModelStatsScanComplete(scanID string, result *ModelStatsScanResult, message string) {
	runtime.EventsEmit(a.ctx, "model_stats_scan_complete", ModelStatsScanComplete{
		ScanID: scanID,
		Result: result,
		Error:  message,
	})
}

func (a *App) finishModelStatsScan(scanID string) {
	a.modelStatsScanMu.Lock()
	defer a.modelStatsScanMu.Unlock()
	if a.modelStatsScanID != scanID {
		return
	}
	a.modelStatsScanRunning = false
	a.modelStatsScanID = ""
	a.modelStatsScanRoot = ""
	a.modelStatsScanProgress = ProgressInfo{}
}

func (a *App) modelStatsScanStateLocked() ModelStatsScanState {
	if !a.modelStatsScanRunning {
		return ModelStatsScanState{
			Status:  modelStatsScanStatusIdle,
			Running: false,
		}
	}
	return ModelStatsScanState{
		Status:   modelStatsScanStatusRunning,
		Running:  true,
		ScanID:   a.modelStatsScanID,
		RootDir:  a.modelStatsScanRoot,
		Progress: a.modelStatsScanProgress,
	}
}
