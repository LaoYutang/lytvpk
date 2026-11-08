package relay

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"math"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	userBitmapBits       = 1 << 19 // Each sketch is fixed at 64 KiB.
	maxStatsHistory      = 30
	maxPendingStatsUsers = 4096
)

type statsCounters struct {
	TotalRequests     uint64 `json:"total_requests"`
	ForwardedRequests uint64 `json:"forwarded_requests"`
	UpstreamFailures  uint64 `json:"upstream_failures"`
}

type statsDay struct {
	Day time.Time `json:"day"`
	statsCounters
	UserEstimate    uint64 `json:"user_estimate"`
	UsersIncomplete bool   `json:"users_incomplete"`
}

type statsPersistence struct {
	Backend   string    `json:"backend"`
	Enabled   bool      `json:"enabled"`
	Ready     bool      `json:"ready"`
	Restored  bool      `json:"restored"`
	LoadError string    `json:"load_error"`
	SaveError string    `json:"save_error"`
	LastSaved time.Time `json:"last_saved"`
	Details   string    `json:"details"`
}

type pendingStatsUser struct {
	fingerprint string
	day         time.Time
}

type stats struct {
	mu                   sync.Mutex
	startedAt            time.Time
	totalRequests        uint64
	forwarded            uint64
	upstreamFailures     uint64
	routes               map[string]uint64
	statuses             map[int]uint64
	windowStart          time.Time
	userBits             [userBitmapBits / 64]uint64
	occupied             uint64
	cumulativeBits       [userBitmapBits / 64]uint64
	cumulativeOccupied   uint64
	daily                statsCounters
	history              []statsDay
	dailyIncomplete      bool
	cumulativeIncomplete bool
	seed                 [32]byte
	seedReady            bool
	pendingUsers         map[pendingStatsUser]struct{}
	path                 string
	persistence          statsPersistence
	maintenanceStarted   bool
}

func newStats() *stats {
	now := time.Now().UTC()
	s := &stats{startedAt: now, routes: make(map[string]uint64), statuses: make(map[int]uint64), windowStart: statsUTCDate(now), seedReady: true, persistence: statsPersistence{Backend: "memory", Ready: true}}
	// crypto/rand.Read fills the slice or terminates on an operating-system
	// entropy failure; it performs no statistics-file operations.
	_, _ = rand.Read(s.seed[:])
	return s
}

func newPersistentStats(path string) *stats {
	s := newStats()
	if path != "" {
		s.path = path
		s.seedReady = false
		s.pendingUsers = make(map[pendingStatsUser]struct{})
		s.persistence = statsPersistence{Backend: "sqlite", Enabled: true}
	}
	return s
}

func statsUTCDate(now time.Time) time.Time { return now.UTC().Truncate(24 * time.Hour) }

func statsAdd(a, b uint64) uint64 {
	if math.MaxUint64-a < b {
		return math.MaxUint64
	}
	return a + b
}

func addStatsCounters(a, b statsCounters) statsCounters {
	return statsCounters{statsAdd(a.TotalRequests, b.TotalRequests), statsAdd(a.ForwardedRequests, b.ForwardedRequests), statsAdd(a.UpstreamFailures, b.UpstreamFailures)}
}

func statsEstimate(occupied uint64) uint64 {
	empty := max(uint64(1), userBitmapBits-min(uint64(userBitmapBits), occupied))
	return uint64(math.Round(-userBitmapBits * math.Log(float64(empty)/userBitmapBits)))
}

func statsSetBit(bitmap *[userBitmapBits / 64]uint64, occupied *uint64, key string) {
	hash := sha256.Sum256([]byte(key))
	bit := binary.BigEndian.Uint64(hash[:8]) % userBitmapBits
	mask := uint64(1) << (bit % 64)
	if bitmap[bit/64]&mask == 0 {
		bitmap[bit/64] |= mask
		*occupied++
	}
}

