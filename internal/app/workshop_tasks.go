package app

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// downloadTransferState survives a pause while the task remains in memory.
// Only the stopped worker may leave a partial file for the next worker.
type downloadTransferState struct {
	mode               string
	tempPath           string
	validator          string // strong ETag from the GET response
	totalSize          int64
	contentDisposition string
	completedBlocks    []bool
}

func (a *App) emitDownloadTaskEvent(name string, task *DownloadTask) {
	// Wails supplies the events bus in its context. Tests and other headless
	// callers have no bus; EventsEmit would terminate their process.
	if a.ctx == nil || a.ctx.Value("events") == nil {
		return
	}
	// Snapshot and enqueue under the same mutex so an earlier status cannot be
	// delivered after a later one (for example pausing after paused).
	taskManager.mu.Lock()
	snapshot := *task
	runtime.EventsEmit(a.ctx, name, &snapshot)
	taskManager.mu.Unlock()
}

func (a *App) finishDownloadRun(task *DownloadTask) {
	taskManager.mu.Lock()
	switch task.Status {
	case "pausing":
		task.Status = "paused"
		task.Speed = ""
		if state := task.transfer; state != nil {
			if state.validator == "" {
				hadBytes := task.DownloadedSize > 0
				if state.mode == "single" {
					if info, err := os.Stat(state.tempPath); err == nil && info.Size() > 0 {
						hadBytes = true
					}
				}
				os.Remove(state.tempPath)
				task.transfer = nil
				task.DownloadedSize = 0
				task.Progress = 0
				if hadBytes {
					task.Notice = "服务器未提供可验证的文件标识，继续时将从头下载"
				}
			} else if state.mode == "single" {
				if info, err := os.Stat(state.tempPath); err == nil {
					task.DownloadedSize = info.Size()
					if state.totalSize > 0 {
						task.Progress = int(100 * info.Size() / state.totalSize)
					}
				}
			}
		}
	case "cancelling":
		task.Status = "cancelled"
		task.Error = "Cancelled by user"
		task.Notice = ""
	case "failing":
		task.Status = "failed"
	}
	if task.Status == "failed" || task.Status == "cancelled" {
		if task.transfer != nil {
			os.Remove(task.transfer.tempPath)
			task.transfer = nil
		}
	}
	taskManager.mu.Unlock()
	a.emitDownloadTaskEvent("task_updated", task)
}

func (a *App) beginDownloadFinalizing(ctx context.Context, task *DownloadTask) bool {
	taskManager.mu.Lock()
	if ctx.Err() != nil || task.Status == "pausing" || task.Status == "cancelling" {
		taskManager.mu.Unlock()
		return false
	}
	task.Status = "finalizing"
	task.Speed = ""
	taskManager.mu.Unlock()
	a.emitDownloadTaskEvent("task_updated", task)
	return true
}

func (a *App) cleanupPausedDownloadTemps() {
	taskManager.mu.Lock()
	defer taskManager.mu.Unlock()
	for _, task := range taskManager.tasks {
		if task.Status == "paused" && task.transfer != nil {
			os.Remove(task.transfer.tempPath)
			task.transfer = nil
		}
	}
}

func (a *App) GetDownloadTasks() []*DownloadTask {
	taskManager.mu.RLock()
	defer taskManager.mu.RUnlock()

	tasks := make([]*DownloadTask, 0, len(taskManager.tasks))
	for _, t := range taskManager.tasks {
		copy := *t
		tasks = append(tasks, &copy)
	}

	// Sort by created time desc (simple implementation)
	// For now just return map values, frontend can sort
	return tasks
}

// ClearCompletedTasks removes completed and failed tasks
func (a *App) ClearCompletedTasks() {
	taskManager.mu.Lock()
	defer taskManager.mu.Unlock()

	for id, t := range taskManager.tasks {
		if t.Status == "completed" || t.Status == "failed" || t.Status == "cancelled" {
			delete(taskManager.tasks, id)
		}
	}
	runtime.EventsEmit(a.ctx, "tasks_cleared", nil)
}

func normalizeDownloadTaskPath(filePath string) string {
	if strings.TrimSpace(filePath) == "" {
		return ""
	}
	return filepath.Clean(filePath)
}

func isVPKDownloadTaskPath(filePath string) bool {
	return strings.EqualFold(filepath.Ext(filePath), ".vpk")
}

func sameDownloadTaskPath(left string, right string) bool {
	return strings.EqualFold(normalizeDownloadTaskPath(left), normalizeDownloadTaskPath(right))
}

func setDownloadTaskFilePath(task *DownloadTask, filePath string) {
	filePath = normalizeDownloadTaskPath(filePath)
	if filePath == "" || !isVPKDownloadTaskPath(filePath) {
		return
	}

	taskManager.mu.Lock()
	task.FilePath = filePath
	taskManager.mu.Unlock()
}

func (a *App) updateCompletedDownloadTaskPath(oldPath string, newPath string) {
	oldPath = normalizeDownloadTaskPath(oldPath)
	newPath = normalizeDownloadTaskPath(newPath)
	if oldPath == "" || newPath == "" || sameDownloadTaskPath(oldPath, newPath) {
		return
	}

	updatedTasks := make([]DownloadTask, 0)

	taskManager.mu.Lock()
	for _, task := range taskManager.tasks {
		if task.Status == "completed" && sameDownloadTaskPath(task.FilePath, oldPath) {
			task.FilePath = newPath
			updatedTasks = append(updatedTasks, *task)
		}
	}
	taskManager.mu.Unlock()

	for i := range updatedTasks {
		runtime.EventsEmit(a.ctx, "task_updated", &updatedTasks[i])
	}
}

type TaskWriteCounter struct {
	App         *App
	Task        *DownloadTask
	Total       int64
	Current     int64
	LastPercent int
	LastTime    time.Time
	LastBytes   int64
}

func (wc *TaskWriteCounter) Write(p []byte) (int, error) {
	n := len(p)
	wc.Current += int64(n)

	// Update progress every 1%
	// Update speed every 3 seconds
	now := time.Now()
	duration := now.Sub(wc.LastTime)

	updateProgress := false
	updateSpeed := false

	if wc.Total > 0 {
		percent := int(float64(wc.Current) / float64(wc.Total) * 100)
		if percent > wc.LastPercent {
			wc.LastPercent = percent
			updateProgress = true
		}
	}

	if duration > 3*time.Second {
		updateSpeed = true
	}

	if updateProgress || updateSpeed {
		taskManager.mu.Lock()
		if wc.Total > 0 {
			wc.Task.Progress = wc.LastPercent
		}
		wc.Task.DownloadedSize = wc.Current

		if updateSpeed {
			// Calculate speed
			bytesDelta := wc.Current - wc.LastBytes
			speedBps := float64(bytesDelta) / duration.Seconds()
			wc.Task.Speed = formatSpeed(speedBps)

			// Reset speed counters
			wc.LastTime = now
			wc.LastBytes = wc.Current
		}

		taskManager.mu.Unlock()

		wc.App.emitDownloadTaskEvent("task_progress", wc.Task)
	}
	return n, nil
}

func formatSpeed(bytesPerSec float64) string {
	if bytesPerSec < 1024 {
		return fmt.Sprintf("%.0f B/s", bytesPerSec)
	} else if bytesPerSec < 1024*1024 {
		return fmt.Sprintf("%.1f KB/s", bytesPerSec/1024)
	} else {
		return fmt.Sprintf("%.1f MB/s", bytesPerSec/(1024*1024))
	}
}

// ==================== Dynamic Chunked Download Functions ====================
