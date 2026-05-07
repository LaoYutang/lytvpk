package parser

import (
	"regexp"
	"strings"

	"git.lubar.me/ben/valve/vpk"
)

// ProcessWeaponVPK 处理武器类型VPK
func ProcessWeaponVPK(archive *vpk.Archive, vpkFile *VPKFile, secondaryTags map[string]bool) {
	vpkFile.PrimaryTag = "武器"

	// 优先尝试从 vpkFile 的元数据中匹配武器信息
	if strings.TrimSpace(vpkFile.Title) != "" || strings.TrimSpace(vpkFile.Desc) != "" {
		DetectWeaponTypeFromMetadata(vpkFile.Title+" "+vpkFile.Desc, secondaryTags)
		if len(secondaryTags) > 0 {
			return
		}
	}

	// 遍历文件，检测具体武器
	for _, file := range archive.Files {
		filename := file.Name()

		// 检查是否为武器文件
		lowerFilename := strings.ToLower(filename)
		if strings.HasSuffix(lowerFilename, ".mdl") ||
			strings.HasSuffix(lowerFilename, ".vmt") ||
			strings.HasSuffix(lowerFilename, ".vtf") ||
			strings.HasSuffix(lowerFilename, ".wav") ||
			strings.HasSuffix(lowerFilename, ".mp3") {
			DetectWeaponType(filename, secondaryTags)
			if len(secondaryTags) > 0 {
				return
			}
		}
	}
}

// DetectWeaponTypeFromMetadata 根据addoninfo的文本检测武器类型
func DetectWeaponTypeFromMetadata(text string, secondaryTags map[string]bool) {
	lowerText := strings.ToLower(text)

	// 使用切片来保证匹配顺序
	type matchRule struct {
		keyword string
		tag     string
	}

	rules := []matchRule{
		// 步枪
		{"ak47", "AK47"},
		{"ak-47", "AK47"},
		{"m16", "M16"},
		{"sg552", "sg552"},
		{"scar", "三连发"},
		{"combat rifle", "三连发"},
		{"combat-rifle", "三连发"},
		{"desert rifle", "三连发"},
		{"desert-rifle", "三连发"},
		{"m60", "M60"},

		// 冲锋枪
		{"uzi", "乌兹"},
		{"silenced smg", "消音"},
		{"silenced-smg", "消音"},
		{"mac 10", "消音"},
		{"mac-10", "消音"},
		{"mac10", "消音"},
		{"mp5", "MP5"},

		// 狙击枪
		{"hunting rifle", "猎枪"},
		{"hunting-rifle", "猎枪"},
		{"mini14", "猎枪"},
		{"military sniper", "军狙"},
		{"military-sniper", "军狙"},
		{"scout", "鸟狙"},
		{"awp", "大狙"},

		// 霰弹枪
		{"chrome", "铁喷"},
		{"pump shotgun", "木喷"},
		{"pump-shotgun", "木喷"},
		{"auto shotgun", "一代连喷"},
		{"auto-shotgun", "一代连喷"},
		{"autoshotgun", "一代连喷"},
		{"spas", "二代连喷"},

		// 手枪
		{"magnum", "马格南"},
		{"desert eagle", "马格南"},
		{"desert-eagle", "马格南"},
		{"glock", "小手枪"},
		{"p220", "小手枪"},
		{"pistol", "小手枪"},

		// 发射器
		{"grenade launcher", "榴弹"},
		{"grenade-launcher", "榴弹"},

		// 近战武器
		{"machete", "砍刀"},
		{"katana", "武士刀"},
		{"baseball bat", "棒球棍"},
		{"knife", "匕首"},
		{"chainsaw", "电锯"},
		{"crowbar", "撬棍"},
		{"fireaxe", "消防斧"},
		{"frying pan", "平底锅"},
		{"guitar", "吉他"},
		{"cricket bat", "板球拍"},
		{"tonfa", "警棍"},
		{"nightstick", "警棍"},
		{"golf club", "高尔夫球杆"},
		{"shovel", "铁铲"},
		{"pitchfork", "草叉"},
	}

	for _, rule := range rules {
		isMatch := false
		if rule.keyword == "scar" {
			// 特殊处理 scar，防止匹配到 oscar 等词
			isMatch, _ = regexp.MatchString(`\bscar\b`, lowerText)
		} else {
			isMatch = strings.Contains(lowerText, rule.keyword)
		}

		if isMatch {
			secondaryTags[rule.tag] = true
			return
		}
	}
}

// DetectWeaponType 检测武器类型
func DetectWeaponType(filename string, secondaryTags map[string]bool) {
	lowerFilename := strings.ToLower(filename)

	// Left 4 Dead 2 特定武器检测（最高优先级）
	l4d2SpecificWeapons := map[string]string{
		// 步枪
		"ak47":         "AK47",
		"desert":       "三连发",
		"desert_rifle": "三连发",
		"m16":          "M16",
		"m16a2":        "M16",
		"sg552":        "sg552",
		"m60":          "M60",

		// 狙击枪
		"awp":             "大狙",
		"sniper_military": "军狙",
		"sniper_a":        "军狙",
		"hunting_rifle":   "猎枪",
		"w_sniper_mini14": "猎枪",
		"sniper_scout":    "鸟狙",

		// 霰弹枪
		"chrome":      "铁喷",
		"m1014":       "铁喷",
		"w_shotgun":   "木喷",
		"autoshotgun": "一代连喷",
		"spas":        "二代连喷",

		// 冲锋枪
		"uzi":          "乌兹",
		"smg_a":        "消音",
		"smg_silenced": "消音",
		"mp5":          "MP5",

		// 手枪
		"magnum":         "马格南",
		"w_desert_eagle": "马格南",
		"pistol_glock":   "小手枪",
		"w_pistol_glock": "小手枪",
		"w_pistol_b":     "小手枪",

		// 发射器
		"grenade_launcher": "榴弹",

		// 近战武器
		"machete":         "砍刀",
		"katana":          "武士刀",
		"baseball_bat":    "棒球棍",
		"w_bat":           "棒球棍",
		"knife":           "匕首",
		"chainsaw":        "电锯",
		"crowbar":         "撬棍",
		"fireaxe":         "消防斧",
		"frying_pan":      "平底锅",
		"electric_guitar": "吉他",
		"w_guitar":        "吉他",
		"cricket_bat":     "板球拍",
		"tonfa":           "警棍",
		"golf_club":       "高尔夫球杆",
		"shovel":          "铁铲",
		"pitchfork":       "草叉",
	}

	// 检测L4D2特定武器
	for keyword, weaponCode := range l4d2SpecificWeapons {
		if strings.Contains(lowerFilename, keyword) {
			secondaryTags[weaponCode] = true
			return
		}
	}
}
