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

func isolatePersistentDownloadTasks(t *testing.T) {
	t.Helper()
	previous := taskManager
	taskManager = &TaskManager{tasks: make(map[string]*DownloadTask)}
	t.Cleanup(func() { taskManager = previous })
}

func newPersistentDownloadTestApp(rootDir, configDir string) *App {
	return &App{rootDir: rootDir, configDir: configDir, ctx: context.Background()}
}

func restartPersistentDownloadTestApp(t *testing.T, rootDir, configDir string) *App {
	t.Helper()
	// Call this only once the old worker reached paused/completed/cancelled.
	taskManager = &TaskManager{tasks: make(map[string]*DownloadTask)}
	restarted := newPersistentDownloadTestApp(rootDir, configDir)
	if err := restarted.loadDownloadTasks(); err != nil {
		t.Fatalf("load persisted download tasks: %v", err)
	}
	return restarted
}

func startPersistentPausedSingle(t *testing.T, app *App, server *pauseTestServer, payload []byte) string {
	t.Helper()
	id := app.StartDownloadTask(WorkshopFileDetails{
		PublishedFileId: "987654321", Filename: "mod.vpk", FileUrl: server.url,
		FileSize: strconv.Itoa(len(payload)),
	}, false)
	initial := waitPauseTestRequest(t, server.requests)
	if initial.rangeHeader != "" {
		t.Fatalf("initial GET sent Range %q", initial.rangeHeader)
	}
	waitPauseTestSignal(t, server.firstChunkSent, "initial response data")
	waitPauseTestTask(t, id, func(task DownloadTask) bool {
		return task.Status == "downloading" && task.DownloadedSize >= 16*1024
	})
	if err := app.PauseDownloadTask(id); err != nil {
		t.Fatalf("pause download: %v", err)
	}
	waitPauseTestSignal(t, server.firstClosed, "initial GET cancellation")
	waitPauseTestTask(t, id, func(task DownloadTask) bool { return task.Status == "paused" })
	return id
}

func onlyPersistedDownload(t *testing.T, app *App, id string) persistedDownloadTask {
	t.Helper()
	if err := app.persistDownloadTasksNow(); err != nil {
		t.Fatalf("flush persisted download tasks: %v", err)
	}
	records, err := app.readDownloadTaskStore()
	if err != nil {
		t.Fatalf("read persisted download tasks: %v", err)
	}
	if len(records) != 1 || records[0].Task.ID != id {
		t.Fatalf("saved records = %d, want task %s", len(records), id)
	}
	return records[0]
}

func waitNoPersistentRequest(t *testing.T, requests <-chan pauseTestRequest) {
	t.Helper()
	select {
	case req := <-requests:
		t.Fatalf("download unexpectedly restarted before user action: %+v", req)
	case <-time.After(250 * time.Millisecond):
	}
}

func removePersistedTestFile(t *testing.T, path string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for {
		err := os.Remove(path)
		if err == nil || os.IsNotExist(err) {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("remove temporary file: %v", err)
		}
		time.Sleep(20 * time.Millisecond) // Wine may briefly retain a closed file handle.
	}
}

