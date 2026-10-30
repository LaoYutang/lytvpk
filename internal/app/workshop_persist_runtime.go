package app

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const downloadTaskSaveInterval = 2 * time.Second

// persistDownloadTasksNow serializes snapshot creation and writes so a stale
// snapshot cannot replace a newer task state. It also flushes resumable bytes
// before committing a checkpoint that refers to them.
func (a *App) persistDownloadTasksNow() error {
	if a.configDir == "" {
		return nil
	}
	a.downloadPersistMu.Lock()
	defer a.downloadPersistMu.Unlock()
	if a.downloadPersistTimer != nil {
		a.downloadPersistTimer.Stop()
		a.downloadPersistTimer = nil
	}
	return a.writeDownloadTaskStore(a.snapshotDownloadTasks())
}

func (a *App) scheduleDownloadTasksSave() {
	if a.configDir == "" {
		return
	}
	a.downloadPersistMu.Lock()
	if a.downloadPersistTimer == nil {
		a.downloadPersistTimer = time.AfterFunc(downloadTaskSaveInterval, func() {
			if err := a.persistDownloadTasksNow(); err != nil {
				log.Printf("保存下载任务进度失败: %v", err)
			}
		})
	}
	a.downloadPersistMu.Unlock()
}

func (a *App) snapshotDownloadTasks() []persistedDownloadTask {
	taskManager.mu.RLock()
	records := make([]persistedDownloadTask, 0, len(taskManager.tasks))
	for _, task := range taskManager.tasks {
		copy := *task
		copy.Speed = ""
		record := persistedDownloadTask{Task: copy, RootDir: task.rootDir}
		if task.transfer != nil {
			transferCopy := *task.transfer
			transferCopy.completedBlocks = append([]bool(nil), task.transfer.completedBlocks...)
			record.Transfer = &persistedDownloadTransfer{
				Mode: transferCopy.mode, FileName: filepath.Base(transferCopy.tempPath),
				Validator: transferCopy.validator, TotalSize: transferCopy.totalSize,
				ContentDisposition: transferCopy.contentDisposition,
				CompletedBlocks:    transferCopy.completedBlocks,
			}
		}
		records = append(records, record)
	}
	taskManager.mu.RUnlock()

	for i := range records {
		record := &records[i]
		state := record.Transfer
		if state == nil || record.Task.Status == "completed" {
			record.Transfer = nil
			continue
		}
		if record.Task.Status == "cancelled" || record.Task.Status == "cancelling" ||
			record.Task.Status == "failed" || record.Task.Status == "failing" || record.Task.Status == "finalizing" {
			// Keep only a validated cleanup path until cancellation finishes. A
			// crash after recording cancellation can then remove the temp file.
			if !filepath.IsAbs(record.RootDir) || !validDownloadTaskID(record.Task.ID) ||
				(state.Mode != "single" && state.Mode != "chunk") ||
				(state.Mode == "single" && state.FileName != record.Task.ID+"_single") ||
				(state.Mode == "chunk" && state.FileName != record.Task.ID+"_final") {
				record.Transfer = nil
			} else {
				record.Transfer = &persistedDownloadTransfer{Mode: state.Mode, FileName: state.FileName}
			}
			continue
		}
		if !filepath.IsAbs(record.RootDir) || !validDownloadTaskID(record.Task.ID) {
			record.Transfer = nil
			record.Task.DownloadedSize = 0
			record.Task.Progress = 0
			continue
		}
		var expectedName string
		switch state.Mode {
		case "single":
			expectedName = record.Task.ID + "_single"
		case "chunk":
			expectedName = record.Task.ID + "_final"
		default:
			record.Transfer = nil
			continue
		}
		if state.FileName != expectedName {
			record.Transfer = nil
			record.Task.DownloadedSize = 0
			record.Task.Progress = 0
			continue
		}
		if !validStrongDownloadETag(state.Validator) {
			// Without a stable version identifier, a saved byte count cannot be
			// presented as progress that will survive restart. Retain only the
			// verified cleanup name so startup can discard the stale partial.
			record.Transfer = &persistedDownloadTransfer{Mode: state.Mode, FileName: state.FileName}
			record.Task.DownloadedSize = 0
			record.Task.Progress = 0
			continue
		}
		path := filepath.Join(record.RootDir, "temp", expectedName)
		size, err := syncedDownloadTempSize(path)
		if err != nil {
			// The path may be about to be created. Keep its safe cleanup name
			// so a crash in that window cannot orphan a preallocated file.
			record.Transfer = &persistedDownloadTransfer{Mode: state.Mode, FileName: state.FileName}
			record.Task.DownloadedSize = 0
			record.Task.Progress = 0
			continue
		}
		switch state.Mode {
		case "single":
			if state.TotalSize > 0 && size > state.TotalSize {
				record.Transfer = &persistedDownloadTransfer{Mode: state.Mode, FileName: state.FileName}
				record.Task.DownloadedSize = 0
				record.Task.Progress = 0
				continue
			}
			state.CheckpointBytes = size
			record.Task.DownloadedSize = size
		case "chunk":
			if state.TotalSize <= 0 || size != state.TotalSize {
				record.Transfer = &persistedDownloadTransfer{Mode: state.Mode, FileName: state.FileName}
				record.Task.DownloadedSize = 0
				record.Task.Progress = 0
				continue
			}
			count := int((state.TotalSize + persistedDownloadBlockSize - 1) / persistedDownloadBlockSize)
			if len(state.CompletedBlocks) == 0 {
				state.CompletedBlocks = make([]bool, count)
			}
			if len(state.CompletedBlocks) != count {
				record.Transfer = &persistedDownloadTransfer{Mode: state.Mode, FileName: state.FileName}
				record.Task.DownloadedSize = 0
				record.Task.Progress = 0
				continue
			}
			var completeBytes int64
			for block, completed := range state.CompletedBlocks {
				if completed {
					end := min(int64(block+1)*persistedDownloadBlockSize, state.TotalSize)
					completeBytes += end - int64(block)*persistedDownloadBlockSize
				}
			}
			record.Task.DownloadedSize = completeBytes
		}
		record.Task.TotalSize = state.TotalSize
		if state.TotalSize > 0 {
			record.Task.Progress = int(100 * record.Task.DownloadedSize / state.TotalSize)
		}
	}
	return records
}

func syncedDownloadTempSize(path string) (int64, error) {
	file, err := os.OpenFile(path, os.O_RDWR, 0)
	if err != nil {
		return 0, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return 0, err
	}
	if !info.Mode().IsRegular() {
		return 0, fmt.Errorf("download temp file is not regular")
	}
	// Read size before Sync: concurrent writes after this point are intentionally
	// excluded from the committed checkpoint and trimmed on recovery.
	size := info.Size()
	if err := file.Sync(); err != nil {
		return 0, err
	}
	return size, nil
}

func validDownloadTaskID(id string) bool {
	if id == "" || len(id) > 96 {
		return false
	}
	for _, c := range id {
		if (c < '0' || c > '9') && (c < 'a' || c > 'z') && (c < 'A' || c > 'Z') && c != '-' && c != '_' {
			return false
		}
	}
	return true
}

func validStrongDownloadETag(etag string) bool {
	return len(etag) >= 2 && etag[0] == '"' && etag[len(etag)-1] == '"' && !strings.HasPrefix(strings.ToLower(etag), "w/")
}
