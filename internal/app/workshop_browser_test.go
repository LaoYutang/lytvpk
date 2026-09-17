package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// 校验 /detail 默认轻量（不查询多图预览）、带 with_previews 才返回完整图集，以及两套缓存的隔离
func TestFetchWorkshopDetailPreviews(t *testing.T) {
	var mu sync.Mutex
	var gotQueries []string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		gotQueries = append(gotQueries, r.URL.RawQuery)
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"response":{"publishedfiledetails":[{
			"publishedfileid":"123456",
			"title":"Test Mod",
			"preview_url":"https://images.steamusercontent.com/main.jpg",
			"previews":[{"preview_url":"https://images.steamusercontent.com/1.jpg","preview_type":0}],
			"time_updated":"1700000000"
		}]}}`))
	}))
	defer server.Close()

	resetWorkshopDetailTestClient(t, server.URL)

	app := &App{}

	// 1) 默认（轻量）：不带 with_previews
	if _, err := app.fetchWorkshopDetailRaw("123456", false, false); err != nil {
		t.Fatalf("默认轻量模式请求失败: %v", err)
	}
	// 2) 完整模式：带 with_previews=1，且不能命中轻量缓存
	if _, err := app.fetchWorkshopDetailRaw("123456", false, true); err != nil {
		t.Fatalf("完整模式请求失败: %v", err)
	}
	// 3) 再次完整模式：命中完整缓存，不再发请求
	if _, err := app.fetchWorkshopDetailRaw("123456", false, true); err != nil {
		t.Fatalf("完整模式缓存命中失败: %v", err)
	}
	// 4) 再次默认模式：命中轻量缓存，不再发请求
	if _, err := app.fetchWorkshopDetailRaw("123456", false, false); err != nil {
		t.Fatalf("默认模式缓存命中失败: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()

	if len(gotQueries) != 2 {
		t.Fatalf("上游请求次数应为 2（默认 1 次 + 完整 1 次），实际 %d: %#v", len(gotQueries), gotQueries)
	}
	if strings.Contains(gotQueries[0], "with_previews") {
		t.Errorf("默认模式不应带 with_previews，实际 query: %q", gotQueries[0])
	}
	if !strings.Contains(gotQueries[1], "with_previews=1") {
		t.Errorf("完整模式应带 with_previews=1，实际 query: %q", gotQueries[1])
	}
	if !strings.Contains(gotQueries[1], "id=123456") {
		t.Errorf("完整模式应带 id，实际 query: %q", gotQueries[1])
	}
}
