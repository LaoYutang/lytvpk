package relay

import (
	"context"
	"database/sql"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math/bits"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	_ "github.com/glebarez/go-sqlite"
)

const (
	maxStatsStoreBytes       = 512 << 10 // Maximum logical in-memory payload.
	maxStatsDatabaseBytes    = 2 << 20
	maxStatsJournalBytes     = 4 << 20 // Includes rollback records and page headers.
	statsSQLitePageSize      = 4096
	statsSQLiteMaxPages      = 512
	statsSQLiteApplicationID = 0x4c595456 // LYTV, verified before crash recovery.
)

type statsStoreData struct {
	StartedAt            time.Time         `json:"started_at"`
	Counters             statsCounters     `json:"counters"`
	Routes               map[string]uint64 `json:"routes"`
	Statuses             map[int]uint64    `json:"statuses"`
	WindowStart          time.Time         `json:"window_start"`
	Daily                statsCounters     `json:"daily"`
	History              []statsDay        `json:"history"`
	Seed                 []byte            `json:"seed"`
	DailyBitmap          []byte            `json:"daily_bitmap"`
	CumulativeBitmap     []byte            `json:"cumulative_bitmap"`
	DailyIncomplete      bool              `json:"daily_incomplete"`
	CumulativeIncomplete bool              `json:"cumulative_incomplete"`
	SavedAt              time.Time         `json:"saved_at"`
}

// runPersistence is called by one owner-managed worker, never by request
// handlers. All file reads, encoding, sync and rename operations are outside mu.
func (s *stats) runPersistence(ctx context.Context, interval time.Duration) {
	s.mu.Lock()
	if s.maintenanceStarted {
		s.mu.Unlock()
		return
	}
	s.maintenanceStarted = true
	path := s.path
	s.mu.Unlock()
	if path == "" {
		<-ctx.Done()
		return
	}
	loaded, err := readStatsStore(path)
	s.mu.Lock()
	s.mergeStatsStore(loaded, err)
	s.mu.Unlock()
	if err != nil {
		// A corrupt, unreadable or newer-format checkpoint may contain valuable
		// recoverable data. Preserve it exactly; an operator can repair the path
		// and restart to retry loading. Requests continue using memory counters.
		<-ctx.Done()
		return
	}
	// Flush promptly after load so a new seed and early requests are durable.
	s.flushStatsStore()
	if interval < 10*time.Millisecond {
		interval = 10 * time.Millisecond
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			s.flushStatsStore()
			return
		case <-ticker.C:
			s.flushStatsStore()
		}
	}
}

func shortStatsError(err error) string {
	if err == nil {
		return ""
	}
	value := err.Error()
	if len(value) > 512 {
		value = value[:512]
	}
	return value
}

func bitmapBytes(bitmap *[userBitmapBits / 64]uint64) []byte {
	value := make([]byte, userBitmapBits/8)
	for i, word := range bitmap {
		binary.LittleEndian.PutUint64(value[i*8:], word)
	}
	return value
}

func mergeStatsBitmap(dst *[userBitmapBits / 64]uint64, src []byte) uint64 {
	var occupied uint64
	for i := range dst {
		dst[i] |= binary.LittleEndian.Uint64(src[i*8:])
		occupied += uint64(bits.OnesCount64(dst[i]))
	}
	return occupied
}

func (s *stats) mergeHistoryDay(day statsDay) {
	if !day.Day.Before(s.windowStart) {
		return
	}
	for i := range s.history {
		if s.history[i].Day.Equal(day.Day) {
			s.history[i].statsCounters = addStatsCounters(s.history[i].statsCounters, day.statsCounters)
			s.history[i].UserEstimate = statsAdd(s.history[i].UserEstimate, day.UserEstimate)
			s.history[i].UsersIncomplete = s.history[i].UsersIncomplete || day.UsersIncomplete
			return
		}
	}
	s.history = append(s.history, day)
}

