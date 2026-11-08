package network

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"
)

// APILine selects the endpoint for the application's public metadata APIs.
type APILine string

const (
	APILinePrimary APILine = "primary"
	APILineBackup  APILine = "backup"

	backupAPIBaseURL = "https://lytvpk-backup.laoyutang.cn"
)

// APIEndpoints contains only the fixed public metadata API destinations.
// WorkshopBaseURL has no trailing slash; MapBaseURL includes its final slash.
type APIEndpoints struct {
	WorkshopBaseURL string
	ParseURL        string
	MapBaseURL      string
	IPPoolURL       string
}

// NormalizeAPILine defaults an unset preference to the primary line.
func NormalizeAPILine(value string) (APILine, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", string(APILinePrimary):
		return APILinePrimary, nil
	case string(APILineBackup):
		return APILineBackup, nil
	default:
		return "", errors.New("无效的 API 线路设置")
	}
}

// APILineLabel returns a user-facing label without exposing the endpoint.
func APILineLabel(line APILine) string {
	if line == APILineBackup {
		return "备用线路"
	}
	return "主线路"
}

// EndpointsForAPILine returns an independent set of fixed API destinations.
// An invalid line cannot introduce another host and uses the primary endpoints.
func EndpointsForAPILine(line APILine) APIEndpoints {
	if line == APILineBackup {
		return APIEndpoints{
			WorkshopBaseURL: backupAPIBaseURL,
			ParseURL:        backupAPIBaseURL + "/parse",
			MapBaseURL:      backupAPIBaseURL + "/maps/",
			IPPoolURL:       backupAPIBaseURL + "/ips",
		}
	}
	return APIEndpoints{
		WorkshopBaseURL: "https://l4d2-workshop.laoyutang.cn",
		ParseURL:        "https://l4d2-workshop-parse.laoyutang.cn",
		MapBaseURL:      "https://l4d2-maps.laoyutang.cn/",
		IPPoolURL:       "https://lytvpk-get-ips.laoyutang.cn/",
	}
}

// APIRequestTimeout gives the backup enough time to return its own 10s timeout.
// The primary line keeps each caller's existing timeout.
func APIRequestTimeout(line APILine, primaryDuration time.Duration) time.Duration {
	if line == APILineBackup {
		return 12 * time.Second
	}
	return primaryDuration
}

type apiRequestError struct {
	message string
	cause   error
}

func (e *apiRequestError) Error() string { return e.message }
func (e *apiRequestError) Unwrap() error { return e.cause }

type apiStatusError struct{ message string }

func (e *apiStatusError) Error() string { return e.message }

// NewAPIRequestError keeps the original cause inspectable while its displayed
// message never includes an address or the low-level transport error.
func NewAPIRequestError(line APILine, err error) error {
	if err == nil {
		return nil
	}
	label := APILineLabel(line)
	if errors.Is(err, context.Canceled) {
		return &apiRequestError{message: label + "请求已取消", cause: err}
	}
	var statusError *apiStatusError
	if errors.As(err, &statusError) {
		return &apiRequestError{message: statusError.Error(), cause: err}
	}
	other := "备用线路"
	if line == APILineBackup {
		other = "主线路"
	}
	message := label + "请求失败"
	var networkError net.Error
	if errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &networkError) && networkError.Timeout()) {
		message = label + "请求超时"
	}
	return &apiRequestError{
		message: message + "，请稍后重试，或在设置中手动切换" + other + "后重试",
		cause:   err,
	}
}

// NewAPIStatusError displays only the line, numeric status and a bounded retry
// hint. It never uses arbitrary response-header text in its error message.
func NewAPIStatusError(line APILine, status int, retryAfter string) error {
	label := APILineLabel(line)
	if status == 429 {
		if seconds, ok := boundedRetryAfterSeconds(retryAfter); ok {
			return &apiStatusError{message: fmt.Sprintf("%s请求过于频繁（HTTP 429），请至少等待 %d 秒后重试", label, seconds)}
		}
		return &apiStatusError{message: label + "请求过于频繁（HTTP 429），请稍后重试"}
	}
	if status == 504 {
		return &apiStatusError{message: label + "请求超时（HTTP 504），请稍后重试"}
	}
	if status == 502 || status == 503 {
		return &apiStatusError{message: fmt.Sprintf("%s暂时不可用（HTTP %d），请稍后重试", label, status)}
	}
	if status >= 100 && status <= 599 {
		return &apiStatusError{message: fmt.Sprintf("%s请求失败（HTTP %d），请稍后重试", label, status)}
	}
	return &apiStatusError{message: label + "请求失败，请稍后重试"}
}

func boundedRetryAfterSeconds(value string) (uint64, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, false
	}
	for _, character := range value {
		if character < '0' || character > '9' {
			return 0, false
		}
	}
	seconds, err := strconv.ParseUint(value, 10, 64)
	if err != nil {
		return 0, false
	}
	if seconds < 1 {
		seconds = 1
	}
	if seconds > 3600 {
		seconds = 3600
	}
	return seconds, true
}
