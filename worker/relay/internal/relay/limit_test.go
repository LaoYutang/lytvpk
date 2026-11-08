package relay

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestLimiterTinyRateKeepsRetryHintPositive(t *testing.T) {
	l := newLimiter(1e-200, 1, 1, time.Minute)
	now := time.Now()
	if ok, _ := l.take("client", 1, now); !ok {
		t.Fatal("initial token rejected")
	}
	if ok, retry := l.take("client", 1, now); ok || retry != 24*time.Hour {
		t.Fatalf("tiny rate: ok=%v retry=%v", ok, retry)
	}
}

func TestLimiterRefillAndRejectedRequests(t *testing.T) {
	l := newLimiter(600, 1, 10, 10*time.Minute)
	start := time.Date(2026, time.November, 8, 0, 0, 0, 0, time.UTC)
	if ok, _ := l.take("client", 1, start); !ok {
		t.Fatal("initial token rejected")
	}
	for _, elapsed := range []time.Duration{25 * time.Millisecond, 50 * time.Millisecond} {
		ok, retry := l.take("client", 1, start.Add(elapsed))
		if ok {
			t.Fatalf("accepted before refill after %v", elapsed)
		}
		want := 100*time.Millisecond - elapsed
		if retry < want-time.Microsecond || retry > want+time.Microsecond {
			t.Fatalf("retry after %v = %v, want %v", elapsed, retry, want)
		}
	}
	if ok, _ := l.take("client", 1, start.Add(100*time.Millisecond)); !ok {
		t.Fatal("repeated rejections delayed token refill")
	}
}

func TestLimiterWeightedCostAndBurstBound(t *testing.T) {
	l := newLimiter(60, 5, 10, 10*time.Minute)
	start := time.Now()
	if ok, _ := l.take("client", 4, start); !ok {
		t.Fatal("weighted request within burst rejected")
	}
	if ok, retry := l.take("client", 2, start); ok || retry < time.Second-time.Microsecond {
		t.Fatalf("weighted excess accepted or retry too short: ok=%v retry=%v", ok, retry)
	}
	if ok, _ := l.take("client", 2, start.Add(time.Second)); !ok {
		t.Fatal("weighted request rejected after refill")
	}
	if ok, _ := l.take("client", 6, start.Add(time.Hour)); ok {
		t.Fatal("cost above burst accepted")
	}
	if ok, _ := l.take("client", 5, start.Add(time.Hour)); !ok {
		t.Fatal("impossible weighted request consumed tokens")
	}
}

func TestLimiterCapacityPreservesExistingBuckets(t *testing.T) {
	l := newLimiter(60, 2, 1, 10*time.Minute)
	start := time.Now()
	if ok, _ := l.take("existing", 2, start); !ok {
		t.Fatal("initial bucket rejected")
	}
	if ok, retry := l.take("new", 1, start); ok || retry <= 0 {
		t.Fatalf("capacity overflow: ok=%v retry=%v", ok, retry)
	}
	if ok, _ := l.take("existing", 1, start); ok {
		t.Fatal("capacity overflow evicted an existing depleted bucket")
	}
	if ok, _ := l.take("new", 1, start.Add(6*time.Minute)); ok {
		t.Fatal("full but non-idle bucket was evicted")
	}
	if ok, _ := l.take("new", 1, start.Add(11*time.Minute)); !ok {
		t.Fatal("idle, refilled bucket was not reclaimed")
	}
}

func TestLimiterDoesNotEvictIdleDepletedBuckets(t *testing.T) {
	l := newLimiter(1, 10, 1, time.Second)
	start := time.Now()
	if ok, _ := l.take("existing", 10, start); !ok {
		t.Fatal("initial request rejected")
	}
	if ok, _ := l.take("new", 1, start.Add(2*time.Minute)); ok {
		t.Fatal("depleted bucket evicted despite not being fully refilled")
	}
	if ok, _ := l.take("existing", 3, start.Add(2*time.Minute)); ok {
		t.Fatal("existing depleted bucket was reset")
	}
}

func TestLimiterConcurrentRequestsCannotExceedBurst(t *testing.T) {
	l := newLimiter(60, 10, 10, time.Minute)
	start := time.Now()
	var accepted atomic.Int64
	var wg sync.WaitGroup
	for range 100 {
		wg.Go(func() {
			if ok, _ := l.take("shared", 1, start); ok {
				accepted.Add(1)
			}
		})
	}
	wg.Wait()
	if got := accepted.Load(); got != 10 {
		t.Fatalf("accepted %d concurrent requests, want exactly 10", got)
	}
}

func TestLimiterClockRegressionDoesNotCreateTokens(t *testing.T) {
	l := newLimiter(60, 2, 10, 10*time.Minute)
	start := time.Now()
	for _, elapsed := range []time.Duration{0, time.Second, 500 * time.Millisecond} {
		if ok, _ := l.take("client", 1, start.Add(elapsed)); !ok {
			t.Fatalf("expected available token after %v", elapsed)
		}
	}
	if ok, _ := l.take("client", 1, start.Add(time.Second)); ok {
		t.Fatal("clock regression moved refill origin backwards and created a token")
	}
	if ok, _ := l.take("client", 1, start.Add(2*time.Second)); !ok {
		t.Fatal("token did not refill after the clock caught up")
	}
}
