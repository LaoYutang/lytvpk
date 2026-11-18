package app

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"slices"
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

func addUpdateCheckCopy(t *testing.T, app *App, id, name string, downloaded int64) string {
	t.Helper()
	path := filepath.Join(app.configDir, name+".vpk")
	if err := os.WriteFile(path, []byte("copy"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := writeWorkshopMeta(path, WorkshopMeta{WorkshopID: id, DownloadedAt: time.Unix(downloaded, 0).UTC().Format(time.RFC3339)}); err != nil {
		t.Fatal(err)
	}
	app.vpkCache.Store(path, &VPKFileCache{File: VPKFile{Path: path, WorkshopID: id}})
	return path
}

func updateRequestIDs(request *http.Request) []string {
	return strings.Split(request.URL.Query().Get("ids"), ",")
}

func currentUpdateResponse(request *http.Request) *http.Response {
	var items []map[string]any
	for _, id := range updateRequestIDs(request) {
		items = append(items, map[string]any{"publishedfileid": id, "result": 1, "time_updated": 1590000000})
	}
	data, _ := json.Marshal(map[string]any{"items": items})
	return workshopJSONResponse(request, string(data))
}

func TestWorkshopUpdateCheckKeepsSuccessAndReportsFailures(t *testing.T) {
	app, operation := newAPIRequestTestOperation(t, network.APILineBackup)
	updatedPath := addUpdateCheckFixture(t, app, "17", false)
	newerPath := addUpdateCheckCopy(t, app, "00017", "newer", 1800000000)
	missingPath := addUpdateCheckFixture(t, app, "18", false)
	addUpdateCheckCopy(t, app, "18", "missing-copy", 1600000001)
	addUpdateCheckFixture(t, app, "19", false)
	addUpdateCheckFixture(t, app, "20", false)
	addUpdateCheckFixture(t, app, "21", true)
	addUpdateCheckFixture(t, app, "22", false)
	badID := addUpdateCheckFixture(t, app, "0", false)
	var calls atomic.Int32
	setAPIRequestTestTransport(operation, workshopRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		n := calls.Add(1)
		want := []string{"17", "18", "19", "20", "22"}
		if n == 2 {
			want = []string{"18", "19", "20", "22"}
		}
		if request.Method != "GET" || request.URL.Path != "/workshop/updates" || !slices.Equal(updateRequestIDs(request), want) {
			t.Errorf("unexpected request %s %s", request.Method, request.URL)
		}
		if n == 2 {
			return currentUpdateResponse(request), nil
		}
		return workshopJSONResponse(request, `{"items":[
			{"publishedfileid":"22","result":"bad"},
			{"publishedfileid":"20","result":1,"time_updated":1700000000},
			{"publishedfileid":"19","result":15},
			{"publishedfileid":"18","result":9,"time_updated":1900000000},
			{"publishedfileid":"20","result":9},
			{"publishedfileid":"17","result":1,"time_updated":"1700000000"},
			{"publishedfileid":"999","result":9}
		]}`), nil
	}))

	first := app.checkModUpdatesWithOperation(operation)
	if first.TotalUpdates != 2 || first.NewDetected != 1 || first.UnavailableCount != 1 || first.FailedCount != 4 || first.Line != "backup" || first.FirstError == "" || calls.Load() != 1 {
		t.Fatalf("unexpected mixed result: %+v, requests=%d", first, calls.Load())
	}
	for path, expected := range map[string]string{updatedPath: time.Unix(1700000000, 0).UTC().Format(time.RFC3339), newerPath: "", missingPath: "", badID: ""} {
		meta, err := LoadWorkshopMeta(path)
		if err != nil || meta == nil || meta.TimeUpdated != expected {
			t.Fatalf("%s: meta=%+v err=%v", path, meta, err)
		}
	}
	second := app.checkModUpdatesWithOperation(operation)
	if second.TotalUpdates != 2 || second.NewDetected != 0 || second.UnavailableCount != 0 || second.FailedCount != 1 || calls.Load() != 2 {
		t.Fatalf("recheck: %+v, calls=%d", second, calls.Load())
	}
}

func TestWorkshopUpdateCheckThreeHundredIDsUseThreeRequests(t *testing.T) {
	app, op := newAPIRequestTestOperation(t, network.APILinePrimary)
	for i := 0; i < 300; i++ {
		addUpdateCheckFixture(t, app, fmt.Sprint(100000+i), false)
	}
	var mu sync.Mutex
	seen := make(map[string]bool)
	calls := 0
	setAPIRequestTestTransport(op, workshopRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		ids := updateRequestIDs(request)
		mu.Lock()
		defer mu.Unlock()
		calls++
		if len(ids) != 100 {
			t.Errorf("batch size %d", len(ids))
		}
		for _, id := range ids {
			if seen[id] {
				t.Errorf("repeated ID %s", id)
			}
			seen[id] = true
		}
		return currentUpdateResponse(request), nil
	}))
	first := app.checkModUpdatesWithOperation(op)
	second := app.checkModUpdatesWithOperation(op)
	if calls != 3 || len(seen) != 300 || first != second || first.FailedCount != 0 || first.TotalUpdates != 0 || first.UnavailableCount != 0 {
		t.Fatalf("first=%+v second=%+v calls=%d ids=%d", first, second, calls, len(seen))
	}
}

