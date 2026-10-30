package app

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
)

var persistedDownloadIDPattern = regexp.MustCompile(`^[0-9]+-[0-9]+$`)

const persistedDownloadBlockSize int64 = 5 * 1024 * 1024

// loadDownloadTasks restores list history and safe checkpoints. A former
// in-flight task is always paused; startup never opens a network connection.
func (a *App) loadDownloadTasks() error {
	records, err := a.readDownloadTaskStore()
	if err != nil {
		return err
	}
	restored := make(map[string]*DownloadTask, len(records))
	for _, record := range records {
		task := record.Task
		if !persistedDownloadIDPattern.MatchString(task.ID) {
			log.Printf("忽略 ID 不合法的下载任务记录")
			continue
		}
		if _, duplicate := restored[task.ID]; duplicate {
			log.Printf("忽略重复的下载任务记录: %s", task.ID)
			continue
		}
		root, rootOK := validPersistedDownloadRoot(record.RootDir)
		if root != "" {
			task.rootDir = root
		}
		task.cancelFunc = nil
		task.transfer = nil
		task.Speed = ""
		switch task.Status {
		case "pending", "selecting_ip", "downloading", "pausing", "paused":
			task.Status = "paused"
			task.Error = ""
			task.FilePath = ""
			if rootOK && restoreDownloadTransfer(&task, root, record.Transfer) {
				task.Notice = ""
			} else {
				if rootOK {
					task.transfer = removePersistedDownloadTemp(root, task.ID, record.Transfer)
				}
				task.DownloadedSize = 0
				task.Progress = 0
				if !rootOK {
					task.Notice = "原下载目录不可用，无法继续此任务"
				} else if record.Transfer != nil && record.Transfer.Mode == "single" && record.Transfer.Validator == "" {
					task.Notice = "服务器未提供可验证的版本标识，重启后继续将从头下载"
				} else {
					task.Notice = "暂存文件不可验证，继续时将从头下载"
				}
			}
		case "cancelling":
			task.Status = "cancelled"
			task.Error = "Cancelled by user"
			if rootOK {
				task.transfer = removePersistedDownloadTemp(root, task.ID, record.Transfer)
			}
		case "failing":
			task.Status = "failed"
			if task.Error == "" {
				task.Error = "上次下载异常中断"
			}
			if rootOK {
				task.transfer = removePersistedDownloadTemp(root, task.ID, record.Transfer)
			}
		case "finalizing":
			task.Status = "failed"
			task.Error = "安装结果未确认"
			task.Notice = "上次在安装收尾阶段中断，请检查 Mod 列表后再决定是否重试"
			if rootOK {
				task.transfer = removePersistedDownloadTemp(root, task.ID, record.Transfer)
			}
		case "completed", "failed", "cancelled":
			if rootOK {
				task.transfer = removePersistedDownloadTemp(root, task.ID, record.Transfer)
			}
		default:
			task.Status = "failed"
			task.Error = "无法识别保存的下载任务状态"
			task.Notice = "任务记录无法安全恢复，请重试下载"
			if rootOK {
				task.transfer = removePersistedDownloadTemp(root, task.ID, record.Transfer)
			}
		}
		if !rootOK && root != "" {
			// Retain only the verified cleanup name while a drive is offline.
			// Once it returns, retry or clear can safely remove the old temp.
			if path, valid := expectedPersistedDownloadTempPath(root, task.ID, record.Transfer); valid {
				task.transfer = &downloadTransferState{mode: record.Transfer.Mode, tempPath: path}
			}
		}
		restored[task.ID] = &task
	}
	taskManager.mu.Lock()
	taskManager.tasks = restored
	taskManager.mu.Unlock()
	return nil
}

func validPersistedDownloadRoot(root string) (string, bool) {
	if root == "" || !filepath.IsAbs(root) {
		return "", false
	}
	root = filepath.Clean(root)
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		return root, false
	}
	return root, true
}

