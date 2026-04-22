package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Block status constants
const (
	blockStatusPending = iota
	blockStatusDownloading
	blockStatusCompleted
	blockStatusFailed
)

// errRangeNotSupported indicates the server does not support Range requests
var errRangeNotSupported = errors.New("range not supported")

// Block represents a fixed-size block for parallel download (default 5MB)
type Block struct {
	Index     int
	StartByte int64
	EndByte   int64
	status    atomic.Int32 // 0=pending, 1=downloading, 2=completed, 3=failed
}

func (b *Block) Status() int     { return int(b.status.Load()) }
func (b *Block) SetStatus(s int) { b.status.Store(int32(s)) }

// BlockManager manages the work queue and global progress for parallel downloads
type BlockManager struct {
	blocks          []*Block
	totalSize       int64
	blockSize       int64
	workerCount     int
	queue           chan int // pending block indices
	completedBlocks atomic.Int32
	failedBlocks    atomic.Int32
	completedBytes  atomic.Int64
	ctx             context.Context
	cancel          context.CancelFunc
	errOnce         sync.Once
	firstErr        error
	errMu           sync.Mutex
	lastReportTime  atomic.Value // stores time.Time
	lastReportBytes atomic.Int64
}

// NewBlockManager creates a BlockManager that splits totalSize into fixed-size blocks
func NewBlockManager(totalSize int64, workerCount int, blockSize int64) *BlockManager {
	if blockSize <= 0 {
		blockSize = 5 * 1024 * 1024 // 5MB default
	}

	numBlocks := int((totalSize + blockSize - 1) / blockSize)
	blocks := make([]*Block, numBlocks)
	for i := 0; i < numBlocks; i++ {
		start := int64(i) * blockSize
		end := start + blockSize - 1
		if end >= totalSize {
			end = totalSize - 1
		}
		blocks[i] = &Block{
			Index:     i,
			StartByte: start,
			EndByte:   end,
		}
	}

	ctx, cancel := context.WithCancel(context.Background())
	bm := &BlockManager{
		blocks:      blocks,
		totalSize:   totalSize,
		blockSize:   blockSize,
		workerCount: workerCount,
		queue:       make(chan int, numBlocks),
	}
	bm.ctx = ctx
	bm.cancel = cancel
	bm.lastReportTime.Store(time.Now())

	// Initialize queue with all block indices
	for i := 0; i < numBlocks; i++ {
		bm.queue <- i
	}
	close(bm.queue)

	return bm
}

// NextBlock retrieves the next pending block from the queue
func (bm *BlockManager) NextBlock() (*Block, bool) {
	for {
		select {
		case <-bm.ctx.Done():
			return nil, false
		case idx, ok := <-bm.queue:
			if !ok {
				return nil, false
			}
			block := bm.blocks[idx]
			// Use CAS to ensure only one worker gets this block
			if block.status.CompareAndSwap(blockStatusPending, blockStatusDownloading) {
				return block, true
			}
			// If not pending, skip (shouldn't happen with closed queue)
		}
	}
}

// MarkCompleted marks a block as completed
func (bm *BlockManager) MarkCompleted(block *Block) {
	block.SetStatus(blockStatusCompleted)
	bm.completedBlocks.Add(1)
}

// MarkFailed marks a block as failed and records the first error
func (bm *BlockManager) MarkFailed(block *Block, err error) {
	block.SetStatus(blockStatusFailed)
	bm.failedBlocks.Add(1)
	bm.errMu.Lock()
	bm.errOnce.Do(func() {
		bm.firstErr = err
	})
	bm.errMu.Unlock()
}

// IsDone checks if all blocks are either completed or failed
func (bm *BlockManager) IsDone() bool {
	completed := bm.completedBlocks.Load()
	failed := bm.failedBlocks.Load()
	return completed+failed >= int32(len(bm.blocks))
}

// HasFatalError returns the first fatal error if any
func (bm *BlockManager) HasFatalError() error {
	bm.errMu.Lock()
	defer bm.errMu.Unlock()
	return bm.firstErr
}

// Progress returns current download progress
func (bm *BlockManager) Progress() (downloaded int64, total int64, percent int) {
	downloaded = bm.completedBytes.Load()
	total = bm.totalSize
	if total > 0 {
		percent = int(float64(downloaded) / float64(total) * 100)
		if percent > 100 {
			percent = 100
		}
	}
	return
}

