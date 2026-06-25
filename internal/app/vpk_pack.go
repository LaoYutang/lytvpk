package app

import (
	"bytes"
	"fmt"
	"hash/crc32"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"l4d2-manager-next/pkg/valve/vpk"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// VPKPackResult describes the result of packing a directory into a single-file VPK.
type VPKPackResult struct {
	SourceDir      string `json:"sourceDir"`
	OutputPath     string `json:"outputPath"`
	TotalFiles     int    `json:"totalFiles"`
	PackedFiles    int    `json:"packedFiles"`
	OutputIsAddons bool   `json:"outputIsAddons"`
}

// SelectVPKPackSourceDirectory opens a directory picker for the VPK root to pack.
func (a *App) SelectVPKPackSourceDirectory() (string, error) {
	directory, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title:                "选择打包目录（应为 VPK 根目录，即 materials、scripts 等的父目录）",
		ShowHiddenFiles:      false,
		CanCreateDirectories: false,
	})
	if err != nil {
		return "", err
	}
	return directory, nil
}

// PackVPKDirectory packs all regular files under sourceDir into a single-file v1 VPK
// written to outputDir, named after the source directory.
func (a *App) PackVPKDirectory(sourceDir string, outputDir string, outputIsAddons bool) (VPKPackResult, error) {
	result := VPKPackResult{OutputIsAddons: outputIsAddons}

	sourceDir = strings.TrimSpace(sourceDir)
	outputDir = strings.TrimSpace(outputDir)
	result.SourceDir = sourceDir
	if sourceDir == "" {
		return result, fmt.Errorf("打包目录不能为空")
	}
	if outputDir == "" {
		return result, fmt.Errorf("输出位置不能为空")
	}

	info, err := os.Stat(sourceDir)
	if err != nil {
		if os.IsNotExist(err) {
			return result, fmt.Errorf("打包目录不存在: %s", sourceDir)
		}
		return result, fmt.Errorf("无法访问打包目录: %v", err)
	}
	if !info.IsDir() {
		return result, fmt.Errorf("请选择文件夹，而不是文件: %s", sourceDir)
	}

	outInfo, err := os.Stat(outputDir)
	if err != nil {
		if os.IsNotExist(err) {
			return result, fmt.Errorf("输出位置不存在: %s", outputDir)
		}
		return result, fmt.Errorf("无法访问输出位置: %v", err)
	}
	if !outInfo.IsDir() {
		return result, fmt.Errorf("输出位置不是文件夹: %s", outputDir)
	}

	type packEntry struct {
		fullPath       string
		dir, base, ext string
		crc            uint32
		size           uint32
	}

	var entries []packEntry
	err = filepath.WalkDir(sourceDir, func(p string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			return nil
		}
		if !d.Type().IsRegular() {
			return nil
		}

		rel, relErr := filepath.Rel(sourceDir, p)
		if relErr != nil {
			return fmt.Errorf("无法计算相对路径 %s: %v", p, relErr)
		}
		rel = filepath.ToSlash(rel)

		dir, base, ext := splitVPKPackPath(rel)
		crc, size, crcErr := computeFileCRC32(p)
		if crcErr != nil {
			return fmt.Errorf("读取文件 %s 失败: %v", p, crcErr)
		}

		entries = append(entries, packEntry{
			fullPath: p,
			dir:      dir,
			base:     base,
			ext:      ext,
			crc:      crc,
			size:     uint32(size),
		})
		return nil
	})
	if err != nil {
		return result, fmt.Errorf("遍历打包目录失败: %v", err)
	}

	if len(entries) == 0 {
		return result, fmt.Errorf("打包目录为空，未发现可打包文件: %s", sourceDir)
	}

	// WriteDirectory requires entries sorted by ext, then dir, then base.
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].ext != entries[j].ext {
			return entries[i].ext < entries[j].ext
		}
		if entries[i].dir != entries[j].dir {
			return entries[i].dir < entries[j].dir
		}
		return entries[i].base < entries[j].base
	})

	archive := &vpk.Archive{
		Header: vpk.Header{
			Magic:   vpk.Magic,
			Version: 1,
		},
		Files: make([]vpk.File, 0, len(entries)),
	}

	var offset uint32
	for _, e := range entries {
		archive.Files = append(archive.Files, vpk.File{
			Dir:  e.dir,
			Base: e.base,
			Ext:  e.ext,
			DirEntry: vpk.DirEntry{
				CRC:           e.crc,
				DataLocation:  []vpk.DataChunk{{ArchiveIndex: 0x7fff, EntryOffset: offset, EntryLength: e.size}},
				MetadataBytes: 0,
			},
		})
		offset += e.size
	}

	var buffer bytes.Buffer
	if err := vpk.WriteDirectory(&buffer, archive); err != nil {
		return result, fmt.Errorf("写入 VPK 目录失败: %v", err)
	}

	outputPath, err := createUniqueVPKOutputFile(outputDir, sourceDir)
	if err != nil {
		return result, err
	}
	result.OutputPath = outputPath
	result.TotalFiles = len(entries)

	out, err := os.Create(outputPath)
	if err != nil {
		return result, fmt.Errorf("无法创建 VPK 文件 %s: %v", outputPath, err)
	}

	abort := func(failErr error) (VPKPackResult, error) {
		_ = out.Close()
		_ = os.Remove(outputPath)
		return result, failErr
	}

	if _, err := out.Write(buffer.Bytes()); err != nil {
		return abort(fmt.Errorf("写入 VPK 目录失败: %v", err))
	}

	for _, e := range entries {
		if err := appendVPKFileData(out, e.fullPath); err != nil {
			return abort(fmt.Errorf("写入文件 %s 数据失败: %v", e.fullPath, err))
		}
		result.PackedFiles++
	}

	if err := out.Close(); err != nil {
		_ = os.Remove(outputPath)
		return result, fmt.Errorf("关闭 VPK 文件失败: %v", err)
	}

	return result, nil
}

