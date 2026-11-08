package relay

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type relayRoundTripFunc func(*http.Request) (*http.Response, error)

func (f relayRoundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func relayResponse(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}
}

func newTestRelay(t *testing.T, configure func(*Config), trip relayRoundTripFunc) *Server {
	t.Helper()
	c := DefaultConfig()
	if configure != nil {
		configure(&c)
	}
	s, err := New(c)
	if err != nil {
		t.Fatal(err)
	}
	if trip == nil {
		trip = func(*http.Request) (*http.Response, error) { return relayResponse(200, `{"ok":true}`), nil }
	}
	s.client.Transport = trip
	return s
}

func relayRequest(method, target, body, peer string) *http.Request {
	r := httptest.NewRequest(method, target, strings.NewReader(body))
	if peer == "" {
		peer = "198.51.100.20:4321"
	}
	r.RemoteAddr = peer
	if method == http.MethodPost {
		r.Header.Set("Content-Type", "application/json")
	}
	return r
}

func serveRelay(s *Server, r *http.Request) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	return w
}

func TestRelayFixedUpstreamsAndResponseCompatibility(t *testing.T) {
	tests := []struct {
		name, method, target, body, host, path, response string
	}{
		{"list", "GET", "/list?page=0&q=%E5%9C%B0%E5%9B%BE&sort=trend&tags=Map%2CCampaign&filetype=0", "", "l4d2-workshop.laoyutang.cn", "/list", `{"response":{"publishedfiledetails":[{"publishedfileid":"18446744073709551615"}],"total":1}}`},
		{"detail", "GET", "/detail?id=18446744073709551615&with_previews=TRUE", "", "l4d2-workshop.laoyutang.cn", "/detail", `{"response":{"publishedfiledetails":[{"file_size":"9007199254740993","previews":[]}]}}`},
		{"parse", "POST", "/parse", " [9007199254740993,\"18446744073709551615\"] \n", "l4d2-workshop-parse.laoyutang.cn", "/", `[{"result":1,"file_size":"9007199254740993","children":[]}]`},
		{"parse-root-alias", "POST", "/", "[123]", "l4d2-workshop-parse.laoyutang.cn", "/", `[{"result":0,"file_type":2}]`},
		{"map", "GET", "/maps/c1m1_hotel", "", "l4d2-maps.laoyutang.cn", "/c1m1_hotel", "\n死亡中心\n"},
		{"ips", "GET", "/ips?domain=cdn.steamusercontent.com&format=entries", "", "lytvpk-get-ips.laoyutang.cn", "/", `[{"ip":"23.59.72.59","category":"内置"}]`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			calls := 0
			s := newTestRelay(t, nil, func(r *http.Request) (*http.Response, error) {
				calls++
				if r.Method != tt.method || r.URL.Scheme != "https" || r.URL.Host != tt.host || r.URL.Path != tt.path {
					t.Errorf("unexpected upstream: %s %s", r.Method, r.URL)
				}
				if r.URL.User != nil || r.URL.Fragment != "" {
					t.Errorf("unexpected URL identity or fragment: %s", r.URL)
				}
				if tt.body != "" {
					body, err := io.ReadAll(r.Body)
					if err != nil || string(body) != tt.body {
						t.Errorf("request bytes changed: %q, %v", body, err)
					}
					if r.Header.Get("Content-Type") != "application/json" {
						t.Errorf("parse Content-Type: %q", r.Header.Get("Content-Type"))
					}
				}
				resp := relayResponse(200, tt.response)
				resp.Header.Set("Content-Type", "text/plain; charset=utf-8")
				resp.Header.Set("Cache-Control", "public,max-age=3600")
				resp.Header.Set("ETag", `"original"`)
				return resp, nil
			})
			w := serveRelay(s, relayRequest(tt.method, tt.target, tt.body, ""))
			if w.Code != 200 || w.Body.String() != tt.response || calls != 1 {
				t.Fatalf("response code=%d calls=%d body=%s", w.Code, calls, w.Body.String())
			}
			if w.Header().Get("ETag") != `"original"` || w.Header().Get("Cache-Control") != "public,max-age=3600" || w.Header().Get("Content-Type") != "text/plain; charset=utf-8" {
				t.Errorf("upstream headers changed: %v", w.Header())
			}
		})
	}
}

