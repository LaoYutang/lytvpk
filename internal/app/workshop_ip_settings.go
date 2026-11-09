package app

import (
	"errors"
	"log"
	"net/netip"
	"strings"

	"vpk-manager/internal/network"

	"github.com/panjf2000/ants/v2"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// WorkshopIPSettings is saved as one pair using the existing configuration fields.
type WorkshopIPSettings struct {
	Enabled bool   `json:"enabled"`
	FixedIP string `json:"fixedIP"`
}

type workshopIPSettingsSelector interface {
	SetFixedIP(string)
	GetBestIP(string) string
}

type workshopIPSelectionPolicy uint8

const (
	workshopIPSelectionNone workshopIPSelectionPolicy = iota
	workshopIPSelectionOnChange
	workshopIPSelectionOnEnable
)

func normalizeWorkshopIPSettings(settings WorkshopIPSettings) (WorkshopIPSettings, error) {
	settings.FixedIP = strings.TrimSpace(settings.FixedIP)
	if settings.FixedIP != "" {
		address, err := netip.ParseAddr(settings.FixedIP)
		if err != nil || address.Zone() != "" {
			return WorkshopIPSettings{}, errors.New("请输入单个有效的 IPv4 或 IPv6 地址")
		}
		settings.FixedIP = address.Unmap().String()
	}
	return settings, nil
}

func (a *App) workshopIPSettingsLocked() WorkshopIPSettings {
	return WorkshopIPSettings{Enabled: a.workshopPreferredIP, FixedIP: a.workshopFixedIP}
}

func (a *App) GetWorkshopIPSettings() WorkshopIPSettings {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.workshopIPSettingsLocked()
}

func (a *App) SetWorkshopIPSettings(settings WorkshopIPSettings) error {
	settings, err := normalizeWorkshopIPSettings(settings)
	if err != nil {
		return err
	}
	return a.saveWorkshopIPSettings(func(WorkshopIPSettings) WorkshopIPSettings {
		return settings
	}, workshopIPSelectionOnChange, network.GlobalIPSelector)
}

// The updater runs under both configuration locks so legacy single-field calls
// cannot restore the other field from a stale, separately captured pair.
func (a *App) saveWorkshopIPSettings(update func(WorkshopIPSettings) WorkshopIPSettings, policy workshopIPSelectionPolicy, selector workshopIPSettingsSelector) error {
	a.configWriteMu.Lock()
	a.mu.Lock()
	previous := a.workshopIPSettingsLocked()
	settings, err := normalizeWorkshopIPSettings(update(previous))
	if err != nil {
		a.mu.Unlock()
		a.configWriteMu.Unlock()
		return err
	}
	snapshot := a.snapshotConfigLocked()
	snapshot.WorkshopPreferredIP = &settings.Enabled
	snapshot.WorkshopFixedIP = &settings.FixedIP
	if err := a.writeConfigFileLocked(snapshot); err != nil {
		a.mu.Unlock()
		a.configWriteMu.Unlock()
		return errors.New("保存优选 IP 设置失败，请重试")
	}
	a.workshopPreferredIP = settings.Enabled
	a.workshopFixedIP = settings.FixedIP
	if previous.FixedIP != settings.FixedIP {
		// Clearing a fixed IP also clears the selector's automatic result. Keep
		// that established behavior only for an actual mode/address change.
		selector.SetFixedIP(settings.FixedIP)
	}
	a.mu.Unlock()
	a.configWriteMu.Unlock()

	startAuto := settings.Enabled && settings.FixedIP == "" &&
		policy == workshopIPSelectionOnChange && (!previous.Enabled || previous.FixedIP != settings.FixedIP)
	if policy == workshopIPSelectionOnEnable && settings.Enabled {
		a.startWorkshopIPSelectionWithSelector(selector)
	} else if startAuto {
		a.queueWorkshopIPSelection(settings, selector)
	}
	return nil
}

// startWorkshopIPSelection also serves startup callers. The saved fixed IP has
// already been applied synchronously; background work never reapplies old values.
func (a *App) startWorkshopIPSelection() {
	a.startWorkshopIPSelectionWithSelector(network.GlobalIPSelector)
}

func (a *App) startWorkshopIPSelectionWithSelector(selector workshopIPSettingsSelector) {
	settings := a.GetWorkshopIPSettings()
	if !settings.Enabled {
		return
	}
	if settings.FixedIP == "" {
		a.queueWorkshopIPSelection(settings, selector)
		return
	}
	// Startup has always notified the UI when a saved fixed address is ready.
	// Do not reapply it here: another successful save may already be newer.
	a.mu.RLock()
	ctx := a.ctx
	a.mu.RUnlock()
	if ctx != nil && ctx.Err() == nil {
		runtime.EventsEmit(ctx, "ip_selection_end", nil)
	}
}

func (a *App) queueWorkshopIPSelection(expected WorkshopIPSettings, selector workshopIPSettingsSelector) {
	a.mu.RLock()
	pool := a.goroutinePool
	ctx := a.ctx
	a.mu.RUnlock()
	if pool == nil || pool.IsClosed() || (ctx != nil && ctx.Err() != nil) {
		return
	}
	// The bounded application pool can be occupied by scanning/import tasks.
	// Its blocking Submit would keep the settings UI waiting after persistence
	// already succeeded. The existing default pool admits this independent
	// background job immediately; GetBestIP retains its selection deduplication.
	if err := ants.Submit(func() {
		a.mu.RLock()
		current := a.workshopIPSettingsLocked()
		ctx := a.ctx
		a.mu.RUnlock()
		if pool.IsClosed() || current != expected || !current.Enabled || current.FixedIP != "" || (ctx != nil && ctx.Err() != nil) {
			return
		}
		if ctx != nil {
			runtime.EventsEmit(ctx, "ip_selection_start", nil)
			defer runtime.EventsEmit(ctx, "ip_selection_end", nil)
		}
		// GetBestIP retains the original cached-result, candidate and speed-test
		// behavior. It reads the selector's current fixed IP before any testing.
		selector.GetBestIP("https://steamuserimages-a.akamaihd.net/ugc/test")
	}); err != nil {
		// Persistence already succeeded. A full/closed worker pool must not be
		// reported as a failed settings save or roll back the saved selection.
		log.Printf("无法启动优选 IP 任务: %v", err)
	}
}
