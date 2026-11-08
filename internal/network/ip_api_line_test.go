package network

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type ipPoolRoundTripFunc func(*http.Request) (*http.Response, error)

func (f ipPoolRoundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestIPPoolUsesSelectedEndpointAndTimeout(t *testing.T) {
	for _, line := range []APILine{APILinePrimary, APILineBackup, "unknown"} {
		t.Run(string(line), func(t *testing.T) {
			client := newIPPoolClient(line)
			defer client.CloseIdleConnections()
			wantTimeout := 5 * time.Second
			if line == APILineBackup {
				wantTimeout = 12 * time.Second
			}
			if client.Timeout != wantTimeout {
				t.Fatalf("timeout = %s, want %s", client.Timeout, wantTimeout)
			}
			transport := client.Transport.(*http.Transport)
			if transport.Proxy != nil || transport.DialContext == nil {
				t.Fatal("IP metadata must retain its direct system-DNS dialer")
			}
			expected, err := url.Parse(EndpointsForAPILine(line).IPPoolURL)
			if err != nil {
				t.Fatal(err)
			}
			calls := 0
			client.Transport = ipPoolRoundTripFunc(func(r *http.Request) (*http.Response, error) {
				calls++
				if r.Method != http.MethodGet || r.URL.Scheme != expected.Scheme || r.URL.Host != expected.Host || r.URL.Path != expected.Path {
					t.Errorf("request used an endpoint other than the selected line")
				}
				query := r.URL.Query()
				if len(query) != 2 || query.Get("domain") != steamCDNDomain || query.Get("format") != "entries" {
					t.Errorf("unexpected IP pool query: %v", query)
				}
				deadline, ok := r.Context().Deadline()
				if !ok || time.Until(deadline) > wantTimeout || time.Until(deadline) < wantTimeout-time.Second {
					t.Errorf("request does not carry the selected client timeout")
				}
				return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`[{"ip":"203.0.113.7","category":"selected"}]`))}, nil
			})
			options, err := fetchRemoteIPOptionsWithClient(context.Background(), steamCDNDomain, line, client)
			if err != nil || calls != 1 || !reflect.DeepEqual(options, []IPOption{{IP: "203.0.113.7", Category: "selected"}}) {
				t.Fatalf("options=%v calls=%d err=%v", options, calls, err)
			}
		})
	}
}

func TestIPPoolFailuresDoNotChangeLinesOrFollowRedirects(t *testing.T) {
	for _, line := range []APILine{APILinePrimary, APILineBackup} {
		for _, status := range []int{0, http.StatusTooManyRequests, http.StatusGatewayTimeout, http.StatusTemporaryRedirect} {
			t.Run(string(line)+"/"+http.StatusText(status), func(t *testing.T) {
				client := newIPPoolClient(line)
				defer client.CloseIdleConnections()
				selected, _ := url.Parse(EndpointsForAPILine(line).IPPoolURL)
				otherLine := APILinePrimary
				if line == APILinePrimary {
					otherLine = APILineBackup
				}
				calls := 0
				client.Transport = ipPoolRoundTripFunc(func(r *http.Request) (*http.Response, error) {
					calls++
					if r.URL.Host != selected.Host || r.URL.Path != selected.Path {
						t.Error("failure triggered a request to another line")
					}
					if status == 0 {
						return nil, errors.New("dial " + selected.Host + ": failed")
					}
					return &http.Response{StatusCode: status, Header: http.Header{
						"Retry-After": {"3"}, "Location": {EndpointsForAPILine(otherLine).IPPoolURL},
					}, Body: io.NopCloser(strings.NewReader("upstream error"))}, nil
				})
				_, err := fetchRemoteIPOptionsWithClient(context.Background(), steamCDNDomain, line, client)
				if err == nil || calls != 1 {
					t.Fatalf("calls=%d err=%v; expected one failed selected-line request", calls, err)
				}
				if strings.Contains(err.Error(), selected.Host) || strings.Contains(err.Error(), "https://") {
					t.Fatalf("error exposed a backend address: %v", err)
				}
			})
		}
	}
}

