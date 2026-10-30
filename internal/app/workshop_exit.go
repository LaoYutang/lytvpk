package app

import (
	"context"
	"fmt"
	"time"
)

// DownloadExitRisk is a read-only snapshot for the exit confirmation dialog.
// Unknown means a transfer has not yet established a reliable file identity;
// it must not be presented as safe to pause.
type DownloadExitRisk struct {
	Downloads               bool `json:"downloads"`
	DownloadLossRisk        bool `json:"downloadLossRisk"`
	DownloadIdentityUnknown bool `json:"downloadIdentityUnknown"`
}

func downloadExitRiskLocked() DownloadExitRisk {
	var risk DownloadExitRisk
	for _, task := range taskManager.tasks {
		switch task.Status {
		case "pending", "selecting_ip":
			risk.Downloads = true
			// The next response has not been established, even if a previous
			// transfer left a strong validator in memory.
			risk.DownloadIdentityUnknown = true
		case "downloading":
			risk.Downloads = true
			if task.transfer == nil {
				risk.DownloadIdentityUnknown = true
			} else if !validStrongDownloadETag(task.transfer.validator) {
				if task.DownloadedSize > 0 || task.Progress > 0 || pauseHasKnownUnverifiedBytes(task) {
					risk.DownloadLossRisk = true
				} else {
					risk.DownloadIdentityUnknown = true
				}
			} else if task.transfer.mode == "single" && !task.transfer.responseConfirmed {
				// A saved ETag cannot verify the current response until the new
				// GET has returned and passed its range checks.
				risk.DownloadIdentityUnknown = true
			}
		case "pausing", "cancelling", "failing", "finalizing":
			risk.Downloads = true
		}
	}
	return risk
}

func (a *App) GetDownloadExitRisk() DownloadExitRisk {
	taskManager.mu.RLock()
	defer taskManager.mu.RUnlock()
	return downloadExitRiskLocked()
}

// requestPauseDownloadsForExitLocked requires taskManager.mu and the exit
// admission gate. It marks workers as pausing before the confirmation check's
// locks are released, so a newly received response cannot bypass that check.
func requestPauseDownloadsForExitLocked() []*DownloadTask {
	changed := make([]*DownloadTask, 0)
	for _, task := range taskManager.tasks {
		switch task.Status {
		case "pending", "selecting_ip", "downloading":
			task.Status = "pausing"
			task.Speed = ""
			if task.cancelFunc != nil {
				task.cancelFunc()
			}
			changed = append(changed, task)
		case "pausing":
			if task.cancelFunc != nil {
				task.cancelFunc()
			}
		}
	}
	return changed
}

// pauseDownloadsForExit closes the admission gate before stopping workers.
// A paused status is published only after its worker has closed all requests
// and file handles, so the final snapshot can safely sync completed bytes.
func (a *App) pauseDownloadsForExit(ctx context.Context) error {
	a.downloadExitMu.Lock()
	a.downloadExitRequested = true
	taskManager.mu.Lock()
	changed := requestPauseDownloadsForExitLocked()
	taskManager.mu.Unlock()
	a.downloadExitMu.Unlock()

	for _, task := range changed {
		a.emitDownloadTaskEvent("task_updated", task)
	}

	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	for {
		taskManager.mu.RLock()
		active := false
		for _, task := range taskManager.tasks {
			switch task.Status {
			case "pending", "selecting_ip", "downloading", "pausing", "cancelling", "failing", "finalizing":
				active = true
			}
			if active {
				break
			}
		}
		taskManager.mu.RUnlock()
		if !active {
			if err := a.persistDownloadTasksNow(); err != nil {
				return fmt.Errorf("退出前保存下载任务失败: %w", err)
			}
			return nil
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("等待下载停止超时: %w", ctx.Err())
		case <-ticker.C:
		}
	}
}

func (a *App) cancelDownloadExit() {
	a.downloadExitMu.Lock()
	a.downloadExitRequested = false
	a.downloadExitMu.Unlock()
}
