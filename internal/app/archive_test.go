package app

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"unicode/utf16"

	"github.com/nwaples/rardecode/v2"
	"github.com/panjf2000/ants/v2"
)

type archiveFixtureEntry struct{ name, content string }

func archiveLE16(b []byte, n uint16) []byte   { return binary.LittleEndian.AppendUint16(b, n) }
func archiveLE32(b []byte, n uint32) []byte   { return binary.LittleEndian.AppendUint32(b, n) }
func archiveVarint(b []byte, n uint64) []byte { return binary.AppendUvarint(b, n) }

// Stored RAR4 and RAR5 fixtures are generated in memory, with real header and
// payload checksums. No external archiver or downloaded fixture is required.
func makeRAR4Fixture(entries []archiveFixtureEntry) []byte {
	block := func(kind byte, flags uint16, body []byte) []byte {
		h := append([]byte{kind}, archiveLE16(nil, flags)...)
		h = archiveLE16(h, uint16(7+len(body)))
		h = append(h, body...)
		return append(archiveLE16(nil, uint16(crc32.ChecksumIEEE(h))), h...)
	}
	b := append([]byte("Rar!\x1a\x07\x00"), block(0x73, 0, make([]byte, 6))...)
	for _, e := range entries {
		h := archiveLE32(nil, uint32(len(e.content)))
		h = archiveLE32(h, uint32(len(e.content)))
		h = append(h, 3)
		h = archiveLE32(h, crc32.ChecksumIEEE([]byte(e.content)))
		h = archiveLE32(h, 0)
		h = append(h, 29, 0x30)
		h = archiveLE16(h, uint16(len(e.name)))
		h = archiveLE32(h, 0x81a4)
		h = append(h, e.name...)
		b = append(b, block(0x74, 0x8000, h)...)
		b = append(b, e.content...)
	}
	return append(b, block(0x7b, 0, nil)...)
}

func rar5FixtureBlock(kind, flags, dataSize uint64, body []byte) []byte {
	h := archiveVarint(nil, kind)
	h = archiveVarint(h, flags)
	if flags&2 != 0 {
		h = archiveVarint(h, dataSize)
	}
	h = append(h, body...)
	h = append(archiveVarint(nil, uint64(len(h))), h...)
	return append(archiveLE32(nil, crc32.ChecksumIEEE(h)), h...)
}

func makeRAR5Fixture(entries []archiveFixtureEntry, compression, unpackedSize uint64) []byte {
	b := append([]byte("Rar!\x1a\x07\x01\x00"), rar5FixtureBlock(1, 0, 0, []byte{0})...)
	for _, e := range entries {
		size := uint64(len(e.content))
		if unpackedSize != 0 {
			size = unpackedSize
		}
		h := archiveVarint(nil, 4) // payload CRC present
		h = archiveVarint(h, size)
		h = archiveVarint(h, 0x81a4)
		h = archiveLE32(h, crc32.ChecksumIEEE([]byte(e.content)))
		h = archiveVarint(h, compression)
		h = archiveVarint(h, 1) // Unix host
		h = archiveVarint(h, uint64(len(e.name)))
		h = append(h, e.name...)
		b = append(b, rar5FixtureBlock(2, 2, uint64(len(e.content)), h)...)
		b = append(b, e.content...)
	}
	return append(b, rar5FixtureBlock(5, 0, 0, []byte{0})...)
}

