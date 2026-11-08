package relay

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

var (
	workshopID = regexp.MustCompile(`^[1-9][0-9]{0,19}$`)
	mapCode    = regexp.MustCompile(`^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}$`)
)

// The host and path are selected here; no request can supply a destination URL.
type route struct {
	name, method, upstream, path string
	query                        url.Values
}

func selectRoute(r *http.Request) route {
	switch r.URL.Path {
	case "/list":
		return route{"list", "GET", "l4d2-workshop.laoyutang.cn", "/list", nil}
	case "/detail":
		return route{"detail", "GET", "l4d2-workshop.laoyutang.cn", "/detail", nil}
	case "/parse", "/":
		return route{"parse", "POST", "l4d2-workshop-parse.laoyutang.cn", "/", nil}
	case "/ips":
		return route{"ips", "GET", "lytvpk-get-ips.laoyutang.cn", "/", nil}
	default:
		if strings.HasPrefix(r.URL.Path, "/maps/") {
			return route{"maps", "GET", "l4d2-maps.laoyutang.cn", strings.TrimPrefix(r.URL.Path, "/maps"), nil}
		}
		return route{name: "unknown"}
	}
}

func validateQuery(r *http.Request, dest *route) error {
	// Reject alternate encodings of separators and path characters, rather than
	// relying on a front proxy and Go to normalize a path in the same way.
	if r.URL.RawPath != "" || len(r.URL.RawQuery) > 4096 || !utf8.ValidString(r.URL.RawQuery) {
		return fmt.Errorf("invalid or oversized URL")
	}
	q, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		return fmt.Errorf("invalid query encoding")
	}
	allowed := map[string]bool{}
	switch dest.name {
	case "list":
		allowed = map[string]bool{"page": true, "q": true, "sort": true, "tags": true, "filetype": true}
		if page := q.Get("page"); page != "" {
			n, err := strconv.ParseUint(page, 10, 32)
			if err != nil || n > 1000000 || strings.HasPrefix(page, "+") {
				return fmt.Errorf("page must be an integer between 0 and 1000000")
			}
		}
		if !oneOf(q.Get("sort"), "", "trend", "recent", "top") || !oneOf(q.Get("filetype"), "", "0", "1") {
			return fmt.Errorf("invalid sort or filetype")
		}
		if !safeText(q.Get("q"), 512) || !safeText(q.Get("tags"), 1024) || len(strings.Split(q.Get("tags"), ",")) > 32 {
			return fmt.Errorf("search or tags too long or invalid")
		}
	case "detail":
		allowed = map[string]bool{"id": true, "with_previews": true}
		if !validID(q.Get("id")) || !oneOf(strings.ToLower(q.Get("with_previews")), "", "0", "1", "false", "true") {
			return fmt.Errorf("invalid id or with_previews")
		}
	case "maps":
		code := strings.TrimPrefix(dest.path, "/")
		if !mapCode.MatchString(code) || strings.Contains(code, "..") {
			return fmt.Errorf("invalid map code")
		}
	case "ips":
		allowed = map[string]bool{"domain": true, "format": true}
		if !oneOf(q.Get("domain"), "", "cdn.steamusercontent.com") || !oneOf(q.Get("format"), "", "entries") {
			return fmt.Errorf("unsupported IP pool domain or format")
		}
	}
	for key, values := range q {
		if !allowed[key] || len(values) != 1 {
			return fmt.Errorf("unknown or duplicate query parameter")
		}
	}
	if dest.name == "ips" {
		q.Set("domain", "cdn.steamusercontent.com")
		q.Set("format", "entries")
	}
	dest.query = q
	return nil
}

func validID(id string) bool {
	if !workshopID.MatchString(id) {
		return false
	}
	_, err := strconv.ParseUint(id, 10, 64)
	return err == nil
}

func oneOf(value string, choices ...string) bool {
	for _, choice := range choices {
		if value == choice {
			return true
		}
	}
	return false
}

func safeText(value string, maxBytes int) bool {
	return len(value) <= maxBytes && utf8.ValidString(value) && !strings.ContainsFunc(value, unicode.IsControl)
}

func validateParseBody(body []byte, maxIDs int) (int, error) {
	decoder := json.NewDecoder(bytes.NewReader(body))
	var values []json.RawMessage
	if err := decoder.Decode(&values); err != nil || len(values) == 0 || len(values) > maxIDs {
		return 0, fmt.Errorf("payload must be a non-empty JSON array of at most %d workshop IDs", maxIDs)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return 0, fmt.Errorf("payload must contain exactly one JSON array")
	}
	for _, raw := range values {
		value := string(raw)
		if len(raw) > 0 && raw[0] == '"' {
			if err := json.Unmarshal(raw, &value); err != nil {
				return 0, fmt.Errorf("invalid workshop ID")
			}
		}
		if !validID(value) {
			return 0, fmt.Errorf("workshop IDs must be positive uint64 decimal integers or strings")
		}
	}
	return (len(values) + 99) / 100, nil
}
