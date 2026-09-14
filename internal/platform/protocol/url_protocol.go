package protocol

import (
	"fmt"
	neturl "net/url"
	"regexp"
	"strconv"
	"strings"

	"vpk-manager/internal/serveraddress"
)

// ProtocolAction 协议操作类型
type ProtocolAction string

const (
	// ProtocolActionParse 解析工坊ID
	ProtocolActionParse ProtocolAction = "parse"
	// ProtocolActionWorkshop 在管理器中打开工坊页面
	ProtocolActionWorkshop ProtocolAction = "workshop"
	// ProtocolActionFavoriteServer 添加收藏服务器
	ProtocolActionFavoriteServer ProtocolAction = "favoriteServer"
)

const WorkshopIDDelimiter = ","

// ProtocolURL 协议URL结构
type ProtocolURL struct {
	Action        ProtocolAction
	WorkshopID    string
	ServerName    string
	ServerAddress string
}

// ParseProtocolURL 解析 lytvpk:// 协议URL
// 支持格式:
//   - lytvpk://parse/{workshop_id}
//   - lytvpk://parse/{workshop_id},{workshop_id}
//   - lytvpk://workshop/{workshop_id}
//   - lytvpk://favoriteServer/{server_name}/{server_address}
func ParseProtocolURL(rawURL string) (*ProtocolURL, error) {
	// 检查协议前缀
	if !strings.HasPrefix(rawURL, "lytvpk://") {
		return nil, fmt.Errorf("无效的协议URL: %s", rawURL)
	}

	// 移除协议前缀
	path := strings.TrimPrefix(rawURL, "lytvpk://")

	// 分割路径
	parts := strings.Split(path, "/")
	if len(parts) < 2 {
		return nil, fmt.Errorf("协议URL格式错误: %s", rawURL)
	}

	action := strings.ToLower(parts[0])

	// 验证操作类型
	var protocolAction ProtocolAction
	switch action {
	case "parse":
		protocolAction = ProtocolActionParse
	case "workshop":
		protocolAction = ProtocolActionWorkshop
	case "favoriteserver":
		protocolAction = ProtocolActionFavoriteServer
	default:
		return nil, fmt.Errorf("未知的协议操作: %s", action)
	}

	switch protocolAction {
	case ProtocolActionParse:
		decodedID, err := decodePathSegment(parts[1])
		if err != nil {
			return nil, err
		}
		ids, err := ParseWorkshopIDList(decodedID)
		if err != nil {
			return nil, err
		}
		return &ProtocolURL{
			Action:     protocolAction,
			WorkshopID: strings.Join(ids, WorkshopIDDelimiter),
		}, nil
	case ProtocolActionWorkshop:
		decodedID, err := decodePathSegment(parts[1])
		if err != nil {
			return nil, err
		}
		if strings.Contains(decodedID, WorkshopIDDelimiter) {
			return nil, fmt.Errorf("工坊打开协议只支持单个工坊ID: %s", decodedID)
		}
		if !IsValidWorkshopID(decodedID) {
			return nil, fmt.Errorf("无效的工坊ID: %s", decodedID)
		}
		return &ProtocolURL{
			Action:     protocolAction,
			WorkshopID: decodedID,
		}, nil
	case ProtocolActionFavoriteServer:
		if len(parts) != 3 {
			return nil, fmt.Errorf("收藏服务器协议格式错误，应为 lytvpk://favoriteServer/{server_name}/{server_address}")
		}

		serverName, err := decodePathSegment(parts[1])
		if err != nil {
			return nil, err
		}
		serverAddress, err := decodePathSegment(parts[2])
		if err != nil {
			return nil, err
		}

		serverName = strings.TrimSpace(serverName)
		if err := validateFavoriteServerName(serverName); err != nil {
			return nil, err
		}
		serverAddress, err = serveraddress.Normalize(serverAddress)
		if err != nil {
			return nil, err
		}

		return &ProtocolURL{
			Action:        protocolAction,
			ServerName:    serverName,
			ServerAddress: serverAddress,
		}, nil
	}

	return nil, fmt.Errorf("未知的协议操作: %s", protocolAction)
}

func decodePathSegment(value string) (string, error) {
	decoded, err := neturl.PathUnescape(value)
	if err != nil {
		return "", fmt.Errorf("协议URL编码错误")
	}
	return decoded, nil
}

func validateFavoriteServerName(name string) error {
	if name == "" {
		return fmt.Errorf("服务器名称不能为空")
	}
	if strings.IndexFunc(name, func(r rune) bool { return r < 0x20 || r == 0x7f }) >= 0 {
		return fmt.Errorf("服务器名称不能包含控制字符")
	}
	return nil
}

// ParseWorkshopIDList 解析由英文逗号分隔的工坊ID列表。
// 返回值会去重并保留首次出现顺序。
func ParseWorkshopIDList(input string) ([]string, error) {
	input = strings.TrimSpace(input)
	if input == "" {
		return nil, fmt.Errorf("工坊ID不能为空")
	}

	parts := strings.Split(input, WorkshopIDDelimiter)
	ids := make([]string, 0, len(parts))
	seen := make(map[string]bool, len(parts))

	for _, part := range parts {
		id := strings.TrimSpace(part)
		if id == "" {
			return nil, fmt.Errorf("工坊ID列表包含空项")
		}
		if !IsValidWorkshopID(id) {
			return nil, fmt.Errorf("无效的工坊ID: %s", id)
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		ids = append(ids, id)
	}

	if len(ids) == 0 {
		return nil, fmt.Errorf("工坊ID不能为空")
	}

	return ids, nil
}

// isValidWorkshopID 验证工坊ID是否有效
// Steam工坊ID是正整数且通常较大（最小值设为100000以过滤无效ID）
func IsValidWorkshopID(id string) bool {
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
	if p.Action == ProtocolActionFavoriteServer {
		return fmt.Sprintf(
			"lytvpk://%s/%s/%s",
			p.Action,
			neturl.PathEscape(p.ServerName),
			neturl.PathEscape(p.ServerAddress),
		)
	}
	return fmt.Sprintf("lytvpk://%s/%s", p.Action, p.WorkshopID)
}
