package app

import "testing"

func TestParseWorkshopIDsSingleID(t *testing.T) {
	got, err := (&App{}).parseWorkshopIDs("123456")
	if err != nil {
		t.Fatalf("parseWorkshopIDs returned error: %v", err)
	}

	if len(got) != 1 || got[0] != "123456" {
		t.Fatalf("expected single id, got %#v", got)
	}
}

func TestParseWorkshopIDsMultipleIDs(t *testing.T) {
	got, err := (&App{}).parseWorkshopIDs("123456, 234567")
	if err != nil {
		t.Fatalf("parseWorkshopIDs returned error: %v", err)
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

func TestParseWorkshopIDsDeduplicatesInOrder(t *testing.T) {
	got, err := (&App{}).parseWorkshopIDs("123456,234567,123456")
	if err != nil {
		t.Fatalf("parseWorkshopIDs returned error: %v", err)
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

func TestParseWorkshopIDsExtractsSteamURL(t *testing.T) {
	got, err := (&App{}).parseWorkshopIDs("https://steamcommunity.com/sharedfiles/filedetails/?id=123456")
	if err != nil {
		t.Fatalf("parseWorkshopIDs returned error: %v", err)
	}

	if len(got) != 1 || got[0] != "123456" {
		t.Fatalf("expected id from Steam URL, got %#v", got)
	}
}

func TestParseWorkshopIDsRejectsInvalidID(t *testing.T) {
	if _, err := (&App{}).parseWorkshopIDs("123456,abc"); err == nil {
		t.Fatal("expected invalid id to be rejected")
	}
}

func TestBuildWorkshopDetailsGroup(t *testing.T) {
	group := buildWorkshopDetailsGroup(
		"123456",
		WorkshopFileDetails{
			Result:          0,
			PublishedFileId: "123456",
			Title:           "Collection",
			Filename:        "preview.jpg",
			Children: []WorkshopChild{
				{PublishedFileId: "234567"},
			},
		},
		[]WorkshopFileDetails{
			{
				Result:          1,
				PublishedFileId: "234567",
				Title:           "Child Mod",
				Filename:        "myl4d2addons child.vpk",
				FileUrl:         "https://cdn.steamusercontent.com/file.vpk",
			},
		},
	)

	if group.RootID != "123456" {
		t.Fatalf("expected root id, got %q", group.RootID)
	}
	if len(group.Items) != 2 {
		t.Fatalf("expected main and child items, got %#v", group.Items)
	}
	if len(group.DownloadableItems) != 1 {
		t.Fatalf("expected one downloadable item, got %#v", group.DownloadableItems)
	}
	if group.DownloadableItems[0].Filename != "child.vpk" {
		t.Fatalf("expected cleaned filename, got %q", group.DownloadableItems[0].Filename)
	}
}
