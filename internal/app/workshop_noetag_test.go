package app

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

const noETagPartialBytes = 128 * 1024

type noETagWholeSource struct {
	url         string
	firstSent   chan struct{}
	firstClosed chan struct{}
	firstResume chan struct{}
	firstOnce   sync.Once
	secondSent  chan struct{}
	secondHold  chan struct{}
	secondOnce  sync.Once
	holdSecond  atomic.Bool
	probes      atomic.Int32
	fullGets    atomic.Int32
	mu          sync.RWMutex
	payload     []byte
}

// The source answers an initial range probe correctly but provides neither
// ETag nor Last-Modified. The first whole-file GET stops after a real prefix.
func newNoETagWholeSource(t *testing.T, payload []byte) *noETagWholeSource {
	t.Helper()
	source := &noETagWholeSource{
		firstSent: make(chan struct{}), firstClosed: make(chan struct{}),
		firstResume: make(chan struct{}),
		secondSent:  make(chan struct{}), secondHold: make(chan struct{}), payload: payload,
	}
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		source.mu.RLock()
		current := source.payload
		source.mu.RUnlock()
		w.Header().Set("Content-Length", strconv.Itoa(len(current)))
		if r.Method == http.MethodHead {
			return
		}
		if got := r.Header.Get("Accept-Encoding"); got != "identity" {
			t.Errorf("GET Accept-Encoding = %q, want identity", got)
		}
		if requestRange := r.Header.Get("Range"); requestRange != "" {
			if requestRange != "bytes=0-0" {
				t.Errorf("unexpected range without a validator: %q", requestRange)
				w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
				return
			}
			source.probes.Add(1)
			w.Header().Set("Content-Range", fmt.Sprintf("bytes 0-0/%d", len(current)))
			w.Header().Set("Content-Length", "1")
			w.WriteHeader(http.StatusPartialContent)
			_, _ = w.Write(current[:1])
			return
		}
		fullGet := source.fullGets.Add(1)
		if fullGet == 1 {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(current[:noETagPartialBytes])
			w.(http.Flusher).Flush()
			close(source.firstSent)
			select {
			case <-r.Context().Done():
				close(source.firstClosed)
			case <-source.firstResume:
				_, _ = w.Write(current[noETagPartialBytes:])
			case <-release:
			}
			return
		}
		if fullGet == 2 && source.holdSecond.Load() {
			w.WriteHeader(http.StatusOK)
			w.(http.Flusher).Flush()
			close(source.secondSent)
			select {
			case <-source.secondHold:
			case <-r.Context().Done():
				return
			}
		}
		_, _ = w.Write(current)
	}))
	// Cleanup is LIFO: release a blocked handler before waiting in Close.
	t.Cleanup(func() { server.CloseClientConnections(); server.Close() })
	t.Cleanup(func() { close(release) })
	t.Cleanup(source.releaseSecond)
	source.url = server.URL + "/no-etag.vpk"
	return source
}

func (source *noETagWholeSource) setPayload(payload []byte) {
	source.mu.Lock()
	source.payload = payload
	source.mu.Unlock()
}

func (source *noETagWholeSource) releaseSecond() {
	source.secondOnce.Do(func() { close(source.secondHold) })
}

func (source *noETagWholeSource) resumeFirst() {
	source.firstOnce.Do(func() { close(source.firstResume) })
}

func noETagLargePayload() []byte {
	return bytes.Repeat([]byte("abcdefgh01234567"), (5*1024*1024+64*1024)/16)
}

func startNoETagWholeAndPause(t *testing.T, app *App, source *noETagWholeSource) string {
	t.Helper()
	id := app.StartDownloadTask(WorkshopFileDetails{
		PublishedFileId: "987654321", Filename: "mod.vpk", FileUrl: source.url,
	}, false)
	waitPauseTestSignal(t, source.firstSent, "unvalidated whole-file response prefix")
	waitPauseTestTask(t, id, func(task DownloadTask) bool {
		return task.Status == "downloading" && task.DownloadedSize >= 16*1024
	})
	if err := app.PauseDownloadTask(id); err == nil || !strings.Contains(err.Error(), downloadPauseConfirmationKnown) {
		t.Fatalf("unverified bytes should require pause confirmation: %v", err)
	}
	if task := pauseTestSnapshot(t, id); task.Status != "downloading" || task.DownloadedSize < 16*1024 {
		t.Fatalf("unconfirmed pause changed active download: status=%q downloaded=%d", task.Status, task.DownloadedSize)
	}
	select {
	case <-source.firstClosed:
		t.Fatal("unconfirmed pause cancelled the original request")
	default:
	}
	if err := app.ConfirmPauseDownloadTask(id); err != nil {
		t.Fatalf("confirm no-ETag pause: %v", err)
	}
	waitPauseTestSignal(t, source.firstClosed, "no-ETag request cancellation")
	waitPauseTestTask(t, id, func(task DownloadTask) bool { return task.Status == "paused" })
	return id
}

