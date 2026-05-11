package app

import (
	"log"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// UpdateCheckResult 更新检测结果
type UpdateCheckResult struct {
	TotalUpdates int `json:"total_updates"` // 总计需要更新的Mod数
	NewDetected  int `json:"new_detected"`  // 本次新检测到的更新数
}

// CheckModUpdates 检测所有含有meta数据的mod是否有更新
func (a *App) CheckModUpdates() UpdateCheckResult {
	if !a.workshopUpdateCheckEnabled || !a.workshopMetaEnabled {
		return UpdateCheckResult{}
	}

	log.Println("开始检测Mod更新...")

	var confirmedCount int
	var toCheck []struct {
		filePath   string
		workshopID string
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
			filePath   string
			workshopID string
			downloadedAt time.Time
		}{vpkFile.Path, vpkFile.WorkshopID, downloadedAt})

		return true
	})

	log.Printf("需要检测更新的Mod数量: %d（已确认有更新: %d）", len(toCheck), confirmedCount)

	var newDetected int
	var mu sync.Mutex
	var wg sync.WaitGroup

	for _, item := range toCheck {
		wg.Add(1)
		go func(filePath, workshopID string, downloadedAt time.Time) {
			defer wg.Done()

			detail, err := a.FetchWorkshopDetail(workshopID)
			if err != nil {
				log.Printf("检测更新失败: (ID: %s), 错误: %v", workshopID, err)
				return
			}

			var timeUpdated time.Time
			switch v := detail.TimeUpdated.(type) {
			case float64:
				timeUpdated = time.Unix(int64(v), 0)
			case int64:
				timeUpdated = time.Unix(v, 0)
			case string:
				ts, pErr := strconv.ParseInt(v, 10, 64)
				if pErr != nil {
					return
				}
				timeUpdated = time.Unix(ts, 0)
			default:
				return
			}

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
		}(item.filePath, item.workshopID, item.downloadedAt)
	}

	wg.Wait()

	totalUpdates := confirmedCount + newDetected
	log.Printf("更新检测完成，总计 %d 个Mod有更新（新检测: %d）", totalUpdates, newDetected)

	result := UpdateCheckResult{
		TotalUpdates: totalUpdates,
		NewDetected:  newDetected,
	}

	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, "mod_update_check_complete", result)
	}

	return result
}