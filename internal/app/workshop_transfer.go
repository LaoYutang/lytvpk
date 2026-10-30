package app

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

var errRangeMissingStrongETag = errors.New("range response lacks a strong ETag")
var errChunkResumeProbeNotConfirmed = errors.New("saved chunk download could not be verified")

func (a *App) probeChunkRange(ctx context.Context, downloadURL, bestIP, validator string, expectedTotal int64) (string, error) {
	transport := buildDownloadTransport(bestIP, downloadURL)
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport}
	req, err := http.NewRequestWithContext(ctx, "GET", downloadURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Range", "bytes=0-0")
	if validator != "" {
		req.Header.Set("If-Range", validator)
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Referer", "https://steamcommunity.com/")
	req.Header.Set("Accept-Encoding", "identity")
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if encoding := resp.Header.Get("Content-Encoding"); encoding != "" && !strings.EqualFold(encoding, "identity") {
		return "", fmt.Errorf("unsupported content encoding: %s", encoding)
	}
	if resp.StatusCode == http.StatusOK {
		return "", errRangeNotSupported
	}
	if resp.StatusCode != http.StatusPartialContent {
		return "", fmt.Errorf("range probe HTTP status: %d", resp.StatusCode)
	}
	start, end, total, err := parseByteContentRange(resp.Header.Get("Content-Range"))
	if err != nil || start != 0 || end != 0 || total != expectedTotal || (resp.ContentLength >= 0 && resp.ContentLength != 1) {
		return "", errRangeNotSupported
	}
	newValidator := strongETag(resp.Header)
	if newValidator == "" {
		return "", fmt.Errorf("%w: %w", errRangeNotSupported, errRangeMissingStrongETag)
	}
	if validator != "" && newValidator != validator {
		return "", errRangeNotSupported
	}
	return newValidator, nil
}

func (a *App) processChunkedDownload(ctx context.Context, task *DownloadTask, downloadURL string, bestIP string, totalSize int64, workerCount int, tempDir string) (string, error) {
	finalPath := filepath.Join(tempDir, task.ID+"_final")
	taskManager.mu.RLock()
	state := task.transfer
	taskManager.mu.RUnlock()
	if state != nil && state.mode == "chunk" && state.validator != "" && state.totalSize != totalSize {
		return "", fmt.Errorf("%w: file size differs from saved chunks", errChunkResumeProbeNotConfirmed)
	}
	if state != nil && (state.mode != "chunk" || state.validator == "") {
		if err := a.restartDownloadFromZero(task, "暂存文件无法安全续传，已从头重新下载"); err != nil {
			return "", err
		}
		state = nil
	}
	validator := ""
	if state != nil {
		validator = state.validator
	}
	probedValidator, err := a.probeChunkRange(ctx, downloadURL, bestIP, validator, totalSize)
	if err != nil {
		if state != nil && ctx.Err() == nil {
			return "", fmt.Errorf("%w: %v", errChunkResumeProbeNotConfirmed, err)
		}
		return "", err
	}

	var file *os.File
	if state != nil {
		file, err = os.OpenFile(finalPath, os.O_RDWR, 0600)
		if err == nil {
			var info os.FileInfo
			info, err = file.Stat()
			if err == nil && (info.Size() != totalSize || len(state.completedBlocks) != int((totalSize+5*1024*1024-1)/(5*1024*1024))) {
				err = fmt.Errorf("chunk state does not match temp file")
			}
		}
		if err != nil {
			if file != nil {
				file.Close()
			}
			if resetErr := a.restartDownloadFromZero(task, "暂存文件无法安全续传，已从头重新下载"); resetErr != nil {
				return "", resetErr
			}
			state = nil
		}
	}
	if state == nil {
		// Record a cleanup marker before preallocating the potentially large
		// file. A crash during creation then has a known, task-owned path.
		taskManager.mu.Lock()
		task.transfer = &downloadTransferState{mode: "chunk", tempPath: finalPath, validator: probedValidator, totalSize: totalSize}
		taskManager.mu.Unlock()
		a.emitDownloadTaskEvent("task_updated", task)
		file, err = createPreallocatedFile(finalPath, totalSize)
		if err != nil {
			return "", err
		}
	}
	defer file.Close()
	bm := NewBlockManager(totalSize, workerCount, 5*1024*1024)
	bm.validator = probedValidator
	defer bm.cancel()
	stopCancellationLink := context.AfterFunc(ctx, bm.cancel)
	defer stopCancellationLink()
	if state != nil {
		for i, completed := range state.completedBlocks {
			if completed {
				bm.blocks[i].SetStatus(blockStatusCompleted)
				bm.completedBlocks.Add(1)
				bm.completedBytes.Add(bm.blocks[i].EndByte - bm.blocks[i].StartByte + 1)
			}
		}
		bm.lastReportBytes.Store(bm.completedBytes.Load())
	}
	taskManager.mu.Lock()
	task.transfer = &downloadTransferState{mode: "chunk", tempPath: finalPath, validator: probedValidator, totalSize: totalSize}
	task.Notice = ""
	if state != nil {
		task.transfer.completedBlocks = append([]bool(nil), state.completedBlocks...)
	}
	taskManager.mu.Unlock()
	a.emitDownloadTaskEvent("task_updated", task)

	stopReporter := make(chan struct{})
	reporterDone := make(chan struct{})
	go func() { a.progressReporter(bm, task, stopReporter); close(reporterDone) }()
	var wg sync.WaitGroup
	for i := range workerCount {
		wg.Add(1)
		go func(id int) { defer wg.Done(); a.downloadWorker(id, bm, file, downloadURL, bestIP) }(i)
	}
	wg.Wait()
	close(stopReporter)
	<-reporterDone
	if err := file.Sync(); err != nil {
		return "", err
	}
	if err := file.Close(); err != nil {
		return "", err
	}
	if ctx.Err() != nil {
		completed := make([]bool, len(bm.blocks))
		for i, block := range bm.blocks {
			completed[i] = block.Status() == blockStatusCompleted
		}
		taskManager.mu.Lock()
		task.transfer.completedBlocks = completed
		task.DownloadedSize = bm.completedBytes.Load()
		task.Progress = int(100 * task.DownloadedSize / totalSize)
		taskManager.mu.Unlock()
		return "", ctx.Err()
	}
	if fatalErr := bm.HasFatalError(); fatalErr != nil {
		if errors.Is(fatalErr, errRangeNotSupported) {
			if resetErr := a.restartDownloadFromZero(task, "服务器未接受断点续传，已从头重新下载"); resetErr != nil {
				return "", resetErr
			}
		}
		return "", fatalErr
	}
	if bm.completedBlocks.Load() != int32(len(bm.blocks)) {
		return "", fmt.Errorf("incomplete chunked download")
	}
	stat, err := os.Stat(finalPath)
	if err != nil || stat.Size() != totalSize {
		return "", fmt.Errorf("final size mismatch for chunked download")
	}
	taskManager.mu.Lock()
	task.DownloadedSize = totalSize
	task.Progress = 100
	task.Speed = ""
	task.transfer.completedBlocks = make([]bool, len(bm.blocks))
	for i := range task.transfer.completedBlocks {
		task.transfer.completedBlocks[i] = true
	}
	taskManager.mu.Unlock()
	a.emitDownloadTaskEvent("task_progress", task)
	return finalPath, nil
}

// getFileSize gets file size via HEAD request
func (a *App) getFileSize(ctx context.Context, downloadUrl string, bestIP string) int64 {
	transport := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   10 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		TLSHandshakeTimeout: 10 * time.Second,
	}

	if bestIP != "" {
		dialer := &net.Dialer{
			Timeout:   10 * time.Second,
			KeepAlive: 30 * time.Second,
		}
		transport.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, port, _ := net.SplitHostPort(addr)
			u, parseErr := url.Parse(downloadUrl)
			if parseErr == nil && u.Hostname() == host {
				return dialer.DialContext(ctx, network, net.JoinHostPort(bestIP, port))
			}
			return dialer.DialContext(ctx, network, addr)
		}
	}

	client := &http.Client{
		Transport: transport,
		Timeout:   15 * time.Second,
	}

	req, err := http.NewRequestWithContext(ctx, "HEAD", downloadUrl, nil)
	if err != nil {
		return 0
	}

	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
	req.Header.Set("Referer", "https://steamcommunity.com/")

	resp, err := client.Do(req)
	if err != nil {
		return 0
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusPartialContent {
		return resp.ContentLength
	}

	return 0
}