func TestRelayPreservesUpstreamErrorsAndDoesNotFollowRedirects(t *testing.T) {
	for _, status := range []int{204, 304, 400, 403, 404, 429, 500, 502, 503, 307} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			calls := 0
			body := "original upstream response"
			if status == 204 || status == 304 {
				body = ""
			}
			s := newTestRelay(t, nil, func(*http.Request) (*http.Response, error) {
				calls++
				r := relayResponse(status, body)
				r.Header.Set("Retry-After", "Wed, 21 Oct 2030 07:28:00 GMT")
				r.Header.Set("Location", "http://127.0.0.1:1/secrets")
				return r, nil
			})
			w := serveRelay(s, relayRequest("GET", "/detail?id=123", "", ""))
			if w.Code != status || w.Body.String() != body || calls != 1 {
				t.Fatalf("got %d body=%q calls=%d", w.Code, w.Body.String(), calls)
			}
			if w.Header().Get("Retry-After") != "Wed, 21 Oct 2030 07:28:00 GMT" {
				t.Error("Retry-After was changed")
			}
		})
	}
}

func TestRelayRejectsInvalidRequestsBeforeUpstream(t *testing.T) {
	tests := []struct {
		name, method, target, body, contentType, encoding string
		status                                            int
	}{
		{"unknown", "GET", "/proxy?url=http://127.0.0.1", "", "", "", 404},
		{"stats-hidden", "GET", "/stats", "", "", "", 404},
		{"bad-method", "PUT", "/list", "", "", "", 405},
		{"head-not-supported", "HEAD", "/list", "", "", "", 405},
		{"parse-method", "GET", "/parse", "", "", "", 405},
		{"arbitrary-url", "GET", "/list?url=https://evil.example/", "", "", "", 400},
		{"query-duplicate", "GET", "/detail?id=123&id=456", "", "", "", 400},
		{"escaped-map-separator", "GET", "/maps/x%2fy", "", "", "", 400},
		{"escaped-map-parent", "GET", "/maps/%2e%2e", "", "", "", 400},
		{"map-parent", "GET", "/maps/../secret", "", "", "", 400},
		{"nested-map", "GET", "/maps/c1/m1", "", "", "", 400},
		{"wrong-domain", "GET", "/ips?domain=localhost", "", "", "", 400},
		{"get-body", "GET", "/list", "{}", "", "", 400},
		{"bad-json", "POST", "/parse", "[123]{}", "application/json", "", 400},
		{"bad-id", "POST", "/parse", "[1e3]", "application/json", "", 400},
		{"wrong-content-type", "POST", "/parse", "[123]", "text/plain", "", 415},
		{"compressed-request", "POST", "/parse", "[123]", "application/json", "gzip", 415},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := newTestRelay(t, nil, func(*http.Request) (*http.Response, error) {
				t.Error("invalid request reached upstream")
				return relayResponse(200, "bad"), nil
			})
			r := relayRequest(tt.method, tt.target, tt.body, "")
			if tt.contentType != "" {
				r.Header.Set("Content-Type", tt.contentType)
			}
			if tt.encoding != "" {
				r.Header.Set("Content-Encoding", tt.encoding)
			}
			w := serveRelay(s, r)
			if w.Code != tt.status {
				t.Fatalf("got %d want %d: %s", w.Code, tt.status, w.Body.String())
			}
			if tt.method != "HEAD" && !json.Valid(w.Body.Bytes()) {
				t.Errorf("error is not JSON: %q", w.Body.String())
			}
		})
	}
}

func TestRelayBoundsRequestAndResponseBodies(t *testing.T) {
	t.Run("request-content-length", func(t *testing.T) {
		s := newTestRelay(t, func(c *Config) { c.MaxBodyBytes = 5 }, func(*http.Request) (*http.Response, error) {
			t.Error("oversized body forwarded")
			return relayResponse(200, "bad"), nil
		})
		w := serveRelay(s, relayRequest("POST", "/parse", "[12345]", ""))
		if w.Code != 413 {
			t.Fatalf("got %d: %s", w.Code, w.Body.String())
		}
	})
	t.Run("request-chunked", func(t *testing.T) {
		s := newTestRelay(t, func(c *Config) { c.MaxBodyBytes = 5 }, func(*http.Request) (*http.Response, error) {
			t.Error("oversized body forwarded")
			return relayResponse(200, "bad"), nil
		})
		r := relayRequest("POST", "/parse", "[12345]", "")
		r.ContentLength = -1
		w := serveRelay(s, r)
		if w.Code != 413 {
			t.Fatalf("got %d: %s", w.Code, w.Body.String())
		}
	})
	for _, declared := range []int64{-1, 100} {
		t.Run(fmt.Sprintf("response-length-%d", declared), func(t *testing.T) {
			s := newTestRelay(t, func(c *Config) { c.MaxResponseBytes = 5 }, func(*http.Request) (*http.Response, error) {
				r := relayResponse(200, "123456")
				r.ContentLength = declared
				return r, nil
			})
			w := serveRelay(s, relayRequest("GET", "/list", "", ""))
			if w.Code != 502 || !json.Valid(w.Body.Bytes()) {
				t.Fatalf("got %d: %s", w.Code, w.Body.String())
			}
		})
	}
}

