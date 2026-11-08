package network

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestNormalizeAPILine(t *testing.T) {
	for _, test := range []struct {
		input string
		want  APILine
	}{
		{"", APILinePrimary},
		{"  ", APILinePrimary},
		{"primary", APILinePrimary},
		{" PRIMARY\t", APILinePrimary},
		{"backup", APILineBackup},
		{"\nBackup ", APILineBackup},
	} {
		got, err := NormalizeAPILine(test.input)
		if err != nil || got != test.want {
			t.Errorf("NormalizeAPILine(%q) = %q, %v; want %q", test.input, got, err, test.want)
		}
	}
	for _, input := range []string{"auto", "secondary", "https://private.example/", "主线路", "backup\x00"} {
		if _, err := NormalizeAPILine(input); err == nil {
			t.Errorf("accepted invalid API line %q", input)
		}
	}
}

func TestAPILineEndpointsAndTimeouts(t *testing.T) {
	primary := EndpointsForAPILine(APILinePrimary)
	if primary.WorkshopBaseURL != "https://l4d2-workshop.laoyutang.cn" ||
		primary.ParseURL != "https://l4d2-workshop-parse.laoyutang.cn" ||
		primary.MapBaseURL != "https://l4d2-maps.laoyutang.cn/" ||
		primary.IPPoolURL != "https://lytvpk-get-ips.laoyutang.cn/" {
		t.Fatalf("primary endpoints changed existing destinations: %+v", primary)
	}
	backup := EndpointsForAPILine(APILineBackup)
	for _, test := range []struct {
		rawURL string
		path   string
	}{
		{backup.WorkshopBaseURL, ""},
		{backup.ParseURL, "/parse"},
		{backup.MapBaseURL, "/maps/"},
		{backup.IPPoolURL, "/ips"},
	} {
		parsed, err := url.Parse(test.rawURL)
		if err != nil || parsed.Scheme != "https" || parsed.Host != "lytvpk-backup.laoyutang.cn" || parsed.Path != test.path || parsed.RawQuery != "" || parsed.User != nil {
			t.Errorf("unexpected backup endpoint %q: %v", test.rawURL, err)
		}
	}
	if got := EndpointsForAPILine(APILine("https://private.example/")); got != primary {
		t.Fatalf("invalid preference changed the endpoint: %+v", got)
	}
	backup.WorkshopBaseURL = "https://mutated.example/"
	if EndpointsForAPILine(APILineBackup).WorkshopBaseURL != backupAPIBaseURL {
		t.Fatal("caller mutated subsequent endpoint sets")
	}
	for _, original := range []time.Duration{2 * time.Second, 5 * time.Second, 30 * time.Second} {
		if got := APIRequestTimeout(APILinePrimary, original); got != original {
			t.Errorf("primary timeout = %v; want original %v", got, original)
		}
		if got := APIRequestTimeout(APILineBackup, original); got != 12*time.Second {
			t.Errorf("backup timeout = %v; want 12s", got)
		}
	}
	if APILineLabel(APILinePrimary) != "主线路" || APILineLabel(APILineBackup) != "备用线路" || APILineLabel("invalid") != "主线路" {
		t.Fatal("API line labels exposed an unexpected value")
	}
}

type apiLineTimeoutError struct{}

func (apiLineTimeoutError) Error() string   { return "private.example:443 timed out" }
func (apiLineTimeoutError) Timeout() bool   { return true }
func (apiLineTimeoutError) Temporary() bool { return true }

