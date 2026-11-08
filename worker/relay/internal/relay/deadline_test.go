package relay

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// These tests exercise native net/http deadlines, including blocked socket I/O.
// Timers on test reads are failure guards; they never wrap or terminate the
// production handler to make an otherwise unbounded operation appear bounded.
func deadlineTestServer(s *Server) (*httptest.Server, <-chan time.Time, <-chan time.Time) {
	started := make(chan time.Time, 8)
	finished := make(chan time.Time, 8)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started <- time.Now()
		s.ServeHTTP(w, r)
		finished <- time.Now()
	}))
	return server, started, finished
}

func deadlineTestConn(t *testing.T, server *httptest.Server) net.Conn {
	t.Helper()
	conn, err := net.DialTimeout("tcp", server.Listener.Addr().String(), time.Second)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	return conn
}

func deadlineWait(t *testing.T, events <-chan time.Time, label string) time.Time {
	t.Helper()
	select {
	case at := <-events:
		return at
	case <-time.After(time.Second):
		t.Fatalf("%s did not happen within test guard", label)
		return time.Time{}
	}
}

func deadlineStats(t *testing.T, s *Server) statsSnapshot {
	t.Helper()
	snapshot, ok := s.stats.snapshot().(statsSnapshot)
	if !ok {
		t.Fatal("unexpected statistics snapshot type")
	}
	return snapshot
}

func assertDeadlineElapsed(t *testing.T, start, finish time.Time, budget time.Duration) {
	t.Helper()
	// The generous scheduling margin still distinguishes a request deadline
	// from the one-second transport/server failure guard used by these fixtures.
	if elapsed := finish.Sub(start); elapsed < budget/2 || elapsed > budget+250*time.Millisecond {
		t.Fatalf("handler elapsed=%v outside request budget=%v plus scheduling margin", elapsed, budget)
	}
}

func TestRequestDeadlineInterruptsNativeSlowPOSTBody(t *testing.T) {
	const budget = 120 * time.Millisecond
	var calls atomic.Int32
	s := newTestRelay(t, func(c *Config) {
		c.RequestTimeout = budget
		c.UpstreamTimeout = time.Second
	}, func(*http.Request) (*http.Response, error) {
		calls.Add(1)
		return relayResponse(200, "[]"), nil
	})
	server, started, finished := deadlineTestServer(s)
	defer server.Close()
	conn := deadlineTestConn(t, server)
	defer conn.Close()
	if _, err := io.WriteString(conn, "POST /parse HTTP/1.1\r\nHost: relay.test\r\nContent-Type: application/json\r\nContent-Length: 5\r\n\r\n["); err != nil {
		t.Fatal(err)
	}
	entry := deadlineWait(t, started, "slow request start")
	done := deadlineWait(t, finished, "slow POST read deadline")
	assertDeadlineElapsed(t, entry, done, budget)
	if calls.Load() != 0 {
		t.Fatal("incomplete POST body consumed an upstream request")
	}
	snapshot := deadlineStats(t, s)
	if snapshot.Statuses[504] != 1 || snapshot.Forwarded != 0 || snapshot.UpstreamFailures != 0 {
		t.Fatalf("slow request body was misclassified: %+v", snapshot)
	}
	assertRelaySlotsReleased(t, s)
	// At the native write deadline a 504 may be unwriteable. Either a complete
	// 504 or prompt connection closure is valid; a live blocked connection is not.
	if err := conn.SetReadDeadline(time.Now().Add(300 * time.Millisecond)); err != nil {
		t.Fatal(err)
	}
	response, err := http.ReadResponse(bufio.NewReader(conn), &http.Request{Method: "POST"})
	if err == nil {
		defer response.Body.Close()
		if response.StatusCode != 504 {
			t.Fatalf("slow body response=%d want 504 or closed connection", response.StatusCode)
		}
	} else if timeout, ok := err.(net.Error); ok && timeout.Timeout() {
		t.Fatalf("connection remained blocked after handler deadline: %v", err)
	}
}

