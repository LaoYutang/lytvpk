package app

import (
	"fmt"
	"log"
	"math"
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
	TotalUpdates int    `json:"total_updates"` // 总计需要更新的Mod数
	NewDetected  int    `json:"new_detected"`  // 本次新检测到的更新数
	FailedCount  int    `json:"failed_count"`  // 未完成的检查项数；整个任务未启动时为1
	FirstError   string `json:"first_error"`   // 首个不含地址的具体失败原因
	Line         string `json:"line"`          // 本次检查固定使用的线路
}

// CheckModUpdates 检测所有含有meta数据的mod是否有更新
func (a *App) CheckModUpdates() UpdateCheckResult {
	operation := a.captureAPIOperation()
	a.mu.RLock()
	enabled := a.workshopUpdateCheckEnabled && a.workshopMetaEnabled
	a.mu.RUnlock()
	if !enabled {
		return UpdateCheckResult{FailedCount: 1, FirstError: "工坊更新检查未启动，请先启用工坊信息与更新检测", Line: string(operation.line)}
	}
	result := a.checkModUpdatesWithOperation(operation)
	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, "mod_update_check_complete", result)
	}
	return result
}

// Keep runtime notification outside the operation so the same pinned batch
// can be verified with local fixtures and a cancelable context.
func (a *App) checkModUpdatesWithOperation(operation apiOperation) UpdateCheckResult {
	log.Println("开始检测Mod更新...")

	var confirmedCount int
	var toCheck []struct {
		filePath     string
		workshopID   string
		downloadedAt time.Time
	}

	a.vpkCache.Range(func(key, value interface{}) bool {
		cache := value.(*VPKFileCache)
		vpkFile := cache.File

		if vpkFile.WorkshopID == "" || strings.HasPrefix(vpkFile.WorkshopID, "direct-") {
			return true
		}

		meta, err := LoadWorkshopMeta(vpkFile.Path)
		if meta == nil || err != nil || meta.DownloadedAt == "" {
			return true
		}

		downloadedAt, dErr := time.Parse(time.RFC3339, meta.DownloadedAt)
		if dErr != nil {
			return true
		}

		// 本地记录的更新时间已超过下载时间 → 已确认更新，跳过检查
		if meta.TimeUpdated != "" {
			timeUpdated, tErr := time.Parse(time.RFC3339, meta.TimeUpdated)
			if tErr == nil && timeUpdated.After(downloadedAt) {
				confirmedCount++
				return true
			}
		}

		// 本地更新时间未超过下载时间 → 需要调用API检查
		toCheck = append(toCheck, struct {
			filePath     string
			workshopID   string
			downloadedAt time.Time
		}{vpkFile.Path, vpkFile.WorkshopID, downloadedAt})

		return true
	})

	log.Printf("需要检测更新的Mod数量: %d（已确认有更新: %d）", len(toCheck), confirmedCount)

	var newDetected, completedCount int
	var firstError string
	var mu sync.Mutex
	var wg sync.WaitGroup
	recordFailure := func(message string) {
		mu.Lock()
		if firstError == "" {
			firstError = message
		}
		mu.Unlock()
	}
	pool, err := ants.NewPool(4)
	if err != nil {
		log.Printf("无法启动更新检测: %v", err)
		result := UpdateCheckResult{TotalUpdates: confirmedCount, FailedCount: len(toCheck), Line: string(operation.line)}
		if result.FailedCount > 0 {
			result.FirstError = "工坊更新检查任务未启动，请重新检查"
		}
		return result
	}
	defer pool.Release()

	for _, item := range toCheck {
		if operation.ctx.Err() != nil {
			recordFailure(network.NewAPIRequestError(operation.line, operation.ctx.Err()).Error())
			break
		}
		filePath, workshopID, downloadedAt := item.filePath, item.workshopID, item.downloadedAt
		wg.Add(1)
		if err := pool.Submit(func() {
			defer wg.Done()
			if err := operation.ctx.Err(); err != nil {
				recordFailure(network.NewAPIRequestError(operation.line, err).Error())
				return
			}

			// 只读取 time_updated，走默认轻量模式（服务端不查询多图预览）
			detail, err := a.fetchWorkshopDetailRawWithOperation(operation, workshopID, false, false)
			if err != nil {
				log.Printf("检测更新失败: (ID: %s), 错误: %v", workshopID, err)
				// The detail API returns public status/business errors, never a
				// response body or a low-level transport address.
				recordFailure(fmt.Sprintf("工坊更新检查失败: %v", err))
				return
			}
			if detail.PublishedFileId != workshopID {
				workshopCache.Delete(operation.cachePrefix() + "detail:raw:" + workshopID)
				recordFailure("工坊详情未返回匹配的工坊项目")
				return
			}

			timeUpdated, valid := updateCheckTimeUpdated(detail.TimeUpdated)
			if !valid {
				// Do not let an invalid success response prevent the user's next
				// explicit check from querying this item again.
				workshopCache.Delete(operation.cachePrefix() + "detail:raw:" + workshopID)
				recordFailure("工坊详情未返回有效的更新时间")
				return
			}
			mu.Lock()
			completedCount++
			mu.Unlock()

			if timeUpdated.After(downloadedAt) {
				mu.Lock()
				newDetected++
				mu.Unlock()

				// 写入TimeUpdated到meta文件
				timeUpdatedStr := timeUpdated.Format(time.RFC3339)
				if writeErr := UpdateWorkshopMetaTimeUpdated(filePath, timeUpdatedStr); writeErr != nil {
					log.Printf("写入TimeUpdated失败: %s, 错误: %v", filePath, writeErr)
				}
			}
		}); err != nil {
			wg.Done()
			log.Printf("更新检测任务未启动: %v", err)
			recordFailure("工坊更新检查任务未启动，请重新检查")
			break
		}
	}

	wg.Wait()

	totalUpdates := confirmedCount + newDetected
	log.Printf("更新检测完成，总计 %d 个Mod有更新（新检测: %d）", totalUpdates, newDetected)

	result := UpdateCheckResult{
		TotalUpdates: totalUpdates,
		NewDetected:  newDetected,
		FailedCount:  len(toCheck) - completedCount,
		FirstError:   firstError,
		Line:         string(operation.line),
	}

	return result
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
