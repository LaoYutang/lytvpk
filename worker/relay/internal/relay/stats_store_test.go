package relay

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	_ "github.com/glebarez/go-sqlite"
)

func openStatsSQLite(t *testing.T, path string, mode string) *sql.DB {
	t.Helper()
	query := url.Values{"mode": {mode}, "_pragma": {"busy_timeout(100)", "foreign_keys(1)"}}
	if mode == "ro" {
		query.Add("_pragma", "query_only(1)")
	}
	dsn := (&url.URL{Scheme: "file", Path: path, RawQuery: query.Encode()}).String()
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = db.Close() })
	if err := db.Ping(); err != nil {
		t.Fatal(err)
	}
	return db
}

func execStatsSQLite(t *testing.T, path string, query string, args ...any) {
	t.Helper()
	db := openStatsSQLite(t, path, "rw")
	defer db.Close()
	if _, err := db.Exec(query, args...); err != nil {
		t.Fatal(err)
	}
}

func persistenceState(t *testing.T, s *stats) map[string]any {
	t.Helper()
	state, ok := statsJSON(t, s.snapshot())["persistence"].(map[string]any)
	if !ok {
		t.Fatal("snapshot is missing persistence status")
	}
	return state
}

func startStatsMaintenance(t *testing.T, s *stats) func() {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	var wg sync.WaitGroup
	wg.Go(func() { s.runPersistence(ctx, 5*time.Millisecond) })
	var once sync.Once
	stop := func() { once.Do(func() { cancel(); wg.Wait() }) }
	t.Cleanup(stop)
	deadline := time.Now().Add(3 * time.Second)
	for persistenceState(t, s)["ready"] != true {
		if time.Now().After(deadline) {
			stop()
			t.Fatalf("maintenance did not finish loading: %#v", persistenceState(t, s))
		}
		time.Sleep(time.Millisecond)
	}
	return stop
}

func persistentEstimate(t *testing.T, s *stats, field string) float64 {
	t.Helper()
	users, ok := statsJSON(t, s.snapshot())[field].(map[string]any)
	if !ok {
		t.Fatalf("snapshot is missing %s", field)
	}
	return statsNumber(t, users, "estimate")
}

func assertPersistentCounts(t *testing.T, s *stats, total, forwarded, failures float64) {
	t.Helper()
	values := statsJSON(t, s.snapshot())
	for name, want := range map[string]float64{
		"total_requests": total, "forwarded_requests": forwarded, "upstream_failures": failures,
	} {
		if got := statsNumber(t, values, name); got != want {
			t.Errorf("%s=%v, want %v", name, got, want)
		}
	}
}

func createStatsFile(t *testing.T, path string) {
	t.Helper()
	s := newPersistentStats(path)
	now := time.Now()
	s.record("list", 200, true, false, s.userKey("198.51.100.77", now), now)
	stop := startStatsMaintenance(t, s)
	stop()
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("final flush did not create statistics file: %v, state=%#v", err, persistenceState(t, s))
	}
}

func TestPersistentStatsConstructorDefersFileAccess(t *testing.T) {
	path := filepath.Join(t.TempDir(), "corrupt.db")
	const original = "not valid JSON"
	if err := os.WriteFile(path, []byte(original), 0600); err != nil {
		t.Fatal(err)
	}
	s := newPersistentStats(path)
	state := persistenceState(t, s)
	if state["enabled"] != true || state["ready"] != false {
		t.Fatalf("constructor loaded or disabled persistence: %#v", state)
	}
	if value := state["load_error"]; value != nil && value != "" {
		t.Fatalf("constructor attempted to decode the file: %#v", state)
	}
	if statsJSON(t, s.snapshot())["resets_on_restart"] != true {
		t.Fatal("unloaded statistics incorrectly promise restart durability")
	}
	data, err := os.ReadFile(path)
	if err != nil || string(data) != original {
		t.Fatalf("constructor changed existing file: data=%q err=%v", data, err)
	}
}

