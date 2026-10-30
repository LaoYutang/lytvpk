package app

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type pauseTestRequest struct {
	rangeHeader string
	ifRange     string
	encoding    string
}

type pauseTestServer struct {
	url            string
	requests       chan pauseTestRequest
	firstChunkSent chan struct{}
	firstClosed    chan struct{}
	getCount       atomic.Int32
}

func newPauseTestServer(t *testing.T, payload []byte, mode string) *pauseTestServer {
	t.Helper()
	const firstChunk = 16 * 1024
	const etag = `"pause-test-v1"`
	testServer := &pauseTestServer{
		requests:       make(chan pauseTestRequest, 8),
		firstChunkSent: make(chan struct{}),
		firstClosed:    make(chan struct{}),
	}
	releaseFirst := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if mode != "no-etag" {
			w.Header().Set("ETag", etag)
		}
		if r.Method == http.MethodHead {
			w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
			return
		}
		if got := r.Header.Get("Accept-Encoding"); got != "identity" {
			t.Errorf("GET Accept-Encoding = %q, want identity", got)
		}
		attempt := testServer.getCount.Add(1)
		rangeHeader := r.Header.Get("Range")
		testServer.requests <- pauseTestRequest{rangeHeader: rangeHeader, ifRange: r.Header.Get("If-Range"), encoding: r.Header.Get("Accept-Encoding")}
		if attempt == 1 {
			if mode == "content-disposition" {
				w.Header().Set("Content-Disposition", `attachment; filename="original.vpk"`)
			}
			w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(payload[:firstChunk])
			w.(http.Flusher).Flush()
			close(testServer.firstChunkSent)
			select {
			case <-r.Context().Done():
				close(testServer.firstClosed)
			case <-releaseFirst:
			}
			return
		}
		if rangeHeader != "" && mode != "ignore-range" {
			startText := strings.TrimSuffix(strings.TrimPrefix(rangeHeader, "bytes="), "-")
			start, err := strconv.ParseInt(startText, 10, 64)
			if err != nil || start < 0 || start >= int64(len(payload)) {
				w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
				return
			}
			if mode == "bad-content-range" {
				w.Header().Set("Content-Range", fmt.Sprintf("bytes 0-%d/%d", len(payload)-1, len(payload)))
				w.WriteHeader(http.StatusPartialContent)
				_, _ = w.Write(payload)
				return
			}
			w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, len(payload)-1, len(payload)))
			w.WriteHeader(http.StatusPartialContent)
			_, _ = w.Write(payload[start:])
			return
		}
		w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
		_, _ = w.Write(payload)
	}))
	t.Cleanup(server.Close)
	t.Cleanup(func() { close(releaseFirst) })
	testServer.url = server.URL + "/mod.vpk"
	return testServer
}

func pauseTestTask(t *testing.T, app *App, url string, size int) string {
	t.Helper()
	return pauseTestTaskDetails(t, app, WorkshopFileDetails{
		PublishedFileId: "987654321",
		Filename:        "mod.vpk",
		FileUrl:         url,
		FileSize:        strconv.Itoa(size),
	})
}

func pauseTestTaskDetails(t *testing.T, app *App, details WorkshopFileDetails) string {
	t.Helper()
	id := app.StartDownloadTask(details, false)
	t.Cleanup(func() {
		app.CancelDownloadTask(id)
		taskManager.mu.Lock()
		delete(taskManager.tasks, id)
		taskManager.mu.Unlock()
	})
	return id
}

func pauseTestSnapshot(t *testing.T, id string) DownloadTask {
	t.Helper()
	taskManager.mu.RLock()
	task := taskManager.tasks[id]
	if task == nil {
		taskManager.mu.RUnlock()
		t.Fatalf("download task %s disappeared", id)
	}
	snapshot := *task
	taskManager.mu.RUnlock()
	return snapshot
}

func waitPauseTestTask(t *testing.T, id string, want func(DownloadTask) bool) DownloadTask {
	t.Helper()
	deadline := time.After(15 * time.Second)
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		snapshot := pauseTestSnapshot(t, id)
		if want(snapshot) {
			return snapshot
		}
		select {
		case <-deadline:
			t.Fatalf("timed out waiting for task %s; latest state: status=%q downloaded=%d error=%q", id, snapshot.Status, snapshot.DownloadedSize, snapshot.Error)
		case <-ticker.C:
		}
	}
}

func waitPauseTestSignal(t *testing.T, signal <-chan struct{}, description string) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(15 * time.Second):
		t.Fatalf("timed out waiting for %s", description)
	}
}