// The JSON FileName is never used as a path. The expected name is derived
// from the validated task ID and mode beneath its original root/temp folder.
func expectedPersistedDownloadTempPath(root, id string, transfer *persistedDownloadTransfer) (string, bool) {
	if transfer == nil || !filepath.IsAbs(root) || !persistedDownloadIDPattern.MatchString(id) {
		return "", false
	}
	var expectedName string
	switch transfer.Mode {
	case "single":
		expectedName = id + "_single"
	case "chunk":
		expectedName = id + "_final"
	default:
		return "", false
	}
	if transfer.FileName != expectedName {
		return "", false
	}
	return filepath.Join(root, "temp", expectedName), true
}

func persistedDownloadTempPath(root, id string, transfer *persistedDownloadTransfer) (string, bool) {
	path, valid := expectedPersistedDownloadTempPath(root, id, transfer)
	if !valid {
		return "", false
	}
	tempDir := filepath.Dir(path)
	info, err := os.Lstat(tempDir)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", false
	}
	return path, true
}

// A failed deletion stays attached as cleanup-only state, so a later clear or
// restart can retry instead of silently forgetting the partial file.
func removePersistedDownloadTemp(root, id string, transfer *persistedDownloadTransfer) *downloadTransferState {
	path, valid := persistedDownloadTempPath(root, id, transfer)
	if !valid {
		return nil
	}
	info, err := os.Lstat(path)
	if err != nil && !os.IsNotExist(err) {
		log.Printf("检查下载暂存文件失败: %v", err)
		return &downloadTransferState{mode: transfer.Mode, tempPath: path}
	}
	if err == nil && info.Mode().IsRegular() {
		if err := os.Remove(path); err != nil {
			log.Printf("清理下载暂存文件失败: %v", err)
			return &downloadTransferState{mode: transfer.Mode, tempPath: path}
		}
	}
	return nil
}

func restoreDownloadTransfer(task *DownloadTask, root string, transfer *persistedDownloadTransfer) bool {
	path, valid := persistedDownloadTempPath(root, task.ID, transfer)
	if !valid || transfer.TotalSize < 0 {
		return false
	}
	header := make(http.Header)
	header.Set("ETag", transfer.Validator)
	if transfer.Validator == "" || strongETag(header) != transfer.Validator {
		return false
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() {
		return false
	}
	state := &downloadTransferState{
		mode: transfer.Mode, tempPath: path, validator: transfer.Validator,
		totalSize: transfer.TotalSize, contentDisposition: transfer.ContentDisposition,
	}
	switch transfer.Mode {
	case "single":
		if transfer.CheckpointBytes <= 0 || transfer.CheckpointBytes > info.Size() ||
			(transfer.TotalSize > 0 && transfer.CheckpointBytes >= transfer.TotalSize) {
			return false
		}
		if info.Size() > transfer.CheckpointBytes {
			file, err := os.OpenFile(path, os.O_RDWR, 0600)
			if err != nil {
				return false
			}
			truncateErr := file.Truncate(transfer.CheckpointBytes)
			if truncateErr == nil {
				truncateErr = file.Sync()
			}
			closeErr := file.Close()
			if truncateErr != nil || closeErr != nil {
				log.Printf("回收未记录的下载尾部失败: %v", fmt.Errorf("truncate: %v; close: %v", truncateErr, closeErr))
				return false
			}
		}
		task.DownloadedSize = transfer.CheckpointBytes
		if transfer.TotalSize > 0 {
			task.Progress = int(100 * transfer.CheckpointBytes / transfer.TotalSize)
		} else {
			task.Progress = 0
		}
	case "chunk":
		if transfer.TotalSize <= 0 || info.Size() != transfer.TotalSize {
			return false
		}
		count := int((transfer.TotalSize + persistedDownloadBlockSize - 1) / persistedDownloadBlockSize)
		if len(transfer.CompletedBlocks) != count {
			return false
		}
		state.completedBlocks = append([]bool(nil), transfer.CompletedBlocks...)
		var completedBytes int64
		for i, completed := range state.completedBlocks {
			if !completed {
				continue
			}
			start := int64(i) * persistedDownloadBlockSize
			end := start + persistedDownloadBlockSize
			if end > transfer.TotalSize {
				end = transfer.TotalSize
			}
			completedBytes += end - start
		}
		task.DownloadedSize = completedBytes
		task.Progress = int(100 * completedBytes / transfer.TotalSize)
	default:
		return false
	}
	task.TotalSize = transfer.TotalSize
	task.transfer = state
	return true
}
