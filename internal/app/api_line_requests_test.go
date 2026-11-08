package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"vpk-manager/internal/network"
)

// Each fixture replaces every client transport, so these tests cannot contact
// either production line even when asserting its failure behavior.
func newAPIRequestTestOperation(t *testing.T, line network.APILine) (*App, apiOperation) {
	t.Helper()
	clearWorkshopDetailTestCache()
	t.Cleanup(clearWorkshopDetailTestCache)
	app := newConfigTestApp(t)
	app.workshopPreferredIP = false
	if err := app.SetAPILine(string(line)); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { network.GlobalIPSelector.SetAPILine(network.APILinePrimary) })
	operation := app.captureAPIOperation()
	operation.endpoints.WorkshopBaseURL = "https://selected.invalid/workshop"
	operation.endpoints.ParseURL = "https://selected.invalid/parse"
	operation.endpoints.MapBaseURL = "https://selected.invalid/maps/"
	return app, operation
}

func setAPIRequestTestTransport(operation apiOperation, fixture workshopRoundTripFunc) {
	operation.clients.browser.SetTransport(fixture)
	operation.clients.parser.Transport = fixture
	operation.mapClient.Transport = fixture
}

func TestAPILineRequestsPreserveProtocols(t *testing.T) {
	for _, line := range []network.APILine{network.APILinePrimary, network.APILineBackup} {
		t.Run(string(line), func(t *testing.T) {
			app, operation := newAPIRequestTestOperation(t, line)
			var paths []string
			setAPIRequestTestTransport(operation, workshopRoundTripFunc(func(request *http.Request) (*http.Response, error) {
				if request.URL.Host != "selected.invalid" {
					t.Fatalf("request escaped selected endpoint: %s", request.URL)
				}
				paths = append(paths, request.Method+" "+request.URL.Path)
				switch request.URL.Path {
				case "/workshop/list":
					want := url.Values{"page": {"3"}, "q": {"海岸 & river"}, "sort": {"recent"}, "tags": {"Campaign,Co-op"}, "filetype": {"2"}}
					if request.Method != http.MethodGet || !reflect.DeepEqual(request.URL.Query(), want) {
						t.Fatalf("list protocol: method=%s query=%v", request.Method, request.URL.Query())
					}
					return workshopJSONResponse(request, `{"response":{"publishedfiledetails":[{"publishedfileid":"17","title":"List"}],"total":21}}`), nil
				case "/workshop/detail":
					want := url.Values{"id": {"9007199254740993"}}
					if len(paths) == 3 {
						want.Set("with_previews", "1")
					}
					if request.Method != http.MethodGet || !reflect.DeepEqual(request.URL.Query(), want) {
						t.Fatalf("detail protocol: method=%s query=%v", request.Method, request.URL.Query())
					}
					return workshopJSONResponse(request, `{"response":{"publishedfiledetails":[{"publishedfileid":"9007199254740993","title":"Detail"}]}}`), nil
				case "/parse":
					body, err := io.ReadAll(request.Body)
					if err != nil {
						t.Fatal(err)
					}
					if request.Method != http.MethodPost || request.Header.Get("Content-Type") != "application/json" || request.URL.RawQuery != "" || string(body) != `["9007199254740993","18446744073709551615"]` {
						t.Fatalf("parser protocol: method=%s content-type=%q query=%q body=%s", request.Method, request.Header.Get("Content-Type"), request.URL.RawQuery, body)
					}
					return workshopJSONResponse(request, `[{"result":1,"publishedfileid":"9007199254740993"},{"result":1,"publishedfileid":"18446744073709551615"}]`), nil
				case "/maps/c1m1_hotel":
					if request.Method != http.MethodGet || request.URL.RawQuery != "" {
						t.Fatalf("map protocol: method=%s query=%q", request.Method, request.URL.RawQuery)
					}
					return workshopJSONResponse(request, "  死亡中心\n"), nil
				default:
					t.Fatalf("unexpected endpoint %s", request.URL)
					return nil, errors.New("unexpected request")
				}
			}))

			list, err := app.fetchWorkshopListWithOperation(operation, WorkshopQueryOptions{Page: 3, SearchText: "海岸 & river", Sort: "recent", Tags: []string{"Campaign", "Co-op"}, FileType: "2"})
			if err != nil || list.Total != 21 || len(list.Items) != 1 || list.Items[0].PublishedFileId != "17" {
				t.Fatalf("list result=%+v err=%v", list, err)
			}
			for _, previews := range []bool{false, true} {
				detail, err := app.fetchWorkshopDetailRawWithOperation(operation, "9007199254740993", true, previews)
				if err != nil || detail.Title != "Detail" {
					t.Fatalf("detail result=%+v err=%v", detail, err)
				}
			}
			details, err := app.fetchWorkshopDetailsWithOperation(operation, `["0009007199254740993",18446744073709551615]`)
			if err != nil || len(details) != 2 || details[1].PublishedFileId != "18446744073709551615" {
				t.Fatalf("parser result=%+v err=%v", details, err)
			}
			name, err := app.getMapNameWithOperation(operation, "c1m1_hotel")
			if err != nil || name != "死亡中心" {
				t.Fatalf("map result=%q err=%v", name, err)
			}
			if len(paths) != 5 {
				t.Fatalf("expected exactly five requests, got %v", paths)
			}
		})
	}
}