func waitPauseTestRequest(t *testing.T, requests <-chan pauseTestRequest) pauseTestRequest {
	t.Helper()
	select {
	case request := <-requests:
		return request
	case <-time.After(15 * time.Second):
		t.Fatal("timed out waiting for download request")
		return pauseTestRequest{}
	}
}

func pauseTestPayload() []byte {
	return bytes.Repeat([]byte("0123456789abcdef"), 8*1024)
}

func startAndPauseTestTask(t *testing.T, app *App, server *pauseTestServer, payload []byte) string {
	t.Helper()
	id := pauseTestTask(t, app, server.url, len(payload))
	initial := waitPauseTestRequest(t, server.requests)
	if initial.rangeHeader != "" {
		t.Fatalf("initial request unexpectedly contained Range: %q", initial.rangeHeader)
	}
	waitPauseTestSignal(t, server.firstChunkSent, "first download chunk")
	waitPauseTestTask(t, id, func(task DownloadTask) bool {
		return task.Status == "downloading" && task.DownloadedSize >= 16*1024
	})
	if err := app.PauseDownloadTask(id); err != nil {
		t.Fatalf("pause active download: %v", err)
	}
	waitPauseTestSignal(t, server.firstClosed, "first request cancellation")
	waitPauseTestTask(t, id, func(task DownloadTask) bool { return task.Status == "paused" })
	return id
}

func assertPauseTestCompletedFile(t *testing.T, app *App, id string, payload []byte) {
	t.Helper()
	task := waitPauseTestTask(t, id, func(task DownloadTask) bool { return task.Status == "completed" || task.Status == "failed" })
	if task.Status != "completed" {
		t.Fatalf("download failed: %s", task.Error)
	}
	path := task.FilePath
	if path == "" {
		path = filepath.Join(app.rootDir, "987654321.vpk")
	}
	actual, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read downloaded file: %v", err)
	}
	if !bytes.Equal(actual, payload) {
		t.Fatalf("downloaded content mismatch: got %d bytes, want %d", len(actual), len(payload))
	}
}

func TestWorkshopPauseResumeUsesRangeAndETag(t *testing.T) {
	payload := pauseTestPayload()
	server := newPauseTestServer(t, payload, "range")
	app := &App{rootDir: t.TempDir(), ctx: context.Background()}
	id := startAndPauseTestTask(t, app, server, payload)
	if err := app.ResumeDownloadTask(id); err != nil {
		t.Fatalf("resume paused download: %v", err)
	}
	if err := app.ResumeDownloadTask(id); err == nil {
		t.Fatal("duplicate resume started another worker")
	}
	request := waitPauseTestRequest(t, server.requests)
	if request.rangeHeader != "bytes=16384-" || request.ifRange != `"pause-test-v1"` {
		t.Fatalf("resume request missing safe Range/If-Range headers: %+v", request)
	}
	assertPauseTestCompletedFile(t, app, id, payload)
	if got := server.getCount.Load(); got != 2 {
		t.Fatalf("expected one initial and one resumed GET, got %d", got)
	}
}

func TestWorkshopPauseResumePreservesInitialContentDisposition(t *testing.T) {
	payload := pauseTestPayload()
	server := newPauseTestServer(t, payload, "content-disposition")
	app := &App{rootDir: t.TempDir(), ctx: context.Background()}
	id := pauseTestTaskDetails(t, app, WorkshopFileDetails{
		PublishedFileId: "direct-content-disposition",
		Filename:        "placeholder.tmp",
		FileUrl:         server.url,
		FileSize:        strconv.Itoa(len(payload)),
	})
	initial := waitPauseTestRequest(t, server.requests)
	if initial.rangeHeader != "" {
		t.Fatalf("initial request unexpectedly contained Range: %q", initial.rangeHeader)
	}
	waitPauseTestSignal(t, server.firstChunkSent, "first download chunk")
	waitPauseTestTask(t, id, func(task DownloadTask) bool {
		return task.Status == "downloading" && task.DownloadedSize >= 16*1024
	})
	if err := app.PauseDownloadTask(id); err != nil {
		t.Fatalf("pause active download: %v", err)
	}
	waitPauseTestSignal(t, server.firstClosed, "first request cancellation")
	waitPauseTestTask(t, id, func(task DownloadTask) bool { return task.Status == "paused" })
	if err := app.ResumeDownloadTask(id); err != nil {
		t.Fatalf("resume paused download: %v", err)
	}
	resumed := waitPauseTestRequest(t, server.requests)
	if resumed.rangeHeader != "bytes=16384-" {
		t.Fatalf("resume did not send Range: %+v", resumed)
	}
	task := waitPauseTestTask(t, id, func(task DownloadTask) bool { return task.Status == "completed" || task.Status == "failed" })
	if task.Status != "completed" {
		t.Fatalf("download failed: %s", task.Error)
	}
	if task.Title != "original.vpk" || filepath.Ext(task.Filename) != ".vpk" || filepath.Ext(task.FilePath) != ".vpk" {
		t.Fatalf("initial Content-Disposition filename was lost after 206: title=%q filename=%q path=%q", task.Title, task.Filename, task.FilePath)
	}
	actual, err := os.ReadFile(task.FilePath)
	if err != nil {
		t.Fatalf("read downloaded file: %v", err)
	}
	if !bytes.Equal(actual, payload) {
		t.Fatalf("downloaded content mismatch: got %d bytes, want %d", len(actual), len(payload))
	}
}