func makeZipFixture(t *testing.T, entries []archiveFixtureEntry) []byte {
	t.Helper()
	var b bytes.Buffer
	w := zip.NewWriter(&b)
	for _, e := range entries {
		f, err := w.Create(e.name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.Write([]byte(e.content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// A single stored 7z stream, with an unencoded UTF-16 filename header.
func make7zFixture(e archiveFixtureEntry) []byte {
	if len(e.content) >= 128 {
		panic("7z fixture content exceeds one-byte size")
	}
	h := []byte{1, 4, 6, 0, 1, 9, byte(len(e.content)), 0, 7, 11, 1, 0, 1, 1, 0, 12, byte(len(e.content)), 0, 8, 0, 0, 5, 1, 17}
	var name []byte
	for _, c := range utf16.Encode([]rune(e.name + "\x00")) {
		name = archiveLE16(name, c)
	}
	if len(name)+1 >= 128 {
		panic("7z fixture name exceeds one-byte size")
	}
	h = append(h, byte(len(name)+1), 0)
	h = append(h, name...)
	h = append(h, 0, 0)
	start := binary.LittleEndian.AppendUint64(nil, uint64(len(e.content)))
	start = binary.LittleEndian.AppendUint64(start, uint64(len(h)))
	start = archiveLE32(start, crc32.ChecksumIEEE(h))
	b := append([]byte{'7', 'z', 0xbc, 0xaf, 0x27, 0x1c, 0, 4}, archiveLE32(nil, crc32.ChecksumIEEE(start))...)
	b = append(b, start...)
	b = append(b, e.content...)
	return append(b, h...)
}

func newArchiveTestApp(t *testing.T) *App {
	t.Helper()
	pool, err := ants.NewPool(2)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Release)
	return &App{goroutinePool: pool}
}

func TestArchiveFormatsAndFlattenedPaths(t *testing.T) {
	entries := []archiveFixtureEntry{{"../../fixture.vpk", "VPK fixture"}, {"ignored.txt", "not a VPK"}}
	for _, format := range []string{"rar4", "rar5", "zip", "7z"} {
		t.Run(format, func(t *testing.T) {
			var data []byte
			ext := format
			switch format {
			case "rar4":
				data, ext = makeRAR4Fixture(entries), "rar"
			case "rar5":
				data, ext = makeRAR5Fixture(entries, 0, 0), "rar"
			case "zip":
				data = makeZipFixture(t, entries)
			case "7z":
				data = make7zFixture(entries[0])
			}
			dir := t.TempDir()
			archivePath, dest := filepath.Join(dir, "input."+ext), filepath.Join(dir, "out")
			if err := os.Mkdir(dest, 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(archivePath, data, 0600); err != nil {
				t.Fatal(err)
			}
			if err := newArchiveTestApp(t).ExtractVPKFromArchive(archivePath, dest); err != nil {
				t.Fatal(err)
			}
			got, err := os.ReadFile(filepath.Join(dest, "fixture.vpk"))
			if err != nil || string(got) != entries[0].content {
				t.Fatalf("content=%q error=%v", got, err)
			}
			files, err := os.ReadDir(dest)
			if err != nil || len(files) != 1 {
				t.Fatalf("files=%v error=%v", files, err)
			}
			if _, err := os.Stat(filepath.Join(dir, "fixture.vpk")); !os.IsNotExist(err) {
				t.Fatalf("escaped destination: %v", err)
			}
		})
	}
}

func TestArchiveRARSidecarsAndDictionaryLimit(t *testing.T) {
	entries := []archiveFixtureEntry{{"fixture.vpk", "vpk"}, {"fixture.meta", "metadata"}, {"unrelated.meta", "ignore"}}
	for _, version := range []int{4, 5} {
		t.Run(string(rune('0'+version)), func(t *testing.T) {
			data := makeRAR4Fixture(entries)
			if version == 5 {
				data = makeRAR5Fixture(entries, 0, 0)
			}
			dir, dest := t.TempDir(), t.TempDir()
			path := filepath.Join(dir, "input.rar")
			if err := os.WriteFile(path, data, 0600); err != nil {
				t.Fatal(err)
			}
			if err := newArchiveTestApp(t).ExtractVPKFromRar(path, dest); err != nil {
				t.Fatal(err)
			}
			got, err := os.ReadFile(filepath.Join(dest, "fixture.meta"))
			if err != nil || string(got) != "metadata" {
				t.Fatalf("sidecar=%q error=%v", got, err)
			}
			if _, err := os.Stat(filepath.Join(dest, "unrelated.meta")); !os.IsNotExist(err) {
				t.Fatalf("unexpected sidecar: %v", err)
			}
		})
	}
	// A compressed file declaring a 512 MiB dictionary must fail before any
	// allocation of that size. The payload is deliberately empty.
	data := makeRAR5Fixture([]archiveFixtureEntry{{"large.vpk", ""}}, 12<<10|1<<7, 512<<20)
	path := filepath.Join(t.TempDir(), "large.rar")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	if err := newArchiveTestApp(t).ExtractVPKFromRar(path, t.TempDir()); !errors.Is(err, rardecode.ErrDictionaryTooLarge) {
		t.Fatalf("expected dictionary rejection, got %v", err)
	}
}

func TestArchiveRejectsDamagedAndMissingVPK(t *testing.T) {
	for _, ext := range []string{"rar", "zip", "7z"} {
		t.Run(ext, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "broken."+ext)
			if err := os.WriteFile(path, []byte("truncated archive"), 0600); err != nil {
				t.Fatal(err)
			}
			if err := newArchiveTestApp(t).ExtractVPKFromArchive(path, t.TempDir()); err == nil {
				t.Fatal("accepted damaged archive")
			}
		})
	}
	for _, data := range [][]byte{makeRAR4Fixture([]archiveFixtureEntry{{"readme.txt", "text"}}), makeRAR5Fixture([]archiveFixtureEntry{{"readme.txt", "text"}}, 0, 0)} {
		path := filepath.Join(t.TempDir(), "empty.rar")
		if err := os.WriteFile(path, data, 0600); err != nil {
			t.Fatal(err)
		}
		if err := newArchiveTestApp(t).ExtractVPKFromRar(path, t.TempDir()); err == nil || !strings.Contains(err.Error(), "未找到VPK") {
			t.Fatalf("error=%v", err)
		}
	}
}

func TestArchiveOutputRejectsEscapingSymlink(t *testing.T) {
	dest, outside := t.TempDir(), filepath.Join(t.TempDir(), "outside.vpk")
	if err := os.WriteFile(outside, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(dest, "fixture.vpk")); err != nil {
		t.Skipf("host cannot create symlinks: %v", err)
	}
	if file, err := createArchiveFile(dest, "../../fixture.vpk"); err == nil {
		// Some filesystems replace the link itself. That is also safe as long
		// as neither truncation nor writing affects the target outside dest.
		if _, err := file.WriteString("extracted content"); err != nil {
			file.Close()
			t.Fatal(err)
		}
		if err := file.Close(); err != nil {
			t.Fatal(err)
		}
	}
	got, err := os.ReadFile(outside)
	if err != nil || string(got) != "keep" {
		t.Fatalf("outside file=%q error=%v", got, err)
	}
}

func TestArchiveImportProgressFormatsAndLimits(t *testing.T) {
	entries := []archiveFixtureEntry{{"../../fixture.vpk", "vpk fixture"}, {"fixture.meta", "metadata"}}
	badCRC := makeRAR5Fixture(entries, 0, 0)
	badCRC[bytes.Index(badCRC, []byte("vpk fixture"))] ^= 1
	for _, tc := range []struct {
		name, ext string
		data      []byte
		wantErr   bool
	}{
		{"rar4", "rar", makeRAR4Fixture(entries), false},
		{"rar5", "rar", makeRAR5Fixture(entries, 0, 0), false},
		{"solid", "rar", makeSolidRAR5Fixture(t), false},
		{"zip", "zip", makeZipFixture(t, entries), false},
		{"7z", "7z", make7zFixture(entries[0]), false},
		{"dictionary-limit", "rar", makeRAR5Fixture([]archiveFixtureEntry{{"large.vpk", ""}}, 12<<10|1<<7, 512<<20), true},
		{"bad-file-checksum", "rar", badCRC, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "input."+tc.ext)
			if err := os.WriteFile(path, tc.data, 0600); err != nil {
				t.Fatal(err)
			}
			dest := t.TempDir()
			var percent atomic.Int32
			err := newArchiveTestApp(t).extractVPKFromArchiveWithProgress(path, dest, func(p int, _ string, _ []string) { percent.Store(int32(p)) })
			if (err != nil) != tc.wantErr {
				t.Fatalf("error=%v", err)
			}
			if tc.name == "dictionary-limit" && !errors.Is(err, rardecode.ErrDictionaryTooLarge) {
				t.Fatalf("dictionary error=%v", err)
			}
			if tc.wantErr {
				return
			}
			if percent.Load() != 100 {
				t.Fatalf("final progress=%d", percent.Load())
			}
			if tc.name == "solid" {
				got, err := os.ReadFile(filepath.Join(dest, "test1.vpk"))
				if err != nil || len(got) != 4096 {
					t.Fatalf("solid content length=%d error=%v", len(got), err)
				}
				return
			}
			got, err := os.ReadFile(filepath.Join(dest, "fixture.vpk"))
			if err != nil || string(got) != "vpk fixture" {
				t.Fatalf("content=%q error=%v", got, err)
			}
		})
	}
}
