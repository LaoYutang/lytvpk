package relay

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const bridgeHost = "l4d2-workshop-api.laoyutang.cn"

type upstreamReply struct {
	status  int
	header  http.Header
	body    []byte
	problem string // Fixed local message when no complete response can be forwarded.
}

// Both attempts run in the same admitted request, under one upstream deadline.
// The final two return values are bounded labels for workshop request logs.
func (s *Server) forward(ctx context.Context, r *http.Request, dest route, body []byte) (upstreamReply, string, string) {
	target := url.URL{Scheme: "https", Host: dest.upstream, Path: dest.path, RawQuery: dest.query.Encode()}
	switch dest.name {
	case "list", "detail", "updates", "parse":
		// validateQuery has already checked every key and value. Workshop routes
		// need no rewriting, including when replaying the request at the Worker.
		target.RawQuery = r.URL.RawQuery
	default:
		reply, _ := s.callUpstream(ctx, r, dest.name, target, body, "direct")
		return reply, "", ""
	}

	bridge := url.URL{Scheme: "https", Host: bridgeHost, Path: "/v1/" + dest.name, RawQuery: target.RawQuery}
	deadline, _ := ctx.Deadline()
	attempt, cancel := context.WithTimeout(ctx, min(3*time.Second, time.Until(deadline)/2))
	reply, reason := s.callUpstream(attempt, r, dest.name, bridge, body, "bridge")
	cancel()
	if reason == "" {
		return reply, "bridge", "none"
	}
	if ctx.Err() != nil || requestDeadlineExceeded(ctx) {
		return upstreamReply{status: http.StatusGatewayTimeout, problem: "upstream request timed out"}, "bridge", "none"
	}
	reply, _ = s.callUpstream(ctx, r, dest.name, target, body, "worker")
	return reply, "worker", reason
}

// callUpstream returns a fallback reason only for failures eligible for retry.
// No request, response header, or upstream error text is used as a log label.
func (s *Server) callUpstream(ctx context.Context, r *http.Request, routeName string, target url.URL, body []byte, upstream string) (upstreamReply, string) {
	out, err := http.NewRequestWithContext(ctx, r.Method, target.String(), bytes.NewReader(body))
	if err != nil {
		return upstreamReply{status: http.StatusInternalServerError, problem: "could not construct upstream request"}, ""
	}
	hopHeaders := hopByHopHeaders(r.Header)
	for _, name := range []string{"Accept", "Accept-Language", "Accept-Encoding", "If-None-Match", "If-Modified-Since", "Cache-Control"} {
		if !hopHeaders[http.CanonicalHeaderKey(name)] {
			for _, value := range r.Header.Values(name) {
				out.Header.Add(name, value)
			}
		}
	}
	if upstream != "direct" {
		out.Header.Set("Accept-Encoding", "identity")
	}
	out.Header.Set("User-Agent", "lytvpk-relay/1")
	if r.Method == http.MethodPost {
		out.Header.Set("Content-Type", "application/json")
	}
	resp, err := s.client.Do(out)
	if err != nil {
		if upstreamTimedOut(ctx, err, upstream) {
			return upstreamReply{status: http.StatusGatewayTimeout, problem: "upstream request timed out"}, "timeout"
		}
		return upstreamReply{status: http.StatusBadGateway, problem: "upstream request failed"}, "network"
	}
	defer resp.Body.Close()

	status := resp.StatusCode
	if upstream == "bridge" {
		switch status {
		case http.StatusInternalServerError, http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout:
			// The body will not be forwarded. A slow error page must not spend
			// the time reserved for the Worker.
			return upstreamReply{status: status}, "http_" + strconv.Itoa(status)
		}
	}
	content, err := io.ReadAll(io.LimitReader(resp.Body, s.config.MaxResponseBytes+1))
	tooLarge := int64(len(content)) > s.config.MaxResponseBytes
	hasBody := status != http.StatusNoContent && status != http.StatusResetContent && status != http.StatusNotModified
	incomplete := upstream != "direct" && hasBody && resp.ContentLength > 0 && resp.ContentLength != int64(len(content))
	if err != nil || tooLarge || incomplete {
		// A definitive upstream 4xx is a terminal client error even when
		// its body is broken or exceeds the response limit.
		if upstream != "direct" && status >= 400 && status < 500 {
			header := make(http.Header)
			if value := resp.Header.Get("Retry-After"); value != "" && !hopByHopHeaders(resp.Header)["Retry-After"] {
				_, deltaErr := strconv.ParseUint(value, 10, 64)
				_, dateErr := http.ParseTime(value)
				if deltaErr == nil || dateErr == nil {
					header.Set("Retry-After", value)
				}
			}
			return upstreamReply{status: status, header: header, problem: "upstream error response unreadable or too large"}, ""
		}
		reply, reason := upstreamReply{status: http.StatusBadGateway, problem: "upstream response unreadable or too large"}, "invalid_response"
		if upstreamTimedOut(ctx, err, upstream) {
			reply, reason = upstreamReply{status: http.StatusGatewayTimeout, problem: "upstream response timed out"}, "timeout"
		}
		if !hasBody || status >= 300 {
			reason = ""
		}
		return reply, reason
	}
	// Error and conditional responses retain their original status, headers
	// and bytes. Neither 204 nor 205 requires a workshop JSON document.
	if upstream != "direct" && status >= 200 && status < 300 && hasBody {
		encoding := strings.Join(resp.Header.Values("Content-Encoding"), ",")
		valid := (encoding == "" || strings.EqualFold(encoding, "identity")) && validBridgeResponse(routeName, content)
		if requestDeadlineExceeded(ctx) {
			return upstreamReply{status: http.StatusGatewayTimeout, problem: "upstream response timed out"}, "timeout"
		}
		if !valid {
			return upstreamReply{status: http.StatusBadGateway, problem: "invalid upstream response"}, "invalid_response"
		}
	}
	return upstreamReply{status: status, header: resp.Header, body: content}, ""
}

func upstreamTimedOut(ctx context.Context, err error, upstream string) bool {
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return true
	}
	var networkError net.Error
	return upstream != "direct" && (requestDeadlineExceeded(ctx) || (errors.As(err, &networkError) && networkError.Timeout()))
}
