package protocol

import "testing"

func TestParseProtocolURLParseSupportsMultipleIDs(t *testing.T) {
	got, err := ParseProtocolURL("lytvpk://parse/123456,234567")
	if err != nil {
		t.Fatalf("ParseProtocolURL returned error: %v", err)
	}

	if got.Action != ProtocolActionParse {
		t.Fatalf("expected parse action, got %q", got.Action)
	}
	if got.WorkshopID != "123456,234567" {
		t.Fatalf("expected normalized ids, got %q", got.WorkshopID)
	}
}

func TestParseProtocolURLParseSupportsEscapedComma(t *testing.T) {
	got, err := ParseProtocolURL("lytvpk://parse/123456%2C234567")
	if err != nil {
		t.Fatalf("ParseProtocolURL returned error: %v", err)
	}

	if got.WorkshopID != "123456,234567" {
		t.Fatalf("expected decoded ids, got %q", got.WorkshopID)
	}
}

func TestParseProtocolURLWorkshopRejectsMultipleIDs(t *testing.T) {
	if _, err := ParseProtocolURL("lytvpk://workshop/123456,234567"); err == nil {
		t.Fatal("expected multi-id workshop URL to be rejected")
	}
}

func TestParseProtocolURLFavoriteServer(t *testing.T) {
	got, err := ParseProtocolURL("lytvpk://favoriteServer/%E6%B5%8B%E8%AF%95%2F%E6%9C%8D%E5%8A%A1%E5%99%A8/example.com%3A27015")
	if err != nil {
		t.Fatalf("ParseProtocolURL returned error: %v", err)
	}

	if got.Action != ProtocolActionFavoriteServer {
		t.Fatalf("expected favoriteServer action, got %q", got.Action)
	}
	if got.ServerName != "测试/服务器" {
		t.Fatalf("expected decoded server name, got %q", got.ServerName)
	}
	if got.ServerAddress != "example.com:27015" {
		t.Fatalf("expected decoded server address, got %q", got.ServerAddress)
	}
}

func TestParseProtocolURLFavoriteServerSupportsIPv6(t *testing.T) {
	got, err := ParseProtocolURL("lytvpk://favoriteServer/IPv6/%5B2001%3Adb8%3A%3A1%5D%3A27015")
	if err != nil {
		t.Fatalf("ParseProtocolURL returned error: %v", err)
	}
	if got.ServerAddress != "[2001:db8::1]:27015" {
		t.Fatalf("expected IPv6 server address, got %q", got.ServerAddress)
	}
}

func TestParseProtocolURLFavoriteServerUsesDefaultPort(t *testing.T) {
	got, err := ParseProtocolURL("lytvpk://favoriteServer/Test/example.com")
	if err != nil {
		t.Fatalf("ParseProtocolURL returned error: %v", err)
	}
	if got.ServerAddress != "example.com:27015" {
		t.Fatalf("expected default server port, got %q", got.ServerAddress)
	}
}

func TestParseProtocolURLFavoriteServerRejectsInvalidInput(t *testing.T) {
	tests := []string{
		"lytvpk://favoriteServer//127.0.0.1:27015",
		"lytvpk://favoriteServer/Test/127.0.0.1:0",
		"lytvpk://favoriteServer/Test/127.0.0.1:65536",
		"lytvpk://favoriteServer/Test/127.0.0.1:27015/extra",
	}

	for _, rawURL := range tests {
		t.Run(rawURL, func(t *testing.T) {
			if _, err := ParseProtocolURL(rawURL); err == nil {
				t.Fatalf("expected %q to be rejected", rawURL)
			}
		})
	}
}

func TestProtocolURLFavoriteServerStringRoundTrip(t *testing.T) {
	want := &ProtocolURL{
		Action:        ProtocolActionFavoriteServer,
		ServerName:    "中文/服务器",
		ServerAddress: "127.0.0.1:27015",
	}

	got, err := ParseProtocolURL(want.String())
	if err != nil {
		t.Fatalf("round trip returned error: %v", err)
	}
	if got.Action != want.Action || got.ServerName != want.ServerName || got.ServerAddress != want.ServerAddress {
		t.Fatalf("round trip mismatch: want %#v, got %#v", want, got)
	}
}

func TestParseWorkshopIDList(t *testing.T) {
	got, err := ParseWorkshopIDList("123456, 234567,123456")
	if err != nil {
		t.Fatalf("ParseWorkshopIDList returned error: %v", err)
	}

	want := []string{"123456", "234567"}
	if len(got) != len(want) {
		t.Fatalf("expected %d ids, got %d: %#v", len(want), len(got), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("id %d: expected %q, got %q", i, want[i], got[i])
		}
	}
}

func TestParseWorkshopIDListRejectsInvalidID(t *testing.T) {
	if _, err := ParseWorkshopIDList("123456,abc"); err == nil {
		t.Fatal("expected invalid id to be rejected")
	}
}
