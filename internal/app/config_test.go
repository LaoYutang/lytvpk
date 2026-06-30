package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func newConfigTestApp(t *testing.T) *App {
	t.Helper()
	dir := t.TempDir()
	return &App{
		configDir:                 dir,
		configPath:                filepath.Join(dir, "config.json"),
		serversPath:               filepath.Join(dir, "servers.json"),
		workshopWatchLaterPath:    filepath.Join(dir, "workshop_watch_later.json"),
		workshopPreferredIP:       true,
		workshopMetaEnabled:       true,
		workshopBrowserTarget:     "mirror",
		workshopTranslateProvider: workshopTranslateProviderMicrosoft,
		displayMode:               "list",
		filterLayoutMode:          "compact",
		boxSelectionEnabled:       true,
		ctrlClickSelectionEnabled: true,
		savedDirectories:          []SavedDirectory{},
	}
}

func TestConfigDefaultsWithoutFile(t *testing.T) {
	app := newConfigTestApp(t)
	app.loadConfig()

	config := app.GetAppConfig()
	if config.WorkshopPreferredIP == nil || !*config.WorkshopPreferredIP {
		t.Fatalf("expected workshop preferred IP to default to true")
	}
	if config.WorkshopBrowserTarget == nil || *config.WorkshopBrowserTarget != "mirror" {
		t.Fatalf("expected browser target mirror, got %#v", config.WorkshopBrowserTarget)
	}
	if config.WorkshopTranslateProvider == nil || *config.WorkshopTranslateProvider != workshopTranslateProviderMicrosoft {
		t.Fatalf("expected translate provider microsoft, got %#v", config.WorkshopTranslateProvider)
	}
	if config.WorkshopMetaEnabled == nil || !*config.WorkshopMetaEnabled {
		t.Fatalf("expected workshop meta storage to default to true")
	}
	if config.DisplayMode != "list" {
		t.Fatalf("expected display mode list, got %q", config.DisplayMode)
	}
	if config.FilterLayoutMode != "compact" {
		t.Fatalf("expected filter layout compact, got %q", config.FilterLayoutMode)
	}
	if config.MigrationVersion != 0 {
		t.Fatalf("expected migration version 0, got %d", config.MigrationVersion)
	}
	if len(config.SavedDirectories) != 0 {
		t.Fatalf("expected no saved directories, got %d", len(config.SavedDirectories))
	}
	if config.BoxSelectionEnabled == nil || !*config.BoxSelectionEnabled {
		t.Fatalf("expected box selection to default to true")
	}
	if config.CtrlClickSelectionEnabled == nil || !*config.CtrlClickSelectionEnabled {
		t.Fatalf("expected ctrl click selection to default to true")
	}
}

func TestMigrateLocalStorageConfigCreatesMissingTargets(t *testing.T) {
	app := newConfigTestApp(t)

	err := app.MigrateLocalStorageConfig(legacyMigrationPayload())
	if err != nil {
		t.Fatalf("migrate local storage config: %v", err)
	}

	config := app.GetAppConfig()
	if config.MigrationVersion != configMigrationVersion {
		t.Fatalf("expected migration version %d, got %d", configMigrationVersion, config.MigrationVersion)
	}
	if config.WorkshopPreferredIP == nil || *config.WorkshopPreferredIP {
		t.Fatalf("expected migrated workshop preferred IP false")
	}
	if config.DisplayMode != "card" || config.FilterLayoutMode != "classic" {
		t.Fatalf("expected migrated display/filter modes, got %q/%q", config.DisplayMode, config.FilterLayoutMode)
	}
	if config.BoxSelectionEnabled == nil || !*config.BoxSelectionEnabled || config.CtrlClickSelectionEnabled == nil || !*config.CtrlClickSelectionEnabled {
		t.Fatalf("expected migrated selection settings enabled")
	}
	if config.Theme != "dark" || config.IgnoredVersion != "1.2.3" || config.LastUpdateCheckTime != "1779169113000" {
		t.Fatalf("expected migrated theme/update fields, got theme=%q ignored=%q last=%q", config.Theme, config.IgnoredVersion, config.LastUpdateCheckTime)
	}
	if !config.ModRotationConfig.EnableCharacters || config.ModRotationConfig.EnableWeapons {
		t.Fatalf("expected migrated rotation config, got %#v", config.ModRotationConfig)
	}

	servers := app.GetServerStorage()
	if len(servers.Servers) != 1 || servers.Servers[0].Address != "127.0.0.1:27015" {
		t.Fatalf("expected migrated server storage, got %#v", servers)
	}
	if len(servers.RecentServers) != 1 || servers.RecentServers[0].LastConnectedAt != 1779169113000 {
		t.Fatalf("expected migrated recent server storage, got %#v", servers.RecentServers)
	}

	watchLater := app.GetWorkshopWatchLaterStorage()
	if len(watchLater.Items) != 1 || watchLater.Items[0].PublishedFileID != "123" {
		t.Fatalf("expected migrated watch later storage, got %#v", watchLater)
	}
}