func TestIPSelectorLineChangeOnlyInvalidatesCandidateMetadata(t *testing.T) {
	selector := &IPSelector{}
	if selector.GetAPILine() != APILinePrimary {
		t.Fatal("zero-value selector must use the primary line")
	}
	selector.SetIPOptions([]IPOption{{IP: "203.0.113.8", Category: "saved category"}})
	checked := time.Now().Add(-time.Minute)
	selector.mu.Lock()
	selector.cachedBestIP = "203.0.113.8"
	selector.cachedBestCategory = "saved category"
	selector.cachedSpeed = 7.5
	selector.lastCheck = checked
	selector.mu.Unlock()
	selector.SetFixedIP("203.0.113.9")
	selector.SetAPILine(APILinePrimary)
	if !selector.ipOptionsLoaded {
		t.Fatal("setting the same line must preserve its candidate cache")
	}
	selector.SetAPILine(APILineBackup)
	if selector.GetAPILine() != APILineBackup || selector.ipOptionsLoaded || len(selector.ipOptions) != 0 || len(selector.ipCategories) != 0 {
		t.Fatal("line change did not invalidate candidate metadata")
	}
	if selector.GetFixedIP() != "203.0.113.9" || selector.GetBestIP("unused") != "203.0.113.9" || selector.cachedBestIP != "203.0.113.8" || selector.cachedBestCategory != "saved category" || selector.GetCachedSpeed() != 7.5 || !selector.lastCheck.Equal(checked) || selector.IsSelecting() {
		t.Fatal("line change altered existing choices or started selection")
	}
	selector.mu.Lock()
	selector.fixedIP = ""
	selector.mu.Unlock()
	if selector.GetBestIP("unused") != "203.0.113.8" {
		t.Fatal("cached best IP was lost on line change")
	}
}

func TestIPSelectorOldLoadCannotRefillNewGeneration(t *testing.T) {
	for _, returnToPrimary := range []bool{false, true} {
		name := "switch-to-backup"
		if returnToPrimary {
			name = "switch-away-and-back"
		}
		t.Run(name, func(t *testing.T) {
			selector := &IPSelector{}
			started, release, finished := make(chan struct{}), make(chan struct{}), make(chan []IPOption, 1)
			old := []IPOption{{IP: "203.0.113.1", Category: "old"}}
			fresh := []IPOption{{IP: "203.0.113.2", Category: "new"}}
			go func() {
				options, _ := selector.getIPOptionsContext(context.Background(), func(_ context.Context, line APILine) ([]IPOption, error) {
					if line != APILinePrimary {
						t.Error("initial load did not capture the primary line")
					}
					close(started)
					<-release
					return old, nil
				})
				finished <- options
			}()
			<-started
			selector.SetAPILine(APILineBackup)
			if returnToPrimary {
				selector.SetAPILine(APILinePrimary)
			}
			current := selector.GetAPILine()
			options, err := selector.getIPOptionsContext(context.Background(), func(_ context.Context, line APILine) ([]IPOption, error) {
				if line != current {
					t.Error("fresh load used the old line")
				}
				return fresh, nil
			})
			if err != nil || !reflect.DeepEqual(options, fresh) {
				t.Fatalf("new generation load=%v err=%v", options, err)
			}
			close(release)
			select {
			case options := <-finished:
				if !reflect.DeepEqual(options, old) {
					t.Fatal("old request changed lines while in flight")
				}
			case <-time.After(time.Second):
				t.Fatal("old request did not finish")
			}
			cached, _ := selector.getIPOptionsContext(context.Background(), func(context.Context, APILine) ([]IPOption, error) {
				t.Fatal("old completion invalidated the fresh generation cache")
				return nil, nil
			})
			if !reflect.DeepEqual(cached, fresh) {
				t.Fatalf("old response contaminated the new generation: %v", cached)
			}
		})
	}
}

func TestIPSelectorGenerationLoadIsSingleFlightAndWaitCanCancel(t *testing.T) {
	selector := &IPSelector{}
	started, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	fetch := func(context.Context, APILine) ([]IPOption, error) {
		if calls.Add(1) == 1 {
			close(started)
		}
		<-release
		return []IPOption{{IP: "203.0.113.3", Category: "shared"}}, nil
	}
	var group sync.WaitGroup
	group.Add(1)
	go func() {
		defer group.Done()
		if _, err := selector.getIPOptionsContext(context.Background(), fetch); err != nil {
			t.Error(err)
		}
	}()
	<-started
	waitCtx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if options, err := selector.getIPOptionsContext(waitCtx, fetch); !errors.Is(err, context.DeadlineExceeded) || len(options) != 0 {
		t.Fatalf("waiting cancellation options=%v err=%v", options, err)
	}
	for i := 0; i < 16; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			options, err := selector.getIPOptionsContext(context.Background(), fetch)
			if err != nil || len(options) != 1 || options[0].Category != "shared" {
				t.Errorf("shared load options=%v err=%v", options, err)
			}
		}()
	}
	close(release)
	group.Wait()
	if calls.Load() != 1 {
		t.Fatalf("same generation fetched %d times", calls.Load())
	}
}