func TestDownloadPersistenceSingleRestartUsesSafeCheckpoint(t *testing.T) {
	isolatePersistentDownloadTasks(t)
	rootDir, configDir := t.TempDir(), t.TempDir()
	app := newPersistentDownloadTestApp(rootDir, configDir)
	payload := pauseTestPayload()
	server := newPauseTestServer(t, payload, "range")
	id := startPersistentPausedSingle(t, app, server, payload)
	record := onlyPersistedDownload(t, app, id)
	if record.Transfer == nil || record.Transfer.Mode != "single" || record.Transfer.CheckpointBytes < 16*1024 {
		t.Fatalf("single checkpoint was not saved: %+v", record.Transfer)
	}
	checkpoint := record.Transfer.CheckpointBytes
	tempPath := filepath.Join(rootDir, "temp", record.Transfer.FileName)
	out, err := os.OpenFile(tempPath, os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatalf("open partial file: %v", err)
	}
	if _, err := out.Write(bytes.Repeat([]byte("stale"), 1024)); err != nil {
		out.Close()
		t.Fatalf("append uncheckpointed bytes: %v", err)
	}
	if err := out.Close(); err != nil {
		t.Fatal(err)
	}
	// Simulate a process dying after a checkpoint while more bytes were written.
	record.Task.Status = "downloading"
	record.Task.DownloadedSize = int64(len(payload))
	if err := app.writeDownloadTaskStore([]persistedDownloadTask{record}); err != nil {
		t.Fatalf("write interrupted-run fixture: %v", err)
	}
	restarted := restartPersistentDownloadTestApp(t, rootDir, configDir)
	loaded := pauseTestSnapshot(t, id)
	if loaded.Status != "paused" || loaded.DownloadedSize != checkpoint {
		t.Fatalf("restored state = %q, %d bytes; want paused at checkpoint %d", loaded.Status, loaded.DownloadedSize, checkpoint)
	}
	waitNoPersistentRequest(t, server.requests)
	if err := restarted.ResumeDownloadTask(id); err != nil {
		t.Fatalf("resume restored task: %v", err)
	}
	request := waitPauseTestRequest(t, server.requests)
	if request.rangeHeader != fmt.Sprintf("bytes=%d-", checkpoint) || request.ifRange != `"pause-test-v1"` {
		t.Fatalf("resume did not use the safe checkpoint: %+v", request)
	}
	assertPauseTestCompletedFile(t, restarted, id, payload)
	completed := onlyPersistedDownload(t, restarted, id)
	if completed.Task.Status != "completed" || completed.Transfer != nil {
		t.Fatalf("completed task retained partial transfer: status=%q transfer=%+v", completed.Task.Status, completed.Transfer)
	}
	if _, err := os.Stat(tempPath); !os.IsNotExist(err) {
		t.Fatalf("completed task retained temporary file: %v", err)
	}
}

func TestDownloadPersistenceActiveSingleCreatesTimedCheckpoint(t *testing.T) {
	isolatePersistentDownloadTasks(t)
	rootDir, configDir := t.TempDir(), t.TempDir()
	app := newPersistentDownloadTestApp(rootDir, configDir)
	payload := pauseTestPayload()
	server := newPauseTestServer(t, payload, "range")
	id := app.StartDownloadTask(WorkshopFileDetails{
		PublishedFileId: "987654321", Filename: "mod.vpk", FileUrl: server.url,
		FileSize: strconv.Itoa(len(payload)),
	}, false)
	_ = waitPauseTestRequest(t, server.requests)
	waitPauseTestSignal(t, server.firstChunkSent, "active download data")
	waitPauseTestTask(t, id, func(task DownloadTask) bool {
		return task.Status == "downloading" && task.DownloadedSize >= 16*1024
	})
	deadline := time.After(6 * time.Second)
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	for {
		records, err := app.readDownloadTaskStore()
		if err != nil && !strings.Contains(strings.ToLower(err.Error()), "sharing violation") {
			t.Fatal(err)
		}
		if err == nil && len(records) == 1 && records[0].Task.ID == id && records[0].Task.Status == "downloading" &&
			records[0].Transfer != nil && records[0].Transfer.CheckpointBytes >= 16*1024 &&
			records[0].Transfer.Validator == `"pause-test-v1"` {
			break
		}
		select {
		case <-deadline:
			t.Fatalf("no safe active checkpoint was written; latest records=%+v", records)
		case <-ticker.C:
		}
	}
	if err := app.CancelDownloadTask(id); err != nil {
		t.Fatal(err)
	}
	waitPauseTestSignal(t, server.firstClosed, "active request cancellation")
	waitPauseTestTask(t, id, func(task DownloadTask) bool { return task.Status == "cancelled" })
	if err := app.persistDownloadTasksNow(); err != nil {
		t.Fatal(err)
	}
}

