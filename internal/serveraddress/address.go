package serveraddress

import (
	"fmt"
	"net"
	"strconv"
	"strings"
	"unicode"
)

const DefaultPort = 27015

// Normalize 规范化 L4D2 服务器地址。未填写端口时使用默认端口 27015。
func Normalize(rawAddress string) (string, error) {
	address := strings.TrimSpace(rawAddress)
	if address == "" {
		return "", fmt.Errorf("服务器地址不能为空")
	}
	if containsInvalidAddressCharacter(address) {
		return "", fmt.Errorf("无效的服务器地址")
	}

	if strings.HasPrefix(address, "[") {
		return normalizeBracketedIPv6(address)
	}
	if strings.ContainsAny(address, "[]") {
		return "", fmt.Errorf("无效的 IPv6 服务器地址")
	}

	switch strings.Count(address, ":") {
	case 0:
		if err := validateHost(address); err != nil {
			return "", err
		}
		return net.JoinHostPort(address, strconv.Itoa(DefaultPort)), nil
	case 1:
		host, portText, _ := strings.Cut(address, ":")
		if err := validateHost(host); err != nil {
			return "", err
		}
		port, err := normalizePort(portText)
		if err != nil {
			return "", err
		}
		return net.JoinHostPort(host, port), nil
	default:
		if !isValidIPv6Host(address) {
			return "", fmt.Errorf("无效的 IPv6 服务器地址")
		}
		return net.JoinHostPort(address, strconv.Itoa(DefaultPort)), nil
	}
}

func normalizeBracketedIPv6(address string) (string, error) {
	closingBracket := strings.IndexByte(address, ']')
	if closingBracket < 0 {
		return "", fmt.Errorf("无效的 IPv6 服务器地址")
	}

	host := address[1:closingBracket]
	if !isValidIPv6Host(host) {
		return "", fmt.Errorf("无效的 IPv6 服务器地址")
	}

	remainder := address[closingBracket+1:]
	if remainder == "" {
		return net.JoinHostPort(host, strconv.Itoa(DefaultPort)), nil
	}
	if !strings.HasPrefix(remainder, ":") || strings.Contains(remainder[1:], ":") {
		return "", fmt.Errorf("无效的 IPv6 服务器地址")
	}

	port, err := normalizePort(remainder[1:])
	if err != nil {
		return "", err
	}
	return net.JoinHostPort(host, port), nil
}

func normalizePort(portText string) (string, error) {
	if portText == "" {
		return strconv.Itoa(DefaultPort), nil
	}
	if strings.IndexFunc(portText, func(r rune) bool { return r < '0' || r > '9' }) >= 0 {
		return "", fmt.Errorf("无效的服务器端口")
	}
	port, err := strconv.Atoi(portText)
	if err != nil || port < 1 || port > 65535 {
		return "", fmt.Errorf("无效的服务器端口")
	}
	return strconv.Itoa(port), nil
}

func validateHost(host string) error {
	if host == "" || strings.ContainsAny(host, ":%") {
		return fmt.Errorf("无效的服务器地址")
	}
	return nil
}

func isValidIPv6Host(host string) bool {
	ipText := host
	if zoneIndex := strings.LastIndexByte(host, '%'); zoneIndex >= 0 {
		if zoneIndex == 0 || zoneIndex == len(host)-1 {
			return false
		}
		ipText = host[:zoneIndex]
	}
	ip := net.ParseIP(ipText)
	return ip != nil && strings.Contains(ipText, ":")
}

func containsInvalidAddressCharacter(address string) bool {
	if strings.ContainsAny(address, "/?#\\") {
		return true
	}
	return strings.IndexFunc(address, func(r rune) bool {
		return unicode.IsSpace(r) || unicode.IsControl(r)
	}) >= 0
}