func TestIPSelectorFailedSelectedLineUsesBuiltinsWithoutSwitching(t *testing.T) {
	selector := &IPSelector{}
	selector.SetAPILine(APILineBackup)
	calls := 0
	fetch := func(_ context.Context, line APILine) ([]IPOption, error) {
		calls++
		if line != APILineBackup {
			t.Fatal("failure switched the selected source")
		}
		return nil, NewAPIStatusError(line, http.StatusTooManyRequests, "3")
	}
	for i := 0; i < 2; i++ {
		options, err := selector.getIPOptionsContext(context.Background(), fetch)
		if err == nil || !reflect.DeepEqual(options, defaultIPOptions()) {
			t.Fatalf("fallback options=%v err=%v", options, err)
		}
	}
	if calls != 1 || selector.GetAPILine() != APILineBackup || selector.GetIPOptionsError() == nil {
		t.Fatal("failed source was retried/switched or lost its visible error")
	}
	selector.SetAPILine(APILinePrimary)
	if selector.GetIPOptionsError() != nil {
		t.Fatal("old-line error survived a source change")
	}
}

func TestIPSelectorCanceledOwnerDoesNotCacheFallback(t *testing.T) {
	selector := &IPSelector{}
	ctx, cancel := context.WithCancel(context.Background())
	_, err := selector.getIPOptionsContext(ctx, func(context.Context, APILine) ([]IPOption, error) {
		cancel()
		return nil, context.Canceled
	})
	if !errors.Is(err, context.Canceled) || selector.ipOptionsLoaded {
		t.Fatalf("canceled load cached candidates: err=%v loaded=%v", err, selector.ipOptionsLoaded)
	}
	want := []IPOption{{IP: "203.0.113.4", Category: "retry same source"}}
	options, err := selector.getIPOptionsContext(context.Background(), func(context.Context, APILine) ([]IPOption, error) { return want, nil })
	if err != nil || !reflect.DeepEqual(options, want) {
		t.Fatalf("fresh request after cancellation options=%v err=%v", options, err)
	}
}

