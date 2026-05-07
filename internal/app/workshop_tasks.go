package app

import (
	"context"
	"fmt"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func (a *App) GetDownloadTasks() []*DownloadTask {
	taskManager.mu.RLock()
	defer taskManager.mu.RUnlock()

	tasks := make([]*DownloadTask, 0, len(taskManager.tasks))
	for _, t := range taskManager.tasks {
		tasks = append(tasks, t)
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

type TaskWriteCounter struct {
	Task        *DownloadTask
	Total       int64
	Current     int64
	Ctx         context.Context
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

		runtime.EventsEmit(wc.Ctx, "task_progress", wc.Task)
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