func TestDownloadPersistenceMissingPartialRestartsFromZero(t *testing.T) {
	isolatePersistentDownloadTasks(t)
	rootDir, configDir := t.TempDir(), t.TempDir()
	app := newPersistentDownloadTestApp(rootDir, configDir)
	payload := pauseTestPayload()
	server := newPauseTestServer(t, payload, "range")
	id := startPersistentPausedSingle(t, app, server, payload)
	record := onlyPersistedDownload(t, app, id)
	if record.Transfer == nil {
		t.Fatal("paused transfer was not saved")
	}
	removePersistedTestFile(t, filepath.Join(rootDir, "temp", record.Transfer.FileName))
	restarted := restartPersistentDownloadTestApp(t, rootDir, configDir)
	loaded := pauseTestSnapshot(t, id)
	if loaded.Status != "paused" || loaded.DownloadedSize != 0 || loaded.Progress != 0 {
		t.Fatalf("missing partial was shown as resumable: %+v", loaded)
	}
	waitNoPersistentRequest(t, server.requests)
	if err := restarted.ResumeDownloadTask(id); err != nil {
		t.Fatalf("resume task without partial: %v", err)
	}
	request := waitPauseTestRequest(t, server.requests)
	if request.rangeHeader != "" || request.ifRange != "" {
		t.Fatalf("missing partial did not restart from zero: %+v", request)
	}
	assertPauseTestCompletedFile(t, restarted, id, payload)
	if err := restarted.persistDownloadTasksNow(); err != nil {
		t.Fatal(err)
	}
}

func TestDownloadPersistenceCancelAndClearRemoveRecordsAndPartial(t *testing.T) {
	isolatePersistentDownloadTasks(t)
	rootDir, configDir := t.TempDir(), t.TempDir()
	app := newPersistentDownloadTestApp(rootDir, configDir)
	payload := pauseTestPayload()
	server := newPauseTestServer(t, payload, "range")
	id := startPersistentPausedSingle(t, app, server, payload)
	record := onlyPersistedDownload(t, app, id)
	if record.Transfer == nil {
		t.Fatal("paused transfer was not saved")
	}
	tempPath := filepath.Join(rootDir, "temp", record.Transfer.FileName)
	restarted := restartPersistentDownloadTestApp(t, rootDir, configDir)
	waitNoPersistentRequest(t, server.requests)
	if err := restarted.CancelDownloadTask(id); err != nil {
		t.Fatalf("cancel restored task: %v", err)
	}
	cancelled := onlyPersistedDownload(t, restarted, id)
	if cancelled.Task.Status != "cancelled" || cancelled.Transfer != nil {
		t.Fatalf("cancelled task retained transfer: status=%q transfer=%+v", cancelled.Task.Status, cancelled.Transfer)
	}
	if _, err := os.Stat(tempPath); !os.IsNotExist(err) {
		t.Fatalf("cancelled task retained temporary file: %v", err)
	}
	restarted.ClearCompletedTasks()
	if err := restarted.persistDownloadTasksNow(); err != nil {
		t.Fatal(err)
	}
	records, err := restarted.readDownloadTaskStore()
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 0 {
		t.Fatalf("cleared tasks remained on disk: %d", len(records))
	}
}

