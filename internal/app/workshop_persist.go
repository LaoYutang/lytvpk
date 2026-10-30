package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
)

const downloadTaskStoreVersion = 1
const downloadTaskStoreFileName = "download_tasks.json"

// persistedDownloadTransfer records only bytes that have been flushed to disk.
// FileName is a base name beneath the task's original rootDir/temp directory;
// the loader must reconstruct and validate the path before using it.
type persistedDownloadTransfer struct {
	Mode               string `json:"mode"`
	FileName           string `json:"file_name"`
	Validator          string `json:"validator,omitempty"`
	TotalSize          int64  `json:"total_size"`
	CheckpointBytes    int64  `json:"checkpoint_bytes,omitempty"`
	ContentDisposition string `json:"content_disposition,omitempty"`
	CompletedBlocks    []bool `json:"completed_blocks,omitempty"`
}

type persistedDownloadTask struct {
	Task     DownloadTask               `json:"task"`
	RootDir  string                     `json:"root_dir"`
	Transfer *persistedDownloadTransfer `json:"transfer,omitempty"`
}

type persistedDownloadTaskStore struct {
	Version int                     `json:"version"`
	Tasks   []persistedDownloadTask `json:"tasks"`
}

// Serializes writes in this process. Callers must snapshot the task map before
// invoking writeDownloadTaskStore, without holding taskManager.mu.
var downloadTaskStoreWriteMu sync.Mutex

func (a *App) downloadTaskStorePath() string {
	if a.configDir == "" {
		return ""
	}
	return filepath.Join(a.configDir, downloadTaskStoreFileName)
}

func (a *App) readDownloadTaskStore() ([]persistedDownloadTask, error) {
	path := a.downloadTaskStorePath()
	if path == "" {
		return []persistedDownloadTask{}, nil
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return []persistedDownloadTask{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read download tasks: %w", err)
	}
	var store persistedDownloadTaskStore
	if err := json.Unmarshal(data, &store); err != nil {
		return nil, fmt.Errorf("parse download tasks: %w", err)
	}
	if store.Version != downloadTaskStoreVersion {
		return nil, fmt.Errorf("unsupported download task store version %d", store.Version)
	}
	if store.Tasks == nil {
		return []persistedDownloadTask{}, nil
	}
	return store.Tasks, nil
}

func (a *App) writeDownloadTaskStore(tasks []persistedDownloadTask) error {
	path := a.downloadTaskStorePath()
	if path == "" {
		return nil
	}
	store := persistedDownloadTaskStore{Version: downloadTaskStoreVersion, Tasks: tasks}
	if store.Tasks == nil {
		store.Tasks = []persistedDownloadTask{}
	}
	data, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return fmt.Errorf("encode download tasks: %w", err)
	}

	downloadTaskStoreWriteMu.Lock()
	defer downloadTaskStoreWriteMu.Unlock()
	if err := os.MkdirAll(a.configDir, 0700); err != nil {
		return fmt.Errorf("create download task directory: %w", err)
	}
	tmp, err := os.CreateTemp(a.configDir, ".download_tasks-*.tmp")
	if err != nil {
		return fmt.Errorf("create download task temp file: %w", err)
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if err := tmp.Chmod(0600); err != nil {
		tmp.Close()
		return fmt.Errorf("set download task file permissions: %w", err)
	}
	if n, err := tmp.Write(data); err != nil || n != len(data) {
		tmp.Close()
		if err == nil {
			err = io.ErrShortWrite
		}
		return fmt.Errorf("write download tasks: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return fmt.Errorf("sync download tasks: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close download task temp file: %w", err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return fmt.Errorf("replace download task file: %w", err)
	}
	return nil
}
