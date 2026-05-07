package app

import (
	"bytes"
	"context"
	"crypto/md5"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"vpk-manager/internal/network"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func (a *App) StartDownloadTask(details WorkshopFileDetails, useOptimizedIP bool) string {
	taskID := fmt.Sprintf("%d", time.Now().UnixNano())

	totalSize := parseFileSize(details.FileSize)

	// Clean filename
	filename := cleanFilename(details.Filename)

	// If it's a workshop download (not direct), use the ID as filename
	if !strings.HasPrefix(details.PublishedFileId, "direct-") {
		ext := filepath.Ext(filename)
		filename = fmt.Sprintf("%s%s", details.PublishedFileId, ext)
	}

	// If it's a direct download, use the cleaned filename as title
	title := details.Title
	if strings.HasPrefix(details.PublishedFileId, "direct-") {
		title = filename
	}

	// Create cancellable context
	ctx, cancel := context.WithCancel(context.Background())

	task := &DownloadTask{
		ID:             taskID,
		WorkshopID:     details.PublishedFileId,
		Title:          title,
		Filename:       filename,
		PreviewUrl:     details.PreviewUrl,
		FileUrl:        details.FileUrl,
		Description:    details.Description,
		UseOptimizedIP: useOptimizedIP,
		Status:         "pending",
		Progress:       0,
		TotalSize:      totalSize,
		CreatedAt:      time.Now().Format("2006-01-02 15:04:05"),
		cancelFunc:     cancel,
	}

	taskManager.mu.Lock()
	taskManager.tasks[taskID] = task
	taskManager.mu.Unlock()

	go a.processDownloadTask(ctx, task, details.FileUrl)

	return taskID
}

func (a *App) processDownloadTask(ctx context.Context, task *DownloadTask, downloadUrl string) {
	updateStatus := func(status string, err string) {
		taskManager.mu.Lock()
		task.Status = status
		task.Error = err
		taskManager.mu.Unlock()
		runtime.EventsEmit(a.ctx, "task_updated", task)
	}

	updateStatus("downloading", "")

	if a.rootDir == "" {
		updateStatus("failed", "Root directory not set")
		return
	}

	if downloadUrl == "" {
		updateStatus("failed", "Download URL is empty")
		return
	}

	// IP Optimization
	var bestIP string
	// Check global preferred IP setting
	if a.GetWorkshopPreferredIP() {
		task.UseOptimizedIP = true
	}

	if task.UseOptimizedIP {
		updateStatus("selecting_ip", "")
		// 使用 proxy.go 相同的优选IP获取逻辑
		bestIP = network.GlobalIPSelector.GetCachedBestIP()
		// 如果缓存没有，则重新获取
		if bestIP == "" {
			bestIP = network.GlobalIPSelector.GetBestIP(downloadUrl)
		}
		updateStatus("downloading", "")
	}

	// Ensure temp directory exists
	tempDir := filepath.Join(a.rootDir, "temp")
	if err := os.MkdirAll(tempDir, 0755); err != nil {
		updateStatus("failed", "Failed to create temp dir: "+err.Error())
		return
	}

	// First, try to get file size via HEAD request for chunked download decision
	totalSize := task.TotalSize
	if totalSize == 0 {
		totalSize = a.getFileSize(ctx, downloadUrl, bestIP)
		if totalSize > 0 {
			taskManager.mu.Lock()
			task.TotalSize = totalSize
			taskManager.mu.Unlock()
			runtime.EventsEmit(a.ctx, "task_updated", task)
		}
	}

	// Calculate optimal thread count based on file size (max 8 threads)
	threadCount := network.CalculateThreadCount(totalSize, 8)

	// Use chunked download if multiple threads are needed
	if threadCount > 1 && totalSize > 0 {
		fmt.Printf("[Download] Using %d-thread download for %s (Size: %.2f MB)\n",
			threadCount, task.Filename, float64(totalSize)/1024/1024)

		finalPath, err := a.processChunkedDownload(ctx, task, downloadUrl, bestIP, totalSize, threadCount, tempDir)
		if err != nil {
			// Check if server does not support Range, fallback to single-thread
			if errors.Is(err, errRangeNotSupported) {
				fmt.Printf("[Download] Server does not support Range, falling back to single-thread download\n")
				// Continue to single-thread download below
			} else if ctx.Err() != nil {
				updateStatus("cancelled", "Cancelled by user")
				return
			} else {
				updateStatus("failed", err.Error())
				return
			}
		} else {
			// Chunked download succeeded
			targetPath := filepath.Join(a.rootDir, filepath.Base(task.Filename))

			// For direct downloads, use timestamp for uniqueness
			if strings.HasPrefix(task.WorkshopID, "direct-") {
				ext := filepath.Ext(task.Filename)
				ms := time.Now().UnixNano() / int64(time.Millisecond)
				newFilename := fmt.Sprintf("%d%s", ms, ext)
				taskManager.mu.Lock()
				task.Filename = newFilename
				taskManager.mu.Unlock()
				targetPath = filepath.Join(a.rootDir, newFilename)
				runtime.EventsEmit(a.ctx, "task_updated", task)
			}

			if err := os.Rename(finalPath, targetPath); err != nil {
				updateStatus("failed", "Rename failed: "+err.Error())
				return
			}

			// Download preview image
			a.downloadPreviewImage(task, targetPath)

			// Auto extract for archives
			a.handleArchiveExtraction(task, targetPath, updateStatus)

			// Save meta file
			if a.workshopMetaEnabled {
				metaDetails := WorkshopFileDetails{
					PublishedFileId: task.WorkshopID,
					Title:           task.Title,
					PreviewUrl:      task.PreviewUrl,
					FileUrl:         task.FileUrl,
					Description:     task.Description,
				}
				SaveWorkshopMeta(targetPath, metaDetails)
			}

			updateStatus("completed", "")
			return
		}
	}

	// Single-thread download (fallback or small files)
	fmt.Printf("[Download] Using single-thread download for %s\n", task.Filename)

	// Generate hash for temp filename
	hashInput := fmt.Sprintf("%s-%d", task.Filename, time.Now().UnixNano())
	hash := md5.Sum([]byte(hashInput))
	tempFileName := hex.EncodeToString(hash[:])
	tempPath := filepath.Join(tempDir, tempFileName)

	targetPath := filepath.Join(a.rootDir, filepath.Base(task.Filename))

	out, err := os.Create(tempPath)
	if err != nil {
		updateStatus("failed", err.Error())
		return
	}

	// Ensure cleanup on failure or cancellation
	defer func() {
		out.Close()
		taskManager.mu.RLock()
		status := task.Status
		taskManager.mu.RUnlock()
		if status == "failed" || status == "cancelled" {
			os.Remove(tempPath)
		}
	}()

	// Use a transport with timeouts and keep-alive
	transport := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   30 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          100,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   15 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		ResponseHeaderTimeout: 60 * time.Second, // Increased timeout
	}

	if task.UseOptimizedIP {
		if bestIP != "" {
			dialer := &net.Dialer{
				Timeout:   30 * time.Second,
				KeepAlive: 30 * time.Second,
			}
			transport.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
				host, port, _ := net.SplitHostPort(addr)

				// Check if the host matches the download URL's host
				u, parseErr := url.Parse(downloadUrl)
				if parseErr == nil && u.Hostname() == host {
					return dialer.DialContext(ctx, network, net.JoinHostPort(bestIP, port))
				}
				return dialer.DialContext(ctx, network, addr)
			}
			fmt.Printf("[Download] Using optimized IP: %s for %s\n", bestIP, downloadUrl)
		}
	}

	client := &http.Client{
		Transport: transport,
		Timeout:   0, // No global timeout for large downloads
	}

	var resp *http.Response
	var reqErr error
	maxRetries := 3

	// Retry loop
	for i := 0; i < maxRetries; i++ {
		// Check for cancellation before retry
		select {
		case <-ctx.Done():
			updateStatus("cancelled", "Cancelled by user")
			out.Close()
			os.Remove(tempPath)
			return
		default:
		}

		if i > 0 {
			time.Sleep(2 * time.Second)
			fmt.Printf("[Download] Retrying task %s (%d/%d)...\n", task.ID, i+1, maxRetries)
		}

		var req *http.Request
		req, err = http.NewRequestWithContext(ctx, "GET", downloadUrl, nil)
		if err != nil {
			updateStatus("failed", err.Error())
			return
		}
		// Updated User-Agent
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
		req.Header.Set("Referer", "https://steamcommunity.com/")
		req.Header.Set("Accept", "*/*")

		resp, reqErr = client.Do(req)
		if reqErr == nil {
			if resp.StatusCode == http.StatusOK {
				break // Success
			}
			// If status is not OK, close body and retry if it's a server error
			resp.Body.Close()
			reqErr = fmt.Errorf("HTTP status: %d", resp.StatusCode)

			// Don't retry on 404
			if resp.StatusCode == http.StatusNotFound {
				break
			}
		} else {
			// Check if error is due to cancellation
			if ctx.Err() != nil {
				updateStatus("cancelled", "Cancelled by user")
				out.Close()
				os.Remove(tempPath)
				return
			}
		}
	}

	if reqErr != nil {
		updateStatus("failed", reqErr.Error())
		return
	}
	defer resp.Body.Close()

	// Try to get filename from Content-Disposition
	cd := resp.Header.Get("Content-Disposition")
	if cd != "" {
		if _, params, mimeErr := mime.ParseMediaType(cd); mimeErr == nil {
			if filename, ok := params["filename"]; ok && filename != "" {
				// Clean filename
				filename = cleanFilename(filename)

				// If it's a workshop download (not direct), use the ID as filename
				if !strings.HasPrefix(task.WorkshopID, "direct-") {
					ext := filepath.Ext(filename)
					filename = fmt.Sprintf("%s%s", task.WorkshopID, ext)
				}

				// Update task filename if it was unknown or we want to prefer server filename
				// For now, let's update it if the current one is "unknown.vpk" or similar
				// Or if we are in direct download mode
				if strings.HasPrefix(task.WorkshopID, "direct-") || strings.HasPrefix(task.Filename, "unknown") {
					taskManager.mu.Lock()
					task.Filename = filename
					// Also update title for direct downloads
					if strings.HasPrefix(task.WorkshopID, "direct-") {
						task.Title = filename
					}
					taskManager.mu.Unlock()
					// Update target path
					targetPath = filepath.Join(a.rootDir, filename)
					runtime.EventsEmit(a.ctx, "task_updated", task)
				}
			}
		}
	}

	// If filename is still unknown/generic, use timestamp
	if task.Filename == "unknown.vpk" || task.Filename == "" {
		newFilename := fmt.Sprintf("unknown_%d.vpk", time.Now().Unix())
		taskManager.mu.Lock()
		task.Filename = newFilename
		taskManager.mu.Unlock()
		targetPath = filepath.Join(a.rootDir, newFilename)
		runtime.EventsEmit(a.ctx, "task_updated", task)
	}

	// Check Content-Type
	contentType := resp.Header.Get("Content-Type")
	if contentType != "" && (contentType == "text/html" || contentType == "application/json") {
		updateStatus("failed", fmt.Sprintf("Invalid content type: %s", contentType))
		return
	}

	// Determine total size
	if totalSize == 0 && resp.ContentLength > 0 {
		totalSize = resp.ContentLength
		// Update task info
		taskManager.mu.Lock()
		task.TotalSize = totalSize
		taskManager.mu.Unlock()
		runtime.EventsEmit(a.ctx, "task_updated", task)
	}

	// Progress tracking
	counter := &TaskWriteCounter{
		Task:     task,
		Ctx:      a.ctx,
		Total:    totalSize,
		LastTime: time.Now(),
	}

	// Use a buffer for copying to reduce syscalls and lock contention
	// But io.Copy already uses a buffer (32KB)
	if _, err = io.Copy(out, io.TeeReader(resp.Body, counter)); err != nil {
		out.Close()
		// Check if error is due to cancellation
		if ctx.Err() != nil || errors.Is(err, context.Canceled) {
			updateStatus("cancelled", "Cancelled by user")
			os.Remove(tempPath)
		} else {
			updateStatus("failed", err.Error())
		}
		return
	}

	out.Close() // Close before rename

	// For direct downloads, ALWAYS use timestamp to ensure uniqueness
	if strings.HasPrefix(task.WorkshopID, "direct-") {
		// Use timestamp with ms
		ext := filepath.Ext(task.Filename)
		ms := time.Now().UnixNano() / int64(time.Millisecond)
		newFilename := fmt.Sprintf("%d%s", ms, ext)

		taskManager.mu.Lock()
		task.Filename = newFilename
		// task.Title = newFilename // Keep original title for readability
		taskManager.mu.Unlock()

		targetPath = filepath.Join(a.rootDir, newFilename)
		runtime.EventsEmit(a.ctx, "task_updated", task)
	}

	// Rename to final
	if err := os.Rename(tempPath, targetPath); err != nil {
		updateStatus("failed", "Rename failed: "+err.Error())
		return
	}

	// 尝试下载预览图作为同名文件
	if task.PreviewUrl != "" {
		// 同步下载图片，确保任务完成时图片已就绪
		// 设置较短的超时，避免长时间阻塞
		func(url, vpkPath string) {
			client := &http.Client{
				Timeout: 10 * time.Second,
			}
			resp, err := client.Get(url)
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

			vpkExt := filepath.Ext(vpkPath)
			imgPath := strings.TrimSuffix(vpkPath, vpkExt) + imgExt

			out, err := os.Create(imgPath)
			if err != nil {
				return
			}
			defer out.Close()

			out.Write(data)
		}(task.PreviewUrl, targetPath)
	}

	// Save meta file
	if a.workshopMetaEnabled {
		metaDetails := WorkshopFileDetails{
			PublishedFileId: task.WorkshopID,
			Title:           task.Title,
			PreviewUrl:      task.PreviewUrl,
			FileUrl:         task.FileUrl,
			Description:     task.Description,
		}
		SaveWorkshopMeta(targetPath, metaDetails)
	}

	// 如果是直连下载且是压缩文件，自动解压
	ext := strings.ToLower(filepath.Ext(targetPath))
	if strings.HasPrefix(task.WorkshopID, "direct-") && (ext == ".zip" || ext == ".rar" || ext == ".7z") {
		updateStatus("downloading", "正在解压...")
		err := a.ExtractVPKFromArchive(targetPath, a.rootDir)
		if err != nil {
			// 解压失败不影响下载成功的状态，但记录错误
			fmt.Printf("解压压缩包失败: %v\n", err)
		} else {
			// 解压成功，删除压缩文件
			if err := os.Remove(targetPath); err != nil {
				fmt.Printf("删除压缩文件失败: %v\n", err)
			} else {
				fmt.Printf("已删除压缩文件: %s\n", targetPath)
			}
		}
	}

	updateStatus("completed", "")
}
