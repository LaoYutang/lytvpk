package minidump

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseMinimalDump(t *testing.T) {
	dump := newTestDump(t, 7)
	csdRVA := dump.addString("")
	moduleNameRVA := dump.addString(`C:\game\bin\client.dll`)
	threadNameRVA := dump.addString("main-thread")
	context := testX86Context(0x10000123)
	contextRVA := dump.addBlob(context)
	stackRVA := dump.addBlob([]byte{0xde, 0xad, 0xbe, 0xef, 0x90, 0x90})
	cv := testRSDSRecord(`c:\symbols\client.pdb`)
	cvRVA := dump.addBlob(cv)

	dump.setStream(0, streamSystemInfo, dump.addBlob(testSystemInfo(csdRVA)))
	dump.setStream(1, streamException, dump.addBlob(testExceptionStream(contextRVA, uint32(len(context)))))
	dump.setStream(2, streamThreadList, dump.addBlob(testThreadList(stackRVA, contextRVA, uint32(len(context)))))
	dump.setStream(3, streamModuleList, dump.addBlob(testModuleList(moduleNameRVA, cvRVA, uint32(len(cv)))))
	dump.setStream(4, streamMemoryList, dump.addBlob(testMemoryList(stackRVA)))
	dump.setStream(5, streamMiscInfo, dump.addBlob(testMiscInfo()))
	dump.setStream(6, streamThreadNames, dump.addBlob(testThreadNames(threadNameRVA)))

	report, err := ParseFile(dump.write())
	if err != nil {
		t.Fatalf("ParseFile() error = %v", err)
	}

	if report.Header.SignatureASCII != "MDMP" || report.Header.NumberOfStreams != 7 {
		t.Fatalf("unexpected header: %+v", report.Header)
	}
	if report.System == nil || report.System.ArchitectureName != "x86" || report.System.NumberOfProcessors != 4 {
		t.Fatalf("unexpected system info: %+v", report.System)
	}
	if report.Misc == nil || report.Misc.ProcessID != 550 {
		t.Fatalf("unexpected misc info: %+v", report.Misc)
	}
	if report.Exception == nil || report.Exception.Code != "0xC0000005" {
		t.Fatalf("unexpected exception: %+v", report.Exception)
	}
	if got := report.Exception.Context.Registers["EIP"]; got != "0x10000123" {
		t.Fatalf("unexpected EIP: %s", got)
	}
	if report.ExceptionModule == nil || report.ExceptionModule.Offset != "0x123" {
		t.Fatalf("unexpected exception module: %+v", report.ExceptionModule)
	}
	if len(report.Threads) != 1 || report.Threads[0].Name != "main-thread" {
		t.Fatalf("unexpected threads: %+v", report.Threads)
	}
	if len(report.Modules) != 1 || report.Modules[0].CodeView == nil || !strings.HasSuffix(report.Modules[0].CodeView.PDBPath, "client.pdb") {
		t.Fatalf("unexpected modules: %+v", report.Modules)
	}
	if len(report.MemoryRanges) != 1 || report.MemoryRanges[0].Preview.Bytes == 0 {
		t.Fatalf("unexpected memory ranges: %+v", report.MemoryRanges)
	}
}

func TestParseRejectsBadSignature(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bad.mdmp")
	data := make([]byte, 32)
	binary.LittleEndian.PutUint32(data[0:], 0x12345678)
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := ParseFile(path); err == nil {
		t.Fatal("expected bad signature error")
	}
}

func TestParseRejectsTruncatedDirectory(t *testing.T) {
	path := filepath.Join(t.TempDir(), "truncated.mdmp")
	data := make([]byte, 32)
	binary.LittleEndian.PutUint32(data[0:], minidumpSignature)
	binary.LittleEndian.PutUint32(data[8:], 1)
	binary.LittleEndian.PutUint32(data[12:], 64)
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := ParseFile(path); err == nil {
		t.Fatal("expected truncated directory error")
	}
}