func TestRequestDeadlineBudgetIncludesQueueBodyAndUpstream(t *testing.T) {
	const budget = 240 * time.Millisecond
	upstreamDeadline := make(chan time.Time, 1)
	s := newTestRelay(t, func(c *Config) {
		c.RequestTimeout = budget
		c.UpstreamTimeout = time.Second
		c.MaxConcurrent, c.MaxConcurrentPerClient = 1, 1
		c.MaxQueued, c.MaxQueuedPerClient = 2, 2
		c.QueueTimeout = time.Second
	}, func(r *http.Request) (*http.Response, error) {
		deadline, ok := r.Context().Deadline()
		if !ok {
			t.Error("outgoing request has no deadline")
		}
		upstreamDeadline <- deadline
		<-r.Context().Done()
		return nil, r.Context().Err()
	})
	if !s.acquire(context.Background(), "fixture-holder") {
		t.Fatal("cannot reserve fixture concurrency slot")
	}
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { s.release("fixture-holder") }) }
	defer release()
	server, started, finished := deadlineTestServer(s)
	defer server.Close()
	conn := deadlineTestConn(t, server)
	defer conn.Close()
	if _, err := io.WriteString(conn, "POST /parse HTTP/1.1\r\nHost: relay.test\r\nContent-Type: application/json\r\nContent-Length: 5\r\n\r\n["); err != nil {
		t.Fatal(err)
	}
	entry := deadlineWait(t, started, "queued POST start")
	waitRelayPending(t, s, 1)
	<-time.After(60 * time.Millisecond)
	release()
	<-time.After(60 * time.Millisecond)
	if _, err := io.WriteString(conn, "123]"); err != nil {
		t.Fatal(err)
	}
	var outgoingDeadline time.Time
	select {
	case outgoingDeadline = <-upstreamDeadline:
	case <-time.After(time.Second):
		t.Fatal("request never completed its queue and body stages")
	}
	if outgoingDeadline.After(entry.Add(budget + 20*time.Millisecond)) {
		t.Fatalf("upstream reset request budget: deadline after start=%v budget=%v", outgoingDeadline.Sub(entry), budget)
	}
	done := deadlineWait(t, finished, "shared request deadline")
	assertDeadlineElapsed(t, entry, done, budget)
	snapshot := deadlineStats(t, s)
	if snapshot.Statuses[504] != 1 || snapshot.Forwarded != 1 {
		t.Fatalf("shared deadline was misclassified: %+v", snapshot)
	}
	assertRelaySlotsReleased(t, s)
}

func TestRequestDeadlineBoundsRealSlowUpstreamHeadersAndBody(t *testing.T) {
	for _, slowBody := range []bool{false, true} {
		t.Run(fmt.Sprint("slow-body=", slowBody), func(t *testing.T) {
			const budget = 120 * time.Millisecond
			upstreamFinished := make(chan struct{})
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				defer close(upstreamFinished)
				if slowBody {
					w.WriteHeader(200)
					_, _ = io.WriteString(w, "[")
					w.(http.Flusher).Flush()
				}
				<-r.Context().Done()
			}))
			defer upstream.Close()
			transport := &http.Transport{Proxy: nil}
			defer transport.CloseIdleConnections()
			s := newTestRelay(t, func(c *Config) {
				c.RequestTimeout = budget
				c.UpstreamTimeout = time.Second
			}, func(r *http.Request) (*http.Response, error) {
				local := r.Clone(r.Context())
				local.URL.Scheme = "http"
				local.URL.Host = strings.TrimPrefix(upstream.URL, "http://")
				return transport.RoundTrip(local)
			})
			entry := time.Now()
			w := serveRelay(s, relayRequest("GET", "/list", "", ""))
			assertDeadlineElapsed(t, entry, time.Now(), budget)
			if w.Code != 504 {
				t.Fatalf("total deadline lost to upstream timeout: %d %s", w.Code, w.Body.String())
			}
			select {
			case <-upstreamFinished:
			case <-time.After(time.Second):
				t.Fatal("total deadline did not cancel real upstream socket")
			}
			assertRelaySlotsReleased(t, s)
		})
	}
}