func TestWorkshopPauseResumeRestartsWhenRangeIgnored(t *testing.T) {
	payload := pauseTestPayload()
	server := newPauseTestServer(t, payload, "ignore-range")
	app := &App{rootDir: t.TempDir(), ctx: context.Background()}
	id := startAndPauseTestTask(t, app, server, payload)
	if err := app.ResumeDownloadTask(id); err != nil {
		t.Fatalf("resume paused download: %v", err)
	}
	request := waitPauseTestRequest(t, server.requests)
	if request.rangeHeader != "bytes=16384-" {
		t.Fatalf("resume did not first attempt Range: %+v", request)
	}
	assertPauseTestCompletedFile(t, app, id, payload)
}

func TestWorkshopPauseResumeWithoutETagStartsFromZero(t *testing.T) {
	payload := pauseTestPayload()
	server := newPauseTestServer(t, payload, "no-etag")
	app := &App{rootDir: t.TempDir(), ctx: context.Background()}
	id := startAndPauseTestTask(t, app, server, payload)
	paused := pauseTestSnapshot(t, id)
	if paused.DownloadedSize != 0 || paused.Progress != 0 {
		t.Fatalf("unverifiable partial download was retained: downloaded=%d progress=%d", paused.DownloadedSize, paused.Progress)
	}
	entries, err := os.ReadDir(filepath.Join(app.rootDir, "temp"))
	if err != nil {
		t.Fatalf("read temporary download directory: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("unverifiable partial download left %d temporary files", len(entries))
	}
	if err := app.ResumeDownloadTask(id); err != nil {
		t.Fatalf("resume paused download: %v", err)
	}
	request := waitPauseTestRequest(t, server.requests)
	if request.rangeHeader != "" || request.ifRange != "" {
		t.Fatalf("download without a strong ETag should restart from zero: %+v", request)
	}
	assertPauseTestCompletedFile(t, app, id, payload)
	if got := server.getCount.Load(); got != 2 {
		t.Fatalf("expected one interrupted and one fresh GET, got %d", got)
	}
}

func TestWorkshopPauseResumeRejectsInvalidContentRange(t *testing.T) {
	payload := pauseTestPayload()
	server := newPauseTestServer(t, payload, "bad-content-range")
	app := &App{rootDir: t.TempDir(), ctx: context.Background()}
	id := startAndPauseTestTask(t, app, server, payload)
	if err := app.ResumeDownloadTask(id); err != nil {
		t.Fatalf("resume paused download: %v", err)
	}
	request := waitPauseTestRequest(t, server.requests)
	if request.rangeHeader != "bytes=16384-" {
		t.Fatalf("resume did not send Range: %+v", request)
	}
	task := waitPauseTestTask(t, id, func(task DownloadTask) bool { return task.Status == "completed" || task.Status == "failed" })
	if task.Status != "failed" {
		t.Fatal("accepted a response with an inconsistent Content-Range")
	}
	if _, err := os.Stat(filepath.Join(app.rootDir, "987654321.vpk")); !os.IsNotExist(err) {
		t.Fatalf("invalid Content-Range left a completed file: %v", err)
	}
}

func TestWorkshopPauseCancelAndDuplicateTransitions(t *testing.T) {
	payload := pauseTestPayload()
	server := newPauseTestServer(t, payload, "range")
	app := &App{rootDir: t.TempDir(), ctx: context.Background()}
	id := startAndPauseTestTask(t, app, server, payload)
	_ = app.PauseDownloadTask(id)
	if status := pauseTestSnapshot(t, id).Status; status != "paused" {
		t.Fatalf("duplicate pause changed status to %q", status)
	}
	app.CancelDownloadTask(id)
	waitPauseTestTask(t, id, func(task DownloadTask) bool { return task.Status == "cancelled" })
	entries, err := os.ReadDir(filepath.Join(app.rootDir, "temp"))
	if err != nil {
		t.Fatalf("read temporary download directory: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("cancelled paused download left %d temporary files", len(entries))
	}
	if err := app.ResumeDownloadTask(id); err == nil {
		t.Fatal("cancelled download was resumable")
	}
	if status := pauseTestSnapshot(t, id).Status; status != "cancelled" {
		t.Fatalf("resume after cancellation changed status to %q", status)
	}
	if got := server.getCount.Load(); got != 1 {
		t.Fatalf("cancelled task initiated another GET: %d", got)
	}
}

func TestWorkshopPauseResumeChunkedSkipsCompletedBlock(t *testing.T) {
	const blockSize = 5 * 1024 * 1024
	const etag = `"chunk-pause-v1"`
	payload := bytes.Repeat([]byte("abcdefgh01234567"), (blockSize+64*1024)/16)
	requests := make(chan pauseTestRequest, 16)
	secondBlockStarted := make(chan struct{})
	secondBlockClosed := make(chan struct{})
	releaseSecondBlock := make(chan struct{})
	var probes, firstBlocks, secondBlocks atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", etag)
		if r.Method == http.MethodHead {
			w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
			return
		}
		header := r.Header.Get("Range")
		requests <- pauseTestRequest{rangeHeader: header, ifRange: r.Header.Get("If-Range")}
		var start, end int64
		if _, err := fmt.Sscanf(header, "bytes=%d-%d", &start, &end); err != nil || start < 0 || end < start || end >= int64(len(payload)) {
			w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
			return
		}
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, len(payload)))
		w.Header().Set("Content-Length", strconv.FormatInt(end-start+1, 10))
		w.WriteHeader(http.StatusPartialContent)
		if start == 0 && end == 0 {
			probes.Add(1)
			_, _ = w.Write(payload[:1])
			return
		}
		if start == 0 && end == blockSize-1 {
			firstBlocks.Add(1)
			_, _ = w.Write(payload[:blockSize])
			return
		}
		if start == blockSize && end == int64(len(payload))-1 {
			if secondBlocks.Add(1) == 1 {
				_, _ = w.Write(payload[blockSize : blockSize+4096])
				w.(http.Flusher).Flush()
				close(secondBlockStarted)
				select {
				case <-r.Context().Done():
					close(secondBlockClosed)
				case <-releaseSecondBlock:
				}
				return
			}
			_, _ = w.Write(payload[blockSize:])
			return
		}
	}))
	t.Cleanup(server.Close)
	t.Cleanup(func() { close(releaseSecondBlock) })
	app := &App{rootDir: t.TempDir(), ctx: context.Background()}
	id := pauseTestTask(t, app, server.URL+"/chunk.vpk", len(payload))
	waitPauseTestSignal(t, secondBlockStarted, "second block request")
	waitPauseTestTask(t, id, func(task DownloadTask) bool {
		return task.Status == "downloading" && task.DownloadedSize >= blockSize
	})
	if err := app.PauseDownloadTask(id); err != nil {
		t.Fatalf("pause chunked download: %v", err)
	}
	waitPauseTestSignal(t, secondBlockClosed, "second block cancellation")
	waitPauseTestTask(t, id, func(task DownloadTask) bool { return task.Status == "paused" })
	if err := app.ResumeDownloadTask(id); err != nil {
		t.Fatalf("resume chunked download: %v", err)
	}
	assertPauseTestCompletedFile(t, app, id, payload)
	if got := probes.Load(); got != 2 {
		t.Fatalf("expected one range probe per run, got %d", got)
	}
	if got := firstBlocks.Load(); got != 1 {
		t.Fatalf("completed first block was downloaded %d times", got)
	}
	if got := secondBlocks.Load(); got != 2 {
		t.Fatalf("incomplete second block was downloaded %d times", got)
	}
	close(requests)
	var resumedProbe, resumedBlock bool
	for request := range requests {
		if request.rangeHeader == "bytes=0-0" && request.ifRange == etag {
			resumedProbe = true
		}
		if request.rangeHeader == fmt.Sprintf("bytes=%d-%d", blockSize, len(payload)-1) && request.ifRange == etag {
			resumedBlock = true
		}
	}
	if !resumedProbe || !resumedBlock {
		t.Fatalf("resumed chunk requests did not use If-Range: probe=%v block=%v", resumedProbe, resumedBlock)
	}
}
