package minidump

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
	"unicode/utf16"
)

func TestParseStreamOutOfRangeWarning(t *testing.T) {
	dump := newTestDump(t, 1)
	dump.setStream(0, streamSystemInfo, 0x7fffff00, 128)
	report, err := ParseFile(dump.write())
	if err != nil {
		t.Fatalf("ParseFile() error = %v", err)
	}
	if len(report.ParseWarnings) == 0 {
		t.Fatal("expected parse warning for out-of-range stream")
	}
}

func TestParseUnknownStream(t *testing.T) {
	dump := newTestDump(t, 1)
	dump.setStream(0, 999, dump.addBlob([]byte{1, 2, 3, 4}))
	report, err := ParseFile(dump.write())
	if err != nil {
		t.Fatalf("ParseFile() error = %v", err)
	}
	if len(report.Streams) != 1 || report.Streams[0].Name != "UnknownStream(999)" {
		t.Fatalf("unexpected stream info: %+v", report.Streams)
	}
}

type testDump struct {
	t       *testing.T
	dir     []testDirectory
	data    []byte
	tempDir string
}

type testDirectory struct {
	typ  uint32
	size uint32
	rva  uint32
}

func newTestDump(t *testing.T, streamCount int) *testDump {
	t.Helper()
	data := make([]byte, 32+streamCount*12)
	binary.LittleEndian.PutUint32(data[0:], minidumpSignature)
	binary.LittleEndian.PutUint32(data[4:], 0x0000a793)
	binary.LittleEndian.PutUint32(data[8:], uint32(streamCount))
	binary.LittleEndian.PutUint32(data[12:], 32)
	binary.LittleEndian.PutUint32(data[20:], 1775310644)
	binary.LittleEndian.PutUint64(data[24:], 0x41)
	return &testDump{
		t:       t,
		dir:     make([]testDirectory, streamCount),
		data:    data,
		tempDir: t.TempDir(),
	}
}

func (d *testDump) addBlob(blob []byte) uint32 {
	rva := uint32(len(d.data))
	d.data = append(d.data, blob...)
	return rva
}

func (d *testDump) addString(value string) uint32 {
	encoded := utf16.Encode([]rune(value))
	bytes := make([]byte, 4+len(encoded)*2)
	binary.LittleEndian.PutUint32(bytes[0:], uint32(len(encoded)*2))
	for i, word := range encoded {
		binary.LittleEndian.PutUint16(bytes[4+i*2:], word)
	}
	return d.addBlob(bytes)
}

func (d *testDump) setStream(index int, typ uint32, rva uint32, sizes ...uint32) {
	d.t.Helper()
	if index < 0 || index >= len(d.dir) {
		d.t.Fatalf("stream index out of range: %d", index)
	}
	size := uint32(len(d.data)) - rva
	if len(sizes) > 0 {
		size = sizes[0]
	}
	d.dir[index] = testDirectory{typ: typ, size: size, rva: rva}
}

func (d *testDump) write() string {
	d.t.Helper()
	for i, item := range d.dir {
		off := 32 + i*12
		binary.LittleEndian.PutUint32(d.data[off:], item.typ)
		binary.LittleEndian.PutUint32(d.data[off+4:], item.size)
		binary.LittleEndian.PutUint32(d.data[off+8:], item.rva)
	}
	path := filepath.Join(d.tempDir, "sample.mdmp")
	if err := os.WriteFile(path, d.data, 0644); err != nil {
		d.t.Fatal(err)
	}
	return path
}
