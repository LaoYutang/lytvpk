package app

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/panjf2000/ants/v2"
)

func newWorkshopMoveTestApp(t *testing.T, metaEnabled bool) (*App, string, string) {
	t.Helper()
	rootDir := t.TempDir()
	workshopDir := filepath.Join(rootDir, "workshop")
	if err := os.MkdirAll(workshopDir, 0755); err != nil {
		t.Fatalf("create workshop directory: %v", err)
	}
	pool, err := ants.NewPool(4)
	if err != nil {
		t.Fatalf("create goroutine pool: %v", err)
	}
	t.Cleanup(pool.Release)
	return &App{
		rootDir:             rootDir,
		workshopMetaEnabled: metaEnabled,
		goroutinePool:       pool,
	}, rootDir, workshopDir
}

func addWorkshopMoveTestFile(t *testing.T, app *App, filePath string, location string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
		t.Fatalf("create parent directory: %v", err)
	}
	if err := os.WriteFile(filePath, []byte("vpk"), 0644); err != nil {
		t.Fatalf("write VPK: %v", err)
	}
	info, err := os.Stat(filePath)
	if err != nil {
		t.Fatalf("stat VPK: %v", err)
	}
	app.vpkCache.Store(filePath, &VPKFileCache{
		File: VPKFile{
			Name:     filepath.Base(filePath),
			Path:     filePath,
			Location: location,
			Enabled:  location != "disabled",
		},
		ModTime: info.ModTime(),
		Size:    info.Size(),
	})
}

func resetWorkshopDetailTestClient(t *testing.T, serverURL string) {
	t.Helper()
	WorkshopWorkerURL = serverURL
	workshopClient = nil
	workshopClientOnce = sync.Once{}
	clearWorkshopDetailTestCache()
	t.Cleanup(func() {
		WorkshopWorkerURL = "https://l4d2-workshop.laoyutang.cn"
		workshopClient = nil
		workshopClientOnce = sync.Once{}
		clearWorkshopDetailTestCache()
	})
}

func clearWorkshopDetailTestCache() {
	workshopCache.Range(func(key, _ interface{}) bool {
		workshopCache.Delete(key)
		return true
	})
}

func TestMoveWorkshopFilesToAddonsBatchSkipsOtherLocationsAndDeduplicates(t *testing.T) {
	app, rootDir, workshopDir := newWorkshopMoveTestApp(t, false)
	first := filepath.Join(workshopDir, "3710541769.vpk")
	second := filepath.Join(workshopDir, "3710541770.vpk")
	rootFile := filepath.Join(rootDir, "already-root.vpk")
	addWorkshopMoveTestFile(t, app, first, "workshop")
	addWorkshopMoveTestFile(t, app, second, "workshop")
	addWorkshopMoveTestFile(t, app, rootFile, "root")

	result, err := app.MoveWorkshopFilesToAddons([]string{first, second, first, rootFile})
	if err != nil {
		t.Fatalf("MoveWorkshopFilesToAddons returned error: %v", err)
	}
	if result.Total != 3 || result.EligibleCount != 2 || result.SuccessCount != 2 || result.FailCount != 0 || result.SkippedCount != 1 {
		t.Fatalf("unexpected result: %+v", result)
	}

	for _, sourcePath := range []string{first, second} {
		targetPath := filepath.Join(rootDir, filepath.Base(sourcePath))
		if _, err := os.Stat(targetPath); err != nil {
			t.Fatalf("target VPK missing %s: %v", targetPath, err)
		}
		if _, ok := app.vpkCache.Load(sourcePath); ok {
			t.Fatalf("old cache entry still exists: %s", sourcePath)
		}
		cached, ok := app.vpkCache.Load(targetPath)
		if !ok {
			t.Fatalf("new cache entry missing: %s", targetPath)
		}
		file := cached.(*VPKFileCache).File
		if file.Location != "root" || !file.Enabled || file.Path != targetPath {
			t.Fatalf("cache not updated: %+v", file)
		}
	}
	if _, err := os.Stat(rootFile); err != nil {
		t.Fatalf("skipped root VPK changed: %v", err)
	}
}