func createUniqueVPKOutputFile(outputDir string, sourceDir string) (string, error) {
	baseName := sanitizeVPKOutputDirName(filepath.Base(filepath.Clean(sourceDir)))
	if baseName == "" {
		baseName = "vpk_packed"
	}

	for i := 0; i < 10000; i++ {
		name := baseName
		if i > 0 {
			name = fmt.Sprintf("%s(%d)", baseName, i)
		}
		outputPath := filepath.Join(outputDir, name+".vpk")
		if _, err := os.Stat(outputPath); err == nil {
			continue
		} else if !os.IsNotExist(err) {
			return "", fmt.Errorf("无法检查输出文件 %s: %v", outputPath, err)
		}
		return outputPath, nil
	}

	return "", fmt.Errorf("无法创建输出文件，已尝试过多同名文件")
}

func splitVPKPackPath(relPath string) (dir, base, ext string) {
	relPath = strings.ReplaceAll(relPath, "\\", "/")
	ext = strings.TrimPrefix(path.Ext(relPath), ".")
	base = strings.TrimSuffix(path.Base(relPath), path.Ext(relPath))
	dir = path.Dir(relPath)
	if dir == "." || dir == "" {
		dir = " "
	}
	if ext == "" {
		ext = " "
	}
	if base == "" {
		base = " "
	}
	return dir, base, ext
}

func computeFileCRC32(filePath string) (uint32, int64, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return 0, 0, err
	}
	defer file.Close()

	hasher := crc32.NewIEEE()
	written, err := io.Copy(hasher, file)
	if err != nil {
		return 0, 0, err
	}
	return hasher.Sum32(), written, nil
}

func appendVPKFileData(out *os.File, filePath string) error {
	file, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer file.Close()

	if _, err := io.Copy(out, file); err != nil {
		return err
	}
	return nil
}