func assertNoETagPausedReset(t *testing.T, root, id string) {
	t.Helper()
	paused := pauseTestSnapshot(t, id)
	if paused.DownloadedSize != 0 || paused.Progress != 0 || paused.transfer != nil || !strings.Contains(paused.Notice, "从头") {
		t.Fatalf("unverifiable pause was shown as resumable: downloaded=%d progress=%d transfer=%+v notice=%q", paused.DownloadedSize, paused.Progress, paused.transfer, paused.Notice)
	}
	tempPath := filepath.Join(root, "temp", id+"_single")
	if _, err := os.Stat(tempPath); !os.IsNotExist(err) {
		t.Fatalf("unverifiable temporary file was retained after pause: %v", err)
	}
}

func TestNoETagLargeRangeSourceRestartsFromZeroWithinSession(t *testing.T) {
	isolatePersistentDownloadTasks(t)
	payload := noETagLargePayload()
	source := newNoETagWholeSource(t, payload)
	root, config := t.TempDir(), t.TempDir()
	app := newPersistentDownloadTestApp(root, config)
	id := startNoETagWholeAndPause(t, app, source)
	assertNoETagPausedReset(t, root, id)
	if source.probes.Load() != 1 || source.fullGets.Load() != 1 {
		t.Fatalf("source did not take whole-file fallback: probes=%d full=%d", source.probes.Load(), source.fullGets.Load())
	}
	source.holdSecond.Store(true)
	if err := app.ResumeDownloadTask(id); err != nil {
		t.Fatal(err)
	}
	waitPauseTestSignal(t, source.secondSent, "fresh whole-file GET after resume")
	waitPauseTestTask(t, id, func(task DownloadTask) bool {
		return task.Status == "downloading" && task.DownloadedSize == 0 && task.Progress == 0
	})
	info, err := os.Stat(filepath.Join(root, "temp", id+"_single"))
	if err != nil || info.Size() != 0 {
		t.Fatalf("resume did not truncate unverifiable bytes before fresh GET: stat=%v size=%v", err, info)
	}
	source.releaseSecond()
	assertPauseTestCompletedFile(t, app, id, payload)
	if source.fullGets.Load() != 2 {
		t.Fatalf("resume should use one fresh whole GET: probes=%d full=%d", source.probes.Load(), source.fullGets.Load())
	}
}

func TestNoETagDeclinedPauseContinuesOriginalRequest(t *testing.T) {
	isolatePersistentDownloadTasks(t)
	payload := noETagLargePayload()
	source := newNoETagWholeSource(t, payload)
	app := newPersistentDownloadTestApp(t.TempDir(), t.TempDir())
	id := app.StartDownloadTask(WorkshopFileDetails{
		PublishedFileId: "987654321", Filename: "mod.vpk", FileUrl: source.url,
	}, false)
	waitPauseTestSignal(t, source.firstSent, "unvalidated response prefix")
	waitPauseTestTask(t, id, func(task DownloadTask) bool {
		return task.Status == "downloading" && task.DownloadedSize >= 16*1024
	})
	if err := app.PauseDownloadTask(id); err == nil || !strings.Contains(err.Error(), downloadPauseConfirmationKnown) {
		t.Fatalf("unverified bytes should require pause confirmation: %v", err)
	}
	if task := pauseTestSnapshot(t, id); task.Status != "downloading" || task.DownloadedSize < 16*1024 {
		t.Fatalf("declined pause changed active download: status=%q downloaded=%d", task.Status, task.DownloadedSize)
	}
	select {
	case <-source.firstClosed:
		t.Fatal("declined pause cancelled the original request")
	default:
	}
	// The user dismisses the dialog, so no ConfirmPauseDownloadTask call occurs.
	source.resumeFirst()
	assertPauseTestCompletedFile(t, app, id, payload)
	if got := source.fullGets.Load(); got != 1 {
		t.Fatalf("declined pause restarted the download: full GETs=%d", got)
	}
}

