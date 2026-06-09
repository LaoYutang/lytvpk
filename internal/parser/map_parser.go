package parser

import (
	"io"
	"log"
	"strings"

	"l4d2-manager-next/pkg/valve/vpk"
	"l4d2-manager-next/pkg/vpkmission"
)

// ProcessMapVPK 处理地图类型VPK
func ProcessMapVPK(opener *vpk.Opener, archive *vpk.Archive, vpkFile *VPKFile, secondaryTags map[string]bool, chapters map[string]ChapterInfo) {
	vpkFile.PrimaryTag = "地图"

	// 初始化 VPKFile 的 Chapters map，如果尚未初始化
	if vpkFile.Chapters == nil {
		vpkFile.Chapters = make(map[string]ChapterInfo)
	}

	var campaignTitles []string
	modesSet := make(map[string]bool)
	var firstMode string

	// 查找mission文件并解析战役和章节信息
	log.Printf("开始查找mission文件，总文件数: %d", len(archive.Files))
	for _, file := range archive.Files {
		filename := strings.ToLower(file.Name())
		// 查找mission文件 (可能在missions/目录下，或者根目录，以.txt结尾)
		if (strings.Contains(filename, "missions/") || strings.Contains(filename, "mission")) && strings.HasSuffix(filename, ".txt") {
			log.Printf("找到mission文件: %s", file.Name())
			campaign := ParseMissionFile(opener, &file)
			if campaign != nil {
				log.Printf("解析到战役: %s, 章节数: %d", campaign.Title, len(campaign.Chapters))
				// 收集战役名
				if campaign.Title != "" {
					// 避免重复的战役名
					isDuplicate := false
					for _, title := range campaignTitles {
						if title == campaign.Title {
							isDuplicate = true
							break
						}
					}
					if !isDuplicate {
						campaignTitles = append(campaignTitles, campaign.Title)
						secondaryTags[campaign.Title] = true
					}
				}

				// 合并章节信息
				for _, chapter := range campaign.Chapters {
					log.Printf("章节: %s (%s), 模式: %v", chapter.Title, chapter.Code, chapter.Modes)

					// 检查是否已经存在该章节代码
					existingChapter, exists := vpkFile.Chapters[chapter.Code]
					if exists {
						// 合并模式，去重
						for _, mode := range chapter.Modes {
							modeExists := false
							for _, existingMode := range existingChapter.Modes {
								if existingMode == mode {
									modeExists = true
									break
								}
							}
							if !modeExists {
								existingChapter.Modes = append(existingChapter.Modes, mode)
							}
						}
						// 更新 map 中的值
						vpkFile.Chapters[chapter.Code] = existingChapter
						chapters[chapter.Code] = existingChapter
					} else {
						// 新章节，直接添加
						chapterInfo := ChapterInfo{
							Title: chapter.Title,
							Modes: chapter.Modes,
						}
						vpkFile.Chapters[chapter.Code] = chapterInfo
						chapters[chapter.Code] = chapterInfo
					}

					// 收集所有模式，用于设置主要游戏模式
					for _, mode := range chapter.Modes {
						if firstMode == "" {
							firstMode = mode
						}
						modesSet[mode] = true
					}
				}
			} else {
				log.Printf("mission文件解析失败: %s", file.Name())
			}
		}
	}

	// 合并所有的战役名作为最终的 Campaign 字段，使用逗号或顿号分隔
	if len(campaignTitles) > 0 {
		vpkFile.Campaign = strings.Join(campaignTitles, " / ")
	}

	// 设置主要游戏模式
	if firstMode != "" {
		vpkFile.Mode = firstMode
	}
}

// ParseMissionFile 解析mission文件，提取战役和章节信息
func ParseMissionFile(opener *vpk.Opener, file *vpk.File) *Campaign {
	reader, err := file.Open(opener)
	if err != nil {
		return nil
	}
	defer reader.Close()

	return ParseMissionContent(reader)
}

// ParseMissionContent 解析mission文件内容
func ParseMissionContent(reader io.Reader) *Campaign {
	mission, err := vpkmission.ParseMission(reader)
	if err != nil {
		log.Printf("mission文件解析错误: %v", err)
		return nil
	}

	campaign := convertMissionCampaign(mission)
	log.Printf("解析完成 - 战役: %s, 章节数: %d", campaign.Title, len(campaign.Chapters))
	return campaign
}

func convertMissionCampaign(mission *vpkmission.Campaign) *Campaign {
	if mission == nil {
		return nil
	}

	campaign := &Campaign{
		Title:    mission.Title,
		Chapters: make([]*Chapter, 0, len(mission.Chapters)),
	}

	for _, missionChapter := range mission.Chapters {
		if missionChapter == nil || missionChapter.Code == "" {
			continue
		}
		campaign.Chapters = append(campaign.Chapters, &Chapter{
			Code:  missionChapter.Code,
			Title: missionChapter.Title,
			Modes: translateGameModes(missionChapter.Modes),
		})
	}

	return campaign
}

func translateGameModes(modes []string) []string {
	translatedModes := make([]string, 0, len(modes))
	seen := make(map[string]bool, len(modes))
	for _, mode := range modes {
		mode = strings.TrimSpace(mode)
		if mode == "" {
			continue
		}

		translated := TranslateGameMode(strings.ToLower(mode))
		if seen[translated] {
			continue
		}
		seen[translated] = true
		translatedModes = append(translatedModes, translated)
	}
	return translatedModes
}

// TranslateGameMode 将英文游戏模式转换为中文
func TranslateGameMode(mode string) string {
	modeMap := map[string]string{
		"coop":     "战役模式",
		"versus":   "对抗模式",
		"survival": "生存模式",
		"scavenge": "清道夫模式",
		"realism":  "写实模式",
		"halftank": "突变模式",
		"brawler":  "突变模式",
	}

	if translated, exists := modeMap[mode]; exists {
		return translated
	}
	return mode // 如果没有翻译，返回原文
}
