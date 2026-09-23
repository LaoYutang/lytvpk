package parser

import "strings"

// uiAssetRoots 界面/HUD 资源目录。
// 这些目录下的资源必然要引用角色名（HUD 血条、头像、队伍显示等），
// 不能作为「这是角色 Mod」的证据，否则纯界面 Mod 会被误判成人物。
// 引擎对这些资源的位置有硬性要求，因此这个列表是可枚举的。
var uiAssetRoots = []string{
	"materials/vgui/",
	"materials/sprites/",
	"resource/", // 含 resource/ui/*.res
	"scripts/",
	"particles/",
	"sound/ui/",
}

// isCharacterAssetPath 判断某个内部路径能否作为角色身份证据。
func isCharacterAssetPath(path string) bool {
	p := strings.ToLower(path)

	if strings.HasSuffix(p, ".res") {
		return false
	}
	for _, root := range uiAssetRoots {
		if strings.Contains(p, root) {
			return false
		}
	}
	// 界面资源未必都在 vgui 下（如 materials/hud/），hud 目录段一律不作为证据
	for _, seg := range strings.Split(p, "/") {
		if seg == "hud" {
			return false
		}
	}
	for _, kw := range characterKeywords {
		if strings.Contains(p, kw) {
			return true
		}
	}
	return false
}

// characterKeywords 触发角色识别的最外层关键词。
var characterKeywords = []string{"survivor", "infected", "zombie"}