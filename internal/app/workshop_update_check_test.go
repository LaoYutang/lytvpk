package app

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"vpk-manager/internal/network"

	"github.com/panjf2000/ants/v2"
)

func addUpdateCheckFixture(t *testing.T, app *App, id string, confirmed bool) string {
	t.Helper()
	path := filepath.Join(app.configDir, id+".vpk")
	if err := os.WriteFile(path, []byte("local fixture"), 0644); err != nil {
		t.Fatal(err)
	}
	meta := WorkshopMeta{WorkshopID: id, DownloadedAt: time.Unix(1600000000, 0).UTC().Format(time.RFC3339)}
	if confirmed {
		meta.TimeUpdated = time.Unix(1700000000, 0).UTC().Format(time.RFC3339)
	}
	if err := writeWorkshopMeta(path, meta); err != nil {
		t.Fatal(err)
	}
	app.vpkCache.Store(path, &VPKFileCache{File: VPKFile{Path: path, WorkshopID: id}})
	return path
}

func TestWorkshopUpdateCheckKeepsSuccessAndReportsFailures(t *testing.T) {
	app, operation := newAPIRequestTestOperation(t, network.APILineBackup)
	updatedPath := addUpdateCheckFixture(t, app, "17", false)
	addUpdateCheckFixture(t, app, "18", false)
	addUpdateCheckFixture(t, app, "19", false)
	addUpdateCheckFixture(t, app, "20", false)
	addUpdateCheckFixture(t, app, "21", true)
	var calls atomic.Int32
	setAPIRequestTestTransport(operation, workshopRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		calls.Add(1)
		id := request.URL.Query().Get("id")
		switch id {
		case "17":
			return workshopJSONResponse(request, `{"response":{"publishedfiledetails":[{"publishedfileid":"17","time_updated":1700000000}]}}`), nil
		case "18":
			return workshopJSONResponse(request, `{"response":{"publishedfiledetails":[{"publishedfileid":"18","time_updated":"1590000000"}]}}`), nil
		case "19":
			response := workshopJSONResponse(request, `{"error":"https://private.invalid 192.0.2.9 token=secret"}`)
			response.StatusCode = http.StatusTooManyRequests
			response.Header.Set("Retry-After", "17")
			return response, nil
		case "20":
			return workshopJSONResponse(request, `{"response":{"publishedfiledetails":[{"publishedfileid":"20","time_updated":"https://private.invalid/192.0.2.9?token=secret"}]}}`), nil
		default:
			return nil, fmt.Errorf("unexpected local fixture ID")
		}
	}))

	result := app.checkModUpdatesWithOperation(operation)
	if result.TotalUpdates != 2 || result.NewDetected != 1 || result.FailedCount != 2 || result.Line != "backup" || result.FirstError == "" || calls.Load() != 4 {
		t.Fatalf("incomplete result lost successes or failures: %+v, requests=%d", result, calls.Load())
	}
	if strings.Contains(result.FirstError, "private.invalid") || strings.Contains(result.FirstError, "192.0.2.9") || strings.Contains(result.FirstError, "secret") {
		t.Fatalf("public update failure contains private response data: %q", result.FirstError)
	}
	meta, err := LoadWorkshopMeta(updatedPath)
	if err != nil || meta == nil || meta.TimeUpdated != time.Unix(1700000000, 0).UTC().Format(time.RFC3339) {
		t.Fatalf("successful update was not saved: %+v, %v", meta, err)
	}
}

