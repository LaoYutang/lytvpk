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