func TestRelayDropsSensitiveAndHopByHopHeaders(t *testing.T) {
	s := newTestRelay(t, nil, func(r *http.Request) (*http.Response, error) {
		for _, key := range []string{"Authorization", "Cookie", "Proxy-Authorization", "Forwarded", "X-Forwarded-For", "X-Real-IP", "CF-Connecting-IP", "Connection", "Upgrade", "X-Private", "Accept"} {
			if value := r.Header.Get(key); value != "" {
				t.Errorf("forwarded forbidden %s=%s", key, value)
			}
		}
		if r.UserAgent() != "lytvpk-relay/1" || r.Header.Get("If-None-Match") != `"cached"` || r.Header.Get("Accept-Language") != "zh-CN" {
			t.Errorf("missing safe headers: %v", r.Header)
		}
		resp := relayResponse(200, "okay")
		resp.Header.Set("Connection", "X-Internal")
		resp.Header.Set("X-Internal", "secret")
		resp.Header.Set("Keep-Alive", "timeout=5")
		resp.Header.Set("Transfer-Encoding", "chunked")
		return resp, nil
	})
	r := relayRequest("GET", "/list", "", "")
	for _, key := range []string{"Authorization", "Cookie", "Proxy-Authorization", "Forwarded", "X-Forwarded-For", "X-Real-IP", "CF-Connecting-IP", "Upgrade", "X-Private"} {
		r.Header.Set(key, "untrusted")
	}
	r.Header.Set("Connection", "X-Private, Accept")
	r.Header.Set("Accept", "text/plain")
	r.Header.Set("User-Agent", "untrusted")
	r.Header.Set("If-None-Match", `"cached"`)
	r.Header.Set("Accept-Language", "zh-CN")
	w := serveRelay(s, r)
	if w.Code != 200 {
		t.Fatalf("got %d: %s", w.Code, w.Body.String())
	}
	for _, key := range []string{"Connection", "X-Internal", "Keep-Alive", "Transfer-Encoding"} {
		if w.Header().Get(key) != "" {
			t.Errorf("forwarded hop-by-hop response header %s", key)
		}
	}
}

type relayContextBody struct{ ctx context.Context }

func (b relayContextBody) Read([]byte) (int, error) { <-b.ctx.Done(); return 0, b.ctx.Err() }
func (relayContextBody) Close() error               { return nil }

type relayErrorBody struct{}

func (relayErrorBody) Read([]byte) (int, error) { return 0, io.ErrUnexpectedEOF }
func (relayErrorBody) Close() error             { return nil }

func TestRelayUpstreamFailuresAndTimeouts(t *testing.T) {
	tests := []struct {
		name   string
		status int
		trip   relayRoundTripFunc
	}{
		{"network", 502, func(*http.Request) (*http.Response, error) { return nil, errors.New("dial failed") }},
		{"deadline-before-headers", 504, func(r *http.Request) (*http.Response, error) { <-r.Context().Done(); return nil, r.Context().Err() }},
		{"deadline-reading-body", 504, func(r *http.Request) (*http.Response, error) {
			resp := relayResponse(200, "")
			resp.Body = relayContextBody{r.Context()}
			return resp, nil
		}},
		{"truncated-body", 502, func(*http.Request) (*http.Response, error) {
			resp := relayResponse(200, "")
			resp.Body = relayErrorBody{}
			return resp, nil
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := newTestRelay(t, func(c *Config) { c.UpstreamTimeout = 20 * time.Millisecond }, tt.trip)
			start := time.Now()
			w := serveRelay(s, relayRequest("GET", "/list", "", ""))
			if w.Code != tt.status || !json.Valid(w.Body.Bytes()) {
				t.Fatalf("got %d want %d: %s", w.Code, tt.status, w.Body.String())
			}
			if time.Since(start) > time.Second {
				t.Fatal("upstream timeout was not bounded")
			}
		})
	}
}

