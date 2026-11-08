package app

import (
	"fmt"
	"net/http"
	"net/netip"
	"strings"
	"time"

	"vpk-manager/internal/network"

	"github.com/go-resty/resty/v2"
)

type WorkshopDNSConfig struct {
	Mode          string `json:"mode"`
	CustomAddress string `json:"customAddress"`
}

func defaultWorkshopDNSConfig() WorkshopDNSConfig {
	return WorkshopDNSConfig{Mode: "dnspod"}
}

func normalizeWorkshopDNSConfig(config WorkshopDNSConfig) (WorkshopDNSConfig, error) {
	config.Mode = strings.TrimSpace(config.Mode)
	config.CustomAddress = strings.TrimSpace(config.CustomAddress)
	if config.Mode == "" {
		config.Mode = "dnspod"
	}
	switch config.Mode {
	case "dnspod", "alidns", "system", "custom":
	default:
		return WorkshopDNSConfig{}, fmt.Errorf("无效的工坊 DNS 模式")
	}
	if config.CustomAddress != "" {
		ip, err := netip.ParseAddr(config.CustomAddress)
		if err != nil || ip.Zone() != "" {
			return WorkshopDNSConfig{}, fmt.Errorf("自定义 DNS 必须是单个有效的 IPv4 或 IPv6 地址")
		}
		ip = ip.Unmap()
		if ip.IsUnspecified() || ip.IsMulticast() {
			return WorkshopDNSConfig{}, fmt.Errorf("自定义 DNS 必须是单个有效的 IPv4 或 IPv6 地址")
		}
		config.CustomAddress = ip.String()
	}
	if config.Mode == "custom" && config.CustomAddress == "" {
		return WorkshopDNSConfig{}, fmt.Errorf("请输入自定义 DNS 地址")
	}
	return config, nil
}

func (config WorkshopDNSConfig) server() string {
	switch config.Mode {
	case "system":
		return ""
	case "alidns":
		return "223.5.5.5"
	case "custom":
		return config.CustomAddress
	default:
		return "119.29.29.29"
	}
}

type workshopNetworkClients struct {
	transport *http.Transport
	browser   *resty.Client
	parser    *http.Client
}

func newWorkshopNetworkClients(config WorkshopDNSConfig) *workshopNetworkClients {
	return newWorkshopNetworkClientsForLine(config, network.APILinePrimary)
}

func newWorkshopNetworkClientsForLine(config WorkshopDNSConfig, line network.APILine) *workshopNetworkClients {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DialContext = network.NewWorkshopDialer(config.server()).DialContext
	timeout := network.APIRequestTimeout(line, 30*time.Second)
	browser := resty.New().SetTimeout(timeout).SetRetryCount(0).SetTransport(transport)
	browser.GetClient().CheckRedirect = stopAPIRedirect
	return &workshopNetworkClients{
		transport: transport,
		browser:   browser,
		parser:    &http.Client{Transport: transport, Timeout: timeout, CheckRedirect: stopAPIRedirect},
	}
}

func (a *App) getWorkshopNetworkClients() *workshopNetworkClients {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.getWorkshopNetworkClientsLocked()
}

func (a *App) getWorkshopNetworkClientsLocked() *workshopNetworkClients {
	if a.workshopNetwork == nil {
		a.workshopNetwork = newWorkshopNetworkClientsForLine(a.workshopDNSConfig, a.apiLineLocked())
	}
	return a.workshopNetwork
}

func (a *App) getWorkshopClient() *resty.Client {
	return a.getWorkshopNetworkClients().browser
}

func (a *App) GetWorkshopDNSConfig() WorkshopDNSConfig {
	a.mu.RLock()
	defer a.mu.RUnlock()
	config := a.workshopDNSConfig
	if config.Mode == "" {
		config.Mode = "dnspod"
	}
	return config
}

func (a *App) SetWorkshopDNSConfig(config WorkshopDNSConfig) error {
	config, err := normalizeWorkshopDNSConfig(config)
	if err != nil {
		return err
	}
	a.configWriteMu.Lock()
	a.mu.Lock()
	clients := newWorkshopNetworkClientsForLine(config, a.apiLineLocked())
	snapshot := a.snapshotConfigLocked()
	snapshot.WorkshopDNS = &config
	if err := a.writeConfigFileLocked(snapshot); err != nil {
		a.mu.Unlock()
		a.configWriteMu.Unlock()
		clients.transport.CloseIdleConnections()
		return fmt.Errorf("保存工坊 DNS 设置失败: %w", err)
	}
	previous := a.workshopNetwork
	a.workshopDNSConfig = config
	a.workshopNetwork = clients
	a.mu.Unlock()
	a.configWriteMu.Unlock()
	if previous != nil {
		previous.transport.CloseIdleConnections()
	}
	return nil
}