func TestAPILineRequestsFailOnceWithoutFallbackOrAddressLeak(t *testing.T) {
	apis := []struct {
		name string
		call func(*App, apiOperation) error
	}{
		{"list", func(a *App, op apiOperation) error {
			_, err := a.fetchWorkshopListWithOperation(op, WorkshopQueryOptions{Page: 1})
			return err
		}},
		{"detail", func(a *App, op apiOperation) error {
			_, err := a.fetchWorkshopDetailRawWithOperation(op, "17", true, false)
			return err
		}},
		{"parse", func(a *App, op apiOperation) error {
			_, err := a.fetchWorkshopDetailsWithOperation(op, `[17]`)
			return err
		}},
		{"map", func(a *App, op apiOperation) error {
			_, err := a.getMapNameWithOperation(op, "c1m1_hotel")
			return err
		}},
	}
	for _, line := range []network.APILine{network.APILinePrimary, network.APILineBackup} {
		for _, api := range apis {
			for _, status := range []int{429, 500, 504, 0} {
				t.Run(fmt.Sprintf("%s/%s/%d", line, api.name, status), func(t *testing.T) {
					app, operation := newAPIRequestTestOperation(t, line)
					calls := 0
					setAPIRequestTestTransport(operation, workshopRoundTripFunc(func(request *http.Request) (*http.Response, error) {
						calls++
						if request.URL.Host != "selected.invalid" {
							t.Fatalf("request changed endpoint: %s", request.URL)
						}
						if status == 0 {
							return nil, errors.New("dial tcp 203.0.113.17:443: selected.invalid failed")
						}
						response := workshopJSONResponse(request, `{"error":"private.invalid 203.0.113.17"}`)
						response.StatusCode = status
						response.Header.Set("Retry-After", "https://private.invalid/203.0.113.17")
						return response, nil
					}))
					err := api.call(app, operation)
					if err == nil {
						t.Fatal("expected selected line failure")
					}
					if calls != 1 {
						t.Fatalf("failed request was retried or rerouted: calls=%d err=%v", calls, err)
					}
					if !strings.Contains(err.Error(), network.APILineLabel(line)) {
						t.Fatalf("error does not identify selected line: %v", err)
					}
					for _, forbidden := range []string{"selected.invalid", "private.invalid", "203.0.113.17", "https://"} {
						if strings.Contains(err.Error(), forbidden) {
							t.Fatalf("displayed error leaked address %q: %v", forbidden, err)
						}
					}
				})
			}
		}
	}
}