func TestMigrateLocalStorageConfigExistingTargetsSkipLegacyData(t *testing.T) {
	app := newConfigTestApp(t)
	writeConfigFixture(t, app.configPath, ConfigFile{
		DefaultDirectory:    "D:/Current",
		DisplayMode:         "card",
		FilterLayoutMode:    "compact",
		Theme:               "current-theme",
		MigrationVersion:    1,
		SavedDirectories:    []SavedDirectory{{Path: "D:/Current", LastUsed: "2026-05-20T00:00:00.000Z"}},
		LastUpdateCheckTime: "111",
	})
	if err := app.SaveServerStorage(ServerStorage{
		Servers:       []SavedServer{{Name: "Current", Address: "10.0.0.1:27015", Weight: 9}},
		RecentServers: []RecentServer{{Name: "Current Recent", Address: "10.0.0.3:27015", LastConnectedAt: 111}},
	}); err != nil {
		t.Fatalf("save server storage: %v", err)
	}
	if err := app.SaveWorkshopWatchLaterStorage(WorkshopWatchLaterStorage{
		Items: []WorkshopWatchLaterItem{{PublishedFileID: "current", Title: "Current Item"}},
	}); err != nil {
		t.Fatalf("save watch later storage: %v", err)
	}
	app.loadConfig()

	if err := app.MigrateLocalStorageConfig(legacyMigrationPayload()); err != nil {
		t.Fatalf("migrate local storage config: %v", err)
	}

	config := app.GetAppConfig()
	if config.MigrationVersion != configMigrationVersion {
		t.Fatalf("expected migration version %d, got %d", configMigrationVersion, config.MigrationVersion)
	}
	if config.DefaultDirectory != "D:/Current" || config.DisplayMode != "card" || config.Theme != "current-theme" || config.LastUpdateCheckTime != "111" {
		t.Fatalf("expected existing config fields to remain, got %#v", config)
	}

	servers := app.GetServerStorage()
	if len(servers.Servers) != 1 || servers.Servers[0].Address != "10.0.0.1:27015" {
		t.Fatalf("expected existing server storage to remain, got %#v", servers)
	}
	if len(servers.RecentServers) != 1 || servers.RecentServers[0].Address != "10.0.0.3:27015" {
		t.Fatalf("expected existing recent server storage to remain, got %#v", servers.RecentServers)
	}

	watchLater := app.GetWorkshopWatchLaterStorage()
	if len(watchLater.Items) != 1 || watchLater.Items[0].PublishedFileID != "current" {
		t.Fatalf("expected existing watch later storage to remain, got %#v", watchLater)
	}
}

func TestMigrateLocalStorageConfigMigratesOnlyMissingServers(t *testing.T) {
	app := newConfigTestApp(t)
	writeConfigFixture(t, app.configPath, ConfigFile{
		DefaultDirectory: "D:/Current",
		DisplayMode:      "card",
		MigrationVersion: 1,
	})
	if err := app.SaveWorkshopWatchLaterStorage(WorkshopWatchLaterStorage{
		Items: []WorkshopWatchLaterItem{{PublishedFileID: "current", Title: "Current Item"}},
	}); err != nil {
		t.Fatalf("save watch later storage: %v", err)
	}
	app.loadConfig()

	if err := app.MigrateLocalStorageConfig(legacyMigrationPayload()); err != nil {
		t.Fatalf("migrate local storage config: %v", err)
	}

	config := app.GetAppConfig()
	if config.MigrationVersion != configMigrationVersion || config.DefaultDirectory != "D:/Current" || config.DisplayMode != "card" {
		t.Fatalf("expected existing config to remain with migrated version, got %#v", config)
	}

	servers := app.GetServerStorage()
	if len(servers.Servers) != 1 || servers.Servers[0].Address != "127.0.0.1:27015" {
		t.Fatalf("expected legacy servers to be migrated, got %#v", servers)
	}
	if len(servers.RecentServers) != 1 || servers.RecentServers[0].LastConnectedAt != 1779169113000 {
		t.Fatalf("expected legacy recent servers to be migrated, got %#v", servers.RecentServers)
	}

	watchLater := app.GetWorkshopWatchLaterStorage()
	if len(watchLater.Items) != 1 || watchLater.Items[0].PublishedFileID != "current" {
		t.Fatalf("expected existing watch later storage to remain, got %#v", watchLater)
	}
}

