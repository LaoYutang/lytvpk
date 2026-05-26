package app

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestProblemModScanStillExistsConvergesAndRestores(t *testing.T) {
	app := newProblemScanTestApp(t)
	for _, name := range []string{"a.vpk", "b.vpk", "c.vpk", "d.vpk"} {
		addProblemScanTestMod(t, app, name)
	}

	session, err := app.StartProblemModScan()
	if err != nil {
		t.Fatalf("StartProblemModScan failed: %v", err)
	}
	if !session.Active || len(session.CurrentDisabled) != 2 || len(session.CurrentEnabled) != 2 || len(session.AppliedDisabled) != 2 {
		t.Fatalf("unexpected first round: %+v", session)
	}
	assertProblemScanLocation(t, app, "a.vpk", false)
	assertProblemScanLocation(t, app, "b.vpk", false)
	assertProblemScanLocation(t, app, "c.vpk", true)
	assertProblemScanLocation(t, app, "d.vpk", true)

	session, err = app.SubmitProblemModScanResult("still_exists")
	if err != nil {
		t.Fatalf("first submit failed: %v", err)
	}
	if !session.Active || len(session.CurrentCandidates) != 2 || session.CurrentDisabled[0].Name != "c.vpk" || len(session.AppliedDisabled) != 3 {
		t.Fatalf("unexpected second round: %+v", session)
	}
	assertProblemScanLocation(t, app, "a.vpk", false)
	assertProblemScanLocation(t, app, "b.vpk", false)
	assertProblemScanLocation(t, app, "c.vpk", false)
	assertProblemScanLocation(t, app, "d.vpk", true)

	session, err = app.SubmitProblemModScanResult("still_exists")
	if err != nil {
		t.Fatalf("second submit failed: %v", err)
	}
	if session.Active || session.Status != problemScanStatusFound || session.SuspiciousMod == nil || session.SuspiciousMod.Name != "d.vpk" {
		t.Fatalf("expected d.vpk as suspect, got %+v", session)
	}
	for _, name := range []string{"a.vpk", "b.vpk", "c.vpk", "d.vpk"} {
		assertProblemScanLocation(t, app, name, true)
	}
	if _, err := os.Stat(app.problemScanPath); !os.IsNotExist(err) {
		t.Fatalf("expected session file removed, stat err=%v", err)
	}
}

func TestProblemModScanGoneConverges(t *testing.T) {
	app := newProblemScanTestApp(t)
	for _, name := range []string{"a.vpk", "b.vpk", "c.vpk", "d.vpk"} {
		addProblemScanTestMod(t, app, name)
	}

	if _, err := app.StartProblemModScan(); err != nil {
		t.Fatalf("StartProblemModScan failed: %v", err)
	}
	session, err := app.SubmitProblemModScanResult("gone")
	if err != nil {
		t.Fatalf("first submit failed: %v", err)
	}
	if !session.Active || len(session.CurrentCandidates) != 2 || session.CurrentDisabled[0].Name != "a.vpk" {
		t.Fatalf("unexpected second round: %+v", session)
	}
	if len(session.AppliedDisabled) != 3 {
		t.Fatalf("expected three disabled mods in second round, got %+v", session.AppliedDisabled)
	}
	assertProblemScanLocation(t, app, "a.vpk", false)
	assertProblemScanLocation(t, app, "b.vpk", true)
	assertProblemScanLocation(t, app, "c.vpk", false)
	assertProblemScanLocation(t, app, "d.vpk", false)

	session, err = app.SubmitProblemModScanResult("gone")
	if err != nil {
		t.Fatalf("second submit failed: %v", err)
	}
	if session.Active || session.SuspiciousMod == nil || session.SuspiciousMod.Name != "a.vpk" {
		t.Fatalf("expected a.vpk as suspect, got %+v", session)
	}
}