func TestRelayClientAndGlobalRateLimits(t *testing.T) {
	for _, global := range []bool{false, true} {
		t.Run(fmt.Sprint("global=", global), func(t *testing.T) {
			s := newTestRelay(t, func(c *Config) {
				if global {
					c.GlobalBurst = 1
				} else {
					c.PerClientBurst = 1
				}
			}, nil)
			s.now = func() time.Time { return time.Date(2026, 11, 8, 0, 0, 0, 0, time.UTC) }
			if w := serveRelay(s, relayRequest("GET", "/list", "", "198.51.100.1:1")); w.Code != 200 {
				t.Fatal(w.Code, w.Body.String())
			}
			peer := "198.51.100.1:2"
			if global {
				peer = "198.51.100.2:2"
			}
			w := serveRelay(s, relayRequest("GET", "/detail?id=123", "", peer))
			if w.Code != 429 || w.Header().Get("Retry-After") == "" {
				t.Fatalf("got %d headers=%v body=%s", w.Code, w.Header(), w.Body.String())
			}
		})
	}
}

func TestRelayTrustedProxyIdentityCannotBeSpoofed(t *testing.T) {
	t.Run("untrusted-headers-ignored", func(t *testing.T) {
		s := newTestRelay(t, func(c *Config) { c.PerClientBurst = 1 }, nil)
		for i, want := range []int{200, 429} {
			r := relayRequest("GET", "/list", "", "198.51.100.1:123")
			r.Header.Set("X-Real-IP", fmt.Sprintf("203.0.113.%d", i+1))
			r.Header.Set("CF-Connecting-IP", fmt.Sprintf("203.0.113.%d", i+10))
			r.Header.Set("X-Forwarded-For", fmt.Sprintf("203.0.113.%d", i+20))
			if w := serveRelay(s, r); w.Code != want {
				t.Fatalf("got %d want %d: %s", w.Code, want, w.Body.String())
			}
		}
	})
	t.Run("explicit-local-proxy", func(t *testing.T) {
		s := newTestRelay(t, func(c *Config) {
			c.PerClientBurst = 1
			c.TrustedProxies = []netip.Prefix{netip.MustParsePrefix("127.0.0.1/32")}
		}, nil)
		for _, value := range []string{"203.0.113.1", "203.0.113.2"} {
			r := relayRequest("GET", "/list", "", "127.0.0.1:123")
			r.Header.Set("X-Real-IP", value)
			if w := serveRelay(s, r); w.Code != 200 {
				t.Fatalf("trusted client got %d: %s", w.Code, w.Body.String())
			}
		}
		r := relayRequest("GET", "/list", "", "127.0.0.1:123")
		r.Header.Set("X-Real-IP", "203.0.113.1")
		r.Header.Set("CF-Connecting-IP", "203.0.113.99")
		r.Header.Set("X-Forwarded-For", "203.0.113.98")
		if w := serveRelay(s, r); w.Code != 429 {
			t.Fatalf("other headers changed selected client: %d", w.Code)
		}
	})
	for _, value := range []string{"203.0.113.1, 203.0.113.2", "not-an-ip", "203.0.113.1:80", "fe80::1%eth0"} {
		t.Run(value, func(t *testing.T) {
			s := newTestRelay(t, func(c *Config) {
				c.TrustedProxies = []netip.Prefix{netip.MustParsePrefix("127.0.0.1/32")}
			}, nil)
			r := relayRequest("GET", "/list", "", "127.0.0.1:123")
			r.Header.Set("X-Real-IP", value)
			if w := serveRelay(s, r); w.Code != 400 {
				t.Fatalf("invalid forwarded identity accepted: %d: %s", w.Code, w.Body.String())
			}
		})
	}
}

func TestRelayConcurrentLimitsReleaseOnCompletionAndCancel(t *testing.T) {
	for _, perClient := range []bool{false, true} {
		t.Run(fmt.Sprint("per-client=", perClient), func(t *testing.T) {
			entered := make(chan struct{}, 2)
			release := make(chan struct{})
			var calls atomic.Int32
			s := newTestRelay(t, func(c *Config) {
				c.MaxConcurrent = 1
				c.MaxConcurrentPerClient = 1
				c.MaxQueued = 0
				c.MaxQueuedPerClient = 0
				if perClient {
					c.MaxConcurrent = 2
				}
			}, func(r *http.Request) (*http.Response, error) {
				if calls.Add(1) == 1 {
					entered <- struct{}{}
					select {
					case <-release:
					case <-r.Context().Done():
						return nil, r.Context().Err()
					}
				}
				return relayResponse(200, "okay"), nil
			})
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			var workers sync.WaitGroup
			var first *httptest.ResponseRecorder
			workers.Go(func() { first = serveRelay(s, relayRequest("GET", "/list", "", "198.51.100.1:1").WithContext(ctx)) })
			select {
			case <-entered:
			case <-time.After(time.Second):
				close(release)
				workers.Wait()
				t.Fatal("first request did not enter upstream")
			}
			peer := "198.51.100.2:2"
			if perClient {
				peer = "198.51.100.1:2"
			}
			blocked := serveRelay(s, relayRequest("GET", "/list", "", peer))
			if blocked.Code != 429 || blocked.Header().Get("Retry-After") == "" {
				t.Errorf("concurrent request not rejected: %d %s", blocked.Code, blocked.Body.String())
			}
			if perClient {
				cancel()
			} else {
				close(release)
			}
			workers.Wait()
			if !perClient && first.Code != 200 {
				t.Errorf("first request failed: %d %s", first.Code, first.Body.String())
			}
			if perClient && first.Code != 499 {
				t.Errorf("canceled request should be classified separately: %d %s", first.Code, first.Body.String())
			}
			if w := serveRelay(s, relayRequest("GET", "/list", "", "198.51.100.1:3")); w.Code != 200 {
				t.Fatalf("slot leaked after completion/cancel: %d %s", w.Code, w.Body.String())
			}
		})
	}
}

