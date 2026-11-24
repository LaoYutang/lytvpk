package relay

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
)

const (
	testBridgeHost   = "l4d2-workshop-api.laoyutang.cn"
	testWorkshopHost = "l4d2-workshop.laoyutang.cn"
	testParseHost    = "l4d2-workshop-parse.laoyutang.cn"
	testListResult   = `{"response":{"publishedfiledetails":[{"publishedfileid":"17","title":"地图"}],"total":1}}`
)

// Only the transport's final connection goes to loopback. The fake service sees
// the actual host, path, query, headers and bytes constructed by ServeHTTP.
type localRelayFixture struct {
	server   *Server
	mu       sync.Mutex
	attempts []relayTestAttempt
}

type relayTestAttempt struct {
	host            string
	start, deadline time.Time
}

var clientOnlyTestHeaders = []string{"Authorization", "Cookie", "X-Real-IP", "X-Forwarded-For", "CF-Connecting-IP", "Proxy-Authorization", "X-Test-Hop"}

func newLocalRelayFixture(t *testing.T, configure func(*Config), handler http.HandlerFunc) *localRelayFixture {
	t.Helper()
	upstream := httptest.NewServer(handler)
	t.Cleanup(upstream.Close)
	local := strings.TrimPrefix(upstream.URL, "http://")
	f := &localRelayFixture{}
	f.server = newTestRelay(t, configure, func(r *http.Request) (*http.Response, error) {
		if r.URL.Scheme != "https" {
			t.Errorf("upstream scheme = %q", r.URL.Scheme)
		}
		deadline, _ := r.Context().Deadline()
		f.mu.Lock()
		f.attempts = append(f.attempts, relayTestAttempt{r.URL.Host, time.Now(), deadline})
		f.mu.Unlock()

		out := r.Clone(r.Context())
		out.Host = r.URL.Host
		out.URL.Scheme = "http"
		out.URL.Host = local
		return upstream.Client().Transport.RoundTrip(out)
	})
	return f
}

func (f *localRelayFixture) wantHosts(t *testing.T, want ...string) {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	var hosts []string
	for _, a := range f.attempts {
		hosts = append(hosts, a.host)
	}
	if !slices.Equal(hosts, want) {
		t.Errorf("upstream calls = %v, want %v", hosts, want)
	}
}

