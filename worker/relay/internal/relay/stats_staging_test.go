package relay

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"
)

// This helper deliberately skips every Go and SQLite cleanup handler. A tiny
// cache forces dirty pages into the main database, making the surviving DELETE
// journal necessary to recover the last committed checkpoint.
func TestStatsStoreSQLiteHotJournalHelper(t *testing.T) {
	if os.Getenv("LYTVPK_TEST_HOT_JOURNAL_HELPER") != "1" {
		return
	}
	path := os.Getenv("LYTVPK_TEST_HOT_JOURNAL_DB")
	if path == "" {
		t.Fatal("helper has no database path")
	}
	db := openStatsSQLite(t, path, "rw")
	for _, statement := range []string{
		"PRAGMA synchronous=FULL",
		"PRAGMA cache_size=1",
		"PRAGMA cache_spill=ON",
		"BEGIN IMMEDIATE",
		"UPDATE sketches SET bits=randomblob(65536)",
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	journal, err := os.Stat(path + "-journal")
	if err != nil || journal.Size() < 512 {
		t.Fatalf("helper did not create a rollback journal: %v", err)
	}
	os.Exit(0)
}

func createHotStatsJournal(t *testing.T, path string) {
	t.Helper()
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	command := exec.Command(executable, "-test.run=^TestStatsStoreSQLiteHotJournalHelper$", "-test.count=1")
	command.Env = append(os.Environ(), "LYTVPK_TEST_HOT_JOURNAL_HELPER=1", "LYTVPK_TEST_HOT_JOURNAL_DB="+path)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("hot-journal helper failed: %v\n%s", err, output)
	}
	journal, err := os.ReadFile(path + "-journal")
	if err != nil || len(journal) < 512 || bytes.Equal(journal[:8], make([]byte, 8)) {
		t.Fatalf("helper did not leave a hot rollback journal: %v", err)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(before, after) {
		t.Fatal("helper did not spill uncommitted pages into the main database")
	}
}

func TestStatsStoreSQLiteRecoversCommittedCheckpointFromHotJournal(t *testing.T) {
	path := filepath.Join(t.TempDir(), "stats.db")
	createStatsFile(t, path)
	original, err := readStatsStore(path)
	if err != nil || original == nil {
		t.Fatalf("could not read original checkpoint: %v", err)
	}
	createHotStatsJournal(t, path)
	restored, err := readStatsStore(path)
	if err != nil {
		t.Fatalf("hot-journal recovery failed: %v", err)
	}
	if !reflect.DeepEqual(original, restored) {
		t.Fatal("hot-journal recovery did not retain every committed counter and sketch")
	}
	if _, err := os.Lstat(path + "-journal"); !os.IsNotExist(err) {
		t.Fatalf("recovered rollback journal was not removed: %v", err)
	}
}

func TestStatsStoreSQLiteHotJournalDoesNotBypassHeaderCompatibility(t *testing.T) {
	for _, field := range []struct {
		name   string
		offset int64
		value  uint32
	}{
		{"future-user-version", 60, 999},
		{"foreign-application-id", 68, 0x12345678},
	} {
		t.Run(field.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "stats.db")
			createStatsFile(t, path)
			createHotStatsJournal(t, path)
			file, err := os.OpenFile(path, os.O_WRONLY, 0)
			if err != nil {
				t.Fatal(err)
			}
			var value [4]byte
			binary.BigEndian.PutUint32(value[:], field.value)
			_, writeErr := file.WriteAt(value[:], field.offset)
			closeErr := file.Close()
			if writeErr != nil || closeErr != nil {
				t.Fatalf("could not prepare incompatible header: write=%v close=%v", writeErr, closeErr)
			}
			originalDB, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			originalJournal, err := os.ReadFile(path + "-journal")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := readStatsStore(path); err == nil {
				t.Fatal("an incompatible header was accepted because a hot journal existed")
			}
			preservedDB, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(preservedDB, originalDB) {
				t.Fatalf("incompatible database was modified by recovery: %v", err)
			}
			preservedJournal, err := os.ReadFile(path + "-journal")
			if err != nil || !bytes.Equal(preservedJournal, originalJournal) {
				t.Fatalf("incompatible journal was modified by recovery: %v", err)
			}
		})
	}
}

