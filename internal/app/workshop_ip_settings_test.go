package app

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"vpk-manager/internal/network"

	"github.com/panjf2000/ants/v2"
)

// This local selector records calls without fetching candidates or testing IPs.
type workshopIPSettingsFixtureSelector struct {
	mu       sync.Mutex
	fixedIP  string
	bestIP   string
	speed    float64
	setCalls []string
	getCalls int
	started  chan struct{}
	finished chan struct{}
	release  chan struct{}
}

func (s *workshopIPSettingsFixtureSelector) SetFixedIP(ip string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.fixedIP = ip
	s.setCalls = append(s.setCalls, ip)
	if ip == "" {
		s.bestIP, s.speed = "", 0
	}
}

func (s *workshopIPSettingsFixtureSelector) GetBestIP(string) string {
	s.mu.Lock()
	s.getCalls++
	result := s.bestIP
	if s.fixedIP != "" {
		result = s.fixedIP
	}
	s.mu.Unlock()
	if s.started != nil {
		s.started <- struct{}{}
	}
	if s.release != nil {
		<-s.release
	}
	if s.finished != nil {
		s.finished <- struct{}{}
	}
	return result
}

func (s *workshopIPSettingsFixtureSelector) snapshot() (string, string, float64, int, int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.fixedIP, s.bestIP, s.speed, len(s.setCalls), s.getCalls
}

func newWorkshopIPSettingsTestApp(t *testing.T) *App {
	t.Helper()
	app := newConfigTestApp(t)
	app.workshopPreferredIP = false
	pool, err := ants.NewPool(2)
	if err != nil {
		t.Fatal(err)
	}
	app.goroutinePool = pool
	t.Cleanup(pool.Release)
	return app
}

func replaceWorkshopIPSelectorForTest(t *testing.T) {
	t.Helper()
	previous := network.GlobalIPSelector
	network.GlobalIPSelector = &network.IPSelector{}
	t.Cleanup(func() { network.GlobalIPSelector = previous })
}

func saveWorkshopIPFixture(t *testing.T, app *App, settings WorkshopIPSettings, policy workshopIPSelectionPolicy, selector workshopIPSettingsSelector) {
	t.Helper()
	if err := app.saveWorkshopIPSettings(func(WorkshopIPSettings) WorkshopIPSettings { return settings }, policy, selector); err != nil {
		t.Fatal(err)
	}
}

func readWorkshopIPSettingsFixture(t *testing.T, path string) ConfigFile {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var config ConfigFile
	if err := json.Unmarshal(data, &config); err != nil {
		t.Fatal(err)
	}
	return config
}

func TestWorkshopIPSettingsPersistPairAndPreserveOtherPreferences(t *testing.T) {
	replaceWorkshopIPSelectorForTest(t)
	app := newConfigTestApp(t) // No worker pool: this fixture cannot test real IPs.
	app.theme = "dark"
	app.defaultDirectory = "saved-directory"
	app.apiLine = network.APILineBackup
	app.workshopDNSConfig = WorkshopDNSConfig{Mode: "system"}
	want := WorkshopIPSettings{Enabled: true, FixedIP: "2001:db8::1"}
	if err := app.SetWorkshopIPSettings(WorkshopIPSettings{Enabled: true, FixedIP: " 2001:0db8:0:0:0:0:0:1 "}); err != nil {
		t.Fatal(err)
	}
	stored := readWorkshopIPSettingsFixture(t, app.configPath)
	if app.GetWorkshopIPSettings() != want || stored.WorkshopPreferredIP == nil || !*stored.WorkshopPreferredIP || stored.WorkshopFixedIP == nil || *stored.WorkshopFixedIP != want.FixedIP || network.GlobalIPSelector.GetFixedIP() != want.FixedIP {
		t.Fatalf("saved pair disagrees with active pair: active=%+v stored=%+v", app.GetWorkshopIPSettings(), stored)
	}
	if stored.Theme != "dark" || stored.DefaultDirectory != "saved-directory" || stored.APILine != "backup" || stored.WorkshopDNS == nil || stored.WorkshopDNS.Mode != "system" {
		t.Fatal("IP save changed unrelated preferences")
	}
	restarted := newConfigTestApp(t)
	restarted.configPath, restarted.configDir = app.configPath, app.configDir
	restarted.loadConfig()
	if restarted.GetWorkshopIPSettings() != want || network.GlobalIPSelector.GetFixedIP() != want.FixedIP {
		t.Fatalf("restart lost the saved pair: %+v", restarted.GetWorkshopIPSettings())
	}
	if err := restarted.SetWorkshopIPSettings(WorkshopIPSettings{Enabled: false, FixedIP: want.FixedIP}); err != nil {
		t.Fatal(err)
	}
	if got := restarted.GetWorkshopIPSettings(); got.Enabled || got.FixedIP != want.FixedIP || network.GlobalIPSelector.GetFixedIP() != want.FixedIP {
		t.Fatalf("disabling unexpectedly discarded the fixed address: %+v", got)
	}
}

