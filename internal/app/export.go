package app

import (
	"archive/zip"
	"fmt"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
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

func addFileToZip(zipWriter *zip.Writer, filePath string) error {
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

	header.Name = filepath.Base(filePath)
	header.Method = zip.Deflate

	writer, err := zipWriter.CreateHeader(header)
	if err != nil {
		return err
	}

	_, err = io.Copy(writer, srcFile)
	return err
}

// ExportVPKFilesToZip 批量导出VPK文件为ZIP
func (a *App) ExportVPKFilesToZip(files []string, includeExtra bool) (string, error) {
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

	totalFiles := len(files)
	for i, file := range files {
		// 发送进度事件
		runtime.EventsEmit(a.ctx, "export-progress", ProgressInfo{
			Current: i + 1,
			Total:   totalFiles,
			Message: fmt.Sprintf("正在导出: %s", filepath.Base(file)),
		})

		// 写入VPK文件
		if err := addFileToZip(zipWriter, file); err != nil {
			log.Printf("无法添加文件 %s: %v", file, err)
			continue
		}

		// 写入附加文件（缩略图和meta）
		if includeExtra {
			basePath := strings.TrimSuffix(file, filepath.Ext(file))

			// 缩略图
			for _, ext := range []string{".jpg", ".png", ".jpeg", ".gif"} {
				thumbPath := basePath + ext
				if _, err := os.Stat(thumbPath); err == nil {
					if err := addFileToZip(zipWriter, thumbPath); err != nil {
						log.Printf("无法添加缩略图 %s: %v", thumbPath, err)
					}
					break
				}
			}

			// Meta文件
			metaPath := basePath + ".meta"
			if _, err := os.Stat(metaPath); err == nil {
				if err := addFileToZip(zipWriter, metaPath); err != nil {
					log.Printf("无法添加meta %s: %v", metaPath, err)
				}
			}
		}
	}

	return fmt.Sprintf("成功导出 %d 个文件到 %s", len(files), zipPath), nil
}
