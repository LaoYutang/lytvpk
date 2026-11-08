// Package relay provides the bounded, fixed-upstream backup API for LytVPK.
package relay

import (
	"fmt"
	"math"
	"net/netip"
	"path/filepath"
	"time"
)

type Config struct {
	PerClientRatePerMinute float64
	PerClientBurst         int
	GlobalRatePerMinute    float64
	GlobalBurst            int
	MaxClients             int
	ClientIdleTTL          time.Duration
	MaxConcurrent          int
	MaxConcurrentPerClient int
	MaxQueued              int
	MaxQueuedPerClient     int
	QueueTimeout           time.Duration
	RequestTimeout         time.Duration
	UpstreamTimeout        time.Duration
	StatsFile              string
	StatsFlushInterval     time.Duration
	MaxBodyBytes           int64
	MaxResponseBytes       int64
	MaxParseIDs            int
	TrustedProxies         []netip.Prefix
	RealIPHeader           string
}

func DefaultConfig() Config {
	return Config{
		PerClientRatePerMinute: 50, PerClientBurst: 500,
		GlobalRatePerMinute: 600, GlobalBurst: 1000,
		MaxClients: 20000, ClientIdleTTL: 10 * time.Minute,
		MaxConcurrent: 32, MaxConcurrentPerClient: 16,
		MaxQueued: 1024, MaxQueuedPerClient: 500, QueueTimeout: 5 * time.Second,
		RequestTimeout: 10 * time.Second, UpstreamTimeout: 10 * time.Second,
		StatsFlushInterval: 5 * time.Second, MaxBodyBytes: 64 << 10,
		MaxResponseBytes: 8 << 20, MaxParseIDs: 1000,
		RealIPHeader: "X-Real-IP",
	}
}

func (c Config) validate() error {
	if math.IsNaN(c.PerClientRatePerMinute) || math.IsInf(c.PerClientRatePerMinute, 0) ||
		math.IsNaN(c.GlobalRatePerMinute) || math.IsInf(c.GlobalRatePerMinute, 0) ||
		c.PerClientRatePerMinute <= 0 || c.PerClientRatePerMinute > 1e6 ||
		c.GlobalRatePerMinute <= 0 || c.GlobalRatePerMinute > 1e6 {
		return fmt.Errorf("rates must be finite and in (0, 1000000]")
	}
	if c.PerClientBurst < 1 || c.PerClientBurst > 1000000 || c.GlobalBurst < 1 || c.GlobalBurst > 1000000 ||
		c.MaxClients < 1 || c.MaxClients > 1000000 || c.MaxConcurrent < 1 || c.MaxConcurrent > 256 ||
		c.MaxConcurrentPerClient < 1 || c.MaxConcurrentPerClient > c.MaxConcurrent {
		return fmt.Errorf("invalid burst, client capacity or concurrency limit")
	}
	if c.MaxQueued < 0 || c.MaxQueued > 4096 || c.MaxQueuedPerClient < 0 || c.MaxQueuedPerClient > c.MaxQueued ||
		(c.MaxQueued > 0 && c.MaxQueuedPerClient == 0) || c.QueueTimeout < time.Millisecond || c.QueueTimeout > 10*time.Second {
		return fmt.Errorf("invalid queue capacity or timeout")
	}
	if c.ClientIdleTTL < time.Second || c.ClientIdleTTL > 24*time.Hour ||
		c.RequestTimeout < time.Millisecond || c.RequestTimeout > 10*time.Second ||
		c.StatsFlushInterval < 10*time.Millisecond || c.StatsFlushInterval > time.Minute ||
		c.UpstreamTimeout < time.Millisecond || c.UpstreamTimeout > 2*time.Minute ||
		c.MaxBodyBytes < 1 || c.MaxBodyBytes > 1<<20 || c.MaxResponseBytes < 1 || c.MaxResponseBytes > 32<<20 ||
		c.MaxParseIDs < 1 || c.MaxParseIDs > 1000 {
		return fmt.Errorf("invalid idle TTL, request timeout (maximum 10s), stats interval, upstream timeout, body, response or batch limit")
	}
	if c.RealIPHeader != "X-Real-IP" && c.RealIPHeader != "CF-Connecting-IP" {
		return fmt.Errorf("real IP header must be X-Real-IP or CF-Connecting-IP")
	}
	if c.StatsFile != "" && (!filepath.IsAbs(c.StatsFile) || len(c.StatsFile) > 4096) {
		return fmt.Errorf("stats file must be an absolute path of at most 4096 bytes")
	}
	for _, prefix := range c.TrustedProxies {
		if !prefix.IsValid() || prefix.Addr().Is4In6() {
			return fmt.Errorf("invalid trusted proxy prefix")
		}
		if !prefix.Addr().IsLoopback() || (prefix.Addr().Is4() && prefix.Bits() < 8) || (prefix.Addr().Is6() && prefix.Bits() != 128) {
			return fmt.Errorf("trusted proxies must contain only loopback addresses")
		}
	}
	return nil
}