// mergeStatsStore runs under mu only after the bounded file read and validation
// have completed. Counters already recorded during loading are added, never
// overwritten. Pending fingerprints are re-keyed with the selected stable seed.
func (s *stats) mergeStatsStore(data *statsStoreData, loadErr error) {
	s.rotate(time.Now())
	s.persistence.Ready = true
	s.persistence.LoadError = shortStatsError(loadErr)
	if loadErr != nil {
		s.persistence.SaveError = "writes paused after load error; existing storage is preserved until operator repair and restart"
	}
	if data != nil {
		s.persistence.Restored = true
		s.persistence.LastSaved = data.SavedAt
		copy(s.seed[:], data.Seed)
		if data.StartedAt.Before(s.startedAt) {
			s.startedAt = data.StartedAt
		}
		s.totalRequests = statsAdd(s.totalRequests, data.Counters.TotalRequests)
		s.forwarded = statsAdd(s.forwarded, data.Counters.ForwardedRequests)
		s.upstreamFailures = statsAdd(s.upstreamFailures, data.Counters.UpstreamFailures)
		for route, count := range data.Routes {
			if _, exists := s.routes[route]; !exists && len(s.routes) >= 31 {
				route = "unknown"
			}
			s.routes[route] = statsAdd(s.routes[route], count)
		}
		for status, count := range data.Statuses {
			s.statuses[status] = statsAdd(s.statuses[status], count)
		}
		s.cumulativeOccupied = mergeStatsBitmap(&s.cumulativeBits, data.CumulativeBitmap)
		s.cumulativeIncomplete = s.cumulativeIncomplete || data.CumulativeIncomplete
		if data.WindowStart.Equal(s.windowStart) {
			s.daily = addStatsCounters(s.daily, data.Daily)
			s.occupied = mergeStatsBitmap(&s.userBits, data.DailyBitmap)
			s.dailyIncomplete = s.dailyIncomplete || data.DailyIncomplete
		} else {
			var old [userBitmapBits / 64]uint64
			occupied := mergeStatsBitmap(&old, data.DailyBitmap)
			s.mergeHistoryDay(statsDay{data.WindowStart, data.Daily, statsEstimate(occupied), data.DailyIncomplete})
		}
		for _, day := range data.History {
			s.mergeHistoryDay(day)
		}
	}
	s.seedReady = true
	type replayUser struct {
		key string
		day time.Time
	}
	replay := make([]replayUser, 0, len(s.pendingUsers))
	for pending := range s.pendingUsers {
		key := s.stableUserKey(pending.fingerprint)
		replay = append(replay, replayUser{key, pending.day})
		s.observeUser(key, pending.day)
	}
	// A startup load spanning UTC midnight may have pending users in the day
	// that just closed. Restore that day's bitmap when available before estimating.
	for i := range s.history {
		var bitmap [userBitmapBits / 64]uint64
		occupied := uint64(0)
		restoredBitmap := data != nil && data.WindowStart.Equal(s.history[i].Day)
		if restoredBitmap {
			occupied = mergeStatsBitmap(&bitmap, data.DailyBitmap)
		}
		hasPending := false
		for _, user := range replay {
			if user.day.Equal(s.history[i].Day) {
				statsSetBit(&bitmap, &occupied, user.day.Format("2006-01-02")+":"+user.key)
				hasPending = true
			}
		}
		if hasPending {
			if restoredBitmap {
				s.history[i].UserEstimate = statsEstimate(occupied)
			} else {
				s.history[i].UserEstimate = statsAdd(s.history[i].UserEstimate, statsEstimate(occupied))
			}
		}
	}
	s.pendingUsers = nil
	s.trimHistory()
}

func (s *stats) captureStatsStore() statsStoreData {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.rotate(time.Now())
	data := statsStoreData{StartedAt: s.startedAt, Counters: statsCounters{s.totalRequests, s.forwarded, s.upstreamFailures}, WindowStart: s.windowStart, Daily: s.daily, History: append([]statsDay{}, s.history...), Seed: append([]byte(nil), s.seed[:]...), DailyBitmap: bitmapBytes(&s.userBits), CumulativeBitmap: bitmapBytes(&s.cumulativeBits), DailyIncomplete: s.dailyIncomplete, CumulativeIncomplete: s.cumulativeIncomplete, SavedAt: time.Now().UTC(), Routes: make(map[string]uint64, len(s.routes)), Statuses: make(map[int]uint64, len(s.statuses))}
	for route, count := range s.routes {
		data.Routes[route] = count
	}
	for status, count := range s.statuses {
		data.Statuses[status] = count
	}
	return data
}

func (s *stats) flushStatsStore() {
	data := s.captureStatsStore()
	err := writeStatsStore(s.path, data)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.persistence.SaveError = shortStatsError(err)
	if err == nil {
		s.persistence.LastSaved = data.SavedAt
	}
}

