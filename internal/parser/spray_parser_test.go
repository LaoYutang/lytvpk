package parser

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"hash/crc32"
	"image/png"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"l4d2-manager-next/pkg/valve/vpk"
)

func TestIsSprayVPKArchiveDetectsLogoMaterial(t *testing.T) {
	archive := &vpk.Archive{
		Files: []vpk.File{
			{Dir: "materials/vgui/logos", Base: "sample", Ext: "vtf"},
			{Dir: "materials/vgui/logos", Base: "sample", Ext: "vmt"},
		},
	}

	if !isSprayVPKArchive(archive) {
		t.Fatalf("expected spray archive")
	}
}

func TestDecodeVTFPreviewToDataURL(t *testing.T) {
	vtf := makeRGBA8888VTF(2, 2, []byte{
		255, 0, 0, 255,
		0, 255, 0, 255,
		0, 0, 255, 255,
		255, 255, 255, 128,
	})

	dataURL := decodeVTFPreviewToDataURL(vtf)
	if !strings.HasPrefix(dataURL, "data:image/png;base64,") {
		t.Fatalf("expected png data url, got %q", dataURL)
	}

	pngBytes, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(dataURL, "data:image/png;base64,"))
	if err != nil {
		t.Fatalf("decode png base64: %v", err)
	}
	img, err := png.Decode(bytes.NewReader(pngBytes))
	if err != nil {
		t.Fatalf("decode png: %v", err)
	}
	bounds := img.Bounds()
	if bounds.Dx() != 2 || bounds.Dy() != 2 {
		t.Fatalf("expected 2x2 preview, got %dx%d", bounds.Dx(), bounds.Dy())
	}

	r, g, b, a := img.At(0, 0).RGBA()
	if uint8(r>>8) != 255 || uint8(g>>8) != 0 || uint8(b>>8) != 0 || uint8(a>>8) != 255 {
		t.Fatalf("expected red first pixel")
	}
}

func TestParseVPKFileDetectsSprayAndPreview(t *testing.T) {
	vtf := makeRGBA8888VTF(1, 1, []byte{32, 64, 128, 255})
	vpkPath := writeTestVPK(t, map[string][]byte{
		"materials/vgui/logos/test_spray.vmt": []byte(`"UnlitGeneric"{}`),
		"materials/vgui/logos/test_spray.vtf": vtf,
	})

	parsed, err := ParseVPKFile(vpkPath)
	if err != nil {
		t.Fatalf("parse vpk: %v", err)
	}
	if parsed.PrimaryTag != "其他" {
		t.Fatalf("expected primary tag 其他, got %q", parsed.PrimaryTag)
	}
	if !containsString(parsed.SecondaryTags, "喷涂") {
		t.Fatalf("expected secondary tag 喷涂, got %#v", parsed.SecondaryTags)
	}
	if !strings.HasPrefix(parsed.PreviewImage, "data:image/png;base64,") {
		t.Fatalf("expected static spray preview, got %q", parsed.PreviewImage)
	}
}

func makeRGBA8888VTF(width, height int, pixels []byte) []byte {
	data := make([]byte, 64+len(pixels))
	copy(data[:4], []byte{'V', 'T', 'F', 0})
	binary.LittleEndian.PutUint32(data[4:8], 7)
	binary.LittleEndian.PutUint32(data[8:12], 1)
	binary.LittleEndian.PutUint32(data[12:16], 64)
	binary.LittleEndian.PutUint16(data[16:18], uint16(width))
	binary.LittleEndian.PutUint16(data[18:20], uint16(height))
	binary.LittleEndian.PutUint16(data[24:26], 1)
	binary.LittleEndian.PutUint32(data[52:56], vtfFormatRGBA8888)
	data[56] = 1
	copy(data[64:], pixels)
	return data
}

type testVPKEntry struct {
	fullPath string
	dir      string
	base     string
	ext      string
	data     []byte
}

func writeTestVPK(t *testing.T, files map[string][]byte) string {
	t.Helper()

	entries := make([]testVPKEntry, 0, len(files))
	for fullPath, data := range files {
		dir, base, ext := splitTestVPKPath(fullPath)
		entries = append(entries, testVPKEntry{
			fullPath: fullPath,
			dir:      dir,
			base:     base,
			ext:      ext,
			data:     data,
		})
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].ext != entries[j].ext {
			return entries[i].ext < entries[j].ext
		}
		if entries[i].dir != entries[j].dir {
			return entries[i].dir < entries[j].dir
		}
		return entries[i].base < entries[j].base
	})

	archive := &vpk.Archive{
		Header: vpk.Header{
			Magic:   vpk.Magic,
			Version: 1,
		},
		Files: make([]vpk.File, 0, len(entries)),
	}

	var offset uint32
	for _, entry := range entries {
		archive.Files = append(archive.Files, vpk.File{
			Dir:  entry.dir,
			Base: entry.base,
			Ext:  entry.ext,
			DirEntry: vpk.DirEntry{
				CRC: crc32.ChecksumIEEE(entry.data),
				DataLocation: []vpk.DataChunk{{
					ArchiveIndex: 0x7fff,
					EntryOffset:  offset,
					EntryLength:  uint32(len(entry.data)),
				}},
			},
		})
		offset += uint32(len(entry.data))
	}

	var out bytes.Buffer
	if err := vpk.WriteDirectory(&out, archive); err != nil {
		t.Fatalf("write vpk directory: %v", err)
	}
	for _, entry := range entries {
		out.Write(entry.data)
	}

	vpkPath := filepath.Join(t.TempDir(), "test_spray.vpk")
	if err := os.WriteFile(vpkPath, out.Bytes(), 0644); err != nil {
		t.Fatalf("write test vpk: %v", err)
	}
	return vpkPath
}

func splitTestVPKPath(fullPath string) (dir, base, ext string) {
	fullPath = strings.ReplaceAll(fullPath, "\\", "/")
	ext = strings.TrimPrefix(path.Ext(fullPath), ".")
	base = strings.TrimSuffix(path.Base(fullPath), path.Ext(fullPath))
	dir = path.Dir(fullPath)
	if dir == "." || dir == "" {
		dir = " "
	}
	if ext == "" {
		ext = " "
	}
	if base == "" {
		base = " "
	}
	return dir, base, ext
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