func TestMigrateLocalStorageConfigMigratesOnlyMissingWatchLater(t *testing.T) {
	app := newConfigTestApp(t)
	writeConfigFixture(t, app.configPath, ConfigFile{
		DefaultDirectory: "D:/Current",
		DisplayMode:      "card",
		MigrationVersion: 1,
	})
	if err := app.SaveServerStorage(ServerStorage{
		Servers:       []SavedServer{{Name: "Current", Address: "10.0.0.1:27015", Weight: 9}},
		RecentServers: []RecentServer{{Name: "Current Recent", Address: "10.0.0.3:27015", LastConnectedAt: 111}},
	}); err != nil {
		t.Fatalf("save server storage: %v", err)
	}
	app.loadConfig()

	if err := app.MigrateLocalStorageConfig(legacyMigrationPayload()); err != nil {
		t.Fatalf("migrate local storage config: %v", err)
	}

	config := app.GetAppConfig()
	if config.MigrationVersion != configMigrationVersion || config.DefaultDirectory != "D:/Current" || config.DisplayMode != "card" {
		t.Fatalf("expected existing config to remain with migrated version, got %#v", config)
	}

	servers := app.GetServerStorage()
	if len(servers.Servers) != 1 || servers.Servers[0].Address != "10.0.0.1:27015" {
		t.Fatalf("expected existing server storage to remain, got %#v", servers)
	}
	if len(servers.RecentServers) != 1 || servers.RecentServers[0].Address != "10.0.0.3:27015" {
		t.Fatalf("expected existing recent server storage to remain, got %#v", servers.RecentServers)
	}

	watchLater := app.GetWorkshopWatchLaterStorage()
	if len(watchLater.Items) != 1 || watchLater.Items[0].PublishedFileID != "123" {
		t.Fatalf("expected legacy watch later storage to be migrated, got %#v", watchLater)
	}
}

func TestMigrateLocalStorageConfigVersionTwoDoesNotOverwrite(t *testing.T) {
	app := newConfigTestApp(t)
	app.defaultDirectory = "D:/Current"
	app.displayMode = "card"
	app.migrationVersion = configMigrationVersion
	app.saveConfig()
	if err := app.SaveServerStorage(ServerStorage{
		Servers: []SavedServer{{Name: "Current", Address: "10.0.0.1:27015", Weight: 9}},
	}); err != nil {
		t.Fatalf("save server storage: %v", err)
	}

	err := app.MigrateLocalStorageConfig(LocalStorageMigrationPayload{
		Config:  `{"defaultDirectory":"D:/Legacy","displayMode":"list"}`,
		Servers: `[{"name":"Legacy","address":"10.0.0.2:27015","weight":1}]`,
	})
	if err != nil {
		t.Fatalf("migrate local storage config: %v", err)
	}

	config := app.GetAppConfig()
	if config.DefaultDirectory != "D:/Current" || config.DisplayMode != "card" {
		t.Fatalf("expected config to remain unchanged, got %#v", config)
	}
	servers := app.GetServerStorage()
	if len(servers.Servers) != 1 || servers.Servers[0].Name != "Current" {
		t.Fatalf("expected server storage to remain unchanged, got %#v", servers.Servers)
	}
}

func TestDamagedSidecarJSONFallsBackToEmptyStorage(t *testing.T) {
	app := newConfigTestApp(t)
	if err := os.WriteFile(app.serversPath, []byte("{bad json"), 0644); err != nil {
		t.Fatalf("write damaged servers json: %v", err)
	}
	if err := os.WriteFile(app.workshopWatchLaterPath, []byte("{bad json"), 0644); err != nil {
		t.Fatalf("write damaged watch later json: %v", err)
	}

	servers := app.GetServerStorage()
	if len(servers.Servers) != 0 || len(servers.RecentServers) != 0 {
		t.Fatalf("expected empty server fallback, got %#v", servers)
	}
	watchLater := app.GetWorkshopWatchLaterStorage()
	if len(watchLater.Items) != 0 {
		t.Fatalf("expected empty watch later fallback, got %#v", watchLater)
	}
}