func (s *stats) rotate(now time.Time) {
	day := statsUTCDate(now)
	if !day.After(s.windowStart) {
		return
	}
	s.history = append(s.history, statsDay{s.windowStart, s.daily, statsEstimate(s.occupied), s.dailyIncomplete})
	s.windowStart = day
	s.userBits = [userBitmapBits / 64]uint64{}
	s.occupied = 0
	s.daily = statsCounters{}
	s.dailyIncomplete = false
	s.trimHistory()
}

func (s *stats) trimHistory() {
	cutoff := s.windowStart.AddDate(0, 0, -maxStatsHistory)
	kept := s.history[:0]
	for _, day := range s.history {
		if !day.Day.Before(cutoff) && day.Day.Before(s.windowStart) {
			kept = append(kept, day)
		}
	}
	s.history = kept
	sort.Slice(s.history, func(i, j int) bool { return s.history[i].Day.Before(s.history[j].Day) })
	if len(s.history) > maxStatsHistory {
		s.history = append([]statsDay(nil), s.history[len(s.history)-maxStatsHistory:]...)
	}
}

func (s *stats) stableUserKey(fingerprint string) string {
	mac := hmac.New(sha256.New, s.seed[:])
	_, _ = mac.Write([]byte(fingerprint))
	return "h:" + hex.EncodeToString(mac.Sum(nil))
}

// userKey never stores the IP. Until the background loader selects the seed,
// only a bounded, memory-only SHA256 fingerprint waits to be re-keyed. The
// stable key feeds the cumulative sketch; record adds the UTC day for daily
// sketches, so cross-day uniques are not calculated by summing daily estimates.
func (s *stats) userKey(ip string, _ time.Time) string {
	fingerprint := sha256.Sum256([]byte(ip))
	value := hex.EncodeToString(fingerprint[:])
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.seedReady {
		return "p:" + value
	}
	return s.stableUserKey(value)
}

func (s *stats) observeUser(key string, day time.Time) {
	if key == "" {
		return
	}
	if strings.HasPrefix(key, "p:") {
		fingerprint := strings.TrimPrefix(key, "p:")
		if len(fingerprint) != 64 {
			return
		}
		if !s.seedReady {
			pending := pendingStatsUser{fingerprint, day}
			if _, exists := s.pendingUsers[pending]; !exists && len(s.pendingUsers) >= maxPendingStatsUsers {
				s.cumulativeIncomplete = true
				if day.Equal(s.windowStart) {
					s.dailyIncomplete = true
				}
				return
			}
			s.pendingUsers[pending] = struct{}{}
			return
		}
		key = s.stableUserKey(fingerprint)
	}
	statsSetBit(&s.cumulativeBits, &s.cumulativeOccupied, key)
	if day.Equal(s.windowStart) {
		statsSetBit(&s.userBits, &s.occupied, day.Format("2006-01-02")+":"+key)
	}
}

// record is memory-only. Neither disk operations nor file encoding occur while
// holding this lock. Caller-provided labels and counters have bounded storage.
func (s *stats) record(route string, status int, forwarded bool, upstreamFailure bool, clientKey string, now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.rotate(now)
	s.totalRequests = statsAdd(s.totalRequests, 1)
	if len(route) > 64 {
		route = "unknown"
	}
	if _, exists := s.routes[route]; !exists && len(s.routes) >= 31 {
		route = "unknown"
	}
	s.routes[route] = statsAdd(s.routes[route], 1)
	if status < 100 || status > 599 {
		status = 0
	}
	s.statuses[status] = statsAdd(s.statuses[status], 1)
	count := statsCounters{TotalRequests: 1}
	if forwarded {
		s.forwarded = statsAdd(s.forwarded, 1)
		count.ForwardedRequests = 1
	}
	if upstreamFailure {
		s.upstreamFailures = statsAdd(s.upstreamFailures, 1)
		count.UpstreamFailures = 1
	}
	day := statsUTCDate(now)
	if day.Equal(s.windowStart) {
		s.daily = addStatsCounters(s.daily, count)
	}
	s.observeUser(clientKey, day)
}