type deadlineSmallWriteListener struct{ net.Listener }

func (l deadlineSmallWriteListener) Accept() (net.Conn, error) {
	conn, err := l.Listener.Accept()
	if err == nil {
		if tcp, ok := conn.(*net.TCPConn); ok {
			if bufferErr := tcp.SetWriteBuffer(1024); bufferErr != nil {
				_ = conn.Close()
				return nil, bufferErr
			}
		}
	}
	return conn, err
}

func TestRequestDeadlineInterruptsNativeSlowDownstreamWrite(t *testing.T) {
	const budget = 150 * time.Millisecond
	payload := strings.Repeat("x", 1<<20)
	s := newTestRelay(t, func(c *Config) {
		c.RequestTimeout = budget
		c.UpstreamTimeout = time.Second
	}, func(*http.Request) (*http.Response, error) {
		return relayResponse(200, payload), nil
	})
	started, finished := make(chan time.Time, 1), make(chan time.Time, 1)
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started <- time.Now()
		s.ServeHTTP(w, r)
		finished <- time.Now()
	}))
	server.Listener = deadlineSmallWriteListener{server.Listener}
	server.Start()
	defer server.Close()
	conn := deadlineTestConn(t, server)
	defer conn.Close()
	tcp, ok := conn.(*net.TCPConn)
	if !ok {
		t.Fatal("expected native TCP client")
	}
	if err := tcp.SetReadBuffer(1024); err != nil {
		t.Fatal(err)
	}
	if _, err := io.WriteString(conn, "GET /list HTTP/1.1\r\nHost: relay.test\r\n\r\n"); err != nil {
		t.Fatal(err)
	}
	entry := deadlineWait(t, started, "slow consumer request start")
	// Deliberately do not read: bounded native socket buffers force an actual
	// blocked response write rather than accepting the full body in memory.
	done := deadlineWait(t, finished, "native response write deadline")
	assertDeadlineElapsed(t, entry, done, budget)
	snapshot := deadlineStats(t, s)
	if snapshot.Statuses[504] != 1 || snapshot.Forwarded != 1 || snapshot.UpstreamFailures != 0 {
		t.Fatalf("slow downstream write was misclassified: %+v", snapshot)
	}
	assertRelaySlotsReleased(t, s)
}

func TestRequestDeadlineDoesNotPersistAcrossKeepAliveRequests(t *testing.T) {
	const budget = 100 * time.Millisecond
	s := newTestRelay(t, func(c *Config) { c.RequestTimeout = budget }, nil)
	server, _, _ := deadlineTestServer(s)
	defer server.Close()
	conn := deadlineTestConn(t, server)
	defer conn.Close()
	reader := bufio.NewReader(conn)
	for i := range 2 {
		if i == 1 {
			<-time.After(2 * budget)
		}
		if err := conn.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
			t.Fatal(err)
		}
		if _, err := io.WriteString(conn, "GET /list HTTP/1.1\r\nHost: relay.test\r\n\r\n"); err != nil {
			t.Fatalf("keepalive request %d write: %v", i+1, err)
		}
		response, err := http.ReadResponse(reader, &http.Request{Method: "GET"})
		if err != nil {
			t.Fatalf("keepalive request %d inherited expired deadline: %v", i+1, err)
		}
		_, readErr := io.Copy(io.Discard, response.Body)
		closeErr := response.Body.Close()
		if response.StatusCode != 200 || response.Close || readErr != nil || closeErr != nil {
			t.Fatalf("keepalive request %d failed: status=%d close=%v read=%v closeBody=%v", i+1, response.StatusCode, response.Close, readErr, closeErr)
		}
	}
	if snapshot := deadlineStats(t, s); snapshot.Statuses[200] != 2 {
		t.Fatalf("keepalive requests were not both recorded: %+v", snapshot)
	}
}

