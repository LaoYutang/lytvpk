package app

import (
	"context"
	"fmt"
	"log"
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
	responseConfirmed  bool   // current single-connection response passed range/version checks
	totalSize          int64
	contentDisposition string
	completedBlocks    []bool
}

func (a *App) emitDownloadTaskEvent(name string, task *DownloadTask) {
	// Wails supplies the events bus in its context. Tests and other headless
	// callers have no bus; EventsEmit would terminate their process.
	if a.ctx != nil && a.ctx.Value("events") != nil {
		// Snapshot and enqueue under the same mutex so an earlier status cannot be
		// delivered after a later one (for example pausing after paused).
		taskManager.mu.Lock()
		snapshot := *task
		runtime.EventsEmit(a.ctx, name, &snapshot)
		taskManager.mu.Unlock()
	}
	if name == "task_progress" {
		a.scheduleDownloadTasksSave()
	} else if err := a.persistDownloadTasksNow(); err != nil {
		log.Printf("保存下载任务记录失败: %v", err)
	}
}

func (a *App) finishDownloadRun(task *DownloadTask) {
	a.downloadPersistMu.Lock()
	taskManager.mu.Lock()
	switch task.Status {
	case "pausing":
		task.Status = "paused"
		task.Speed = ""
		if state := task.transfer; state != nil {
			if state.validator == "" {
				var cleanupErr error
				if _, available := validPersistedDownloadRoot(task.rootDir); !available {
					cleanupErr = fmt.Errorf("原下载目录不可用")
				} else {
					cleanupErr = os.Remove(state.tempPath)
				}
				if cleanupErr == nil || os.IsNotExist(cleanupErr) {
					task.transfer = nil
					task.Notice = "服务器未提供可验证的文件标识，继续时将从头下载"
				} else {
					log.Printf("清理不可续传的暂存文件失败: %v", cleanupErr)
					task.Notice = "暂存文件清理失败，继续时会重新尝试并从头下载"
				}
				task.DownloadedSize = 0
				task.Progress = 0
			} else if state.mode == "single" {
				if info, err := os.Stat(state.tempPath); err == nil && info.Mode().IsRegular() && (state.totalSize <= 0 || info.Size() <= state.totalSize) {
					task.DownloadedSize = info.Size()
					if state.totalSize > 0 {
						task.Progress = int(100 * info.Size() / state.totalSize)
					}
				} else {
					task.DownloadedSize = 0
					task.Progress = 0
					task.Notice = "暂存文件无法验证，继续时将从头下载"
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
			var cleanupErr error
			if _, available := validPersistedDownloadRoot(task.rootDir); !available {
				cleanupErr = fmt.Errorf("原下载目录不可用")
			} else {
				cleanupErr = os.Remove(task.transfer.tempPath)
			}
			if cleanupErr == nil || os.IsNotExist(cleanupErr) {
				task.transfer = nil
			} else {
				log.Printf("清理下载暂存文件失败: %v", cleanupErr)
				task.Notice = "暂存文件清理失败，请稍后重试清理"
			}
		}
	}
	taskManager.mu.Unlock()
	a.downloadPersistMu.Unlock()
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
	a.downloadPersistMu.Lock()
	taskManager.mu.Lock()

	for id, t := range taskManager.tasks {
		if t.Status == "completed" || t.Status == "failed" || t.Status == "cancelled" {
			if t.transfer != nil {
				if _, available := validPersistedDownloadRoot(t.rootDir); !available {
					log.Printf("原下载目录不可用，保留任务供稍后清理: %s", t.ID)
					continue
				}
				if err := os.Remove(t.transfer.tempPath); err != nil && !os.IsNotExist(err) {
					log.Printf("清理下载暂存文件失败，保留任务以便重试: %v", err)
					continue
				}
				t.transfer = nil
			}
			delete(taskManager.tasks, id)
		}
	}
	taskManager.mu.Unlock()
	if err := a.writeDownloadTaskStore(a.snapshotDownloadTasks()); err != nil {
		log.Printf("清理下载任务记录失败: %v", err)
	}
	a.downloadPersistMu.Unlock()
	if a.ctx != nil && a.ctx.Value("events") != nil {
		runtime.EventsEmit(a.ctx, "tasks_cleared", nil)
	}
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
		a.emitDownloadTaskEvent("task_updated", &updatedTasks[i])
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