func checkStatsParents(path string, create bool) error {
	parent := filepath.Dir(path)
	// Inspect every existing ancestor before creating anything. MkdirAll would
	// otherwise follow a symlink and create children outside the intended tree.
	var missing []string
	var missingErr error
	current := parent
	for {
		info, err := os.Lstat(current)
		if errors.Is(err, os.ErrNotExist) {
			missing = append(missing, current)
			missingErr = err
		} else if err != nil {
			return err
		} else if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
			return errors.New("statistics parent must be a real directory, not a symbolic link")
		}
		next := filepath.Dir(current)
		if next == current {
			break
		}
		current = next
	}
	if !create {
		return missingErr
	}
	for i := len(missing) - 1; i >= 0; i-- {
		if err := os.Mkdir(missing[i], 0700); err != nil && !errors.Is(err, os.ErrExist) {
			return err
		}
		info, err := os.Lstat(missing[i])
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
			return errors.New("statistics parent changed while creating directory")
		}
	}
	return nil
}

func checkStatsTarget(path string) (os.FileInfo, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("statistics store must be a regular file, not a symbolic link")
	}
	return info, nil
}

func checkStatsSidecars(path string) error {
	for _, suffix := range []string{"-journal", "-wal", "-shm"} {
		info, err := os.Lstat(path + suffix)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
			return errors.New("statistics SQLite sidecar must be a regular file, not a symbolic link")
		}
		if suffix != "-journal" || info.Size() > maxStatsJournalBytes {
			return errors.New("unexpected or oversized statistics SQLite sidecar")
		}
	}
	return nil
}

func validateStatsStore(data statsStoreData) error {
	now := time.Now().UTC()
	if data.StartedAt.IsZero() || data.SavedAt.IsZero() || data.StartedAt.After(data.SavedAt) || data.SavedAt.After(now.Add(5*time.Minute)) || !data.WindowStart.Equal(statsUTCDate(data.WindowStart)) || data.WindowStart.After(statsUTCDate(now)) || data.WindowStart.IsZero() {
		return errors.New("invalid statistics timestamps")
	}
	if len(data.Seed) != 32 || len(data.DailyBitmap) != userBitmapBits/8 || len(data.CumulativeBitmap) != userBitmapBits/8 || len(data.Routes) > 32 || len(data.Statuses) > 501 || len(data.History) > maxStatsHistory {
		return errors.New("invalid statistics resource bounds")
	}
	validCounters := func(c statsCounters) bool {
		return c.ForwardedRequests <= c.TotalRequests && c.UpstreamFailures <= c.TotalRequests
	}
	if !validCounters(data.Counters) || !validCounters(data.Daily) || data.Daily.TotalRequests > data.Counters.TotalRequests {
		return errors.New("invalid statistics counters")
	}
	var dailyBits, cumulativeBits uint64
	for i := 0; i < userBitmapBits/8; i += 8 {
		dailyBits += uint64(bits.OnesCount64(binary.LittleEndian.Uint64(data.DailyBitmap[i:])))
		cumulativeBits += uint64(bits.OnesCount64(binary.LittleEndian.Uint64(data.CumulativeBitmap[i:])))
	}
	if dailyBits > data.Daily.TotalRequests || cumulativeBits > data.Counters.TotalRequests {
		return errors.New("statistics bitmap occupancy exceeds recorded calls")
	}
	var routesTotal, statusesTotal uint64
	for route, count := range data.Routes {
		if len(route) == 0 || len(route) > 64 || !utf8.ValidString(route) || strings.ContainsAny(route, "\r\n\x00") {
			return errors.New("invalid statistics route label")
		}
		if count > data.Counters.TotalRequests {
			return errors.New("invalid statistics route count")
		}
		routesTotal = statsAdd(routesTotal, count)
	}
	for status, count := range data.Statuses {
		if (status != 0 && (status < 100 || status > 599)) || count > data.Counters.TotalRequests {
			return errors.New("invalid statistics status count")
		}
		statusesTotal = statsAdd(statusesTotal, count)
	}
	if routesTotal != data.Counters.TotalRequests || statusesTotal != data.Counters.TotalRequests {
		return errors.New("statistics label counts do not match total")
	}
	var prior time.Time
	retained := data.Daily
	for _, day := range data.History {
		if day.Day.IsZero() || !day.Day.Equal(statsUTCDate(day.Day)) || !day.Day.Before(data.WindowStart) || (!prior.IsZero() && !day.Day.After(prior)) || !validCounters(day.statsCounters) || day.TotalRequests > data.Counters.TotalRequests || day.UserEstimate > statsEstimate(userBitmapBits) {
			return errors.New("invalid statistics daily history")
		}
		prior = day.Day
		retained = addStatsCounters(retained, day.statsCounters)
	}
	if retained.TotalRequests > data.Counters.TotalRequests || retained.ForwardedRequests > data.Counters.ForwardedRequests || retained.UpstreamFailures > data.Counters.UpstreamFailures {
		return errors.New("retained daily counters exceed cumulative counters")
	}
	return nil
}