func TestWorkshopIPSettingsRejectNonLiteralAddressesWithoutChanges(t *testing.T) {
	replaceWorkshopIPSelectorForTest(t)
	app := newConfigTestApp(t)
	want := WorkshopIPSettings{Enabled: false, FixedIP: "192.0.2.8"}
	if err := app.SetWorkshopIPSettings(want); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(app.configPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, ip := range []string{"example.invalid", "192.0.2.1/24", "192.0.2.1:80", "[2001:db8::1]:80", "[2001:db8::1]", "fe80::1%eth0", "192.0.2.1,192.0.2.2", "192.000.002.1"} {
		if err := app.SetWorkshopIPSettings(WorkshopIPSettings{Enabled: true, FixedIP: ip}); err == nil || strings.Contains(err.Error(), ip) {
			t.Errorf("invalid address not rejected with a safe error: %q, %v", ip, err)
		}
		if app.GetWorkshopIPSettings() != want || network.GlobalIPSelector.GetFixedIP() != want.FixedIP {
			t.Fatalf("invalid input changed active settings: %q", ip)
		}
	}
	after, err := os.ReadFile(app.configPath)
	if err != nil || string(after) != string(before) {
		t.Fatal("invalid input changed persisted settings")
	}
}

func TestWorkshopIPSettingsNormalizeIPv4MappedAddresses(t *testing.T) {
	replaceWorkshopIPSelectorForTest(t)
	app := newConfigTestApp(t)
	if err := app.SetWorkshopIPSettings(WorkshopIPSettings{Enabled: true, FixedIP: " ::ffff:192.0.2.8 "}); err != nil {
		t.Fatal(err)
	}
	if got := app.GetWorkshopIPSettings(); got.FixedIP != "192.0.2.8" || network.GlobalIPSelector.GetFixedIP() != got.FixedIP {
		t.Fatalf("mapped IPv4 was not normalized consistently: %+v", got)
	}
}

func TestWorkshopIPSettingsFailedSaveHasNoSelectionSideEffects(t *testing.T) {
	app := newWorkshopIPSettingsTestApp(t)
	selector := &workshopIPSettingsFixtureSelector{bestIP: "192.0.2.7", speed: 7.5}
	want := WorkshopIPSettings{Enabled: false, FixedIP: "192.0.2.8"}
	saveWorkshopIPFixture(t, app, want, workshopIPSelectionOnChange, selector)
	path := app.configPath
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	app.configPath = filepath.Join(app.configDir, "blocked")
	if err := os.Mkdir(app.configPath, 0755); err != nil {
		t.Fatal(err)
	}
	err = app.saveWorkshopIPSettings(func(WorkshopIPSettings) WorkshopIPSettings {
		return WorkshopIPSettings{Enabled: true, FixedIP: ""}
	}, workshopIPSelectionOnChange, selector)
	if err == nil || strings.Contains(err.Error(), app.configDir) {
		t.Fatalf("expected a safe persistence error: %v", err)
	}
	fixed, best, speed, sets, gets := selector.snapshot()
	if app.GetWorkshopIPSettings() != want || fixed != want.FixedIP || best != "192.0.2.7" || speed != 7.5 || sets != 1 || gets != 0 {
		t.Fatalf("failed save changed active selection: pair=%+v selector=%q/%q/%v sets=%d gets=%d", app.GetWorkshopIPSettings(), fixed, best, speed, sets, gets)
	}
	after, err := os.ReadFile(path)
	if err != nil || string(after) != string(before) {
		t.Fatal("failed save changed the existing config")
	}
	files, err := filepath.Glob(filepath.Join(app.configDir, ".config-*.tmp"))
	if err != nil || len(files) != 0 {
		t.Fatalf("failed save leaked temporary files: %v, %v", files, err)
	}
}

func TestWorkshopIPSettingsNoOpAndDisabledSavesKeepAutomaticCache(t *testing.T) {
	app := newWorkshopIPSettingsTestApp(t)
	app.workshopPreferredIP = true
	selector := &workshopIPSettingsFixtureSelector{bestIP: "192.0.2.7", speed: 7.5, finished: make(chan struct{}, 1)}
	saveWorkshopIPFixture(t, app, WorkshopIPSettings{Enabled: true}, workshopIPSelectionOnChange, selector)
	saveWorkshopIPFixture(t, app, WorkshopIPSettings{Enabled: false}, workshopIPSelectionOnChange, selector)
	_, best, speed, sets, gets := selector.snapshot()
	if best != "192.0.2.7" || speed != 7.5 || sets != 0 || gets != 0 {
		t.Fatalf("no-op or disabling reset a cached result: %q/%v sets=%d gets=%d", best, speed, sets, gets)
	}
	saveWorkshopIPFixture(t, app, WorkshopIPSettings{Enabled: true}, workshopIPSelectionOnChange, selector)
	select {
	case <-selector.finished:
	case <-time.After(5 * time.Second):
		t.Fatal("reenabling automatic mode did not use the original selector")
	}
	_, best, speed, sets, gets = selector.snapshot()
	if best != "192.0.2.7" || speed != 7.5 || sets != 0 || gets != 1 {
		t.Fatal("reenabling did not retain the selector's existing cache behavior")
	}
}

func TestWorkshopIPSettingsModeChangeUsesOriginalSelectorOnce(t *testing.T) {
	app := newWorkshopIPSettingsTestApp(t)
	selector := &workshopIPSettingsFixtureSelector{bestIP: "192.0.2.7", speed: 7.5, finished: make(chan struct{}, 1)}
	fixed := WorkshopIPSettings{Enabled: true, FixedIP: "192.0.2.8"}
	saveWorkshopIPFixture(t, app, fixed, workshopIPSelectionOnChange, selector)
	_, best, speed, sets, gets := selector.snapshot()
	if best != "192.0.2.7" || speed != 7.5 || sets != 1 || gets != 0 {
		t.Fatal("fixed mode unexpectedly tested or cleared the cached automatic IP")
	}
	saveWorkshopIPFixture(t, app, fixed, workshopIPSelectionOnChange, selector)
	saveWorkshopIPFixture(t, app, WorkshopIPSettings{Enabled: true}, workshopIPSelectionOnChange, selector)
	select {
	case <-selector.finished:
	case <-time.After(5 * time.Second):
		t.Fatal("fixed-to-auto did not trigger selection")
	}
	actualFixed, best, speed, sets, gets := selector.snapshot()
	if actualFixed != "" || best != "" || speed != 0 || sets != 2 || gets != 1 {
		t.Fatalf("mode change did not apply existing selector behavior exactly once: fixed=%q best=%q speed=%v sets=%d gets=%d", actualFixed, best, speed, sets, gets)
	}
}

func TestWorkshopIPSettingsOldSelectionCannotRestoreOldFixedValue(t *testing.T) {
	app := newWorkshopIPSettingsTestApp(t)
	selector := &workshopIPSettingsFixtureSelector{started: make(chan struct{}, 1), finished: make(chan struct{}, 1), release: make(chan struct{})}
	var releaseOnce sync.Once
	defer releaseOnce.Do(func() { close(selector.release) })
	saveWorkshopIPFixture(t, app, WorkshopIPSettings{Enabled: true}, workshopIPSelectionOnChange, selector)
	select {
	case <-selector.started:
	case <-time.After(5 * time.Second):
		t.Fatal("selection fixture did not start")
	}
	want := WorkshopIPSettings{Enabled: true, FixedIP: "192.0.2.8"}
	saveWorkshopIPFixture(t, app, want, workshopIPSelectionOnChange, selector)
	releaseOnce.Do(func() { close(selector.release) })
	select {
	case <-selector.finished:
	case <-time.After(5 * time.Second):
		t.Fatal("selection fixture did not complete")
	}
	fixed, _, _, sets, gets := selector.snapshot()
	if app.GetWorkshopIPSettings() != want || fixed != want.FixedIP || sets != 1 || gets != 1 {
		t.Fatal("old background work reapplied an obsolete fixed IP")
	}
}

func TestWorkshopIPSettingsStaleAndConcurrentSnapshotsKeepPair(t *testing.T) {
	app := newWorkshopIPSettingsTestApp(t)
	selector := &workshopIPSettingsFixtureSelector{}
	stale := app.snapshotConfig()
	want := WorkshopIPSettings{Enabled: false, FixedIP: "192.0.2.8"}
	saveWorkshopIPFixture(t, app, want, workshopIPSelectionNone, selector)
	if err := app.writeConfigFile(stale); err != nil {
		t.Fatal(err)
	}
	stored := readWorkshopIPSettingsFixture(t, app.configPath)
	if stored.WorkshopPreferredIP == nil || *stored.WorkshopPreferredIP || stored.WorkshopFixedIP == nil || *stored.WorkshopFixedIP != want.FixedIP {
		t.Fatal("old snapshot replaced the committed pair")
	}
	pool, err := ants.NewPool(4)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Release()
	var wg sync.WaitGroup
	for n := range 16 {
		n := n
		wg.Add(1)
		if err := pool.Submit(func() {
			defer wg.Done()
			settings := WorkshopIPSettings{Enabled: n%2 == 0, FixedIP: "192.0.2.8"}
			if settings.Enabled {
				settings.FixedIP = "192.0.2.9"
			}
			stale := app.snapshotConfig()
			if err := app.saveWorkshopIPSettings(func(WorkshopIPSettings) WorkshopIPSettings { return settings }, workshopIPSelectionNone, selector); err != nil {
				t.Error(err)
			}
			if err := app.SaveAppConfig(stale); err != nil {
				t.Error(err)
			}
			pair := app.GetWorkshopIPSettings()
			if (pair.Enabled && pair.FixedIP != "192.0.2.9") || (!pair.Enabled && pair.FixedIP != "192.0.2.8") {
				t.Errorf("atomic read observed a mixed pair: %+v", pair)
			}
		}); err != nil {
			wg.Done()
			t.Fatal(err)
		}
	}
	wg.Wait()
	stored = readWorkshopIPSettingsFixture(t, app.configPath)
	pair := app.GetWorkshopIPSettings()
	fixed, _, _, _, _ := selector.snapshot()
	if stored.WorkshopPreferredIP == nil || *stored.WorkshopPreferredIP != pair.Enabled || stored.WorkshopFixedIP == nil || *stored.WorkshopFixedIP != pair.FixedIP || fixed != pair.FixedIP {
		t.Fatal("disk, active pair and selector disagree after concurrent saves")
	}
}

func TestWorkshopIPSettingsLegacySettersPreserveOtherFieldAndRollback(t *testing.T) {
	replaceWorkshopIPSelectorForTest(t)
	app := newConfigTestApp(t)
	app.workshopPreferredIP = false
	app.SetWorkshopFixedIP(" 192.0.2.8 ")
	app.SetWorkshopPreferredIP(true)
	want := WorkshopIPSettings{Enabled: true, FixedIP: "192.0.2.8"}
	if app.GetWorkshopIPSettings() != want || network.GlobalIPSelector.GetFixedIP() != want.FixedIP {
		t.Fatal("legacy startup/setter calls lost the other setting")
	}
	app.configPath = filepath.Join(app.configDir, "blocked")
	if err := os.Mkdir(app.configPath, 0755); err != nil {
		t.Fatal(err)
	}
	app.SetWorkshopPreferredIP(false)
	app.SetWorkshopFixedIP("192.0.2.9")
	if app.GetWorkshopIPSettings() != want || network.GlobalIPSelector.GetFixedIP() != want.FixedIP {
		t.Fatal("failed legacy setter published an unsaved setting")
	}
}

func TestWorkshopIPSettingsStartupAndLegacySelectionUseCurrentPair(t *testing.T) {
	app := newWorkshopIPSettingsTestApp(t)
	selector := &workshopIPSettingsFixtureSelector{finished: make(chan struct{}, 3)}
	app.startWorkshopIPSelectionWithSelector(selector)
	saveWorkshopIPFixture(t, app, WorkshopIPSettings{Enabled: false, FixedIP: "192.0.2.8"}, workshopIPSelectionNone, selector)
	app.startWorkshopIPSelectionWithSelector(selector)
	saveWorkshopIPFixture(t, app, WorkshopIPSettings{Enabled: true, FixedIP: "192.0.2.8"}, workshopIPSelectionNone, selector)
	app.startWorkshopIPSelectionWithSelector(selector)
	_, _, _, sets, gets := selector.snapshot()
	if sets != 1 || gets != 0 {
		t.Fatal("startup changed a fixed address or selected while disabled/fixed")
	}
	// This is the legacy startup trigger: enabled may already be true, but the
	// original selector must still get a chance to reuse or fill its cache.
	saveWorkshopIPFixture(t, app, WorkshopIPSettings{Enabled: true}, workshopIPSelectionNone, selector)
	saveWorkshopIPFixture(t, app, WorkshopIPSettings{Enabled: true}, workshopIPSelectionOnEnable, selector)
	select {
	case <-selector.finished:
	case <-time.After(5 * time.Second):
		t.Fatal("legacy enabled call did not trigger the original selector")
	}
	_, _, _, sets, gets = selector.snapshot()
	if sets != 2 || gets != 1 {
		t.Fatal("legacy/startup trigger reset the cache or ran more than once")
	}
}

func TestWorkshopIPSettingsClosedWorkerPoolDoesNotUndoSavedPair(t *testing.T) {
	app := newWorkshopIPSettingsTestApp(t)
	app.goroutinePool.Release()
	selector := &workshopIPSettingsFixtureSelector{}
	want := WorkshopIPSettings{Enabled: true}
	saveWorkshopIPFixture(t, app, want, workshopIPSelectionOnChange, selector)
	stored := readWorkshopIPSettingsFixture(t, app.configPath)
	_, _, _, _, gets := selector.snapshot()
	if app.GetWorkshopIPSettings() != want || stored.WorkshopPreferredIP == nil || !*stored.WorkshopPreferredIP || gets != 0 {
		t.Fatal("worker submission failure undid the successfully saved preference")
	}
}

func TestWorkshopIPSettingsBusyMainPoolDoesNotBlockSave(t *testing.T) {
	app := newWorkshopIPSettingsTestApp(t)
	started := make(chan struct{}, 2)
	release := make(chan struct{})
	var releaseOnce sync.Once
	defer releaseOnce.Do(func() { close(release) })
	for range 2 {
		if err := app.goroutinePool.Submit(func() {
			started <- struct{}{}
			<-release
		}); err != nil {
			t.Fatal(err)
		}
	}
	for range 2 {
		select {
		case <-started:
		case <-time.After(5 * time.Second):
			t.Fatal("main-pool fixture did not fill its two slots")
		}
	}
	selector := &workshopIPSettingsFixtureSelector{finished: make(chan struct{}, 1)}
	callerPool, err := ants.NewPool(1)
	if err != nil {
		t.Fatal(err)
	}
	defer callerPool.Release()
	saved := make(chan error, 1)
	if err := callerPool.Submit(func() {
		saved <- app.saveWorkshopIPSettings(func(WorkshopIPSettings) WorkshopIPSettings {
			return WorkshopIPSettings{Enabled: true}
		}, workshopIPSelectionOnChange, selector)
	}); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-saved:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("settings save waited for a busy main pool after committing")
	}
	select {
	case <-selector.finished:
	case <-time.After(2 * time.Second):
		t.Fatal("busy main pool prevented the saved automatic selection")
	}
	_, _, _, _, gets := selector.snapshot()
	if gets != 1 || !app.GetWorkshopIPSettings().Enabled || app.goroutinePool.Running() != 2 {
		t.Fatal("selection was lost, duplicated or run in the blocked main pool")
	}
}

func TestWorkshopIPSettingsCanceledAppDoesNotStartSelection(t *testing.T) {
	app := newWorkshopIPSettingsTestApp(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	app.ctx = ctx
	selector := &workshopIPSettingsFixtureSelector{}
	saveWorkshopIPFixture(t, app, WorkshopIPSettings{Enabled: true}, workshopIPSelectionOnChange, selector)
	_, _, _, sets, gets := selector.snapshot()
	if !app.GetWorkshopIPSettings().Enabled || sets != 0 || gets != 0 {
		t.Fatal("closing app started selection or lost a committed setting")
	}
}
