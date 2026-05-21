package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	panelMapUploadChunkSize   int64 = 5 * 1024 * 1024
	panelMapUploadConcurrency       = 3
	panelMapUploadMaxSize     int64 = 2 << 30
)

var panelMapUploadSequence atomic.Uint64

type PanelMapUploadTask struct {
	ID             string             `json:"id"`
	ServerID       string             `json:"server_id"`
	ServerName     string             `json:"server_name"`
	FilePath       string             `json:"file_path"`
	Filename       string             `json:"filename"`
	UploadID       string             `json:"upload_id"`
	Status         string             `json:"status"`
	Progress       int                `json:"progress"`
	TotalChunks    int                `json:"total_chunks"`
	UploadedChunks []int              `json:"uploaded_chunks"`
	TotalSize      int64              `json:"total_size"`
	UploadedSize   int64              `json:"uploaded_size"`
	Speed          string             `json:"speed"`
	Error          string             `json:"error"`
	CreatedAt      string             `json:"created_at"`
	cancelFunc     context.CancelFunc `json:"-"`
	attempt        uint64             `json:"-"`
}

type panelMapUploadManager struct {
	tasks map[string]*PanelMapUploadTask
	mu    sync.RWMutex
}

var panelUploads = &panelMapUploadManager{
	tasks: make(map[string]*PanelMapUploadTask),
}

func (a *App) SelectPanelMapUploadFiles() ([]string, error) {
	files, err := runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择要上传到服务器的地图文件",
		Filters: []runtime.FileFilter{
			{
				DisplayName: "支持的地图文件 (*.vpk;*.zip;*.rar;*.7z)",
				Pattern:     "*.vpk;*.zip;*.rar;*.7z",
			},
			{
				DisplayName: "VPK 文件 (*.vpk)",
				Pattern:     "*.vpk",
			},
			{
				DisplayName: "压缩包 (*.zip;*.rar;*.7z)",
				Pattern:     "*.zip;*.rar;*.7z",
			},
			{
				DisplayName: "所有文件 (*.*)",
				Pattern:     "*.*",
			},
		},
	})
	if err != nil {
		return nil, err
	}
	return files, nil
}

func (a *App) StartPanelMapUpload(serverID string, filePaths []string) ([]string, error) {
	if len(filePaths) == 0 {
		return nil, fmt.Errorf("请选择要上传的地图文件")
	}

	credentials, err := a.getPanelCredentials(serverID)
	if err != nil {
		return nil, err
	}

	taskIDs := make([]string, 0, len(filePaths))
	for _, filePath := range filePaths {
		task := newPanelMapUploadTask(serverID, credentials.serverName, filePath)
		taskIDs = append(taskIDs, task.ID)

		validationErr := validatePanelMapUploadTask(task)
		if validationErr != nil {
			task.Status = "failed"
			task.Error = validationErr.Error()
			a.storePanelMapUploadTask(task)
			a.emitPanelUploadTaskUpdated(task.ID)
			continue
		}

		ctx, cancel := context.WithCancel(context.Background())
		task.cancelFunc = cancel
		a.storePanelMapUploadTask(task)
		a.emitPanelUploadTaskUpdated(task.ID)
		go a.processPanelMapUpload(ctx, task.ID, task.attempt)
	}

	return taskIDs, nil
}

func (a *App) GetPanelMapUploadTasks() []*PanelMapUploadTask {
	panelUploads.mu.RLock()
	defer panelUploads.mu.RUnlock()

	tasks := make([]*PanelMapUploadTask, 0, len(panelUploads.tasks))
	for _, task := range panelUploads.tasks {
		tasks = append(tasks, clonePanelMapUploadTask(task))
	}

	sort.SliceStable(tasks, func(i, j int) bool {
		statusOrder := map[string]int{
			"uploading": 0,
			"merging":   1,
			"pending":   2,
			"failed":    3,
			"cancelled": 4,
			"completed": 5,
		}
		left := statusOrder[tasks[i].Status]
		right := statusOrder[tasks[j].Status]
		if left != right {
			return left < right
		}
		return tasks[i].ID > tasks[j].ID
	})

	return tasks
}