func TestMoveWorkshopFilesToAddonsMovesThumbnailsAndWarnsOnConflict(t *testing.T) {
	app, rootDir, workshopDir := newWorkshopMoveTestApp(t, false)
	first := filepath.Join(workshopDir, "3710541769.vpk")
	second := filepath.Join(workshopDir, "3710541770.vpk")
	addWorkshopMoveTestFile(t, app, first, "workshop")
	addWorkshopMoveTestFile(t, app, second, "workshop")
	if err := os.WriteFile(filepath.Join(workshopDir, "3710541769.jpg"), []byte("jpg"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workshopDir, "3710541769.gif"), []byte("gif"), 0644); err != nil {
		t.Fatal(err)
	}
	secondThumbnail := filepath.Join(workshopDir, "3710541770.png")
	if err := os.WriteFile(secondThumbnail, []byte("source"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(rootDir, "3710541770.png"), []byte("target"), 0644); err != nil {
		t.Fatal(err)
	}

	result, err := app.MoveWorkshopFilesToAddons([]string{first, second})
	if err != nil {
		t.Fatalf("MoveWorkshopFilesToAddons returned error: %v", err)
	}
	if result.SuccessCount != 2 || result.FailCount != 0 || result.WarningCount != 1 {
		t.Fatalf("unexpected result: %+v", result)
	}
	if _, err := os.Stat(filepath.Join(rootDir, "3710541769.jpg")); err != nil {
		t.Fatalf("thumbnail was not moved: %v", err)
	}
	if _, err := os.Stat(filepath.Join(rootDir, "3710541769.gif")); err != nil {
		t.Fatalf("GIF thumbnail was not moved: %v", err)
	}
	if _, err := os.Stat(secondThumbnail); err != nil {
		t.Fatalf("conflicting source thumbnail should remain: %v", err)
	}
}

func TestMoveWorkshopFilesToAddonsVPKConflictFailsWithoutMovingSource(t *testing.T) {
	app, rootDir, workshopDir := newWorkshopMoveTestApp(t, false)
	sourcePath := filepath.Join(workshopDir, "3710541769.vpk")
	addWorkshopMoveTestFile(t, app, sourcePath, "workshop")
	if err := os.WriteFile(filepath.Join(rootDir, "3710541769.vpk"), []byte("existing"), 0644); err != nil {
		t.Fatal(err)
	}

	result, err := app.MoveWorkshopFilesToAddons([]string{sourcePath})
	if err != nil {
		t.Fatalf("MoveWorkshopFilesToAddons returned error: %v", err)
	}
	if result.SuccessCount != 0 || result.FailCount != 1 {
		t.Fatalf("unexpected result: %+v", result)
	}
	if _, err := os.Stat(sourcePath); err != nil {
		t.Fatalf("source VPK should remain after failure: %v", err)
	}
}

func TestMoveWorkshopFilesToAddonsFetchesAndStoresRawMetaOnce(t *testing.T) {
	var requestCount atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount.Add(1)
		if got := r.URL.Query().Get("id"); got != "3710541769" {
			t.Errorf("unexpected workshop id: %s", got)
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"response":{"publishedfiledetails":[{"publishedfileid":"3710541769","title":"Test Mod","creator":"76561198000000000","description":"Description","file_url":"https://cdn.example/mod.vpk","preview_url":"https://cdn.example/preview.jpg","time_updated":1700000000}]}}`)
	}))
	defer server.Close()
	resetWorkshopDetailTestClient(t, server.URL)

	app, rootDir, workshopDir := newWorkshopMoveTestApp(t, true)
	sourcePath := filepath.Join(workshopDir, "3710541769.vpk")
	addWorkshopMoveTestFile(t, app, sourcePath, "workshop")

	result, err := app.MoveWorkshopFilesToAddons([]string{sourcePath})
	if err != nil {
		t.Fatalf("MoveWorkshopFilesToAddons returned error: %v", err)
	}
	if result.SuccessCount != 1 || result.WarningCount != 0 || !result.Items[0].MetaSaved {
		t.Fatalf("unexpected result: %+v", result)
	}
	if requestCount.Load() != 1 {
		t.Fatalf("expected exactly one detail request, got %d", requestCount.Load())
	}

	targetPath := filepath.Join(rootDir, "3710541769.vpk")
	meta, err := LoadWorkshopMeta(targetPath)
	if err != nil || meta == nil {
		t.Fatalf("load meta: %v, meta=%v", err, meta)
	}
	if meta.WorkshopID != "3710541769" || meta.Title != "Test Mod" || meta.Author != "76561198000000000" || meta.Description != "Description" {
		t.Fatalf("unexpected meta fields: %+v", meta)
	}
	if meta.PreviewURL != "https://cdn.example/preview.jpg" || meta.FileURL != "https://cdn.example/mod.vpk" {
		t.Fatalf("meta stored a transformed URL: %+v", meta)
	}
	if meta.TimeUpdated != time.Unix(1700000000, 0).UTC().Format(time.RFC3339) {
		t.Fatalf("unexpected time_updated: %s", meta.TimeUpdated)
	}
	if _, err := time.Parse(time.RFC3339, meta.DownloadedAt); err != nil {
		t.Fatalf("invalid downloaded_at: %q", meta.DownloadedAt)
	}
	cached, _ := app.vpkCache.Load(targetPath)
	if cached.(*VPKFileCache).File.WorkshopID != "3710541769" || cached.(*VPKFileCache).File.Title != "Test Mod" {
		t.Fatalf("meta was not applied to cache: %+v", cached.(*VPKFileCache).File)
	}
}

func TestMoveWorkshopFilesToAddonsMetaDisabledDoesNotFetch(t *testing.T) {
	var requestCount atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requestCount.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()
	resetWorkshopDetailTestClient(t, server.URL)

	app, rootDir, workshopDir := newWorkshopMoveTestApp(t, false)
	sourcePath := filepath.Join(workshopDir, "3710541769.vpk")
	addWorkshopMoveTestFile(t, app, sourcePath, "workshop")
	result, err := app.MoveWorkshopFilesToAddons([]string{sourcePath})
	if err != nil || result.SuccessCount != 1 || result.WarningCount != 0 {
		t.Fatalf("unexpected result: %+v, err=%v", result, err)
	}
	if requestCount.Load() != 0 {
		t.Fatalf("meta-disabled transfer made %d requests", requestCount.Load())
	}
	if meta, err := LoadWorkshopMeta(filepath.Join(rootDir, "3710541769.vpk")); err != nil || meta != nil {
		t.Fatalf("meta should not be created: meta=%v err=%v", meta, err)
	}
}

func TestMoveWorkshopFilesToAddonsMetaFailuresOnlyWarn(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()
	resetWorkshopDetailTestClient(t, server.URL)

	app, _, workshopDir := newWorkshopMoveTestApp(t, true)
	validPath := filepath.Join(workshopDir, "3710541769.vpk")
	invalidPath := filepath.Join(workshopDir, "not-an-id.vpk")
	addWorkshopMoveTestFile(t, app, validPath, "workshop")
	addWorkshopMoveTestFile(t, app, invalidPath, "workshop")

	result, err := app.MoveWorkshopFilesToAddons([]string{validPath, invalidPath})
	if err != nil {
		t.Fatalf("MoveWorkshopFilesToAddons returned error: %v", err)
	}
	if result.SuccessCount != 2 || result.FailCount != 0 || result.WarningCount != 2 {
		t.Fatalf("meta failures should only warn: %+v", result)
	}
}

func TestMoveWorkshopFilesToAddonsMetaWriteFailureOnlyWarns(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"response":{"publishedfiledetails":[{"publishedfileid":"3710541769","title":"Test Mod"}]}}`)
	}))
	defer server.Close()
	resetWorkshopDetailTestClient(t, server.URL)

	app, rootDir, workshopDir := newWorkshopMoveTestApp(t, true)
	sourcePath := filepath.Join(workshopDir, "3710541769.vpk")
	addWorkshopMoveTestFile(t, app, sourcePath, "workshop")
	if err := os.Mkdir(filepath.Join(rootDir, "3710541769.meta"), 0755); err != nil {
		t.Fatalf("create conflicting meta directory: %v", err)
	}

	result, err := app.MoveWorkshopFilesToAddons([]string{sourcePath})
	if err != nil {
		t.Fatalf("MoveWorkshopFilesToAddons returned error: %v", err)
	}
	if result.SuccessCount != 1 || result.FailCount != 0 || result.WarningCount != 1 || result.Items[0].MetaSaved {
		t.Fatalf("meta write failure should only warn: %+v", result)
	}
}