func TestDownloadPersistenceChunkRestartKeepsCompletedBlocks(t *testing.T) {
	isolatePersistentDownloadTasks(t)
	const blockSize = 5 * 1024 * 1024
	const halfSecondBlock = 32 * 1024
	const etag = `"persist-chunk-v1"`
	payload := bytes.Repeat([]byte("abcdefgh01234567"), (blockSize+64*1024)/16)
	var probes, firstBlocks, secondBlocks atomic.Int32
	secondStarted := make(chan struct{})
	secondClosed := make(chan struct{})
	releaseSecond := make(chan struct{})
	t.Cleanup(func() { close(releaseSecond) })
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", etag)
		if r.Method == http.MethodHead {
			w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
			return
		}
		var start, end int64
		if _, err := fmt.Sscanf(r.Header.Get("Range"), "bytes=%d-%d", &start, &end); err != nil || start < 0 || end < start || end >= int64(len(payload)) {
			w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
			return
		}
		if start > blockSize {
			t.Errorf("request started inside the unfinished block: %d", start)
		}
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, len(payload)))
		w.Header().Set("Content-Length", strconv.FormatInt(end-start+1, 10))
		w.WriteHeader(http.StatusPartialContent)
		switch {
		case start == 0 && end == 0:
			probes.Add(1)
			_, _ = w.Write(payload[:1])
		case start == 0 && end == blockSize-1:
			firstBlocks.Add(1)
			_, _ = w.Write(payload[:blockSize])
		case start == blockSize && end == int64(len(payload))-1:
			if secondBlocks.Add(1) == 1 {
				_, _ = w.Write(payload[blockSize : blockSize+halfSecondBlock])
				w.(http.Flusher).Flush()
				close(secondStarted)
				select {
				case <-r.Context().Done():
					close(secondClosed)
				case <-releaseSecond:
				}
				return
			}
			_, _ = w.Write(payload[blockSize:])
		}
	}))
	t.Cleanup(server.Close)
	rootDir, configDir := t.TempDir(), t.TempDir()
	app := newPersistentDownloadTestApp(rootDir, configDir)
	id := app.StartDownloadTask(WorkshopFileDetails{
		PublishedFileId: "987654321", Filename: "mod.vpk", FileUrl: server.URL + "/chunk.vpk",
		FileSize: strconv.Itoa(len(payload)),
	}, false)
	waitPauseTestSignal(t, secondStarted, "unfinished second block")
	waitPauseTestTask(t, id, func(task DownloadTask) bool {
		return task.Status == "downloading" && task.DownloadedSize >= blockSize+halfSecondBlock
	})
	// The second request is held open: the timed checkpoint must still record
	// the first completed block before any explicit pause or normal exit.
	deadline := time.After(6 * time.Second)
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	var activeRecord persistedDownloadTask
	for {
		records, err := app.readDownloadTaskStore()
		if err != nil && !strings.Contains(strings.ToLower(err.Error()), "sharing violation") {
			t.Fatal(err)
		}
		if err == nil && len(records) == 1 && records[0].Task.ID == id && records[0].Task.Status == "downloading" &&
			records[0].Transfer != nil && len(records[0].Transfer.CompletedBlocks) == 2 &&
			records[0].Transfer.CompletedBlocks[0] && !records[0].Transfer.CompletedBlocks[1] {
			activeRecord = records[0]
			break
		}
		select {
		case <-deadline:
			t.Fatalf("no active completed-block checkpoint was written; records=%+v", records)
		case <-ticker.C:
		}
	}
	if err := app.PauseDownloadTask(id); err != nil {
		t.Fatal(err)
	}
	waitPauseTestSignal(t, secondClosed, "second block cancellation")
	waitPauseTestTask(t, id, func(task DownloadTask) bool { return task.Status == "paused" })
	record := onlyPersistedDownload(t, app, id)
	if record.Transfer == nil || record.Transfer.Mode != "chunk" || len(record.Transfer.CompletedBlocks) != 2 || !record.Transfer.CompletedBlocks[0] || record.Transfer.CompletedBlocks[1] {
		t.Fatalf("completed block checkpoint missing: %+v", record.Transfer)
	}
	tempPath := filepath.Join(rootDir, "temp", record.Transfer.FileName)
	tempBytes, err := os.ReadFile(tempPath)
	if err != nil {
		t.Fatalf("read paused chunk temp: %v", err)
	}
	if len(tempBytes) != len(payload) || !bytes.Equal(tempBytes[blockSize:blockSize+halfSecondBlock], payload[blockSize:blockSize+halfSecondBlock]) {
		t.Fatalf("paused temp did not retain the half-written second block")
	}
	// Replace the clean-pause record with the earlier active checkpoint to model
	// a crash while the second block was half written.
	if err := app.writeDownloadTaskStore([]persistedDownloadTask{activeRecord}); err != nil {
		t.Fatal(err)
	}
	restarted := restartPersistentDownloadTestApp(t, rootDir, configDir)
	loaded := pauseTestSnapshot(t, id)
	if loaded.Status != "paused" || loaded.DownloadedSize != blockSize {
		t.Fatalf("chunk task was not restored as paused at a safe block: %+v", loaded)
	}
	if got := probes.Load(); got != 1 {
		t.Fatalf("restored task auto-started: probes=%d", got)
	}
	time.Sleep(250 * time.Millisecond)
	if got := probes.Load(); got != 1 {
		t.Fatalf("restored task auto-started later: probes=%d", got)
	}
	if err := restarted.ResumeDownloadTask(id); err != nil {
		t.Fatal(err)
	}
	assertPauseTestCompletedFile(t, restarted, id, payload)
	if probes.Load() != 2 || firstBlocks.Load() != 1 || secondBlocks.Load() != 2 {
		t.Fatalf("resumed chunk requests: probes=%d first=%d second=%d", probes.Load(), firstBlocks.Load(), secondBlocks.Load())
	}
	if err := restarted.persistDownloadTasksNow(); err != nil {
		t.Fatal(err)
	}
}

