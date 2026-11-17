package protocol

import "testing"

func TestParseWorkshopID(t *testing.T) {
	valid := []string{
		"123456",
		" 123456 ",
		"https://steamcommunity.com/sharedfiles/filedetails/?id=123456&searchtext=",
		"http://www.steamcommunity.com/workshop/filedetails/?id=123456#comments",
		"steamcommunity.com/sharedfiles/filedetails/?id=123456",
		"https://STEAMCOMMUNITY.COM/sharedfiles/filedetails/?id=123456",
		"HTTPS://steamcommunity.com/sharedfiles/filedetails/?id=123456",
		"https://steamworkshop.download/view/123456/",
	}
	for _, value := range valid {
		t.Run(value, func(t *testing.T) {
			if id, err := ParseWorkshopID(value); err != nil || id != "123456" {
				t.Fatalf("got %q, %v", id, err)
			}
		})
	}
	invalid := []string{
		"", "abc", "99999", "-123456", "direct-123456", "9223372036854775808",
		"https://notsteamcommunity.com/sharedfiles/filedetails/?id=123456",
		"https://steamcommunity.com.example.com/sharedfiles/filedetails/?id=123456",
		"https://example.com/steamcommunity.com/sharedfiles/filedetails/?id=123456",
		"https://steamcommunity.com@other.example/sharedfiles/filedetails/?id=123456",
		"https://steamcommunity.com/profiles/123456",
		"https://steamcommunity.com/sharedfiles/filedetails/?other=123456",
		"https://steamcommunity.com/sharedfiles/filedetails/?id=abc&other=123456",
		"https://steamcommunity.com/sharedfiles/filedetails/?id=123456&id=234567",
		"https://steamcommunity.com/sharedfiles/filedetails/?id=123456&bad=%zz",
		"ftp://steamcommunity.com/sharedfiles/filedetails/?id=123456",
		"https://steamworkshop.download/view/123456/other",
	}
	for _, value := range invalid {
		t.Run(value, func(t *testing.T) {
			if id, err := ParseWorkshopID(value); err == nil || id != "" {
				t.Fatalf("unexpected identity %q, %v", id, err)
			}
		})
	}
}
