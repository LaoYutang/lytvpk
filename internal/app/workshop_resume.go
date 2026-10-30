package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

func strongETag(h http.Header) string {
	etag := strings.TrimSpace(h.Get("ETag"))
	if len(etag) < 2 || etag[0] != '"' || etag[len(etag)-1] != '"' || strings.HasPrefix(strings.ToLower(etag), "w/") {
		return ""
	}
	return etag
}

// parseByteContentRange accepts only a concrete byte range and total size.
func parseByteContentRange(value string) (start, end, total int64, err error) {
	if !strings.HasPrefix(value, "bytes ") {
		return 0, 0, 0, fmt.Errorf("invalid Content-Range: %q", value)
	}
	parts := strings.SplitN(strings.TrimPrefix(value, "bytes "), "/", 2)
	if len(parts) != 2 {
		return 0, 0, 0, fmt.Errorf("invalid Content-Range: %q", value)
	}
	span := strings.SplitN(parts[0], "-", 2)
	if len(span) != 2 {
		return 0, 0, 0, fmt.Errorf("invalid Content-Range: %q", value)
	}
	start, err = strconv.ParseInt(span[0], 10, 64)
	if err != nil {
		return
	}
	end, err = strconv.ParseInt(span[1], 10, 64)
	if err != nil {
		return
	}
	total, err = strconv.ParseInt(parts[1], 10, 64)
	if err != nil {
		return
	}
	if start < 0 || end < start || total <= end {
		err = fmt.Errorf("invalid Content-Range: %q", value)
	}
	return
}

func (a *App) restartDownloadFromZero(task *DownloadTask, reason string) error {
	a.downloadPersistMu.Lock()
	taskManager.mu.Lock()
	if task.transfer != nil {
		if err := os.Remove(task.transfer.tempPath); err != nil && !os.IsNotExist(err) {
			taskManager.mu.Unlock()
			a.downloadPersistMu.Unlock()
			return fmt.Errorf("remove stale download temp: %w", err)
		}
		task.transfer = nil
	}
	task.DownloadedSize = 0
	task.Progress = 0
	task.Speed = ""
	task.Notice = reason
	taskManager.mu.Unlock()
	err := a.writeDownloadTaskStore(a.snapshotDownloadTasks())
	a.downloadPersistMu.Unlock()
	a.emitDownloadTaskEvent("task_updated", task)
	return err
}

func (a *App) resetOpenSingleDownload(task *DownloadTask, out *os.File, reason string) error {
	a.downloadPersistMu.Lock()
	if err := out.Truncate(0); err != nil {
		a.downloadPersistMu.Unlock()
		return err
	}
	if _, err := out.Seek(0, io.SeekStart); err != nil {
		a.downloadPersistMu.Unlock()
		return err
	}
	taskManager.mu.Lock()
	task.transfer = &downloadTransferState{mode: "single", tempPath: out.Name()}
	task.DownloadedSize = 0
	task.Progress = 0
	task.Speed = ""
	task.Notice = reason
	taskManager.mu.Unlock()
	err := a.writeDownloadTaskStore(a.snapshotDownloadTasks())
	a.downloadPersistMu.Unlock()
	a.emitDownloadTaskEvent("task_updated", task)
	return err
}

