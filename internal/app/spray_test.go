package app

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"l4d2-manager-next/pkg/valve/vpk"
)

func TestWriteSprayFilesSanitizesAndDeduplicates(t *testing.T) {
	tempDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(tempDir, "spray.vtf"), []byte("exists"), 0644); err != nil {
		t.Fatal(err)
	}

	payloads, err := normalizeSprayPayloads([]SprayFilePayload{
		{Name: `spray`, VTFBase64: base64.StdEncoding.EncodeToString([]byte("one"))},
		{Name: `bad:name`, VTFBase64: base64.StdEncoding.EncodeToString([]byte("two"))},
		{Name: `bad/name`, VTFBase64: base64.StdEncoding.EncodeToString([]byte("three"))},
	})
	if err != nil {
		t.Fatalf("normalize: %v", err)
	}

	files, err := writeSprayFiles(tempDir, payloads)
	if err != nil {
		t.Fatalf("write sprays: %v", err)
	}

	names := []string{files[0].Name, files[1].Name, files[2].Name}
	want := []string{"spray(1)", "bad_name", "bad_name(1)"}
	for i := range want {
		if names[i] != want[i] {
			t.Fatalf("name %d: want %q got %q", i, want[i], names[i])
		}
		if _, err := os.Stat(filepath.Join(tempDir, want[i]+".vtf")); err != nil {
			t.Fatalf("missing vtf for %s: %v", want[i], err)
		}
		vmt, err := os.ReadFile(filepath.Join(tempDir, want[i]+".vmt"))
		if err != nil {
			t.Fatalf("read vmt: %v", err)
		}
		if !strings.Contains(string(vmt), "vgui/logos/custom/"+want[i]) {
			t.Fatalf("vmt does not reference final name %q: %s", want[i], string(vmt))
		}
	}
}

func TestInstallSprayVPKCreatesArchiveInAddons(t *testing.T) {
	addonsDir := t.TempDir()
	app := &App{rootDir: addonsDir}

	result, err := app.InstallSprayVPK(SprayInstallRequest{
		PackageName: `my:spray pack`,
		Files: []SprayFilePayload{
			{Name: "logo", VTFBase64: base64.StdEncoding.EncodeToString([]byte("vtf-data"))},
		},
	})
	if err != nil {
		t.Fatalf("install spray vpk: %v", err)
	}

	wantPath := filepath.Join(addonsDir, "my_spray pack.vpk")
	if result.OutputPath != wantPath {
		t.Fatalf("unexpected output path: %q", result.OutputPath)
	}
	if result.TotalFiles != 2 || result.PackedFiles != 2 {
		t.Fatalf("unexpected pack counts: %+v", result)
	}

	opener := vpk.Single(result.OutputPath)
	defer opener.Close()

	archive, err := opener.ReadArchive()
	if err != nil {
		t.Fatalf("read archive: %v", err)
	}
	entries := map[string]bool{}
	for i := range archive.Files {
		entries[archive.Files[i].Name()] = true
	}
	if !entries["materials/vgui/logos/logo.vtf"] {
		t.Fatalf("missing logo.vtf entry: %#v", entries)
	}
	if !entries["materials/vgui/logos/logo.vmt"] {
		t.Fatalf("missing logo.vmt entry: %#v", entries)
	}
}

func TestInstallSprayVPKRequiresRootDir(t *testing.T) {
	app := &App{}
	_, err := app.InstallSprayVPK(SprayInstallRequest{
		PackageName: "spray",
		Files: []SprayFilePayload{
			{Name: "spray", VTFBase64: base64.StdEncoding.EncodeToString([]byte("data"))},
		},
	})
	if err == nil {
		t.Fatal("expected missing root dir error")
	}
}

func TestLoadSprayImportFilesReadsSupportedMedia(t *testing.T) {
	tempDir := t.TempDir()
	imagePath := filepath.Join(tempDir, "logo.png")
	data := []byte{0x89, 'P', 'N', 'G'}
	if err := os.WriteFile(imagePath, data, 0644); err != nil {
		t.Fatal(err)
	}

	app := &App{}
	files, err := app.LoadSprayImportFiles([]string{imagePath})
	if err != nil {
		t.Fatalf("load spray import files: %v", err)
	}
	if len(files) != 1 {
		t.Fatalf("expected one file, got %d", len(files))
	}
	if files[0].Name != "logo.png" || files[0].Type != "image/png" {
		t.Fatalf("unexpected payload metadata: %+v", files[0])
	}
	if files[0].Base64 != base64.StdEncoding.EncodeToString(data) {
		t.Fatalf("unexpected base64 payload: %q", files[0].Base64)
	}
}

func TestLoadSprayImportFilesRejectsVideo(t *testing.T) {
	tempDir := t.TempDir()
	videoPath := filepath.Join(tempDir, "clip.mp4")
	if err := os.WriteFile(videoPath, []byte("not-a-video"), 0644); err != nil {
		t.Fatal(err)
	}

	app := &App{}
	if _, err := app.LoadSprayImportFiles([]string{videoPath}); err == nil {
		t.Fatal("expected video import to be rejected")
	}
}