func TestDownloadPersistenceRejectsUntrustedTempName(t *testing.T) {
	isolatePersistentDownloadTasks(t)
	rootDir, configDir := t.TempDir(), t.TempDir()
	if err := os.Mkdir(filepath.Join(rootDir, "temp"), 0700); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "untouched.vpk")
	if err := os.WriteFile(outside, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	forgedName, err := filepath.Rel(filepath.Join(rootDir, "temp"), outside)
	if err != nil {
		t.Fatal(err)
	}
	app := newPersistentDownloadTestApp(rootDir, configDir)
	record := persistedDownloadTask{
		Task:    DownloadTask{ID: "123-1", Status: "paused", FileUrl: "https://example.invalid/mod.vpk", DownloadedSize: 4, Progress: 50},
		RootDir: rootDir,
		Transfer: &persistedDownloadTransfer{
			Mode: "single", FileName: forgedName, Validator: `"version-1"`, TotalSize: 8, CheckpointBytes: 4,
		},
	}
	if err := app.writeDownloadTaskStore([]persistedDownloadTask{record}); err != nil {
		t.Fatal(err)
	}
	if err := app.loadDownloadTasks(); err != nil {
		t.Fatal(err)
	}
	loaded := pauseTestSnapshot(t, "123-1")
	if loaded.Status != "paused" || loaded.DownloadedSize != 0 || loaded.Progress != 0 {
		t.Fatalf("untrusted temp path was accepted: %+v", loaded)
	}
	if got, err := os.ReadFile(outside); err != nil || string(got) != "keep" {
		t.Fatalf("outside file changed: data=%q error=%v", got, err)
	}
}

func TestDownloadPersistenceInterruptedTerminalStates(t *testing.T) {
	isolatePersistentDownloadTasks(t)
	for _, tc := range []struct {
		name, savedStatus, wantStatus, wantNotice string
	}{
		{"cancelling", "cancelling", "cancelled", ""},
		{"finalizing", "finalizing", "failed", "检查 Mod 列表"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			taskManager = &TaskManager{tasks: make(map[string]*DownloadTask)}
			rootDir, configDir := t.TempDir(), t.TempDir()
			tempDir := filepath.Join(rootDir, "temp")
			if err := os.Mkdir(tempDir, 0700); err != nil {
				t.Fatal(err)
			}
			const id = "123-1"
			tempPath := filepath.Join(tempDir, id+"_single")
			if err := os.WriteFile(tempPath, []byte("partial"), 0600); err != nil {
				t.Fatal(err)
			}
			app := newPersistentDownloadTestApp(rootDir, configDir)
			record := persistedDownloadTask{
				Task:     DownloadTask{ID: id, Status: tc.savedStatus, FileUrl: "https://example.invalid/mod.vpk", DownloadedSize: 7},
				RootDir:  rootDir,
				Transfer: &persistedDownloadTransfer{Mode: "single", FileName: id + "_single", Validator: `"version-1"`, TotalSize: 20, CheckpointBytes: 7},
			}
			if err := app.writeDownloadTaskStore([]persistedDownloadTask{record}); err != nil {
				t.Fatal(err)
			}
			if err := app.loadDownloadTasks(); err != nil {
				t.Fatal(err)
			}
			loaded := pauseTestSnapshot(t, id)
			if loaded.Status != tc.wantStatus {
				t.Fatalf("restored status = %q, want %q", loaded.Status, tc.wantStatus)
			}
			if tc.wantNotice != "" && !strings.Contains(loaded.Notice, tc.wantNotice) {
				t.Fatalf("restored notice = %q, want %q", loaded.Notice, tc.wantNotice)
			}
			if _, err := os.Stat(tempPath); !os.IsNotExist(err) {
				t.Fatalf("terminal task kept partial file: %v", err)
			}
		})
	}
}