func TestPersistentStatsRestoresAndMergesRequestsReceivedBeforeLoad(t *testing.T) {
	path := filepath.Join(t.TempDir(), "stats.db")
	createStatsFile(t, path)
	s := newPersistentStats(path)
	now := time.Now()
	// The first address was already present in the previous process. These
	// requests deliberately arrive before the maintenance worker loads its seed.
	s.record("detail", 429, false, false, s.userKey("198.51.100.77", now), now)
	s.record("parse", 503, true, true, s.userKey("2001:db8::77", now), now)
	stop := startStatsMaintenance(t, s)
	assertPersistentCounts(t, s, 3, 2, 1)
	if persistenceState(t, s)["restored"] != true {
		t.Fatalf("existing file was not restored: %#v", persistenceState(t, s))
	}
	if statsJSON(t, s.snapshot())["resets_on_restart"] != false {
		t.Fatal("restored statistics incorrectly claim every restart resets totals")
	}
	s.record("list", 200, true, false, s.userKey("198.51.100.77", now), now)
	assertPersistentCounts(t, s, 4, 3, 1)
	for _, field := range []string{"anonymous_users", "cumulative_anonymous_users"} {
		if estimate := persistentEstimate(t, s, field); estimate != 2 {
			t.Errorf("%s counted one address twice across startup: %v", field, estimate)
		}
	}
	daily, ok := statsJSON(t, s.snapshot())["daily"].(map[string]any)
	if !ok || statsNumber(t, daily, "total_requests") != 4 {
		t.Fatalf("same-day request counts did not restore: %#v", daily)
	}
	stop()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Errorf("statistics mode=%v, want 0600", info.Mode().Perm())
	}
	if info.Size() > 2<<20 {
		t.Errorf("statistics database exceeds 2 MiB: %d", info.Size())
	}

	restored := newPersistentStats(path)
	stopRestored := startStatsMaintenance(t, restored)
	assertPersistentCounts(t, restored, 4, 3, 1)
	restored.record("list", 200, true, false, restored.userKey("198.51.100.77", now), now)
	for _, field := range []string{"anonymous_users", "cumulative_anonymous_users"} {
		if estimate := persistentEstimate(t, restored, field); estimate != 2 {
			t.Errorf("%s did not retain its stable seed: %v", field, estimate)
		}
	}
	stopRestored()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := json.Marshal(restored.snapshot())
	if err != nil {
		t.Fatal(err)
	}
	for _, ip := range []string{"198.51.100.77", "2001:db8::77"} {
		if strings.Contains(string(data), ip) || strings.Contains(string(snapshot), ip) {
			t.Errorf("raw address leaked to persistent statistics: %q", ip)
		}
		fingerprint := sha256.Sum256([]byte(ip))
		if strings.Contains(string(data), hex.EncodeToString(fingerprint[:])) || strings.Contains(string(snapshot), hex.EncodeToString(fingerprint[:])) {
			t.Errorf("startup intermediate fingerprint was retained: %q", ip)
		}
	}
	if strings.Contains(string(snapshot), `"seed"`) {
		t.Error("private seed was exported in management statistics")
	}
	db := openStatsSQLite(t, path, "ro")
	var seed []byte
	if err := db.QueryRow("SELECT value FROM meta WHERE key = 'seed'").Scan(&seed); err != nil {
		t.Fatal(err)
	}
	if len(seed) != 32 || strings.Contains(string(snapshot), hex.EncodeToString(seed)) || strings.Contains(string(snapshot), base64.StdEncoding.EncodeToString(seed)) {
		t.Error("persistent private seed is absent or leaked through a differently named snapshot field")
	}
}

func TestPersistentStatsDailyRotationKeepsBoundedHistoryAndCumulativeUsers(t *testing.T) {
	s := newStats()
	day := time.Now().UTC().Truncate(24 * time.Hour)
	for i := range 41 {
		now := day.AddDate(0, 0, i)
		s.record("list", 200, true, false, s.userKey("198.51.100.90", now), now)
	}
	values := statsJSON(t, s.snapshot())
	history, ok := values["history"].([]any)
	if !ok || len(history) != 30 {
		t.Fatalf("completed-day history must retain only 30 days: %#v", values["history"])
	}
	daily, ok := values["daily"].(map[string]any)
	if !ok || statsNumber(t, daily, "total_requests") != 1 {
		t.Fatalf("daily counters did not reset: %#v", values["daily"])
	}
	assertPersistentCounts(t, s, 41, 41, 0)
	for _, field := range []string{"anonymous_users", "cumulative_anonymous_users"} {
		if estimate := persistentEstimate(t, s, field); estimate != 1 {
			t.Errorf("%s must estimate addresses, not summed daily uniques: %v", field, estimate)
		}
	}
}