func TestWorkshopUpdateCheckAllAPIFailuresKeepSpecificStatus(t *testing.T) {
	app, operation := newAPIRequestTestOperation(t, network.APILinePrimary)
	for _, id := range []string{"17", "18", "19"} {
		addUpdateCheckFixture(t, app, id, false)
	}
	var calls atomic.Int32
	setAPIRequestTestTransport(operation, workshopRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		calls.Add(1)
		response := workshopJSONResponse(request, `{"error":"https://private.invalid/192.0.2.9?token=secret"}`)
		response.StatusCode = http.StatusServiceUnavailable
		return response, nil
	}))
	result := app.checkModUpdatesWithOperation(operation)
	if result.TotalUpdates != 0 || result.NewDetected != 0 || result.FailedCount != 3 || result.Line != "primary" || calls.Load() != 3 {
		t.Fatalf("all failures incorrectly completed: %+v, requests=%d", result, calls.Load())
	}
	if !strings.Contains(result.FirstError, "主线路暂时不可用（HTTP 503）") || strings.Contains(result.FirstError, "private.invalid") || strings.Contains(result.FirstError, "secret") {
		t.Fatalf("specific safe status was lost: %q", result.FirstError)
	}
}

func TestWorkshopUpdateCheckMissingDetailsAreIncomplete(t *testing.T) {
	for _, body := range []string{
		`{"response":{"publishedfiledetails":[]}}`,
		`{"response":{"publishedfiledetails":[{"publishedfileid":"17"}]}}`,
		`{"response":{"publishedfiledetails":[{"publishedfileid":"17","time_updated":0}]}}`,
		`{"response":{"publishedfiledetails":[{"publishedfileid":"18","time_updated":1700000000}]}}`,
	} {
		t.Run(body, func(t *testing.T) {
			app, operation := newAPIRequestTestOperation(t, network.APILinePrimary)
			addUpdateCheckFixture(t, app, "17", false)
			setAPIRequestTestTransport(operation, workshopRoundTripFunc(func(request *http.Request) (*http.Response, error) {
				return workshopJSONResponse(request, body), nil
			}))
			result := app.checkModUpdatesWithOperation(operation)
			if result.FailedCount != 1 || result.FirstError == "" || result.TotalUpdates != 0 {
				t.Fatalf("invalid details were reported as latest: %+v", result)
			}
		})
	}
}

func TestWorkshopUpdateCheckInvalidDataDoesNotBlockExplicitRecheck(t *testing.T) {
	app, operation := newAPIRequestTestOperation(t, network.APILinePrimary)
	addUpdateCheckFixture(t, app, "17", false)
	var calls atomic.Int32
	setAPIRequestTestTransport(operation, workshopRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		if calls.Add(1) == 1 {
			return workshopJSONResponse(request, `{"response":{"publishedfiledetails":[{"publishedfileid":"17"}]}}`), nil
		}
		return workshopJSONResponse(request, `{"response":{"publishedfiledetails":[{"publishedfileid":"17","time_updated":1590000000}]}}`), nil
	}))
	first := app.checkModUpdatesWithOperation(operation)
	second := app.checkModUpdatesWithOperation(operation)
	if first.FailedCount != 1 || second.FailedCount != 0 || second.FirstError != "" || calls.Load() != 2 {
		t.Fatalf("invalid cached data blocked explicit check: first=%+v second=%+v requests=%d", first, second, calls.Load())
	}
}

func TestWorkshopUpdateCheckCancellationIncludesUnsubmittedItems(t *testing.T) {
	app, operation := newAPIRequestTestOperation(t, network.APILinePrimary)
	for n := 17; n < 25; n++ {
		addUpdateCheckFixture(t, app, fmt.Sprint(n), false)
	}
	addUpdateCheckFixture(t, app, "99", true)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	operation.ctx = ctx
	started := make(chan struct{}, 8)
	var calls atomic.Int32
	setAPIRequestTestTransport(operation, workshopRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		calls.Add(1)
		started <- struct{}{}
		<-request.Context().Done()
		return nil, request.Context().Err()
	}))
	pool, err := ants.NewPool(1)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Release()
	finished := make(chan UpdateCheckResult, 1)
	if err := pool.Submit(func() { finished <- app.checkModUpdatesWithOperation(operation) }); err != nil {
		t.Fatal(err)
	}
	for range 4 {
		select {
		case <-started:
		case <-time.After(5 * time.Second):
			t.Fatal("initial fixture batch did not start")
		}
	}
	cancel()
	select {
	case result := <-finished:
		if result.FailedCount != 8 || result.TotalUpdates != 1 || result.NewDetected != 0 || !strings.Contains(result.FirstError, "请求已取消") || calls.Load() != 4 {
			t.Fatalf("cancellation lost unfinished items or confirmed result: %+v, requests=%d", result, calls.Load())
		}
	case <-time.After(5 * time.Second):
		t.Fatal("canceled update check did not finish")
	}
}

