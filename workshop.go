package main

import (
	"bytes"
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type WorkshopChild struct {
	PublishedFileId string `json:"publishedfileid"`
	SortOrder       int    `json:"sortorder"`
	FileType        int    `json:"file_type"`
}

type WorkshopFileDetails struct {
	Result          int    `json:"result"`
	PublishedFileId string `json:"publishedfileid"`
	Creator         string `json:"creator"`
	Filename        string `json:"filename"`
	FileSize        string `json:"file_size"`
	FileUrl         string `json:"file_url"`
	PreviewUrl      string `json:"preview_url"`
	Previews        []struct {
		PreviewUrl  string `json:"preview_url"`
		PreviewType int    `json:"preview_type"`
	} `json:"previews"`
	Title       string          `json:"title"`
	Description string          `json:"file_description"`
	Children    []WorkshopChild `json:"children"`
}

type DownloadTask struct {
	ID             string             `json:"id"`
	WorkshopID     string             `json:"workshop_id"`
	Title          string             `json:"title"`
	Filename       string             `json:"filename"`
	PreviewUrl     string             `json:"preview_url"`
	FileUrl        string             `json:"file_url"` // Added for retry
	UseOptimizedIP bool               `json:"use_optimized_ip"`
	Status         string             `json:"status"` // "pending", "downloading", "completed", "failed", "cancelled"
	Progress       int                `json:"progress"`
	TotalSize      int64              `json:"total_size"`
	DownloadedSize int64              `json:"downloaded_size"`
	Speed          string             `json:"speed"`
	Error          string             `json:"error"`
	CreatedAt      string             `json:"created_at"`
	cancelFunc     context.CancelFunc `json:"-"`
}

// ChunkDownload represents a single chunk for parallel download
type ChunkDownload struct {
	Index      int    `json:"index"`      // Chunk index (0-based)
	StartByte  int64  `json:"start_byte"` // Start byte position
	EndByte    int64  `json:"end_byte"`   // End byte position (inclusive)
	Status     string `json:"status"`     // "pending", "downloading", "completed", "failed"
	Retries    int    `json:"retries"`    // Number of retries attempted
	Downloaded int64  `json:"downloaded"` // Bytes downloaded for this chunk
	TempFile   string `json:"temp_file"`  // Temporary file path for this chunk
	Error      string `json:"error"`      // Error message if failed
}

// ChunkManager manages all chunks for a parallel download
type ChunkManager struct {
	Chunks      []*ChunkDownload
	TotalSize   int64
	ChunkCount  int
	Completed   int64 // Total bytes completed (atomic)
	ActiveCount int32 // Number of active chunks (atomic)
	FailedCount int32 // Number of failed chunks (atomic)
	mu          sync.Mutex
}

// TaskManager manages download tasks
type TaskManager struct {
	tasks map[string]*DownloadTask
	mu    sync.RWMutex
}

var taskManager = &TaskManager{
	tasks: make(map[string]*DownloadTask),
}

// HasActiveDownloads checks if there are any active downloads
func (a *App) HasActiveDownloads() bool {
	taskManager.mu.RLock()
	defer taskManager.mu.RUnlock()

	for _, task := range taskManager.tasks {
		if task.Status == "downloading" || task.Status == "pending" {
			return true
		}
	}
	return false
}

// CancelDownloadTask cancels a download task
func (a *App) CancelDownloadTask(taskID string) {
	taskManager.mu.Lock()
	task, exists := taskManager.tasks[taskID]
	if exists && task.cancelFunc != nil && (task.Status == "pending" || task.Status == "downloading") {
		task.cancelFunc()
		task.Status = "cancelled"
		task.Error = "Cancelled by user"
	}
	taskManager.mu.Unlock()

	if exists {
		runtime.EventsEmit(a.ctx, "task_updated", task)
	}
}

// RetryDownloadTask retries a failed or cancelled task
func (a *App) RetryDownloadTask(taskID string) {
	taskManager.mu.Lock()
	task, exists := taskManager.tasks[taskID]
	taskManager.mu.Unlock()

	if !exists {
		return
	}

	// Only retry if failed or cancelled
	if task.Status != "failed" && task.Status != "cancelled" {
		return
	}

	// Reset task state
	taskManager.mu.Lock()
	task.Status = "pending"
	task.Progress = 0
	task.DownloadedSize = 0
	task.Error = ""
	task.Speed = ""

	// Create new context
	ctx, cancel := context.WithCancel(context.Background())
	task.cancelFunc = cancel
	taskManager.mu.Unlock()

	runtime.EventsEmit(a.ctx, "task_updated", task)

	go a.processDownloadTask(ctx, task, task.FileUrl)
}

func parseFileSize(sizeStr string) int64 {
	// Try parsing as simple integer
	if s, err := strconv.ParseInt(sizeStr, 10, 64); err == nil {
		return s
	}

	// Try parsing "123 MB" etc. (Simple implementation)
	// This is just a fallback, usually API returns bytes
	return 0
}

// ParseWorkshopID extracts the ID from a Steam Workshop URL
func (a *App) ParseWorkshopID(workshopUrl string) (string, error) {
	u, err := url.Parse(workshopUrl)
	if err != nil {
		return "", fmt.Errorf("invalid URL")
	}

	q := u.Query()
	id := q.Get("id")
	if id != "" {
		return id, nil
	}

	// Fallback regex if URL structure is different or just ID provided
	re := regexp.MustCompile(`\d+`)
	matches := re.FindStringSubmatch(workshopUrl)
	if len(matches) > 0 {
		return matches[0], nil
	}

	return "", fmt.Errorf("could not find ID in URL")
}

// GetWorkshopDetails fetches details from steamworkshopdownloader.io
func (a *App) GetWorkshopDetails(workshopUrl string) ([]WorkshopFileDetails, error) {
	id, err := a.ParseWorkshopID(workshopUrl)
	if err != nil {
		return nil, err
	}

	payload := fmt.Sprintf(`[%s]`, id)
	details, err := a.fetchWorkshopDetails(payload)
	if err != nil {
		return nil, err
	}

	if len(details) == 0 {
		return nil, fmt.Errorf("no details found")
	}

	// Check if it's a collection (has children)
	if len(details[0].Children) > 0 {
		var childIDs []string
		for _, child := range details[0].Children {
			childIDs = append(childIDs, child.PublishedFileId)
		}

		// Fetch details for all children
		childPayload := "[" + strings.Join(childIDs, ",") + "]"
		childrenDetails, err := a.fetchWorkshopDetails(childPayload)
		if err != nil {
			return nil, fmt.Errorf("failed to fetch children details: %v", err)
		}

		// If the parent item is also a valid file, include it
		if details[0].Result == 1 {
			childrenDetails = append([]WorkshopFileDetails{details[0]}, childrenDetails...)
		}

		return a.processDetails(childrenDetails)
	}

	return a.processDetails(details)
}

func (a *App) fetchWorkshopDetails(payload string) ([]WorkshopFileDetails, error) {
	apiUrl := "https://l4d2-workshop-parse.laoyutang.cn"

	req, err := http.NewRequest("POST", apiUrl, bytes.NewBuffer([]byte(payload)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36")

	client := &http.Client{
		Timeout: 30 * time.Second,
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API request failed with status: %d", resp.StatusCode)
	}

	var details []WorkshopFileDetails
	if err := json.NewDecoder(resp.Body).Decode(&details); err != nil {
		return nil, err
	}

	return details, nil
}

func (a *App) processDetails(details []WorkshopFileDetails) ([]WorkshopFileDetails, error) {
	var validDetails []WorkshopFileDetails
	for i := range details {
		if details[i].Result == 1 {
			// Remove Creator info as requested
			details[i].Creator = ""
			// Clean filename
			details[i].Filename = cleanFilename(details[i].Filename)
			validDetails = append(validDetails, details[i])
		}
	}

	if len(validDetails) == 0 {
		return nil, fmt.Errorf("no valid details found")
	}

	return validDetails, nil
}

func cleanFilename(filename string) string {
	// First, get the base name to handle paths like "myl4d2addons/file.vpk"
	filename = strings.ReplaceAll(filename, "\\", "/")
	if idx := strings.LastIndex(filename, "/"); idx != -1 {
		filename = filename[idx+1:]
	}

	lowerName := strings.ToLower(filename)
	prefixes := []string{"my l4d2addons", "myl4d2addons"}
	for _, prefix := range prefixes {
		if strings.HasPrefix(lowerName, prefix) {
			filename = filename[len(prefix):]
			// Trim spaces, underscores and dashes from the beginning
			filename = strings.TrimLeft(filename, " _-")
			lowerName = strings.ToLower(filename)
		}
	}
	return filename
}

// StartDownloadTask starts a background download task
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
		bestIP = globalIPSelector.GetCachedBestIP()
		// 如果缓存没有，则重新获取
		if bestIP == "" {
			bestIP = globalIPSelector.GetBestIP(downloadUrl)
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
	threadCount := CalculateThreadCount(totalSize, 8)

	// Use chunked download if multiple threads are needed
	if threadCount > 1 && totalSize > 0 {
		fmt.Printf("[Download] Using %d-thread download for %s (Size: %.2f MB)\n",
			threadCount, task.Filename, float64(totalSize)/1024/1024)

		err := a.processChunkedDownload(ctx, task, downloadUrl, bestIP, totalSize, threadCount, tempDir)
		if err != nil {
			// Check if server does not support Range, fallback to single-thread
			if err.Error() == "range_not_supported" {
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
			// Move final file to target location
			finalPath := filepath.Join(tempDir, task.ID+"_final")
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
		// 确定图片扩展名和目标路径
		// 默认使用 jpg，或者根据 url 后缀
		imgExt := ".jpg"
		if strings.HasSuffix(strings.ToLower(task.PreviewUrl), ".png") {
			imgExt = ".png"
		} else if strings.HasSuffix(strings.ToLower(task.PreviewUrl), ".jpeg") {
			imgExt = ".jpeg"
		}

		vpkExt := filepath.Ext(targetPath)
		imgPath := strings.TrimSuffix(targetPath, vpkExt) + imgExt

		// 同步下载图片，确保任务完成时图片已就绪
		// 设置较短的超时，避免长时间阻塞
		func(url, path string) {
			client := &http.Client{
				Timeout: 10 * time.Second,
			}
			resp, err := client.Get(url)
			if err != nil {
				return
			}
			defer resp.Body.Close()

			out, err := os.Create(path)
			if err != nil {
				return
			}
			defer out.Close()

			io.Copy(out, resp.Body)
		}(task.PreviewUrl, imgPath)
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

// GetDownloadTasks returns all tasks
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

// ==================== Chunked Download Functions ====================

// downloadChunk downloads a single chunk with Range request
func (a *App) downloadChunk(ctx context.Context, chunk *ChunkDownload, downloadUrl string, bestIP string, chunkManager *ChunkManager, task *DownloadTask) error {
	// Create HTTP client with optimized IP if available
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
		ResponseHeaderTimeout: 60 * time.Second,
	}

	if bestIP != "" {
		dialer := &net.Dialer{
			Timeout:   30 * time.Second,
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
		Timeout:   0, // No global timeout for large chunks
	}

	// Create request with Range header
	req, err := http.NewRequestWithContext(ctx, "GET", downloadUrl, nil)
	if err != nil {
		return err
	}

	// Set Range header for this chunk
	req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", chunk.StartByte, chunk.EndByte))
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Referer", "https://steamcommunity.com/")
	req.Header.Set("Accept", "*/*")

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	// Check response status
	if resp.StatusCode == http.StatusOK {
		// Server does not support Range requests, return special error
		return fmt.Errorf("server does not support range requests")
	}
	if resp.StatusCode != http.StatusPartialContent {
		return fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	// Create temp file for this chunk
	out, err := os.Create(chunk.TempFile)
	if err != nil {
		return err
	}
	defer out.Close()

	// Create progress writer for this chunk
	chunkWriter := &ChunkProgressWriter{
		Chunk:        chunk,
		ChunkManager: chunkManager,
		Task:         task,
		Ctx:          a.ctx,
	}

	// Download chunk content
	_, err = io.Copy(out, io.TeeReader(resp.Body, chunkWriter))
	if err != nil {
		return err
	}

	// Mark chunk as completed
	chunkManager.mu.Lock()
	chunk.Status = "completed"
	chunkManager.mu.Unlock()

	return nil
}

// ChunkProgressWriter tracks progress for a single chunk
type ChunkProgressWriter struct {
	Chunk        *ChunkDownload
	ChunkManager *ChunkManager
	Task         *DownloadTask
	Ctx          context.Context
	LastUpdate   time.Time
	LastBytes    int64 // For speed calculation
}

func (cw *ChunkProgressWriter) Write(p []byte) (int, error) {
	n := len(p)

	// Update chunk downloaded count
	cw.ChunkManager.mu.Lock()
	cw.Chunk.Downloaded += int64(n)
	cw.ChunkManager.mu.Unlock()

	// Update total completed
	completed := cw.ChunkManager.Completed + int64(n)
	cw.ChunkManager.Completed = completed

	// Update task progress and speed periodically
	now := time.Now()
	duration := now.Sub(cw.LastUpdate)

	if duration > 500*time.Millisecond {
		taskManager.mu.Lock()
		cw.Task.DownloadedSize = completed
		if cw.ChunkManager.TotalSize > 0 {
			cw.Task.Progress = int(float64(completed) / float64(cw.ChunkManager.TotalSize) * 100)
		}

		// Calculate speed
		if duration > 0 && cw.LastBytes > 0 {
			bytesDelta := completed - cw.LastBytes
			speedBps := float64(bytesDelta) / duration.Seconds()
			cw.Task.Speed = formatSpeed(speedBps)
		}

		taskManager.mu.Unlock()
		runtime.EventsEmit(cw.Ctx, "task_progress", cw.Task)
		cw.LastUpdate = now
		cw.LastBytes = completed
	}

	return n, nil
}

// processChunkedDownload manages parallel chunk downloads
func (a *App) processChunkedDownload(ctx context.Context, task *DownloadTask, downloadUrl string, bestIP string, totalSize int64, threadCount int, tempDir string) error {
	// Create chunk manager
	chunkManager := &ChunkManager{
		TotalSize:  totalSize,
		ChunkCount: threadCount,
		Completed:  0,
	}

	// Create chunks
	chunks := CreateChunks(totalSize, threadCount, tempDir, task.ID)
	if chunks == nil {
		return fmt.Errorf("failed to create chunks")
	}
	chunkManager.Chunks = chunks

	fmt.Printf("[ChunkedDownload] Starting %d-thread download for %s (Size: %.2f MB)\n",
		threadCount, task.Filename, float64(totalSize)/1024/1024)

	// Create semaphore to limit concurrent downloads
	sem := make(chan struct{}, threadCount)

	// Channel to collect errors
	errChan := make(chan error, threadCount)

	// Wait group for all chunks
	var wg sync.WaitGroup

	// Start chunk downloads
	for _, chunk := range chunks {
		wg.Add(1)

		go func(c *ChunkDownload) {
			defer wg.Done()

			// Acquire semaphore
			sem <- struct{}{}
			defer func() { <-sem }()

			// Check for cancellation
			select {
			case <-ctx.Done():
				chunkManager.mu.Lock()
				c.Status = "cancelled"
				chunkManager.mu.Unlock()
				errChan <- ctx.Err()
				return
			default:
			}

			// Mark as downloading
			chunkManager.mu.Lock()
			c.Status = "downloading"
			chunkManager.mu.Unlock()

			// Retry loop for this chunk
			maxChunkRetries := 3
			var lastErr error

			for i := 0; i < maxChunkRetries; i++ {
				if i > 0 {
					fmt.Printf("[ChunkedDownload] Retrying chunk %d (%d/%d)...\n", c.Index, i+1, maxChunkRetries)
					time.Sleep(1 * time.Second)

					// Reset chunk state
					chunkManager.mu.Lock()
					c.Downloaded = 0
					c.Retries = i
					chunkManager.mu.Unlock()
				}

				err := a.downloadChunk(ctx, c, downloadUrl, bestIP, chunkManager, task)
				if err == nil {
					// Success
					return
				}

				lastErr = err

				// Check if cancelled
				if ctx.Err() != nil {
					chunkManager.mu.Lock()
					c.Status = "cancelled"
					chunkManager.mu.Unlock()
					errChan <- ctx.Err()
					return
				}
			}

			// All retries failed
			chunkManager.mu.Lock()
			c.Status = "failed"
			c.Error = lastErr.Error()
			chunkManager.mu.Unlock()
			errChan <- fmt.Errorf("chunk %d failed after %d retries: %v", c.Index, maxChunkRetries, lastErr)
		}(chunk)
	}

	// Wait for all chunks to complete
	wg.Wait()
	close(errChan)

	// Check for errors
	var errors []error
	var rangeNotSupported bool
	for err := range errChan {
		if err != nil && err != context.Canceled {
			// Check if server does not support Range
			if strings.Contains(err.Error(), "server does not support range requests") {
				rangeNotSupported = true
			}
			errors = append(errors, err)
		}
	}

	// If cancelled, clean up and return
	if ctx.Err() != nil {
		a.cleanupChunks(chunks)
		return ctx.Err()
	}

	// If server does not support Range, return special error for fallback
	if rangeNotSupported {
		a.cleanupChunks(chunks)
		return fmt.Errorf("range_not_supported")
	}

	// If any chunk failed, clean up and return error
	if len(errors) > 0 {
		a.cleanupChunks(chunks)
		return fmt.Errorf("download failed: %v", errors[0])
	}

	// All chunks completed, merge them
	finalPath := filepath.Join(tempDir, task.ID+"_final")
	err := a.mergeChunks(chunks, finalPath, totalSize)
	if err != nil {
		a.cleanupChunks(chunks)
		return fmt.Errorf("merge failed: %v", err)
	}

	// Clean up chunk files
	a.cleanupChunks(chunks)

	// Update task with final file path
	taskManager.mu.Lock()
	task.DownloadedSize = totalSize
	task.Progress = 100
	taskManager.mu.Unlock()

	fmt.Printf("[ChunkedDownload] Successfully downloaded %s with %d threads\n", task.Filename, threadCount)

	return nil
}

// mergeChunks combines all chunk files into final file
func (a *App) mergeChunks(chunks []*ChunkDownload, finalPath string, expectedSize int64) error {
	// Create final file
	out, err := os.Create(finalPath)
	if err != nil {
		return err
	}
	defer out.Close()

	// Merge chunks in order
	for _, chunk := range chunks {
		// Open chunk file
		in, err := os.Open(chunk.TempFile)
		if err != nil {
			return fmt.Errorf("failed to open chunk %d: %v", chunk.Index, err)
		}

		// Copy chunk content to final file
		_, err = io.Copy(out, in)
		in.Close()
		if err != nil {
			return fmt.Errorf("failed to merge chunk %d: %v", chunk.Index, err)
		}
	}

	// Verify final file size
	stat, err := out.Stat()
	if err != nil {
		return err
	}

	if stat.Size() != expectedSize {
		return fmt.Errorf("size mismatch: expected %d, got %d", expectedSize, stat.Size())
	}

	return nil
}

// cleanupChunks removes all temporary chunk files
func (a *App) cleanupChunks(chunks []*ChunkDownload) {
	for _, chunk := range chunks {
		if chunk.TempFile != "" {
			os.Remove(chunk.TempFile)
		}
	}
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

	imgExt := ".jpg"
	if strings.HasSuffix(strings.ToLower(task.PreviewUrl), ".png") {
		imgExt = ".png"
	} else if strings.HasSuffix(strings.ToLower(task.PreviewUrl), ".jpeg") {
		imgExt = ".jpeg"
	}

	vpkExt := filepath.Ext(targetPath)
	imgPath := strings.TrimSuffix(targetPath, vpkExt) + imgExt

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(task.PreviewUrl)
	if err != nil {
		return
	}
	defer resp.Body.Close()

	out, err := os.Create(imgPath)
	if err != nil {
		return
	}
	defer out.Close()

	io.Copy(out, resp.Body)
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