// Speed calculates and returns current download speed
func (bm *BlockManager) Speed() string {
	now := time.Now()
	lastTime := bm.lastReportTime.Load().(time.Time)
	duration := now.Sub(lastTime)
	if duration < 500*time.Millisecond {
		return ""
	}

	lastBytes := bm.lastReportBytes.Load()
	currentBytes := bm.completedBytes.Load()
	delta := currentBytes - lastBytes
	if delta < 0 {
		delta = 0
	}

	speedBps := float64(delta) / duration.Seconds()

	// Update baseline
	bm.lastReportTime.Store(now)
	bm.lastReportBytes.Store(currentBytes)

	return formatSpeed(speedBps)
}

// createPreallocatedFile creates a file preallocated to the given size
func createPreallocatedFile(path string, size int64) (*os.File, error) {
	file, err := os.Create(path)
	if err != nil {
		return nil, err
	}

	if err := file.Truncate(size); err != nil {
		file.Close()
		os.Remove(path)
		return nil, fmt.Errorf("truncate failed: %w", err)
	}

	return file, nil
}

// buildDownloadTransport creates an HTTP transport with optional optimized IP
func buildDownloadTransport(bestIP string, downloadUrl string) *http.Transport {
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

	return transport
}

// downloadWorker processes blocks from the queue, reusing a single http.Client per worker
func (a *App) downloadWorker(
	workerID int,
	bm *BlockManager,
	file *os.File,
	downloadUrl string,
	bestIP string,
) {
	const maxRetries = 3

	// One client per worker so connections can be reused across blocks via HTTP keep-alive
	transport := buildDownloadTransport(bestIP, downloadUrl)
	client := &http.Client{
		Transport: transport,
		Timeout:   0,
	}

	for {
		block, ok := bm.NextBlock()
		if !ok {
			return
		}

		var lastErr error
		for attempt := 0; attempt < maxRetries; attempt++ {
			if attempt > 0 {
				select {
				case <-bm.ctx.Done():
					return
				case <-time.After(time.Duration(attempt) * time.Second):
				}
			}

			err := a.downloadBlock(bm.ctx, block, file, client, downloadUrl, bm)
			if err == nil {
				bm.MarkCompleted(block)
				break
			}

			lastErr = err

			if errors.Is(err, errRangeNotSupported) {
				bm.MarkFailed(block, err)
				bm.cancel()
				return
			}

			if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
				return
			}
		}

		if block.Status() != blockStatusCompleted {
			bm.MarkFailed(block, lastErr)
			bm.cancel()
			return
		}
	}
}

// downloadBlock downloads a single block and writes it directly to the file at the correct offset
func (a *App) downloadBlock(
	ctx context.Context,
	block *Block,
	file *os.File,
	client *http.Client,
	downloadUrl string,
	bm *BlockManager,
) error {
	req, err := http.NewRequestWithContext(ctx, "GET", downloadUrl, nil)
	if err != nil {
		return err
	}

	req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", block.StartByte, block.EndByte))
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Referer", "https://steamcommunity.com/")
	req.Header.Set("Accept", "*/*")

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		return errRangeNotSupported
	}
	if resp.StatusCode != http.StatusPartialContent {
		return fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	offset := block.StartByte
	buf := make([]byte, 256*1024) // 256KB buffer

	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			written, writeErr := file.WriteAt(buf[:n], offset)
			if writeErr != nil {
				return fmt.Errorf("write at offset %d failed: %w", offset, writeErr)
			}
			offset += int64(written)
			bm.completedBytes.Add(int64(written))
		}
		if readErr != nil {
			if errors.Is(readErr, io.EOF) {
				break
			}
			return readErr
		}
	}

	expected := block.EndByte - block.StartByte + 1
	actual := offset - block.StartByte
	if actual != expected {
		return fmt.Errorf("block %d size mismatch: expected %d, got %d", block.Index, expected, actual)
	}

	return nil
}

// progressReporter periodically reports download progress to the frontend
func (a *App) progressReporter(bm *BlockManager, task *DownloadTask, stopChan <-chan struct{}) {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-stopChan:
			return
		case <-ticker.C:
			downloaded, _, percent := bm.Progress()
			speed := bm.Speed()

			taskManager.mu.Lock()
			task.DownloadedSize = downloaded
			task.Progress = percent
			if speed != "" {
				task.Speed = speed
			}
			taskManager.mu.Unlock()

			runtime.EventsEmit(a.ctx, "task_progress", task)
		}
	}
}
