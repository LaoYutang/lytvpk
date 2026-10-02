package app

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/panjf2000/ants/v2"
)

func TestWorkshopDNSConfigDefaultsAndModes(t *testing.T) {
	app := newConfigTestApp(t)
	if config := app.GetWorkshopDNSConfig(); config.Mode != "dnspod" || config.server() != "119.29.29.29" {
		t.Fatalf("unexpected default: %+v", config)
	}
	for _, test := range []struct{ mode, address, server string }{
		{"dnspod", "", "119.29.29.29"},
		{"alidns", "", "223.5.5.5"},
		{"custom", " 192.168.1.1 ", "192.168.1.1"},
		{"custom", "2001:DB8::53", "2001:db8::53"},
		{"custom", "::ffff:223.5.5.5", "223.5.5.5"},
		{"system", "2001:db8::53", ""},
	} {
		if err := app.SetWorkshopDNSConfig(WorkshopDNSConfig{Mode: test.mode, CustomAddress: test.address}); err != nil {
			t.Fatal(err)
		}
		if got := app.GetWorkshopDNSConfig(); got.server() != test.server {
			t.Fatalf("config=%+v server=%q", got, got.server())
		}
		restarted := newConfigTestApp(t)
		restarted.configPath, restarted.configDir = app.configPath, app.configDir
		restarted.loadConfig()
		if got := restarted.GetWorkshopDNSConfig(); got != app.GetWorkshopDNSConfig() {
			t.Fatalf("config did not survive restart: %+v", got)
		}
	}
}

func TestWorkshopDNSConfigRejectsInvalidInput(t *testing.T) {
	app := newConfigTestApp(t)
	if err := app.SetWorkshopDNSConfig(WorkshopDNSConfig{Mode: "alidns"}); err != nil {
		t.Fatal(err)
	}
	previous := app.getWorkshopNetworkClients()
	for _, address := range []string{"", "dns.example", "https://119.29.29.29", "119.29.29.29:53", "1.1.1.1,8.8.8.8", "999.1.1.1", "01.1.1.1", "0.0.0.0", "::", "ff02::1", "fe80::1%eth0", "::ffff:0.0.0.0", "::ffff:224.0.0.1"} {
		if err := app.SetWorkshopDNSConfig(WorkshopDNSConfig{Mode: "custom", CustomAddress: address}); err == nil {
			t.Fatalf("accepted %q", address)
		}
	}
	if err := app.SetWorkshopDNSConfig(WorkshopDNSConfig{Mode: "unknown"}); err == nil {
		t.Fatal("accepted an unknown DNS mode")
	}
	if app.GetWorkshopDNSConfig().Mode != "alidns" || app.getWorkshopNetworkClients() != previous {
		t.Fatal("invalid input changed the active setting")
	}
}

func TestWorkshopDNSConfigFailedSaveKeepsActiveSetting(t *testing.T) {
	app := newConfigTestApp(t)
	if err := app.SetWorkshopDNSConfig(WorkshopDNSConfig{Mode: "alidns"}); err != nil {
		t.Fatal(err)
	}
	previous := app.getWorkshopNetworkClients()
	originalPath := app.configPath
	original, err := os.ReadFile(originalPath)
	if err != nil {
		t.Fatal(err)
	}
	app.configPath = filepath.Join(app.configDir, "blocked")
	if err := os.Mkdir(app.configPath, 0755); err != nil {
		t.Fatal(err)
	}
	if err := app.SetWorkshopDNSConfig(WorkshopDNSConfig{Mode: "system"}); err == nil {
		t.Fatal("expected persistence failure")
	}
	if app.GetWorkshopDNSConfig().Mode != "alidns" || app.getWorkshopNetworkClients() != previous {
		t.Fatal("failed save changed the active setting")
	}
	unchanged, err := os.ReadFile(originalPath)
	if err != nil || string(unchanged) != string(original) {
		t.Fatalf("original config changed: %v", err)
	}
	files, err := filepath.Glob(filepath.Join(app.configDir, ".config-*.tmp"))
	if err != nil || len(files) != 0 {
		t.Fatalf("temporary config files leaked: %v %v", files, err)
	}
}

func TestWorkshopDNSConfigVersionTwoUpgradeDoesNotRepeatLegacyMigration(t *testing.T) {
	app := newConfigTestApp(t)
	writeConfigFixture(t, app.configPath, ConfigFile{
		MigrationVersion: 2, DefaultDirectory: "D:/Current", Theme: "dark",
		SnapshotDirectory: "D:/Snapshots", DisplayMode: "card",
	})
	app.loadConfig()
	config := app.GetAppConfig()
	if config.MigrationVersion != configMigrationVersion || config.WorkshopDNS == nil || config.WorkshopDNS.Mode != "dnspod" || config.Theme != "dark" || config.SnapshotDirectory != "D:/Snapshots" || config.DefaultDirectory != "D:/Current" {
		t.Fatalf("unexpected upgraded config: %+v", config)
	}
	var stored ConfigFile
	data, err := os.ReadFile(app.configPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &stored); err != nil {
		t.Fatal(err)
	}
	if stored.MigrationVersion != configMigrationVersion || stored.WorkshopDNS == nil {
		t.Fatal("DNS migration was not persisted")
	}
	// Version 2 is already a completed localStorage migration, even when a
	// sidecar is missing. Invalid legacy data must never be parsed again.
	app.migrationVersion = 2
	if err := app.MigrateLocalStorageConfig(LocalStorageMigrationPayload{WatchLaterItems: "{invalid json"}); err != nil {
		t.Fatalf("legacy migration repeated: %v", err)
	}
}