func TestNoETagLargeRangeSourceRestartsFromZeroAfterRestart(t *testing.T) {
	isolatePersistentDownloadTasks(t)
	payload := noETagLargePayload()
	source := newNoETagWholeSource(t, payload)
	root, config := t.TempDir(), t.TempDir()
	app := newPersistentDownloadTestApp(root, config)
	id := startNoETagWholeAndPause(t, app, source)
	assertNoETagPausedReset(t, root, id)
	if err := app.persistDownloadTasksNow(); err != nil {
		t.Fatal(err)
	}
	restarted := restartPersistentDownloadTestApp(t, root, config)
	loaded := pauseTestSnapshot(t, id)
	if loaded.Status != "paused" || loaded.DownloadedSize != 0 || loaded.Progress != 0 || loaded.transfer != nil || !strings.Contains(loaded.Notice, "从头") {
		t.Fatalf("unverifiable task appeared resumable after restart: status=%q bytes=%d progress=%d transfer=%+v notice=%q", loaded.Status, loaded.DownloadedSize, loaded.Progress, loaded.transfer, loaded.Notice)
	}
	if got := source.fullGets.Load(); got != 1 {
		t.Fatalf("download auto-started after restart: full GETs=%d", got)
	}
	source.holdSecond.Store(true)
	if err := restarted.ResumeDownloadTask(id); err != nil {
		t.Fatal(err)
	}
	waitPauseTestSignal(t, source.secondSent, "fresh whole-file GET after restart")
	waitPauseTestTask(t, id, func(task DownloadTask) bool {
		return task.Status == "downloading" && task.DownloadedSize == 0 && task.Progress == 0
	})
	source.releaseSecond()
	assertPauseTestCompletedFile(t, restarted, id, payload)
	if source.fullGets.Load() != 2 {
		t.Fatalf("restart did not issue exactly one fresh whole GET: %d", source.fullGets.Load())
	}
}

func TestNoETagChangedSourceUsesOneFreshResponse(t *testing.T) {
	isolatePersistentDownloadTasks(t)
	oldPayload := noETagLargePayload()
	newPayload := bytes.Repeat([]byte("FEDCBA9876543210"), len(oldPayload)/16)
	source := newNoETagWholeSource(t, oldPayload)
	root, config := t.TempDir(), t.TempDir()
	app := newPersistentDownloadTestApp(root, config)
	id := startNoETagWholeAndPause(t, app, source)
	assertNoETagPausedReset(t, root, id)
	source.setPayload(newPayload)
	if err := app.ResumeDownloadTask(id); err != nil {
		t.Fatal(err)
	}
	assertPauseTestCompletedFile(t, app, id, newPayload)
	if source.fullGets.Load() != 2 {
		t.Fatalf("changed source should require one fresh GET, not a prefix comparison: full GETs=%d", source.fullGets.Load())
	}
}

func TestNoETagAndNoRangeFallsBackToWholeFile(t *testing.T) {
	isolatePersistentDownloadTasks(t)
	payload := noETagLargePayload()
	var probes, fullGets atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
		if r.Method == http.MethodHead {
			return
		}
		if r.Header.Get("Range") != "" {
			probes.Add(1)
			w.WriteHeader(http.StatusOK) // Ignored Range: no body is needed for the probe.
			return
		}
		fullGets.Add(1)
		_, _ = w.Write(payload)
	}))
	t.Cleanup(server.Close)
	app := newPersistentDownloadTestApp(t.TempDir(), t.TempDir())
	id := app.StartDownloadTask(WorkshopFileDetails{
		PublishedFileId: "987654322", Filename: "mod.vpk", FileUrl: server.URL + "/whole.vpk",
	}, false)
	task := waitPauseTestTask(t, id, func(task DownloadTask) bool { return task.Status == "completed" || task.Status == "failed" })
	if task.Status != "completed" {
		t.Fatalf("whole-file fallback failed: %s", task.Error)
	}
	actual, err := os.ReadFile(task.FilePath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(actual, payload) || probes.Load() == 0 || fullGets.Load() == 0 {
		t.Fatalf("whole-file fallback mismatch: bytes=%d probes=%d fullGETs=%d", len(actual), probes.Load(), fullGets.Load())
	}
}

