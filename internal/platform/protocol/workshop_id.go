package protocol

import (
	"fmt"
	"net/url"
	"strings"
)

// ParseWorkshopID extracts an explicit item ID without fetching the URL. Do not
// infer an ID from arbitrary URL digits: addonURL0 can point to an author's page.
func ParseWorkshopID(value string) (string, error) {
	value = strings.TrimSpace(value)
	if IsValidWorkshopID(value) {
		return value, nil
	}
	if !strings.Contains(value, "://") {
		value = "https://" + value
	}
	u, err := url.Parse(value)
	if err != nil {
		return "", fmt.Errorf("invalid workshop URL")
	}
	scheme := strings.ToLower(u.Scheme)
	if (scheme != "http" && scheme != "https") || u.User != nil {
		return "", fmt.Errorf("invalid workshop URL")
	}
	host := strings.ToLower(u.Hostname())
	isHost := func(domain string) bool {
		return host == domain || strings.HasSuffix(host, "."+domain)
	}
	path := strings.TrimSuffix(strings.ToLower(u.Path), "/")
	if (isHost("steamcommunity.com") || isHost("steampowered.com")) &&
		(path == "/sharedfiles/filedetails" || path == "/workshop/filedetails") {
		query, queryErr := url.ParseQuery(u.RawQuery)
		if ids := query["id"]; queryErr == nil && len(ids) == 1 && IsValidWorkshopID(ids[0]) {
			return ids[0], nil
		}
	}
	if isHost("steamworkshop.download") && strings.HasPrefix(path, "/view/") {
		id := strings.TrimPrefix(path, "/view/")
		if IsValidWorkshopID(id) {
			return id, nil
		}
	}
	return "", fmt.Errorf("could not find valid workshop ID in URL")
}