func TestAPILineRequestsSeparateCacheAcrossLineAndGeneration(t *testing.T) {
	app, old := newAPIRequestTestOperation(t, network.APILinePrimary)
	oldCalls := 0
	cacheFixture := func(title string, calls *int, wantHost string) workshopRoundTripFunc {
		return func(request *http.Request) (*http.Response, error) {
			(*calls)++
			if request.URL.Host != wantHost {
				t.Fatalf("operation moved to another endpoint: %s", request.URL)
			}
			return workshopJSONResponse(request, fmt.Sprintf(`{"response":{"publishedfiledetails":[{"publishedfileid":"17","title":%q}],"total":1}}`, title)), nil
		}
	}
	setAPIRequestTestTransport(old, cacheFixture("old primary", &oldCalls, "selected.invalid"))
	if err := app.SetAPILine(string(network.APILineBackup)); err != nil {
		t.Fatal(err)
	}
	current := app.captureAPIOperation()
	current.endpoints.WorkshopBaseURL = "https://backup.invalid/workshop"
	currentCalls := 0
	setAPIRequestTestTransport(current, cacheFixture("current backup", &currentCalls, "backup.invalid"))
	if old.cachePrefix() == current.cachePrefix() {
		t.Fatal("line change did not separate cache namespaces")
	}
	readBoth := func(operation apiOperation, want string) {
		t.Helper()
		list, err := app.fetchWorkshopListWithOperation(operation, WorkshopQueryOptions{Page: 1})
		if err != nil || len(list.Items) != 1 || list.Items[0].Title != want {
			t.Fatalf("list cache result=%+v want=%q err=%v", list, want, err)
		}
		detail, err := app.fetchWorkshopDetailRawWithOperation(operation, "17", false, false)
		if err != nil || detail.Title != want {
			t.Fatalf("detail cache result=%+v want=%q err=%v", detail, want, err)
		}
	}
	readBoth(current, "current backup")
	// The previously captured request finishes after the new line's cache is
	// already populated, and must still use its own endpoint and namespace.
	readBoth(old, "old primary")
	readBoth(current, "current backup")
	readBoth(old, "old primary")
	if oldCalls < 2 || currentCalls != 2 {
		t.Fatalf("unexpected cache requests: old=%d current=%d", oldCalls, currentCalls)
	}
	if err := app.SetAPILine(string(network.APILinePrimary)); err != nil {
		t.Fatal(err)
	}
	newest := app.captureAPIOperation()
	newest.endpoints.WorkshopBaseURL = "https://primary-again.invalid/workshop"
	newestCalls := 0
	setAPIRequestTestTransport(newest, cacheFixture("new primary", &newestCalls, "primary-again.invalid"))
	if newest.cachePrefix() == old.cachePrefix() || newest.generation <= old.generation {
		t.Fatal("returning to the primary reused an earlier cache generation")
	}
	readBoth(newest, "new primary")
	if newestCalls != 2 {
		t.Fatalf("returning to primary reused stale cache: calls=%d", newestCalls)
	}
}