func TestWorkshopUpdateCheckBatchKeepsPinnedLine(t *testing.T) {
	app, operation := newAPIRequestTestOperation(t, network.APILinePrimary)
	for n := 17; n < 23; n++ {
		addUpdateCheckFixture(t, app, fmt.Sprint(n), false)
	}
	started := make(chan struct{}, 6)
	release := make(chan struct{})
	var releaseOnce sync.Once
	defer releaseOnce.Do(func() { close(release) })
	var oldCalls, newCalls atomic.Int32
	setAPIRequestTestTransport(operation, workshopRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		oldCalls.Add(1)
		started <- struct{}{}
		<-release
		body := fmt.Sprintf(`{"response":{"publishedfiledetails":[{"publishedfileid":%q,"time_updated":1590000000}]}}`, request.URL.Query().Get("id"))
		return workshopJSONResponse(request, body), nil
	}))
	pool, err := ants.NewPool(1)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Release()
	finished := make(chan UpdateCheckResult, 1)
	if err := pool.Submit(func() { finished <- app.checkModUpdatesWithOperation(operation) }); err != nil {
		t.Fatal(err)
	}
	for range 4 {
		select {
		case <-started:
		case <-time.After(5 * time.Second):
			t.Fatal("initial fixture batch did not start")
		}
	}
	if err := app.SetAPILine("backup"); err != nil {
		t.Fatal(err)
	}
	setAPIRequestTestTransport(app.captureAPIOperation(), workshopRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		newCalls.Add(1)
		return nil, fmt.Errorf("new line must not run during the pinned batch")
	}))
	releaseOnce.Do(func() { close(release) })
	select {
	case result := <-finished:
		if result.Line != "primary" || result.FailedCount != 0 || result.FirstError != "" || result.TotalUpdates != 0 || oldCalls.Load() != 6 || newCalls.Load() != 0 {
			t.Fatalf("batch crossed lines or lost valid old results: %+v, old=%d new=%d", result, oldCalls.Load(), newCalls.Load())
		}
	case <-time.After(5 * time.Second):
		t.Fatal("pinned update check did not finish")
	}
}

func TestWorkshopUpdateCheckDisabledDoesNotClaimSuccess(t *testing.T) {
	app := newConfigTestApp(t)
	result := app.CheckModUpdates()
	if result.FailedCount != 1 || result.FirstError == "" || result.Line != "primary" {
		t.Fatalf("disabled check was reported as completed: %+v", result)
	}
}

func TestWorkshopUpdateCheckTimeUpdatedValidation(t *testing.T) {
	for _, value := range []interface{}{nil, true, "", "invalid", "https://private.invalid/192.0.2.9", "0", "-1", "9223372036854775808", float64(0), float64(-1), 1.5, math.NaN(), math.Inf(1), 1e30, int64(math.MaxInt64)} {
		if _, ok := updateCheckTimeUpdated(value); ok {
			t.Errorf("invalid update time accepted: %v", value)
		}
	}
	for _, value := range []interface{}{float64(1700000000), int64(1700000000), "1700000000"} {
		if got, ok := updateCheckTimeUpdated(value); !ok || got.Unix() != 1700000000 {
			t.Errorf("valid update time rejected: %v => %v, %v", value, got, ok)
		}
	}
}
