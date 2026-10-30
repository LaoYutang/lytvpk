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
	"log"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

	"vpk-manager/internal/network"
)

var downloadTaskSequence atomic.Uint64

func (a *App) StartDownloadTask(details WorkshopFileDetails, useOptimizedIP bool) string {
	taskID := fmt.Sprintf("%d-%d", time.Now().UnixNano(), downloadTaskSequence.Add(1))

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
	rootDir := a.GetRootDirectory()

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
		rootDir:        rootDir,
	}

	a.downloadExitMu.Lock()
	exitBlocked := a.downloadExitRequested
	if exitBlocked {
		cancel()
		task.Status = "failed"
		task.Error = "程序正在退出，无法开始新下载"
	}
	taskManager.mu.Lock()
	taskManager.tasks[taskID] = task
	taskManager.mu.Unlock()
	a.downloadExitMu.Unlock()
	if exitBlocked {
		a.emitDownloadTaskEvent("task_updated", task)
		return taskID
	}
	if err := a.persistDownloadTasksNow(); err != nil {
		log.Printf("保存下载任务记录失败: %v", err)
		cancel()
		taskManager.mu.Lock()
		task.Status = "failed"
		task.Error = "无法保存下载任务记录: " + err.Error()
		taskManager.mu.Unlock()
		a.emitDownloadTaskEvent("task_updated", task)
		return taskID
	}

	go a.processDownloadTask(ctx, task, details.FileUrl)

	return taskID
}