func TestAPIRequestErrorsProtectTransportDetailsAndPreserveCause(t *testing.T) {
	cause := &url.Error{
		Op:  "Get",
		URL: "https://private.example/?token=secret-token",
		Err: &net.OpError{Op: "dial", Net: "tcp", Err: errors.New("192.0.2.12:443 secret-token")},
	}
	for _, line := range []APILine{APILinePrimary, APILineBackup} {
		err := NewAPIRequestError(line, cause)
		if !errors.Is(err, cause) {
			t.Fatal("request error lost its cause")
		}
		var got *url.Error
		if !errors.As(err, &got) || got != cause {
			t.Fatal("request error no longer permits transport inspection")
		}
		message := err.Error()
		for _, private := range []string{"private.example", "192.0.2.12", "secret-token", "https://", "443"} {
			if strings.Contains(message, private) {
				t.Errorf("user-facing error exposed %q: %s", private, message)
			}
		}
		other := "备用线路"
		if line == APILineBackup {
			other = "主线路"
		}
		if !strings.HasPrefix(message, APILineLabel(line)) || !strings.Contains(message, "手动切换"+other) {
			t.Errorf("missing line and manual retry advice: %s", message)
		}
	}
	if NewAPIRequestError(APILinePrimary, nil) != nil {
		t.Fatal("nil cause became an error")
	}
}

func TestAPIRequestErrorsDistinguishTimeoutAndCancellation(t *testing.T) {
	for _, cause := range []error{context.DeadlineExceeded, fmt.Errorf("wrapped: %w", apiLineTimeoutError{})} {
		err := NewAPIRequestError(APILineBackup, cause)
		if !strings.Contains(err.Error(), "备用线路请求超时") || !strings.Contains(err.Error(), "手动切换主线路") || !errors.Is(err, cause) {
			t.Errorf("timeout classification or cause lost: %v", err)
		}
		if strings.Contains(err.Error(), "private.example") {
			t.Errorf("timeout message exposed transport details: %v", err)
		}
	}
	canceled := fmt.Errorf("private cancellation details: %w", context.Canceled)
	err := NewAPIRequestError(APILinePrimary, canceled)
	if !errors.Is(err, context.Canceled) || err.Error() != "主线路请求已取消" {
		t.Errorf("cancellation must not suggest switching lines: %v", err)
	}
}

func TestAPIStatusErrorsDoNotExposeHeadersOrSuggestLimitBypass(t *testing.T) {
	for _, test := range []struct {
		header string
		wait   string
	}{
		{"60", "60 秒"},
		{" 120 ", "120 秒"},
		{"0", "1 秒"},
		{"7200", "3600 秒"},
		{"", ""},
		{"-1", ""},
		{"+1", ""},
		{"999999999999999999999999999999999999", ""},
		{"Wed, 21 Oct 2015 07:28:00 GMT", ""},
		{"1\r\nX-Private: secret-token", ""},
	} {
		err := NewAPIStatusError(APILineBackup, 429, test.header)
		message := err.Error()
		if !strings.Contains(message, "备用线路") || !strings.Contains(message, "HTTP 429") || !strings.Contains(message, "稍后重试") && test.wait == "" {
			t.Errorf("missing safe rate-limit message for %q: %s", test.header, message)
		}
		if test.wait != "" && !strings.Contains(message, test.wait) {
			t.Errorf("missing bounded wait %q for %q: %s", test.wait, test.header, message)
		}
		if strings.Contains(message, "切换") || strings.Contains(message, "secret-token") || strings.ContainsAny(message, "\r\n") || strings.Contains(message, "Wed") {
			t.Errorf("unsafe rate-limit advice: %s", message)
		}
	}
	for _, status := range []int{400, 401, 403, 404, 500, 503, 504} {
		message := NewAPIStatusError(APILinePrimary, status, "private.example secret-token").Error()
		if !strings.Contains(message, fmt.Sprintf("HTTP %d", status)) || strings.Contains(message, "private.example") || strings.Contains(message, "secret-token") || strings.Contains(message, "切换") {
			t.Errorf("unexpected HTTP error: %s", message)
		}
	}
	if message := NewAPIStatusError(APILinePrimary, -1, "secret-token").Error(); message != "主线路请求失败，请稍后重试" {
		t.Errorf("invalid status exposed an unexpected value: %s", message)
	}
	statusError := NewAPIStatusError(APILineBackup, 429, "120")
	wrapped := fmt.Errorf("private.example secret-token: %w", statusError)
	public := NewAPIRequestError(APILineBackup, wrapped)
	if public.Error() != statusError.Error() || !errors.Is(public, statusError) {
		t.Errorf("wrapping a rate-limit error changed its safe advice or lost its cause: %s", public)
	}
}
