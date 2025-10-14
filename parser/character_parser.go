package parser

import (
	"strings"

	"git.lubar.me/ben/valve/vpk"
)

// ProcessCharacterVPK 处理人物类型VPK
func ProcessCharacterVPK(archive *vpk.Archive, vpkFile *VPKFile, secondaryTags map[string]bool) {
	vpkFile.PrimaryTag = "人物"

	// 遍历文件，检测具体角色
	for _, file := range archive.Files {
		filename := file.Name()

		// 幸存者检测
		if strings.Contains(filename, "survivor") {
			DetectSurvivorType(filename, secondaryTags)
		}

		// 感染者检测
		if strings.Contains(filename, "infected") || strings.Contains(filename, "zombie") {
			DetectInfectedType(filename, secondaryTags)
		}
	}
}

// DetectSurvivorType 检测幸存者类型 - 基于NekoVpk识别模式
func DetectSurvivorType(filename string, secondaryTags map[string]bool) {
	// Left 4 Dead 2 角色识别（使用英文代码而非中文名）
	survivors := map[string]string{
		"bill":      "Bill",
		"namvet":    "Bill",
		"francis":   "Francis",
		"biker":     "Francis",
		"louis":     "Louis",
		"manager":   "Louis",
		"zoey":      "Zoey",
		"teenangst": "Zoey",
		"coach":     "Coach",
		"ellis":     "Ellis",
		"mechanic":  "Ellis",
		"nick":      "Nick",
		"gambler":   "Nick",
		"rochelle":  "Rochelle",
		"producer":  "Rochelle",
	}

	// 检查特殊变体
	specialVariants := map[string]string{
		"bill_death":         "BillDeathPose",
		"bill_corpse":        "BillDeathPose",
		"francis_light":      "FrancisLight",
		"francis_flashlight": "FrancisLight",
		"zoey_light":         "ZoeyLight",
		"zoey_flashlight":    "ZoeyLight",
	}

	lowerFilename := strings.ToLower(filename)

	// 先检查特殊变体
	for keyword, name := range specialVariants {
		if strings.Contains(lowerFilename, strings.Replace(keyword, "_", "", -1)) ||
			strings.Contains(lowerFilename, keyword) {
			secondaryTags[name] = true
			return
		}
	}

	// 再检查普通角色
	for keyword, name := range survivors {
		if strings.Contains(lowerFilename, keyword) {
			secondaryTags[name] = true
			return
		}
	}
}

// DetectInfectedType 检测感染者类型 - 基于NekoVpk模式
func DetectInfectedType(filename string, secondaryTags map[string]bool) {
	lowerFilename := strings.ToLower(filename)

	// 特殊感染者
	specialInfected := map[string]string{
		"tank":    "tank",
		"hulk":    "tank", // L4D1中Tank的内部名称
		"witch":   "witch",
		"hunter":  "hunter",
		"smoker":  "smoker",
		"boomer":  "boomer",
		"charger": "charger",
		"jockey":  "jockey",
		"spitter": "spitter",
	}

	// 普通感染者
	commonInfected := map[string]string{
		"common":   "common",
		"zombie":   "common",
		"infected": "common",
		"uncommon": "uncommon_infected",
		"ceda":     "uncommon_infected", // CEDA工作人员
		"clown":    "uncommon_infected", // 小丑
		"mud":      "uncommon_infected", // 泥人
		"roadcrew": "uncommon_infected", // 道路工人
		"jimmy":    "uncommon_infected", // 吉米·吉布斯Jr
		"riot":     "uncommon_infected", // 防暴警察
		"fallen":   "uncommon_infected", // 堕落幸存者
	}

	// 检测特殊感染者
	for keyword, infectedCode := range specialInfected {
		if strings.Contains(lowerFilename, keyword) {
			secondaryTags[infectedCode] = true
			return
		}
	}

	// 检测普通感染者
	for keyword, infectedCode := range commonInfected {
		if strings.Contains(lowerFilename, keyword) {
			secondaryTags[infectedCode] = true
			return
		}
	}
}