func TestDownloadPersistenceRejectsIncompleteChunkBitmap(t *testing.T) {
	isolatePersistentDownloadTasks(t)
	for _, tc := range []struct {
		name string
		bits []bool
	}{
		{"missing", nil},
		{"wrong-length", []bool{true}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			taskManager = &TaskManager{tasks: make(map[string]*DownloadTask)}
			rootDir, configDir := t.TempDir(), t.TempDir()
			tempDir := filepath.Join(rootDir, "temp")
			if err := os.Mkdir(tempDir, 0700); err != nil {
				t.Fatal(err)
			}
			const id = "123-1"
			const total = 5*1024*1024 + 64*1024
			tempPath := filepath.Join(tempDir, id+"_final")
			file, err := os.Create(tempPath)
			if err != nil {
				t.Fatal(err)
			}
			if err := file.Truncate(total); err != nil {
				file.Close()
				t.Fatal(err)
			}
			if err := file.Close(); err != nil {
				t.Fatal(err)
			}
			app := newPersistentDownloadTestApp(rootDir, configDir)
			record := persistedDownloadTask{
				Task:     DownloadTask{ID: id, Status: "downloading", FileUrl: "https://example.invalid/mod.vpk", DownloadedSize: 5 * 1024 * 1024, Progress: 98},
				RootDir:  rootDir,
				Transfer: &persistedDownloadTransfer{Mode: "chunk", FileName: id + "_final", Validator: `"version-1"`, TotalSize: total, CompletedBlocks: tc.bits},
			}
			if err := app.writeDownloadTaskStore([]persistedDownloadTask{record}); err != nil {
				t.Fatal(err)
			}
			if err := app.loadDownloadTasks(); err != nil {
				t.Fatal(err)
			}
			loaded := pauseTestSnapshot(t, id)
			if loaded.Status != "paused" || loaded.DownloadedSize != 0 || loaded.Progress != 0 {
				t.Fatalf("unverifiable chunk bitmap was accepted: %+v", loaded)
			}
			if _, err := os.Stat(tempPath); !os.IsNotExist(err) {
				t.Fatalf("invalid chunk temp was retained: %v", err)
			}
		})
	}
}

