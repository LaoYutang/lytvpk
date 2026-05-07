package app

import (
	"strings"
)

// GetMapName 获取地图真实名称
func (a *App) GetMapName(mapCode string) string {
	if mapCode == "" {
		return ""
	}

	resp, err := a.restyClient.R().Get("https://l4d2-maps.laoyutang.cn/" + mapCode)

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
