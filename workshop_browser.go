package main

import (
	"encoding/json"
	"fmt"
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
}

// WorkshopPreviewItem 列表页专用的精简结构
type WorkshopPreviewItem struct {
	PublishedFileId string `json:"publishedfileid"`
	Title           string `json:"title"`
	PreviewUrl      string `json:"preview_url"`
	Author          string `json:"creator"` // 注意：Steam 有时返回的是 ID，可能需要二次查询用户名
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
	Description     string                 `json:"description"`
	FileUrl         string                 `json:"file_url"`
	PreviewUrl      string                 `json:"preview_url"`
	Previews        []WorkshopPreviewImage `json:"previews"`
	FileSize        interface{}            `json:"file_size"`
	TimeCreated     interface{}            `json:"time_created"`
	TimeUpdated     interface{}            `json:"time_updated"`
	Subscriptions   interface{}            `json:"subscriptions"`
	Favorited       interface{}            `json:"favorited"`
	Views           interface{}            `json:"views"`
	Tags            []struct {
		Tag string `json:"tag"`
	} `json:"tags"`
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
		workshopClient = resty.New()
		workshopClient.SetTimeout(15 * time.Second)
		workshopClient.SetRetryCount(2)
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
		ExpiresAt: time.Now().Add(30 * time.Minute),
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

	finalResult := WorkshopListResult{
		Items: result.Response.PublishedFileDetails,
		Total: result.Response.Total,
	}

	// 写入缓存
	setWorkshopCache(cacheKey, finalResult)

	return finalResult, nil
}

// FetchWorkshopDetail 获取单个MOD详情
func (a *App) FetchWorkshopDetail(id string) (WorkshopItemDetail, error) {
	cacheKey := "detail:" + id
	if val, ok := getWorkshopCache(cacheKey); ok {
		if res, ok := val.(WorkshopItemDetail); ok {
			fmt.Println("[Workshop] Hit Cache for Detail:", id)
			return res, nil
		}
	}

	client := getWorkshopClient()

	req := client.R().
		SetQueryParam("id", id).
		SetResult(&SteamDetailResponse{})

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
