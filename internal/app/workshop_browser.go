package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-resty/resty/v2"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// WorkshopBrowserService 处理创意工坊浏览相关的逻辑
// 这些方法直接挂载在 *App 上，供前端调用

// 定义 Cloudflare Worker 的地址
var WorkshopWorkerURL = "https://l4d2-workshop.laoyutang.cn"

// WorkshopQueryOptions 前端传来的搜索参数
type WorkshopQueryOptions struct {
	Page       int      `json:"page"`
	SearchText string   `json:"search_text"`
	Sort       string   `json:"sort"` // trend, recent, top
	Tags       []string `json:"tags"`
	FileType   string   `json:"filetype"`
}

// WorkshopPreviewItem 列表页专用的精简结构
type WorkshopPreviewItem struct {
	PublishedFileId string `json:"publishedfileid"`
	Title           string `json:"title"`
	PreviewUrl      string `json:"preview_url"`
	Author          string `json:"creator"` // 注意：Steam 有时返回的是 ID，可能需要二次查询用户名
	FileType        int    `json:"file_type"`
	Views           int    `json:"views"`
	Subscriptions   int    `json:"subscriptions"`
	Favorited       int    `json:"favorited"`
	Tags            []struct {
		Tag string `json:"tag"`
	} `json:"tags"`
}

// SteamMsgResponse 是 Steam API 的顶层包装
type SteamMsgResponse struct {
	Response struct {
		PublishedFileDetails []WorkshopPreviewItem `json:"publishedfiledetails"`
		Total                int                   `json:"total"`
	} `json:"response"`
}

// WorkshopListResult 返回给前端的最终结构
type WorkshopListResult struct {
	Items []WorkshopPreviewItem `json:"items"`
	Total int                   `json:"total"`
}

// WorkshopPreviewImage 定义预览图结构
type WorkshopPreviewImage struct {
	PreviewUrl  string `json:"preview_url"`
	PreviewType int    `json:"preview_type"`
}

// WorkshopItemDetail 对应 GetPublishedFileDetails 的单个结果
type WorkshopItemDetail struct {
	PublishedFileId string                 `json:"publishedfileid"`
	Title           string                 `json:"title"`
	Creator         string                 `json:"creator"`
	Description     string                 `json:"description"`
	FileUrl         string                 `json:"file_url"`
	PreviewUrl      string                 `json:"preview_url"`
	Previews        []WorkshopPreviewImage `json:"previews"`
	FileType        int                    `json:"file_type"`
	FileSize        interface{}            `json:"file_size"`
	TimeCreated     interface{}            `json:"time_created"`
	TimeUpdated     interface{}            `json:"time_updated"`
	Subscriptions   interface{}            `json:"subscriptions"`
	Favorited       interface{}            `json:"favorited"`
	Views           interface{}            `json:"views"`
	Tags            []struct {
		Tag string `json:"tag"`
	} `json:"tags"`
	ChildItems []WorkshopPreviewItem `json:"child_items"`
}

type SteamDetailResponse struct {
	Response struct {
		PublishedFileDetails []WorkshopItemDetail `json:"publishedfiledetails"`
	} `json:"response"`
}

// ---------------------------------------------------
// 缓存与单例客户端
// ---------------------------------------------------

type WorkshopCacheItem struct {
	Data      interface{}
	ExpiresAt time.Time
}

var (
	workshopClient     *resty.Client
	workshopClientOnce sync.Once
	workshopCache      sync.Map
)

func getWorkshopClient() *resty.Client {
	workshopClientOnce.Do(func() {
		dialer := &net.Dialer{
			Timeout:   30 * time.Second,
			KeepAlive: 30 * time.Second,
		}
		transport := &http.Transport{
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				return dialer.DialContext(ctx, "tcp4", addr)
			},
		}
		workshopClient = resty.New()
		workshopClient.SetTimeout(15 * time.Second)
		workshopClient.SetRetryCount(2)
		workshopClient.SetTransport(transport)
	})
	return workshopClient
}

func getWorkshopCache(key string) (interface{}, bool) {
	val, ok := workshopCache.Load(key)
	if !ok {
		return nil, false
	}
	item := val.(WorkshopCacheItem)
	if time.Now().After(item.ExpiresAt) {
		workshopCache.Delete(key)
		return nil, false
	}
	return item.Data, true
}

func setWorkshopCache(key string, data interface{}) {
	workshopCache.Store(key, WorkshopCacheItem{
		Data:      data,
		ExpiresAt: time.Now().Add(1 * time.Hour),
	})
}

