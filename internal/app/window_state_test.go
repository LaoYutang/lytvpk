package app

import (
	"encoding/json"
	"os"
	"testing"
)

func TestInitialWindowStateUsesDefaultsWhenUnset(t *testing.T) {
	app := newConfigTestApp(t)
	app.loadConfig()

	state := InitialWindowState(app)
	if state.Width != DefaultWindowWidth || state.Height != DefaultWindowHeight {
		t.Fatalf("expected default window size %dx%d, got %dx%d", DefaultWindowWidth, DefaultWindowHeight, state.Width, state.Height)
	}
	if state.Maximised {
		t.Fatalf("expected window to start in normal state")
	}
	if app.GetAppConfig().WindowState != nil {
		t.Fatalf("expected window state to be omitted before first measurement")
	}
}

func TestInitialWindowStateUsesSavedValues(t *testing.T) {
	app := newConfigTestApp(t)
	writeConfigFixture(t, app.configPath, ConfigFile{
		DisplayMode: "list",
		WindowState: &WindowState{Width: 1280, Height: 720, Maximised: true},
	})
	app.loadConfig()

	state := InitialWindowState(app)
	if state.Width != 1280 || state.Height != 720 || !state.Maximised {
		t.Fatalf("expected saved window state 1280x720 maximised, got %#v", state)
	}
}

func TestInitialWindowStateFallsBackWhenSavedSizeTooSmall(t *testing.T) {
	app := newConfigTestApp(t)
	writeConfigFixture(t, app.configPath, ConfigFile{
		WindowState: &WindowState{Width: 320, Height: 200},
	})
	app.loadConfig()

	state := InitialWindowState(app)
	if state.Width != DefaultWindowWidth || state.Height != DefaultWindowHeight {
		t.Fatalf("expected fallback window size %dx%d, got %dx%d", DefaultWindowWidth, DefaultWindowHeight, state.Width, state.Height)
	}
}

func TestLoadConfigIgnoresZeroWindowState(t *testing.T) {
	app := newConfigTestApp(t)
	writeConfigFixture(t, app.configPath, ConfigFile{
		WindowState: &WindowState{},
	})
	app.loadConfig()

	state := InitialWindowState(app)
	if state.Width != DefaultWindowWidth || state.Height != DefaultWindowHeight {
		t.Fatalf("expected default window size, got %dx%d", state.Width, state.Height)
	}
}

func TestSaveAppConfigPreservesWindowState(t *testing.T) {
	app := newConfigTestApp(t)
	app.loadConfig()
	app.mu.Lock()
	app.windowState = WindowState{Width: 1180, Height: 760}
	app.mu.Unlock()

	// 前端保存配置时不会带上窗口状态，保存后不能被清掉
	if err := app.SaveAppConfig(ConfigFile{DisplayMode: "card"}); err != nil {
		t.Fatalf("save app config: %v", err)
	}

	reloaded := &App{configDir: app.configDir, configPath: app.configPath}
	reloaded.loadConfig()
	state := InitialWindowState(reloaded)
	if state.Width != 1180 || state.Height != 760 {
		t.Fatalf("expected window state to survive frontend config save, got %#v", state)
	}

	raw, err := os.ReadFile(app.configPath)
	if err != nil {
		t.Fatalf("read config file: %v", err)
	}
	var stored ConfigFile
	if err := json.Unmarshal(raw, &stored); err != nil {
		t.Fatalf("unmarshal config file: %v", err)
	}
	if stored.DisplayMode != "card" {
		t.Fatalf("expected display mode card, got %q", stored.DisplayMode)
	}
	if stored.WindowState == nil || stored.WindowState.Width != 1180 || stored.WindowState.Height != 760 {
		t.Fatalf("expected window state 1180x760 in config file, got %#v", stored.WindowState)
	}
}
