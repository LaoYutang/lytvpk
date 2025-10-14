package parser

import (
	"strings"

	"git.lubar.me/ben/valve/vpk"
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

		// 检测角色文件 - 排除UI/HUD文件
		if (strings.Contains(filename, "survivor") ||
			strings.Contains(filename, "infected") ||
			strings.Contains(filename, "zombie")) &&
			!strings.Contains(filename, "resource/ui/") &&
			!strings.Contains(filename, "scripts/") &&
			!strings.Contains(filename, ".res") {
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
