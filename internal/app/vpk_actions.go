package app

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"vpk-manager/internal/parser"
)

func (a *App) GetVPKPreviewImage(filePath string) string {
	if cached, ok := a.vpkCache.Load(filePath); ok {
		cache := cached.(*VPKFileCache)
		return cache.File.PreviewImage
	}
	return ""
}

// ToggleVPKFile 切换VPK文件的启用状态（智能缓存版本）
// 注意：workshop文件不能直接启用/禁用，需要先转移到root目录
func (a *App) ToggleVPKFile(filePath string) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	// 从缓存中获取文件信息
	cached, ok := a.vpkCache.Load(filePath)
	if !ok {
		return fmt.Errorf("文件未找到: %s", filePath)
	}

	cache := cached.(*VPKFileCache)
	vpkFile := cache.File

	// workshop文件不能直接启用/禁用
	if vpkFile.Location == "workshop" {
		return fmt.Errorf("workshop文件需要先转移到插件目录才能启用/禁用")
	}

	var newPath string
	var err error

	if vpkFile.Enabled && vpkFile.Location == "root" {
		// 禁用文件：从root移动到disabled目录
		disabledDir := filepath.Join(a.rootDir, "disabled")
		os.MkdirAll(disabledDir, 0755)

		newPath = filepath.Join(disabledDir, vpkFile.Name)
		err = os.Rename(vpkFile.Path, newPath)
		if err != nil {
			return err
		}
		// 同步移动同名图片
		a.handleSidecarFile(vpkFile.Path, newPath, "move")

		// 更新文件信息
		vpkFile.Path = newPath
		vpkFile.Enabled = false
		vpkFile.Location = "disabled"

	} else if !vpkFile.Enabled && vpkFile.Location == "disabled" {
		// 启用文件：从disabled移动回root目录
		newPath = filepath.Join(a.rootDir, vpkFile.Name)
		err = os.Rename(vpkFile.Path, newPath)
		if err != nil {
			return err
		}
		// 同步移动同名图片
		a.handleSidecarFile(vpkFile.Path, newPath, "move")

		// 更新文件信息
		vpkFile.Path = newPath
		vpkFile.Enabled = true
		vpkFile.Location = "root"

	} else {
		return fmt.Errorf("无效的文件状态转换")
	}

	// 删除旧路径的缓存
	a.vpkCache.Delete(filePath)

	// 在新路径下存储缓存
	cache.File = vpkFile
	a.vpkCache.Store(newPath, cache)

	log.Printf("文件已移动: %s -> %s", filePath, newPath)

	return nil
}

// MoveWorkshopToAddons 将workshop中的VPK移动到addons目录（root目录）
func (a *App) MoveWorkshopToAddons(filePath string) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	// 从缓存中获取文件信息
	cached, ok := a.vpkCache.Load(filePath)
	if !ok {
		return fmt.Errorf("文件未找到: %s", filePath)
	}

	cache := cached.(*VPKFileCache)
	vpkFile := cache.File

	if vpkFile.Location != "workshop" {
		return fmt.Errorf("只能转移workshop文件")
	}

	newPath := filepath.Join(a.rootDir, vpkFile.Name)
	err := os.Rename(vpkFile.Path, newPath)
	if err != nil {
		return err
	}
	// 同步移动同名图片
	a.handleSidecarFile(vpkFile.Path, newPath, "move")

	// 转移到root目录后，文件默认为启用状态
	vpkFile.Path = newPath
	vpkFile.Location = "root"
	vpkFile.Enabled = true

	// 删除旧路径的缓存
	a.vpkCache.Delete(filePath)

	// 在新路径下存储缓存
	cache.File = vpkFile
	a.vpkCache.Store(newPath, cache)

	log.Printf("文件已转移: %s -> %s", filePath, newPath)

	return nil
}

func (a *App) ToggleVPKVisibility(filePath string) (string, error) {
	dir := filepath.Dir(filePath)
	filename := filepath.Base(filePath)

	var newFilename string
	if strings.HasPrefix(filename, "_") {
		// Unhide: remove prefix
		newFilename = strings.TrimPrefix(filename, "_")
	} else {
		// Hide: add prefix
		newFilename = "_" + filename
	}

	newPath := filepath.Join(dir, newFilename)

	// Check if target exists
	if _, err := os.Stat(newPath); err == nil {
		return "", fmt.Errorf("目标文件已存在: %s", newFilename)
	}

	err := os.Rename(filePath, newPath)
	if err != nil {
		return "", err
	}
	// 同步重命名同名图片
	a.handleSidecarFile(filePath, newPath, "move")

	return newPath, nil
}

