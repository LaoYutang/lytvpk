package parser

import (
	"strings"

	"l4d2-manager-next/pkg/valve/vpk"
)

// ProcessCharacterVPK 处理人物类型VPK
func ProcessCharacterVPK(archive *vpk.Archive, vpkFile *VPKFile, secondaryTags map[string]bool) {
	vpkFile.PrimaryTag = "人物"

	// 遍历文件，检测具体角色（证据口径与 DetermineVPKType 保持一致）
	for _, file := range archive.Files {
		filename := file.Name()
		if !isCharacterAssetPath(filename) {
			continue
		}
		lower := strings.ToLower(filename)

		// 幸存者检测
		if strings.Contains(lower, "survivor") {
			DetectSurvivorType(lower, secondaryTags)
		}

		// 感染者检测
		if strings.Contains(lower, "infected") || strings.Contains(lower, "zombie") {
			DetectInfectedType(lower, secondaryTags)
		}
	}
}

// keywordTag 按顺序匹配的关键词-标签规则
// 切片顺序即优先级：更具体的规则必须排在更笼统的规则之前
type keywordTag struct {
	keyword string
	tag     string
}

// DetectSurvivorType 检测幸存者类型 - 基于NekoVpk识别模式
func DetectSurvivorType(filename string, secondaryTags map[string]bool) {
	// 检查特殊变体
	specialVariants := []keywordTag{
		{"bill_death", "BillDeathPose"},
		{"bill_corpse", "BillDeathPose"},
		{"francis_light", "FrancisLight"},
		{"francis_flashlight", "FrancisLight"},
		{"zoey_light", "ZoeyLight"},
		{"zoey_flashlight", "ZoeyLight"},
	}

	// Left 4 Dead 2 角色识别（使用英文代码而非中文名）
	survivors := []keywordTag{
		{"bill", "Bill"},
		{"namvet", "Bill"},
		{"francis", "Francis"},
		{"biker", "Francis"},
		{"louis", "Louis"},
		{"manager", "Louis"},
		{"zoey", "Zoey"},
		{"teenangst", "Zoey"},
		{"coach", "Coach"},
		{"ellis", "Ellis"},
		{"mechanic", "Ellis"},
		{"nick", "Nick"},
		{"gambler", "Nick"},
		{"rochelle", "Rochelle"},
		{"producer", "Rochelle"},
	}

	lowerFilename := strings.ToLower(filename)

	// 先检查特殊变体
	for _, rule := range specialVariants {
		if strings.Contains(lowerFilename, strings.Replace(rule.keyword, "_", "", -1)) ||
			strings.Contains(lowerFilename, rule.keyword) {
			secondaryTags[rule.tag] = true
			return
		}
	}

	// 再检查普通角色
	for _, rule := range survivors {
		if strings.Contains(lowerFilename, rule.keyword) {
			secondaryTags[rule.tag] = true
			return
		}
	}
}

// DetectInfectedType 检测感染者类型 - 基于NekoVpk模式
func DetectInfectedType(filename string, secondaryTags map[string]bool) {
	lowerFilename := strings.ToLower(filename)

	// 特殊感染者
	specialInfected := []keywordTag{
		{"tank", "tank"},
		{"hulk", "tank"}, // L4D1中Tank的内部名称
		{"witch", "witch"},
		{"hunter", "hunter"},
		{"smoker", "smoker"},
		{"boomer", "boomer"},
		{"charger", "charger"},
		{"jockey", "jockey"},
		{"spitter", "spitter"},
	}

	// 非普通感染者（引擎里模型名同样以 common_male_ 开头，如 common_male_riot.mdl）
	uncommonInfected := []keywordTag{
		{"uncommon", "uncommon_infected"},
		{"ceda", "uncommon_infected"},     // CEDA工作人员
		{"clown", "uncommon_infected"},    // 小丑
		{"mud", "uncommon_infected"},      // 泥人
		{"roadcrew", "uncommon_infected"}, // 道路工人
		{"jimmy", "uncommon_infected"},    // 吉米·吉布斯Jr
		{"riot", "uncommon_infected"},     // 防暴警察
		{"fallen", "uncommon_infected"},   // 堕落幸存者
	}

	// 普通感染者
	commonInfected := []keywordTag{
		{"zombie", "common"},
		{"infected", "common"},
		{"common", "common"},
	}

	// 检测特殊感染者
	for _, rule := range specialInfected {
		if strings.Contains(lowerFilename, rule.keyword) {
			secondaryTags[rule.tag] = true
			return
		}
	}

	// 检测非普通感染者（必须在普通感染者之前，否则 common_male_ceda 这类路径会命中 common）
	for _, rule := range uncommonInfected {
		if strings.Contains(lowerFilename, rule.keyword) {
			secondaryTags[rule.tag] = true
			return
		}
	}

	// 检测普通感染者
	for _, rule := range commonInfected {
		if strings.Contains(lowerFilename, rule.keyword) {
			secondaryTags[rule.tag] = true
			return
		}
	}
}