func (a *App) CancelPanelMapUpload(taskID string) {
	var task *PanelMapUploadTask
	var uploadID string
	panelUploads.mu.Lock()
	if existing, ok := panelUploads.tasks[taskID]; ok {
		task = existing
		if isActivePanelUploadStatus(task.Status) {
			if task.cancelFunc != nil {
				task.cancelFunc()
			}
			uploadID = task.UploadID
			task.UploadID = ""
			task.Status = "cancelled"
			task.Error = "用户已取消"
			task.Speed = ""
		}
	}
	panelUploads.mu.Unlock()

	if task != nil {
		a.emitPanelUploadTaskUpdated(taskID)
	}
	if uploadID != "" {
		go a.cancelRemotePanelMapUpload(taskID, uploadID)
	}
}

func (a *App) RetryPanelMapUpload(taskID string) {
	panelUploads.mu.Lock()
	task, exists := panelUploads.tasks[taskID]
	if !exists || (task.Status != "failed" && task.Status != "cancelled") {
		panelUploads.mu.Unlock()
		return
	}

	wasCancelled := task.Status == "cancelled"
	task.Status = "pending"
	task.Progress = 0
	task.UploadedSize = 0
	task.UploadedChunks = nil
	task.Speed = ""
	task.Error = ""
	task.attempt++
	if wasCancelled {
		task.UploadID = ""
	}

	if validationErr := validatePanelMapUploadTask(task); validationErr != nil {
		task.Status = "failed"
		task.Error = validationErr.Error()
		panelUploads.mu.Unlock()
		a.emitPanelUploadTaskUpdated(taskID)
		return
	}

	ctx, cancel := context.WithCancel(context.Background())
	task.cancelFunc = cancel
	attempt := task.attempt
	panelUploads.mu.Unlock()

	a.emitPanelUploadTaskUpdated(taskID)
	go a.processPanelMapUpload(ctx, taskID, attempt)
}

func (a *App) ClearCompletedPanelMapUploads() {
	panelUploads.mu.Lock()
	for id, task := range panelUploads.tasks {
		if isClearablePanelUploadStatus(task.Status) {
			delete(panelUploads.tasks, id)
		}
	}
	panelUploads.mu.Unlock()
	runtime.EventsEmit(a.ctx, "panel_upload_tasks_cleared", nil)
}

func (a *App) HasActivePanelUploads() bool {
	panelUploads.mu.RLock()
	defer panelUploads.mu.RUnlock()

	for _, task := range panelUploads.tasks {
		if isActivePanelUploadStatus(task.Status) {
			return true
		}
	}
	return false
}

func newPanelMapUploadTask(serverID string, serverName string, filePath string) *PanelMapUploadTask {
	taskID := fmt.Sprintf("%d-%d", time.Now().UnixNano(), panelMapUploadSequence.Add(1))
	cleanPath := strings.TrimSpace(filePath)
	if cleanPath != "" {
		cleanPath = filepath.Clean(cleanPath)
	}
	return &PanelMapUploadTask{
		ID:         taskID,
		ServerID:   serverID,
		ServerName: serverName,
		FilePath:   cleanPath,
		Filename:   filepath.Base(cleanPath),
		Status:     "pending",
		CreatedAt:  time.Now().Format("2006-01-02 15:04:05"),
		attempt:    1,
	}
}

func validatePanelMapUploadTask(task *PanelMapUploadTask) error {
	if strings.TrimSpace(task.FilePath) == "" {
		return fmt.Errorf("文件路径为空")
	}
	info, err := os.Stat(task.FilePath)
	if err != nil {
		return fmt.Errorf("无法读取文件: %w", err)
	}
	if info.IsDir() {
		return fmt.Errorf("不能上传文件夹")
	}
	if info.Size() <= 0 {
		return fmt.Errorf("文件为空")
	}
	if info.Size() > panelMapUploadMaxSize {
		return fmt.Errorf("文件超过2GB，禁止上传")
	}
	ext := strings.ToLower(filepath.Ext(task.FilePath))
	switch ext {
	case ".vpk", ".zip", ".rar", ".7z":
	default:
		return fmt.Errorf("错误的文件类型，只支持vpk, zip, rar, 7z文件")
	}

	task.Filename = filepath.Base(task.FilePath)
	task.TotalSize = info.Size()
	task.TotalChunks = int((info.Size() + panelMapUploadChunkSize - 1) / panelMapUploadChunkSize)
	return nil
}