func (a *App) SetVPKTags(filePath string, primaryTag string, secondaryTags []string) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	if _, err := os.Stat(filePath); err != nil {
		return err
	}

	filename := filepath.Base(filePath)

	// 解析原文件名获取 "real name" 部分（包含可能的 _ 前缀）
	_, _, realName, _ := parser.ParseFilenameTags(filename)

	// 拆分 _ 前缀
	prefix := ""
	baseName := realName
	if strings.HasPrefix(realName, "_") {
		prefix = "_"
		baseName = strings.TrimPrefix(realName, "_")
	}

	// 组合新标签
	allTags := make([]string, 0)
	if primaryTag != "" {
		allTags = append(allTags, primaryTag)
	}
	for _, t := range secondaryTags {
		if t != "" {
			allTags = append(allTags, t)
		}
	}

	var newFilename string
	if len(allTags) == 0 {
		newFilename = prefix + baseName
	} else {
		// 使用 + 作为分隔符，避免使用逗号导致 Windows Explorer /select, 失效
		tagStr := strings.Join(allTags, "+")
		newFilename = fmt.Sprintf("%s[%s]%s", prefix, tagStr, baseName)
	}

	dir := filepath.Dir(filePath)
	newPath := filepath.Join(dir, newFilename)

	if newPath == filePath {
		return nil
	}

	if _, err := os.Stat(newPath); err == nil {
		return fmt.Errorf("目标文件已存在: %s", newFilename)
	}

	if err := os.Rename(filePath, newPath); err != nil {
		return err
	}
	// 同步重命名同名图片
	a.handleSidecarFile(filePath, newPath, "move")

	// Update cache
	// 如果是清除标签操作（len(allTags) == 0），则不复用旧缓存，而是强制重新解析
	// 这样可以恢复文件本身的自动检测标签（如地图、人物等）
	cachedVal, loaded := a.vpkCache.Load(filePath)
	if loaded {
		a.vpkCache.Delete(filePath)
	}

	if loaded && len(allTags) > 0 {
		cache := cachedVal.(*VPKFileCache)
		cache.File.Path = newPath
		cache.File.Name = filepath.Base(newPath)
		cache.File.PrimaryTag = primaryTag
		cache.File.SecondaryTags = secondaryTags

		a.vpkCache.Store(newPath, cache)
	} else {
		// 缓存未命中，或者清除了标签需要重新探测内容
		a.processVPKFileWithCache(newPath)
	}

	return nil
}

// RenameVPKFile 重命名VPK文件
func (a *App) RenameVPKFile(filePath string, newFilename string) (string, error) {
	// 尝试保留自定义标签
	oldName := filepath.Base(filePath)
	pTag, sTags, _, oldHasTags := parser.ParseFilenameTags(oldName)

	_, _, _, newHasTags := parser.ParseFilenameTags(newFilename)

	finalFilename := newFilename

	// 如果旧名字有标签，且新名字里没有标签，则将旧标签注入到新名字中
	if oldHasTags && !newHasTags {
		prefix := ""
		body := newFilename
		// 检查新文件名是否有 _ 前缀
		if strings.HasPrefix(newFilename, "_") {
			prefix = "_"
			body = strings.TrimPrefix(newFilename, "_")
		}

		// 组合标签
		allTags := make([]string, 0)
		if pTag != "" {
			allTags = append(allTags, pTag)
		}
		allTags = append(allTags, sTags...)

		if len(allTags) > 0 {
			// 使用 + 作为分隔符
			tagStr := strings.Join(allTags, "+")
			finalFilename = fmt.Sprintf("%s[%s]%s", prefix, tagStr, body)
		}
	}

	dir := filepath.Dir(filePath)

	// 确保新文件名以 .vpk 结尾
	if !strings.HasSuffix(strings.ToLower(finalFilename), ".vpk") {
		finalFilename += ".vpk"
	}

	newPath := filepath.Join(dir, finalFilename)

	// Check if target exists
	if _, err := os.Stat(newPath); err == nil {
		return "", fmt.Errorf("目标文件已存在: %s", finalFilename)
	}

	err := os.Rename(filePath, newPath)
	if err != nil {
		return "", err
	}
	// 同步重命名同名图片
	a.handleSidecarFile(filePath, newPath, "move")

	// 更新缓存
	if cached, ok := a.vpkCache.Load(filePath); ok {
		cache := cached.(*VPKFileCache)
		cache.File.Path = newPath
		cache.File.Name = filepath.Base(newPath)
		// Location 应该不变，因为是在同目录下重命名

		a.vpkCache.Delete(filePath)
		a.vpkCache.Store(newPath, cache)
	} else {
		// 如果不在缓存中，重新处理
		a.processVPKFileWithCache(newPath)
	}

	return newPath, nil
}