func (a *App) downloadSingle(ctx context.Context, task *DownloadTask, downloadURL, bestIP, tempDir string) (string, string, error) {
	tempPath := filepath.Join(tempDir, task.ID+"_single")
	taskManager.mu.RLock()
	state := task.transfer
	taskManager.mu.RUnlock()
	if state != nil && state.mode != "single" {
		if err := a.restartDownloadFromZero(task, "下载方式已切换，旧分块暂存文件无法继续使用，已从头重新下载"); err != nil {
			return "", "", err
		}
		state = nil
	}
	out, err := os.OpenFile(tempPath, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return "", "", err
	}
	defer out.Close()
	if state != nil && state.validator == "" {
		if err := a.resetOpenSingleDownload(task, out, "服务器未提供可验证的文件标识，已从头重新下载"); err != nil {
			return "", "", err
		}
		state = nil
	}
	var offset int64
	if state != nil {
		info, statErr := out.Stat()
		if statErr != nil {
			return "", "", statErr
		}
		if info.Size() > 0 && (state.totalSize == 0 || info.Size() < state.totalSize) {
			offset = info.Size()
		} else if info.Size() == 0 {
			state = nil
		} else {
			if err := a.resetOpenSingleDownload(task, out, "暂存文件无法安全续传，已从头重新下载"); err != nil {
				return "", "", err
			}
			state = nil
		}
	}
	if offset == 0 {
		if err := out.Truncate(0); err != nil {
			return "", "", err
		}
		if _, err := out.Seek(0, io.SeekStart); err != nil {
			return "", "", err
		}
	}
	taskManager.mu.Lock()
	task.transfer = &downloadTransferState{mode: "single", tempPath: tempPath}
	if state != nil {
		*task.transfer = *state
	}
	task.transfer.responseConfirmed = false
	taskManager.mu.Unlock()
	a.emitDownloadTaskEvent("task_updated", task)

	transport := buildDownloadTransport(bestIP, downloadURL)
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport}
	var resp *http.Response
	for {
		for attempt := 0; attempt < 3; attempt++ {
			if attempt > 0 {
				timer := time.NewTimer(2 * time.Second)
				select {
				case <-ctx.Done():
					timer.Stop()
					return "", "", ctx.Err()
				case <-timer.C:
				}
			}
			req, reqErr := http.NewRequestWithContext(ctx, "GET", downloadURL, nil)
			if reqErr != nil {
				return "", "", reqErr
			}
			req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
			req.Header.Set("Referer", "https://steamcommunity.com/")
			req.Header.Set("Accept", "*/*")
			req.Header.Set("Accept-Encoding", "identity")
			if offset > 0 && state.validator != "" {
				req.Header.Set("Range", fmt.Sprintf("bytes=%d-", offset))
				req.Header.Set("If-Range", state.validator)
			}
			resp, reqErr = client.Do(req)
			if reqErr != nil {
				if ctx.Err() != nil {
					return "", "", ctx.Err()
				}
				if attempt == 2 {
					return "", "", reqErr
				}
				continue
			}
			if resp.StatusCode == http.StatusOK || (offset > 0 && state.validator != "" && resp.StatusCode == http.StatusPartialContent) {
				break
			}
			resp.Body.Close()
			if resp.StatusCode == http.StatusNotFound || attempt == 2 {
				return "", "", fmt.Errorf("HTTP status: %d", resp.StatusCode)
			}
		}
		if err := ctx.Err(); err != nil {
			resp.Body.Close()
			return "", "", err
		}
		if encoding := resp.Header.Get("Content-Encoding"); encoding != "" && !strings.EqualFold(encoding, "identity") {
			resp.Body.Close()
			return "", "", fmt.Errorf("unsupported content encoding: %s", encoding)
		}
		contentType, _, _ := mime.ParseMediaType(resp.Header.Get("Content-Type"))
		if contentType == "text/html" || contentType == "application/json" {
			resp.Body.Close()
			return "", "", fmt.Errorf("invalid content type: %s", contentType)
		}
		break
	}
	defer resp.Body.Close()

	if offset > 0 && state.validator != "" && resp.StatusCode == http.StatusOK {
		// The server ignored Range or If-Range rejected a changed file.
		if err := a.resetOpenSingleDownload(task, out, "服务器未接受断点续传，已从头重新下载"); err != nil {
			return "", "", err
		}
		offset = 0
	}

	var total int64
	if resp.StatusCode == http.StatusPartialContent {
		start, end, contentTotal, rangeErr := parseByteContentRange(resp.Header.Get("Content-Range"))
		if rangeErr != nil || start != offset || (state.totalSize > 0 && contentTotal != state.totalSize) || (resp.ContentLength >= 0 && resp.ContentLength != end-start+1) || strongETag(resp.Header) != state.validator {
			return "", "", fmt.Errorf("server returned an inconsistent byte range")
		}
		total = contentTotal
		if _, err := out.Seek(offset, io.SeekStart); err != nil {
			return "", "", err
		}
	} else if resp.ContentLength >= 0 {
		total = resp.ContentLength
	}
	if total == 0 {
		taskManager.mu.RLock()
		total = task.TotalSize
		taskManager.mu.RUnlock()
	}
	taskManager.mu.Lock()
	task.TotalSize = total
	task.transfer.validator = strongETag(resp.Header)
	task.transfer.totalSize = total
	task.transfer.responseConfirmed = true
	if cd := resp.Header.Get("Content-Disposition"); cd != "" {
		task.transfer.contentDisposition = cd
	}
	contentDisposition := task.transfer.contentDisposition
	taskManager.mu.Unlock()
	a.emitDownloadTaskEvent("task_updated", task)

	counter := &TaskWriteCounter{App: a, Task: task, Total: total, Current: offset, LastBytes: offset, LastTime: time.Now()}
	if _, err := io.Copy(out, io.TeeReader(resp.Body, counter)); err != nil {
		if ctx.Err() != nil || errors.Is(err, context.Canceled) {
			return "", "", ctx.Err()
		}
		return "", "", err
	}
	if err := out.Sync(); err != nil {
		return "", "", err
	}
	info, err := out.Stat()
	if err != nil {
		return "", "", err
	}
	if total > 0 && info.Size() != total {
		return "", "", fmt.Errorf("download size mismatch: expected %d, got %d", total, info.Size())
	}
	if ctx.Err() != nil {
		return "", "", ctx.Err()
	}
	taskManager.mu.Lock()
	task.DownloadedSize = info.Size()
	task.Progress = 100
	task.Speed = ""
	taskManager.mu.Unlock()
	a.emitDownloadTaskEvent("task_progress", task)
	return tempPath, contentDisposition, nil
}
