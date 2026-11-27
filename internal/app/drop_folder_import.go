package app

import (
	"errors"
	"fmt"
	"io/fs"
	"path"
	"path/filepath"
	"strings"
)

// DropImportRequest describes a direct drop or the action chosen for a folder.
type DropImportRequest struct {
	Path         string   `json:"path"`
	FolderAction string   `json:"folderAction"`
	VPKPaths     []string `json:"vpkPaths"`
}

type dropImportJob struct {
	path      string
	folder    string
	relative  string
	pack      bool
	mixedPack bool
	err       error
}

var errDropVPKExists = errors.New("addons 中已有同名文件")

// HandlePlannedFileDrop processes direct files and the actions chosen after scanning.
func (a *App) HandlePlannedFileDrop(requests []DropImportRequest, inspectedAddonsDir string) (DropImportResult, error) {
	addonsDir := a.GetRootDirectory()
	var folderErr error
	if addonsDir != inspectedAddonsDir {
		folderErr = fmt.Errorf("addons 目录已切换，请重新拖入文件夹确认")
	}

	// Keep the direct-file behavior in mixed drops. Run those files first so a
	// folder import can detect even the files installed by this same drop.
	var directJobs, folderJobs []dropImportJob
	for _, request := range requests {
		targetPath := strings.TrimSpace(request.Path)
		switch request.FolderAction {
		case "":
			directJobs = append(directJobs, dropImportJob{path: targetPath})
		case "pack":
			folderJobs = append(folderJobs, dropImportJob{path: targetPath, pack: true, mixedPack: len(request.VPKPaths) > 0, err: folderErr})
		case "import":
			if len(request.VPKPaths) == 0 {
				folderJobs = append(folderJobs, dropImportJob{path: targetPath, err: fmt.Errorf("没有确认要导入的 VPK 文件")})
			}
			for _, rel := range request.VPKPaths {
				job := dropImportJob{path: targetPath, folder: targetPath, relative: rel, err: folderErr}
				if fs.ValidPath(rel) {
					job.path = filepath.Join(targetPath, filepath.FromSlash(rel))
				}
				folderJobs = append(folderJobs, job)
			}
		default:
			folderJobs = append(folderJobs, dropImportJob{path: targetPath, err: fmt.Errorf("无法识别选择的文件夹操作")})
		}
	}
	return a.runDropImport(append(directJobs, folderJobs...), addonsDir), nil
}

func (job dropImportJob) kind() (string, error) {
	switch {
	case job.folder != "":
		return dropImportKindVPK, job.err
	case job.pack || job.err != nil:
		return dropImportKindFolder, job.err
	default:
		return classifyDropImportPath(job.path)
	}
}

func installFolderVPK(job dropImportJob, addonsDir string, existingNames map[string]bool, progress dropImportProgressFunc) (string, error) {
	root, err := openDroppedFolder(job.folder)
	if err != nil {
		return "", err
	}
	defer root.Close()
	src, err := openDroppedVPK(root, job.relative)
	if err != nil {
		return "", err
	}
	defer src.Close()

	nameKey := strings.ToUpper(path.Base(job.relative))
	if existingNames[nameKey] {
		return "", errDropVPKExists
	}
	outputPath, err := copyDroppedVPK(src, job.path, addonsDir, commitDropVPK, progress)
	if errors.Is(err, fs.ErrExist) {
		return outputPath, errDropVPKExists
	}
	return outputPath, err
}

func (a *App) packDroppedVPKDirectory(sourceDir, addonsDir string, mixedPack bool, progress dropImportProgressFunc) (VPKPackResult, error) {
	var folder DroppedFolderInfo
	if err := scanDroppedFolder(sourceDir, &folder); err != nil {
		return VPKPackResult{}, fmt.Errorf("扫描文件夹失败: %w", err)
	}
	if !folder.HasResources {
		return VPKPackResult{}, fmt.Errorf("文件夹根目录未发现可识别的 Mod 资源目录")
	}
	if !mixedPack && len(folder.VPKPaths) > 0 {
		return VPKPackResult{}, fmt.Errorf("文件夹中发现现有 VPK，请重新拖入并选择处理方式")
	}
	return a.packVPKDirectory(sourceDir, addonsDir, true, "", true, progress)
}