func TestWorkshopDNSConfigOrdinaryAndConcurrentSavesRetainDNS(t *testing.T) {
	app := newConfigTestApp(t)
	stale := app.GetAppConfig()
	if err := app.SetWorkshopDNSConfig(WorkshopDNSConfig{Mode: "custom", CustomAddress: "192.168.1.1"}); err != nil {
		t.Fatal(err)
	}
	if err := app.SaveAppConfig(stale); err != nil {
		t.Fatal(err)
	}
	if app.GetWorkshopDNSConfig().Mode != "custom" {
		t.Fatal("ordinary save overwrote the new DNS")
	}
	pool, err := ants.NewPool(4)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Release()
	var wg sync.WaitGroup
	failures := make(chan error, 12)
	for i := 0; i < 12; i++ {
		mode := "dnspod"
		if i%2 != 0 {
			mode = "alidns"
		}
		wg.Add(1)
		if err := pool.Submit(func() {
			defer wg.Done()
			stale := app.GetAppConfig()
			if err := app.SetWorkshopDNSConfig(WorkshopDNSConfig{Mode: mode}); err != nil {
				failures <- err
				return
			}
			app.getWorkshopNetworkClients()
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
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &stored); err != nil {
		t.Fatal(err)
	}
	if stored.WorkshopDNS == nil || *stored.WorkshopDNS != app.GetWorkshopDNSConfig() {
		t.Fatalf("persisted DNS differs from active DNS: %+v", stored.WorkshopDNS)
	}
}

type workshopRoundTripFunc func(*http.Request) (*http.Response, error)

func (f workshopRoundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func workshopJSONResponse(request *http.Request, body string) *http.Response {
	return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(body)), Request: request}
}

func TestWorkshopDNSAllAPIEntrypointsAndCacheRetention(t *testing.T) {
	clearWorkshopDetailTestCache()
	t.Cleanup(clearWorkshopDetailTestCache)
	app := newConfigTestApp(t)
	app.workshopPreferredIP = false
	clients := app.getWorkshopNetworkClients()
	if clients.transport.Proxy != nil {
		t.Fatal("workshop clients must resolve directly")
	}
	var calls []string
	fixture := workshopRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		calls = append(calls, request.Method+" "+request.URL.Host+request.URL.Path)
		body := `{"response":{"publishedfiledetails":[{"publishedfileid":"975313579","title":"Fixture"}],"total":1}}`
		if request.URL.Host == "l4d2-workshop-parse.laoyutang.cn" {
			body = `[{"publishedfileid":"975313579","title":"Fixture"}]`
		}
		return workshopJSONResponse(request, body), nil
	})
	clients.browser.SetTransport(fixture)
	clients.parser.Transport = fixture
	opts := WorkshopQueryOptions{Page: 1, SearchText: t.Name()}
	if _, err := app.FetchWorkshopList(opts); err != nil {
		t.Fatal(err)
	}
	if _, err := app.fetchWorkshopDetailRaw("975313579", false, false); err != nil {
		t.Fatal(err)
	}
	if _, err := app.fetchWorkshopDetails(`["975313579"]`); err != nil {
		t.Fatal(err)
	}
	if fmt.Sprint(calls) != "[GET l4d2-workshop.laoyutang.cn/list GET l4d2-workshop.laoyutang.cn/detail POST l4d2-workshop-parse.laoyutang.cn]" {
		t.Fatalf("unexpected API calls: %v", calls)
	}
	if err := app.SetWorkshopDNSConfig(WorkshopDNSConfig{Mode: "alidns"}); err != nil {
		t.Fatal(err)
	}
	if app.getWorkshopNetworkClients() == clients {
		t.Fatal("DNS change reused the old client")
	}
	if _, err := app.FetchWorkshopList(opts); err != nil {
		t.Fatal(err)
	}
	if _, err := app.fetchWorkshopDetailRaw("975313579", false, false); err != nil {
		t.Fatal(err)
	}
	if len(calls) != 3 {
		t.Fatal("DNS change cleared the workshop data cache")
	}
}

func TestWorkshopDNSChangeKeepsInflightRequestAndReplacesClients(t *testing.T) {
	clearWorkshopDetailTestCache()
	t.Cleanup(clearWorkshopDetailTestCache)
	app := newConfigTestApp(t)
	old := app.getWorkshopNetworkClients()
	started, release := make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	defer releaseOnce.Do(func() { close(release) })
	old.browser.SetTransport(workshopRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		close(started)
		<-release
		return workshopJSONResponse(request, `{"response":{"publishedfiledetails":[{"publishedfileid":"864208642","title":"Inflight"}]}}`), nil
	}))
	pool, err := ants.NewPool(1)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Release()
	finished := make(chan error, 1)
	if err := pool.Submit(func() { _, err := app.fetchWorkshopDetailRaw("864208642", true, false); finished <- err }); err != nil {
		t.Fatal(err)
	}
	<-started
	if err := app.SetWorkshopDNSConfig(WorkshopDNSConfig{Mode: "system"}); err != nil {
		t.Fatal(err)
	}
	current := app.getWorkshopNetworkClients()
	if current == old || current.parser.Transport != current.transport || current.browser.GetClient().Transport != current.transport {
		t.Fatal("client snapshots were not replaced together")
	}
	releaseOnce.Do(func() { close(release) })
	if err := <-finished; err != nil {
		t.Fatalf("inflight request failed: %v", err)
	}
}
