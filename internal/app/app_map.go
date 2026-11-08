package app

import (
	"io"
	"net/http"
	"net/url"
	"strings"

	"vpk-manager/internal/network"
)

// GetMapName 获取地图真实名称
func (a *App) GetMapName(mapCode string) string {
	if mapCode == "" {
		return ""
	}

	name, _ := a.getMapNameWithOperation(a.captureAPIOperation(), mapCode)
	return name
}

func (a *App) getMapNameWithOperation(operation apiOperation, mapCode string) (string, error) {
	if strings.TrimSpace(mapCode) == "" {
		return "", nil
	}
	request, err := http.NewRequestWithContext(operation.ctx, http.MethodGet, strings.TrimRight(operation.endpoints.MapBaseURL, "/")+"/"+url.PathEscape(mapCode), nil)
	if err != nil {
		return "", network.NewAPIRequestError(operation.line, err)
	}
	response, err := operation.mapClient.Do(request)
	if err != nil {
		return "", network.NewAPIRequestError(operation.line, err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", network.NewAPIStatusError(operation.line, response.StatusCode, response.Header.Get("Retry-After"))
	}
	content, err := io.ReadAll(io.LimitReader(response.Body, 64<<10))
	if err != nil {
		return "", network.NewAPIRequestError(operation.line, err)
	}
	return strings.TrimSpace(string(content)), nil
}
