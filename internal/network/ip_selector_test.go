package network

import (
	"strings"
	"testing"
)

func TestDecodeIPOptionsNormalizesEntries(t *testing.T) {
	options, err := decodeIPOptions(strings.NewReader(`[
		{"ip":"23.59.72.59","category":"steam官方-韩国"},
		{"ip":"23.55.51.221","category":""},
		{"ip":"not-an-ip","category":"坏数据"},
		{"ip":"23.59.72.59","category":"重复分类"}
	]`))
	if err != nil {
		t.Fatalf("decodeIPOptions returned error: %v", err)
	}

	want := []IPOption{
		{IP: "23.59.72.59", Category: "steam官方-韩国"},
		{IP: "23.55.51.221", Category: uncategorizedIPCategory},
	}
	if len(options) != len(want) {
		t.Fatalf("expected %d options, got %d: %#v", len(want), len(options), options)
	}
	for i := range want {
		if options[i] != want[i] {
			t.Fatalf("option %d: expected %#v, got %#v", i, want[i], options[i])
		}
	}
}

func TestGetBestIPOptionIncludesSelectedCategory(t *testing.T) {
	selector := &IPSelector{}
	selector.setIPOptionsForTest([]IPOption{
		{IP: "23.59.72.59", Category: "steam官方-韩国"},
	})
	selector.mu.Lock()
	selector.cachedBestIP = "23.59.72.59"
	selector.cachedSpeed = 7.5
	selector.mu.Unlock()

	option := selector.GetCachedBestIPOption()
	if option.IP != "23.59.72.59" || option.Category != "steam官方-韩国" {
		t.Fatalf("expected cached option with category, got %#v", option)
	}
}

func TestFixedIPOptionUsesKnownOrCustomCategory(t *testing.T) {
	selector := &IPSelector{}
	selector.setIPOptionsForTest([]IPOption{
		{IP: "23.55.51.221", Category: "steam官方-日本"},
	})

	selector.SetFixedIP("23.55.51.221")
	option := selector.GetCachedBestIPOption()
	if option.IP != "23.55.51.221" || option.Category != "steam官方-日本" {
		t.Fatalf("expected known fixed option, got %#v", option)
	}

	selector.SetFixedIP("203.0.113.10")
	option = selector.GetCachedBestIPOption()
	if option.IP != "203.0.113.10" || option.Category != customIPCategory {
		t.Fatalf("expected custom fixed option, got %#v", option)
	}
}

func TestDefaultIPOptionsUseBuiltinCategory(t *testing.T) {
	options := defaultIPOptions()
	if len(options) != len(defaultSteamCDNIPs) {
		t.Fatalf("expected %d default options, got %d", len(defaultSteamCDNIPs), len(options))
	}
	for _, option := range options {
		if option.IP == "" || option.Category != builtinIPCategory {
			t.Fatalf("expected builtin option, got %#v", option)
		}
	}
}
