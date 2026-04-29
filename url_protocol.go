package main

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// ProtocolAction 协议操作类型
type ProtocolAction string

const (
	// ProtocolActionParse 解析工坊ID
	ProtocolActionParse ProtocolAction = "parse"
	// ProtocolActionWorkshop 在管理器中打开工坊页面
	ProtocolActionWorkshop ProtocolAction = "workshop"
)

// ProtocolURL 协议URL结构
type ProtocolURL struct {
	Action     ProtocolAction
	WorkshopID string
}

// ParseProtocolURL 解析 lytvpk:// 协议URL
// 支持格式:
//   - lytvpk://parse/{workshop_id}
//   - lytvpk://workshop/{workshop_id}
func ParseProtocolURL(url string) (*ProtocolURL, error) {
	// 检查协议前缀
	if !strings.HasPrefix(url, "lytvpk://") {
		return nil, fmt.Errorf("无效的协议URL: %s", url)
	}

	// 移除协议前缀
	path := strings.TrimPrefix(url, "lytvpk://")

	// 分割路径
	parts := strings.Split(path, "/")
	if len(parts) < 2 {
		return nil, fmt.Errorf("协议URL格式错误: %s", url)
	}

	action := strings.ToLower(parts[0])
	id := parts[1]

	// 验证操作类型
	var protocolAction ProtocolAction
	switch action {
	case "parse":
		protocolAction = ProtocolActionParse
	case "workshop":
		protocolAction = ProtocolActionWorkshop
	default:
		return nil, fmt.Errorf("未知的协议操作: %s", action)
	}

	// 验证工坊ID（必须是数字）
	if !isValidWorkshopID(id) {
		return nil, fmt.Errorf("无效的工坊ID: %s", id)
	}

	return &ProtocolURL{
		Action:     protocolAction,
		WorkshopID: id,
	}, nil
}

// isValidWorkshopID 验证工坊ID是否有效
// Steam工坊ID是正整数且通常较大（最小值设为100000以过滤无效ID）
func isValidWorkshopID(id string) bool {
	// 使用正则验证是否为纯数字
	matched, _ := regexp.MatchString(`^\d+$`, id)
	if !matched {
		return false
	}

	// 验证数字范围（Steam工坊ID通常是正整数）
	num, err := strconv.ParseInt(id, 10, 64)
	if err != nil {
		return false
	}

	return num >= 100000
}

// String 返回协议URL的字符串表示
func (p *ProtocolURL) String() string {
	return fmt.Sprintf("lytvpk://%s/%s", p.Action, p.WorkshopID)
}
