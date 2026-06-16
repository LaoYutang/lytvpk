package app

import (
	"archive/zip"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"io"
	"log"
	"os"
)

func (a *App) ExportServersToFile(jsonContent string) (string, error) {
	selection, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "导出服务器列表",
		DefaultFilename: "lytvpk_servers.json",
		Filters: []runtime.FileFilter{
			{
				DisplayName: "JSON Files (*.json)",
				Pattern:     "*.json",
			},
		},
	})

	if err != nil {
		return "", err
	}

	if selection == "" {
		return "", nil // 用户取消
	}

	return selection, os.WriteFile(selection, []byte(jsonContent), 0644)
}

// addFileToZip 把磁盘文件写入 zip。zipName 为 zip 内的文件名，传空串则使用源文件 basename。
func addFileToZip(zipWriter *zip.Writer, filePath string, zipName string) error {
	srcFile, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer srcFile.Close()

	info, err := srcFile.Stat()
	if err != nil {
		return err
	}

	header, err := zip.FileInfoHeader(info)
	if err != nil {
		return err
	}

	if zipName == "" {
		header.Name = filepath.Base(filePath)
	} else {
		header.Name = zipName
	}
	header.Method = zip.Deflate

	writer, err := zipWriter.CreateHeader(header)
	if err != nil {
		return err
	}

	_, err = io.Copy(writer, srcFile)
	return err
}

// sanitizeFileName 替换 Windows 文件名非法字符为下划线，并去除首尾空格和点。
// 清理后为空（例如原标题全是非法字符）时返回空串，由调用方 fallback。
func sanitizeFileName(name string) string {
	if name == "" {
		return ""
	}
	// 替换非法字符 \ / : * ? " < > |
	for _, ch := range []string{`\`, `/`, `:`, `*`, `?`, `"`, `<`, `>`, `|`} {
		name = strings.ReplaceAll(name, ch, "_")
	}
	// 去除控制字符（0x00-0x1F）
	name = strings.Map(func(r rune) rune {
		if r < 0x20 {
			return '_'
		}
		return r
	}, name)
	// 去除首尾空白
	name = strings.TrimSpace(name)
	// 去除首尾的点（Windows 不允许文件名以点结尾，且以点开头易被隐藏）
	name = strings.Trim(name, ".")
	return name
}

// resolveExportName 解析用于重命名的 mod 名称（已清理）。
// 优先级：vpkCache 中已合并的 Title（内部已实现 meta.Title > addoninfo.addontitle）
// → meta 文件 Title（缓存未命中 fallback）→ 空串（由调用方使用原文件名）。
func (a *App) resolveExportName(filePath string) string {
	// 1. 优先查内存缓存（打开目录时已扫描填充）
	if v, ok := a.vpkCache.Load(filePath); ok {
		if c, ok := v.(*VPKFileCache); ok && c.File.Title != "" {
			if cleaned := sanitizeFileName(c.File.Title); cleaned != "" {
				return cleaned
			}
		}
	}
	// 2. fallback：缓存未命中时读 meta 文件
	if meta, err := LoadWorkshopMeta(filePath); meta != nil && err == nil && meta.Title != "" {
		if cleaned := sanitizeFileName(meta.Title); cleaned != "" {
			return cleaned
		}
	}
	// 3. 再 fallback：返回空，调用方使用原文件名
	return ""
}

// uniqueZipName 生成不与 usedNames 冲突的 zip 内文件名，并登记占用。
// baseName 不含扩展名，ext 含前导点（如 ".vpk"）。
func uniqueZipName(baseName, ext string, usedNames map[string]int) string {
	if _, exists := usedNames[baseName]; !exists {
		usedNames[baseName] = 1
		return baseName + ext
	}
	for {
		usedNames[baseName]++
		candidate := fmt.Sprintf("%s (%d)%s", baseName, usedNames[baseName]-1, ext)
		// candidate 以 "baseName (n)" 形式，理论上不会重复，但防御性检查
		candidateBase := strings.TrimSuffix(candidate, ext)
		if _, dup := usedNames[candidateBase]; !dup {
			usedNames[candidateBase] = 1
			return candidate
		}
	}
}

