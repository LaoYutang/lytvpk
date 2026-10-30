package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestDownloadExitRiskDistinguishesUnknownAndUnverifiable(t *testing.T) {
	tests := []struct {
		name       string
		status     string
		validator  string
		confirmed  bool
		downloaded int64
		want       DownloadExitRisk
	}{
		{name: "paused no ETag", status: "paused"},
		{name: "pending identity unknown", status: "pending", validator: `"known"`, want: DownloadExitRisk{Downloads: true, DownloadIdentityUnknown: true}},
		{name: "starting transfer", status: "downloading", want: DownloadExitRisk{Downloads: true, DownloadIdentityUnknown: true}},
		{name: "no ETag with bytes", status: "downloading", downloaded: 4096, want: DownloadExitRisk{Downloads: true, DownloadLossRisk: true}},
		{name: "weak ETag with bytes", status: "downloading", validator: `W/"known"`, downloaded: 4096, want: DownloadExitRisk{Downloads: true, DownloadLossRisk: true}},
		{name: "saved strong ETag before current response", status: "downloading", validator: `"known"`, downloaded: 4096, want: DownloadExitRisk{Downloads: true, DownloadIdentityUnknown: true}},
		{name: "strong ETag with verified response", status: "downloading", validator: `"known"`, confirmed: true, downloaded: 4096, want: DownloadExitRisk{Downloads: true}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			isolatePersistentDownloadTasks(t)
			app := &App{}
			task := &DownloadTask{ID: "1000000000-901", Status: tc.status, DownloadedSize: tc.downloaded}
			if tc.validator != "" || tc.downloaded > 0 {
				task.transfer = &downloadTransferState{mode: "single", validator: tc.validator, responseConfirmed: tc.confirmed}
			}
			taskManager.mu.Lock()
			taskManager.tasks[task.ID] = task
			taskManager.mu.Unlock()
			if got := app.GetDownloadExitRisk(); got != tc.want {
				t.Fatalf("exit risk = %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestDownloadExitRiskDetectsBytesBeforeProgressEvent(t *testing.T) {
	isolatePersistentDownloadTasks(t)
	path := filepath.Join(t.TempDir(), "partial")
	if err := os.WriteFile(path, []byte("already received"), 0600); err != nil {
		t.Fatal(err)
	}
	taskManager.mu.Lock()
	taskManager.tasks["1000000000-902"] = &DownloadTask{
		ID: "1000000000-902", Status: "downloading",
		transfer: &downloadTransferState{mode: "single", tempPath: path},
	}
	taskManager.mu.Unlock()
	if got := (&App{}).GetDownloadExitRisk(); !got.DownloadLossRisk || got.DownloadIdentityUnknown {
		t.Fatalf("unreported temp bytes were not classified as progress at risk: %+v", got)
	}
}

func TestDownloadExitConfirmationBeforeNoETagProgressIsDiscarded(t *testing.T) {
	isolatePersistentDownloadTasks(t)
	app := newPersistentDownloadTestApp(t.TempDir(), t.TempDir())
	server := newPauseTestServer(t, pauseTestPayload(), "no-etag")
	id := app.StartDownloadTask(WorkshopFileDetails{
		PublishedFileId: "1000000000", Filename: "mod.vpk", FileUrl: server.url,
		FileSize: strconv.Itoa(len(pauseTestPayload())),
	}, false)
	_ = waitPauseTestRequest(t, server.requests)
	waitPauseTestSignal(t, server.firstChunkSent, "unverifiable download data")
	waitPauseTestTask(t, id, func(task DownloadTask) bool {
		return task.Status == "downloading" && task.DownloadedSize >= 16*1024
	})
	if risk := app.GetDownloadExitRisk(); !risk.Downloads || !risk.DownloadLossRisk {
		t.Fatalf("missing download loss risk before confirmation: %+v", risk)
	}
	if err := app.ForceExitWithPauseLossAccepted(false); err == nil || err.Error() != exitPauseLossConfirmationRequired {
		t.Fatalf("unconfirmed exit error = %v, want stable risk marker", err)
	}
	if status := pauseTestSnapshot(t, id).Status; status != "downloading" {
		t.Fatalf("rejected exit changed task status to %s", status)
	}
	select {
	case <-server.firstClosed:
		t.Fatal("unconfirmed exit cancelled the download request")
	default:
	}
	app.downloadExitMu.Lock()
	gateClosed := app.downloadExitRequested
	app.downloadExitMu.Unlock()
	if gateClosed {
		t.Fatal("unconfirmed exit closed download admission")
	}
	if _, err := app.beginExit(false, true); !errors.Is(err, errExitDownloadsBecameActive) {
		t.Fatalf("idle exit admitted a newly active task: %v", err)
	}
	app.ctx = nil // No Wails runtime in this test; shutdown finishes with a safe failure.
	if err := app.ForceExitWithPauseLossAccepted(true); err != nil {
		t.Fatalf("confirmed exit: %v", err)
	}
	waitPauseTestSignal(t, server.firstClosed, "confirmed exit request cancellation")
	paused := waitPauseTestTask(t, id, func(task DownloadTask) bool { return task.Status == "paused" })
	if paused.DownloadedSize != 0 || paused.Progress != 0 || !strings.Contains(paused.Notice, "从头下载") {
		t.Fatalf("confirmed no-ETag pause did not clear progress honestly: %+v", paused)
	}
	waitExitState(t, app, false)
}

func TestDownloadExitPausesEveryWorkerAndSavesCheckpoints(t *testing.T) {
	isolatePersistentDownloadTasks(t)
	rootDir, configDir := t.TempDir(), t.TempDir()
	app := newPersistentDownloadTestApp(rootDir, configDir)
	payload := pauseTestPayload()
	servers := []*pauseTestServer{
		newPauseTestServer(t, payload, "range"),
		newPauseTestServer(t, payload, "range"),
		newPauseTestServer(t, payload, "range"),
	}
	ids := make([]string, len(servers))
	for i, server := range servers {
		ids[i] = app.StartDownloadTask(WorkshopFileDetails{
			PublishedFileId: strconv.Itoa(900001 + i), Filename: "mod.vpk",
			FileUrl: server.url, FileSize: strconv.Itoa(len(payload)),
		}, false)
		_ = waitPauseTestRequest(t, server.requests)
		waitPauseTestSignal(t, server.firstChunkSent, "exit test download data")
		waitPauseTestTask(t, ids[i], func(task DownloadTask) bool {
			return task.Status == "downloading" && task.DownloadedSize >= 16*1024
		})
	}
	if err := app.PauseDownloadTask(ids[2]); err != nil {
		t.Fatal(err)
	}
	waitPauseTestSignal(t, servers[2].firstClosed, "already-paused request cancellation")
	waitPauseTestTask(t, ids[2], func(task DownloadTask) bool { return task.Status == "paused" })

	// A finalization that has already started cannot be interrupted safely.
	// Keep it in progress briefly to exercise the admission gate while the two
	// active downloads are being stopped.
	finalizingID := "1000000000-123"
	failedID := "1000000000-124"
	taskManager.mu.Lock()
	taskManager.tasks[finalizingID] = &DownloadTask{ID: finalizingID, Status: "finalizing", rootDir: rootDir}
	taskManager.tasks[failedID] = &DownloadTask{ID: failedID, Status: "failed", rootDir: rootDir}
	taskManager.mu.Unlock()

	result := make(chan error, 1)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	go func() { result <- app.pauseDownloadsForExit(ctx) }()
	for i := 0; i < 2; i++ {
		waitPauseTestSignal(t, servers[i].firstClosed, "exit request cancellation")
		waitPauseTestTask(t, ids[i], func(task DownloadTask) bool { return task.Status == "paused" })
	}
	app.downloadExitMu.Lock()
	gateClosed := app.downloadExitRequested
	app.downloadExitMu.Unlock()
	if !gateClosed {
		t.Fatal("new downloads were not blocked during exit preparation")
	}
	if err := app.ResumeDownloadTask(ids[2]); err == nil {
		t.Fatal("resume was allowed while exit preparation was active")
	}
	if err := app.RetryDownloadTask(failedID); err == nil {
		t.Fatal("retry was allowed while exit preparation was active")
	}
	blockedID := app.StartDownloadTask(WorkshopFileDetails{
		PublishedFileId: "900004", Filename: "mod.vpk", FileUrl: servers[0].url,
		FileSize: strconv.Itoa(len(payload)),
	}, false)
	blocked := pauseTestSnapshot(t, blockedID)
	if blocked.Status != "failed" || !strings.Contains(blocked.Error, "正在退出") {
		t.Fatalf("new task started during exit: status=%q error=%q", blocked.Status, blocked.Error)
	}
	if got := servers[0].getCount.Load(); got != 1 {
		t.Fatalf("new task caused another GET while exiting: %d", got)
	}

	taskManager.mu.Lock()
	taskManager.tasks[finalizingID].Status = "completed"
	taskManager.mu.Unlock()
	select {
	case err := <-result:
		if err != nil {
			t.Fatalf("pause and save on exit: %v", err)
		}
	case <-ctx.Done():
		t.Fatal("exit preparation did not finish")
	}
	defer app.cancelDownloadExit()
	records, err := app.readDownloadTaskStore()
	if err != nil {
		t.Fatal(err)
	}
	byID := make(map[string]persistedDownloadTask, len(records))
	for _, record := range records {
		byID[record.Task.ID] = record
	}
	for _, id := range ids {
		record, ok := byID[id]
		if !ok || record.Task.Status != "paused" || record.Transfer == nil ||
			record.Transfer.Mode != "single" || record.Transfer.CheckpointBytes < 16*1024 {
			t.Fatalf("task %s was not durably paused: %+v", id, record)
		}
		if _, err := os.Stat(filepath.Join(rootDir, "temp", record.Transfer.FileName)); err != nil {
			t.Fatalf("task %s lost its partial file: %v", id, err)
		}
	}
	if got := servers[2].getCount.Load(); got != 1 {
		t.Fatalf("already-paused task started another request: %d", got)
	}
}

func TestDownloadExitSaveFailureCanBeRetried(t *testing.T) {
	isolatePersistentDownloadTasks(t)
	rootDir, badParent := t.TempDir(), t.TempDir()
	configFile := filepath.Join(badParent, "not-a-directory")
	if err := os.WriteFile(configFile, []byte("blocked"), 0600); err != nil {
		t.Fatal(err)
	}
	app := newPersistentDownloadTestApp(rootDir, configFile)
	id := "1000000000-125"
	taskManager.mu.Lock()
	taskManager.tasks[id] = &DownloadTask{ID: id, Status: "paused", rootDir: rootDir}
	taskManager.mu.Unlock()
	if err := app.pauseDownloadsForExit(context.Background()); err == nil {
		t.Fatal("exit preparation succeeded despite an unwritable task store")
	}
	app.downloadExitMu.Lock()
	gateClosed := app.downloadExitRequested
	app.downloadExitMu.Unlock()
	if !gateClosed {
		t.Fatal("failed exit unexpectedly reopened the gate before the caller handled failure")
	}
	app.cancelDownloadExit() // lifecycle does this when it keeps the window open.
	app.configDir = t.TempDir()
	if err := app.ResumeDownloadTask(id); err != nil {
		t.Fatalf("download could not resume after failed exit was cancelled: %v", err)
	}
	waitPauseTestTask(t, id, func(task DownloadTask) bool { return task.Status == "failed" })
	if err := app.pauseDownloadsForExit(context.Background()); err != nil {
		t.Fatalf("exit preparation could not be retried after storage recovered: %v", err)
	}
	app.cancelDownloadExit()
}

func TestDownloadExitWaitTimeoutLeavesWindowRetryable(t *testing.T) {
	isolatePersistentDownloadTasks(t)
	app := newPersistentDownloadTestApp(t.TempDir(), t.TempDir())
	id := "1000000000-126"
	taskManager.mu.Lock()
	taskManager.tasks[id] = &DownloadTask{ID: id, Status: "finalizing", rootDir: app.rootDir}
	taskManager.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	if err := app.pauseDownloadsForExit(ctx); err == nil {
		t.Fatal("exit preparation did not time out while finalization was still active")
	}
	app.cancelDownloadExit()
	taskManager.mu.Lock()
	taskManager.tasks[id].Status = "completed"
	taskManager.mu.Unlock()
	if err := app.pauseDownloadsForExit(context.Background()); err != nil {
		t.Fatalf("second exit preparation failed: %v", err)
	}
	app.cancelDownloadExit()
}
