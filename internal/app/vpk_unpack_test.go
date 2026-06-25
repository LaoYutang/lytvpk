package app

import (
	"bytes"
	"hash/crc32"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"l4d2-manager-next/pkg/valve/vpk"
)

func TestUnpackVPKFilePreservesDirectoryStructure(t *testing.T) {
	tempDir := t.TempDir()
	vpkPath := filepath.Join(tempDir, "sample.vpk")
	writeTestVPK(t, vpkPath, map[string][]byte{
		"materials/test/a.txt": []byte("hello"),
		"scripts/addon.txt":    []byte("script"),
	})

	outputRoot := filepath.Join(tempDir, "out")
	if err := os.Mkdir(outputRoot, 0755); err != nil {
		t.Fatal(err)
	}

	app := &App{}
	result, err := app.UnpackVPKFile(vpkPath, outputRoot)
	if err != nil {
		t.Fatalf("unpack vpk: %v", err)
	}

	if result.SourcePath != vpkPath {
		t.Fatalf("unexpected source path: %q", result.SourcePath)
	}
	if result.OutputDir != filepath.Join(outputRoot, "sample") {
		t.Fatalf("unexpected output dir: %q", result.OutputDir)
	}
	if result.TotalFiles != 2 || result.ExtractedFiles != 2 {
		t.Fatalf("unexpected counts: %+v", result)
	}

	assertFileContent(t, filepath.Join(result.OutputDir, "materials", "test", "a.txt"), "hello")
	assertFileContent(t, filepath.Join(result.OutputDir, "scripts", "addon.txt"), "script")
}

func TestCreateUniqueVPKOutputDirUsesNumberedSuffix(t *testing.T) {
	tempDir := t.TempDir()
	if err := os.Mkdir(filepath.Join(tempDir, "sample"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(tempDir, "sample(1)"), 0755); err != nil {
		t.Fatal(err)
	}

	outputDir, err := createUniqueVPKOutputDir(tempDir, filepath.Join(tempDir, "sample.vpk"))
	if err != nil {
		t.Fatalf("create output dir: %v", err)
	}

	if outputDir != filepath.Join(tempDir, "sample(2)") {
		t.Fatalf("expected sample(2), got %q", outputDir)
	}
}

func TestSafeVPKOutputPathRejectsUnsafePaths(t *testing.T) {
	root := filepath.Join(t.TempDir(), "out")
	if got, err := safeVPKOutputPath(root, "materials/test.txt"); err != nil {
		t.Fatalf("expected valid path: %v", err)
	} else if got != filepath.Join(root, "materials", "test.txt") {
		t.Fatalf("unexpected valid path: %q", got)
	}

	unsafeEntries := []string{
		"../evil.txt",
		"/evil.txt",
		"C:/evil.txt",
		"dir/../../evil.txt",
	}
	for _, entry := range unsafeEntries {
		if _, err := safeVPKOutputPath(root, entry); err == nil {
			t.Fatalf("expected unsafe path %q to fail", entry)
		}
	}
}

func writeTestVPK(t *testing.T, filePath string, entries map[string][]byte) {
	t.Helper()

	names := make([]string, 0, len(entries))
	for name := range entries {
		names = append(names, name)
	}
	sort.Slice(names, func(i, j int) bool {
		left := splitVPKTestPath(names[i])
		right := splitVPKTestPath(names[j])
		if left.ext != right.ext {
			return left.ext < right.ext
		}
		if left.dir != right.dir {
			return left.dir < right.dir
		}
		return left.base < right.base
	})

	archive := &vpk.Archive{
		Header: vpk.Header{
			Magic:   vpk.Magic,
			Version: 1,
		},
		Files: make([]vpk.File, 0, len(entries)),
	}

	var offset uint32
	for _, name := range names {
		parts := splitVPKTestPath(name)
		data := entries[name]
		archive.Files = append(archive.Files, vpk.File{
			Dir:  parts.dir,
			Base: parts.base,
			Ext:  parts.ext,
			DirEntry: vpk.DirEntry{
				CRC:           crc32.ChecksumIEEE(data),
				DataLocation:  []vpk.DataChunk{{ArchiveIndex: 0x7fff, EntryOffset: offset, EntryLength: uint32(len(data))}},
				MetadataBytes: 0,
			},
		})
		offset += uint32(len(data))
	}

	var buffer bytes.Buffer
	if err := vpk.WriteDirectory(&buffer, archive); err != nil {
		t.Fatalf("write vpk directory: %v", err)
	}
	for _, name := range names {
		buffer.Write(entries[name])
	}

	if err := os.WriteFile(filePath, buffer.Bytes(), 0644); err != nil {
		t.Fatalf("write test vpk: %v", err)
	}
}

type vpkTestPathParts struct {
	dir  string
	base string
	ext  string
}

func splitVPKTestPath(name string) vpkTestPathParts {
	name = strings.ReplaceAll(name, "\\", "/")
	ext := strings.TrimPrefix(path.Ext(name), ".")
	base := strings.TrimSuffix(path.Base(name), path.Ext(name))
	dir := path.Dir(name)
	if dir == "." {
		dir = " "
	}
	if ext == "" {
		ext = " "
	}
	if base == "" {
		base = " "
	}
	return vpkTestPathParts{dir: dir, base: base, ext: ext}
}

func assertFileContent(t *testing.T, filePath string, want string) {
	t.Helper()
	data, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("read %s: %v", filePath, err)
	}
	if string(data) != want {
		t.Fatalf("unexpected content for %s: %q", filePath, data)
	}
}