func TestServerPanelPasswordIsEncryptedAndHidden(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("DPAPI 加密仅在 Windows 上验证")
	}

	app := newConfigTestApp(t)
	err := app.SaveServerStorage(ServerStorage{
		Servers: []SavedServer{{
			ID:            "srv_test",
			Name:          "Panel",
			Address:       "127.0.0.1:27015",
			Weight:        1,
			PanelURL:      "http://127.0.0.1:27020",
			PanelPassword: "secret-password",
		}},
	})
	if err != nil {
		t.Fatalf("save server storage: %v", err)
	}

	raw, err := os.ReadFile(app.serversPath)
	if err != nil {
		t.Fatalf("read servers file: %v", err)
	}
	if strings.Contains(string(raw), "secret-password") {
		t.Fatalf("expected encrypted storage to hide plaintext password: %s", raw)
	}
	if !strings.Contains(string(raw), "panelPasswordEncrypted") {
		t.Fatalf("expected encrypted password field, got %s", raw)
	}

	storage := app.GetServerStorage()
	if len(storage.Servers) != 1 {
		t.Fatalf("expected one server, got %#v", storage.Servers)
	}
	server := storage.Servers[0]
	if !server.PanelPasswordSet {
		t.Fatalf("expected panelPasswordSet")
	}
	if server.PanelPassword != "" || server.PanelPasswordEncrypted != "" {
		t.Fatalf("frontend storage leaked password fields: %#v", server)
	}
}

func TestServerPanelPasswordPreserveAndClear(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("DPAPI 加密仅在 Windows 上验证")
	}

	app := newConfigTestApp(t)
	if err := app.SaveServerStorage(ServerStorage{
		Servers: []SavedServer{{
			ID:            "srv_test",
			Name:          "Panel",
			Address:       "127.0.0.1:27015",
			PanelURL:      "http://127.0.0.1:27020",
			PanelPassword: "secret-password",
		}},
	}); err != nil {
		t.Fatalf("initial save: %v", err)
	}

	var stored ServerStorage
	if err := readJSONFile(app.serversPath, &stored); err != nil {
		t.Fatalf("read stored config: %v", err)
	}
	encrypted := stored.Servers[0].PanelPasswordEncrypted
	if encrypted == "" {
		t.Fatalf("expected encrypted password")
	}

	if err := app.SaveServerStorage(ServerStorage{
		Servers: []SavedServer{{
			ID:       "srv_test",
			Name:     "Panel Renamed",
			Address:  "127.0.0.1:27015",
			PanelURL: "http://127.0.0.1:27020",
		}},
	}); err != nil {
		t.Fatalf("save without password: %v", err)
	}
	if err := readJSONFile(app.serversPath, &stored); err != nil {
		t.Fatalf("read preserved config: %v", err)
	}
	if stored.Servers[0].PanelPasswordEncrypted != encrypted {
		t.Fatalf("expected existing encrypted password to be preserved")
	}

	if err := app.SaveServerStorage(ServerStorage{
		Servers: []SavedServer{{
			ID:                 "srv_test",
			Name:               "Panel",
			Address:            "127.0.0.1:27015",
			PanelURL:           "http://127.0.0.1:27020",
			ClearPanelPassword: true,
		}},
	}); err != nil {
		t.Fatalf("clear password: %v", err)
	}
	stored = ServerStorage{}
	if err := readJSONFile(app.serversPath, &stored); err != nil {
		t.Fatalf("read cleared config: %v", err)
	}
	if stored.Servers[0].PanelPasswordEncrypted != "" {
		t.Fatalf("expected encrypted password to be cleared")
	}
}

