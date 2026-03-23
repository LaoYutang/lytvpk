package parser

import (
	"bufio"
	"io"
	"log"
	"regexp"
	"strings"

	"git.lubar.me/ben/valve/vpk"
)

// kvRegex 用于提取键值对的正则表达式
var kvRegex = regexp.MustCompile(`"([^"]+)"\s+"([^"]+)"`)

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
	// 先读取全部内容用于调试
	content, err := io.ReadAll(reader)
	if err != nil {
		log.Printf("无法读取mission文件内容: %v", err)
		return nil
	}

	// 重新创建reader
	reader = strings.NewReader(string(content))
	scanner := bufio.NewScanner(reader)

	campaign := &Campaign{
		Chapters: make([]*Chapter, 0, 8), // 预分配容量
	}

	inGameModeSection := false
	braceLevel := 0
	var tempMapName string
	var currentMode string
	seenChapters := make(map[string]*Chapter) // 用于去重和追加模式

	for scanner.Scan() {
		line := scanner.Text()

		if len(line) == 0 {
			continue
		}

		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "//") {
			continue
		}

		// 状态机，用于进入/退出游戏模式部分
		lowerLine := strings.ToLower(line)

		// 移除行内注释（//之后的内容）
		if commentIndex := strings.Index(lowerLine, "//"); commentIndex != -1 {
			lowerLine = strings.TrimSpace(lowerLine[:commentIndex])
		}

		// 检测进入modes区域
		if strings.Contains(lowerLine, `"modes"`) {
			log.Printf("发现modes区域")
			continue
		}

		// 检测具体的游戏模式
		if !inGameModeSection && (lowerLine == `"coop"` || lowerLine == `"survival"` ||
			lowerLine == `"halftank"` || lowerLine == `"brawler"` || lowerLine == `"versus"` ||
			lowerLine == `"scavenge"` || lowerLine == `"realism"`) {
			inGameModeSection = true
			braceLevel = 0
			// 提取模式名称，去除引号
			currentMode = strings.Trim(lowerLine, `"`)
			// 转换为中文模式名
			currentMode = TranslateGameMode(currentMode)
			log.Printf("进入游戏模式区域: %s", currentMode)
			continue
		}

		if inGameModeSection {
			for _, char := range line {
				switch char {
				case '{':
					braceLevel++
				case '}':
					braceLevel--
				}
			}

			// 如果 braceLevel 降为 0，说明已退出游戏模式部分
			if braceLevel <= 0 {
				inGameModeSection = false
				currentMode = ""
				continue
			}
		}

		// 只在必要时使用正则表达式
		if strings.Contains(line, `"`) {
			matches := kvRegex.FindStringSubmatch(line)
			if len(matches) == 3 {
				key := strings.ToLower(matches[1])
				value := matches[2]

				// 始终在文件顶层查找战役标题
				if key == "displaytitle" && campaign.Title == "" {
					campaign.Title = value
					log.Printf("找到战役标题: %s", value)
				}

				// 如果在游戏模式区域内
				if inGameModeSection {
					// 注意：实际的键名是"Map"和"DisplayName"（首字母大写）
					if key == "map" {
						tempMapName = value
						log.Printf("找到Map: %s", value)
					}

					if key == "displayname" && tempMapName != "" {
						log.Printf("找到章节: %s -> %s (模式: %s)", tempMapName, value, currentMode)
						// 检查是否已经添加过这个章节
						if chapter, exists := seenChapters[tempMapName]; exists {
							// 已存在，添加模式到该章节
							chapter.Modes = append(chapter.Modes, currentMode)
							log.Printf("追加模式到现有章节")
						} else {
							// 不存在，创建新章节
							chapter := &Chapter{
								Code:  tempMapName,
								Title: value,
								Modes: []string{currentMode},
							}
							campaign.Chapters = append(campaign.Chapters, chapter)
							seenChapters[tempMapName] = chapter
							log.Printf("创建新章节: %+v", chapter)
						}
						tempMapName = "" // 重置
					}
				}
			}
		}
	}

	if scanner.Err() != nil {
		log.Printf("mission文件扫描错误: %v", scanner.Err())
		return nil
	}

	log.Printf("解析完成 - 战役: %s, 章节数: %d", campaign.Title, len(campaign.Chapters))
	return campaign
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