func (a *App) processDownloadTask(ctx context.Context, task *DownloadTask, downloadUrl string) {
	defer a.finishDownloadRun(task)
	downloadRoot := task.rootDir
	if downloadRoot == "" {
		downloadRoot = a.GetRootDirectory()
	}
	updateStatus := func(status string, err string) {
		taskManager.mu.Lock()
		if task.Status != "pausing" && task.Status != "cancelling" && ctx.Err() == nil {
			if status == "downloading" && task.Status == "finalizing" {
				task.Notice = err
			} else {
				if status == "failed" {
					task.Status = "failing"
				} else {
					task.Status = status
				}
				task.Error = err
			}
		}
		taskManager.mu.Unlock()
		a.emitDownloadTaskEvent("task_updated", task)
	}

	if ctx.Err() != nil {
		return
	}
	updateStatus("downloading", "")

	if downloadRoot == "" {
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
		taskManager.mu.Lock()
		task.UseOptimizedIP = true
		taskManager.mu.Unlock()
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
	if ctx.Err() != nil {
		return
	}

	// Ensure temp directory exists
	tempDir := filepath.Join(downloadRoot, "temp")
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
			a.emitDownloadTaskEvent("task_updated", task)
		}
	}
	if ctx.Err() != nil {
		return
	}

	// Calculate optimal thread count based on file size (max 8 threads)
	threadCount := network.CalculateThreadCount(totalSize, 8)

	// Use chunked download if multiple threads are needed
	taskManager.mu.RLock()
	resumeSingle := task.transfer != nil && task.transfer.mode == "single"
	taskManager.mu.RUnlock()
	if !resumeSingle && threadCount > 1 && totalSize > 0 {
		fmt.Printf("[Download] Using %d-thread download for %s (Size: %.2f MB)\n",
			threadCount, task.Filename, float64(totalSize)/1024/1024)

		finalPath, err := a.processChunkedDownload(ctx, task, downloadUrl, bestIP, totalSize, threadCount, tempDir)
		if err != nil {
			// Parallel chunks need a strong file identity. If unavailable,
			// start a fresh single-connection transfer.
			if errors.Is(err, errChunkResumeProbeNotConfirmed) {
				// One probe cannot establish that the old complete blocks are
				// obsolete. Keep them paused for a later explicit retry.
				taskManager.mu.Lock()
				if ctx.Err() == nil && task.Status != "pausing" && task.Status != "cancelling" {
					task.Status = "pausing"
					task.Notice = "服务器暂未确认已有分块的版本，已保留进度；稍后可再试继续"
				}
				taskManager.mu.Unlock()
				return
			} else if errors.Is(err, errRangeNotSupported) {
				if errors.Is(err, errRangeMissingStrongETag) {
					fmt.Printf("[Download] Range response has no strong ETag; downloading from zero with a single connection\n")
				} else {
					fmt.Printf("[Download] Parallel byte-range download unavailable; using a single connection\n")
				}
				// Continue to single-thread download below
			} else if ctx.Err() != nil {
				return
			} else {
				updateStatus("failed", err.Error())
				return
			}
		} else {
			// Chunked download succeeded
			if !a.beginDownloadFinalizing(ctx, task) {
				return
			}
			targetPath := filepath.Join(downloadRoot, filepath.Base(task.Filename))

			// For direct downloads, use timestamp for uniqueness
			if strings.HasPrefix(task.WorkshopID, "direct-") {
				ext := filepath.Ext(task.Filename)
				ms := time.Now().UnixNano() / int64(time.Millisecond)
				newFilename := fmt.Sprintf("%d%s", ms, ext)
				taskManager.mu.Lock()
				task.Filename = newFilename
				taskManager.mu.Unlock()
				targetPath = filepath.Join(downloadRoot, newFilename)
				a.emitDownloadTaskEvent("task_updated", task)
			}

			if err := os.Rename(finalPath, targetPath); err != nil {
				updateStatus("failed", "Rename failed: "+err.Error())
				return
			}
			taskManager.mu.Lock()
			task.transfer = nil
			taskManager.mu.Unlock()

			// Download preview image
			a.downloadPreviewImage(task, targetPath)

			// Auto extract for archives
			a.handleArchiveExtraction(task, targetPath, downloadRoot, updateStatus)

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

			// 替换同workshopId的旧mod
			targetPath = a.replaceExistingMod(targetPath, task.WorkshopID, downloadRoot)
			setDownloadTaskFilePath(task, targetPath)

			updateStatus("completed", "")
			return
		}
	}

	// Single-thread download (also used when the server rejects byte ranges).
	tempPath, cd, err := a.downloadSingle(ctx, task, downloadUrl, bestIP, tempDir)
	if err != nil {
		if ctx.Err() == nil {
			updateStatus("failed", err.Error())
		}
		return
	}
	if !a.beginDownloadFinalizing(ctx, task) {
		return
	}
	targetPath := filepath.Join(downloadRoot, filepath.Base(task.Filename))

	// Prefer the filename supplied by the server for direct downloads.
	if cd != "" {
		if _, params, mimeErr := mime.ParseMediaType(cd); mimeErr == nil {
			if filename := cleanFilename(params["filename"]); filename != "" {
				if !strings.HasPrefix(task.WorkshopID, "direct-") {
					filename = fmt.Sprintf("%s%s", task.WorkshopID, filepath.Ext(filename))
				}
				if strings.HasPrefix(task.WorkshopID, "direct-") || strings.HasPrefix(task.Filename, "unknown") {
					taskManager.mu.Lock()
					task.Filename = filename
					if strings.HasPrefix(task.WorkshopID, "direct-") {
						task.Title = filename
					}
					taskManager.mu.Unlock()
					targetPath = filepath.Join(downloadRoot, filename)
					a.emitDownloadTaskEvent("task_updated", task)
				}
			}
		}
	}
	if task.Filename == "unknown.vpk" || task.Filename == "" {
		newFilename := fmt.Sprintf("unknown_%d.vpk", time.Now().Unix())
		taskManager.mu.Lock()
		task.Filename = newFilename
		taskManager.mu.Unlock()
		targetPath = filepath.Join(downloadRoot, newFilename)
		a.emitDownloadTaskEvent("task_updated", task)
	}

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

		targetPath = filepath.Join(downloadRoot, newFilename)
		a.emitDownloadTaskEvent("task_updated", task)
	}

	// Rename to final
	if err := os.Rename(tempPath, targetPath); err != nil {
		updateStatus("failed", "Rename failed: "+err.Error())
		return
	}
	taskManager.mu.Lock()
	task.transfer = nil
	taskManager.mu.Unlock()

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

	// 替换名workshopId的旧mod
	targetPath = a.replaceExistingMod(targetPath, task.WorkshopID, downloadRoot)

	// 如果是直连下载且是压缩文件，自动解压
	ext := strings.ToLower(filepath.Ext(targetPath))
	if strings.HasPrefix(task.WorkshopID, "direct-") && (ext == ".zip" || ext == ".rar" || ext == ".7z") {
		updateStatus("downloading", "正在解压...")
		err := a.ExtractVPKFromArchive(targetPath, downloadRoot)
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

	setDownloadTaskFilePath(task, targetPath)
	updateStatus("completed", "")
}