func TestPersistentStatsRejectsUnsafeAndMalformedFilesWithoutLosingLiveCounts(t *testing.T) {
	for _, kind := range []string{"legacy-json", "corrupt-sqlite", "oversized", "directory", "symlink", "schema", "version"} {
		t.Run(kind, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "stats.db")
			var target string
			switch kind {
			case "legacy-json":
				if err := os.WriteFile(path, []byte("{broken"), 0600); err != nil {
					t.Fatal(err)
				}
			case "corrupt-sqlite":
				if err := os.WriteFile(path, []byte("SQLite format 3\x00broken"), 0600); err != nil {
					t.Fatal(err)
				}
			case "oversized":
				if err := os.WriteFile(path, []byte(strings.Repeat(" ", (2<<20)+1)), 0600); err != nil {
					t.Fatal(err)
				}
			case "directory":
				if err := os.Mkdir(path, 0700); err != nil {
					t.Fatal(err)
				}
			case "symlink":
				target = filepath.Join(dir, "target.db")
				if err := os.WriteFile(target, []byte("preserve this target"), 0600); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(target, path); err != nil {
					t.Skipf("symbolic links unavailable: %v", err)
				}
			case "schema", "version":
				createStatsFile(t, path)
				if kind == "schema" {
					execStatsSQLite(t, path, "DROP TABLE sketches")
				} else {
					execStatsSQLite(t, path, "PRAGMA user_version = 999")
				}
			}
			var original []byte
			if kind != "symlink" && kind != "directory" {
				var err error
				original, err = os.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}
			}
			s := newPersistentStats(path)
			now := time.Now()
			s.record("detail", 400, false, false, s.userKey("198.51.100.91", now), now)
			stop := startStatsMaintenance(t, s)
			if value := persistenceState(t, s)["load_error"]; value == nil || value == "" {
				t.Fatalf("unsafe %s file was accepted: %#v", kind, persistenceState(t, s))
			}
			assertPersistentCounts(t, s, 1, 0, 0)
			s.record("detail", 400, false, false, s.userKey("198.51.100.91", now), now)
			assertPersistentCounts(t, s, 2, 0, 0)
			stop()
			if value := fmt.Sprint(persistenceState(t, s)["save_error"]); !strings.Contains(value, "paused") {
				t.Fatalf("writes were not paused after %s load failure: %#v", kind, persistenceState(t, s))
			}
			if original != nil {
				data, err := os.ReadFile(path)
				if err != nil || !bytes.Equal(data, original) {
					t.Fatalf("unreadable %s store was overwritten: err=%v", kind, err)
				}
			}
			if kind == "directory" || kind == "symlink" {
				info, err := os.Lstat(path)
				if err != nil || (kind == "directory" && !info.IsDir()) || (kind == "symlink" && info.Mode()&os.ModeSymlink == 0) {
					t.Fatalf("unsafe %s destination was replaced: err=%v", kind, err)
				}
			}
			if target != "" {
				data, err := os.ReadFile(target)
				if err != nil || string(data) != "preserve this target" {
					t.Fatalf("symbolic-link target changed: %q err=%v", data, err)
				}
			}
		})
	}
}

