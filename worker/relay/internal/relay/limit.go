package relay

import (
	"math"
	"sync"
	"time"
)

type limitBucket struct {
	tokens   float64
	updated  time.Time
	lastSeen time.Time
}

// limiter never evicts an active or depleted bucket to admit a new identity.
// Refusing new identities at capacity keeps rotating client addresses from
// bypassing their limit or allocating unbounded server memory.
type limiter struct {
	mu            sync.Mutex
	buckets       map[string]limitBucket
	ratePerSecond float64
	burst         int
	capacity      int
	idle          time.Duration
	sweepInterval time.Duration
	lastSweep     time.Time
}

func newLimiter(ratePerMinute float64, burst int, capacity int, idle time.Duration) *limiter {
	interval := min(time.Minute, idle/2)
	if interval < time.Second {
		interval = time.Second
	}
	return &limiter{
		buckets:       make(map[string]limitBucket),
		ratePerSecond: ratePerMinute / 60,
		burst:         burst,
		capacity:      capacity,
		idle:          idle,
		sweepInterval: interval,
	}
}

func (l *limiter) refill(bucket limitBucket, now time.Time) float64 {
	elapsed := max(0, now.Sub(bucket.updated).Seconds())
	return math.Min(float64(l.burst), bucket.tokens+elapsed*l.ratePerSecond)
}

func (l *limiter) sweep(now time.Time) {
	for key, bucket := range l.buckets {
		if now.Sub(bucket.lastSeen) >= l.idle && l.refill(bucket, now) >= float64(l.burst) {
			delete(l.buckets, key)
		}
	}
	l.lastSweep = now
}

func (l *limiter) take(key string, cost int, now time.Time) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if cost <= 0 || cost > l.burst || l.ratePerSecond <= 0 {
		return false, l.idle
	}
	if l.lastSweep.IsZero() || now.Sub(l.lastSweep) >= l.sweepInterval {
		l.sweep(now)
	}
	bucket, exists := l.buckets[key]
	if !exists {
		if len(l.buckets) >= l.capacity {
			return false, max(time.Second, l.sweepInterval-now.Sub(l.lastSweep))
		}
		bucket = limitBucket{tokens: float64(l.burst), updated: now, lastSeen: now}
	}
	bucket.tokens = l.refill(bucket, now)
	// Ignore clock regressions; moving the refill origin backwards would mint
	// extra tokens when the clock catches up.
	if now.After(bucket.updated) {
		bucket.updated = now
	}
	if now.After(bucket.lastSeen) {
		bucket.lastSeen = now
	}
	if bucket.tokens < float64(cost) {
		l.buckets[key] = bucket
		// Extremely low configured rates can exceed time.Duration's range.
		// A bounded retry hint stays positive without changing token accounting.
		seconds := math.Min((float64(cost)-bucket.tokens)/l.ratePerSecond, (24 * time.Hour).Seconds())
		retry := time.Duration(math.Ceil(seconds * float64(time.Second)))
		return false, max(time.Nanosecond, retry)
	}
	bucket.tokens -= float64(cost)
	l.buckets[key] = bucket
	return true, 0
}