func TestRequestDeadlineRespectsShorterParentDeadline(t *testing.T) {
	s := newTestRelay(t, func(c *Config) {
		c.RequestTimeout = 250 * time.Millisecond
		c.UpstreamTimeout = time.Second
	}, func(r *http.Request) (*http.Response, error) {
		<-r.Context().Done()
		return nil, r.Context().Err()
	})
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Millisecond)
	defer cancel()
	entry := time.Now()
	w := serveRelay(s, relayRequest("GET", "/list", "", "").WithContext(ctx))
	if elapsed := time.Since(entry); elapsed > 180*time.Millisecond {
		t.Fatalf("relay extended parent deadline: %v", elapsed)
	}
	if w.Code != 504 {
		t.Fatalf("parent deadline was misclassified: %d %s", w.Code, w.Body.String())
	}
	assertRelaySlotsReleased(t, s)
}

func TestRequestDeadlineExpiresQueuedRequestAndReleasesPendingSlot(t *testing.T) {
	const budget = 100 * time.Millisecond
	s := newTestRelay(t, func(c *Config) {
		c.RequestTimeout = budget
		c.MaxConcurrent, c.MaxConcurrentPerClient = 1, 1
		c.MaxQueued, c.MaxQueuedPerClient = 1, 1
		c.QueueTimeout = time.Second
	}, func(*http.Request) (*http.Response, error) {
		t.Error("expired queued request consumed an upstream call")
		return relayResponse(200, "bad"), nil
	})
	if !s.acquire(context.Background(), "fixture-holder") {
		t.Fatal("cannot reserve fixture concurrency slot")
	}
	entry := time.Now()
	w := serveRelay(s, relayRequest("GET", "/list", "", ""))
	assertDeadlineElapsed(t, entry, time.Now(), budget)
	if w.Code != 504 {
		t.Fatalf("overall deadline treated as independent queue timeout: %d %s", w.Code, w.Body.String())
	}
	waitRelayPending(t, s, 0)
	s.release("fixture-holder")
	assertRelaySlotsReleased(t, s)
	if snapshot := deadlineStats(t, s); snapshot.Statuses[504] != 1 || snapshot.Forwarded != 0 {
		t.Fatalf("expired queue was misclassified: %+v", snapshot)
	}
}

type deadlineCloseBody struct {
	closed chan struct{}
	once   sync.Once
}

func (b *deadlineCloseBody) Read([]byte) (int, error) {
	<-b.closed
	return 0, io.ErrClosedPipe
}

func (b *deadlineCloseBody) Close() error {
	b.once.Do(func() { close(b.closed) })
	return nil
}

func TestRequestDeadlineClosesCooperativeCustomBodyWithoutSocketController(t *testing.T) {
	const budget = 100 * time.Millisecond
	s := newTestRelay(t, func(c *Config) { c.RequestTimeout = budget }, func(*http.Request) (*http.Response, error) {
		t.Error("unread custom body reached upstream")
		return relayResponse(200, "bad"), nil
	})
	body := &deadlineCloseBody{closed: make(chan struct{})}
	r := relayRequest("POST", "/parse", "[123]", "")
	r.Body = body
	entry := time.Now()
	w := serveRelay(s, r)
	assertDeadlineElapsed(t, entry, time.Now(), budget)
	if w.Code != 504 {
		t.Fatalf("custom body deadline=%d want=504: %s", w.Code, w.Body.String())
	}
	select {
	case <-body.closed:
	default:
		t.Fatal("fallback did not close cooperative custom body")
	}
	assertRelaySlotsReleased(t, s)
}

