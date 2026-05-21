package app

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPanelMapUploadValidationAndActiveState(t *testing.T) {
	withIsolatedPanelUploadTasks(t)

	dir := t.TempDir()
	validPath := filepath.Join(dir, "campaign.vpk")
	file, err := os.Create(validPath)
	if err != nil {
		t.Fatalf("create upload fixture: %v", err)
	}
	if err := file.Truncate(panelMapUploadChunkSize + 1); err != nil {
		t.Fatalf("size upload fixture: %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("close upload fixture: %v", err)
	}

	task := newPanelMapUploadTask("srv", "Panel", validPath)
	if err := validatePanelMapUploadTask(task); err != nil {
		t.Fatalf("validate vpk: %v", err)
	}
	if task.TotalChunks != 2 {
		t.Fatalf("expected 2 chunks, got %d", task.TotalChunks)
	}

	invalid := newPanelMapUploadTask("srv", "Panel", filepath.Join(dir, "notes.txt"))
	if err := os.WriteFile(invalid.FilePath, []byte("bad"), 0644); err != nil {
		t.Fatalf("write invalid fixture: %v", err)
	}
	if err := validatePanelMapUploadTask(invalid); err == nil || !strings.Contains(err.Error(), "错误的文件类型") {
		t.Fatalf("expected file type error, got %v", err)
	}

	app := &App{}
	panelUploads.mu.Lock()
	panelUploads.tasks["pending"] = &PanelMapUploadTask{ID: "pending", Status: "pending"}
	panelUploads.tasks["done"] = &PanelMapUploadTask{ID: "done", Status: "completed"}
	panelUploads.mu.Unlock()

	if !app.HasActivePanelUploads() {
		t.Fatalf("expected active upload task")
	}

	panelUploads.mu.Lock()
	panelUploads.tasks["pending"].Status = "cancelled"
	panelUploads.mu.Unlock()
	if app.HasActivePanelUploads() {
		t.Fatalf("did not expect active upload task")
	}

	for _, status := range []string{"completed", "failed", "cancelled"} {
		if !isClearablePanelUploadStatus(status) {
			t.Fatalf("expected %q upload task to be clearable", status)
		}
	}
	for _, status := range []string{"pending", "uploading", "merging"} {
		if isClearablePanelUploadStatus(status) {
			t.Fatalf("did not expect %q upload task to be clearable", status)
		}
	}
}

func TestPanelMapUploadProtocolRequests(t *testing.T) {
	var seen []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("unexpected method: %s", r.Method)
		}
		if r.Header.Get("Authorization") != "Bearer panel-secret" {
			t.Fatalf("unexpected authorization header: %q", r.Header.Get("Authorization"))
		}

		seen = append(seen, r.URL.Path)
		switch r.URL.Path {
		case "/panel/upload/init":
			if got := r.FormValue("filename"); got != "campaign.vpk" {
				t.Fatalf("unexpected init filename: %q", got)
			}
			if got := r.FormValue("fileSize"); got != "6" {
				t.Fatalf("unexpected init file size: %q", got)
			}
			if got := r.FormValue("totalChunks"); got != "2" {
				t.Fatalf("unexpected init chunks: %q", got)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"uploadId":"upload-1"}`))

		case "/panel/upload/chunk":
			if err := r.ParseMultipartForm(panelMapUploadChunkSize + 1024); err != nil {
				t.Fatalf("parse multipart: %v", err)
			}
			if got := r.FormValue("uploadId"); got != "upload-1" {
				t.Fatalf("unexpected chunk upload id: %q", got)
			}
			if got := r.FormValue("chunkIndex"); got != "1" {
				t.Fatalf("unexpected chunk index: %q", got)
			}
			chunk, header, err := r.FormFile("chunk")
			if err != nil {
				t.Fatalf("read chunk form file: %v", err)
			}
			defer chunk.Close()
			if header.Filename != "campaign.vpk.part" {
				t.Fatalf("unexpected chunk filename: %q", header.Filename)
			}
			body, err := io.ReadAll(chunk)
			if err != nil {
				t.Fatalf("read chunk body: %v", err)
			}
			if string(body) != "chunk-body" {
				t.Fatalf("unexpected chunk body: %q", body)
			}
			_, _ = w.Write([]byte(`{"success":true}`))

		case "/panel/upload/status":
			if got := r.FormValue("uploadId"); got != "upload-1" {
				t.Fatalf("unexpected status upload id: %q", got)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"uploadedChunks":[0,1]}`))

		case "/panel/upload/merge":
			if got := r.FormValue("uploadId"); got != "upload-1" {
				t.Fatalf("unexpected merge upload id: %q", got)
			}
			if got := r.FormValue("filename"); got != "campaign.vpk" {
				t.Fatalf("unexpected merge filename: %q", got)
			}
			_, _ = w.Write([]byte(`{"success":true}`))

		case "/panel/upload/cancel":
			if got := r.FormValue("uploadId"); got != "upload-1" {
				t.Fatalf("unexpected cancel upload id: %q", got)
			}
			_, _ = w.Write([]byte(`{"success":true}`))

		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	app := &App{}
	credentials := &panelCredentials{
		baseURL:  server.URL + "/panel",
		password: "panel-secret",
	}

	var initResult struct {
		UploadID string `json:"uploadId"`
	}
	if _, err := app.panelPostForm(context.Background(), credentials, "/upload/init", map[string]string{
		"filename":    "campaign.vpk",
		"fileSize":    "6",
		"totalChunks": "2",
	}, &initResult); err != nil {
		t.Fatalf("init upload: %v", err)
	}
	if initResult.UploadID != "upload-1" {
		t.Fatalf("unexpected upload id: %q", initResult.UploadID)
	}

	if _, err := app.panelPostMultipartFile(context.Background(), credentials, "/upload/chunk", map[string]string{
		"uploadId":   "upload-1",
		"chunkIndex": "1",
	}, "chunk", "campaign.vpk.part", strings.NewReader("chunk-body"), nil); err != nil {
		t.Fatalf("upload chunk: %v", err)
	}

	var statusResult struct {
		UploadedChunks []int `json:"uploadedChunks"`
	}
	if _, err := app.panelPostForm(context.Background(), credentials, "/upload/status", map[string]string{
		"uploadId": "upload-1",
	}, &statusResult); err != nil {
		t.Fatalf("status upload: %v", err)
	}
	if len(statusResult.UploadedChunks) != 2 || statusResult.UploadedChunks[0] != 0 || statusResult.UploadedChunks[1] != 1 {
		t.Fatalf("unexpected uploaded chunks: %#v", statusResult.UploadedChunks)
	}

	if _, err := app.panelPostForm(context.Background(), credentials, "/upload/merge", map[string]string{
		"uploadId": "upload-1",
		"filename": "campaign.vpk",
	}, nil); err != nil {
		t.Fatalf("merge upload: %v", err)
	}
	if _, err := app.panelPostForm(context.Background(), credentials, "/upload/cancel", map[string]string{
		"uploadId": "upload-1",
	}, nil); err != nil {
		t.Fatalf("cancel upload: %v", err)
	}

	expected := []string{
		"/panel/upload/init",
		"/panel/upload/chunk",
		"/panel/upload/status",
		"/panel/upload/merge",
		"/panel/upload/cancel",
	}
	if strings.Join(seen, ",") != strings.Join(expected, ",") {
		t.Fatalf("unexpected request paths: %#v", seen)
	}
}

func withIsolatedPanelUploadTasks(t *testing.T) {
	t.Helper()

	panelUploads.mu.Lock()
	previous := panelUploads.tasks
	panelUploads.tasks = make(map[string]*PanelMapUploadTask)
	panelUploads.mu.Unlock()

	t.Cleanup(func() {
		panelUploads.mu.Lock()
		panelUploads.tasks = previous
		panelUploads.mu.Unlock()
	})
}
