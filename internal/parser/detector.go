package parser

import (
	"strings"

	"l4d2-manager-next/pkg/valve/vpk"
)

// DetermineVPKType 确定VPK的主要类型
func DetermineVPKType(archive *vpk.Archive) string {
	hasMap := false
	hasCharacter := false
	hasWeapon := false

	// 遍历VPK文件，快速判断类型
	for _, file := range archive.Files {
		filename := strings.ToLower(file.Name())

		// 检测地图文件 (.bsp) - 最高优先级
		if strings.HasSuffix(filename, ".bsp") {
			hasMap = true
			break // 发现地图就直接确定类型
		}

		// 检测角色文件 - 界面/HUD 资源不作为角色证据
		if isCharacterAssetPath(filename) {
			hasCharacter = true
		}

		// 检测武器文件
		if strings.Contains(filename, "models/weapons/") ||
			strings.Contains(filename, "scripts/weapons/") ||
			strings.Contains(filename, "materials/weapons/") {
			hasWeapon = true
		}
	}

	// 按优先级返回类型
	if hasMap {
		return "地图"
	}
	if hasCharacter {
		return "人物"
	}
	if hasWeapon {
		return "武器"
	}

	return "其他"
}
