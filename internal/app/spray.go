package app

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type SprayFilePayload struct {
	Name      string `json:"name"`
	VTFBase64 string `json:"vtfBase64"`
	VMTText   string `json:"vmtText"`
}

type SprayExportRequest struct {
	Files []SprayFilePayload `json:"files"`
}

type SprayInstallRequest struct {
	PackageName string             `json:"packageName"`
	Files       []SprayFilePayload `json:"files"`
}

type SprayOutputFile struct {
	Name    string `json:"name"`
	VTFPath string `json:"vtfPath"`
	VMTPath string `json:"vmtPath"`
}

type SprayExportResult struct {
	OutputDir string            `json:"outputDir"`
	Files     []SprayOutputFile `json:"files"`
}

type SprayInstallResult struct {
	PackageName string            `json:"packageName"`
	OutputPath  string            `json:"outputPath"`
	Files       []SprayOutputFile `json:"files"`
	TotalFiles  int               `json:"totalFiles"`
	PackedFiles int               `json:"packedFiles"`
}

func (a *App) ExportSprayFiles(request SprayExportRequest) (SprayExportResult, error) {
	result := SprayExportResult{}
	files, err := normalizeSprayPayloads(request.Files)
	if err != nil {
		return result, err
	}

	outputDir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title:                "选择喷漆文件导出位置",
		ShowHiddenFiles:      false,
		CanCreateDirectories: true,
	})
	if err != nil {
		return result, err
	}
	if strings.TrimSpace(outputDir) == "" {
		return result, nil
	}

	written, err := writeSprayFiles(outputDir, files)
	if err != nil {
		return result, err
	}

	result.OutputDir = outputDir
	result.Files = written
	return result, nil
}

func (a *App) InstallSprayVPK(request SprayInstallRequest) (SprayInstallResult, error) {
	result := SprayInstallResult{}
	files, err := normalizeSprayPayloads(request.Files)
	if err != nil {
		return result, err
	}

	a.mu.RLock()
	rootDir := strings.TrimSpace(a.rootDir)
	a.mu.RUnlock()
	if rootDir == "" {
		return result, fmt.Errorf("请先设置 L4D2 addons 目录")
	}
	if info, statErr := os.Stat(rootDir); statErr != nil {
		return result, fmt.Errorf("无法访问 addons 目录: %v", statErr)
	} else if !info.IsDir() {
		return result, fmt.Errorf("addons 路径不是文件夹: %s", rootDir)
	}

	packageName := sanitizeSprayFileName(request.PackageName)
	if packageName == "" {
		packageName = "spray_pack"
	}
	result.PackageName = packageName

	tempRoot, err := os.MkdirTemp("", "lytvpk-spray-*")
	if err != nil {
		return result, fmt.Errorf("创建临时目录失败: %v", err)
	}
	defer os.RemoveAll(tempRoot)

	sourceDir := filepath.Join(tempRoot, packageName)
	logosDir := filepath.Join(sourceDir, "materials", "vgui", "logos")
	written, err := writeSprayFiles(logosDir, files)
	if err != nil {
		return result, err
	}

	packResult, err := a.packVPKDirectoryWithOptions(sourceDir, rootDir, true, packageName, nil)
	if err != nil {
		return result, err
	}

	result.OutputPath = packResult.OutputPath
	result.Files = written
	result.TotalFiles = packResult.TotalFiles
	result.PackedFiles = packResult.PackedFiles

	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, "refresh_files", nil)
	}

	return result, nil
}

