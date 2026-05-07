package app

import (
	"bytes"
	"context"
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

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func (a *App) processChunkedDownload(ctx context.Context, task *DownloadTask, downloadUrl string, bestIP string, totalSize int64, workerCount int, tempDir string) (string, error) {
	finalPath := filepath.Join(tempDir, task.ID+"_final")

	// 1. Preallocate final file
	file, err := createPreallocatedFile(finalPath, totalSize)
	if err != nil {
		return "", err
	}

	// 2. Create BlockManager with 5MB blocks
	bm := NewBlockManager(totalSize, workerCount, 5*1024*1024)

	// 3. Link external context cancellation to BlockManager
	go func() {
		<-ctx.Done()
		bm.cancel()
	}()

	fmt.Printf("[ChunkedDownload] Starting dynamic %d-worker download for %s (Size: %.2f MB, Blocks: %d)\n",
		workerCount, task.Filename, float64(totalSize)/1024/1024, len(bm.blocks))

	// 4. Start progress reporter
	stopReporter := make(chan struct{})
	go a.progressReporter(bm, task, stopReporter)

	// 5. Start workers
	var wg sync.WaitGroup
	for i := range workerCount {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			a.downloadWorker(id, bm, file, downloadUrl, bestIP)
		}(i)
	}

	// 6. Wait for all workers to finish
	wg.Wait()
	close(stopReporter)

	// 7. Close file
	file.Close()

	// 8. Check for cancellation
	if ctx.Err() != nil {
		os.Remove(finalPath)
		return "", ctx.Err()
	}

	// 9. Check for fatal errors
	if fatalErr := bm.HasFatalError(); fatalErr != nil {
		os.Remove(finalPath)
		return "", fatalErr
	}

	// 10. Verify final file size
	stat, err := os.Stat(finalPath)
	if err != nil || stat.Size() != totalSize {
		os.Remove(finalPath)
		return "", fmt.Errorf("final size mismatch: expected %d, got %d", totalSize, stat.Size())
	}

	// 11. Emit final progress
	taskManager.mu.Lock()
	task.DownloadedSize = totalSize
	task.Progress = 100
	taskManager.mu.Unlock()
	runtime.EventsEmit(a.ctx, "task_progress", task)

	fmt.Printf("[ChunkedDownload] Successfully downloaded %s with dynamic workers\n", task.Filename)

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
func (a *App) handleArchiveExtraction(task *DownloadTask, targetPath string, updateStatus func(string, string)) {
	ext := strings.ToLower(filepath.Ext(targetPath))
	if strings.HasPrefix(task.WorkshopID, "direct-") && (ext == ".zip" || ext == ".rar" || ext == ".7z") {
		updateStatus("downloading", "正在解压...")
		err := a.ExtractVPKFromArchive(targetPath, a.rootDir)
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
