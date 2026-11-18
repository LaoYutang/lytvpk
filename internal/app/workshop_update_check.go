package app

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"vpk-manager/internal/network"

	"github.com/panjf2000/ants/v2"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// UpdateCheckResult 更新检测结果
type UpdateCheckResult struct {
	TotalUpdates     int    `json:"total_updates"`     // 总计需要更新的Mod数
	NewDetected      int    `json:"new_detected"`      // 本次新检测到的更新数
	UnavailableCount int    `json:"unavailable_count"` // 本次查不到的不同工坊 ID 数
	FailedCount      int    `json:"failed_count"`      // 未完成的检查项数；整个任务未启动时为1
	FirstError       string `json:"first_error"`       // 首个不含地址的具体失败原因
	Line             string `json:"line"`              // 本次检查固定使用的线路
}

// CheckModUpdates 检测所有含有meta数据的mod是否有更新
func (a *App) CheckModUpdates() UpdateCheckResult {
	return a.runModUpdateCheck(false)
}

func (a *App) runModUpdateCheck(fromSetting bool) UpdateCheckResult {
	operation := a.captureAPIOperation()
	a.mu.RLock()
	enabled := a.workshopUpdateCheckEnabled && a.workshopMetaEnabled
	a.mu.RUnlock()
	if !enabled {
		return UpdateCheckResult{FailedCount: 1, FirstError: "工坊更新检查未启动，请先启用工坊信息与更新检测", Line: string(operation.line)}
	}
	result := a.checkModUpdatesWithOperation(operation)
	if a.ctx != nil {
		if fromSetting {
			a.mu.RLock()
			fromSetting = a.workshopUpdateCheckEnabled && a.workshopMetaEnabled && a.apiGeneration == operation.generation && a.apiLineLocked() == operation.line
			a.mu.RUnlock()
		}
		runtime.EventsEmit(a.ctx, "mod_update_check_complete", result, fromSetting)
	}
	return result
}

const workshopUpdateBatchSize = 100

type updateCheckFile struct {
	path         string
	workshopID   string
	downloadedAt time.Time
}

type workshopUpdateStatus struct {
	result  int
	updated time.Time
}

type workshopUpdateBatch struct {
	ids   []string
	items map[string]workshopUpdateStatus
	err   error
}

func (result *UpdateCheckResult) fail(files int, reason string) {
	result.FailedCount += files
	if result.FirstError == "" {
		result.FirstError = reason
	}
}

// An ID can occur in several directories with different installation times.
func (result *UpdateCheckResult) compareFiles(files []updateCheckFile, updated time.Time) {
	for _, file := range files {
		if !updated.After(file.downloadedAt) {
			continue
		}
		var pending, newlyDetected bool
		err := editWorkshopMeta(file.path, func(meta *WorkshopMeta) bool {
			downloaded, err := time.Parse(time.RFC3339, meta.DownloadedAt)
			if meta.WorkshopID != file.workshopID || err != nil || !updated.After(downloaded) {
				return false
			}
			pending = true
			known, err := time.Parse(time.RFC3339, meta.TimeUpdated)
			if err == nil && known.After(downloaded) {
				return false
			}
			newlyDetected = true
			meta.TimeUpdated = updated.Format(time.RFC3339)
			return true
		})
		if err != nil {
			log.Printf("写入TimeUpdated失败: %s, 错误: %v", file.path, err)
			result.fail(1, "无法保存本地工坊更新时间")
			continue
		}
		if pending {
			result.TotalUpdates++
		}
		if newlyDetected {
			result.NewDetected++
		}
	}
}

func (a *App) pendingWorkshopUpdates(result *UpdateCheckResult) map[string][]updateCheckFile {
	files := make(map[string][]updateCheckFile)
	a.mu.RLock()
	defer a.mu.RUnlock()
	a.vpkCache.Range(func(_, value any) bool {
		file := value.(*VPKFileCache).File
		if file.WorkshopID == "" || strings.HasPrefix(file.WorkshopID, "direct-") {
			return true
		}
		meta, err := LoadWorkshopMeta(file.Path)
		if err != nil || meta == nil || meta.WorkshopID != file.WorkshopID {
			return true
		}
		downloaded, err := time.Parse(time.RFC3339, meta.DownloadedAt)
		if err != nil {
			return true
		}
		if known, err := time.Parse(time.RFC3339, meta.TimeUpdated); err == nil && known.After(downloaded) {
			result.TotalUpdates++
			return true
		}
		n, err := strconv.ParseUint(file.WorkshopID, 10, 64)
		if err != nil || n == 0 {
			result.fail(1, "本地工坊 ID 无效")
			return true
		}
		id := strconv.FormatUint(n, 10)
		files[id] = append(files[id], updateCheckFile{file.Path, file.WorkshopID, downloaded})
		return true
	})
	return files
}

