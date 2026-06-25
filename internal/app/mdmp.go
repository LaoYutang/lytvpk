package app

import (
	"fmt"
	"path/filepath"
	"strings"

	"vpk-manager/internal/minidump"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// MDMPReport 类型别名,用于Wails绑定
type MDMPReport = minidump.Report

// SelectMDMPFile opens a system file picker for a minidump file.
func (a *App) SelectMDMPFile() (string, error) {
	file, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择崩溃转储文件",
		Filters: []runtime.FileFilter{
			{
				DisplayName: "崩溃转储文件 (*.mdmp;*.dmp)",
				Pattern:     "*.mdmp;*.dmp",
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

// ParseMDMPFile parses a Windows minidump file and returns a display-ready report.
func (a *App) ParseMDMPFile(path string) (MDMPReport, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return MDMPReport{}, fmt.Errorf("MDMP 文件路径不能为空")
	}
	ext := strings.ToLower(filepath.Ext(path))
	if ext != ".mdmp" && ext != ".dmp" {
		return MDMPReport{}, fmt.Errorf("请选择 .mdmp 或 .dmp 文件")
	}
	return minidump.ParseFile(path)
}