func TestPersistentStatsInvalidParentPausesWritesAndKeepsLiveCounts(t *testing.T) {
	parent := filepath.Join(t.TempDir(), "not-a-directory")
	const original = "administrator-owned parent file"
	if err := os.WriteFile(parent, []byte(original), 0600); err != nil {
		t.Fatal(err)
	}
	s := newPersistentStats(filepath.Join(parent, "stats.db"))
	now := time.Now()
	s.record("detail", 400, false, false, s.userKey("198.51.100.93", now), now)
	stop := startStatsMaintenance(t, s)
	state := persistenceState(t, s)
	if value := state["load_error"]; value == nil || value == "" {
		t.Fatalf("invalid parent was not reported: %#v", state)
	}
	s.record("list", 200, true, false, s.userKey("198.51.100.93", now), now)
	assertPersistentCounts(t, s, 2, 1, 0)
	stop()
	if value := fmt.Sprint(persistenceState(t, s)["save_error"]); !strings.Contains(value, "paused") {
		t.Fatalf("writes were not paused after invalid-parent load failure: %#v", persistenceState(t, s))
	}
	data, err := os.ReadFile(parent)
	if err != nil || string(data) != original {
		t.Fatalf("invalid parent changed despite paused writes: err=%v", err)
	}
}

func TestPersistentStatsSymlinkAncestorDoesNotCreateMissingDirectories(t *testing.T) {
	dir := t.TempDir()
	target := t.TempDir()
	link := filepath.Join(dir, "linked-parent")
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("symbolic links unavailable: %v", err)
	}
	s := newPersistentStats(filepath.Join(link, "missing", "stats.db"))
	stop := startStatsMaintenance(t, s)
	state := persistenceState(t, s)
	if value := state["load_error"]; value == nil || value == "" {
		t.Fatalf("symbolic-link ancestor was accepted: %#v", state)
	}
	stop()
	if value := fmt.Sprint(persistenceState(t, s)["save_error"]); !strings.Contains(value, "paused") {
		t.Fatalf("writes were not paused after symbolic-link ancestor failure: %#v", persistenceState(t, s))
	}
	if _, err := os.Lstat(filepath.Join(target, "missing")); !os.IsNotExist(err) {
		t.Fatalf("background persistence created a directory through a symbolic-link ancestor: %v", err)
	}
}

func TestPersistentStatsPermissionFailureDoesNotStopCounters(t *testing.T) {
	dir := t.TempDir()
	if err := os.Chmod(dir, 0500); err != nil {
		t.Skipf("permissions cannot be configured: %v", err)
	}
	t.Cleanup(func() { _ = os.Chmod(dir, 0700) })
	probe := filepath.Join(dir, "probe")
	if file, err := os.OpenFile(probe, os.O_CREATE|os.O_WRONLY, 0600); err == nil {
		_ = file.Close()
		_ = os.Remove(probe)
		t.Skip("current user bypasses directory write permissions")
	}
	s := newPersistentStats(filepath.Join(dir, "stats.db"))
	stop := startStatsMaintenance(t, s)
	now := time.Now()
	s.record("detail", 429, false, false, s.userKey("198.51.100.92", now), now)
	stop()
	if value := persistenceState(t, s)["save_error"]; value == nil || value == "" {
		t.Fatalf("permission error was not reported: %#v", persistenceState(t, s))
	}
	assertPersistentCounts(t, s, 1, 0, 0)
}

func TestPersistentStatsConcurrentRecordsSurviveFinalFlush(t *testing.T) {
	path := filepath.Join(t.TempDir(), "stats.db")
	s := newPersistentStats(path)
	stop := startStatsMaintenance(t, s)
	var wg sync.WaitGroup
	for i := range 20 {
		wg.Go(func() {
			now := time.Now()
			key := s.userKey(fmt.Sprintf("198.51.100.%d", i+1), now)
			for range 100 {
				s.record("list", 200, true, false, key, now)
				_ = s.snapshot()
			}
		})
	}
	wg.Wait()
	stop()
	assertPersistentCounts(t, s, 2000, 2000, 0)
	restored := newPersistentStats(path)
	stopRestored := startStatsMaintenance(t, restored)
	assertPersistentCounts(t, restored, 2000, 2000, 0)
	stopRestored()
}