func TestRequestDeadlineRealClientShorterTimeoutIsCancellation(t *testing.T) {
	s := newTestRelay(t, func(c *Config) {
		c.RequestTimeout = 300 * time.Millisecond
		c.UpstreamTimeout = time.Second
	}, func(r *http.Request) (*http.Response, error) {
		<-r.Context().Done()
		return nil, r.Context().Err()
	})
	server, started, finished := deadlineTestServer(s)
	defer server.Close()
	transport := &http.Transport{Proxy: nil}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Millisecond)
	defer cancel()
	r, err := http.NewRequestWithContext(ctx, "GET", server.URL+"/list", nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err := client.Do(r)
	if response != nil {
		_ = response.Body.Close()
	}
	if err == nil || ctx.Err() != context.DeadlineExceeded {
		t.Fatalf("client request did not honor its earlier deadline: %v", err)
	}
	entry := deadlineWait(t, started, "short client request start")
	done := deadlineWait(t, finished, "short client request cancellation")
	if elapsed := done.Sub(entry); elapsed > 220*time.Millisecond {
		t.Fatalf("server held request until its longer deadline: %v", elapsed)
	}
	snapshot := deadlineStats(t, s)
	if snapshot.Statuses[499] != 1 || snapshot.UpstreamFailures != 0 {
		t.Fatalf("real client timeout counted as server/upstream failure: %+v", snapshot)
	}
	assertRelaySlotsReleased(t, s)
}

type deadlineReserveWindowWriter struct {
	*httptest.ResponseRecorder
	releaseAt time.Time
}

func (w *deadlineReserveWindowWriter) Write(body []byte) (int, error) {
	// Model a successful downstream write that finishes inside the response
	// reserve, after the upstream/body processing context has expired.
	timer := time.NewTimer(max(time.Duration(0), time.Until(w.releaseAt)))
	defer timer.Stop()
	<-timer.C
	return w.ResponseRecorder.Write(body)
}

func TestRequestDeadlineSuccessfulReserveWindowWriteKeepsUpstreamStatus(t *testing.T) {
	const budget = 250 * time.Millisecond
	s := newTestRelay(t, func(c *Config) { c.RequestTimeout = budget }, nil)
	entry := time.Now()
	w := &deadlineReserveWindowWriter{
		ResponseRecorder: httptest.NewRecorder(),
		releaseAt:        entry.Add(240 * time.Millisecond),
	}
	s.ServeHTTP(w, relayRequest("GET", "/list", "", ""))
	if elapsed := time.Since(entry); elapsed < 230*time.Millisecond {
		t.Fatalf("fixture did not cross processing deadline into response reserve: %v", elapsed)
	}
	if w.Code != 200 {
		t.Fatalf("successful write changed upstream status: %d %s", w.Code, w.Body.String())
	}
	snapshot := deadlineStats(t, s)
	if snapshot.Statuses[200] != 1 || snapshot.Statuses[504] != 0 || snapshot.UpstreamFailures != 0 {
		t.Fatalf("successful reserve-window write was counted as timeout: %+v", snapshot)
	}
	assertRelaySlotsReleased(t, s)
}

func TestRequestDeadlineRecordedErrorMatchesSuccessfulErrorWrite(t *testing.T) {
	// Native socket deadlines can cancel their parent HTTP context before the
	// deadline callback runs. Preserve the final classification actually sent
	// when a canceled parent still exposes an elapsed deadline.
	ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(15*time.Millisecond))
	cancel()
	<-time.After(20 * time.Millisecond)
	s := newTestRelay(t, nil, func(*http.Request) (*http.Response, error) {
		t.Error("already terminated request reached upstream")
		return relayResponse(200, "bad"), nil
	})
	w := serveRelay(s, relayRequest("GET", "/list", "", "").WithContext(ctx))
	snapshot := deadlineStats(t, s)
	if snapshot.Statuses[w.Code] != 1 || snapshot.TotalRequests != 1 {
		t.Fatalf("successful error write=%d disagrees with recorded statuses=%v", w.Code, snapshot.Statuses)
	}
}
