package app

import (
	"context"
	"errors"
	"net"
	"net/http"
	"strconv"
	"time"

	"vpk-manager/internal/network"
)

// apiOperation keeps a multi-request operation on one manually selected line.
// Changing settings affects later operations; existing clients stay usable.
type apiOperation struct {
	line       network.APILine
	generation uint64
	endpoints  network.APIEndpoints
	clients    *workshopNetworkClients
	mapClient  *http.Client
	ctx        context.Context
}

func (op apiOperation) cachePrefix() string {
	return string(op.line) + ":" + strconv.FormatUint(op.generation, 10) + ":"
}

func stopAPIRedirect(*http.Request, []*http.Request) error {
	return http.ErrUseLastResponse
}

// apiLineLocked requires a.mu to be held, including for a zero-value App.
func (a *App) apiLineLocked() network.APILine {
	if a.apiLine == network.APILineBackup {
		return network.APILineBackup
	}
	return network.APILinePrimary
}

func (a *App) GetAPILine() string {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return string(a.apiLineLocked())
}

// APILineStatus exposes only the selected line and whether IP candidates used
// the built-in fallback. Transport errors and server addresses remain private.
type APILineStatus struct {
	Line           string `json:"line"`
	IPPoolFallback bool   `json:"ipPoolFallback"`
}

func (a *App) GetAPILineStatus() APILineStatus {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return APILineStatus{
		Line: string(a.apiLineLocked()), IPPoolFallback: network.GlobalIPSelector.GetIPOptionsError() != nil,
	}
}

func (a *App) SetAPILine(value string) error {
	line, err := network.NormalizeAPILine(value)
	if err != nil {
		return err
	}
	a.configWriteMu.Lock()
	a.mu.Lock()
	snapshot := a.snapshotConfigLocked()
	snapshot.APILine = string(line)
	if snapshot.MigrationVersion < configMigrationVersion {
		snapshot.MigrationVersion = configMigrationVersion
	}
	if err := a.writeConfigFileLocked(snapshot); err != nil {
		a.mu.Unlock()
		a.configWriteMu.Unlock()
		return errors.New("保存 API 线路设置失败")
	}
	var previous *workshopNetworkClients
	if line != a.apiLineLocked() {
		previous = a.workshopNetwork
		a.workshopNetwork = newWorkshopNetworkClientsForLine(a.workshopDNSConfig, line)
		a.apiGeneration++
		clearWorkshopAPICache()
	}
	a.apiLine = line
	a.migrationVersion = snapshot.MigrationVersion
	// This setter takes only the selector's short state lock. It does not fetch
	// candidates or call App code, so both API sources are published together.
	network.GlobalIPSelector.SetAPILine(line)
	a.mu.Unlock()
	a.configWriteMu.Unlock()
	if previous != nil {
		previous.transport.CloseIdleConnections()
	}
	return nil
}

func (a *App) captureAPIOperation() apiOperation {
	a.mu.Lock()
	defer a.mu.Unlock()
	line := a.apiLineLocked()
	endpoints := network.EndpointsForAPILine(line)
	if line == network.APILinePrimary {
		// Existing tests replace this public-Worker base with a local fixture.
		endpoints.WorkshopBaseURL = WorkshopWorkerURL
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	var mapClient http.Client
	if a.restyClient != nil {
		mapClient = *a.restyClient.GetClient()
	} else {
		// Preserve the normal map client's IPv4/system-DNS policy for zero-value
		// App instances too, without reusing the workshop DNS dialer.
		dialer := &net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second}
		mapClient.Transport = &http.Transport{DialContext: func(ctx context.Context, _ string, address string) (net.Conn, error) {
			return dialer.DialContext(ctx, "tcp4", address)
		}}
	}
	mapClient.Timeout = network.APIRequestTimeout(line, 2*time.Second)
	mapClient.CheckRedirect = stopAPIRedirect
	return apiOperation{
		line: line, generation: a.apiGeneration, endpoints: endpoints,
		clients: a.getWorkshopNetworkClientsLocked(), mapClient: &mapClient, ctx: ctx,
	}
}
