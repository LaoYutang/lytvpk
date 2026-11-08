package relay

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"sync"
	"testing"
	"time"
)

func statsJSON(t *testing.T, value any) map[string]any {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func statsNumber(t *testing.T, values map[string]any, key string) float64 {
	t.Helper()
	value, ok := values[key].(float64)
	if !ok {
		t.Fatalf("%s is not a JSON number: %#v", key, values[key])
	}
	return value
}

func anonymousStats(t *testing.T, snapshot map[string]any) map[string]any {
	t.Helper()
	users, ok := snapshot["anonymous_users"].(map[string]any)
	if !ok {
		t.Fatalf("missing anonymous_users: %#v", snapshot)
	}
	return users
}

func TestStatsCountsOnlyRecordedServiceRequests(t *testing.T) {
	s := newStats()
	now := time.Now()
	s.record("list", 200, true, false, "anonymous-a", now)
	s.record("detail", 429, false, false, "anonymous-a", now)
	s.record("list", 503, true, true, "anonymous-b", now)
	got := statsJSON(t, s.snapshot())
	for field, want := range map[string]float64{
		"total_requests": 3, "forwarded_requests": 2, "upstream_failures": 1,
	} {
		if value := statsNumber(t, got, field); value != want {
			t.Errorf("%s = %v, want %v", field, value, want)
		}
	}
	routes, ok := got["routes"].(map[string]any)
	if !ok || routes["list"] != float64(2) || routes["detail"] != float64(1) {
		t.Fatalf("incorrect route counts: %#v", got["routes"])
	}
	statuses, ok := got["statuses"].(map[string]any)
	if !ok || statuses["200"] != float64(1) || statuses["429"] != float64(1) || statuses["503"] != float64(1) {
		t.Fatalf("incorrect status counts: %#v", got["statuses"])
	}
	if got["scope"] == "" || got["resets_on_restart"] != true {
		t.Fatalf("missing scope and restart limits: %#v", got)
	}
	users := anonymousStats(t, got)
	if estimate := statsNumber(t, users, "estimate"); estimate < 1.9 || estimate > 2.1 {
		t.Fatalf("duplicate user was counted twice, estimate=%v", estimate)
	}
}

func TestStatsSnapshotIsIndependentOfLaterRecords(t *testing.T) {
	s := newStats()
	now := time.Now()
	s.record("list", 200, true, false, "anonymous-a", now)
	snapshot := s.snapshot()
	s.record("detail", 500, true, true, "anonymous-b", now)
	got := statsJSON(t, snapshot)
	if statsNumber(t, got, "total_requests") != 1 {
		t.Fatal("previous snapshot changed after new record")
	}
	if routes := got["routes"].(map[string]any); len(routes) != 1 || routes["list"] != float64(1) {
		t.Fatalf("previous route counts changed after new record: %#v", routes)
	}
	if statuses := got["statuses"].(map[string]any); len(statuses) != 1 || statuses["200"] != float64(1) {
		t.Fatalf("previous status counts changed after new record: %#v", statuses)
	}
}

func TestStatsAnonymousEstimateAndUTCDayRotation(t *testing.T) {
	s := newStats()
	now := time.Now().UTC()
	day := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	const users = 5000
	for i := range users {
		key := fmt.Sprintf("anonymous-%d", i)
		s.record("list", 200, true, false, key, day.Add(time.Hour))
		s.record("detail", 200, true, false, key, day.Add(2*time.Hour))
	}
	got := statsJSON(t, s.snapshot())
	estimate := statsNumber(t, anonymousStats(t, got), "estimate")
	if math.Abs(estimate-users) > users*0.15 {
		t.Fatalf("anonymous estimate %v is outside 15%% of %d", estimate, users)
	}
	nextDay := day.AddDate(0, 0, 1)
	s.record("list", 200, true, false, "next-day-user", nextDay)
	got = statsJSON(t, s.snapshot())
	userStats := anonymousStats(t, got)
	if estimate := statsNumber(t, userStats, "estimate"); estimate < 0.9 || estimate > 1.1 {
		t.Fatalf("daily estimate did not rotate at UTC midnight: %v", estimate)
	}
	start, err := time.Parse(time.RFC3339, fmt.Sprint(userStats["window_start"]))
	if err != nil || !start.Equal(nextDay) {
		t.Fatalf("window_start=%v, want %v, parse error=%v", userStats["window_start"], nextDay, err)
	}
	end, err := time.Parse(time.RFC3339, fmt.Sprint(userStats["window_end"]))
	if err != nil || !end.Equal(nextDay.AddDate(0, 0, 1)) {
		t.Fatalf("window_end=%v, want next UTC midnight, parse error=%v", userStats["window_end"], err)
	}
	if userStats["method"] == "" || userStats["saturated"] != false {
		t.Fatalf("missing estimator description or wrong saturation: %#v", userStats)
	}
	if statsNumber(t, got, "total_requests") != 2*users+1 {
		t.Fatal("daily user rotation reset lifetime request counters")
	}
}

func TestStatsConcurrentRecordsAndSnapshots(t *testing.T) {
	s := newStats()
	now := time.Now()
	var wg sync.WaitGroup
	for i := range 100 {
		wg.Go(func() {
			key := fmt.Sprintf("anonymous-%d", i)
			for range 20 {
				s.record("list", 200, true, false, key, now)
				_ = s.snapshot()
			}
		})
	}
	wg.Wait()
	got := statsJSON(t, s.snapshot())
	if value := statsNumber(t, got, "total_requests"); value != 2000 {
		t.Fatalf("lost concurrent records: got %v, want 2000", value)
	}
}

func TestStatsLabelsAreBoundedAndEmptyIdentityIsNotAUser(t *testing.T) {
	s := newStats()
	now := time.Now()
	s.record("unknown", 404, false, false, "", now)
	got := statsJSON(t, s.snapshot())
	if estimate := statsNumber(t, anonymousStats(t, got), "estimate"); estimate != 0 {
		t.Fatalf("empty client identity counted as a user: %v", estimate)
	}
	const identity = "private-anonymous-identity-that-must-not-be-exposed"
	for i := range 1000 {
		s.record(fmt.Sprintf("unbounded-route-%d", i), i, false, false, identity, now)
	}
	got = statsJSON(t, s.snapshot())
	routes := got["routes"].(map[string]any)
	if len(routes) > 33 {
		t.Fatalf("route labels grew without bound: %d", len(routes))
	}
	if count, ok := routes["unknown"].(float64); !ok || count <= 1 {
		t.Fatalf("excess route labels did not collapse into unknown: %#v", routes)
	}
	statuses := got["statuses"].(map[string]any)
	if len(statuses) > 501 {
		t.Fatalf("status labels grew without bound: %d", len(statuses))
	}
	if _, ok := statuses["999"]; ok {
		t.Fatal("invalid status preserved as an arbitrary label")
	}
	if estimate := statsNumber(t, anonymousStats(t, got), "estimate"); estimate != 1 {
		t.Fatalf("same anonymous identity did not deduplicate: %v", estimate)
	}
	serialized, err := json.Marshal(s.snapshot())
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(serialized), identity) {
		t.Fatal("anonymous identity leaked in statistics JSON")
	}
}