func TestPersistentStatsPendingUsersAreBoundedWithoutLosingCalls(t *testing.T) {
	s := newPersistentStats(filepath.Join(t.TempDir(), "stats.db"))
	now := time.Now()
	const requests = 5000
	for i := range requests {
		key := s.userKey(fmt.Sprintf("2001:db8::%x", i+1), now)
		s.record("list", 200, true, false, key, now)
	}
	s.mu.Lock()
	pending := len(s.pendingUsers)
	s.mu.Unlock()
	if pending > 4096 {
		t.Fatalf("startup identities grew without bound: %d", pending)
	}
	stop := startStatsMaintenance(t, s)
	assertPersistentCounts(t, s, requests, requests, 0)
	values := statsJSON(t, s.snapshot())
	for _, field := range []string{"anonymous_users", "cumulative_anonymous_users"} {
		users := values[field].(map[string]any)
		if users["incomplete"] != true {
			t.Errorf("%s hid its startup capacity loss: %#v", field, users)
		}
		if estimate := statsNumber(t, users, "estimate"); estimate < 3800 || estimate > 4400 {
			t.Errorf("%s did not replay the retained pending identities: %v", field, estimate)
		}
	}
	stop()
}

func TestPersistentStatsRejectsInvalidSQLiteRows(t *testing.T) {
	mutations := map[string]func(*testing.T, string){
		"short-seed": func(t *testing.T, path string) {
			execStatsSQLite(t, path, "UPDATE meta SET value = ? WHERE key = 'seed'", []byte{1})
		},
		"short-daily-bitmap": func(t *testing.T, path string) {
			execStatsSQLite(t, path, "PRAGMA ignore_check_constraints=ON; UPDATE sketches SET bits = x'01' WHERE kind = 'daily'")
		},
		"short-cumulative-bitmap": func(t *testing.T, path string) {
			execStatsSQLite(t, path, "PRAGMA ignore_check_constraints=ON; UPDATE sketches SET bits = x'01' WHERE kind = 'cumulative'")
		},
		"too-many-route-labels": func(t *testing.T, path string) {
			db := openStatsSQLite(t, path, "rw")
			defer db.Close()
			for i := range 33 {
				if _, err := db.Exec("INSERT INTO route_counts(route, count) VALUES (?, '1')", fmt.Sprintf("label-%d", i)); err != nil {
					t.Fatal(err)
				}
			}
		},
		"inconsistent-label-counts": func(t *testing.T, path string) {
			execStatsSQLite(t, path, "UPDATE route_counts SET count = '0'")
		},
		"future-daily-row": func(t *testing.T, path string) {
			execStatsSQLite(t, path, "UPDATE daily SET day = ?", time.Now().UTC().AddDate(0, 0, 1).Format("2006-01-02"))
		},
		"invalid-unsigned-counter": func(t *testing.T, path string) {
			execStatsSQLite(t, path, "UPDATE cumulative SET total_requests = '-1' WHERE id = 1")
		},
	}
	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "stats.db")
			createStatsFile(t, path)
			mutate(t, path)
			original, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			s := newPersistentStats(path)
			stop := startStatsMaintenance(t, s)
			if value := persistenceState(t, s)["load_error"]; value == nil || value == "" {
				t.Fatalf("invalid SQLite rows were restored: %#v", persistenceState(t, s))
			}
			if value := persistenceState(t, s)["restored"]; value == true {
				t.Fatalf("invalid rows were marked restored: %#v", persistenceState(t, s))
			}
			stop()
			if value := fmt.Sprint(persistenceState(t, s)["save_error"]); !strings.Contains(value, "paused") {
				t.Fatalf("writes were not paused after invalid rows: %#v", persistenceState(t, s))
			}
			preserved, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(preserved, original) {
				t.Fatalf("invalid database was overwritten: err=%v", err)
			}
		})
	}
}

