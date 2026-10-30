package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestDownloadTaskStoreRoundTripAndAtomicReplace(t *testing.T) {
	dir := t.TempDir()
	a := &App{configDir: dir}
	if got, err := a.readDownloadTaskStore(); err != nil || len(got) != 0 {
		t.Fatalf("missing store: tasks=%v error=%v", got, err)
	}

	want := []persistedDownloadTask{{
		Task:    DownloadTask{ID: "task-1", WorkshopID: "123", Status: "paused", FileUrl: "https://example.invalid/mod.vpk", DownloadedSize: 5 * 1024 * 1024},
		RootDir: filepath.Join(dir, "addons"),
		Transfer: &persistedDownloadTransfer{
			Mode: "chunk", FileName: "task-1_final", Validator: `"version-1"`,
			TotalSize: 6 * 1024 * 1024, CompletedBlocks: []bool{true, false},
		},
	}}
	if err := a.writeDownloadTaskStore(want); err != nil {
		t.Fatal(err)
	}
	got, err := a.readDownloadTaskStore()
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("round trip: tasks=%#v error=%v", got, err)
	}

	// Replacing an existing file must leave a complete versioned JSON document
	// and must not leave the temporary file in the config directory.
	if err := a.writeDownloadTaskStore(nil); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(dir, downloadTaskStoreFileName))
	if err != nil {
		t.Fatal(err)
	}
	var stored persistedDownloadTaskStore
	if err := json.Unmarshal(data, &stored); err != nil {
		t.Fatalf("replacement is not valid JSON: %v", err)
	}
	if stored.Version != downloadTaskStoreVersion || stored.Tasks == nil || len(stored.Tasks) != 0 {
		t.Fatalf("unexpected replacement: %#v", stored)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != downloadTaskStoreFileName {
		t.Fatalf("temporary files remain: %v", entries)
	}
}

func TestDownloadTaskStoreRejectsUnknownVersionAndAllowsHeadlessApp(t *testing.T) {
	a := &App{}
	if err := a.writeDownloadTaskStore(nil); err != nil {
		t.Fatalf("headless write: %v", err)
	}
	if got, err := a.readDownloadTaskStore(); err != nil || len(got) != 0 {
		t.Fatalf("headless read: tasks=%v error=%v", got, err)
	}

	dir := t.TempDir()
	a.configDir = dir
	if err := os.WriteFile(filepath.Join(dir, downloadTaskStoreFileName), []byte(`{"version":2,"tasks":[]}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := a.readDownloadTaskStore(); err == nil || !strings.Contains(err.Error(), "unsupported") {
		t.Fatalf("unknown version error=%v", err)
	}
}