func TestRelayDoesNotCountClientCancellationAsUpstreamFailure(t *testing.T) {
	for _, readingBody := range []bool{false, true} {
		t.Run(fmt.Sprint("reading-body=", readingBody), func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			s := newTestRelay(t, nil, func(r *http.Request) (*http.Response, error) {
				cancel()
				if readingBody {
					resp := relayResponse(200, "")
					resp.Body = relayContextBody{r.Context()}
					return resp, nil
				}
				return nil, context.Canceled
			})
			w := serveRelay(s, relayRequest("GET", "/list", "", "").WithContext(ctx))
			if w.Code != 499 {
				t.Fatalf("client cancellation classified as %d: %s", w.Code, w.Body.String())
			}
			encoded, err := json.Marshal(s.stats.snapshot())
			if err != nil {
				t.Fatal(err)
			}
			var stats map[string]any
			if err := json.Unmarshal(encoded, &stats); err != nil {
				t.Fatal(err)
			}
			if stats["forwarded_requests"] != float64(1) || stats["upstream_failures"] != float64(0) {
				t.Fatalf("client disconnect inflated upstream failures: %s", encoded)
			}
		})
	}
}

func TestRelayDefaultLimitAllowsExistingLargeLibraryBurst(t *testing.T) {
	s := newTestRelay(t, nil, nil)
	s.now = func() time.Time { return time.Date(2026, 11, 8, 0, 0, 0, 0, time.UTC) }
	for i := range 500 {
		w := serveRelay(s, relayRequest("GET", fmt.Sprintf("/detail?id=%d", i+1), "", ""))
		if w.Code != 200 {
			t.Fatalf("existing Worker-compatible burst failed at %d: %d %s", i+1, w.Code, w.Body.String())
		}
	}
	if w := serveRelay(s, relayRequest("GET", "/detail?id=501", "", "")); w.Code != 429 {
		t.Fatalf("burst limit missing: %d %s", w.Code, w.Body.String())
	}
}

func TestRelayParseBatchConsumesUpstreamChunkBudget(t *testing.T) {
	for _, global := range []bool{false, true} {
		t.Run(fmt.Sprint("global=", global), func(t *testing.T) {
			s := newTestRelay(t, func(c *Config) {
				if global {
					c.GlobalBurst = 2
				} else {
					c.PerClientBurst = 2
				}
			}, func(*http.Request) (*http.Response, error) {
				t.Error("three-chunk request exceeded the two-unit budget")
				return relayResponse(200, "bad"), nil
			})
			body := "[" + strings.Repeat("123,", 200) + "123]"
			w := serveRelay(s, relayRequest("POST", "/parse", body, ""))
			if w.Code != 429 || w.Header().Get("Retry-After") == "" {
				t.Fatalf("chunk budget not enforced: %d %s", w.Code, w.Body.String())
			}
		})
	}
}

