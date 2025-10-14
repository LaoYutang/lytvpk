package parser

import "time"

// ChapterInfo 章节信息用于前端显示
type ChapterInfo struct {
	Title string   `json:"title"` // 章节标题
	Modes []string `json:"modes"` // 支持的游戏模式
}

// VPKFile 表示一个VPK文件的信息
type VPKFile struct {
	Name          string                 `json:"name"`
	Path          string                 `json:"path"`
	Size          int64                  `json:"size"`
	PrimaryTag    string                 `json:"primaryTag"`    // 一级标签: "地图", "人物", "武器", "其他"
	SecondaryTags []string               `json:"secondaryTags"` // 二级标签: ["ellis", "ak47", "versus"] 等
	Location      string                 `json:"location"`      // "root", "workshop", "disabled"
	Enabled       bool                   `json:"enabled"`
	Campaign      string                 `json:"campaign"`
	Chapters      map[string]ChapterInfo `json:"chapters"` // key: 章节代码, value: 章节信息
	Mode          string                 `json:"mode"`
	PreviewImage  string                 `json:"previewImage"` // Base64编码的预览图
	LastModified  time.Time              `json:"lastModified"`
}

// Campaign 战役信息
type Campaign struct {
	Title    string
	Chapters []*Chapter
}

// Chapter 章节信息
type Chapter struct {
	Code  string   // 章节代码 (如 c1m1_hotel)
	Title string   // 章节显示名 (如 "The Hotel")
	Modes []string // 支持的游戏模式
}