func TestSteamCDNIPOptionsContextReportsCachedFailureAndCancellation(t *testing.T) {
	selector := &IPSelector{}
	selector.SetAPILine(APILineBackup)
	_, originalErr := selector.getIPOptionsContext(context.Background(), func(context.Context, APILine) ([]IPOption, error) {
		return nil, NewAPIStatusError(APILineBackup, http.StatusTooManyRequests, "3")
	})
	previous := GlobalIPSelector
	GlobalIPSelector = selector
	t.Cleanup(func() { GlobalIPSelector = previous })
	options, err := GetSteamCDNIPOptionsContext(context.Background())
	if err != originalErr || !reflect.DeepEqual(options, defaultIPOptions()) {
		t.Fatalf("context entry did not expose the cached fallback error: options=%v err=%v", options, err)
	}
	if legacy := GetSteamCDNIPOptions(); !reflect.DeepEqual(legacy, defaultIPOptions()) {
		t.Fatalf("legacy entry lost its built-in fallback: %v", legacy)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if options, err := GetSteamCDNIPOptionsContext(ctx); !errors.Is(err, context.Canceled) || len(options) != 0 {
		t.Fatalf("public context entry ignored cancellation: options=%v err=%v", options, err)
	}
	if GlobalIPSelector != selector || selector.GetIPOptionsError() != originalErr {
		t.Fatal("reading candidates replaced the selector or cleared its failed cache")
	}
}

func TestIPSelectorExplicitInvalidationRetriesOnlyFailedLineOnce(t *testing.T) {
	selector := &IPSelector{}
	selector.SetAPILine(APILineBackup)
	calls := 0
	fetchFailure := func(_ context.Context, line APILine) ([]IPOption, error) {
		calls++
		if line != APILineBackup {
			t.Error("retry changed the selected API line")
		}
		return nil, NewAPIStatusError(line, http.StatusServiceUnavailable, "")
	}
	selector.mu.Lock()
	selector.cachedBestIP = "203.0.113.9"
	selector.cachedSpeed = 8.5
	selector.lastCheck = time.Now().Add(-time.Minute)
	selector.isSelecting = true
	selector.mu.Unlock()
	selector.SetFixedIP("203.0.113.10")
	for i := 0; i < 2; i++ {
		options, err := selector.getIPOptionsContext(context.Background(), fetchFailure)
		if err == nil || !reflect.DeepEqual(options, defaultIPOptions()) {
			t.Fatalf("failed cache options=%v err=%v", options, err)
		}
	}
	if calls != 1 {
		t.Fatalf("ordinary metadata reads automatically retried %d times", calls)
	}
	generation := selector.ipOptionsGeneration
	category, checked := selector.cachedBestCategory, selector.lastCheck
	selector.InvalidateFailedIPOptions()
	selector.InvalidateFailedIPOptions()
	if calls != 1 || selector.GetAPILine() != APILineBackup || selector.ipOptionsGeneration != generation+1 || selector.ipOptionsLoaded || selector.GetIPOptionsError() != nil {
		t.Fatal("explicit invalidation changed lines, fetched immediately, or failed to clear one cache generation")
	}
	if selector.GetFixedIP() != "203.0.113.10" || selector.cachedBestIP != "203.0.113.9" || selector.cachedBestCategory != category || selector.GetCachedSpeed() != 8.5 || !selector.lastCheck.Equal(checked) || !selector.isSelecting {
		t.Fatal("explicit metadata retry altered the selected/fixed IP or active selection")
	}
	fresh := []IPOption{{IP: "203.0.113.11", Category: "recovered"}}
	fetchSuccess := func(_ context.Context, line APILine) ([]IPOption, error) {
		calls++
		if line != APILineBackup {
			t.Error("explicit request switched to the other API line")
		}
		return fresh, nil
	}
	for i := 0; i < 2; i++ {
		options, err := selector.getIPOptionsContext(context.Background(), fetchSuccess)
		if err != nil || !reflect.DeepEqual(options, fresh) {
			t.Fatalf("explicit retry options=%v err=%v", options, err)
		}
	}
	selector.InvalidateFailedIPOptions()
	if calls != 2 || selector.ipOptionsGeneration != generation+1 || !selector.ipOptionsLoaded {
		t.Fatal("successful cache was invalidated or the explicit request was repeated")
	}
}

func TestIPSelectorExplicitInvalidationPreservesInProgressRetry(t *testing.T) {
	selector := &IPSelector{}
	_, _ = selector.getIPOptionsContext(context.Background(), func(context.Context, APILine) ([]IPOption, error) {
		return nil, NewAPIStatusError(APILinePrimary, http.StatusBadGateway, "")
	})
	selector.InvalidateFailedIPOptions()
	generation := selector.ipOptionsGeneration
	started, release, finished := make(chan struct{}), make(chan struct{}), make(chan error, 1)
	var calls atomic.Int32
	go func() {
		_, err := selector.getIPOptionsContext(context.Background(), func(context.Context, APILine) ([]IPOption, error) {
			calls.Add(1)
			close(started)
			<-release
			return []IPOption{{IP: "203.0.113.12", Category: "fresh"}}, nil
		})
		finished <- err
	}()
	<-started
	selector.InvalidateFailedIPOptions()
	selector.mu.RLock()
	unchanged := selector.ipOptionsGeneration == generation && selector.ipOptionsLoad != nil
	selector.mu.RUnlock()
	close(release)
	if err := <-finished; err != nil || !unchanged || calls.Load() != 1 {
		t.Fatalf("explicit reopen disrupted the running same-line retry: err=%v calls=%d", err, calls.Load())
	}
	options, err := selector.getIPOptionsContext(context.Background(), func(context.Context, APILine) ([]IPOption, error) {
		t.Fatal("running retry completion was discarded")
		return nil, nil
	})
	if err != nil || len(options) != 1 || options[0].Category != "fresh" {
		t.Fatalf("running retry result was not cached: options=%v err=%v", options, err)
	}
}
