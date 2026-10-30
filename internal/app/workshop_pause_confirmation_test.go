package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func addPauseConfirmationTask(t *testing.T, task *DownloadTask) {
	t.Helper()
	taskManager.mu.Lock()
	taskManager.tasks[task.ID] = task
	taskManager.mu.Unlock()
	t.Cleanup(func() {
		taskManager.mu.Lock()
		delete(taskManager.tasks, task.ID)
		taskManager.mu.Unlock()
	})
}

func TestPauseDownloadTaskRequiresConfirmationForKnownUnverifiedBytes(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	path := filepath.Join(t.TempDir(), "partial")
	if err := os.WriteFile(path, []byte("bytes already received"), 0600); err != nil {
		t.Fatal(err)
	}
	task := &DownloadTask{
		ID: "pause-confirmation-known", Status: "downloading", cancelFunc: cancel,
		transfer: &downloadTransferState{mode: "single", tempPath: path},
		// The progress event can lag behind the actual file write.
		DownloadedSize: 0,
	}
	addPauseConfirmationTask(t, task)
	app := &App{}
	if err := app.PauseDownloadTask(task.ID); err == nil || !strings.Contains(err.Error(), downloadPauseConfirmationKnown) {
		t.Fatalf("pause should ask before discarding unverified bytes, got %v", err)
	}
	if ctx.Err() != nil || task.Status != "downloading" {
		t.Fatalf("unconfirmed pause stopped the task: context=%v status=%q", ctx.Err(), task.Status)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("unconfirmed pause removed the partial file: %v", err)
	}
	if err := app.ConfirmPauseDownloadTask(task.ID); err != nil {
		t.Fatalf("confirmed pause: %v", err)
	}
	if ctx.Err() != context.Canceled || task.Status != "pausing" {
		t.Fatalf("confirmed pause did not stop the task: context=%v status=%q", ctx.Err(), task.Status)
	}
	if err := app.ConfirmPauseDownloadTask(task.ID); err == nil {
		t.Fatal("duplicate confirmation accepted a task already pausing")
	}
}

func TestPauseDownloadTaskTreatsUnknownValidatorAsRisk(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	task := &DownloadTask{ID: "pause-confirmation-unknown", Status: "downloading", cancelFunc: cancel}
	addPauseConfirmationTask(t, task)
	app := &App{}
	if err := app.PauseDownloadTask(task.ID); err == nil || !strings.Contains(err.Error(), downloadPauseConfirmationUnknown) {
		t.Fatalf("unknown source identity should ask before pause, got %v", err)
	}
	if ctx.Err() != nil || task.Status != "downloading" {
		t.Fatalf("unknown-identity preflight changed the task: context=%v status=%q", ctx.Err(), task.Status)
	}
	// The transfer may finish before the user responds to the dialog.
	taskManager.mu.Lock()
	task.Status = "completed"
	taskManager.mu.Unlock()
	if err := app.ConfirmPauseDownloadTask(task.ID); err == nil {
		t.Fatal("confirmation paused a task that already completed")
	}
	if ctx.Err() != nil || task.Status != "completed" {
		t.Fatalf("late confirmation changed a completed task: context=%v status=%q", ctx.Err(), task.Status)
	}
}

func TestPauseDownloadTaskWithStrongETagNeedsNoConfirmation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	task := &DownloadTask{
		ID: "pause-confirmation-strong", Status: "downloading", cancelFunc: cancel,
		transfer: &downloadTransferState{mode: "single", validator: `"stable-version"`, responseConfirmed: true},
	}
	addPauseConfirmationTask(t, task)
	if err := (&App{}).PauseDownloadTask(task.ID); err != nil {
		t.Fatalf("strong-ETag pause should be immediate: %v", err)
	}
	if ctx.Err() != context.Canceled || task.Status != "pausing" {
		t.Fatalf("strong-ETag task was not paused: context=%v status=%q", ctx.Err(), task.Status)
	}
}

func TestPauseDownloadTaskWithSavedETagAwaitingResponseNeedsConfirmation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	task := &DownloadTask{
		ID: "pause-confirmation-saved-etag", Status: "downloading", cancelFunc: cancel,
		transfer: &downloadTransferState{mode: "single", validator: `"stable-version"`},
	}
	addPauseConfirmationTask(t, task)
	app := &App{}
	if err := app.PauseDownloadTask(task.ID); err == nil || !strings.Contains(err.Error(), downloadPauseConfirmationUnknown) {
		t.Fatalf("saved ETag does not confirm the new response, got %v", err)
	}
	if ctx.Err() != nil || task.Status != "downloading" {
		t.Fatalf("unconfirmed request was stopped: context=%v status=%q", ctx.Err(), task.Status)
	}
	taskManager.mu.Lock()
	task.transfer.responseConfirmed = true
	taskManager.mu.Unlock()
	if err := app.PauseDownloadTask(task.ID); err != nil {
		t.Fatalf("validated response should pause directly: %v", err)
	}
}

func TestResumeSingleDoesNotTrustSavedETagBeforeNewResponse(t *testing.T) {
	requestStarted := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("unexpected method %s", r.Method)
			return
		}
		close(requestStarted)
		<-r.Context().Done()
	}))
	t.Cleanup(server.Close)
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "temp"), 0755); err != nil {
		t.Fatal(err)
	}
	const id = "pause-confirmation-resume-1"
	path := filepath.Join(root, "temp", id+"_single")
	if err := os.WriteFile(path, []byte("saved bytes"), 0600); err != nil {
		t.Fatal(err)
	}
	task := &DownloadTask{
		ID: id, Status: "paused", FileUrl: server.URL + "/mod.vpk",
		TotalSize: 64 * 1024, DownloadedSize: 11, rootDir: root,
		transfer: &downloadTransferState{
			mode: "single", tempPath: path, totalSize: 64 * 1024,
			validator: `"saved-version"`, responseConfirmed: true,
		},
	}
	addPauseConfirmationTask(t, task)
	app := &App{rootDir: root, ctx: context.Background()}
	if err := app.ResumeDownloadTask(id); err != nil {
		t.Fatalf("resume: %v", err)
	}
	select {
	case <-requestStarted:
	case <-time.After(15 * time.Second):
		t.Fatal("resumed GET did not start")
	}
	if err := app.PauseDownloadTask(id); err == nil || !strings.Contains(err.Error(), downloadPauseConfirmationUnknown) {
		t.Fatalf("old ETag incorrectly marked the pending response safe: %v", err)
	}
	if task.Status != "downloading" {
		t.Fatalf("unconfirmed pause changed task to %s", task.Status)
	}
	if err := app.ConfirmPauseDownloadTask(id); err != nil {
		t.Fatalf("confirmed pause: %v", err)
	}
	waitPauseTestTask(t, id, func(task DownloadTask) bool { return task.Status == "paused" })
}

func TestPauseDownloadTaskBeforeTransferNeedsNoConfirmation(t *testing.T) {
	for _, status := range []string{"pending", "selecting_ip"} {
		t.Run(status, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			task := &DownloadTask{ID: "pause-confirmation-" + status, Status: status, cancelFunc: cancel}
			addPauseConfirmationTask(t, task)
			if err := (&App{}).PauseDownloadTask(task.ID); err != nil {
				t.Fatalf("pause before network transfer: %v", err)
			}
			if ctx.Err() != context.Canceled || task.Status != "pausing" {
				t.Fatalf("task was not paused: context=%v status=%q", ctx.Err(), task.Status)
			}
		})
	}
}
