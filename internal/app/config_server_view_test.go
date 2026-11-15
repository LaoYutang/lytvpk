package app

import (
	"encoding/json"
	"os"
	"testing"
)

func TestServerDisplayModeDefaultsToList(t *testing.T) {
	app := newConfigTestApp(t)
	app.loadConfig()
	if mode := app.GetAppConfig().ServerDisplayMode; mode != "list" {
		t.Fatalf("expected default server view list, got %q", mode)
	}
}

func TestServerDisplayModePersistsIndependentlyOfModView(t *testing.T) {
	for _, mode := range []string{"list", "card"} {
		t.Run(mode, func(t *testing.T) {
			app := newConfigTestApp(t)
			config := app.GetAppConfig()
			config.ServerDisplayMode = mode
			config.DisplayMode = "card"
			config.Theme = "dark"
			if err := app.SaveAppConfig(config); err != nil {
				t.Fatalf("save server view: %v", err)
			}

			restarted := &App{configPath: app.configPath}
			restarted.loadConfig()
			restored := restarted.GetAppConfig()
			if restored.ServerDisplayMode != mode || restored.DisplayMode != "card" || restored.Theme != "dark" {
				t.Fatalf("server view did not survive restart independently: %#v", restored)
			}
		})
	}
}

func TestServerDisplayModeInvalidValuesFallBackToList(t *testing.T) {
	for _, invalid := range []string{"", "grid", "CARD", " card ", "<script>"} {
		t.Run(invalid, func(t *testing.T) {
			app := newConfigTestApp(t)
			config := app.GetAppConfig()
			config.ServerDisplayMode = invalid
			if err := app.SaveAppConfig(config); err != nil {
				t.Fatalf("save invalid server view: %v", err)
			}
			if app.GetAppConfig().ServerDisplayMode != "list" {
				t.Fatal("invalid saved mode must fall back to list")
			}

			config.ServerDisplayMode = invalid
			data, err := json.Marshal(config)
			if err != nil {
				t.Fatalf("encode fixture: %v", err)
			}
			if err := os.WriteFile(app.configPath, data, 0644); err != nil {
				t.Fatalf("write invalid server view: %v", err)
			}
			restarted := &App{configPath: app.configPath}
			restarted.loadConfig()
			if restarted.GetAppConfig().ServerDisplayMode != "list" {
				t.Fatal("invalid loaded mode must fall back to list")
			}
		})
	}
}

func TestServerDisplayModeUpgradePreservesExistingConfiguration(t *testing.T) {
	app := newConfigTestApp(t)
	previous := []byte(`{"migrationVersion":5,"displayMode":"card","theme":"dark","defaultDirectory":"D:/Mods","sortType":"date","sortOrder":"desc","apiLine":"backup"}`)
	if err := os.WriteFile(app.configPath, previous, 0644); err != nil {
		t.Fatalf("write previous configuration: %v", err)
	}
	servers := []byte(`{"servers":[{"name":"Favorite","address":"192.0.2.1:27015"}],"recentServers":[]}`)
	if err := os.WriteFile(app.serversPath, servers, 0644); err != nil {
		t.Fatalf("write favorites fixture: %v", err)
	}
	app.loadConfig()
	data, err := os.ReadFile(app.configPath)
	if err != nil {
		t.Fatalf("read upgraded configuration: %v", err)
	}
	var upgraded ConfigFile
	if err := json.Unmarshal(data, &upgraded); err != nil {
		t.Fatalf("decode upgraded configuration: %v", err)
	}
	if upgraded.MigrationVersion != configMigrationVersion || upgraded.ServerDisplayMode != "list" {
		t.Fatalf("unexpected server view migration: %#v", upgraded)
	}
	if upgraded.DisplayMode != "card" || upgraded.Theme != "dark" || upgraded.DefaultDirectory != "D:/Mods" || upgraded.SortType != "date" || upgraded.SortOrder != "desc" || upgraded.APILine != "backup" {
		t.Fatalf("migration lost existing preferences: %#v", upgraded)
	}
	after, err := os.ReadFile(app.serversPath)
	if err != nil || string(after) != string(servers) {
		t.Fatalf("view migration modified favorites: %v", err)
	}
}

func TestServerDisplayModeLegacyMigrationDefaultsToList(t *testing.T) {
	app := newConfigTestApp(t)
	if err := app.MigrateLocalStorageConfig(legacyMigrationPayload()); err != nil {
		t.Fatalf("migrate local storage: %v", err)
	}
	config := app.GetAppConfig()
	if config.ServerDisplayMode != "list" || config.DisplayMode != "card" || config.MigrationVersion != configMigrationVersion {
		t.Fatalf("legacy migration mixed mod and server views: %#v", config)
	}
}