func normalizeSprayPayloads(payloads []SprayFilePayload) ([]SprayFilePayload, error) {
	if len(payloads) == 0 {
		return nil, fmt.Errorf("没有可导出的喷漆文件")
	}

	next := make([]SprayFilePayload, 0, len(payloads))
	for i, payload := range payloads {
		name := sanitizeSprayFileName(payload.Name)
		if name == "" {
			if len(payloads) == 1 {
				name = "spray"
			} else {
				name = fmt.Sprintf("spray%d", i+1)
			}
		}
		if strings.TrimSpace(payload.VTFBase64) == "" {
			return nil, fmt.Errorf("喷漆 %s 缺少 VTF 数据", name)
		}

		next = append(next, SprayFilePayload{
			Name:      name,
			VTFBase64: payload.VTFBase64,
			VMTText:   payload.VMTText,
		})
	}
	return next, nil
}

func writeSprayFiles(outputDir string, payloads []SprayFilePayload) ([]SprayOutputFile, error) {
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return nil, fmt.Errorf("创建输出目录失败: %v", err)
	}

	used := make(map[string]bool, len(payloads))
	written := make([]SprayOutputFile, 0, len(payloads))
	for _, payload := range payloads {
		name, err := uniqueSprayBaseName(outputDir, payload.Name, used)
		if err != nil {
			return nil, err
		}

		vtfData, err := base64.StdEncoding.DecodeString(payload.VTFBase64)
		if err != nil {
			return nil, fmt.Errorf("解码 %s.vtf 失败: %v", name, err)
		}
		if len(vtfData) == 0 {
			return nil, fmt.Errorf("%s.vtf 数据为空", name)
		}

		vtfPath := filepath.Join(outputDir, name+".vtf")
		vmtPath := filepath.Join(outputDir, name+".vmt")
		if err := os.WriteFile(vtfPath, vtfData, 0644); err != nil {
			return nil, fmt.Errorf("写入 %s 失败: %v", vtfPath, err)
		}
		if err := os.WriteFile(vmtPath, []byte(buildSprayVMTText(name)), 0644); err != nil {
			return nil, fmt.Errorf("写入 %s 失败: %v", vmtPath, err)
		}

		written = append(written, SprayOutputFile{
			Name:    name,
			VTFPath: vtfPath,
			VMTPath: vmtPath,
		})
	}
	return written, nil
}

func uniqueSprayBaseName(outputDir string, desired string, used map[string]bool) (string, error) {
	base := sanitizeSprayFileName(desired)
	if base == "" {
		base = "spray"
	}

	for i := 0; i < 10000; i++ {
		candidate := base
		if i > 0 {
			candidate = fmt.Sprintf("%s(%d)", base, i)
		}
		if used[strings.ToLower(candidate)] {
			continue
		}
		vtfPath := filepath.Join(outputDir, candidate+".vtf")
		vmtPath := filepath.Join(outputDir, candidate+".vmt")
		if _, err := os.Stat(vtfPath); err == nil {
			continue
		} else if !os.IsNotExist(err) {
			return "", fmt.Errorf("无法检查输出文件 %s: %v", vtfPath, err)
		}
		if _, err := os.Stat(vmtPath); err == nil {
			continue
		} else if !os.IsNotExist(err) {
			return "", fmt.Errorf("无法检查输出文件 %s: %v", vmtPath, err)
		}
		used[strings.ToLower(candidate)] = true
		return candidate, nil
	}

	return "", fmt.Errorf("无法创建喷漆文件，已尝试过多同名文件")
}

func sanitizeSprayFileName(value string) string {
	value = sanitizeVPKOutputDirName(value)
	value = strings.TrimSpace(value)
	value = strings.TrimRight(value, ". ")
	return value
}

func buildSprayVMTText(name string) string {
	name = strings.ReplaceAll(sanitizeSprayFileName(name), "\\", "/")
	if name == "" {
		name = "spray"
	}
	return fmt.Sprintf("\"UnlitGeneric\"\n{\n\t\"$basetexture\" \"vgui/logos/%s\"\n\t\"$translucent\" \"1\"\n\t\"$ignorez\" \"1\"\n\t\"$vertexcolor\" \"1\"\n\t\"$vertexalpha\" \"1\"\n}\n", name)
}
