package relay

import (
	"fmt"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestValidWorkshopIDs(t *testing.T) {
	for _, id := range []string{"1", "123456789", "9007199254740993", "18446744073709551615"} {
		if !validID(id) {
			t.Errorf("validID(%q) = false", id)
		}
	}
	for _, id := range []string{"", "0", "01", "-1", "+1", "1.0", "1e3", "18446744073709551616", "100000000000000000000", "１", " 1", "1 ", "1\n", "1/2"} {
		if validID(id) {
			t.Errorf("validID(%q) = true", id)
		}
	}
}

func TestParseBodyValidation(t *testing.T) {
	for _, body := range []string{`[1]`, `["1"]`, `[9007199254740993,"18446744073709551615"]`, " [ 123 , \"456\" ] \n", `["\u0031"]`} {
		t.Run("valid_"+body, func(t *testing.T) {
			if cost, err := validateParseBody([]byte(body), 1000); err != nil || cost != 1 {
				t.Errorf("validateParseBody() = (%d, %v)", cost, err)
			}
		})
	}
	for _, body := range []string{"", "null", "{}", `{"ids":[1]}`, "[]", "[[]]", "[{}]", "[null]", "[true]", "[0]", "[-1]", "[1.0]", "[1e3]", `["01"]`, `["-1"]`, `["1.0"]`, `["1e3"]`, `[" 1"]`, `["18446744073709551616"]`, "[18446744073709551616]", "[1] [2]", "[1] null", "[1]garbage", "[1,]", "[+1]", `["1\u0000"]`} {
		t.Run("invalid_"+body, func(t *testing.T) {
			if _, err := validateParseBody([]byte(body), 1000); err == nil {
				t.Error("accepted invalid parse payload")
			}
		})
	}
	for _, count := range []int{1, 99, 100, 101, 999, 1000, 1001} {
		t.Run(fmt.Sprintf("batch_%d", count), func(t *testing.T) {
			body := "[" + strings.Repeat("1,", count-1) + "1]"
			cost, err := validateParseBody([]byte(body), 1000)
			if count > 1000 {
				if err == nil {
					t.Fatal("accepted batch above configured bound")
				}
				return
			}
			if err != nil || cost != (count+99)/100 {
				t.Errorf("cost=%d err=%v", cost, err)
			}
		})
	}
	if _, err := validateParseBody([]byte(`[1,2]`), 1); err == nil {
		t.Error("ignored configured parse ID bound")
	}
}

func TestQueryValidationCompatibleRequests(t *testing.T) {
	cases := []struct {
		target, name, upstream, path string
	}{
		{"/list", "list", "l4d2-workshop.laoyutang.cn", "/list"},
		{"/list?page=0&q=&sort=&filetype=", "list", "l4d2-workshop.laoyutang.cn", "/list"},
		{"/list?page=1000000&q=" + url.QueryEscape("测试地图 空格") + "&tags=Map,Weapon&sort=recent&filetype=1", "list", "l4d2-workshop.laoyutang.cn", "/list"},
		{"/detail?id=18446744073709551615&with_previews=TRUE", "detail", "l4d2-workshop.laoyutang.cn", "/detail"},
		{"/detail?id=1&with_previews=0", "detail", "l4d2-workshop.laoyutang.cn", "/detail"},
		{"/parse", "parse", "l4d2-workshop-parse.laoyutang.cn", "/"},
		{"/", "parse", "l4d2-workshop-parse.laoyutang.cn", "/"},
		{"/maps/c1m1_hotel", "maps", "l4d2-maps.laoyutang.cn", "/c1m1_hotel"},
		{"/maps/map-name.v1", "maps", "l4d2-maps.laoyutang.cn", "/map-name.v1"},
		{"/ips", "ips", "lytvpk-get-ips.laoyutang.cn", "/"},
		{"/ips?domain=cdn.steamusercontent.com&format=entries", "ips", "lytvpk-get-ips.laoyutang.cn", "/"},
	}
	for _, tc := range cases {
		t.Run(tc.target, func(t *testing.T) {
			r := httptest.NewRequest("GET", tc.target, nil)
			dest := selectRoute(r)
			if dest.name != tc.name || dest.upstream != tc.upstream || dest.path != tc.path {
				t.Fatalf("route = %+v", dest)
			}
			if err := validateQuery(r, &dest); err != nil {
				t.Fatal(err)
			}
			if tc.name == "ips" && (dest.query.Get("domain") != "cdn.steamusercontent.com" || dest.query.Get("format") != "entries") {
				t.Errorf("IP pool query = %v", dest.query)
			}
		})
	}
}

func TestQueryValidationRejectsInvalidAndAmbiguousInputs(t *testing.T) {
	targets := []string{
		"/list?url=http://127.0.0.1", "/list?target=https://example.com", "/list?page=-1", "/list?page=1.5", "/list?page=1e3", "/list?page=1000001", "/list?page=%2B1", "/list?sort=other", "/list?filetype=2",
		"/list?q=a&q=b", "/list?page=1&page=2", "/list?sort=top&sort=top", "/list?q=%FF", "/list?q=a%00b", "/list?q=a%0Ab", "/list?q=%zz", "/list?q=a;b", "/list?q=" + strings.Repeat("a", 513), "/list?tags=" + strings.Repeat("t,", 32) + "t", "/list?tags=" + strings.Repeat("a", 1025),
		"/detail", "/detail?id=0", "/detail?id=18446744073709551616", "/detail?id=1&with_previews=yes", "/detail?id=1&id=2", "/detail?id=1&with_previews=1&with_previews=0", "/detail?id=1&url=https://example.com",
		"/parse?url=https://example.com", "/?x=1", "/maps/", "/maps/.", "/maps/..", "/maps/map..name", "/maps/map/name", "/maps/map%2Fname", "/maps/map%5Cname", "/maps/%2e%2e", "/maps/%63ode", "/maps/" + strings.Repeat("a", 129), "/maps/c1m1_hotel?url=https://example.com",
		"/ips?domain=example.com", "/ips?format=text", "/ips?url=http://127.0.0.1", "/ips?domain=cdn.steamusercontent.com&domain=example.com", "/ips?format=entries&format=text",
		"/list?q=" + strings.Repeat("a", 4097),
	}
	for _, target := range targets {
		t.Run(target, func(t *testing.T) {
			r := httptest.NewRequest("GET", target, nil)
			dest := selectRoute(r)
			if err := validateQuery(r, &dest); err == nil {
				t.Errorf("accepted target %q", target)
			}
		})
	}
}

func TestSafeTextUTF8AndByteLimits(t *testing.T) {
	for _, tc := range []struct {
		value string
		limit int
		want  bool
	}{
		{"", 0, true}, {"abc", 3, true}, {"abc", 2, false}, {"地图", 6, true}, {"地图", 5, false}, {"hello world", 20, true},
		{"\xff", 2, false}, {"line\n", 8, false}, {"\t", 1, false}, {"\x00", 1, false}, {"\x7f", 1, false},
	} {
		if got := safeText(tc.value, tc.limit); got != tc.want {
			t.Errorf("safeText(%q,%d)=%v, want %v", tc.value, tc.limit, got, tc.want)
		}
	}
}