func TestBridgeFallbackRoutes(t *testing.T) {
	tests := []struct {
		name, method, target, body, result, bridgePath, workerHost, workerPath string
	}{
		{"list", "GET", "/list?page=7&q=%E5%9C%B0%E5%9B%BE+%26+Art&sort=trend&tags=Maps%2CCampaigns&filetype=0", "", testListResult, "/v1/list", testWorkshopHost, "/list"},
		{"detail", "GET", "/detail?id=18446744073709551615&with_previews=1", "", `{"response":{"publishedfiledetails":[{"publishedfileid":"18446744073709551615","result":1,"title":"Artwork","previews":[]}]}}`, "/v1/detail", testWorkshopHost, "/detail"},
		{"updates", "GET", "/updates?ids=17,18446744073709551615", "", `{"items":[{"publishedfileid":"17","result":1,"time_updated":1700000000},{"publishedfileid":"18446744073709551615","result":9}]}`, "/v1/updates", testWorkshopHost, "/updates"},
		{"parse", "POST", "/parse", " [17, \"18446744073709551615\"] \n", `[{"publishedfileid":"17","result":1},{"publishedfileid":"18446744073709551615","result":9}]`, "/v1/parse", testParseHost, "/"},
		{"parse-root", "POST", "/", "[\"17\"]", `[{"publishedfileid":"17","result":1}]`, "/v1/parse", testParseHost, "/"},
	}
	for _, tc := range tests {
		for _, fallback := range []bool{false, true} {
			name := tc.name + "/bridge"
			if fallback {
				name = tc.name + "/worker"
			}
			t.Run(name, func(t *testing.T) {
				clientURL, err := url.ParseRequestURI(tc.target)
				if err != nil {
					t.Fatal(err)
				}
				f := newLocalRelayFixture(t, nil, func(w http.ResponseWriter, r *http.Request) {
					path := tc.bridgePath
					if r.Host == tc.workerHost {
						path = tc.workerPath
					}
					if r.Method != tc.method || r.URL.Path != path || r.URL.RawQuery != clientURL.RawQuery {
						t.Errorf("unexpected request: %s %s on %s", r.Method, r.URL, r.Host)
					}
					body, err := io.ReadAll(r.Body)
					if err != nil || string(body) != tc.body {
						t.Errorf("request payload = %q, err = %v", body, err)
					}
					if tc.method == "POST" && r.Header.Get("Content-Type") != "application/json" {
						t.Errorf("parse media type = %q", r.Header.Get("Content-Type"))
					}
					for _, key := range clientOnlyTestHeaders {
						if r.Header.Get(key) != "" {
							t.Errorf("forwarded client header %s to %s", key, r.Host)
						}
					}
					if r.Header.Get("Accept-Encoding") != "identity" {
						t.Errorf("Accept-Encoding = %q", r.Header.Get("Accept-Encoding"))
					}
					if r.Header.Get("Accept-Language") != "zh-CN" {
						t.Errorf("Accept-Language = %q", r.Header.Get("Accept-Language"))
					}
					w.Header().Set("ETag", `"`+r.Host+`"`)
					if fallback && r.Host == testBridgeHost {
						http.Error(w, "Bridge unavailable", http.StatusServiceUnavailable)
						return
					}
					w.Header().Set("Content-Type", "application/json")
					io.WriteString(w, tc.result)
				})
				req := relayRequest(tc.method, tc.target, tc.body, "")
				for _, key := range clientOnlyTestHeaders {
					req.Header.Set(key, "client-only")
				}
				req.Header.Set("Connection", "X-Test-Hop")
				req.Header.Set("Accept-Language", "zh-CN")
				req.Header.Set("Accept-Encoding", "gzip, br")
				got := serveRelay(f.server, req)
				finalHost := testBridgeHost
				if fallback {
					finalHost = tc.workerHost
					f.wantHosts(t, testBridgeHost, tc.workerHost)
				} else {
					f.wantHosts(t, testBridgeHost)
				}
				if got.Code != 200 || got.Body.String() != tc.result || got.Header().Get("ETag") != `"`+finalHost+`"` {
					t.Errorf("response = %d %q, ETag = %q", got.Code, got.Body, got.Header().Get("ETag"))
				}
			})
		}
	}
}

func TestBridgeFallbackBusinessResponses(t *testing.T) {
	tests := []struct {
		name, method, target, request string
		status                        int
		response                      string
	}{
		{"empty-list", "GET", "/list?page=15", "", 200, `{"response":{"total":0,"publishedfiledetails":[]}}`},
		{"sparse-empty-list", "GET", "/list?page=75", "", 200, `{"response":{"total":0}}`},
		{"empty-detail", "GET", "/detail?id=17", "", 200, `{"response":{"publishedfiledetails":[]}}`},
		{"empty-parse", "POST", "/parse", "[17]", 200, `[]`},
		{"missing-detail", "GET", "/detail?id=17", "", 200, `{"response":{"publishedfiledetails":[{"publishedfileid":"17","result":9}]}}`},
		{"missing-update", "GET", "/updates?ids=17", "", 200, `{"items":[{"publishedfileid":"17","result":9}]}`},
		{"missing-parse", "POST", "/parse", "[17]", 200, `[{"publishedfileid":"17","result":9}]`},
		{"bad-page", "GET", "/list?page=0", "", 400, `{"error":"page out of range"}`},
		{"not-implemented", "GET", "/list", "", 501, `{"error":"not implemented"}`},
		{"unknown-item", "GET", "/detail?id=17", "", 404, `{"error":"not found"}`},
		{"busy", "GET", "/list?page=1", "", 429, `{"error":"rate limit"}`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			f := newLocalRelayFixture(t, nil, func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if tc.status == 429 {
					w.Header().Set("Retry-After", "17")
				}
				w.WriteHeader(tc.status)
				io.WriteString(w, tc.response)
			})
			got := serveRelay(f.server, relayRequest(tc.method, tc.target, tc.request, ""))
			f.wantHosts(t, testBridgeHost)
			if got.Code != tc.status || got.Body.String() != tc.response {
				t.Fatalf("response = %d %q", got.Code, got.Body)
			}
			if tc.status == 429 && got.Header().Get("Retry-After") != "17" {
				t.Error("Retry-After lost")
			}
		})
	}
}