func TestAPILineRequestsRespectPerRequestBudgets(t *testing.T) {
	for _, line := range []network.APILine{network.APILinePrimary, network.APILineBackup} {
		t.Run(string(line), func(t *testing.T) {
			app, operation := newAPIRequestTestOperation(t, line)
			setAPIRequestTestTransport(operation, workshopRoundTripFunc(func(request *http.Request) (*http.Response, error) {
				want := 30 * time.Second
				if strings.HasPrefix(request.URL.Path, "/maps/") {
					want = 2 * time.Second
				}
				if line == network.APILineBackup {
					want = 12 * time.Second
				}
				deadline, ok := request.Context().Deadline()
				remaining := time.Until(deadline)
				if !ok || remaining <= 0 || remaining > want+100*time.Millisecond {
					t.Fatalf("%s request deadline=%v remaining=%v want at most %v", request.URL.Path, ok, remaining, want)
				}
				if line == network.APILineBackup && remaining <= 10*time.Second {
					t.Fatalf("backup request cannot wait for the server's 10s deadline: %v", remaining)
				}
				switch request.URL.Path {
				case "/parse":
					return workshopJSONResponse(request, `[{"result":1,"publishedfileid":"17"}]`), nil
				case "/maps/c1m1_hotel":
					return workshopJSONResponse(request, "Hotel"), nil
				default:
					return workshopJSONResponse(request, `{"response":{"publishedfiledetails":[{"publishedfileid":"17"}],"total":1}}`), nil
				}
			}))
			if _, err := app.fetchWorkshopListWithOperation(operation, WorkshopQueryOptions{Page: 1}); err != nil {
				t.Fatal(err)
			}
			if _, err := app.fetchWorkshopDetailRawWithOperation(operation, "17", true, false); err != nil {
				t.Fatal(err)
			}
			if _, err := app.fetchWorkshopDetailsWithOperation(operation, `[17]`); err != nil {
				t.Fatal(err)
			}
			if _, err := app.getMapNameWithOperation(operation, "c1m1_hotel"); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestAPILineRequestsBatchLargeParseWithoutLosingIDs(t *testing.T) {
	app, operation := newAPIRequestTestOperation(t, network.APILineBackup)
	// A collection's total operation may outlive one request's 12s budget.
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	operation.ctx = ctx
	const count = 1001
	want := make([]string, count)
	input := make([]json.RawMessage, count)
	for index := range want {
		want[index] = strconv.FormatUint(uint64(9007199254740993)+uint64(index), 10)
		input[index] = json.RawMessage(want[index])
		if index%2 != 0 {
			input[index] = json.RawMessage(strconv.Quote(want[index]))
		}
	}
	input[count-1] = json.RawMessage("18446744073709551615")
	want[count-1] = "18446744073709551615"
	payload, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	var batchSizes []int
	setAPIRequestTestTransport(operation, workshopRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.Method != http.MethodPost || request.URL.String() != operation.endpoints.ParseURL {
			t.Fatalf("batch changed route or method: %s %s", request.Method, request.URL)
		}
		deadline, ok := request.Context().Deadline()
		if remaining := time.Until(deadline); !ok || remaining <= 10*time.Second || remaining > 12*time.Second+100*time.Millisecond {
			t.Fatalf("batch request has wrong budget: deadline=%v remaining=%v", ok, remaining)
		}
		var batch []json.RawMessage
		if err := json.NewDecoder(request.Body).Decode(&batch); err != nil {
			t.Fatal(err)
		}
		batchSizes = append(batchSizes, len(batch))
		if len(batch) < 1 || len(batch) > 100 {
			t.Fatalf("parser request exceeds 100 IDs: %d", len(batch))
		}
		result := make([]WorkshopFileDetails, len(batch))
		for index, raw := range batch {
			if len(raw) == 0 || raw[0] != '"' {
				t.Fatalf("numeric ID would lose precision in a JavaScript Worker: %s", raw)
			}
			id := string(raw)
			if len(id) > 0 && id[0] == '"' {
				if err := json.Unmarshal(raw, &id); err != nil {
					t.Fatal(err)
				}
			}
			got = append(got, id)
			result[index] = WorkshopFileDetails{Result: 1, PublishedFileId: id}
		}
		body, err := json.Marshal(result)
		if err != nil {
			t.Fatal(err)
		}
		return workshopJSONResponse(request, string(body)), nil
	}))
	details, err := app.fetchWorkshopDetailsWithOperation(operation, string(payload))
	if err != nil {
		t.Fatal(err)
	}
	if len(batchSizes) != 11 || batchSizes[10] != 1 || !reflect.DeepEqual(got, want) || len(details) != count {
		t.Fatalf("incorrect batching/order/precision: batches=%v requestIDs=%d resultIDs=%d", batchSizes, len(got), len(details))
	}
	for index, detail := range details {
		if detail.PublishedFileId != want[index] {
			t.Fatalf("response order changed at %d: got=%q want=%q", index, detail.PublishedFileId, want[index])
		}
	}
	if deadline, ok := operation.ctx.Deadline(); !ok || time.Until(deadline) <= 10*time.Second {
		t.Fatal("a batch's request deadline replaced the collection operation budget")
	}
}

func TestAPILineRequestsRejectInvalidParseIDsBeforeAnyBatch(t *testing.T) {
	for _, line := range []network.APILine{network.APILinePrimary, network.APILineBackup} {
		t.Run(string(line), func(t *testing.T) {
			app, operation := newAPIRequestTestOperation(t, line)
			calls := 0
			setAPIRequestTestTransport(operation, workshopRoundTripFunc(func(request *http.Request) (*http.Response, error) {
				calls++
				return workshopJSONResponse(request, `[]`), nil
			}))
			for _, payload := range []string{
				"", `[]`, `null`, `{}`, `true`, `[`, `[0]`, `["0"]`, `["000"]`,
				`[-1]`, `["-1"]`, `[1.0]`, `[1e3]`, `["+1"]`, `[" 1"]`, `["1 "]`,
				`[""]`, `["１２"]`, `[true]`, `[null]`, `[{}]`, `[[]]`,
				`[18446744073709551616]`, `["18446744073709551616"]`, `[1] trailing`,
				"[" + strings.Repeat("17,", 100) + "0]",
			} {
				if details, err := app.fetchWorkshopDetailsWithOperation(operation, payload); err == nil || len(details) != 0 {
					t.Errorf("accepted invalid payload %q: details=%v err=%v", payload, details, err)
				}
			}
			if calls != 0 {
				t.Fatalf("invalid input sent %d requests before validation completed", calls)
			}
		})
	}
}

func TestAPILineRequestsPublicCollectionsKeepCapturedLineAfterSwitch(t *testing.T) {
	for _, grouped := range []bool{false, true} {
		t.Run(fmt.Sprintf("grouped=%t", grouped), func(t *testing.T) {
			app, old := newAPIRequestTestOperation(t, network.APILineBackup)
			var batches [][]json.RawMessage
			otherLineCalls := 0
			setAPIRequestTestTransport(old, workshopRoundTripFunc(func(request *http.Request) (*http.Response, error) {
				if request.URL.String() != network.EndpointsForAPILine(network.APILineBackup).ParseURL {
					t.Fatalf("collection moved to another endpoint: %s", request.URL)
				}
				deadline, ok := request.Context().Deadline()
				if remaining := time.Until(deadline); !ok || remaining <= 10*time.Second || remaining > 12*time.Second+100*time.Millisecond {
					t.Fatalf("collection was limited by a 10s overall deadline: remaining=%v deadline=%v", remaining, ok)
				}
				var ids []json.RawMessage
				if err := json.NewDecoder(request.Body).Decode(&ids); err != nil {
					t.Fatal(err)
				}
				batches = append(batches, ids)
				if len(batches) == 1 {
					// Switch while the first root request is still in flight. All
					// children and later roots belong to its captured operation.
					if err := app.SetAPILine(string(network.APILinePrimary)); err != nil {
						t.Fatal(err)
					}
					current := app.captureAPIOperation()
					setAPIRequestTestTransport(current, workshopRoundTripFunc(func(request *http.Request) (*http.Response, error) {
						otherLineCalls++
						return nil, errors.New("collection used newly selected line")
					}))
					return workshopJSONResponse(request, `[{"result":1,"publishedfileid":"123456","file_type":2,"children":[{"publishedfileid":"234567"},{"publishedfileid":"345678"}]}]`), nil
				}
				if len(ids) == 2 {
					return workshopJSONResponse(request, `[{"result":1,"publishedfileid":"234567","file_url":"fixture-a"},{"result":1,"publishedfileid":"345678","file_url":"fixture-b"}]`), nil
				}
				return workshopJSONResponse(request, `[{"result":1,"publishedfileid":"456789","file_url":"fixture-c"}]`), nil
			}))
			if grouped {
				result, err := app.GetWorkshopDetailsGrouped("123456,456789")
				if err != nil || len(result.Groups) != 2 || len(result.Groups[0].Items) != 3 {
					t.Fatalf("grouped collection result=%+v err=%v", result, err)
				}
			} else {
				result, err := app.GetWorkshopDetails("123456")
				if err != nil || len(result) != 3 {
					t.Fatalf("legacy collection result=%+v err=%v", result, err)
				}
			}
			wantBatches := 2
			if grouped {
				wantBatches = 3
			}
			if len(batches) != wantBatches || otherLineCalls != 0 || app.GetAPILine() != string(network.APILinePrimary) {
				t.Fatalf("collection snapshot failed: batches=%d otherLineCalls=%d setting=%s", len(batches), otherLineCalls, app.GetAPILine())
			}
		})
	}
}
