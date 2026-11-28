package app

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
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

type dropFolderImportState struct {
	existingNames map[string]bool
	sidecars      map[string]droppedDirectorySidecars
}

type droppedDirectorySidecars struct {
	byStem map[string][]string
	err    error
}

var errDropTargetExists = errors.New("addons 中已有同名文件")

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

func (folders *dropFolderImportState) installVPK(job dropImportJob, addonsDir string, progress dropImportProgressFunc) (string, string, error) {
	root, err := openDroppedFolder(job.folder)
	if err != nil {
		return "", "", err
	}
	defer root.Close()
	src, err := openDroppedVPK(root, job.relative)
	if err != nil {
		return "", "", err
	}
	defer src.Close()

	sourceDir := path.Dir(job.relative)
	vpkName := path.Base(job.relative)
	sidecars, listErr := folders.findSidecars(root, sourceDir, vpkName)
	fileProgress := func(index int) dropImportProgressFunc {
		return func(percent int, message string) {
			progress((index*100+percent)/(1+len(sidecars)), message)
		}
	}
	outputPath, err := folders.copyFile(src, filepath.Join(addonsDir, vpkName), fileProgress(0))
	if err != nil {
		return outputPath, "", err
	}
	if listErr != nil {
		return outputPath, fmt.Sprintf("无法查找同名配套文件: %v", listErr), nil
	}

	vpkStem := strings.TrimSuffix(vpkName, path.Ext(vpkName))
	var copied int
	var skipped, failed []string
	for index, name := range sidecars {
		outputName := vpkStem + strings.ToLower(path.Ext(name))
		err := folders.installSidecar(root, path.Join(sourceDir, name), filepath.Join(addonsDir, outputName), fileProgress(index+1))
		switch {
		case err == nil:
			copied++
		case errors.Is(err, errDropTargetExists):
			skipped = append(skipped, outputName)
		default:
			failed = append(failed, fmt.Sprintf("%s（%v）", name, err))
		}
	}
	var summary []string
	if copied > 0 {
		summary = append(summary, fmt.Sprintf("已导入 %d 个配套文件", copied))
	}
	if len(skipped) > 0 {
		summary = append(summary, "跳过同名配套文件："+strings.Join(skipped, "、"))
	}
	if len(failed) > 0 {
		summary = append(summary, "配套文件导入失败："+strings.Join(failed, "、"))
	}
	return outputPath, strings.Join(summary, "；"), nil
}

func (folders *dropFolderImportState) findSidecars(root *os.Root, sourceDir, vpkName string) ([]string, error) {
	key := filepath.Join(root.Name(), filepath.FromSlash(sourceDir))
	directory, cached := folders.sidecars[key]
	if !cached {
		entries, err := fs.ReadDir(root.FS(), sourceDir)
		directory = droppedDirectorySidecars{byStem: make(map[string][]string), err: err}
		for _, entry := range entries {
			name := entry.Name()
			if entry.Type().IsRegular() && isSupportedSidecarName(name) {
				stem := entryBaseWithoutExt(name)
				directory.byStem[stem] = append(directory.byStem[stem], name)
			}
		}
		folders.sidecars[key] = directory
	}
	return directory.byStem[entryBaseWithoutExt(vpkName)], directory.err
}

func (folders *dropFolderImportState) installSidecar(root *os.Root, rel, destPath string, progress dropImportProgressFunc) error {
	src, err := openDroppedFolderFile(root, rel)
	if err != nil {
		return err
	}
	defer src.Close()
	_, err = folders.copyFile(src, destPath, progress)
	return err
}

func (folders *dropFolderImportState) copyFile(src *os.File, destPath string, progress dropImportProgressFunc) (string, error) {
	nameKey := strings.ToUpper(filepath.Base(destPath))
	if folders.existingNames[nameKey] {
		return "", errDropTargetExists
	}
	outputPath, err := copyDroppedFile(src, destPath, commitDropFile, progress)
	if errors.Is(err, fs.ErrExist) {
		folders.existingNames[nameKey] = true
		return outputPath, errDropTargetExists
	}
	if err == nil {
		folders.existingNames[nameKey] = true
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
	type vpkStem struct {
		dir  string
		name string
	}
	vpkStems := make(map[vpkStem]bool, len(folder.VPKPaths))
	for _, rel := range folder.VPKPaths {
		vpkStems[vpkStem{path.Dir(rel), entryBaseWithoutExt(rel)}] = true
	}
	skip := func(rel string) bool {
		return isVPKName(rel) || (isSupportedSidecarName(rel) && vpkStems[vpkStem{path.Dir(rel), entryBaseWithoutExt(rel)}])
	}
	return a.packVPKDirectory(sourceDir, addonsDir, true, "", skip, progress)
}
