package app

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"l4d2-manager-next/pkg/valve/vpk"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// VPKUnpackResult describes the result of unpacking a single-file VPK.
type VPKUnpackResult struct {
	SourcePath     string `json:"sourcePath"`
	OutputDir      string `json:"outputDir"`
	TotalFiles     int    `json:"totalFiles"`
	ExtractedFiles int    `json:"extractedFiles"`
}

// SelectVPKFile opens a system file picker for a single VPK file.
func (a *App) SelectVPKFile() (string, error) {
	file, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择 VPK 文件",
		Filters: []runtime.FileFilter{
			{
				DisplayName: "VPK 文件 (*.vpk)",
				Pattern:     "*.vpk",
			},
			{
				DisplayName: "所有文件 (*.*)",
				Pattern:     "*.*",
			},
		},
	})
	if err != nil {
		return "", err
	}
	return file, nil
}

// SelectVPKUnpackOutputDirectory opens a directory picker for VPK unpack output.
func (a *App) SelectVPKUnpackOutputDirectory() (string, error) {
	directory, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title:                "选择解包输出位置",
		ShowHiddenFiles:      false,
		CanCreateDirectories: true,
	})
	if err != nil {
		return "", err
	}
	return directory, nil
}

// UnpackVPKFile extracts all files from a single-file VPK into a named child folder.
func (a *App) UnpackVPKFile(vpkPath string, targetRoot string) (VPKUnpackResult, error) {
	result := VPKUnpackResult{}

	vpkPath = strings.TrimSpace(vpkPath)
	targetRoot = strings.TrimSpace(targetRoot)
	result.SourcePath = vpkPath
	if vpkPath == "" {
		return result, fmt.Errorf("VPK 文件路径不能为空")
	}
	if targetRoot == "" {
		return result, fmt.Errorf("解包目标位置不能为空")
	}
	if strings.ToLower(filepath.Ext(vpkPath)) != ".vpk" {
		return result, fmt.Errorf("请选择 .vpk 文件")
	}

	info, err := os.Stat(vpkPath)
	if err != nil {
		if os.IsNotExist(err) {
			return result, fmt.Errorf("VPK 文件不存在: %s", vpkPath)
		}
		return result, fmt.Errorf("无法访问 VPK 文件: %v", err)
	}
	if info.IsDir() {
		return result, fmt.Errorf("请选择 VPK 文件，而不是文件夹")
	}

	rootInfo, err := os.Stat(targetRoot)
	if err != nil {
		if os.IsNotExist(err) {
			return result, fmt.Errorf("目标位置不存在: %s", targetRoot)
		}
		return result, fmt.Errorf("无法访问目标位置: %v", err)
	}
	if !rootInfo.IsDir() {
		return result, fmt.Errorf("目标位置不是文件夹: %s", targetRoot)
	}

	opener := vpk.Single(vpkPath)
	defer opener.Close()

	archive, err := opener.ReadArchive()
	if err != nil {
		return result, fmt.Errorf("无法读取 VPK: %v", err)
	}

	outputDir, err := createUniqueVPKOutputDir(targetRoot, vpkPath)
	if err != nil {
		return result, err
	}
	result.OutputDir = outputDir
	result.TotalFiles = len(archive.Files)

	for i := range archive.Files {
		file := &archive.Files[i]
		targetPath, err := safeVPKOutputPath(outputDir, file.Name())
		if err != nil {
			return result, err
		}

		if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
			return result, fmt.Errorf("无法创建目录 %s: %v", filepath.Dir(targetPath), err)
		}

		if err := extractVPKEntry(opener, file, targetPath); err != nil {
			return result, fmt.Errorf("解包 %s 失败: %v", file.Name(), err)
		}
		result.ExtractedFiles++
	}

	return result, nil
}

func createUniqueVPKOutputDir(targetRoot string, vpkPath string) (string, error) {
	baseName := strings.TrimSuffix(filepath.Base(vpkPath), filepath.Ext(vpkPath))
	baseName = sanitizeVPKOutputDirName(baseName)
	if baseName == "" {
		baseName = "vpk_unpacked"
	}

	for i := 0; i < 10000; i++ {
		name := baseName
		if i > 0 {
			name = fmt.Sprintf("%s(%d)", baseName, i)
		}

		outputDir := filepath.Join(targetRoot, name)
		if err := os.Mkdir(outputDir, 0755); err == nil {
			return outputDir, nil
		} else if !os.IsExist(err) {
			return "", fmt.Errorf("无法创建输出目录 %s: %v", outputDir, err)
		}
	}

	return "", fmt.Errorf("无法创建输出目录，已尝试过多同名目录")
}

func sanitizeVPKOutputDirName(value string) string {
	value = strings.TrimSpace(value)
	value = strings.TrimRight(value, ". ")
	if value == "" {
		return ""
	}

	replacer := strings.NewReplacer(
		"<", "_",
		">", "_",
		":", "_",
		"\"", "_",
		"/", "_",
		"\\", "_",
		"|", "_",
		"?", "_",
		"*", "_",
	)
	return strings.TrimSpace(replacer.Replace(value))
}

func safeVPKOutputPath(outputDir string, entryName string) (string, error) {
	name := strings.ReplaceAll(strings.TrimSpace(entryName), "\\", "/")
	if name == "" || name == "." {
		return "", fmt.Errorf("VPK 内存在空文件路径")
	}
	if strings.HasPrefix(name, "/") || filepath.IsAbs(name) || hasWindowsDrivePrefix(name) {
		return "", fmt.Errorf("VPK 内存在非法绝对路径: %s", entryName)
	}

	cleanName := filepath.Clean(filepath.FromSlash(name))
	if cleanName == "." || cleanName == string(filepath.Separator) {
		return "", fmt.Errorf("VPK 内存在非法文件路径: %s", entryName)
	}
	if cleanName == ".." || strings.HasPrefix(cleanName, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("VPK 内存在路径穿越文件: %s", entryName)
	}

	targetPath := filepath.Join(outputDir, cleanName)
	rel, err := filepath.Rel(outputDir, targetPath)
	if err != nil {
		return "", fmt.Errorf("无法校验输出路径 %s: %v", entryName, err)
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return "", fmt.Errorf("VPK 内存在路径穿越文件: %s", entryName)
	}

	return targetPath, nil
}

func hasWindowsDrivePrefix(value string) bool {
	if len(value) < 2 || value[1] != ':' {
		return false
	}
	c := value[0]
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
}

func extractVPKEntry(opener *vpk.Opener, entry *vpk.File, targetPath string) error {
	reader, err := entry.Open(opener)
	if err != nil {
		return err
	}

	out, err := os.OpenFile(targetPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if err != nil {
		_ = reader.Close()
		return err
	}

	if _, err := io.Copy(out, reader); err != nil {
		_ = out.Close()
		_ = os.Remove(targetPath)
		_ = reader.Close()
		return err
	}

	if err := out.Close(); err != nil {
		_ = os.Remove(targetPath)
		_ = reader.Close()
		return err
	}

	if err := reader.Close(); err != nil {
		_ = os.Remove(targetPath)
		return err
	}

	return nil
}