// Every database connection uses a URI-escaped pathname, a short busy timeout,
// one SQL connection, and an operation context. Requests never call this code.
func openStatsDatabase(path string, readOnly bool) (*sql.DB, error) {
	query := url.Values{"mode": {"rw"}, "_pragma": {"busy_timeout(100)", "foreign_keys(1)"}}
	if readOnly {
		query.Set("mode", "ro")
		query.Add("_pragma", "query_only(1)")
	}
	uri := url.URL{Scheme: "file", Path: path, RawQuery: query.Encode()}
	db, err := sql.Open("sqlite", uri.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	return db, nil
}

func configureStatsDatabase(ctx context.Context, db *sql.DB, write bool) error {
	for _, statement := range []string{"PRAGMA trusted_schema=OFF", "PRAGMA temp_store=MEMORY", "PRAGMA cache_size=-1024", "PRAGMA mmap_size=0"} {
		if _, err := db.ExecContext(ctx, statement); err != nil {
			return err
		}
	}
	if !write {
		return nil
	}
	if _, err := db.ExecContext(ctx, "PRAGMA page_size=4096"); err != nil {
		return err
	}
	var pageSize, pages int
	if err := db.QueryRowContext(ctx, "PRAGMA page_size").Scan(&pageSize); err != nil {
		return err
	}
	if pageSize != statsSQLitePageSize {
		return errors.New("statistics SQLite page size must be 4096")
	}
	if err := db.QueryRowContext(ctx, "PRAGMA max_page_count=512").Scan(&pages); err != nil {
		return err
	}
	if pages != statsSQLiteMaxPages {
		return errors.New("statistics SQLite page limit cannot be enforced")
	}
	var journal string
	if err := db.QueryRowContext(ctx, "PRAGMA journal_mode=DELETE").Scan(&journal); err != nil {
		return err
	}
	if journal != "delete" {
		return errors.New("statistics SQLite DELETE journal mode is required")
	}
	if _, err := db.ExecContext(ctx, "PRAGMA journal_size_limit=0"); err != nil {
		return err
	}
	if _, err := db.ExecContext(ctx, "PRAGMA synchronous=FULL"); err != nil {
		return err
	}
	return nil
}

func statsParseCounter(value string) (uint64, error) {
	if len(value) == 0 || len(value) > 20 {
		return 0, errors.New("invalid statistics decimal counter")
	}
	n, err := strconv.ParseUint(value, 10, 64)
	if err != nil {
		return 0, errors.New("invalid statistics decimal counter")
	}
	return n, nil
}

func statsParseCounters(total, forwarded, failed string) (statsCounters, error) {
	a, err := statsParseCounter(total)
	if err != nil {
		return statsCounters{}, err
	}
	b, err := statsParseCounter(forwarded)
	if err != nil {
		return statsCounters{}, err
	}
	c, err := statsParseCounter(failed)
	if err != nil {
		return statsCounters{}, err
	}
	return statsCounters{a, b, c}, nil
}

func statsBoolean(value int) (bool, error) {
	if value != 0 && value != 1 {
		return false, errors.New("invalid statistics boolean")
	}
	return value == 1, nil
}

func statsLogicalBytes(data statsStoreData) int64 {
	n := int64(len(data.Seed) + len(data.DailyBitmap) + len(data.CumulativeBitmap) + 512 + len(data.History)*128)
	for route := range data.Routes {
		n += int64(len(route) + 20)
	}
	n += int64(len(data.Statuses) * 24)
	return n
}

func validateStatsDatabaseBounds(ctx context.Context, db *sql.DB) error {
	// Reject unexpected resource usage before scanning text or BLOB fields into
	// Go memory. The on-disk file has a separate hard 2 MiB boundary.
	expected := map[string]int{"meta": 4, "cumulative": 1, "daily": maxStatsHistory + 1, "route_counts": 32, "status_counts": 501, "sketches": 2}
	sizes := map[string]string{
		"meta":          "length(key)+length(value)",
		"cumulative":    "length(total_requests)+length(forwarded_requests)+length(upstream_failures)+8",
		"daily":         "length(day)+length(total_requests)+length(forwarded_requests)+length(upstream_failures)+length(user_estimate)+8",
		"route_counts":  "length(route)+length(count)",
		"status_counts": "length(count)+8",
		"sketches":      "length(kind)+length(bits)",
	}
	var totalBytes int64
	for table, maxRows := range expected {
		var kind string
		if err := db.QueryRowContext(ctx, "SELECT type FROM sqlite_schema WHERE name=?", table).Scan(&kind); err != nil || kind != "table" {
			return fmt.Errorf("invalid statistics SQLite table %s", table)
		}
		var rows, bytes int64
		statement := "SELECT COUNT(*),COALESCE(SUM(" + sizes[table] + "),0) FROM " + table
		if err := db.QueryRowContext(ctx, statement).Scan(&rows, &bytes); err != nil {
			return err
		}
		if rows > int64(maxRows) || bytes < 0 || bytes > maxStatsStoreBytes {
			return errors.New("statistics SQLite resource limit exceeded")
		}
		if (table == "meta" && rows != 4) || (table == "cumulative" && rows != 1) || (table == "sketches" && rows != 2) || (table == "daily" && rows < 1) {
			return errors.New("incomplete statistics SQLite tables")
		}
		totalBytes += bytes
	}
	if totalBytes > maxStatsStoreBytes {
		return errors.New("statistics SQLite payload exceeds memory limit")
	}
	return nil
}

func validateStatsSQLiteHeader(path string, info os.FileInfo) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil || !opened.Mode().IsRegular() || !os.SameFile(info, opened) {
		return errors.New("statistics file changed while opening")
	}
	header := make([]byte, 100)
	if _, err := io.ReadFull(file, header); err != nil || string(header[:16]) != "SQLite format 3\x00" {
		return errors.New("statistics file is not a SQLite database")
	}
	if header[18] != 1 || header[19] != 1 {
		return errors.New("statistics SQLite rollback-journal format is required")
	}
	if binary.BigEndian.Uint16(header[16:18]) != statsSQLitePageSize {
		return errors.New("statistics SQLite page size must be 4096")
	}
	if binary.BigEndian.Uint32(header[60:64]) != 1 {
		return errors.New("unsupported statistics SQLite user_version")
	}
	if binary.BigEndian.Uint32(header[68:72]) != statsSQLiteApplicationID {
		return errors.New("unrecognized statistics SQLite application_id")
	}
	return nil
}