type anonymousUserStats struct {
	Estimate    uint64    `json:"estimate"`
	WindowStart time.Time `json:"window_start"`
	WindowEnd   time.Time `json:"window_end"`
	Method      string    `json:"method"`
	Occupancy   float64   `json:"occupancy"`
	Saturated   bool      `json:"saturated"`
	Incomplete  bool      `json:"incomplete"`
	Limitations string    `json:"limitations"`
}

func statsUserSnapshot(occupied uint64, start, end time.Time, incomplete bool) anonymousUserStats {
	occupancy := float64(occupied) / userBitmapBits
	return anonymousUserStats{Estimate: statsEstimate(occupied), WindowStart: start, WindowEnd: end, Method: "linear_counting_524288_bits", Occupancy: occupancy, Saturated: occupancy >= 0.95, Incomplete: incomplete, Limitations: "Approximate client-address count, not people. NAT can merge users; address changes can split users. Error grows with occupancy; saturation is unreliable. Cumulative uniques are independently estimated, not summed from daily counts. No raw addresses retained."}
}

type statsSnapshot struct {
	StartedAt                time.Time          `json:"started_at"`
	TotalRequests            uint64             `json:"total_requests"`
	Forwarded                uint64             `json:"forwarded_requests"`
	UpstreamFailures         uint64             `json:"upstream_failures"`
	Routes                   map[string]uint64  `json:"routes"`
	Statuses                 map[int]uint64     `json:"statuses"`
	AnonymousUsers           anonymousUserStats `json:"anonymous_users"`
	CumulativeAnonymousUsers anonymousUserStats `json:"cumulative_anonymous_users"`
	Daily                    statsDay           `json:"daily"`
	History                  []statsDay         `json:"history"`
	Persistence              statsPersistence   `json:"persistence"`
	Scope                    string             `json:"scope"`
	ResetsOnRestart          bool               `json:"resets_on_restart"`
}

func (s *stats) snapshot() any {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.rotate(time.Now())
	routes := make(map[string]uint64, len(s.routes))
	for route, count := range s.routes {
		routes[route] = count
	}
	statuses := make(map[int]uint64, len(s.statuses))
	for status, count := range s.statuses {
		statuses[status] = count
	}
	persistence := s.persistence
	persistence.Details = "Memory-only statistics reset on restart."
	if persistence.Enabled {
		persistence.Details = "Background persistence is best effort; changes since the last successful save can be lost. Load/save failures never block API requests. A missing or invalid store starts a new address-identity epoch."
	}
	return statsSnapshot{StartedAt: s.startedAt, TotalRequests: s.totalRequests, Forwarded: s.forwarded, UpstreamFailures: s.upstreamFailures, Routes: routes, Statuses: statuses,
		AnonymousUsers:           statsUserSnapshot(s.occupied, s.windowStart, s.windowStart.Add(24*time.Hour), s.dailyIncomplete || !s.seedReady),
		CumulativeAnonymousUsers: statsUserSnapshot(s.cumulativeOccupied, s.startedAt, time.Now().UTC(), s.cumulativeIncomplete || !s.seedReady),
		Daily:                    statsDay{s.windowStart, s.daily, statsEstimate(s.occupied), s.dailyIncomplete || !s.seedReady}, History: append([]statsDay{}, s.history...), Persistence: persistence,
		Scope:           "Requests observed by this relay only; direct Worker traffic is excluded. Totals are cumulative over the retained storage epoch; anonymous_users covers the UTC day. Health checks and administration are excluded.",
		ResetsOnRestart: !persistence.Enabled || !persistence.Ready || (!persistence.Restored && persistence.LastSaved.IsZero())}
}
