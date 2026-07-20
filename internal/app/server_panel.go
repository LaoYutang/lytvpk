package app

import (
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/go-resty/resty/v2"
)

type PanelUser struct {
	Name     string `json:"name"`
	ID       int    `json:"id"`
	SteamID  string `json:"steamid"`
	IP       string `json:"ip"`
	Location string `json:"location"`
	Status   string `json:"status"`
	Delay    int    `json:"delay"`
	Loss     int    `json:"loss"`
	Duration string `json:"duration"`
	LinkRate int    `json:"linkrate"`
}

type PanelServerStatus struct {
	Users      []PanelUser `json:"users"`
	Players    string      `json:"players"`
	Map        string      `json:"map"`
	Hostname   string      `json:"hostname"`
	Name       string      `json:"name"`
	ServerName string      `json:"serverName"`
	Difficulty string      `json:"difficulty"`
	GameMode   string      `json:"gameMode"`
}

type PanelCampaign struct {
	Title    string         `json:"title"`
	Chapters []PanelChapter `json:"chapters"`
	VpkName  string         `json:"vpkName"`
}

type PanelChapter struct {
	Code  string   `json:"code"`
	Title string   `json:"title"`
	Modes []string `json:"modes"`
}

type PanelMapHotReloadStatus struct {
	UsingDefault bool `json:"using_default"`
}

type PanelMapHotReloadResult struct {
	Status  string `json:"status"`
	Message string `json:"message"`
}

type panelCredentials struct {
	baseURL    string
	password   string
	serverName string
}

func (a *App) FetchPanelServerStatus(serverID string) (*PanelServerStatus, error) {
	var status PanelServerStatus
	if _, err := a.panelPost(serverID, "/rcon/getstatus", nil, &status); err != nil {
		return nil, err
	}
	status.Hostname = firstNonEmpty(status.Hostname, status.Name, status.ServerName)
	return &status, nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func (a *App) RestartPanelServer(serverID string) (string, error) {
	return a.panelPost(serverID, "/restart", nil, nil)
}

func (a *App) FetchPanelMapList(serverID string) ([]PanelCampaign, error) {
	var maps []PanelCampaign
	if _, err := a.panelPost(serverID, "/rcon/maplist", nil, &maps); err != nil {
		return nil, err
	}
	if maps == nil {
		return []PanelCampaign{}, nil
	}
	return maps, nil
}

func (a *App) ClearPanelMaps(serverID string) (string, error) {
	return a.panelPost(serverID, "/clear", nil, nil)
}

func (a *App) ChangePanelMap(serverID string, mapName string) (string, error) {
	mapName = strings.TrimSpace(mapName)
	if mapName == "" {
		return "", fmt.Errorf("地图名称不能为空")
	}
	return a.panelPost(serverID, "/rcon/changemap", map[string]string{"mapName": mapName}, nil)
}

func (a *App) FetchPanelMapHotReloadStatus(serverID string) (*PanelMapHotReloadStatus, error) {
	var status PanelMapHotReloadStatus
	if _, err := a.panelPost(serverID, "/maps/hot-reload/status", nil, &status); err != nil {
		return nil, err
	}
	return &status, nil
}

func (a *App) HotReloadPanelMaps(serverID string) (*PanelMapHotReloadResult, error) {
	var result PanelMapHotReloadResult
	if _, err := a.panelPost(serverID, "/maps/hot-reload", nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (a *App) ChangePanelDifficulty(serverID string, difficulty string) (string, error) {
	difficulty = strings.TrimSpace(difficulty)
	switch difficulty {
	case "简单", "普通", "高级", "专家":
	default:
		return "", fmt.Errorf("难度无效")
	}
	return a.panelPost(serverID, "/rcon/changedifficulty", map[string]string{"difficulty": difficulty}, nil)
}

func (a *App) SendPanelRconCommand(serverID string, cmd string) (string, error) {
	cmd = strings.TrimSpace(cmd)
	if cmd == "" {
		return "", fmt.Errorf("RCON 指令不能为空")
	}
	return a.panelPost(serverID, "/rcon", map[string]string{"cmd": cmd}, nil)
}

func (a *App) getPanelCredentials(serverID string) (*panelCredentials, error) {
	serverID = strings.TrimSpace(serverID)
	if serverID == "" {
		return nil, fmt.Errorf("服务器 ID 不能为空")
	}

	a.ensureConfigPaths()
	var storage ServerStorage
	if err := readJSONFile(a.serversPath, &storage); err != nil {
		return nil, fmt.Errorf("读取服务器配置失败: %w", err)
	}

	for _, server := range storage.Servers {
		if server.ID != serverID {
			continue
		}
		baseURL, err := normalizePanelBaseURL(server.PanelURL)
		if err != nil {
			return nil, err
		}
		if strings.TrimSpace(server.PanelPasswordEncrypted) == "" {
			return nil, fmt.Errorf("该服务器未保存面板密码")
		}
		password, err := unprotectSecret(server.PanelPasswordEncrypted)
		if err != nil {
			return nil, err
		}
		return &panelCredentials{
			baseURL:    baseURL,
			password:   password,
			serverName: firstNonEmpty(server.Name, server.Address, server.ID),
		}, nil
	}

	return nil, fmt.Errorf("未找到面板配置对应的服务器")
}

func (a *App) panelPost(serverID string, endpoint string, formData map[string]string, result interface{}) (string, error) {
	credentials, err := a.getPanelCredentials(serverID)
	if err != nil {
		return "", err
	}

	requestURL, err := joinPanelEndpoint(credentials.baseURL, endpoint)
	if err != nil {
		return "", err
	}

	client := resty.New().SetTimeout(8 * time.Second)
	request := client.R().SetHeader("Authorization", "Bearer "+credentials.password)
	if formData != nil {
		request.SetFormData(formData)
	}
	if result != nil {
		request.SetResult(result)
	}

	response, err := request.Post(requestURL)
	if err != nil {
		return "", fmt.Errorf("连接面板失败: %w", err)
	}
	if response.StatusCode() == 401 || response.StatusCode() == 429 {
		return "", fmt.Errorf("面板认证失败，请检查密码或稍后重试")
	}
	if response.StatusCode() == 403 {
		return "", fmt.Errorf("没有权限执行该面板操作")
	}
	if !response.IsSuccess() {
		body := strings.TrimSpace(response.String())
		if body == "" {
			body = response.Status()
		}
		return "", fmt.Errorf("面板请求失败(%d): %s", response.StatusCode(), body)
	}

	return strings.TrimSpace(response.String()), nil
}

func normalizePanelBaseURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", fmt.Errorf("面板地址不能为空")
	}
	if !strings.Contains(raw, "://") {
		raw = "http://" + raw
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("面板地址格式无效: %w", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", fmt.Errorf("面板地址仅支持 http 或 https")
	}
	if parsed.Host == "" {
		return "", fmt.Errorf("面板地址缺少主机")
	}
	parsed.RawQuery = ""
	parsed.Fragment = ""
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	return parsed.String(), nil
}

func joinPanelEndpoint(base string, endpoint string) (string, error) {
	parsed, err := url.Parse(base)
	if err != nil {
		return "", err
	}
	if !strings.HasPrefix(endpoint, "/") {
		endpoint = "/" + endpoint
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/") + endpoint
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}
