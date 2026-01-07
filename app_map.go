package main

import (
	"strings"
	"time"

	"github.com/go-resty/resty/v2"
)

// GetMapName 获取地图真实名称
func (a *App) GetMapName(mapCode string) string {
	if mapCode == "" {
		return ""
	}

	// 使用独立的 Client 以设置短超时，避免影响全局
	client := resty.New()
	client.SetTimeout(2 * time.Second)

	resp, err := client.R().Get("https://l4d2-maps.laoyutang.cn/" + mapCode)
	if err != nil {
		return ""
	}

	if resp.StatusCode() != 200 {
		return ""
	}

	name := resp.String()
	if strings.TrimSpace(name) == "" {
		return ""
	}

	return strings.TrimSpace(name)
}