// replaceExistingMod 下载完成后，查找同workshopId的旧mod并替换
// 将新文件移动到旧mod所在目录，删才旧文件及其关联文件
func (a *App) replaceExistingMod(newFilePath string, workshopID string, downloadRoot string) string {
	if workshopID == "" || strings.HasPrefix(workshopID, "direct-") {
		return newFilePath
	}

	var oldFilePath string
	var oldLocation string

	a.vpkCache.Range(func(key, value interface{}) bool {
		cache := value.(*VPKFileCache)
		rel, relErr := filepath.Rel(downloadRoot, cache.File.Path)
		if relErr == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && cache.File.WorkshopID == workshopID && cache.File.Path != newFilePath {
			oldFilePath = cache.File.Path
			oldLocation = cache.File.Location
			return false
		}
		return true
	})

	if oldFilePath == "" {
		return newFilePath
	}

	log.Printf("发玏同ID旧Mod: %s (位置: %s)，准勇替换", oldFilePath, oldLocation)

	// 标换旧mod位置确定目录
	var targetDir string
	switch oldLocation {
	case "disabled":
		targetDir = filepath.Join(downloadRoot, "disabled")
	case "workshop":
		targetDir = filepath.Join(downloadRoot, "workshop")
	default:
		targetDir = downloadRoot
	}

	// 删才旧文件及其关联文件（.meta, 预览图）
	oldBase := strings.TrimSuffix(oldFilePath, filepath.Ext(oldFilePath))
	for _, ext := range []string{filepath.Ext(oldFilePath), ".meta", ".jpg", ".png", ".jpeg", ".gif"} {
		if ext == "" {
			continue
		}
		associatePath := oldBase + ext
		if err := os.Remove(associatePath); err != nil && !os.IsNotExist(err) {
			log.Printf("删才旧关联文件失败: %s, %v", associatePath, err)
		}
	}

	// 移动新文件到目录目录
	newFilename := filepath.Base(newFilePath)
	targetPath := filepath.Join(targetDir, newFilename)

	// 如果目录目录与旧mod目录目录目录，无需移动
	if filepath.Dir(newFilePath) == targetDir {
		log.Printf("新文件圂目录目录: %s", targetPath)
		return targetPath
	}

	if err := os.Rename(newFilePath, targetPath); err != nil {
		log.Printf("移动新文件到目彗目录失败: %s -> %s, %v", newFilePath, targetPath, err)
		return newFilePath
	}

	// 同旦移动新文件的关联文件（.meta, 预览图）
	newBase := strings.TrimSuffix(newFilePath, filepath.Ext(newFilePath))
	targetBase := strings.TrimSuffix(targetPath, filepath.Ext(targetPath))
	for _, ext := range []string{".meta", ".jpg", ".png", ".jpeg", ".gif"} {
		srcPath := newBase + ext
		dstPath := targetBase + ext
		if _, err := os.Stat(srcPath); err == nil {
			if err := os.Rename(srcPath, dstPath); err != nil {
				log.Printf("移动关聚文件失败: %s -> %s, %v", srcPath, dstPath, err)
			}
		}
	}

	log.Printf("已替捩旧Mod，新文件位罎: %s", targetPath)
	return targetPath
}
