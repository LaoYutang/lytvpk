package app

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"vpk-manager/internal/network"

	"github.com/go-resty/resty/v2"
	"github.com/panjf2000/ants/v2"
)

func preserveAPILineForTest(t *testing.T) {
	t.Helper()
	previous := network.GlobalIPSelector.GetAPILine()
	t.Cleanup(func() { network.GlobalIPSelector.SetAPILine(previous) })
}

func TestAPILineDefaultsMigrationAndRestart(t *testing.T) {
	preserveAPILineForTest(t)
	app := newConfigTestApp(t)
	if app.GetAPILine() != "primary" {
		t.Fatal("zero-value App did not select the primary line")
	}
	writeConfigFixture(t, app.configPath, ConfigFile{MigrationVersion: 4, DefaultDirectory: "D:/Preserved", Theme: "dark"})
	app.loadConfig()
	var migrated ConfigFile
	data, err := os.ReadFile(app.configPath)
	if err != nil || json.Unmarshal(data, &migrated) != nil {
		t.Fatalf("read migrated configuration: %v", err)
	}
	if migrated.APILine != "primary" || migrated.MigrationVersion != 5 || migrated.DefaultDirectory != "D:/Preserved" || migrated.Theme != "dark" {
		t.Fatalf("unexpected migrated configuration: %+v", migrated)
	}
	if err := app.SetAPILine("backup"); err != nil {
		t.Fatal(err)
	}
	restarted := newConfigTestApp(t)
	restarted.configPath, restarted.configDir = app.configPath, app.configDir
	restarted.loadConfig()
	if restarted.GetAPILine() != "backup" || network.GlobalIPSelector.GetAPILine() != network.APILineBackup {
		t.Fatal("saved line was not restored to App and the existing IP selector")
	}
	writeConfigFixture(t, app.configPath, ConfigFile{MigrationVersion: 4, APILine: "unknown"})
	restarted.loadConfig()
	if restarted.GetAPILine() != "primary" || network.GlobalIPSelector.GetAPILine() != network.APILinePrimary {
		t.Fatal("invalid stored line did not use the primary line")
	}
}

func TestAPILinePersistsBeforePublishingAndRejectsInvalidValues(t *testing.T) {
	preserveAPILineForTest(t)
	app := newConfigTestApp(t)
	if err := app.SetAPILine("primary"); err != nil {
		t.Fatal(err)
	}
	old := app.captureAPIOperation()
	before, err := os.ReadFile(app.configPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range []string{"auto", "https://example.invalid", "primary,backup"} {
		if err := app.SetAPILine(value); err == nil {
			t.Fatalf("accepted invalid line %q", value)
		}
	}
	originalPath := app.configPath
	app.configPath = filepath.Join(app.configDir, "blocked")
	if err := os.Mkdir(app.configPath, 0755); err != nil {
		t.Fatal(err)
	}
	if err := app.SetAPILine("backup"); err == nil {
		t.Fatal("expected configuration write failure")
	}
	current := app.captureAPIOperation()
	if current.line != old.line || current.generation != old.generation || current.clients != old.clients || network.GlobalIPSelector.GetAPILine() != network.APILinePrimary {
		t.Fatal("failed save changed the active API operation")
	}
	unchanged, err := os.ReadFile(originalPath)
	if err != nil || string(unchanged) != string(before) {
		t.Fatalf("failed save changed existing configuration: %v", err)
	}
	files, err := filepath.Glob(filepath.Join(app.configDir, ".config-*.tmp"))
	if err != nil || len(files) != 0 {
		t.Fatalf("temporary files leaked: %v %v", files, err)
	}
}

func TestAPILineSnapshotRetainsClientsAndNetworkPolicies(t *testing.T) {
	preserveAPILineForTest(t)
	app := newConfigTestApp(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	app.ctx = ctx
	base := &http.Client{Timeout: 2 * time.Second, Transport: &http.Transport{Proxy: nil}}
	app.restyClient = resty.NewWithClient(base)
	primary := app.captureAPIOperation()
	if primary.line != network.APILinePrimary || primary.ctx != ctx || primary.endpoints.WorkshopBaseURL != WorkshopWorkerURL || primary.clients.parser.Timeout != 30*time.Second || primary.clients.browser.GetClient().Timeout != 30*time.Second || primary.mapClient.Timeout != 2*time.Second {
		t.Fatalf("unexpected primary snapshot: %+v", primary)
	}
	if primary.clients.browser.RetryCount != 0 || primary.clients.transport.Proxy != nil || primary.clients.parser.Transport != primary.clients.transport || primary.clients.browser.GetClient().Transport != primary.clients.transport {
		t.Fatal("workshop clients changed their direct/shared-transport policy")
	}
	for _, client := range []*http.Client{primary.mapClient, primary.clients.parser, primary.clients.browser.GetClient()} {
		if client.CheckRedirect == nil || client.CheckRedirect(nil, nil) != http.ErrUseLastResponse {
			t.Fatal("API client permits redirects")
		}
	}
	if err := app.SetAPILine("backup"); err != nil {
		t.Fatal(err)
	}
	backup := app.captureAPIOperation()
	if backup.line != network.APILineBackup || backup.generation != primary.generation+1 || backup.clients == primary.clients || backup.cachePrefix() == primary.cachePrefix() {
		t.Fatal("line switch did not create an isolated operation generation")
	}
	if backup.clients.parser.Timeout != 12*time.Second || backup.clients.browser.GetClient().Timeout != 12*time.Second || backup.mapClient.Timeout != 12*time.Second {
		t.Fatal("backup clients do not allow the relay response budget")
	}
	if primary.line != network.APILinePrimary || primary.clients.parser.Timeout != 30*time.Second || primary.mapClient.Timeout != 2*time.Second || base.Timeout != 2*time.Second || base.CheckRedirect != nil || backup.mapClient.Transport != base.Transport {
		t.Fatal("line switch mutated an existing operation or shared map client")
	}
	if err := app.SetAPILine("backup"); err != nil {
		t.Fatal(err)
	}
	if again := app.captureAPIOperation(); again.generation != backup.generation || again.clients != backup.clients {
		t.Fatal("saving the same line invalidated active operations")
	}
	if err := app.SetWorkshopDNSConfig(WorkshopDNSConfig{Mode: "system"}); err != nil {
		t.Fatal(err)
	}
	if dnsChanged := app.captureAPIOperation(); dnsChanged.clients == backup.clients || dnsChanged.clients.parser.Timeout != 12*time.Second || dnsChanged.generation != backup.generation || dnsChanged.line != backup.line {
		t.Fatal("DNS replacement changed line, timeout or API cache generation")
	}
}

func TestAPILineSwitchDoesNotCancelInflightOperationOrFollowRedirect(t *testing.T) {
	preserveAPILineForTest(t)
	app := newConfigTestApp(t)
	started, release := make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-release
		_, _ = io.WriteString(w, "old operation completed")
	}))
	defer server.Close()
	defer releaseOnce.Do(func() { close(release) })
	old := app.captureAPIOperation()
	pool, err := ants.NewPool(1)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Release()
	finished := make(chan error, 1)
	if err := pool.Submit(func() {
		response, err := old.clients.parser.Get(server.URL)
		if err == nil {
			defer response.Body.Close()
			_, err = io.ReadAll(response.Body)
		}
		finished <- err
	}); err != nil {
		t.Fatal(err)
	}
	<-started
	if err := app.SetAPILine("backup"); err != nil {
		t.Fatal(err)
	}
	releaseOnce.Do(func() { close(release) })
	if err := <-finished; err != nil {
		t.Fatalf("inflight request was canceled by the setting change: %v", err)
	}
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "https://example.invalid/never-requested", http.StatusFound)
	}))
	defer redirect.Close()
	response, err := app.captureAPIOperation().clients.parser.Get(redirect.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusFound {
		t.Fatalf("redirect was followed: %d", response.StatusCode)
	}
}