// ExportVPKFilesToZip 批量导出VPK文件为ZIP。
// includeExtra: 是否包含缩略图与 .meta 附加文件。
// renameToTitle: 是否将 vpk（及其配套缩略图/meta）在 zip 内重命名为 mod 名称。
func (a *App) ExportVPKFilesToZip(files []string, includeExtra bool, renameToTitle bool) (string, error) {
	if len(files) == 0 {
		return "", fmt.Errorf("没有选择文件")
	}

	// 选择保存路径
	zipPath, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "导出 ZIP",
		DefaultFilename: "mods_export.zip",
		Filters: []runtime.FileFilter{
			{DisplayName: "ZIP Files (*.zip)", Pattern: "*.zip"},
		},
	})

	if err != nil {
		return "", err
	}

	if zipPath == "" {
		return "cancelled", nil // 用户取消
	}

	// 创建 ZIP 文件
	zipFile, err := os.Create(zipPath)
	if err != nil {
		return "", fmt.Errorf("创建ZIP文件失败: %v", err)
	}
	defer zipFile.Close()

	zipWriter := zip.NewWriter(zipFile)
	defer zipWriter.Close()

	// 记录已使用的 zip 内 basename（不含扩展名），用于重名去重
	usedNames := make(map[string]int)

	totalFiles := len(files)
	for i, file := range files {
		// 发送进度事件
		runtime.EventsEmit(a.ctx, "export-progress", ProgressInfo{
			Current: i + 1,
			Total:   totalFiles,
			Message: fmt.Sprintf("正在导出: %s", filepath.Base(file)),
		})

		// 计算 vpk 在 zip 内的 basename（不含扩展名）和完整名
		var vpkBase string // zip 内 vpk 去掉 .vpk 后的部分
		var vpkZipName string
		if renameToTitle {
			if cleaned := a.resolveExportName(file); cleaned != "" {
				vpkZipName = uniqueZipName(cleaned, ".vpk", usedNames)
				vpkBase = strings.TrimSuffix(vpkZipName, ".vpk")
			}
		}
		if vpkZipName == "" {
			// 未重命名：使用原文件名，basename 也登记以避免与重命名项冲突
			origBase := strings.TrimSuffix(filepath.Base(file), filepath.Ext(file))
			vpkZipName = uniqueZipName(origBase, ".vpk", usedNames)
			vpkBase = strings.TrimSuffix(vpkZipName, ".vpk")
		}

		// 写入VPK文件
		if err := addFileToZip(zipWriter, file, vpkZipName); err != nil {
			log.Printf("无法添加文件 %s: %v", file, err)
			continue
		}

		// 写入附加文件（缩略图和meta）
		if includeExtra {
			basePath := strings.TrimSuffix(file, filepath.Ext(file))

			// 缩略图（保留原扩展名，zip 内用 vpkBase 对齐）
			for _, ext := range []string{".jpg", ".png", ".jpeg", ".gif"} {
				thumbPath := basePath + ext
				if _, err := os.Stat(thumbPath); err == nil {
					if err := addFileToZip(zipWriter, thumbPath, vpkBase+ext); err != nil {
						log.Printf("无法添加缩略图 %s: %v", thumbPath, err)
					}
					break
				}
			}

			// Meta文件
			metaPath := basePath + ".meta"
			if _, err := os.Stat(metaPath); err == nil {
				if err := addFileToZip(zipWriter, metaPath, vpkBase+".meta"); err != nil {
					log.Printf("无法添加meta %s: %v", metaPath, err)
				}
			}
		}
	}

	return fmt.Sprintf("成功导出 %d 个文件到 %s", len(files), zipPath), nil
}