func TestBridgeFallbackAvailabilityErrors(t *testing.T) {
	type bridgeCase struct {
		name   string
		bridge http.HandlerFunc
	}
	tests := []bridgeCase{
		{"network", func(w http.ResponseWriter, _ *http.Request) {
			// Close before a status line or response body is sent.
			conn, _, err := w.(http.Hijacker).Hijack()
			if err != nil {
				t.Error(err)
				return
			}
			conn.Close()
		}},
		{"malformed-json", func(w http.ResponseWriter, _ *http.Request) { io.WriteString(w, `{"response":`) }},
		{"truncated-body", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Length", "200")
			io.WriteString(w, testListResult)
		}},
		{"oversized-body", func(w http.ResponseWriter, _ *http.Request) {
			io.WriteString(w, strings.Repeat(" ", 100)+testListResult)
		}},
		{"wrong-shape", func(w http.ResponseWriter, _ *http.Request) { io.WriteString(w, `{"items":[]}`) }},
	}
	for _, status := range []int{500, 502, 503, 504} {
		tests = append(tests, bridgeCase{fmt.Sprintf("http-%d", status), func(w http.ResponseWriter, _ *http.Request) {
			http.Error(w, "try later", status)
		}})
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			f := newLocalRelayFixture(t, func(c *Config) { c.MaxResponseBytes = 128 }, func(w http.ResponseWriter, r *http.Request) {
				if r.Host == testBridgeHost {
					tc.bridge(w, r)
					return
				}
				io.WriteString(w, testListResult)
			})
			got := serveRelay(f.server, relayRequest("GET", "/list?page=1", "", ""))
			f.wantHosts(t, testBridgeHost, testWorkshopHost)
			if got.Code != 200 || got.Body.String() != testListResult {
				t.Fatalf("fallback response = %d %q", got.Code, got.Body)
			}
		})
	}
}

func TestBridgeFallbackDeliversFinalError(t *testing.T) {
	for _, tc := range []struct {
		name                 string
		bridgeStatus, status int
		body                 string
		wantStatus           int
	}{
		{"worker-service-unavailable", 500, 503, `{"error":"Worker unavailable"}`, 503},
		{"both-invalid-json", 200, 200, `{"items":`, 502},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newLocalRelayFixture(t, nil, func(w http.ResponseWriter, r *http.Request) {
				if r.Host == testBridgeHost {
					w.Header().Set("Retry-After", "10")
					w.WriteHeader(tc.bridgeStatus)
					io.WriteString(w, "Bridge unavailable")
					return
				}
				w.Header().Set("Retry-After", "60")
				w.WriteHeader(tc.status)
				io.WriteString(w, tc.body)
			})
			got := serveRelay(f.server, relayRequest("GET", "/list", "", ""))
			f.wantHosts(t, testBridgeHost, testWorkshopHost)
			if got.Code != tc.wantStatus {
				t.Fatalf("response = %d %q", got.Code, got.Body)
			}
			if tc.status == 503 && (got.Body.String() != tc.body || got.Header().Get("Retry-After") != "60") {
				t.Errorf("final Worker error changed: %q, headers %v", got.Body, got.Header())
			}
		})
	}
}