func TestPanelProxyRequests(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("DPAPI 加密仅在 Windows 上验证")
	}

	var seen []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer panel-secret" {
			t.Fatalf("unexpected authorization header: %q", r.Header.Get("Authorization"))
		}
		seen = append(seen, r.URL.Path)

		switch r.URL.Path {
		case "/panel/rcon/getstatus":
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"Hostname":"Test Host","Map":"c1m1_hotel","Players":"1/8","Difficulty":"普通","GameMode":"合作","Users":[{"Name":"Alice","Id":3,"SteamId":"STEAM_1:1:1","Ip":"127.0.0.1:27005","Location":"本地","Status":"active","Delay":20,"Loss":0,"Duration":"00:10","LinkRate":60000}]}`))
		case "/panel/rcon/changemap":
			if got := r.FormValue("mapName"); got != "c2m1_highway" {
				t.Fatalf("unexpected mapName: %q", got)
			}
			w.Write([]byte("地图切换成功"))
		case "/panel/rcon/changedifficulty":
			if got := r.FormValue("difficulty"); got != "高级" {
				t.Fatalf("unexpected difficulty: %q", got)
			}
			w.Write([]byte("难度切换成功"))
		case "/panel/rcon":
			if got := r.FormValue("cmd"); got != "status" {
				t.Fatalf("unexpected rcon cmd: %q", got)
			}
			w.Write([]byte("hostname: Test Host"))
		case "/panel/clear":
			w.Write([]byte("清空成功！"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	app := newConfigTestApp(t)
	if err := app.SaveServerStorage(ServerStorage{
		Servers: []SavedServer{{
			ID:            "srv_panel",
			Name:          "Panel",
			Address:       "127.0.0.1:27015",
			PanelURL:      server.URL + "/panel",
			PanelPassword: "panel-secret",
		}},
	}); err != nil {
		t.Fatalf("save panel config: %v", err)
	}

	status, err := app.FetchPanelServerStatus("srv_panel")
	if err != nil {
		t.Fatalf("fetch panel status: %v", err)
	}
	if status.Hostname != "Test Host" || status.Users[0].Name != "Alice" {
		t.Fatalf("unexpected status: %#v", status)
	}

	if text, err := app.ChangePanelMap("srv_panel", "c2m1_highway"); err != nil || text != "地图切换成功" {
		t.Fatalf("change map = %q, %v", text, err)
	}
	if text, err := app.ChangePanelDifficulty("srv_panel", "高级"); err != nil || text != "难度切换成功" {
		t.Fatalf("change difficulty = %q, %v", text, err)
	}
	if text, err := app.SendPanelRconCommand("srv_panel", "status"); err != nil || text != "hostname: Test Host" {
		t.Fatalf("send rcon = %q, %v", text, err)
	}
	if text, err := app.ClearPanelMaps("srv_panel"); err != nil || text != "清空成功！" {
		t.Fatalf("clear maps = %q, %v", text, err)
	}

	expected := []string{"/panel/rcon/getstatus", "/panel/rcon/changemap", "/panel/rcon/changedifficulty", "/panel/rcon", "/panel/clear"}
	if strings.Join(seen, ",") != strings.Join(expected, ",") {
		t.Fatalf("unexpected request paths: %#v", seen)
	}
}

func writeConfigFixture(t *testing.T, path string, config ConfigFile) {
	t.Helper()
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		t.Fatalf("marshal config fixture: %v", err)
	}
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatalf("write config fixture: %v", err)
	}
}

func legacyMigrationPayload() LocalStorageMigrationPayload {
	return LocalStorageMigrationPayload{
		Config: `{
			"defaultDirectory":"D:/Games/left4dead2/addons",
			"savedDirectories":[{"path":"D:/Games/left4dead2/addons","lastUsed":"2026-05-19T00:00:00.000Z"}],
			"lastActiveDirectory":"D:/Games/left4dead2/addons",
			"displayMode":"card",
			"filterLayoutMode":"classic",
			"boxSelectionEnabled":true,
			"ctrlClickSelectionEnabled":true,
			"workshopPreferredIP":false,
			"modRotationConfig":{"enableCharacters":true,"enableWeapons":false},
			"ignoredVersion":"1.2.3"
		}`,
		Theme:               "dark",
		LastUpdateCheckTime: "1779169113000",
		Servers:             `[{"name":"Test","address":"127.0.0.1:27015","weight":5}]`,
		RecentServers:       `[{"name":"Test","address":"127.0.0.1:27015","lastConnectedAt":1779169113000}]`,
		WatchLaterItems:     `[{"publishedfileid":"123","title":"Item","preview_url":"https://example.test/a.jpg","views":10,"subscriptions":20,"favorited":30,"file_type":0,"addedAt":"2026-05-19T00:00:00.000Z"}]`,
	}
}