func (a *App) processPanelMapUpload(ctx context.Context, taskID string, attempt uint64) {
	task := a.getPanelMapUploadTaskSnapshot(taskID)
	if task == nil || task.attempt != attempt {
		return
	}

	credentials, err := a.getPanelCredentials(task.ServerID)
	if err != nil {
		a.setPanelUploadStatusForAttempt(taskID, attempt, "failed", err.Error())
		return
	}

	a.setPanelUploadStatusForAttempt(taskID, attempt, "uploading", "")

	task = a.getPanelMapUploadTaskSnapshot(taskID)
	if task == nil || task.attempt != attempt {
		return
	}
	if err := validatePanelMapUploadTask(task); err != nil {
		a.setPanelUploadStatusForAttempt(taskID, attempt, "failed", err.Error())
		return
	}
	a.updatePanelUploadTaskFieldsForAttempt(taskID, attempt, func(t *PanelMapUploadTask) {
		t.Filename = task.Filename
		t.TotalSize = task.TotalSize
		t.TotalChunks = task.TotalChunks
	})

	if task.UploadID == "" {
		uploadID, err := a.initPanelMapUpload(ctx, credentials, task)
		if err != nil {
			a.handlePanelUploadProcessError(ctx, taskID, attempt, err)
			return
		}
		a.updatePanelUploadTaskFieldsForAttempt(taskID, attempt, func(t *PanelMapUploadTask) {
			t.UploadID = uploadID
		})
	} else {
		uploadedChunks, err := a.fetchPanelMapUploadStatus(ctx, credentials, task.UploadID)
		if err != nil {
			a.handlePanelUploadProcessError(ctx, taskID, attempt, err)
			return
		}
		a.applyPanelUploadedChunks(taskID, attempt, uploadedChunks)
	}

	task = a.getPanelMapUploadTaskSnapshot(taskID)
	if task == nil || task.attempt != attempt {
		return
	}

	if err := a.uploadPanelMapMissingChunks(ctx, credentials, taskID, attempt); err != nil {
		a.handlePanelUploadProcessError(ctx, taskID, attempt, err)
		return
	}

	if ctx.Err() != nil {
		a.setPanelUploadStatusForAttempt(taskID, attempt, "cancelled", "用户已取消")
		return
	}

	a.setPanelUploadStatusForAttempt(taskID, attempt, "merging", "")
	task = a.getPanelMapUploadTaskSnapshot(taskID)
	if task == nil || task.attempt != attempt {
		return
	}
	if _, err := a.panelPostForm(ctx, credentials, "/upload/merge", map[string]string{
		"uploadId": task.UploadID,
		"filename": task.Filename,
	}, nil); err != nil {
		a.handlePanelUploadProcessError(ctx, taskID, attempt, err)
		return
	}

	if !a.updatePanelUploadTaskFieldsForAttempt(taskID, attempt, func(t *PanelMapUploadTask) {
		t.Status = "completed"
		t.Progress = 100
		t.UploadedSize = t.TotalSize
		t.Speed = ""
		t.Error = ""
		t.cancelFunc = nil
	}) {
		return
	}
	a.emitPanelUploadTaskUpdated(taskID)
}

func (a *App) initPanelMapUpload(ctx context.Context, credentials *panelCredentials, task *PanelMapUploadTask) (string, error) {
	var result struct {
		UploadID string `json:"uploadId"`
	}
	_, err := a.panelPostForm(ctx, credentials, "/upload/init", map[string]string{
		"filename":    task.Filename,
		"fileSize":    strconv.FormatInt(task.TotalSize, 10),
		"totalChunks": strconv.Itoa(task.TotalChunks),
	}, &result)
	if err != nil {
		return "", err
	}
	if result.UploadID == "" {
		return "", fmt.Errorf("面板未返回 uploadId")
	}
	return result.UploadID, nil
}

func (a *App) fetchPanelMapUploadStatus(ctx context.Context, credentials *panelCredentials, uploadID string) ([]int, error) {
	var result struct {
		UploadedChunks []int `json:"uploadedChunks"`
	}
	_, err := a.panelPostForm(ctx, credentials, "/upload/status", map[string]string{
		"uploadId": uploadID,
	}, &result)
	if err != nil {
		return nil, err
	}
	return result.UploadedChunks, nil
}

