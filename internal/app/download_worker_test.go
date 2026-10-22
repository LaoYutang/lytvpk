package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
)

type blockEOFReader struct {
	data []byte
	err  error
}

func (r *blockEOFReader) Read(p []byte) (int, error) {
	n := copy(p, r.data)
	r.data = r.data[n:]
	if len(r.data) == 0 {
		return n, r.err
	}
	return n, nil
}

func TestDownloadBlockRangeAndEOF(t *testing.T) {
	for _, test := range []struct {
		name, data string
		readErr    error
		status     int
		wantErr    bool
	}{
		{"data-with-EOF", "ABCD", io.EOF, http.StatusPartialContent, false},
		{"unexpected-EOF", "AB", io.ErrUnexpectedEOF, http.StatusPartialContent, true},
		{"short-EOF", "AB", io.EOF, http.StatusPartialContent, true},
		{"oversized-body", "ABCDEFGH", io.EOF, http.StatusPartialContent, true},
		{"range-not-supported", "ABCD", io.EOF, http.StatusOK, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "download.part")
			if err := os.WriteFile(path, []byte("0123456789"), 0600); err != nil {
				t.Fatal(err)
			}
			file, err := os.OpenFile(path, os.O_RDWR, 0600)
			if err != nil {
				t.Fatal(err)
			}
			defer file.Close()
			client := &http.Client{Transport: workshopRoundTripFunc(func(r *http.Request) (*http.Response, error) {
				if r.Header.Get("Range") != "bytes=2-5" {
					t.Fatalf("range=%q", r.Header.Get("Range"))
				}
				return &http.Response{StatusCode: test.status, Header: make(http.Header), Body: io.NopCloser(&blockEOFReader{[]byte(test.data), test.readErr}), Request: r}, nil
			})}
			bm := NewBlockManager(10, 1, 4)
			defer bm.cancel()
			err = (&App{}).downloadBlock(context.Background(), &Block{StartByte: 2, EndByte: 5}, file, client, "http://download.invalid/fixture", bm)
			if (err != nil) != test.wantErr {
				t.Fatalf("error=%v", err)
			}
			if test.status == http.StatusOK && !errors.Is(err, errRangeNotSupported) {
				t.Fatalf("fallback error=%v", err)
			}
			got, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if len(got) != 10 || string(got[:2]) != "01" || string(got[6:]) != "6789" {
				t.Fatalf("wrote outside requested block: %q", got)
			}
			wantProgress := int64(4)
			if test.wantErr {
				wantProgress = 0
			} else if string(got) != "01ABCD6789" {
				t.Fatalf("download=%q", got)
			}
			if downloaded, _, _ := bm.Progress(); downloaded != wantProgress {
				t.Fatalf("progress=%d want=%d", downloaded, wantProgress)
			}
		})
	}
}

func TestDownloadWorkerRetriesPartialBlock(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Range") != "bytes=0-3" {
			t.Errorf("range=%q", r.Header.Get("Range"))
		}
		w.Header().Set("Content-Length", "4")
		w.Header().Set("Content-Range", "bytes 0-3/4")
		w.WriteHeader(http.StatusPartialContent)
		if calls.Add(1) == 1 {
			fmt.Fprint(w, "ab")
		} else {
			fmt.Fprint(w, "data")
		}
	}))
	defer server.Close()
	path := filepath.Join(t.TempDir(), "download.part")
	file, err := createPreallocatedFile(path, 4)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	bm := NewBlockManager(4, 1, 4)
	defer bm.cancel()
	(&App{}).downloadWorker(0, bm, file, server.URL, "")
	if calls.Load() != 2 || bm.blocks[0].Status() != blockStatusCompleted || bm.HasFatalError() != nil {
		t.Fatalf("calls=%d status=%d error=%v", calls.Load(), bm.blocks[0].Status(), bm.HasFatalError())
	}
	got, err := os.ReadFile(path)
	if err != nil || string(got) != "data" {
		t.Fatalf("download=%q error=%v", got, err)
	}
	if downloaded, total, percent := bm.Progress(); downloaded != 4 || total != 4 || percent != 100 {
		t.Fatalf("progress=%d/%d (%d%%)", downloaded, total, percent)
	}
}

func TestDownloadBlockCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	file, err := os.Create(filepath.Join(t.TempDir(), "download.part"))
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	bm := NewBlockManager(4, 1, 4)
	defer bm.cancel()
	client := &http.Client{Transport: workshopRoundTripFunc(func(r *http.Request) (*http.Response, error) { return nil, r.Context().Err() })}
	err = (&App{}).downloadBlock(ctx, &Block{StartByte: 0, EndByte: 3}, file, client, "http://download.invalid/fixture", bm)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("error=%v", err)
	}
	if info, err := file.Stat(); err != nil || info.Size() != 0 {
		t.Fatalf("file=%v error=%v", info, err)
	}
}
