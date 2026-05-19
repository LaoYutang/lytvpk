package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func newConfigTestApp(t *testing.T) *App {
	t.Helper()
	dir := t.TempDir()
	return &App{
		configDir:              dir,
		configPath:             filepath.Join(dir, "config.json"),
		serversPath:            filepath.Join(dir, "servers.json"),
		workshopWatchLaterPath: filepath.Join(dir, "workshop_watch_later.json"),
		workshopPreferredIP:    true,
		workshopBrowserTarget:  "mirror",
		displayMode:            "list",
		filterLayoutMode:       "compact",
		savedDirectories:       []SavedDirectory{},
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
}

func TestMigrateLocalStorageConfigFromVersionOne(t *testing.T) {
	app := newConfigTestApp(t)
	fixedIP := "23.59.72.59"
	metaEnabled := true
	updateEnabled := true
	browserTarget := "steam"
	writeConfigFixture(t, app.configPath, ConfigFile{
		WorkshopFixedIP:            &fixedIP,
		WorkshopMetaEnabled:        &metaEnabled,
		WorkshopUpdateCheckEnabled: &updateEnabled,
		WorkshopBrowserTarget:      &browserTarget,
		MigrationVersion:           1,
	})
	app.loadConfig()

	err := app.MigrateLocalStorageConfig(LocalStorageMigrationPayload{
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
	})
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
	if config.WorkshopFixedIP == nil || *config.WorkshopFixedIP != fixedIP {
		t.Fatalf("expected existing fixed IP to remain %q, got %#v", fixedIP, config.WorkshopFixedIP)
	}
	if config.DisplayMode != "card" || config.FilterLayoutMode != "classic" {
		t.Fatalf("expected migrated display/filter modes, got %q/%q", config.DisplayMode, config.FilterLayoutMode)
	}
	if !config.BoxSelectionEnabled || !config.CtrlClickSelectionEnabled {
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
