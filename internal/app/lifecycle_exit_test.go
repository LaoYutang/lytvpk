package app

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestExitPromptsOnlyForRunningDownloads(t *testing.T) {
	cases := []struct {
		name    string
		states  []string
		confirm bool
	}{
		{name: "no tasks"},
		{name: "all paused", states: []string{"paused", "paused", "completed"}},
		{name: "pending with paused", states: []string{"pending", "paused"}, confirm: true},
		{name: "selecting IP", states: []string{"selecting_ip"}, confirm: true},
		{name: "downloading", states: []string{"downloading"}, confirm: true},
		{name: "pausing", states: []string{"pausing"}, confirm: true},
		{name: "cancelling", states: []string{"cancelling"}, confirm: true},
		{name: "failing", states: []string{"failing"}, confirm: true},
		{name: "finalizing", states: []string{"finalizing"}, confirm: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			isolatePersistentDownloadTasks(t)
			a := &App{configDir: t.TempDir()}
			taskManager.mu.Lock()
			for i, status := range tc.states {
				id := fmt.Sprintf("1000000000-%d", i+1)
				taskManager.tasks[id] = &DownloadTask{ID: id, Status: status}
			}
			taskManager.mu.Unlock()

			persistHeld := !tc.confirm
			if persistHeld {
				a.downloadPersistMu.Lock() // Hold final save while inspecting asynchronous exit.
				defer func() {
					if persistHeld {
						a.downloadPersistMu.Unlock()
					}
				}()
			}
			if !a.beforeClose() {
				t.Fatal("close skipped the guarded shutdown path")
			}
			a.exitMu.Lock()
			inProgress := a.exitInProgress
			a.exitMu.Unlock()
			a.downloadExitMu.Lock()
			gateClosed := a.downloadExitRequested
			a.downloadExitMu.Unlock()
			if tc.confirm {
				if inProgress || gateClosed {
					t.Fatal("confirmation was bypassed for a running download")
				}
			} else {
				if !inProgress || !gateClosed {
					t.Fatal("paused or empty task list did not start guarded save and exit")
				}
				if !a.beforeClose() {
					t.Fatal("repeat close bypassed an in-progress save")
				}
				a.downloadPersistMu.Unlock()
				persistHeld = false
				waitExitState(t, a, false) // No Wails context: save succeeds, then exit fails safely.
			}
		})
	}
}

func waitExitState(t *testing.T, a *App, inProgress bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		a.exitMu.Lock()
		current := a.exitInProgress
		a.exitMu.Unlock()
		if current == inProgress {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("exitInProgress did not become %v", inProgress)
}

func TestExitRepeatClickWaitsForOneShutdown(t *testing.T) {
	isolatePersistentDownloadTasks(t)
	a := &App{configDir: t.TempDir()}
	taskManager.mu.Lock()
	taskManager.tasks["1000000000-200"] = &DownloadTask{ID: "1000000000-200", Status: "finalizing"}
	taskManager.mu.Unlock()
	a.ForceExit()
	a.ForceExit()
	if !a.beforeClose() {
		t.Fatal("repeat close bypassed an in-progress shutdown")
	}
	a.exitMu.Lock()
	inProgress := a.exitInProgress
	a.exitMu.Unlock()
	if !inProgress {
		t.Fatal("repeat click cleared the in-progress exit state")
	}
	taskManager.mu.Lock()
	taskManager.tasks["1000000000-200"].Status = "completed"
	taskManager.mu.Unlock()
	waitExitState(t, a, false) // No Wails context: shutdown fails safely.
	a.exitMu.Lock()
	forceClose := a.forceClose
	a.exitMu.Unlock()
	if forceClose {
		t.Fatal("shutdown without a window context allowed the window to close")
	}
	a.downloadExitMu.Lock()
	blocked := a.downloadExitRequested
	a.downloadExitMu.Unlock()
	if blocked {
		t.Fatal("failed exit submission kept downloads blocked")
	}
}

func TestExitSaveFailureReopensDownloadAdmission(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "file-instead-of-directory")
	if err := os.WriteFile(configPath, []byte("x"), 0600); err != nil {
		t.Fatal(err)
	}
	a := &App{configDir: configPath, ctx: context.Background(), exitInProgress: true}
	a.finishExit(context.Background())
	a.exitMu.Lock()
	inProgress, forceClose := a.exitInProgress, a.forceClose
	a.exitMu.Unlock()
	if inProgress || forceClose {
		t.Fatal("failed checkpoint left exit active or allowed window close")
	}
	a.downloadExitMu.Lock()
	blocked := a.downloadExitRequested
	a.downloadExitMu.Unlock()
	if blocked {
		t.Fatal("failed checkpoint kept downloads blocked")
	}
}
