package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"vpk-manager/internal/platform/protocol"

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
	Description    string             `json:"description"`
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

// ParseWorkshopID extracts the ID from a Steam Workshop URL or a direct ID.
func (a *App) ParseWorkshopID(workshopUrl string) (string, error) {
	workshopUrl = strings.TrimSpace(workshopUrl)
	if protocol.IsValidWorkshopID(workshopUrl) {
		return workshopUrl, nil
	}

	u, err := url.Parse(workshopUrl)
	if err != nil {
		return "", fmt.Errorf("invalid URL")
	}

	// 只有 Steam 相关域名才提取 id 参数
	host := strings.ToLower(u.Hostname())
	isSteamHost := strings.HasSuffix(host, "steamcommunity.com") ||
		strings.HasSuffix(host, "steampowered.com") ||
		strings.HasSuffix(host, "steamworkshop.download")

	if isSteamHost {
		q := u.Query()
		id := q.Get("id")
		if id != "" && protocol.IsValidWorkshopID(id) {
			return id, nil
		}
	}

	// 回退：仅当 URL 整体看起来像 Steam 链接时才用正则匹配
	if isSteamHost || strings.Contains(workshopUrl, "steamcommunity.com/sharedfiles") {
		re := regexp.MustCompile(`\d+`)
		matches := re.FindStringSubmatch(workshopUrl)
		if len(matches) > 0 && protocol.IsValidWorkshopID(matches[0]) {
			return matches[0], nil
		}
	}

	return "", fmt.Errorf("could not find valid workshop ID in URL")
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