func (a *App) uploadPanelMapMissingChunks(ctx context.Context, credentials *panelCredentials, taskID string, attempt uint64) error {
	task := a.getPanelMapUploadTaskSnapshot(taskID)
	if task == nil {
		return fmt.Errorf("上传任务不存在")
	}
	if task.attempt != attempt {
		return context.Canceled
	}

	file, err := os.Open(task.FilePath)
	if err != nil {
		return fmt.Errorf("打开文件失败: %w", err)
	}
	defer file.Close()

	uploadedSet := make(map[int]bool, len(task.UploadedChunks))
	for _, idx := range task.UploadedChunks {
		if idx >= 0 && idx < task.TotalChunks {
			uploadedSet[idx] = true
		}
	}

	var pending []int
	for i := 0; i < task.TotalChunks; i++ {
		if !uploadedSet[i] {
			pending = append(pending, i)
		}
	}
	if len(pending) == 0 {
		return nil
	}

	uploadCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	jobs := make(chan int)
	errCh := make(chan error, 1)
	var wg sync.WaitGroup
	var sessionUploaded atomic.Int64
	startTime := time.Now()

	for worker := 0; worker < panelMapUploadConcurrency; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for idx := range jobs {
				if uploadCtx.Err() != nil {
					return
				}

				length := panelChunkLength(task.TotalSize, idx)
				reader := io.NewSectionReader(file, int64(idx)*panelMapUploadChunkSize, length)
				err := a.uploadPanelMapChunk(uploadCtx, credentials, task.UploadID, idx, task.Filename, reader)
				if err != nil {
					select {
					case errCh <- err:
						cancel()
					default:
					}
					return
				}

				currentSessionUploaded := sessionUploaded.Add(length)
				a.markPanelChunkUploaded(taskID, attempt, idx, startTime, currentSessionUploaded)
			}
		}()
	}

	go func() {
		defer close(jobs)
		for _, idx := range pending {
			select {
			case <-uploadCtx.Done():
				return
			case jobs <- idx:
			}
		}
	}()

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		if uploadCtx.Err() != nil && ctx.Err() != nil {
			return ctx.Err()
		}
		select {
		case err := <-errCh:
			return err
		default:
			return nil
		}
	case err := <-errCh:
		cancel()
		<-done
		return err
	case <-ctx.Done():
		cancel()
		<-done
		return ctx.Err()
	}
}

func (a *App) uploadPanelMapChunk(ctx context.Context, credentials *panelCredentials, uploadID string, chunkIndex int, filename string, reader io.Reader) error {
	_, err := a.panelPostMultipartFile(ctx, credentials, "/upload/chunk", map[string]string{
		"uploadId":   uploadID,
		"chunkIndex": strconv.Itoa(chunkIndex),
	}, "chunk", filename+".part", reader, nil)
	return err
}

func panelChunkLength(totalSize int64, chunkIndex int) int64 {
	start := int64(chunkIndex) * panelMapUploadChunkSize
	remaining := totalSize - start
	if remaining < panelMapUploadChunkSize {
		return remaining
	}
	return panelMapUploadChunkSize
}

func (a *App) cancelRemotePanelMapUpload(taskID string, uploadID string) {
	task := a.getPanelMapUploadTaskSnapshot(taskID)
	if task == nil || uploadID == "" {
		return
	}
	credentials, err := a.getPanelCredentials(task.ServerID)
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_, _ = a.panelPostForm(ctx, credentials, "/upload/cancel", map[string]string{
		"uploadId": uploadID,
	}, nil)
}

func (a *App) panelPostForm(ctx context.Context, credentials *panelCredentials, endpoint string, formData map[string]string, result interface{}) (string, error) {
	requestURL, err := joinPanelEndpoint(credentials.baseURL, endpoint)
	if err != nil {
		return "", err
	}

	values := url.Values{}
	for key, value := range formData {
		values.Set(key, value)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, requestURL, strings.NewReader(values.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+credentials.password)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	return doPanelUploadRequest(req, result)
}

func (a *App) panelPostMultipartFile(ctx context.Context, credentials *panelCredentials, endpoint string, formData map[string]string, fileField string, filename string, fileReader io.Reader, result interface{}) (string, error) {
	requestURL, err := joinPanelEndpoint(credentials.baseURL, endpoint)
	if err != nil {
		return "", err
	}

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for key, value := range formData {
		if err := writer.WriteField(key, value); err != nil {
			return "", err
		}
	}
	part, err := writer.CreateFormFile(fileField, filename)
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(part, fileReader); err != nil {
		return "", err
	}
	if err := writer.Close(); err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, requestURL, &body)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+credentials.password)
	req.Header.Set("Content-Type", writer.FormDataContentType())

	return doPanelUploadRequest(req, result)
}