// downloadPreviewImage downloads preview image for the task
func (a *App) downloadPreviewImage(task *DownloadTask, targetPath string) {
	if task.PreviewUrl == "" {
		return
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(task.PreviewUrl)
	if err != nil {
		return
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return
	}

	// 根据实际内容格式确定扩展名
	imgExt := ".jpg"
	_, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err == nil {
		switch format {
		case "png":
			imgExt = ".png"
		case "gif":
			imgExt = ".gif"
		case "jpeg":
			imgExt = ".jpg"
		}
	}

	vpkExt := filepath.Ext(targetPath)
	imgPath := strings.TrimSuffix(targetPath, vpkExt) + imgExt

	out, err := os.Create(imgPath)
	if err != nil {
		return
	}
	defer out.Close()

	out.Write(data)
}

// handleArchiveExtraction handles auto extraction for archive files
func (a *App) handleArchiveExtraction(task *DownloadTask, targetPath string, downloadRoot string, updateStatus func(string, string)) {
	ext := strings.ToLower(filepath.Ext(targetPath))
	if strings.HasPrefix(task.WorkshopID, "direct-") && (ext == ".zip" || ext == ".rar" || ext == ".7z") {
		updateStatus("downloading", "正在解压...")
		err := a.ExtractVPKFromArchive(targetPath, downloadRoot)
		if err != nil {
			fmt.Printf("解压压缩包失败: %v\n", err)
		} else {
			if err := os.Remove(targetPath); err != nil {
				fmt.Printf("删除压缩文件失败: %v\n", err)
			} else {
				fmt.Printf("已删除压缩文件: %s\n", targetPath)
			}
		}
	}
}