func TestDownloadPersistenceInvalidSnapshotRetainsCleanupMarker(t *testing.T) {
	isolatePersistentDownloadTasks(t)
	const id = "123-1"
	const chunkTotal = 5*1024*1024 + 64*1024
	for _, tc := range []struct {
		name, mode string
		totalSize  int64
		fileBytes  []byte
		chunkBits  []bool
	}{
		{name: "oversized-single", mode: "single", totalSize: 8, fileBytes: []byte("123456789")},
		{name: "wrong-length-chunk-bitmap", mode: "chunk", totalSize: chunkTotal, chunkBits: []bool{true}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			taskManager = &TaskManager{tasks: make(map[string]*DownloadTask)}
			rootDir, configDir := t.TempDir(), t.TempDir()
			tempDir := filepath.Join(rootDir, "temp")
			if err := os.Mkdir(tempDir, 0700); err != nil {
				t.Fatal(err)
			}
			suffix := "_single"
			if tc.mode == "chunk" {
				suffix = "_final"
			}
			tempPath := filepath.Join(tempDir, id+suffix)
			if tc.mode == "single" {
				if err := os.WriteFile(tempPath, tc.fileBytes, 0600); err != nil {
					t.Fatal(err)
				}
			} else {
				file, err := os.Create(tempPath)
				if err != nil {
					t.Fatal(err)
				}
				if err := file.Truncate(tc.totalSize); err != nil {
					file.Close()
					t.Fatal(err)
				}
				if err := file.Close(); err != nil {
					t.Fatal(err)
				}
			}
			taskManager.tasks[id] = &DownloadTask{
				ID: id, Status: "downloading", rootDir: rootDir,
				DownloadedSize: tc.totalSize, Progress: 100,
				transfer: &downloadTransferState{
					mode: tc.mode, tempPath: tempPath, validator: `"version-1"`,
					totalSize: tc.totalSize, completedBlocks: tc.chunkBits,
				},
			}
			app := newPersistentDownloadTestApp(rootDir, configDir)
			if err := app.persistDownloadTasksNow(); err != nil {
				t.Fatal(err)
			}
			records, err := app.readDownloadTaskStore()
			if err != nil {
				t.Fatal(err)
			}
			if len(records) != 1 || records[0].Transfer == nil ||
				records[0].Transfer.Mode != tc.mode || records[0].Transfer.FileName != id+suffix ||
				records[0].Transfer.Validator != "" || records[0].Transfer.CheckpointBytes != 0 ||
				records[0].Task.DownloadedSize != 0 || records[0].Task.Progress != 0 {
				t.Fatalf("invalid snapshot was not reduced to cleanup marker: %+v", records)
			}
			taskManager = &TaskManager{tasks: make(map[string]*DownloadTask)}
			restarted := newPersistentDownloadTestApp(rootDir, configDir)
			if err := restarted.loadDownloadTasks(); err != nil {
				t.Fatal(err)
			}
			loaded := pauseTestSnapshot(t, id)
			if loaded.Status != "paused" || loaded.DownloadedSize != 0 || loaded.Progress != 0 || loaded.transfer != nil {
				t.Fatalf("cleanup marker restored unsafe progress: %+v", loaded)
			}
			if _, err := os.Stat(tempPath); !os.IsNotExist(err) {
				t.Fatalf("cleanup marker did not remove legal temp: %v", err)
			}
		})
	}
}

func TestDownloadPersistenceNoETagRestartReportsRealZeroProgress(t *testing.T) {
	isolatePersistentDownloadTasks(t)
	const id = "123-1"
	rootDir, configDir := t.TempDir(), t.TempDir()
	tempDir := filepath.Join(rootDir, "temp")
	if err := os.Mkdir(tempDir, 0700); err != nil {
		t.Fatal(err)
	}
	tempPath := filepath.Join(tempDir, id+"_single")
	if err := os.WriteFile(tempPath, []byte("partial"), 0600); err != nil {
		t.Fatal(err)
	}
	taskManager.tasks[id] = &DownloadTask{
		ID: id, Status: "paused", FileUrl: "https://example.invalid/mod.vpk",
		rootDir: rootDir, DownloadedSize: 7, TotalSize: 14, Progress: 50,
		transfer: &downloadTransferState{mode: "single", tempPath: tempPath, totalSize: 14},
	}
	app := newPersistentDownloadTestApp(rootDir, configDir)
	if err := app.persistDownloadTasksNow(); err != nil {
		t.Fatal(err)
	}
	records, err := app.readDownloadTaskStore()
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 1 || records[0].Task.DownloadedSize != 0 || records[0].Task.Progress != 0 ||
		records[0].Transfer == nil || records[0].Transfer.Mode != "single" ||
		records[0].Transfer.FileName != id+"_single" || records[0].Transfer.CheckpointBytes != 0 {
		t.Fatalf("no-ETag snapshot claimed resumable progress: %+v", records)
	}
	restartPersistentDownloadTestApp(t, rootDir, configDir)
	loaded := pauseTestSnapshot(t, id)
	if loaded.Status != "paused" || loaded.DownloadedSize != 0 || loaded.Progress != 0 ||
		loaded.FileUrl != "https://example.invalid/mod.vpk" || !strings.Contains(loaded.Notice, "从头下载") {
		t.Fatalf("no-ETag task was not restored with an honest restart notice: %+v", loaded)
	}
	if _, err := os.Stat(tempPath); !os.IsNotExist(err) {
		t.Fatalf("unverifiable no-ETag temp was retained: %v", err)
	}
}