func TestStrongETagSingleFullTempDoesNotRequestBeyondEOF(t *testing.T) {
	isolatePersistentDownloadTasks(t)
	payload := pauseTestPayload()
	requests := make(chan string, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", `"single-full-v1"`)
		if r.Method == http.MethodHead {
			w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
			return
		}
		requests <- r.Header.Get("Range")
		if r.Header.Get("Range") != "" {
			w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
			return
		}
		w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
		_, _ = w.Write(payload)
	}))
	t.Cleanup(server.Close)
	root, config := t.TempDir(), t.TempDir()
	id := "1000000000-250"
	tempDir := filepath.Join(root, "temp")
	if err := os.MkdirAll(tempDir, 0755); err != nil {
		t.Fatal(err)
	}
	tempPath := filepath.Join(tempDir, id+"_single")
	if err := os.WriteFile(tempPath, payload, 0600); err != nil {
		t.Fatal(err)
	}
	app := newPersistentDownloadTestApp(root, config)
	taskManager.mu.Lock()
	taskManager.tasks[id] = &DownloadTask{
		ID: id, WorkshopID: "987654321", Filename: "987654321.vpk",
		FileUrl: server.URL + "/full.vpk", Status: "paused",
		TotalSize: int64(len(payload)), DownloadedSize: int64(len(payload)), Progress: 100,
		rootDir: root,
		transfer: &downloadTransferState{
			mode: "single", tempPath: tempPath, validator: `"single-full-v1"`, totalSize: int64(len(payload)),
		},
	}
	taskManager.mu.Unlock()
	if err := app.ResumeDownloadTask(id); err != nil {
		t.Fatal(err)
	}
	assertPauseTestCompletedFile(t, app, id, payload)
	select {
	case requestRange := <-requests:
		if requestRange != "" {
			t.Fatalf("full temporary file caused EOF Range request %q", requestRange)
		}
	default:
		t.Fatal("resume sent no GET")
	}
}

