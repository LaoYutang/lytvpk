package relay

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Server struct {
	config Config
	client *http.Client
	users  *limiter
	global *limiter
	stats  *stats
	secret [32]byte
	now    func() time.Time

	activeMu        sync.Mutex
	active          int
	byClient        map[string]int
	pending         int
	pendingByClient map[string]int
	changed         chan struct{}
}

func New(config Config) (*Server, error) {
	if err := config.validate(); err != nil {
		return nil, err
	}
	// Caller-owned slices cannot change the trust boundary after startup.
	config.TrustedProxies = append([]netip.Prefix(nil), config.TrustedProxies...)
	s := &Server{
		config: config, users: newLimiter(config.PerClientRatePerMinute, config.PerClientBurst, config.MaxClients, config.ClientIdleTTL),
		global: newLimiter(config.GlobalRatePerMinute, config.GlobalBurst, 1, 24*time.Hour),
		stats:  newPersistentStats(config.StatsFile), now: time.Now, byClient: make(map[string]int),
		pendingByClient: make(map[string]int), changed: make(chan struct{}),
	}
	if _, err := rand.Read(s.secret[:]); err != nil {
		return nil, fmt.Errorf("create anonymous identity key: %w", err)
	}
	transport := &http.Transport{
		Proxy:               http.ProxyFromEnvironment,
		DialContext:         (&net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		TLSHandshakeTimeout: 5 * time.Second, ResponseHeaderTimeout: config.UpstreamTimeout,
		ExpectContinueTimeout: time.Second, IdleConnTimeout: 60 * time.Second,
		MaxIdleConns: config.MaxConcurrent, MaxIdleConnsPerHost: config.MaxConcurrent,
		MaxConnsPerHost: config.MaxConcurrent, MaxResponseHeaderBytes: 32 << 10,
		DisableCompression: true, ForceAttemptHTTP2: true,
	}
	s.client = &http.Client{
		Transport: transport, Timeout: config.UpstreamTimeout,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	return s, nil
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	responseWriter := &requestResponseWriter{ResponseWriter: w}
	w = responseWriter
	r, finishDeadline := withRequestDeadline(w, r, s.config.RequestTimeout)
	defer finishDeadline()
	if r.URL.Path == "/healthz" {
		serveHealth(w, r)
		return
	}
	dest := selectRoute(r)
	status, forwarded, upstreamFailure, key, statsKey := 500, false, false, "", ""
	defer func() {
		if responseWriter.writeError != nil && requestDeadlineExceeded(r.Context()) {
			status = http.StatusGatewayTimeout
		} else if !requestDeadlineExceeded(r.Context()) && errors.Is(r.Context().Err(), context.Canceled) {
			status = 499
		}
		s.stats.record(dest.name, status, forwarded, upstreamFailure, statsKey, s.now())
	}()
	fail := func(code int, message string) {
		if requestDeadlineExceeded(r.Context()) {
			code, message = http.StatusGatewayTimeout, "request deadline exceeded"
		} else if errors.Is(r.Context().Err(), context.Canceled) {
			code, message = 499, "client request canceled"
		}
		status = code
		// Avoid draining an unread error body after the handler has completed.
		if r.Body != nil && r.Body != http.NoBody {
			w.Header().Set("Connection", "close")
		}
		writeError(w, code, message)
		responseWriter.flush()
	}
	if requestDeadlineExceeded(r.Context()) || r.Context().Err() != nil {
		fail(http.StatusGatewayTimeout, "request deadline exceeded")
		return
	}
	if dest.name == "unknown" {
		fail(http.StatusNotFound, "not found")
		return
	}
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Expose-Headers", "Retry-After")
	if r.Method == http.MethodOptions {
		if method := r.Header.Get("Access-Control-Request-Method"); method != "" && method != dest.method {
			w.Header().Set("Allow", dest.method+", OPTIONS")
			fail(http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		w.Header().Set("Access-Control-Allow-Methods", dest.method+", OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Max-Age", "600")
		status = http.StatusNoContent
		w.WriteHeader(status)
		return
	}
	if r.Method != dest.method {
		w.Header().Set("Allow", dest.method+", OPTIONS")
		fail(http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	ip, err := s.identity(r)
	if err != nil {
		fail(http.StatusBadRequest, "invalid client identity")
		return
	}
	key = s.anonymousKey(ip)
	statsKey = s.stats.userKey(ip, s.now())
	if ok, retry := s.users.take(key, 1, s.now()); !ok {
		setRetryAfter(w, retry)
		fail(http.StatusTooManyRequests, "client rate limit exceeded")
		return
	}
	if ok, retry := s.global.take("global", 1, s.now()); !ok {
		setRetryAfter(w, retry)
		fail(http.StatusTooManyRequests, "global rate limit exceeded")
		return
	}
	if !s.acquire(r.Context(), key) {
		if errors.Is(r.Context().Err(), context.Canceled) {
			fail(499, "client request canceled")
			return
		}
		setRetryAfter(w, time.Second)
		fail(http.StatusTooManyRequests, "concurrency queue full or wait timed out")
		return
	}
	defer s.release(key)
	if r.URL.IsAbs() || r.URL.Host != "" || r.URL.Opaque != "" {
		fail(http.StatusBadRequest, "absolute request URLs are not supported")
		return
	}
	if err := validateQuery(r, &dest); err != nil {
		fail(http.StatusBadRequest, err.Error())
		return
	}
	var body []byte
	if dest.method == http.MethodPost {
		mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || mediaType != "application/json" || r.Header.Get("Content-Encoding") != "" {
			fail(http.StatusUnsupportedMediaType, "expected uncompressed application/json")
			return
		}
		if r.ContentLength > s.config.MaxBodyBytes {
			fail(http.StatusRequestEntityTooLarge, "request body too large")
			return
		}
		body, err = io.ReadAll(http.MaxBytesReader(w, r.Body, s.config.MaxBodyBytes))
		if err != nil {
			var tooLarge *http.MaxBytesError
			if errors.As(err, &tooLarge) {
				fail(http.StatusRequestEntityTooLarge, "request body too large")
			} else {
				fail(http.StatusBadRequest, "failed to read request body")
			}
			return
		}
		cost, err := validateParseBody(body, s.config.MaxParseIDs)
		if err != nil {
			fail(http.StatusBadRequest, err.Error())
			return
		}
		// One unit per upstream chunk of 100 IDs. Failed admission is never refunded.
		if cost > 1 {
			if ok, retry := s.users.take(key, cost-1, s.now()); !ok {
				setRetryAfter(w, retry)
				fail(http.StatusTooManyRequests, "client rate limit exceeded")
				return
			}
			if ok, retry := s.global.take("global", cost-1, s.now()); !ok {
				setRetryAfter(w, retry)
				fail(http.StatusTooManyRequests, "global rate limit exceeded")
				return
			}
		}
	} else if r.ContentLength != 0 || len(r.TransferEncoding) != 0 || r.Header.Get("Content-Encoding") != "" {
		fail(http.StatusBadRequest, "GET requests must not include a body")
		return
	}
	if requestDeadlineExceeded(r.Context()) || r.Context().Err() != nil {
		fail(http.StatusGatewayTimeout, "request deadline exceeded")
		return
	}
	target := url.URL{Scheme: "https", Host: dest.upstream, Path: dest.path, RawQuery: dest.query.Encode()}
	ctx, cancel := context.WithTimeout(r.Context(), s.config.UpstreamTimeout)
	defer cancel()
	out, err := http.NewRequestWithContext(ctx, dest.method, target.String(), bytes.NewReader(body))
	if err != nil {
		fail(http.StatusInternalServerError, "could not construct upstream request")
		return
	}
	hopHeaders := hopByHopHeaders(r.Header)
	for _, name := range []string{"Accept", "Accept-Language", "Accept-Encoding", "If-None-Match", "If-Modified-Since", "Cache-Control"} {
		if hopHeaders[http.CanonicalHeaderKey(name)] {
			continue
		}
		for _, value := range r.Header.Values(name) {
			out.Header.Add(name, value)
		}
	}
	out.Header.Set("User-Agent", "lytvpk-relay/1")
	if dest.method == http.MethodPost {
		out.Header.Set("Content-Type", "application/json")
	}
	forwarded = true
	response, err := s.client.Do(out)
	if err != nil {
		if !requestDeadlineExceeded(r.Context()) && errors.Is(r.Context().Err(), context.Canceled) {
			fail(499, "client request canceled")
			return
		}
		upstreamFailure = true
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
			fail(http.StatusGatewayTimeout, "upstream request timed out")
		} else {
			fail(http.StatusBadGateway, "upstream request failed")
		}
		return
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, s.config.MaxResponseBytes+1))
	if err != nil || int64(len(responseBody)) > s.config.MaxResponseBytes {
		if !requestDeadlineExceeded(r.Context()) && errors.Is(r.Context().Err(), context.Canceled) {
			fail(499, "client request canceled")
			return
		}
		upstreamFailure = true
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
			fail(http.StatusGatewayTimeout, "upstream response timed out")
		} else {
			fail(http.StatusBadGateway, "upstream response unreadable or too large")
		}
		return
	}
	if requestDeadlineExceeded(r.Context()) || r.Context().Err() != nil {
		fail(http.StatusGatewayTimeout, "request deadline exceeded")
		return
	}
	copyResponseHeaders(w.Header(), response.Header)
	// Ensure Retry-After is readable from browser clients even if upstream sets CORS.
	exposed := w.Header().Get("Access-Control-Expose-Headers")
	if !strings.Contains(strings.ToLower(exposed), "retry-after") {
		w.Header().Set("Access-Control-Expose-Headers", strings.Trim(exposed+", Retry-After", ", "))
	}
	status = response.StatusCode
	upstreamFailure = status >= 500
	w.WriteHeader(status)
	_, _ = w.Write(responseBody)
	responseWriter.flush()
}

// RunMaintenance performs optional statistics I/O off the request path. The
// caller runs this once in its bounded lifecycle worker pool.
func (s *Server) RunMaintenance(ctx context.Context) {
	s.stats.runPersistence(ctx, s.config.StatsFlushInterval)
}

func (s *Server) identity(r *http.Request) (string, error) {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return "", err
	}
	peer, err := netip.ParseAddr(host)
	if err != nil || peer.Zone() != "" {
		return "", fmt.Errorf("invalid peer address")
	}
	peer = peer.Unmap()
	for _, prefix := range s.config.TrustedProxies {
		if !prefix.Contains(peer) {
			continue
		}
		values := r.Header.Values(s.config.RealIPHeader)
		if len(values) != 1 {
			return "", fmt.Errorf("trusted proxy must supply one real IP")
		}
		client, err := netip.ParseAddr(strings.TrimSpace(values[0]))
		if err != nil || client.Zone() != "" || client.IsUnspecified() || client.IsMulticast() {
			return "", fmt.Errorf("invalid real IP")
		}
		return client.Unmap().String(), nil
	}
	return peer.String(), nil
}

func (s *Server) anonymousKey(ip string) string {
	mac := hmac.New(sha256.New, s.secret[:])
	_, _ = mac.Write([]byte(ip))
	return hex.EncodeToString(mac.Sum(nil))
}

func (s *Server) acquire(ctx context.Context, key string) bool {
	s.activeMu.Lock()
	defer s.activeMu.Unlock()
	if ctx.Err() != nil {
		return false
	}
	if s.active < s.config.MaxConcurrent && s.byClient[key] < s.config.MaxConcurrentPerClient {
		s.active++
		s.byClient[key]++
		return true
	}
	if s.pending >= s.config.MaxQueued || s.pendingByClient[key] >= s.config.MaxQueuedPerClient {
		return false
	}
	s.pending++
	s.pendingByClient[key]++
	defer func() {
		s.pending--
		s.pendingByClient[key]--
		if s.pendingByClient[key] == 0 {
			delete(s.pendingByClient, key)
		}
	}()
	deadline := time.Now().Add(s.config.QueueTimeout)
	timer := time.NewTimer(s.config.QueueTimeout)
	defer timer.Stop()
	for {
		notify := s.changed
		s.activeMu.Unlock()
		select {
		case <-ctx.Done():
			s.activeMu.Lock()
			return false
		case <-timer.C:
			s.activeMu.Lock()
			return false
		case <-notify:
		}
		s.activeMu.Lock()
		if ctx.Err() != nil || !time.Now().Before(deadline) {
			return false
		}
		if s.active < s.config.MaxConcurrent && s.byClient[key] < s.config.MaxConcurrentPerClient {
			s.active++
			s.byClient[key]++
			return true
		}
	}
}

func (s *Server) release(key string) {
	s.activeMu.Lock()
	defer s.activeMu.Unlock()
	s.active--
	s.byClient[key]--
	if s.byClient[key] == 0 {
		delete(s.byClient, key)
	}
	close(s.changed)
	s.changed = make(chan struct{})
}

func (s *Server) AdminHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		peer, parseErr := netip.ParseAddr(host)
		if err != nil || parseErr != nil || !peer.IsLoopback() {
			writeError(w, http.StatusForbidden, "management access requires loopback")
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		switch r.URL.Path {
		case "/healthz":
			serveHealth(w, r)
		case "/stats":
			if r.Method != http.MethodGet {
				w.Header().Set("Allow", "GET")
				writeError(w, http.StatusMethodNotAllowed, "method not allowed")
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(s.stats.snapshot())
		default:
			writeError(w, http.StatusNotFound, "not found")
		}
	})
}

func serveHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = io.WriteString(w, "{\"status\":\"ok\"}\n")
}

func writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}

func setRetryAfter(w http.ResponseWriter, retry time.Duration) {
	w.Header().Set("Retry-After", strconv.Itoa(max(1, int(math.Ceil(retry.Seconds())))))
}

func hopByHopHeaders(src http.Header) map[string]bool {
	skip := map[string]bool{}
	for _, name := range []string{"Connection", "Keep-Alive", "Proxy-Authenticate", "Proxy-Authorization", "TE", "Trailer", "Transfer-Encoding", "Upgrade", "Proxy-Connection"} {
		skip[http.CanonicalHeaderKey(name)] = true
	}
	for _, connection := range src.Values("Connection") {
		for _, name := range strings.Split(connection, ",") {
			skip[http.CanonicalHeaderKey(strings.TrimSpace(name))] = true
		}
	}
	return skip
}

func copyResponseHeaders(dst, src http.Header) {
	skip := hopByHopHeaders(src)
	for name, values := range src {
		if !skip[http.CanonicalHeaderKey(name)] {
			dst[name] = append([]string(nil), values...)
		}
	}
}
