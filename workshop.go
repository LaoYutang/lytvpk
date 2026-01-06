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
	Result          int             `json:"result"`
	PublishedFileId string          `json:"publishedfileid"`
	Creator         string          `json:"creator"`
	Filename        string          `json:"filename"`
	FileSize        string          `json:"file_size"`
	FileUrl         string          `json:"file_url"`
	PreviewUrl      string          `json:"preview_url"`
	Title           string          `json:"title"`
	Description     string          `json:"file_description"`
	Children        []WorkshopChild `json:"children"`
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
	apiUrl := "https://steamworkshopdownloader.io/api/details/file"

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
	if task.UseOptimizedIP {
		updateStatus("selecting_ip", "")
		bestIP = globalIPSelector.GetBestIP(downloadUrl)
		updateStatus("downloading", "")
	}

	// Ensure temp directory exists
	tempDir := filepath.Join(a.rootDir, "temp")
	if err := os.MkdirAll(tempDir, 0755); err != nil {
		updateStatus("failed", "Failed to create temp dir: "+err.Error())
		return
	}

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
				u, err := url.Parse(downloadUrl)
				if err == nil && u.Hostname() == host {
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

		req, err := http.NewRequestWithContext(ctx, "GET", downloadUrl, nil)
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
		if _, params, err := mime.ParseMediaType(cd); err == nil {
			if filename, ok := params["filename"]; ok && filename != "" {
				// Clean filename
				filename = cleanFilename(filename)

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
	totalSize := task.TotalSize
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

	// Rename to final
	if err := os.Rename(tempPath, targetPath); err != nil {
		updateStatus("failed", "Rename failed: "+err.Error())
		return
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