func TestAPILineConcurrentAndStaleConfigSavesRetainActiveLine(t *testing.T) {
	preserveAPILineForTest(t)
	app := newConfigTestApp(t)
	stale := app.GetAppConfig()
	if err := app.SetAPILine("backup"); err != nil {
		t.Fatal(err)
	}
	if err := app.SaveAppConfig(stale); err != nil {
		t.Fatal(err)
	}
	if app.GetAPILine() != "backup" {
		t.Fatal("stale ordinary save replaced the active line")
	}
	pool, err := ants.NewPool(4)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Release()
	var wg sync.WaitGroup
	failures := make(chan error, 24)
	for i := 0; i < 12; i++ {
		i := i
		wg.Add(1)
		if err := pool.Submit(func() {
			defer wg.Done()
			stale := app.GetAppConfig()
			line := "primary"
			if i%2 != 0 {
				line = "backup"
			}
			if err := app.SetAPILine(line); err != nil {
				failures <- err
			}
			app.captureAPIOperation()
			if err := app.SaveAppConfig(stale); err != nil {
				failures <- err
			}
		}); err != nil {
			wg.Done()
			t.Fatal(err)
		}
	}
	wg.Wait()
	close(failures)
	for err := range failures {
		t.Error(err)
	}
	var stored ConfigFile
	data, err := os.ReadFile(app.configPath)
	if err != nil || json.Unmarshal(data, &stored) != nil {
		t.Fatalf("read saved configuration: %v", err)
	}
	if stored.APILine != app.GetAPILine() || stored.APILine != string(network.GlobalIPSelector.GetAPILine()) || !strings.Contains(string(data), `"apiLine"`) {
		t.Fatal("saved, App and IP selector lines disagree")
	}
	if status := app.GetAPILineStatus(); status.Line != stored.APILine {
		t.Fatal("displayed line status disagrees with the persisted preference")
	}
}

func TestAPILineStatusAndCandidateReadRespectAppCancellation(t *testing.T) {
	preserveAPILineForTest(t)
	app := newConfigTestApp(t)
	if err := app.SetAPILine("backup"); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	app.ctx = ctx
	started := time.Now()
	if options := app.GetWorkshopIPOptions(); len(options) != 0 {
		t.Fatalf("canceled App returned newly loaded candidates: %v", options)
	}
	if time.Since(started) > time.Second {
		t.Fatal("candidate read ignored the canceled App context")
	}
	status := app.GetAPILineStatus()
	if status.Line != "backup" || status.IPPoolFallback {
		t.Fatalf("cancellation changed the selected line or reported a fallback: %+v", status)
	}
	encoded, err := json.Marshal(status)
	if err != nil {
		t.Fatal(err)
	}
	var public map[string]any
	if err := json.Unmarshal(encoded, &public); err != nil {
		t.Fatal(err)
	}
	if len(public) != 2 || public["line"] != "backup" || public["ipPoolFallback"] != false {
		t.Fatalf("unexpected public API line status: %s", encoded)
	}
	for _, private := range []string{"https://", "laoyutang", "error", "address", "endpoint"} {
		if strings.Contains(string(encoded), private) {
			t.Fatalf("public status disclosed private request metadata: %s", encoded)
		}
	}
}
