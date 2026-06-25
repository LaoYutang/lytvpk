package app

import (
	"os"
	"path/filepath"
	"testing"

	"l4d2-manager-next/pkg/valve/vpk"
)

func TestPackVPKDirectoryProducesValidArchive(t *testing.T) {
	tempDir := t.TempDir()

	sourceDir := filepath.Join(tempDir, "my_mod")
	if err := os.MkdirAll(filepath.Join(sourceDir, "materials", "test"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(sourceDir, "scripts"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sourceDir, "materials", "test", "a.txt"), []byte("hello"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sourceDir, "scripts", "addon.txt"), []byte("script"), 0644); err != nil {
		t.Fatal(err)
	}

	outputDir := filepath.Join(tempDir, "out")
	if err := os.Mkdir(outputDir, 0755); err != nil {
		t.Fatal(err)
	}

	app := &App{}
	result, err := app.PackVPKDirectory(sourceDir, outputDir, false)
	if err != nil {
		t.Fatalf("pack vpk: %v", err)
	}

	if result.SourceDir != sourceDir {
		t.Fatalf("unexpected source dir: %q", result.SourceDir)
	}
	if result.OutputPath != filepath.Join(outputDir, "my_mod.vpk") {
		t.Fatalf("unexpected output path: %q", result.OutputPath)
	}
	if result.TotalFiles != 2 || result.PackedFiles != 2 {
		t.Fatalf("unexpected counts: %+v", result)
	}

	// Round-trip: read the packed VPK back and verify file contents.
	opener := vpk.Single(result.OutputPath)
	defer opener.Close()

	archive, err := opener.ReadArchive()
	if err != nil {
		t.Fatalf("read packed vpk: %v", err)
	}
	if len(archive.Files) != 2 {
		t.Fatalf("expected 2 files in archive, got %d", len(archive.Files))
	}

	contentByName := map[string][]byte{}
	for i := range archive.Files {
		f := &archive.Files[i]
		data, err := f.Bytes(opener)
		if err != nil {
			t.Fatalf("read file %s from archive: %v", f.Name(), err)
		}
		contentByName[f.Name()] = data
	}

	if string(contentByName["materials/test/a.txt"]) != "hello" {
		t.Fatalf("unexpected content for materials/test/a.txt: %q", contentByName["materials/test/a.txt"])
	}
	if string(contentByName["scripts/addon.txt"]) != "script" {
		t.Fatalf("unexpected content for scripts/addon.txt: %q", contentByName["scripts/addon.txt"])
	}
}

func TestCreateUniqueVPKOutputFileUsesNumberedSuffix(t *testing.T) {
	tempDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(tempDir, "sample.vpk"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tempDir, "sample(1).vpk"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}

	outputPath, err := createUniqueVPKOutputFile(tempDir, filepath.Join(tempDir, "sample"))
	if err != nil {
		t.Fatalf("create output file: %v", err)
	}
	if outputPath != filepath.Join(tempDir, "sample(2).vpk") {
		t.Fatalf("expected sample(2).vpk, got %q", outputPath)
	}
}

func TestPackVPKDirectoryRejectsEmptyDir(t *testing.T) {
	tempDir := t.TempDir()

	sourceDir := filepath.Join(tempDir, "empty_mod")
	if err := os.Mkdir(sourceDir, 0755); err != nil {
		t.Fatal(err)
	}
	outputDir := filepath.Join(tempDir, "out")
	if err := os.Mkdir(outputDir, 0755); err != nil {
		t.Fatal(err)
	}

	app := &App{}
	if _, err := app.PackVPKDirectory(sourceDir, outputDir, false); err == nil {
		t.Fatal("expected error for empty directory, got nil")
	}
}
