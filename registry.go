//go:build windows

package main

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows/registry"
)

const (
	// 协议名称
	ProtocolName = "lytvpk"
	// 协议描述
	ProtocolDescription = "URL:LytVPK Protocol"
)

// RegisterURLProtocol 注册 lytvpk:// URL协议到 Windows 注册表
// 使用 HKEY_CURRENT_USER\Software\Classes，无需管理员权限
func RegisterURLProtocol() error {
	// 获取当前可执行文件路径
	exePath, err := getExecutablePath()
	if err != nil {
		return fmt.Errorf("获取可执行文件路径失败: %w", err)
	}

	// 打开或创建注册表键
	key, _, err := registry.CreateKey(
		registry.CURRENT_USER,
		`Software\Classes\`+ProtocolName,
		registry.SET_VALUE|registry.CREATE_SUB_KEY,
	)
	if err != nil {
		return fmt.Errorf("创建注册表键失败: %w", err)
	}
	defer key.Close()

	// 设置默认值（协议描述）
	if err := key.SetStringValue("", ProtocolDescription); err != nil {
		return fmt.Errorf("设置默认值失败: %w", err)
	}

	// 设置 URL Protocol 标识（空字符串）
	if err := key.SetStringValue("URL Protocol", ""); err != nil {
		return fmt.Errorf("设置URL Protocol失败: %w", err)
	}

	// 创建 shell\open\command 子键
	commandKey, _, err := registry.CreateKey(
		key,
		`shell\open\command`,
		registry.SET_VALUE,
	)
	if err != nil {
		return fmt.Errorf("创建command子键失败: %w", err)
	}
	defer commandKey.Close()

	// 设置命令：使用可执行文件路径处理URL参数
	// 格式: "path\to\exe" "%1"
	command := fmt.Sprintf(`"%s" "%s"`, exePath, "%1")
	if err := commandKey.SetStringValue("", command); err != nil {
		return fmt.Errorf("设置命令失败: %w", err)
	}

	log.Printf("URL协议注册成功: %s://%s", ProtocolName, exePath)
	return nil
}

// UnregisterURLProtocol 注销 lytvpk:// URL协议
func UnregisterURLProtocol() error {
	// 删除注册表键
	err := registry.DeleteKey(
		registry.CURRENT_USER,
		`Software\Classes\`+ProtocolName+`\shell\open\command`,
	)
	if err != nil && err != registry.ErrNotExist {
		return fmt.Errorf("删除command子键失败: %w", err)
	}

	err = registry.DeleteKey(
		registry.CURRENT_USER,
		`Software\Classes\`+ProtocolName+`\shell\open`,
	)
	if err != nil && err != registry.ErrNotExist {
		return fmt.Errorf("删除open子键失败: %w", err)
	}

	err = registry.DeleteKey(
		registry.CURRENT_USER,
		`Software\Classes\`+ProtocolName+`\shell`,
	)
	if err != nil && err != registry.ErrNotExist {
		return fmt.Errorf("删除shell子键失败: %w", err)
	}

	err = registry.DeleteKey(
		registry.CURRENT_USER,
		`Software\Classes\`+ProtocolName,
	)
	if err != nil && err != registry.ErrNotExist {
		return fmt.Errorf("删除主键失败: %w", err)
	}

	log.Printf("URL协议注销成功: %s://", ProtocolName)
	return nil
}

// IsURLProtocolRegistered 检查URL协议是否已注册
func IsURLProtocolRegistered() (bool, error) {
	key, err := registry.OpenKey(
		registry.CURRENT_USER,
		`Software\Classes\`+ProtocolName,
		registry.READ,
	)
	if err != nil {
		if err == registry.ErrNotExist {
			return false, nil
		}
		return false, fmt.Errorf("打开注册表键失败: %w", err)
	}
	defer key.Close()

	return true, nil
}

// GetRegisteredExePath 获取已注册的可执行文件路径
func GetRegisteredExePath() (string, error) {
	commandKey, err := registry.OpenKey(
		registry.CURRENT_USER,
		`Software\Classes\`+ProtocolName+`\shell\open\command`,
		registry.READ,
	)
	if err != nil {
		return "", fmt.Errorf("打开command子键失败: %w", err)
	}
	defer commandKey.Close()

	command, _, err := commandKey.GetStringValue("")
	if err != nil {
		return "", fmt.Errorf("读取命令失败: %w", err)
	}

	// 解析命令，提取可执行文件路径
	// 格式: "path\to\exe" "%1"
	exePath := extractExePathFromCommand(command)
	return exePath, nil
}

// extractExePathFromCommand 从命令字符串中提取可执行文件路径
func extractExePathFromCommand(command string) string {
	// 命令格式: "path\to\exe" "%1"
	// 提取第一个引号内的路径
	if len(command) > 0 && command[0] == '"' {
		end := strings.Index(command[1:], "\"")
		if end > 0 {
			return command[1 : end+1]
		}
	}
	return ""
}

// getExecutablePath 获取当前可执行文件的完整路径
func getExecutablePath() (string, error) {
	exePath, err := os.Executable()
	if err != nil {
		return "", err
	}

	// 获取绝对路径并规范化
	absPath, err := filepath.Abs(exePath)
	if err != nil {
		return "", err
	}

	return absPath, nil
}

// EnsureURLProtocolRegistered 确保URL协议已注册
// 如果路径变化，会更新注册表
func EnsureURLProtocolRegistered() error {
	// 获取当前可执行文件路径
	currentExePath, err := getExecutablePath()
	if err != nil {
		return fmt.Errorf("获取可执行文件路径失败: %w", err)
	}

	// 检查是否已注册
	registered, err := IsURLProtocolRegistered()
	if err != nil {
		log.Printf("检查注册状态失败: %v，将重新注册", err)
		return RegisterURLProtocol()
	}

	if !registered {
		log.Printf("URL协议未注册，将注册")
		return RegisterURLProtocol()
	}

	// 检查路径是否匹配
	registeredExePath, err := GetRegisteredExePath()
	if err != nil {
		log.Printf("获取已注册路径失败: %v，将重新注册", err)
		return RegisterURLProtocol()
	}

	// 规范化路径比较
	currentExePath = filepath.Clean(currentExePath)
	registeredExePath = filepath.Clean(registeredExePath)

	if currentExePath != registeredExePath {
		log.Printf("路径已变化，更新注册表: %s -> %s", registeredExePath, currentExePath)
		return RegisterURLProtocol()
	}

	// 已注册且路径匹配
	return nil
}