// FetchWorkshopList 获取创意工坊列表
func (a *App) FetchWorkshopList(opts WorkshopQueryOptions) (WorkshopListResult, error) {
	// 1. 检查缓存
	// 使用 opts 的 JSON 字符串作为 Key
	ctxKeyBytes, _ := json.Marshal(opts)
	cacheKey := "list:" + string(ctxKeyBytes)

	if val, ok := getWorkshopCache(cacheKey); ok {
		if res, ok := val.(WorkshopListResult); ok {
			fmt.Println("[Workshop] Hit Cache for List")
			return res, nil
		}
	}

	client := getWorkshopClient()

	req := client.R().
		SetQueryParam("page", strconv.Itoa(opts.Page)).
		SetQueryParam("q", opts.SearchText).
		SetQueryParam("sort", opts.Sort).
		SetResult(&SteamMsgResponse{})

	if len(opts.Tags) > 0 {
		req.SetQueryParam("tags", strings.Join(opts.Tags, ","))
	}
	if opts.FileType != "" {
		req.SetQueryParam("filetype", opts.FileType)
	}

	// Log request for debugging
	fmt.Printf("[Workshop] Fetching List: Page=%d, Q=%s, Sort=%s, FileType=%s\n", opts.Page, opts.SearchText, opts.Sort, opts.FileType)

	// 发起请求到 Cloudflare Worker (Path: /list)
	resp, err := req.Get(WorkshopWorkerURL + "/list")

	if err != nil {
		runtime.LogErrorf(a.ctx, "Failed to fetch workshop list: %v", err)
		return WorkshopListResult{}, fmt.Errorf("network error: %w", err)
	}

	if resp.StatusCode() != http.StatusOK {
		return WorkshopListResult{}, fmt.Errorf("API returned status: %d", resp.StatusCode())
	}

	result := resp.Result().(*SteamMsgResponse)

	// Log first item ID for debugging duplication issues
	if len(result.Response.PublishedFileDetails) > 0 {
		fmt.Printf("[Workshop] Got %d items. First ID: %s\n", len(result.Response.PublishedFileDetails), result.Response.PublishedFileDetails[0].PublishedFileId)
	} else {
		fmt.Println("[Workshop] Got 0 items")
	}

	finalResult := WorkshopListResult{
		Items: result.Response.PublishedFileDetails,
		Total: result.Response.Total,
	}

	// Process images if preferred IP is enabled
	if a.GetWorkshopPreferredIP() {
		for i := range finalResult.Items {
			finalResult.Items[i].PreviewUrl = a.processWorkshopImage(finalResult.Items[i].PreviewUrl)
		}
	}

	// 写入缓存
	setWorkshopCache(cacheKey, finalResult)

	return finalResult, nil
}

// FetchWorkshopDetail 获取单个MOD详情（详情页需要图集，走完整模式）
func (a *App) FetchWorkshopDetail(id string) (WorkshopItemDetail, error) {
	item, err := a.fetchWorkshopDetailRaw(id, false, true)
	if err != nil {
		return WorkshopItemDetail{}, err
	}
	return a.processWorkshopDetailImages(item), nil
}

// fetchWorkshopDetailRaw 获取未经过本地图片代理处理的工坊详情。
// forceRefresh 为 true 时跳过进程内缓存，但请求成功后仍会刷新缓存。
// withPreviews 为 false 时走服务端默认的轻量模式（不查询多图预览，省一次 Steam API 调用），
// 两种模式使用独立缓存键，避免互相覆盖。
func (a *App) fetchWorkshopDetailRaw(id string, forceRefresh bool, withPreviews bool) (WorkshopItemDetail, error) {
	cacheKey := "detail:raw:" + id
	if withPreviews {
		cacheKey = "detail:raw:previews:" + id
	}
	if !forceRefresh {
		if val, ok := getWorkshopCache(cacheKey); ok {
			if res, ok := val.(WorkshopItemDetail); ok {
				fmt.Println("[Workshop] Hit Cache for Detail:", id)
				return res, nil
			}
		}
	}

	client := getWorkshopClient()

	req := client.R().
		SetQueryParam("id", id).
		SetResult(&SteamDetailResponse{})

	if withPreviews {
		req.SetQueryParam("with_previews", "1")
	}

	resp, err := req.Get(WorkshopWorkerURL + "/detail")
	if err != nil {
		return WorkshopItemDetail{}, err
	}

	if resp.StatusCode() != http.StatusOK {
		return WorkshopItemDetail{}, fmt.Errorf("API error: %d", resp.StatusCode())
	}

	result := resp.Result().(*SteamDetailResponse)
	if len(result.Response.PublishedFileDetails) == 0 {
		return WorkshopItemDetail{}, fmt.Errorf("item not found")
	}

	item := result.Response.PublishedFileDetails[0]

	setWorkshopCache(cacheKey, item)

	return item, nil
}

func (a *App) processWorkshopDetailImages(item WorkshopItemDetail) WorkshopItemDetail {
	if !a.GetWorkshopPreferredIP() {
		return item
	}

	// 复制切片，避免修改缓存中的原始 URL。
	item.Previews = append([]WorkshopPreviewImage(nil), item.Previews...)
	item.ChildItems = append([]WorkshopPreviewItem(nil), item.ChildItems...)
	item.PreviewUrl = a.processWorkshopImage(item.PreviewUrl)
	for i := range item.Previews {
		item.Previews[i].PreviewUrl = a.processWorkshopImage(item.Previews[i].PreviewUrl)
	}
	for i := range item.ChildItems {
		item.ChildItems[i].PreviewUrl = a.processWorkshopImage(item.ChildItems[i].PreviewUrl)
	}
	return item
}

func (a *App) processWorkshopImage(url string) string {
	if a.GetWorkshopPreferredIP() && a.proxyServer != nil {
		return a.proxyServer.GetProxyUrl(url)
	}
	return url
}
