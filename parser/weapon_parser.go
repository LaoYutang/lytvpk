package parser

import (
	"strings"

	"git.lubar.me/ben/valve/vpk"
)

// ProcessWeaponVPK 处理武器类型VPK
func ProcessWeaponVPK(archive *vpk.Archive, vpkFile *VPKFile, secondaryTags map[string]bool) {
	vpkFile.PrimaryTag = "武器"

	// 遍历文件，检测具体武器
	for _, file := range archive.Files {
		filename := file.Name()

		// 检查是否为武器文件
		lowerFilename := strings.ToLower(filename)
		if strings.Contains(lowerFilename, "models/weapons/") ||
			strings.Contains(lowerFilename, "sound/weapons/") ||
			strings.Contains(lowerFilename, "materials/models/weapons/") {
			DetectWeaponType(filename, secondaryTags)
		}
	}
}

// DetectWeaponType 检测武器类型 - 基于NekoVpk模式，返回武器代码
func DetectWeaponType(filename string, secondaryTags map[string]bool) {
	lowerFilename := strings.ToLower(filename)

	// Left 4 Dead 2 特定武器检测（最高优先级）
	l4d2SpecificWeapons := map[string]string{
		// 主武器 - 步枪
		"rifle_ak47":   "ak47",
		"rifle_desert": "desert_rifle",
		"rifle_m16":    "M16",
		"rifle_m16a2":  "M16",

		// 狙击枪
		"sniper_awp":      "AWP",
		"sniper_military": "military_sniper",
		"hunting_rifle":   "hunting_rifle",
		"w_sniper_mini14": "hunting_rifle",

		// 霰弹枪
		"shotgun_chrome":     "shotgun_chrome",
		"w_shotgun_m1014":    "shotgun_chrome",
		"autoshotgun":        "autoshotgun",
		"w_autoshot_m4super": "autoshotgun",
		"shotgun_spas":       "shotgun_spas",

		// 冲锋枪
		"smg_uzi":      "SMG",
		"w_smg_uzi":    "SMG",
		"smg_silenced": "SMG_silenced",
		"w_smg_mp5":    "SMG_silenced",
		"smg_mp5":      "MP5",

		// 手枪
		"pistol_magnum":  "magnum",
		"w_desert_eagle": "magnum",
		"pistol_glock":   "glock",
		"w_pistol_glock": "glock",

		// 近战武器
		"melee_machete":   "machete",
		"w_machete":       "machete",
		"machete":         "machete",
		"melee_katana":    "katana",
		"w_katana":        "katana",
		"katana":          "katana",
		"baseball_bat":    "baseball_bat",
		"w_bat":           "baseball_bat",
		"melee_knife":     "knife",
		"chainsaw":        "chainsaw",
		"w_chainsaw":      "chainsaw",
		"crowbar":         "crowbar",
		"w_crowbar":       "crowbar",
		"fireaxe":         "fireaxe",
		"w_fireaxe":       "fireaxe",
		"frying_pan":      "frying_pan",
		"w_frying_pan":    "frying_pan",
		"electric_guitar": "electric_guitar",
		"w_guitar":        "electric_guitar",
		"cricket_bat":     "cricket_bat",
		"tonfa":           "tonfa",
		"golf_club":       "golf_club",
	}

	// 检测L4D2特定武器
	for keyword, weaponCode := range l4d2SpecificWeapons {
		if strings.Contains(lowerFilename, keyword) {
			secondaryTags[weaponCode] = true
			return
		}
	}

	// CS系列武器检测（第二优先级）
	csWeapons := map[string]string{
		"ak47":         "ak47",
		"ak74":         "ak74",
		"awp":          "AWP",
		"glock":        "glock",
		"m4a1":         "M4A1",
		"m4a4":         "M4A4",
		"deagle":       "deagle",
		"desert_eagle": "deagle",
		"usp":          "USP",
		"p90":          "P90",
		"mp5":          "MP5",
		"famas":        "FAMAS",
		"galil":        "galil",
		"aug":          "AUG",
		"scout":        "scout",
		"m249":         "M249",
		"xm1014":       "XM1014",
		"m3":           "M3",
		"tmp":          "TMP",
		"mac10":        "MAC10",
		"ump45":        "UMP45",
	}

	// 检测CS武器
	for keyword, weaponCode := range csWeapons {
		if strings.Contains(lowerFilename, keyword) {
			secondaryTags[weaponCode] = true
			return
		}
	}
}
