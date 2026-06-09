package parser

import (
	"strings"
	"testing"
)

func TestParseMissionContentHandlesInlineModeBrace(t *testing.T) {
	mission := `"mission"
{
	"DisplayTitle" "City Escape"
	"modes"
	{
		"coop" {
			"1"
			{
				"Map" "c1m1_hotel"
				"DisplayName" "The Hotel"
			}
		}
	}
}`

	campaign := ParseMissionContent(strings.NewReader(mission))
	if campaign == nil {
		t.Fatalf("expected campaign")
	}
	if campaign.Title != "City Escape" {
		t.Fatalf("expected title City Escape, got %q", campaign.Title)
	}
	if len(campaign.Chapters) != 1 {
		t.Fatalf("expected one chapter, got %d", len(campaign.Chapters))
	}

	chapter := campaign.Chapters[0]
	if chapter.Code != "c1m1_hotel" {
		t.Fatalf("expected chapter code c1m1_hotel, got %q", chapter.Code)
	}
	if chapter.Title != "The Hotel" {
		t.Fatalf("expected chapter title The Hotel, got %q", chapter.Title)
	}
	if len(chapter.Modes) != 1 || chapter.Modes[0] != "战役模式" {
		t.Fatalf("expected translated coop mode, got %#v", chapter.Modes)
	}
}