func TestStatsStoreSQLiteLockedWritesKeepRequestsLiveAndRetry(t *testing.T) {
	path := filepath.Join(t.TempDir(), "stats.db")
	createStatsFile(t, path)
	s := newPersistentStats(path)
	stop := startStatsMaintenance(t, s)
	locker := openStatsSQLite(t, path, "rw")
	if _, err := locker.Exec("BEGIN EXCLUSIVE"); err != nil {
		t.Fatal(err)
	}
	locked := true
	t.Cleanup(func() {
		if locked {
			_, _ = locker.Exec("ROLLBACK")
		}
	})
	deadline := time.Now().Add(3 * time.Second)
	for {
		value := persistenceState(t, s)["save_error"]
		if value != nil && value != "" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("locked SQLite destination did not report a save failure")
		}
		time.Sleep(time.Millisecond)
	}
	completed := make(chan struct{})
	var wg sync.WaitGroup
	wg.Go(func() {
		now := time.Now()
		s.record("detail", 429, false, false, s.userKey("198.51.100.77", now), now)
		close(completed)
	})
	select {
	case <-completed:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("statistics request was blocked by a locked SQLite database")
	}
	wg.Wait()
	assertPersistentCounts(t, s, 2, 1, 0)
	if value := persistenceState(t, s)["load_error"]; value != nil && value != "" {
		t.Fatalf("a later save failure was confused with a load failure: %#v", persistenceState(t, s))
	}
	if _, err := locker.Exec("COMMIT"); err != nil {
		t.Fatal(err)
	}
	locked = false
	_ = locker.Close()
	deadline = time.Now().Add(3 * time.Second)
	for {
		value := persistenceState(t, s)["save_error"]
		if value == nil || value == "" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("saving did not recover after the SQLite lock was released: %#v", persistenceState(t, s))
		}
		time.Sleep(time.Millisecond)
	}
	stop()
	restored, err := readStatsStore(path)
	if err != nil || restored == nil || restored.Counters.TotalRequests != 2 || restored.Counters.ForwardedRequests != 1 {
		t.Fatalf("live counters were lost during a retryable SQLite failure: %v", err)
	}
}

func TestStatsStoreSQLiteFailedTransactionRollsBackEveryAggregate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "stats.db")
	createStatsFile(t, path)
	original, err := readStatsStore(path)
	if err != nil || original == nil {
		t.Fatalf("could not read original checkpoint: %v", err)
	}
	// Abort a later table after the counter and label tables have been written.
	execStatsSQLite(t, path, `CREATE TRIGGER fail_checkpoint BEFORE INSERT ON sketches
WHEN NEW.kind = 'daily' BEGIN SELECT RAISE(ABORT, 'forced checkpoint failure'); END`)
	modified := *original
	modified.Counters.TotalRequests = 2
	modified.Counters.ForwardedRequests = 2
	modified.Daily.TotalRequests = 2
	modified.Daily.ForwardedRequests = 2
	modified.Routes = map[string]uint64{"list": 2}
	modified.Statuses = map[int]uint64{200: 2}
	modified.SavedAt = time.Now().UTC()
	if err := writeStatsStore(path, modified); err == nil {
		t.Fatal("checkpoint succeeded despite an aborting SQLite trigger")
	}
	execStatsSQLite(t, path, "DROP TRIGGER fail_checkpoint")
	after, err := readStatsStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(original, after) {
		t.Fatal("failed SQLite transaction left partially updated aggregate rows or sketches")
	}
	if err := writeStatsStore(path, modified); err != nil {
		t.Fatalf("checkpoint did not recover after the temporary failure was removed: %v", err)
	}
	after, err = readStatsStore(path)
	if err != nil || after == nil || after.Counters.TotalRequests != 2 {
		t.Fatalf("recovered checkpoint was not committed: %v", err)
	}
}

func TestStatsStoreSQLiteRejectsUnsafeRollbackJournal(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "stats.db")
	createStatsFile(t, path)
	victim := filepath.Join(directory, "keep.txt")
	const original = "keep this administrator-owned file"
	if err := os.WriteFile(victim, []byte(original), 0600); err != nil {
		t.Fatal(err)
	}
	journal := path + "-journal"
	if err := os.Symlink(victim, journal); err != nil {
		t.Skipf("symbolic links unavailable: %v", err)
	}
	if err := writeStatsStore(path, newStats().captureStatsStore()); err == nil {
		t.Fatal("symbolic-link rollback journal was accepted")
	}
	data, err := os.ReadFile(victim)
	if err != nil || string(data) != original {
		t.Fatalf("rollback-journal target was modified: %v", err)
	}
	info, err := os.Lstat(journal)
	if err != nil || info.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("unsafe rollback journal was replaced or removed: %v", err)
	}
}

func TestStatsStoreSQLiteCheckpointsLeaveNoStagingOrWALFiles(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "stats.db")
	s := newStats()
	for i := range 3 {
		now := time.Now()
		s.record("list", 200, true, false, fmt.Sprintf("anonymous-%d", i), now)
		if err := writeStatsStore(path, s.captureStatsStore()); err != nil {
			t.Fatal(err)
		}
		entries, err := os.ReadDir(directory)
		if err != nil || len(entries) != 1 || entries[0].Name() != "stats.db" {
			t.Fatalf("checkpoint left staging/journal/WAL files: entries=%v err=%v", entries, err)
		}
		info, err := os.Stat(path)
		if err != nil || info.Size() > 2<<20 {
			t.Fatalf("SQLite database exceeded its disk bound: %v", err)
		}
	}
}