func TestSavedChunkProbeUnconfirmedKeepsCompletedBlock(t *testing.T) {
	for _, firstProbe := range []string{"range-ignored", "etag-missing", "server-error"} {
		t.Run(firstProbe, func(t *testing.T) {
			isolatePersistentDownloadTasks(t)
			const blockSize = 5 * 1024 * 1024
			const etag = `"chunk-checkpoint-v1"`
			payload := bytes.Repeat([]byte("abcdefgh01234567"), (blockSize+64*1024)/16)
			var probes, firstBlocks, secondBlocks atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == http.MethodHead {
					w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
					return
				}
				var start, end int64
				if _, err := fmt.Sscanf(r.Header.Get("Range"), "bytes=%d-%d", &start, &end); err != nil || start < 0 || end < start || end >= int64(len(payload)) {
					w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
					return
				}
				if got := r.Header.Get("If-Range"); got != etag {
					t.Errorf("saved chunk request If-Range = %q, want %q", got, etag)
				}
				if start == 0 && end == 0 {
					if probes.Add(1) == 1 {
						switch firstProbe {
						case "range-ignored":
							w.WriteHeader(http.StatusOK)
							return
						case "server-error":
							w.WriteHeader(http.StatusServiceUnavailable)
							return
						case "etag-missing":
							w.Header().Set("Content-Range", fmt.Sprintf("bytes 0-0/%d", len(payload)))
							w.Header().Set("Content-Length", "1")
							w.WriteHeader(http.StatusPartialContent)
							_, _ = w.Write(payload[:1])
							return
						}
					}
				}
				w.Header().Set("ETag", etag)
				w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, len(payload)))
				w.Header().Set("Content-Length", strconv.FormatInt(end-start+1, 10))
				w.WriteHeader(http.StatusPartialContent)
				switch {
				case start == 0 && end == 0:
					_, _ = w.Write(payload[:1])
				case start == 0 && end == blockSize-1:
					firstBlocks.Add(1)
					_, _ = w.Write(payload[:blockSize])
				case start == blockSize && end == int64(len(payload))-1:
					secondBlocks.Add(1)
					_, _ = w.Write(payload[blockSize:])
				default:
					t.Errorf("unexpected saved-chunk request %d-%d", start, end)
				}
			}))
			t.Cleanup(func() { server.CloseClientConnections(); server.Close() })
			root, config := t.TempDir(), t.TempDir()
			id := "1000000000-300"
			tempDir := filepath.Join(root, "temp")
			if err := os.MkdirAll(tempDir, 0755); err != nil {
				t.Fatal(err)
			}
			tempPath := filepath.Join(tempDir, id+"_final")
			file, err := os.Create(tempPath)
			if err != nil {
				t.Fatal(err)
			}
			if err := file.Truncate(int64(len(payload))); err != nil {
				file.Close()
				t.Fatal(err)
			}
			if _, err := file.WriteAt(payload[:blockSize], 0); err != nil {
				file.Close()
				t.Fatal(err)
			}
			if err := file.Sync(); err != nil {
				file.Close()
				t.Fatal(err)
			}
			if err := file.Close(); err != nil {
				t.Fatal(err)
			}
			app := newPersistentDownloadTestApp(root, config)
			record := persistedDownloadTask{
				Task: DownloadTask{
					ID: id, WorkshopID: "987654321", Filename: "987654321.vpk",
					FileUrl: server.URL + "/chunk.vpk", Status: "downloading",
					TotalSize: int64(len(payload)), DownloadedSize: blockSize,
					Progress: 100 * blockSize / len(payload),
				},
				RootDir: root,
				Transfer: &persistedDownloadTransfer{
					Mode: "chunk", FileName: id + "_final", Validator: etag,
					TotalSize: int64(len(payload)), CompletedBlocks: []bool{true, false},
				},
			}
			if err := app.writeDownloadTaskStore([]persistedDownloadTask{record}); err != nil {
				t.Fatal(err)
			}
			restarted := restartPersistentDownloadTestApp(t, root, config)
			loaded := pauseTestSnapshot(t, id)
			if loaded.Status != "paused" || loaded.DownloadedSize != blockSize {
				t.Fatalf("chunk checkpoint not restored: %+v", loaded)
			}
			if err := restarted.ResumeDownloadTask(id); err != nil {
				t.Fatal(err)
			}
			pausedAgain := waitPauseTestTask(t, id, func(task DownloadTask) bool {
				return task.Status == "paused" && probes.Load() == 1 && task.Notice != ""
			})
			if pausedAgain.DownloadedSize != blockSize || pausedAgain.Progress != record.Task.Progress ||
				pausedAgain.transfer == nil || len(pausedAgain.transfer.completedBlocks) != 2 ||
				!pausedAgain.transfer.completedBlocks[0] || pausedAgain.transfer.completedBlocks[1] {
				t.Fatalf("unconfirmed probe discarded completed block: %+v", pausedAgain)
			}
			if firstBlocks.Load() != 0 || secondBlocks.Load() != 0 {
				t.Fatalf("download started before probe confirmed: first=%d second=%d", firstBlocks.Load(), secondBlocks.Load())
			}
			temp, err := os.ReadFile(tempPath)
			if err != nil || len(temp) != len(payload) || !bytes.Equal(temp[:blockSize], payload[:blockSize]) {
				t.Fatalf("saved chunk temp changed after unconfirmed probe: read=%v size=%d", err, len(temp))
			}
			saved := onlyPersistedDownload(t, restarted, id)
			if saved.Task.DownloadedSize != blockSize || saved.Transfer == nil ||
				len(saved.Transfer.CompletedBlocks) != 2 || !saved.Transfer.CompletedBlocks[0] || saved.Transfer.CompletedBlocks[1] {
				t.Fatalf("unconfirmed probe lost durable chunk state: %+v", saved)
			}
			if err := restarted.ResumeDownloadTask(id); err != nil {
				t.Fatal(err)
			}
			assertPauseTestCompletedFile(t, restarted, id, payload)
			if probes.Load() != 2 || firstBlocks.Load() != 0 || secondBlocks.Load() != 1 {
				t.Fatalf("saved block was fetched again: probes=%d first=%d second=%d", probes.Load(), firstBlocks.Load(), secondBlocks.Load())
			}
		})
	}
}
