package app

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"

	"github.com/panjf2000/ants/v2"
)

func TestInstallVPKFileReportsProgress(t *testing.T) {
	tempDir := t.TempDir()
	sourcePath := filepath.Join(tempDir, "sample.vpk")
	if err := os.WriteFile(sourcePath, []byte("vpk-content"), 0644); err != nil {
		t.Fatal(err)
	}

	outputDir := filepath.Join(tempDir, "addons")
	if err := os.Mkdir(outputDir, 0755); err != nil {
		t.Fatal(err)
	}

	var progress []int
	app := &App{rootDir: outputDir}
	outputPath, err := app.installVPKFile(sourcePath, func(percent int, message string) {
		progress = append(progress, percent)
	})
	if err != nil {
		t.Fatalf("install vpk: %v", err)
	}

	if outputPath != filepath.Join(outputDir, "sample.vpk") {
		t.Fatalf("unexpected output path: %q", outputPath)
	}
	assertFileContent(t, outputPath, "vpk-content")
	assertProgressReached100(t, progress)
}

func TestExtractVPKFromZipWithProgress(t *testing.T) {
	tempDir := t.TempDir()
	zipPath := filepath.Join(tempDir, "mods.zip")
	writeTestZip(t, zipPath, map[string]string{
		"nested/sample.vpk": "vpk-content",
		"sample.jpg":        "image",
		"readme.txt":        "ignored",
	})

	outputDir := filepath.Join(tempDir, "addons")
	if err := os.Mkdir(outputDir, 0755); err != nil {
		t.Fatal(err)
	}

	var progress []int
	sawActiveVPK := false
	pool, err := ants.NewPool(2)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Release()
	app := &App{goroutinePool: pool}
	if err := app.extractVPKFromZipWithProgress(zipPath, outputDir, func(percent int, message string, activeNames []string) {
		progress = append(progress, percent)
		if len(activeNames) > 0 {
			sawActiveVPK = true
		}
	}); err != nil {
		t.Fatalf("extract zip: %v", err)
	}

	assertFileContent(t, filepath.Join(outputDir, "sample.vpk"), "vpk-content")
	assertFileContent(t, filepath.Join(outputDir, "sample.jpg"), "image")
	if _, err := os.Stat(filepath.Join(outputDir, "readme.txt")); !os.IsNotExist(err) {
		t.Fatalf("expected readme.txt to be ignored, stat err: %v", err)
	}
	assertProgressReached100(t, progress)
	if !sawActiveVPK {
		t.Fatal("expected active VPK names during parallel extraction")
	}
}

func TestPackVPKDirectoryWithProgress(t *testing.T) {
	tempDir := t.TempDir()
	sourceDir := filepath.Join(tempDir, "folder_mod")
	if err := os.MkdirAll(filepath.Join(sourceDir, "scripts"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sourceDir, "scripts", "addon.txt"), []byte("script"), 0644); err != nil {
		t.Fatal(err)
	}

	outputDir := filepath.Join(tempDir, "addons")
	if err := os.Mkdir(outputDir, 0755); err != nil {
		t.Fatal(err)
	}

	var progress []int
	app := &App{}
	result, err := app.packVPKDirectoryWithProgress(sourceDir, outputDir, true, func(percent int, message string) {
		progress = append(progress, percent)
	})
	if err != nil {
		t.Fatalf("pack with progress: %v", err)
	}

	if result.OutputPath != filepath.Join(outputDir, "folder_mod.vpk") {
		t.Fatalf("unexpected output path: %q", result.OutputPath)
	}
	if result.TotalFiles != 1 || result.PackedFiles != 1 || !result.OutputIsAddons {
		t.Fatalf("unexpected pack result: %+v", result)
	}
	assertProgressReached100(t, progress)
}

func TestHandleFileDropReportsEmptyFolderFailure(t *testing.T) {
	tempDir := t.TempDir()
	emptyDir := filepath.Join(tempDir, "empty")
	if err := os.Mkdir(emptyDir, 0755); err != nil {
		t.Fatal(err)
	}
	outputDir := filepath.Join(tempDir, "addons")
	if err := os.Mkdir(outputDir, 0755); err != nil {
		t.Fatal(err)
	}

	app := &App{rootDir: outputDir}
	result, err := app.HandleFileDrop([]string{emptyDir})
	if err != nil {
		t.Fatalf("handle drop: %v", err)
	}
	if result.Succeeded != 0 || result.Failed != 1 || result.HasInstallChanges {
		t.Fatalf("unexpected result: %+v", result)
	}
	if len(result.Items) != 1 || result.Items[0].Kind != dropImportKindFolder || result.Items[0].Success {
		t.Fatalf("unexpected item: %+v", result.Items)
	}
}

func TestHandleFileDropMixedPaths(t *testing.T) {
	tempDir := t.TempDir()
	outputDir := filepath.Join(tempDir, "addons")
	if err := os.Mkdir(outputDir, 0755); err != nil {
		t.Fatal(err)
	}

	vpkPath := filepath.Join(tempDir, "sample.vpk")
	if err := os.WriteFile(vpkPath, []byte("vpk-content"), 0644); err != nil {
		t.Fatal(err)
	}
	unsupportedPath := filepath.Join(tempDir, "notes.txt")
	if err := os.WriteFile(unsupportedPath, []byte("notes"), 0644); err != nil {
		t.Fatal(err)
	}
	dumpPath := filepath.Join(tempDir, "crash.mdmp")
	if err := os.WriteFile(dumpPath, []byte("dump"), 0644); err != nil {
		t.Fatal(err)
	}

	app := &App{rootDir: outputDir}
	result, err := app.HandleFileDrop([]string{vpkPath, unsupportedPath, dumpPath})
	if err != nil {
		t.Fatalf("handle drop: %v", err)
	}

	if result.Total != 3 || result.Succeeded != 2 || result.Failed != 1 || !result.HasInstallChanges {
		t.Fatalf("unexpected result: %+v", result)
	}
	if result.Items[2].Kind != dropImportKindDump || !result.Items[2].Success {
		t.Fatalf("expected dump success, got %+v", result.Items[2])
	}
	assertFileContent(t, filepath.Join(outputDir, "sample.vpk"), "vpk-content")
}

func TestHandleFileDropDumpDoesNotRequireRootDir(t *testing.T) {
	tempDir := t.TempDir()
	dumpPath := filepath.Join(tempDir, "crash.dmp")
	if err := os.WriteFile(dumpPath, []byte("dump"), 0644); err != nil {
		t.Fatal(err)
	}

	app := &App{}
	result, err := app.HandleFileDrop([]string{dumpPath})
	if err != nil {
		t.Fatalf("handle drop: %v", err)
	}
	if result.Total != 1 || result.Succeeded != 1 || result.Failed != 0 || result.HasInstallChanges {
		t.Fatalf("unexpected result: %+v", result)
	}
	if len(result.Items) != 1 || result.Items[0].Kind != dropImportKindDump || !result.Items[0].Success {
		t.Fatalf("unexpected item: %+v", result.Items)
	}
}

func writeTestZip(t *testing.T, zipPath string, entries map[string]string) {
	t.Helper()

	file, err := os.Create(zipPath)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	for name, content := range entries {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatalf("create zip entry %s: %v", name, err)
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			t.Fatalf("write zip entry %s: %v", name, err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
}

func assertProgressReached100(t *testing.T, progress []int) {
	t.Helper()
	if len(progress) == 0 {
		t.Fatal("expected progress updates")
	}
	if progress[len(progress)-1] != 100 {
		t.Fatalf("expected final progress 100, got %v", progress)
	}
}