func doPanelUploadRequest(req *http.Request, result interface{}) (string, error) {
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("连接面板失败: %w", err)
	}
	defer resp.Body.Close()

	body, readErr := io.ReadAll(resp.Body)
	if readErr != nil {
		return "", fmt.Errorf("读取面板响应失败: %w", readErr)
	}
	bodyText := strings.TrimSpace(string(body))

	if resp.StatusCode == 401 || resp.StatusCode == 429 {
		return "", fmt.Errorf("面板认证失败，请检查密码或稍后重试")
	}
	if resp.StatusCode == 403 {
		return "", fmt.Errorf("没有权限执行该面板操作")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		if bodyText == "" {
			bodyText = resp.Status
		}
		return "", fmt.Errorf("面板请求失败(%d): %s", resp.StatusCode, bodyText)
	}

	if result != nil && len(body) > 0 {
		if err := json.Unmarshal(body, result); err != nil {
			return "", fmt.Errorf("解析面板响应失败: %w", err)
		}
	}
	return bodyText, nil
}

func (a *App) storePanelMapUploadTask(task *PanelMapUploadTask) {
	panelUploads.mu.Lock()
	panelUploads.tasks[task.ID] = task
	panelUploads.mu.Unlock()
}

func (a *App) getPanelMapUploadTaskSnapshot(taskID string) *PanelMapUploadTask {
	panelUploads.mu.RLock()
	defer panelUploads.mu.RUnlock()

	task, ok := panelUploads.tasks[taskID]
	if !ok {
		return nil
	}
	return clonePanelMapUploadTask(task)
}

func (a *App) updatePanelUploadTaskFields(taskID string, update func(*PanelMapUploadTask)) {
	panelUploads.mu.Lock()
	if task, ok := panelUploads.tasks[taskID]; ok {
		update(task)
	}
	panelUploads.mu.Unlock()
}

func (a *App) updatePanelUploadTaskFieldsForAttempt(taskID string, attempt uint64, update func(*PanelMapUploadTask)) bool {
	panelUploads.mu.Lock()
	defer panelUploads.mu.Unlock()

	task, ok := panelUploads.tasks[taskID]
	if !ok || task.attempt != attempt {
		return false
	}
	update(task)
	return true
}

func (a *App) setPanelUploadStatus(taskID string, status string, message string) {
	a.updatePanelUploadTaskFields(taskID, func(task *PanelMapUploadTask) {
		task.Status = status
		task.Error = message
		if status != "uploading" {
			task.Speed = ""
		}
		if status == "failed" || status == "completed" || status == "cancelled" {
			task.cancelFunc = nil
		}
	})
	a.emitPanelUploadTaskUpdated(taskID)
}

func (a *App) setPanelUploadStatusForAttempt(taskID string, attempt uint64, status string, message string) {
	if !a.updatePanelUploadTaskFieldsForAttempt(taskID, attempt, func(task *PanelMapUploadTask) {
		task.Status = status
		task.Error = message
		if status != "uploading" {
			task.Speed = ""
		}
		if status == "failed" || status == "completed" || status == "cancelled" {
			task.cancelFunc = nil
		}
	}) {
		return
	}
	a.emitPanelUploadTaskUpdated(taskID)
}

func (a *App) applyPanelUploadedChunks(taskID string, attempt uint64, uploadedChunks []int) {
	if !a.updatePanelUploadTaskFieldsForAttempt(taskID, attempt, func(task *PanelMapUploadTask) {
		task.UploadedChunks = normalizePanelUploadedChunks(uploadedChunks, task.TotalChunks)
		task.UploadedSize = panelUploadedChunkBytes(task.TotalSize, task.UploadedChunks)
		task.Progress = panelProgress(task.UploadedSize, task.TotalSize)
	}) {
		return
	}
	a.emitPanelUploadTaskUpdated(taskID)
}