func TestPersistentStatsSQLiteSchemaAndBounds(t *testing.T) {
	path := filepath.Join(t.TempDir(), "stats.db")
	createStatsFile(t, path)
	raw, err := os.ReadFile(path)
	if err != nil || len(raw) < 16 || string(raw[:16]) != "SQLite format 3\x00" {
		t.Fatalf("statistics file is not a real SQLite database: err=%v", err)
	}
	db := openStatsSQLite(t, path, "ro")
	var version, pageSize, pageCount int
	for query, dst := range map[string]*int{"PRAGMA user_version": &version, "PRAGMA page_size": &pageSize, "PRAGMA page_count": &pageCount} {
		if err := db.QueryRow(query).Scan(dst); err != nil {
			t.Fatal(err)
		}
	}
	if version != 1 || pageSize != 4096 || pageCount > 512 {
		t.Fatalf("unexpected SQLite version/page bounds: version=%d size=%d count=%d", version, pageSize, pageCount)
	}
	var journal string
	if err := db.QueryRow("PRAGMA journal_mode").Scan(&journal); err != nil || strings.ToLower(journal) != "delete" {
		t.Fatalf("journal mode=%q, want DELETE: %v", journal, err)
	}
	rows, err := db.Query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
	if err != nil {
		t.Fatal(err)
	}
	tables := make(map[string]bool)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		tables[name] = true
	}
	if err := rows.Close(); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"meta", "cumulative", "daily", "route_counts", "status_counts", "sketches"} {
		if !tables[table] {
			t.Errorf("missing normalized table %q", table)
		}
	}
	if len(tables) != 6 {
		t.Errorf("unexpected extra tables: %d", len(tables))
	}
	var total, forwarded, failures string
	if err := db.QueryRow("SELECT total_requests, forwarded_requests, upstream_failures FROM cumulative WHERE id = 1").Scan(&total, &forwarded, &failures); err != nil {
		t.Fatal(err)
	}
	if total != "1" || forwarded != "1" || failures != "0" {
		t.Errorf("SQL cumulative values=(%s,%s,%s), want (1,1,0)", total, forwarded, failures)
	}
	var routeCount, statusCount string
	if err := db.QueryRow("SELECT count FROM route_counts WHERE route = 'list'").Scan(&routeCount); err != nil || routeCount != "1" {
		t.Fatalf("SQL route count=%q err=%v", routeCount, err)
	}
	if err := db.QueryRow("SELECT count FROM status_counts WHERE status = 200").Scan(&statusCount); err != nil || statusCount != "1" {
		t.Fatalf("SQL status count=%q err=%v", statusCount, err)
	}
	rows, err = db.Query("SELECT kind, length(bits) FROM sketches")
	if err != nil {
		t.Fatal(err)
	}
	sketches := make(map[string]int)
	for rows.Next() {
		var kind string
		var length int
		if err := rows.Scan(&kind, &length); err != nil {
			t.Fatal(err)
		}
		sketches[kind] = length
	}
	if err := rows.Close(); err != nil {
		t.Fatal(err)
	}
	if len(sketches) != 2 || sketches["daily"] != 65536 || sketches["cumulative"] != 65536 {
		t.Fatalf("sketches do not have fixed 64 KiB bounds: %#v", sketches)
	}
}

func TestPersistentStatsSQLiteRetainsUnsignedCountersAndThirtyDays(t *testing.T) {
	path := filepath.Join(t.TempDir(), "stats.db")
	s := newStats()
	now := time.Now()
	s.record("list", 200, true, false, s.userKey("198.51.100.95", now), now)
	data := s.captureStatsStore()
	data.Counters = statsCounters{math.MaxUint64, math.MaxUint64, math.MaxUint64}
	data.Routes = map[string]uint64{"list": math.MaxUint64}
	data.Statuses = map[int]uint64{200: math.MaxUint64}
	for i := 30; i >= 1; i-- {
		data.History = append(data.History, statsDay{Day: data.WindowStart.AddDate(0, 0, -i), statsCounters: statsCounters{1, 1, 0}, UserEstimate: 1})
	}
	if err := writeStatsStore(path, data); err != nil {
		t.Fatal(err)
	}
	db := openStatsSQLite(t, path, "ro")
	var count string
	if err := db.QueryRow("SELECT total_requests FROM cumulative WHERE id = 1").Scan(&count); err != nil || count != "18446744073709551615" {
		t.Fatalf("unsigned cumulative value=%q err=%v", count, err)
	}
	var days int
	if err := db.QueryRow("SELECT count(*) FROM daily").Scan(&days); err != nil || days != 31 {
		t.Fatalf("daily rows=%d, want current day plus 30 history rows: %v", days, err)
	}
	_ = db.Close()
	restored, err := readStatsStore(path)
	if err != nil || restored == nil || restored.Counters.TotalRequests != math.MaxUint64 || len(restored.History) != 30 {
		t.Fatalf("unsigned counters/history did not restore: err=%v", err)
	}
}