func (a *App) checkModUpdatesWithOperation(operation apiOperation) UpdateCheckResult {
	result := UpdateCheckResult{Line: string(operation.line)}
	files := a.pendingWorkshopUpdates(&result)
	prefix := operation.cachePrefix() + "update:time:"
	ids := make([]string, 0, len(files))
	for id, copies := range files {
		if val, ok := getWorkshopCache(prefix + id); ok {
			if updated, ok := val.(time.Time); ok {
				result.compareFiles(copies, updated)
				continue
			}
		}
		ids = append(ids, id)
	}
	slices.Sort(ids)
	var batches []workshopUpdateBatch
	for group := range slices.Chunk(ids, workshopUpdateBatchSize) {
		batches = append(batches, workshopUpdateBatch{ids: group})
	}
	if len(batches) == 0 {
		return result
	}

	// Concurrency applies to requests, while each result below is matched by ID.
	pool, err := ants.NewPool(4)
	if err != nil {
		for _, id := range ids {
			result.fail(len(files[id]), "无法启动工坊更新检查")
		}
		return result
	}
	defer pool.Release()
	var wg sync.WaitGroup
	for i := range batches {
		batch := &batches[i]
		wg.Add(1)
		if err := pool.Submit(func() {
			defer wg.Done()
			if err := operation.ctx.Err(); err != nil {
				batch.err = network.NewAPIRequestError(operation.line, err)
				return
			}
			batch.items, batch.err = fetchWorkshopUpdates(operation, batch.ids)
		}); err != nil {
			wg.Done()
			batch.err = fmt.Errorf("工坊更新检查任务未启动，请重新检查")
		}
	}
	wg.Wait()
	for _, batch := range batches {
		for _, id := range batch.ids {
			copies := files[id]
			item := batch.items[id]
			switch {
			case batch.err != nil:
				result.fail(len(copies), batch.err.Error())
			case item.result == 9:
				// Count remote items once; no local file or metadata is removed.
				result.UnavailableCount++
			case item.result == 1 && !item.updated.IsZero():
				a.cacheWorkshopAPIResult(operation, prefix+id, item.updated)
				result.compareFiles(copies, item.updated)
			case item.result == 1:
				result.fail(len(copies), "工坊详情未返回有效的更新时间")
			case item.result > 0:
				result.fail(len(copies), fmt.Sprintf("工坊项目查询失败（Steam 结果码 %d）", item.result))
			default:
				result.fail(len(copies), "工坊批量查询未返回有效的项目结果")
			}
		}
	}
	return result
}

func fetchWorkshopUpdates(operation apiOperation, ids []string) (map[string]workshopUpdateStatus, error) {
	// A 100-item response contains only IDs, result codes and timestamps.
	response, err := operation.clients.browser.R().SetContext(operation.ctx).SetResponseBodyLimit(64<<10).
		SetQueryParam("ids", strings.Join(ids, ",")).Get(operation.endpoints.WorkshopBaseURL + "/updates")
	if err != nil {
		return nil, network.NewAPIRequestError(operation.line, err)
	}
	if response.StatusCode() != http.StatusOK {
		return nil, network.NewAPIStatusError(operation.line, response.StatusCode(), response.Header().Get("Retry-After"))
	}
	var data struct {
		Items []json.RawMessage `json:"items"`
	}
	if err := json.Unmarshal(response.Body(), &data); err != nil || data.Items == nil {
		return nil, fmt.Errorf("工坊批量查询响应格式无效")
	}
	requested := make(map[string]bool, len(ids))
	for _, id := range ids {
		requested[id] = true
	}
	items := make(map[string]workshopUpdateStatus, len(ids))
	for _, raw := range data.Items {
		var row struct {
			ID          string          `json:"publishedfileid"`
			Result      json.RawMessage `json:"result"`
			TimeUpdated any             `json:"time_updated"`
		}
		if err := json.Unmarshal(raw, &row); err != nil || !requested[row.ID] {
			continue
		}
		item := workshopUpdateStatus{}
		if _, duplicate := items[row.ID]; !duplicate {
			if json.Unmarshal(row.Result, &item.result) == nil && item.result == 1 {
				item.updated, _ = updateCheckTimeUpdated(row.TimeUpdated)
			}
		}
		items[row.ID] = item
	}
	return items, nil
}

// Only a positive, whole Unix timestamp constitutes a completed update check.
// Missing, malformed or zero values must not be reported as "already latest".
func updateCheckTimeUpdated(value interface{}) (time.Time, bool) {
	var timestamp int64
	switch v := value.(type) {
	case float64:
		if math.IsNaN(v) || math.IsInf(v, 0) || math.Trunc(v) != v || v <= 0 || v >= math.MaxInt64 {
			return time.Time{}, false
		}
		timestamp = int64(v)
	case int64:
		timestamp = v
	case string:
		var err error
		timestamp, err = strconv.ParseInt(v, 10, 64)
		if err != nil {
			return time.Time{}, false
		}
	default:
		return time.Time{}, false
	}
	if timestamp <= 0 {
		return time.Time{}, false
	}
	updated := time.Unix(timestamp, 0)
	if updated.Year() > 9999 {
		return time.Time{}, false
	}
	return updated, true
}