func TestWorkshopUpdateCheckIsolatesFailedBatches(t *testing.T) {
	app, op := newAPIRequestTestOperation(t, network.APILinePrimary)
	for i := 0; i < 101; i++ {
		addUpdateCheckFixture(t, app, fmt.Sprint(100000+i), false)
	}
	setAPIRequestTestTransport(op, workshopRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		if len(updateRequestIDs(request)) == 1 {
			return workshopJSONResponse(request, `{"items":[{"publishedfileid":"100100","result":1,"time_updated":1700000000}]}`), nil
		}
		resp := workshopJSONResponse(request, `{}`)
		resp.StatusCode = 503
		return resp, nil
	}))
	got := app.checkModUpdatesWithOperation(op)
	if got.TotalUpdates != 1 || got.NewDetected != 1 || got.FailedCount != 100 || got.UnavailableCount != 0 || !strings.Contains(got.FirstError, "HTTP 503") {
		t.Fatal(got)
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
	if result.TotalUpdates != 0 || result.NewDetected != 0 || result.FailedCount != 3 || result.Line != "primary" || calls.Load() != 1 {
		t.Fatalf("all failures incorrectly completed: %+v, requests=%d", result, calls.Load())
	}
	if !strings.Contains(result.FirstError, "主线路暂时不可用（HTTP 503）") || strings.Contains(result.FirstError, "private.invalid") || strings.Contains(result.FirstError, "secret") {
		t.Fatalf("specific safe status was lost: %q", result.FirstError)
	}
}

func TestWorkshopUpdateCheckMissingDetailsAreIncomplete(t *testing.T) {
	for _, body := range []string{
		`{}`, `{"items":[]}`, `{"items":null}`, `not JSON`,
		`{"items":[{"publishedfileid":"17"}]}`,
		`{"items":[{"publishedfileid":"17","result":1,"time_updated":0}]}`,
		`{"items":[{"publishedfileid":"18","result":9}]}`,
		`{"items":[{"publishedfileid":"17","result":"9"}]}`,
		`{"items":[{"publishedfileid":"17","result":9},{"publishedfileid":"17","result":9}]}`,
	} {
		t.Run(body, func(t *testing.T) {
			app, operation := newAPIRequestTestOperation(t, network.APILinePrimary)
			addUpdateCheckFixture(t, app, "17", false)
			setAPIRequestTestTransport(operation, workshopRoundTripFunc(func(request *http.Request) (*http.Response, error) {
				return workshopJSONResponse(request, body), nil
			}))
			result := app.checkModUpdatesWithOperation(operation)
			if result.FailedCount != 1 || result.FirstError == "" || result.TotalUpdates != 0 || result.UnavailableCount != 0 {
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
			return workshopJSONResponse(request, `{"items":[{"publishedfileid":"17","result":1}]}`), nil
		}
		return workshopJSONResponse(request, `{"items":[{"publishedfileid":"17","result":1,"time_updated":1590000000}]}`), nil
	}))
	first := app.checkModUpdatesWithOperation(operation)
	second := app.checkModUpdatesWithOperation(operation)
	if first.FailedCount != 1 || second.FailedCount != 0 || second.FirstError != "" || calls.Load() != 2 {
		t.Fatalf("invalid cached data blocked explicit check: first=%+v second=%+v requests=%d", first, second, calls.Load())
	}
}

func TestWorkshopUpdateCheckCancellationIncludesUnsubmittedItems(t *testing.T) {
	app, operation := newAPIRequestTestOperation(t, network.APILinePrimary)
	for n := 100000; n < 100401; n++ {
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
		if result.FailedCount != 401 || result.TotalUpdates != 1 || result.NewDetected != 0 || !strings.Contains(result.FirstError, "请求已取消") || calls.Load() != 4 {
			t.Fatalf("cancellation lost unfinished items or confirmed result: %+v, requests=%d", result, calls.Load())
		}
	case <-time.After(5 * time.Second):
		t.Fatal("canceled update check did not finish")
	}
}

func TestWorkshopUpdateCheckBatchKeepsPinnedLine(t *testing.T) {
	app, operation := newAPIRequestTestOperation(t, network.APILinePrimary)
	for n := 100000; n < 100401; n++ {
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
		return currentUpdateResponse(request), nil
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
		if result.Line != "primary" || result.FailedCount != 0 || result.FirstError != "" || result.TotalUpdates != 0 || oldCalls.Load() != 5 || newCalls.Load() != 0 {
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

func TestWorkshopUpdateCheckDoesNotMarkReinstalledOrReplacedCopies(t *testing.T) {
	app, op := newAPIRequestTestOperation(t, network.APILinePrimary)
	reinstalled := addUpdateCheckFixture(t, app, "17", false)
	replaced := addUpdateCheckFixture(t, app, "18", false)
	setAPIRequestTestTransport(op, workshopRoundTripFunc(func(r *http.Request) (*http.Response, error) {
		for path, id := range map[string]string{reinstalled: "17", replaced: "19"} {
			meta := WorkshopMeta{WorkshopID: id, DownloadedAt: time.Unix(1800000000, 0).UTC().Format(time.RFC3339)}
			if path == replaced {
				meta.DownloadedAt = time.Unix(1500000000, 0).UTC().Format(time.RFC3339)
			}
			if err := writeWorkshopMeta(path, meta); err != nil {
				return nil, err
			}
		}
		return workshopJSONResponse(r, `{"items":[{"publishedfileid":"17","result":1,"time_updated":1700000000},{"publishedfileid":"18","result":1,"time_updated":1700000000}]}`), nil
	}))
	got := app.checkModUpdatesWithOperation(op)
	if got.TotalUpdates != 0 || got.NewDetected != 0 || got.FailedCount != 0 || got.UnavailableCount != 0 {
		t.Fatal(got)
	}
	for _, path := range []string{reinstalled, replaced} {
		meta, err := LoadWorkshopMeta(path)
		if err != nil || meta == nil || meta.TimeUpdated != "" {
			t.Fatalf("%s modified: %+v %v", path, meta, err)
		}
	}
}