func TestRelayHealthOptionsAndPrivateStats(t *testing.T) {
	var calls atomic.Int32
	s := newTestRelay(t, nil, func(*http.Request) (*http.Response, error) {
		calls.Add(1)
		return relayResponse(503, `{"error":"unavailable"}`), nil
	})
	for _, target := range []string{"/list", "/detail?id=123", "/parse", "/maps/c1m1_hotel", "/ips"} {
		w := serveRelay(s, relayRequest("OPTIONS", target, "", ""))
		if w.Code < 200 || w.Code >= 300 || w.Header().Get("Access-Control-Allow-Origin") != "*" {
			t.Fatalf("preflight failed: %s %d %v", target, w.Code, w.Header())
		}
	}
	if w := serveRelay(s, relayRequest("GET", "/healthz", "", "")); w.Code != 200 {
		t.Fatalf("health failed: %d", w.Code)
	}
	if calls.Load() != 0 {
		t.Fatal("health/options contacted upstream")
	}
	serveRelay(s, relayRequest("GET", "/list", "", "198.51.100.27:1"))
	serveRelay(s, relayRequest("GET", "/no-such-route", "", "198.51.100.28:1"))
	w := httptest.NewRecorder()
	s.AdminHandler().ServeHTTP(w, relayRequest("GET", "/stats", "", "127.0.0.1:1"))
	if w.Code != 200 || !json.Valid(w.Body.Bytes()) {
		t.Fatalf("stats failed: %d %s", w.Code, w.Body.String())
	}
	var data map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &data); err != nil {
		t.Fatal(err)
	}
	if data["forwarded_requests"] != float64(1) || data["total_requests"] != float64(7) {
		t.Errorf("unexpected counters: %s", w.Body.String())
	}
	if bytes.Contains(w.Body.Bytes(), []byte("198.51.100.27")) || bytes.Contains(w.Body.Bytes(), []byte("198.51.100.28")) {
		t.Fatal("stats exposes raw user IP")
	}
	if w := serveRelay(s, relayRequest("GET", "/stats", "", "127.0.0.1:1")); w.Code != 404 {
		t.Fatal("stats exposed on public API")
	}
}

func TestRelayRealHTTPClientBoundsSlowHeadersAndBody(t *testing.T) {
	for _, slowBody := range []bool{false, true} {
		t.Run(fmt.Sprint("slow-body=", slowBody), func(t *testing.T) {
			finished := make(chan struct{})
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				defer close(finished)
				if slowBody {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(200)
					_, _ = io.WriteString(w, "[")
					w.(http.Flusher).Flush()
				}
				<-r.Context().Done()
			}))
			defer upstream.Close()
			transport := &http.Transport{Proxy: nil}
			defer transport.CloseIdleConnections()
			s := newTestRelay(t, func(c *Config) { c.UpstreamTimeout = 40 * time.Millisecond }, func(r *http.Request) (*http.Response, error) {
				// Redirect only the test transport's socket to the local fixture.
				// Production URL selection remains fixed and is tested separately.
				local := r.Clone(r.Context())
				local.URL.Scheme = "http"
				local.URL.Host = strings.TrimPrefix(upstream.URL, "http://")
				return transport.RoundTrip(local)
			})
			start := time.Now()
			w := serveRelay(s, relayRequest("GET", "/list", "", ""))
			if w.Code != 504 || !json.Valid(w.Body.Bytes()) || time.Since(start) > time.Second {
				t.Fatalf("slow upstream escaped deadline: code=%d elapsed=%v body=%s", w.Code, time.Since(start), w.Body.String())
			}
			select {
			case <-finished:
			case <-time.After(time.Second):
				t.Fatal("deadline did not close upstream request")
			}
			if s.active != 0 || len(s.byClient) != 0 {
				t.Fatal("deadline leaked a concurrency slot")
			}
		})
	}
}

func TestRelayAdminRejectsNonLoopbackRegardlessOfHeaders(t *testing.T) {
	s := newTestRelay(t, nil, nil)
	r := relayRequest("GET", "/stats", "", "198.51.100.1:1")
	r.Header.Set("X-Real-IP", "127.0.0.1")
	r.Header.Set("CF-Connecting-IP", "127.0.0.1")
	r.Header.Set("X-Forwarded-For", "127.0.0.1")
	w := httptest.NewRecorder()
	s.AdminHandler().ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatalf("management accepted external peer: %d %s", w.Code, w.Body.String())
	}
}

