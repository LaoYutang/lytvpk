package app

import (
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// DropFolderInspection lists folders and filesystem errors from one drop.
type DropFolderInspection struct {
	AddonsDir string              `json:"addonsDir"`
	Folders   []DroppedFolderInfo `json:"folders"`
}

type DroppedFolderInfo struct {
	Path         string   `json:"path"`
	VPKPaths     []string `json:"vpkPaths"`
	HasResources bool     `json:"hasResources"`
	Error        string   `json:"error"`
}

func (a *App) InspectDroppedFolders(paths []string) DropFolderInspection {
	result := DropFolderInspection{
		AddonsDir: a.GetRootDirectory(),
		Folders:   []DroppedFolderInfo{},
	}
	for _, rawPath := range paths {
		folder := DroppedFolderInfo{Path: rawPath, VPKPaths: []string{}}
		if rawPath == "" {
			folder.Error = "拖入的路径不能为空"
			result.Folders = append(result.Folders, folder)
			continue
		}
		targetPath := filepath.Clean(rawPath)
		isFolder, err := isDroppedFolder(targetPath)
		if err != nil {
			folder.Error = fmt.Sprintf("无法检查拖入的路径: %v", err)
		} else if isFolder {
			if err := scanDroppedFolder(targetPath, &folder); err != nil {
				folder.Error = fmt.Sprintf("扫描文件夹失败: %v", err)
			}
		} else {
			continue
		}
		result.Folders = append(result.Folders, folder)
	}
	return result
}

func isDroppedFolder(targetPath string) (bool, error) {
	info, err := os.Lstat(targetPath)
	if err != nil {
		return false, err
	}
	if info.IsDir() {
		return true, nil
	}
	if !isDroppedLinkMode(info.Mode()) {
		return false, nil
	}
	// Identify a dropped directory link for an explicit error while preserving
	// the existing handling of links to directly dropped files.
	info, err = os.Stat(targetPath)
	if err != nil {
		return false, err
	}
	return info.IsDir(), nil
}

func scanDroppedFolder(targetPath string, folder *DroppedFolderInfo) error {
	root, err := openDroppedFolder(targetPath)
	if err != nil {
		return err
	}
	defer root.Close()

	return fs.WalkDir(root.FS(), ".", func(rel string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil || rel == "." {
			return walkErr
		}
		if isDroppedLinkMode(entry.Type()) {
			if entry.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if entry.IsDir() {
			if path.Dir(rel) == "." && isModResourceDirectory(entry.Name()) {
				folder.HasResources = true
			}
		} else if entry.Type().IsRegular() && strings.EqualFold(path.Ext(entry.Name()), ".vpk") {
			folder.VPKPaths = append(folder.VPKPaths, rel)
		}
		return nil
	})
}

func isModResourceDirectory(name string) bool {
	switch strings.ToLower(name) {
	case "materials", "models", "scripts", "maps", "sound", "particles", "resource", "cfg", "scenes", "missions", "media":
		return true
	}
	return false
}

func isDroppedLinkMode(mode fs.FileMode) bool {
	// Go represents Windows directory junctions as irregular entries.
	return mode&(fs.ModeSymlink|fs.ModeIrregular) != 0
}

func openDroppedFolder(targetPath string) (*os.Root, error) {
	targetPath = filepath.Clean(targetPath)
	info, err := os.Lstat(targetPath)
	if err != nil {
		return nil, err
	}
	if isDroppedLinkMode(info.Mode()) {
		return nil, fmt.Errorf("不支持拖入符号链接或目录联接: %s", targetPath)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("路径不是文件夹: %s", targetPath)
	}

	root, err := os.OpenRoot(targetPath)
	if err != nil {
		return nil, err
	}
	openedInfo, err := root.Stat(".")
	if err != nil {
		root.Close()
		return nil, err
	}
	if !os.SameFile(info, openedInfo) {
		root.Close()
		return nil, fmt.Errorf("文件夹已变更，请重新拖入: %s", targetPath)
	}
	return root, nil
}

func openDroppedVPK(root *os.Root, rel string) (*os.File, error) {
	if !fs.ValidPath(rel) || !strings.EqualFold(path.Ext(rel), ".vpk") {
		return nil, fmt.Errorf("无效的 VPK 相对路径: %s", rel)
	}
	localPath, err := filepath.Localize(rel)
	if err != nil {
		return nil, err
	}
	components := strings.Split(rel, "/")
	parent := ""
	for _, component := range components[:len(components)-1] {
		parent = filepath.Join(parent, component)
		info, err := root.Lstat(parent)
		if err != nil {
			return nil, err
		}
		if isDroppedLinkMode(info.Mode()) || !info.IsDir() {
			return nil, fmt.Errorf("VPK 所在的目录已变更: %s", parent)
		}
	}
	info, err := root.Lstat(localPath)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, fmt.Errorf("VPK 已变更或不是普通文件: %s", rel)
	}
	file, err := root.Open(localPath)
	if err != nil {
		return nil, err
	}
	openedInfo, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, err
	}
	if !openedInfo.Mode().IsRegular() || !os.SameFile(info, openedInfo) {
		file.Close()
		return nil, fmt.Errorf("VPK 已变更，请重新拖入: %s", rel)
	}
	return file, nil
}