func TestBridgeFallbackNonWorkshopRoutes(t *testing.T) {
	for _, tc := range []struct{ target, host, uri string }{
		{"/maps/c1m1_hotel", "l4d2-maps.laoyutang.cn", "/c1m1_hotel"},
		{"/ips", "lytvpk-get-ips.laoyutang.cn", "/?domain=cdn.steamusercontent.com&format=entries"},
	} {
		t.Run(tc.target, func(t *testing.T) {
			f := newLocalRelayFixture(t, nil, func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "GET" || r.URL.RequestURI() != tc.uri {
					t.Errorf("upstream = %s %s", r.Method, r.URL)
				}
				http.Error(w, "original upstream unavailable", 503)
			})
			got := serveRelay(f.server, relayRequest("GET", tc.target, "", ""))
			f.wantHosts(t, tc.host)
			if got.Code != 503 || got.Body.String() != "original upstream unavailable\n" {
				t.Errorf("response = %d %q", got.Code, got.Body)
			}
		})
	}
}

func TestBridgeFallbackSharesUpstreamTimeout(t *testing.T) {
	const budget = 300 * time.Millisecond
	for _, workerTimesOut := range []bool{false, true} {
		name := "worker-answers"
		if workerTimesOut {
			name = "worker-times-out"
		}
		t.Run(name, func(t *testing.T) {
			f := newLocalRelayFixture(t, func(c *Config) {
				c.RequestTimeout = 3 * time.Second
				c.UpstreamTimeout = budget
			}, func(w http.ResponseWriter, r *http.Request) {
				if r.Host == testBridgeHost || workerTimesOut {
					<-r.Context().Done()
					return
				}
				io.WriteString(w, testListResult)
			})
			got := serveRelay(f.server, relayRequest("GET", "/list", "", ""))
			f.wantHosts(t, testBridgeHost, testWorkshopHost)
			if workerTimesOut && got.Code != 504 {
				t.Errorf("both timeouts returned %d %q", got.Code, got.Body)
			}
			if !workerTimesOut && (got.Code != 200 || got.Body.String() != testListResult) {
				t.Errorf("worker returned %d %q", got.Code, got.Body)
			}
			f.mu.Lock()
			defer f.mu.Unlock()
			if len(f.attempts) != 2 {
				t.Fatalf("attempts = %v", f.attempts)
			}
			bridge, worker := f.attempts[0], f.attempts[1]
			if worker.start.Before(bridge.deadline) {
				t.Errorf("Worker started at %v before Bridge timed out at %v", worker.start, bridge.deadline)
			}
			if !worker.deadline.After(bridge.deadline) || worker.deadline.After(bridge.start.Add(budget)) {
				t.Errorf("Bridge deadline = %v, Worker deadline = %v, initial budget ends by %v", bridge.deadline, worker.deadline, bridge.start.Add(budget))
			}
		})
	}
}

func TestBridgeFallbackCallerCancellation(t *testing.T) {
	entered := make(chan struct{})
	f := newLocalRelayFixture(t, nil, func(w http.ResponseWriter, r *http.Request) {
		if r.Host == testBridgeHost {
			close(entered)
			<-r.Context().Done()
		}
	})
	var workers sync.WaitGroup
	defer workers.Wait()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req := relayRequest("GET", "/list", "", "").WithContext(ctx)
	done := make(chan *httptest.ResponseRecorder, 1)
	workers.Go(func() { done <- serveRelay(f.server, req) })
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("Bridge did not receive request")
	}
	cancel()
	select {
	case got := <-done:
		if got.Code != 499 {
			t.Errorf("caller canceled: got %d %q", got.Code, got.Body)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Relay did not finish after client cancellation")
	}
	f.wantHosts(t, testBridgeHost)
}