func TestProblemModScanRestoreDoesNotEnablePreviouslyDisabledMods(t *testing.T) {
	app := newProblemScanTestApp(t)
	for _, name := range []string{"a.vpk", "b.vpk"} {
		addProblemScanTestMod(t, app, name)
	}
	disabledPath := filepath.Join(app.rootDir, "disabled", "x.vpk")
	if err := os.MkdirAll(filepath.Dir(disabledPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(disabledPath, []byte("disabled"), 0644); err != nil {
		t.Fatal(err)
	}

	if _, err := app.StartProblemModScan(); err != nil {
		t.Fatalf("StartProblemModScan failed: %v", err)
	}
	if _, err := app.RestoreProblemModScan(); err != nil {
		t.Fatalf("RestoreProblemModScan failed: %v", err)
	}

	assertProblemScanLocation(t, app, "a.vpk", true)
	assertProblemScanLocation(t, app, "b.vpk", true)
	if _, err := os.Stat(disabledPath); err != nil {
		t.Fatalf("previously disabled mod should stay disabled: %v", err)
	}
}

func TestProblemModScanSessionJSONRoundTrip(t *testing.T) {
	app := newProblemScanTestApp(t)
	for _, name := range []string{"a.vpk", "b.vpk"} {
		addProblemScanTestMod(t, app, name)
	}

	started, err := app.StartProblemModScan()
	if err != nil {
		t.Fatalf("StartProblemModScan failed: %v", err)
	}
	loaded := app.GetProblemModScanSession()
	if !loaded.Active || loaded.Round != started.Round || len(loaded.CurrentCandidates) != 2 {
		t.Fatalf("unexpected loaded session: %+v", loaded)
	}
}

func newProblemScanTestApp(t *testing.T) *App {
	t.Helper()
	rootDir := t.TempDir()
	configDir := t.TempDir()
	app := &App{
		rootDir:         rootDir,
		configDir:       configDir,
		configPath:      filepath.Join(configDir, "config.json"),
		serversPath:     filepath.Join(configDir, "servers.json"),
		problemScanPath: filepath.Join(configDir, "problem_mod_scan.json"),
	}
	if err := os.MkdirAll(filepath.Join(rootDir, "disabled"), 0755); err != nil {
		t.Fatal(err)
	}
	return app
}

func addProblemScanTestMod(t *testing.T, app *App, name string) {
	t.Helper()
	path := filepath.Join(app.rootDir, name)
	content := []byte("mod-" + name)
	if err := os.WriteFile(path, content, 0644); err != nil {
		t.Fatal(err)
	}
	modTime := time.Date(2026, 1, 1, 0, 0, len(name), 0, time.UTC)
	if err := os.Chtimes(path, modTime, modTime); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	app.vpkCache.Store(path, &VPKFileCache{
		File: VPKFile{
			Name:         name,
			Path:         path,
			Size:         info.Size(),
			Location:     "root",
			Enabled:      true,
			LastModified: info.ModTime().Format(time.RFC3339),
			Title:        name,
		},
		ModTime: info.ModTime(),
		Size:    info.Size(),
	})
}

func assertProblemScanLocation(t *testing.T, app *App, name string, enabled bool) {
	t.Helper()
	rootPath := filepath.Join(app.rootDir, name)
	disabledPath := filepath.Join(app.rootDir, "disabled", name)
	if enabled {
		if _, err := os.Stat(rootPath); err != nil {
			t.Fatalf("expected %s enabled: %v", name, err)
		}
		if _, err := os.Stat(disabledPath); !os.IsNotExist(err) {
			t.Fatalf("expected %s absent from disabled, err=%v", name, err)
		}
		return
	}
	if _, err := os.Stat(disabledPath); err != nil {
		t.Fatalf("expected %s disabled: %v", name, err)
	}
	if _, err := os.Stat(rootPath); !os.IsNotExist(err) {
		t.Fatalf("expected %s absent from root, err=%v", name, err)
	}
}