func (a *App) markPanelChunkUploaded(taskID string, attempt uint64, chunkIndex int, startTime time.Time, sessionUploaded int64) {
	if !a.updatePanelUploadTaskFieldsForAttempt(taskID, attempt, func(task *PanelMapUploadTask) {
		if !containsInt(task.UploadedChunks, chunkIndex) {
			task.UploadedChunks = append(task.UploadedChunks, chunkIndex)
			sort.Ints(task.UploadedChunks)
		}
		task.UploadedSize = panelUploadedChunkBytes(task.TotalSize, task.UploadedChunks)
		task.Progress = panelProgress(task.UploadedSize, task.TotalSize)
		elapsed := time.Since(startTime).Seconds()
		if elapsed > 0 {
			task.Speed = formatPanelUploadSpeed(float64(sessionUploaded) / elapsed)
		}
	}) {
		return
	}
	a.emitPanelUploadTaskProgress(taskID)
}

func (a *App) handlePanelUploadProcessError(ctx context.Context, taskID string, attempt uint64, err error) {
	if ctx.Err() != nil {
		a.setPanelUploadStatusForAttempt(taskID, attempt, "cancelled", "用户已取消")
		return
	}
	if strings.Contains(err.Error(), "上传任务不存在或已过期") {
		a.updatePanelUploadTaskFieldsForAttempt(taskID, attempt, func(task *PanelMapUploadTask) {
			task.UploadID = ""
		})
	}
	a.setPanelUploadStatusForAttempt(taskID, attempt, "failed", err.Error())
}

func (a *App) emitPanelUploadTaskUpdated(taskID string) {
	task := a.getPanelMapUploadTaskSnapshot(taskID)
	if task == nil {
		return
	}
	runtime.EventsEmit(a.ctx, "panel_upload_task_updated", task)
}

func (a *App) emitPanelUploadTaskProgress(taskID string) {
	task := a.getPanelMapUploadTaskSnapshot(taskID)
	if task == nil {
		return
	}
	runtime.EventsEmit(a.ctx, "panel_upload_task_progress", task)
}

func normalizePanelUploadedChunks(chunks []int, totalChunks int) []int {
	seen := make(map[int]bool, len(chunks))
	normalized := make([]int, 0, len(chunks))
	for _, chunk := range chunks {
		if chunk < 0 || chunk >= totalChunks || seen[chunk] {
			continue
		}
		seen[chunk] = true
		normalized = append(normalized, chunk)
	}
	sort.Ints(normalized)
	return normalized
}

func panelUploadedChunkBytes(totalSize int64, chunks []int) int64 {
	var uploaded int64
	for _, chunk := range chunks {
		uploaded += panelChunkLength(totalSize, chunk)
	}
	if uploaded > totalSize {
		return totalSize
	}
	return uploaded
}

func panelProgress(uploaded int64, total int64) int {
	if total <= 0 {
		return 0
	}
	progress := int(float64(uploaded) / float64(total) * 100)
	if progress > 100 {
		return 100
	}
	if progress < 0 {
		return 0
	}
	return progress
}

func formatPanelUploadSpeed(bytesPerSecond float64) string {
	if bytesPerSecond <= 0 {
		return ""
	}
	const unit = 1024
	if bytesPerSecond < unit {
		return fmt.Sprintf("%.0f B/s", bytesPerSecond)
	}
	if bytesPerSecond < unit*unit {
		return fmt.Sprintf("%.2f KB/s", bytesPerSecond/unit)
	}
	if bytesPerSecond < unit*unit*unit {
		return fmt.Sprintf("%.2f MB/s", bytesPerSecond/(unit*unit))
	}
	return fmt.Sprintf("%.2f GB/s", bytesPerSecond/(unit*unit*unit))
}

func containsInt(values []int, target int) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func isActivePanelUploadStatus(status string) bool {
	return status == "pending" || status == "uploading" || status == "merging"
}

func isClearablePanelUploadStatus(status string) bool {
	return status == "completed" || status == "failed" || status == "cancelled"
}

func clonePanelMapUploadTask(task *PanelMapUploadTask) *PanelMapUploadTask {
	if task == nil {
		return nil
	}
	clone := *task
	if task.UploadedChunks != nil {
		clone.UploadedChunks = append([]int(nil), task.UploadedChunks...)
	}
	clone.cancelFunc = nil
	return &clone
}
