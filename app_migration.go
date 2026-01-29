package main

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"vpk-manager/parser"
)

// migrateLegacyTagFilename 检查并迁移旧的逗号分隔符文件名到新格式
// 如果文件被重命名，返回新路径；否则返回原路径
func (a *App) migrateLegacyTagFilename(filePath string) string {
	filename := filepath.Base(filePath)

	// 检查是否包含标签格式 [tag1,tag2]
	// 简单的正则检查：包含 [ 和 ]，且中间有逗号
	if !strings.Contains(filename, "[") || !strings.Contains(filename, "]") || !strings.Contains(filename, ",") {
		return filePath
	}

	// 解析标签
	pTag, sTags, realName, hasTags := parser.ParseFilenameTags(filename)
	if !hasTags {
		return filePath
	}

	// 检查解析出的标签是否真的包含逗号（ParseFilenameTags 现在兼容逗号和加号）
	// 我们需要重新构建文件名，使用加号
	// 如果重建后的文件名与原文件名不同，说明需要迁移

	// 拆分 _ 前缀
	prefix := ""
	baseName := realName
	if strings.HasPrefix(realName, "_") {
		prefix = "_"
		baseName = strings.TrimPrefix(realName, "_")
	}

	// 组合新标签
	allTags := make([]string, 0)
	if pTag != "" {
		allTags = append(allTags, pTag)
	}
	allTags = append(allTags, sTags...)

	if len(allTags) == 0 {
		return filePath
	}

	// 使用 + 作为分隔符
	tagStr := strings.Join(allTags, "+")
	newFilename := fmt.Sprintf("%s[%s]%s", prefix, tagStr, baseName)

	if newFilename == filename {
		return filePath
	}

	// 执行重命名
	dir := filepath.Dir(filePath)
	newPath := filepath.Join(dir, newFilename)

	// 检查目标是否存在
	if _, err := os.Stat(newPath); err == nil {
		// 目标已存在，无法迁移，保持原样
		log.Printf("无法迁移旧格式文件 %s: 目标 %s 已存在", filename, newFilename)
		return filePath
	}

	if err := os.Rename(filePath, newPath); err != nil {
		log.Printf("迁移旧格式文件失败 %s: %v", filename, err)
		return filePath
	}

	// 同步迁移同名图片
	a.handleSidecarFile(filePath, newPath, "move")

	log.Printf("已迁移旧格式文件: %s -> %s", filename, newFilename)
	return newPath
}