// A hot DELETE journal needs SQLite's writable pager to restore the last
// committed pages. Only a bounded regular journal paired with our verified
// header marker/version can enter this path. No application writes or PRAGMAs
// that modify the database are executed here. Future or foreign files never
// open read-write; a normal load without a journal stays entirely read-only.
func recoverStatsSQLiteJournal(path string) error {
	if _, err := os.Lstat(path + "-journal"); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	if err := checkStatsSidecars(path); err != nil {
		return err
	}
	db, err := openStatsDatabase(path, false)
	if err != nil {
		return err
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 750*time.Millisecond)
	defer cancel()
	if err := configureStatsDatabase(ctx, db, false); err != nil {
		return err
	}
	var count, version, applicationID int
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM sqlite_schema").Scan(&count); err != nil {
		return err
	}
	if err := db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	if err := db.QueryRowContext(ctx, "PRAGMA application_id").Scan(&applicationID); err != nil {
		return err
	}
	if version != 1 || applicationID != statsSQLiteApplicationID {
		return errors.New("statistics SQLite recovery restored an unsupported header")
	}
	return nil
}

func readStatsStore(rawPath string) (*statsStoreData, error) {
	path, err := filepath.Abs(rawPath)
	if err != nil {
		return nil, err
	}
	if err := checkStatsParents(path, false); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	info, err := checkStatsTarget(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if info.Size() > maxStatsDatabaseBytes {
		return nil, errors.New("statistics SQLite database exceeds 2 MiB limit")
	}
	if err := checkStatsSidecars(path); err != nil {
		return nil, err
	}
	if err := validateStatsSQLiteHeader(path, info); err != nil {
		return nil, err
	}
	if err := recoverStatsSQLiteJournal(path); err != nil {
		return nil, err
	}
	db, err := openStatsDatabase(path, true)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 750*time.Millisecond)
	defer cancel()
	if err := configureStatsDatabase(ctx, db, false); err != nil {
		return nil, err
	}
	var version, applicationID, pageSize, pageCount int
	if err := db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return nil, err
	}
	if version != 1 {
		return nil, errors.New("unsupported statistics SQLite user_version")
	}
	if err := db.QueryRowContext(ctx, "PRAGMA application_id").Scan(&applicationID); err != nil {
		return nil, err
	}
	if applicationID != statsSQLiteApplicationID {
		return nil, errors.New("unrecognized statistics SQLite application_id")
	}
	if err := db.QueryRowContext(ctx, "PRAGMA page_size").Scan(&pageSize); err != nil {
		return nil, err
	}
	if err := db.QueryRowContext(ctx, "PRAGMA page_count").Scan(&pageCount); err != nil {
		return nil, err
	}
	if pageSize != statsSQLitePageSize || pageCount > statsSQLiteMaxPages {
		return nil, errors.New("invalid statistics SQLite page bounds")
	}
	var integrity, journal string
	if err := db.QueryRowContext(ctx, "PRAGMA integrity_check(1)").Scan(&integrity); err != nil {
		return nil, err
	}
	if integrity != "ok" {
		return nil, errors.New("statistics SQLite integrity check failed")
	}
	if err := db.QueryRowContext(ctx, "PRAGMA journal_mode").Scan(&journal); err != nil {
		return nil, err
	}
	if journal != "delete" {
		return nil, errors.New("statistics SQLite journal mode must be DELETE")
	}
	if err := validateStatsDatabaseBounds(ctx, db); err != nil {
		return nil, err
	}
	data := &statsStoreData{Routes: make(map[string]uint64), Statuses: make(map[int]uint64)}
	meta := make(map[string][]byte)
	rows, err := db.QueryContext(ctx, "SELECT key,value FROM meta")
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var key string
		var value []byte
		if err := rows.Scan(&key, &value); err != nil {
			rows.Close()
			return nil, err
		}
		if _, exists := meta[key]; exists {
			rows.Close()
			return nil, errors.New("duplicate statistics metadata")
		}
		meta[key] = value
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	if len(meta) != 4 {
		return nil, errors.New("invalid statistics metadata")
	}
	data.Seed = meta["seed"]
	for key, target := range map[string]*time.Time{"started_at": &data.StartedAt, "window_start": &data.WindowStart, "saved_at": &data.SavedAt} {
		value, exists := meta[key]
		if !exists || len(value) > 64 {
			return nil, errors.New("invalid statistics timestamp metadata")
		}
		parsed, err := time.Parse(time.RFC3339Nano, string(value))
		if err != nil {
			return nil, err
		}
		*target = parsed
	}
	var total, forwarded, failed string
	var incomplete int
	if err := db.QueryRowContext(ctx, "SELECT total_requests,forwarded_requests,upstream_failures,incomplete FROM cumulative WHERE id=1").Scan(&total, &forwarded, &failed, &incomplete); err != nil {
		return nil, err
	}
	data.Counters, err = statsParseCounters(total, forwarded, failed)
	if err != nil {
		return nil, err
	}
	data.CumulativeIncomplete, err = statsBoolean(incomplete)
	if err != nil {
		return nil, err
	}
	rows, err = db.QueryContext(ctx, "SELECT day,total_requests,forwarded_requests,upstream_failures,user_estimate,incomplete FROM daily ORDER BY day")
	if err != nil {
		return nil, err
	}
	foundCurrent := false
	var storedDailyEstimate uint64
	for rows.Next() {
		var day, estimate string
		if err := rows.Scan(&day, &total, &forwarded, &failed, &estimate, &incomplete); err != nil {
			rows.Close()
			return nil, err
		}
		parsed, err := time.Parse("2006-01-02", day)
		if err != nil {
			rows.Close()
			return nil, err
		}
		counters, err := statsParseCounters(total, forwarded, failed)
		if err != nil {
			rows.Close()
			return nil, err
		}
		users, err := statsParseCounter(estimate)
		if err != nil {
			rows.Close()
			return nil, err
		}
		partial, err := statsBoolean(incomplete)
		if err != nil {
			rows.Close()
			return nil, err
		}
		if parsed.Equal(data.WindowStart) {
			if foundCurrent {
				rows.Close()
				return nil, errors.New("duplicate current statistics day")
			}
			data.Daily = counters
			data.DailyIncomplete = partial
			storedDailyEstimate = users
			foundCurrent = true
		} else {
			data.History = append(data.History, statsDay{parsed, counters, users, partial})
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	if !foundCurrent {
		return nil, errors.New("missing current statistics day")
	}
	rows, err = db.QueryContext(ctx, "SELECT route,count FROM route_counts")
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var route, count string
		if err := rows.Scan(&route, &count); err != nil {
			rows.Close()
			return nil, err
		}
		value, err := statsParseCounter(count)
		if err != nil {
			rows.Close()
			return nil, err
		}
		if _, exists := data.Routes[route]; exists {
			rows.Close()
			return nil, errors.New("duplicate statistics route")
		}
		data.Routes[route] = value
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	rows, err = db.QueryContext(ctx, "SELECT status,count FROM status_counts")
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var status int
		var count string
		if err := rows.Scan(&status, &count); err != nil {
			rows.Close()
			return nil, err
		}
		value, err := statsParseCounter(count)
		if err != nil {
			rows.Close()
			return nil, err
		}
		if _, exists := data.Statuses[status]; exists {
			rows.Close()
			return nil, errors.New("duplicate statistics status")
		}
		data.Statuses[status] = value
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	rows, err = db.QueryContext(ctx, "SELECT kind,bits FROM sketches")
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var kind string
		var bitmap []byte
		if err := rows.Scan(&kind, &bitmap); err != nil {
			rows.Close()
			return nil, err
		}
		switch kind {
		case "daily":
			if data.DailyBitmap != nil {
				rows.Close()
				return nil, errors.New("duplicate daily sketch")
			}
			data.DailyBitmap = bitmap
		case "cumulative":
			if data.CumulativeBitmap != nil {
				rows.Close()
				return nil, errors.New("duplicate cumulative sketch")
			}
			data.CumulativeBitmap = bitmap
		default:
			rows.Close()
			return nil, errors.New("invalid statistics sketch kind")
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	if err := validateStatsStore(*data); err != nil {
		return nil, err
	}
	if storedDailyEstimate != statsEstimate(statsBitmapOccupancy(data.DailyBitmap)) {
		return nil, errors.New("current statistics user estimate does not match sketch")
	}
	if statsLogicalBytes(*data) > maxStatsStoreBytes {
		return nil, errors.New("statistics SQLite payload exceeds memory limit")
	}
	after, err := checkStatsTarget(path)
	if err != nil || !os.SameFile(info, after) || after.Size() > maxStatsDatabaseBytes {
		return nil, errors.New("statistics database changed while reading")
	}
	return data, nil
}

const statsSQLiteSchema = `
CREATE TABLE meta (key TEXT PRIMARY KEY NOT NULL, value BLOB NOT NULL);
CREATE TABLE cumulative (id INTEGER PRIMARY KEY CHECK(id=1), total_requests TEXT NOT NULL, forwarded_requests TEXT NOT NULL, upstream_failures TEXT NOT NULL, incomplete INTEGER NOT NULL CHECK(incomplete IN (0,1)));
CREATE TABLE daily (day TEXT PRIMARY KEY NOT NULL, total_requests TEXT NOT NULL, forwarded_requests TEXT NOT NULL, upstream_failures TEXT NOT NULL, user_estimate TEXT NOT NULL, incomplete INTEGER NOT NULL CHECK(incomplete IN (0,1)));
CREATE TABLE route_counts (route TEXT PRIMARY KEY NOT NULL CHECK(length(route) BETWEEN 1 AND 64), count TEXT NOT NULL);
CREATE TABLE status_counts (status INTEGER PRIMARY KEY CHECK(status=0 OR status BETWEEN 100 AND 599), count TEXT NOT NULL);
CREATE TABLE sketches (kind TEXT PRIMARY KEY NOT NULL CHECK(kind IN ('daily','cumulative')), bits BLOB NOT NULL CHECK(length(bits)=65536));
PRAGMA user_version=1;
PRAGMA application_id=0x4c595456;`

func writeStatsStore(rawPath string, data statsStoreData) (err error) {
	if err := validateStatsStore(data); err != nil {
		return err
	}
	if statsLogicalBytes(data) > maxStatsStoreBytes {
		return errors.New("statistics SQLite payload exceeds memory limit")
	}
	path, err := filepath.Abs(rawPath)
	if err != nil {
		return err
	}
	if err := checkStatsParents(path, true); err != nil {
		return err
	}
	if err := checkStatsSidecars(path); err != nil {
		return err
	}
	info, checkErr := checkStatsTarget(path)
	created := false
	if errors.Is(checkErr, os.ErrNotExist) {
		file, createErr := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if createErr != nil {
			return createErr
		}
		closeErr := file.Close()
		if closeErr != nil {
			os.Remove(path)
			return closeErr
		}
		created = true
	} else if checkErr != nil {
		return checkErr
	} else if info.Size() > maxStatsDatabaseBytes {
		return errors.New("statistics SQLite database exceeds 2 MiB limit")
	}
	if !created {
		if err := validateStatsSQLiteHeader(path, info); err != nil {
			return err
		}
	}
	// The rollback journal inherits permissions from the database. Restrict an
	// older administrator-created file before SQLite can open a write transaction.
	if err := os.Chmod(path, 0600); err != nil {
		return err
	}
	committed := false
	defer func() {
		if created && !committed {
			_ = os.Remove(path)
		}
	}()
	db, err := openStatsDatabase(path, false)
	if err != nil {
		return err
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 750*time.Millisecond)
	defer cancel()
	if err := configureStatsDatabase(ctx, db, true); err != nil {
		return err
	}
	var version int
	if err := db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	if (!created && version != 1) || (created && version != 0) {
		return errors.New("unsupported statistics SQLite user_version")
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if created {
		if _, err := tx.ExecContext(ctx, statsSQLiteSchema); err != nil {
			return err
		}
	}
	for _, table := range []string{"meta", "cumulative", "daily", "route_counts", "status_counts", "sketches"} {
		if _, err := tx.ExecContext(ctx, "DELETE FROM "+table); err != nil {
			return err
		}
	}
	for key, value := range map[string][]byte{"seed": data.Seed, "started_at": []byte(data.StartedAt.Format(time.RFC3339Nano)), "window_start": []byte(data.WindowStart.Format(time.RFC3339Nano)), "saved_at": []byte(data.SavedAt.Format(time.RFC3339Nano))} {
		if _, err := tx.ExecContext(ctx, "INSERT INTO meta(key,value) VALUES(?,?)", key, value); err != nil {
			return err
		}
	}
	decimal := func(n uint64) string { return strconv.FormatUint(n, 10) }
	if _, err := tx.ExecContext(ctx, "INSERT INTO cumulative(id,total_requests,forwarded_requests,upstream_failures,incomplete) VALUES(1,?,?,?,?)", decimal(data.Counters.TotalRequests), decimal(data.Counters.ForwardedRequests), decimal(data.Counters.UpstreamFailures), data.CumulativeIncomplete); err != nil {
		return err
	}
	days := append(append([]statsDay{}, data.History...), statsDay{data.WindowStart, data.Daily, statsEstimate(statsBitmapOccupancy(data.DailyBitmap)), data.DailyIncomplete})
	for _, day := range days {
		if _, err := tx.ExecContext(ctx, "INSERT INTO daily(day,total_requests,forwarded_requests,upstream_failures,user_estimate,incomplete) VALUES(?,?,?,?,?,?)", day.Day.Format("2006-01-02"), decimal(day.TotalRequests), decimal(day.ForwardedRequests), decimal(day.UpstreamFailures), decimal(day.UserEstimate), day.UsersIncomplete); err != nil {
			return err
		}
	}
	for route, count := range data.Routes {
		if _, err := tx.ExecContext(ctx, "INSERT INTO route_counts(route,count) VALUES(?,?)", route, decimal(count)); err != nil {
			return err
		}
	}
	for status, count := range data.Statuses {
		if _, err := tx.ExecContext(ctx, "INSERT INTO status_counts(status,count) VALUES(?,?)", status, decimal(count)); err != nil {
			return err
		}
	}
	for kind, bitmap := range map[string][]byte{"daily": data.DailyBitmap, "cumulative": data.CumulativeBitmap} {
		if _, err := tx.ExecContext(ctx, "INSERT INTO sketches(kind,bits) VALUES(?,?)", kind, bitmap); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	committed = true
	if err := db.Close(); err != nil {
		return err
	}
	after, err := checkStatsTarget(path)
	if err != nil {
		return err
	}
	if after.Size() > maxStatsDatabaseBytes {
		return errors.New("statistics SQLite database exceeds 2 MiB limit")
	}
	if err := os.Chmod(path, 0600); err != nil {
		return err
	}
	return nil
}

func statsBitmapOccupancy(bitmap []byte) uint64 {
	var occupied uint64
	for i := 0; i < len(bitmap); i += 8 {
		occupied += uint64(bits.OnesCount64(binary.LittleEndian.Uint64(bitmap[i:])))
	}
	return occupied
}