func TestRelayIdentityNormalizationAndSingleTrustedHeader(t *testing.T) {
	s := newTestRelay(t, func(c *Config) {
		c.TrustedProxies = []netip.Prefix{netip.MustParsePrefix("127.0.0.1/32")}
	}, nil)
	for _, tt := range []struct {
		peer, forwarded, expected string
	}{
		{"[::ffff:198.51.100.1]:9", "203.0.113.2", "198.51.100.1"},
		{"127.0.0.1:9", "::ffff:203.0.113.2", "203.0.113.2"},
		{"127.0.0.1:9", "2001:db8:0:0:0:0:0:2", "2001:db8::2"},
	} {
		r := relayRequest("GET", "/list", "", tt.peer)
		r.Header.Set("X-Real-IP", tt.forwarded)
		got, err := s.identity(r)
		if err != nil || got != tt.expected {
			t.Errorf("identity(%q,%q)=%q,%v want %q", tt.peer, tt.forwarded, got, err, tt.expected)
		}
	}
	for _, values := range [][]string{nil, {"203.0.113.1", "203.0.113.2"}, {"0.0.0.0"}, {"224.0.0.1"}, {"::"}, {"ff02::1"}} {
		r := relayRequest("GET", "/list", "", "127.0.0.1:9")
		for _, value := range values {
			r.Header.Add("X-Real-IP", value)
		}
		if got, err := s.identity(r); err == nil {
			t.Errorf("identity accepted malformed trusted header %v as %q", values, got)
		}
	}
}

func TestRelayRejectsAbsoluteRequestTargets(t *testing.T) {
	s := newTestRelay(t, nil, func(*http.Request) (*http.Response, error) {
		t.Error("absolute target reached upstream")
		return relayResponse(200, "bad"), nil
	})
	w := serveRelay(s, relayRequest("GET", "https://evil.example/list", "", ""))
	if w.Code != 400 {
		t.Fatalf("absolute target accepted: %d %s", w.Code, w.Body.String())
	}
}

func waitRelayPending(t *testing.T, s *Server, want int) {
	t.Helper()
	timer := time.NewTimer(time.Second)
	defer timer.Stop()
	ticker := time.NewTicker(time.Millisecond)
	defer ticker.Stop()
	for {
		s.activeMu.Lock()
		got := s.pending
		s.activeMu.Unlock()
		if got == want {
			return
		}
		select {
		case <-ticker.C:
		case <-timer.C:
			t.Fatalf("pending count=%d want=%d", got, want)
		}
	}
}

func assertRelaySlotsReleased(t *testing.T, s *Server) {
	t.Helper()
	s.activeMu.Lock()
	defer s.activeMu.Unlock()
	if s.active != 0 || s.pending != 0 || len(s.byClient) != 0 || len(s.pendingByClient) != 0 {
		t.Fatalf("leaked slots: active=%d pending=%d active-clients=%d pending-clients=%d", s.active, s.pending, len(s.byClient), len(s.pendingByClient))
	}
}

func TestRelayQueuedRequestsResumeAndQueueCapacityIsBounded(t *testing.T) {
	for _, perClient := range []bool{false, true} {
		t.Run(fmt.Sprint("per-client=", perClient), func(t *testing.T) {
			entered := make(chan struct{})
			release := make(chan struct{})
			var released sync.Once
			unblock := func() { released.Do(func() { close(release) }) }
			defer unblock()
			var calls atomic.Int32
			s := newTestRelay(t, func(c *Config) {
				c.MaxConcurrent, c.MaxConcurrentPerClient = 1, 1
				c.MaxQueued, c.MaxQueuedPerClient = 1, 1
				c.QueueTimeout = time.Second
				if perClient {
					c.MaxConcurrent = 2
					c.MaxQueued = 2
				}
			}, func(r *http.Request) (*http.Response, error) {
				if calls.Add(1) == 1 {
					close(entered)
					select {
					case <-release:
					case <-r.Context().Done():
						return nil, r.Context().Err()
					}
				}
				return relayResponse(200, "okay"), nil
			})
			var workers sync.WaitGroup
			results := make(chan int, 2)
			workers.Go(func() { results <- serveRelay(s, relayRequest("GET", "/list", "", "198.51.100.1:1")).Code })
			select {
			case <-entered:
			case <-time.After(time.Second):
				t.Fatal("first request failed to start")
			}
			queuedPeer := "198.51.100.2:2"
			if perClient {
				queuedPeer = "198.51.100.1:2"
			}
			workers.Go(func() { results <- serveRelay(s, relayRequest("GET", "/list", "", queuedPeer)).Code })
			waitRelayPending(t, s, 1)
			blockedPeer := "198.51.100.3:3"
			if perClient {
				blockedPeer = "198.51.100.1:3"
			}
			w := serveRelay(s, relayRequest("GET", "/list", "", blockedPeer))
			if w.Code != 429 || w.Header().Get("Retry-After") == "" {
				t.Errorf("queue overflow accepted: %d %s", w.Code, w.Body.String())
			}
			if perClient {
				w := serveRelay(s, relayRequest("GET", "/list", "", "198.51.100.4:4"))
				if w.Code != 200 {
					t.Errorf("one client's backlog blocked another client: %d %s", w.Code, w.Body.String())
				}
			}
			unblock()
			workers.Wait()
			for range 2 {
				if code := <-results; code != 200 {
					t.Errorf("queued request failed after release: %d", code)
				}
			}
			assertRelaySlotsReleased(t, s)
		})
	}
}

func TestRelayQueueTimeoutAndCancellationReleasePendingSlots(t *testing.T) {
	for _, canceled := range []bool{false, true} {
		t.Run(fmt.Sprint("canceled=", canceled), func(t *testing.T) {
			entered := make(chan struct{})
			release := make(chan struct{})
			var released sync.Once
			unblock := func() { released.Do(func() { close(release) }) }
			defer unblock()
			s := newTestRelay(t, func(c *Config) {
				c.MaxConcurrent, c.MaxConcurrentPerClient = 1, 1
				c.MaxQueued, c.MaxQueuedPerClient = 1, 1
				c.QueueTimeout = 30 * time.Millisecond
				if canceled {
					c.QueueTimeout = time.Second
				}
			}, func(r *http.Request) (*http.Response, error) {
				close(entered)
				select {
				case <-release:
				case <-r.Context().Done():
					return nil, r.Context().Err()
				}
				return relayResponse(200, "okay"), nil
			})
			var workers sync.WaitGroup
			workers.Go(func() { serveRelay(s, relayRequest("GET", "/list", "", "198.51.100.1:1")) })
			select {
			case <-entered:
			case <-time.After(time.Second):
				t.Fatal("first request failed to start")
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			result := make(chan *httptest.ResponseRecorder, 1)
			workers.Go(func() { result <- serveRelay(s, relayRequest("GET", "/list", "", "198.51.100.2:2").WithContext(ctx)) })
			waitRelayPending(t, s, 1)
			if canceled {
				cancel()
			}
			var w *httptest.ResponseRecorder
			select {
			case w = <-result:
			case <-time.After(time.Second):
				t.Fatal("queued request ignored timeout/cancel")
			}
			want := 429
			if canceled {
				want = 499
			}
			if w.Code != want {
				t.Errorf("queue exit code=%d want=%d body=%s", w.Code, want, w.Body.String())
			}
			waitRelayPending(t, s, 0)
			unblock()
			workers.Wait()
			assertRelaySlotsReleased(t, s)
		})
	}
}

func FuzzRelayDestinationsStayFixed(f *testing.F) {
	f.Add("/list", "page=0&q=map&sort=trend", "")
	f.Add("/detail", "id=9007199254740993&with_previews=1", "")
	f.Add("/parse", "", `[123,"18446744073709551615"]`)
	f.Add("/maps/c1m1_hotel", "", "")
	f.Add("/ips", "domain=cdn.steamusercontent.com&format=entries", "")
	f.Add("/maps/../../secret", "url=http://127.0.0.1", "")
	f.Fuzz(func(t *testing.T, path, query, body string) {
		if len(path) > 8192 || len(query) > 8192 || len(body) > 128<<10 {
			return
		}
		s := newTestRelay(t, nil, func(r *http.Request) (*http.Response, error) {
			if r.URL.Scheme != "https" || r.URL.User != nil || r.URL.Opaque != "" {
				t.Fatalf("unsafe destination URL: %s", r.URL)
			}
			switch r.URL.Host {
			case "l4d2-workshop.laoyutang.cn":
				if r.URL.Path != "/list" && r.URL.Path != "/detail" {
					t.Fatalf("unsafe workshop path: %s", r.URL)
				}
			case "l4d2-workshop-parse.laoyutang.cn", "lytvpk-get-ips.laoyutang.cn":
				if r.URL.Path != "/" {
					t.Fatalf("unsafe root API path: %s", r.URL)
				}
			case "l4d2-maps.laoyutang.cn":
				segment := strings.TrimPrefix(r.URL.Path, "/")
				if strings.ContainsAny(segment, "/\\") || strings.Contains(segment, "..") || segment == "" {
					t.Fatalf("unsafe map path: %s", r.URL)
				}
			default:
				t.Fatalf("request escaped fixed upstream set: %s", r.URL)
			}
			if r.Method == "POST" {
				got, err := io.ReadAll(r.Body)
				if err != nil || string(got) != body {
					t.Fatalf("accepted parser request was changed: %q, %v", got, err)
				}
			}
			return relayResponse(200, "okay"), nil
		})
		r := relayRequest("GET", "/", body, "")
		r.URL = &url.URL{Path: path, RawQuery: query}
		if path == "/parse" || path == "/" {
			r.Method = "POST"
			r.Header.Set("Content-Type", "application/json")
		}
		serveRelay(s, r)
	})
}
