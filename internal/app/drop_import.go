package app

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/bodgit/sevenzip"
	"github.com/nwaples/rardecode"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/transform"
)

const (
	dropImportKindVPK         = "vpk"
	dropImportKindArchive     = "archive"
	dropImportKindFolder      = "folder"
	dropImportKindDump        = "dump"
	dropImportKindUnsupported = "unsupported"
)

// DropImportResult is returned after processing paths dropped or selected by the user.
type DropImportResult struct {
	Total             int                    `json:"total"`
	Succeeded         int                    `json:"succeeded"`
	Failed            int                    `json:"failed"`
	Items             []DropImportItemResult `json:"items"`
	HasInstallChanges bool                   `json:"hasInstallChanges"`
}

type DropImportItemResult struct {
	Path       string `json:"path"`
	Name       string `json:"name"`
	Kind       string `json:"kind"`
	Success    bool   `json:"success"`
	Message    string `json:"message"`
	OutputPath string `json:"outputPath"`
}

type DropImportProgress struct {
	Current     int      `json:"current"`
	Total       int      `json:"total"`
	Percent     int      `json:"percent"`
	Phase       string   `json:"phase"`
	Path        string   `json:"path"`
	Name        string   `json:"name"`
	Message     string   `json:"message"`
	ActiveNames []string `json:"activeNames"`
}

type dropImportProgressFunc = func(percent int, message string)
type archiveProgressFunc = func(percent int, message string, activeNames []string)

type dropZipEntry struct {
	file        *zip.File
	decodedName string
	size        int64
}

type dropRarEntry struct {
	name string
	size int64
}

type drop7zEntry struct {
	file *sevenzip.File
	name string
	size int64
}

func (a *App) HandleFileDrop(paths []string) (DropImportResult, error) {
	result := DropImportResult{
		Total: len(paths),
		Items: make([]DropImportItemResult, 0, len(paths)),
	}

	for index, rawPath := range paths {
		item := a.handleDroppedPath(index+1, len(paths), strings.TrimSpace(rawPath))
		result.Items = append(result.Items, item)
		if item.Success {
			result.Succeeded++
			if item.Kind == dropImportKindVPK || item.Kind == dropImportKindArchive || item.Kind == dropImportKindFolder {
				result.HasInstallChanges = true
			}
		} else {
			result.Failed++
		}
	}

	if result.HasInstallChanges && a.ctx != nil {
		runtime.EventsEmit(a.ctx, "refresh_files", nil)
	}
	return result, nil
}

func (a *App) handleDroppedPath(current int, total int, targetPath string) DropImportItemResult {
	item := DropImportItemResult{
		Path: targetPath,
		Name: filepath.Base(targetPath),
	}
	if targetPath == "" {
		item.Kind = dropImportKindUnsupported
		item.Message = "路径不能为空"
		a.emitDropImportProgress(current, total, item, 100, "failed", item.Message)
		return item
	}

	kind, err := classifyDropImportPath(targetPath)
	item.Kind = kind
	if err != nil {
		item.Message = err.Error()
		a.emitDropImportProgress(current, total, item, 100, "failed", item.Message)
		return item
	}

	if kind == dropImportKindDump {
		item.Success = true
		item.Message = "已交给崩溃转储分析器"
		a.emitDropImportProgress(current, total, item, 100, "complete", item.Message)
		return item
	}

	if kind == dropImportKindUnsupported {
		item.Message = "仅支持 .vpk, .zip, .rar, .7z, 文件夹, .mdmp, .dmp"
		a.emitDropImportProgress(current, total, item, 100, "failed", item.Message)
		return item
	}

	if a.rootDir == "" {
		item.Message = "请先设置游戏 addons 目录"
		a.emitDropImportProgress(current, total, item, 100, "failed", item.Message)
		return item
	}

	progress := func(phase string) dropImportProgressFunc {
		return func(percent int, message string) {
			a.emitDropImportProgress(current, total, item, percent, phase, message)
		}
	}
	archiveProgress := func(phase string) archiveProgressFunc {
		return func(percent int, message string, activeNames []string) {
			a.emitDropImportProgress(current, total, item, percent, phase, message, activeNames)
		}
	}

	a.emitDropImportProgress(current, total, item, 0, "preparing", "准备处理...")
	switch kind {
	case dropImportKindVPK:
		outputPath, err := a.installVPKFile(targetPath, progress("copying"))
		item.OutputPath = outputPath
		if err != nil {
			item.Message = fmt.Sprintf("安装 VPK 失败: %v", err)
			a.emitDropImportProgress(current, total, item, 100, "failed", item.Message)
			return item
		}
		item.Success = true
		item.Message = "VPK 安装完成"
	case dropImportKindArchive:
		err := a.extractVPKFromArchiveWithProgress(targetPath, a.rootDir, archiveProgress("extracting"))
		if err != nil {
			item.Message = fmt.Sprintf("解压压缩包失败: %v", err)
			a.emitDropImportProgress(current, total, item, 100, "failed", item.Message)
			return item
		}
		item.Success = true
		item.Message = "压缩包导入完成"
	case dropImportKindFolder:
		packResult, err := a.packVPKDirectoryWithProgress(targetPath, a.rootDir, true, progress("packing"))
		item.OutputPath = packResult.OutputPath
		if err != nil {
			item.Message = fmt.Sprintf("打包文件夹失败: %v", err)
			a.emitDropImportProgress(current, total, item, 100, "failed", item.Message)
			return item
		}
		item.Success = true
		item.Message = "文件夹已打包为 VPK"
	}

	a.emitDropImportProgress(current, total, item, 100, "complete", item.Message)
	return item
}

func classifyDropImportPath(targetPath string) (string, error) {
	info, err := os.Stat(targetPath)
	if err != nil {
		if os.IsNotExist(err) {
			return dropImportKindUnsupported, fmt.Errorf("路径不存在: %s", targetPath)
		}
		return dropImportKindUnsupported, fmt.Errorf("无法访问路径: %v", err)
	}
	if info.IsDir() {
		return dropImportKindFolder, nil
	}

	switch strings.ToLower(filepath.Ext(targetPath)) {
	case ".vpk":
		return dropImportKindVPK, nil
	case ".zip", ".rar", ".7z":
		return dropImportKindArchive, nil
	case ".mdmp", ".dmp":
		return dropImportKindDump, nil
	default:
		return dropImportKindUnsupported, nil
	}
}

func (a *App) emitDropImportProgress(current int, total int, item DropImportItemResult, percent int, phase string, message string, activeNames ...[]string) {
	if a.ctx == nil {
		return
	}
	names := []string(nil)
	if len(activeNames) > 0 {
		names = activeNames[0]
	}
	runtime.EventsEmit(a.ctx, "drop_import_progress", DropImportProgress{
		Current:     current,
		Total:       total,
		Percent:     normalizeProgressPercent(percent),
		Phase:       phase,
		Path:        item.Path,
		Name:        item.Name,
		Message:     message,
		ActiveNames: names,
	})
}

func (a *App) installVPKFile(srcPath string, progress dropImportProgressFunc) (string, error) {
	emit := func(percent int, message string) {
		if progress != nil {
			progress(percent, message)
		}
	}

	src, err := os.Open(srcPath)
	if err != nil {
		return "", err
	}
	defer src.Close()

	info, err := src.Stat()
	if err != nil {
		return "", err
	}

	destPath := filepath.Join(a.rootDir, filepath.Base(srcPath))
	dst, err := os.CreateTemp(a.rootDir, "."+filepath.Base(srcPath)+".tmp-*")
	if err != nil {
		return "", err
	}
	tempPath := dst.Name()

	abort := func(failErr error) (string, error) {
		_ = dst.Close()
		_ = os.Remove(tempPath)
		return destPath, failErr
	}

	emit(0, fmt.Sprintf("正在复制: %s", filepath.Base(srcPath)))
	var copied int64
	if err := copyStreamWithProgress(dst, src, func(delta int64) {
		copied += delta
		emit(scaledProgressPercent(0, 100, copied, info.Size()), fmt.Sprintf("正在复制: %s", filepath.Base(srcPath)))
	}); err != nil {
		return abort(err)
	}
	if err := dst.Close(); err != nil {
		_ = os.Remove(tempPath)
		return destPath, err
	}
	if err := replaceFile(tempPath, destPath); err != nil {
		_ = os.Remove(tempPath)
		return destPath, err
	}

	log.Printf("已安装: %s -> %s", srcPath, destPath)
	emit(100, fmt.Sprintf("已复制: %s", filepath.Base(destPath)))
	return destPath, nil
}

func replaceFile(srcPath string, destPath string) error {
	if err := os.Rename(srcPath, destPath); err == nil {
		return nil
	} else if _, statErr := os.Stat(destPath); statErr != nil {
		return err
	}

	if err := os.Remove(destPath); err != nil {
		return err
	}
	return os.Rename(srcPath, destPath)
}

func (a *App) extractVPKFromArchiveWithProgress(archivePath string, destDir string, progress archiveProgressFunc) error {
	switch strings.ToLower(filepath.Ext(archivePath)) {
	case ".zip":
		return a.extractVPKFromZipWithProgress(archivePath, destDir, progress)
	case ".rar":
		return extractVPKFromRarWithProgress(archivePath, destDir, progress)
	case ".7z":
		return a.extractVPKFrom7zWithProgress(archivePath, destDir, progress)
	default:
		return fmt.Errorf("不支持的压缩格式: %s", filepath.Ext(archivePath))
	}
}

func (a *App) extractVPKFromZipWithProgress(zipPath string, destDir string, progress archiveProgressFunc) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return fmt.Errorf("无法打开ZIP文件: %v", err)
	}
	defer r.Close()

	allEntries := make([]dropZipEntry, 0, len(r.File))
	for _, f := range r.File {
		if f.FileInfo().IsDir() {
			continue
		}
		name := decodeZipEntryName(f)
		allEntries = append(allEntries, dropZipEntry{file: f, decodedName: name, size: int64(f.UncompressedSize64)})
	}

	vpkBases := make(map[string]bool)
	for _, entry := range allEntries {
		if isVPKName(entry.decodedName) {
			vpkBases[entryBaseWithoutExt(entry.decodedName)] = true
		}
	}
	if len(vpkBases) == 0 {
		return fmt.Errorf("ZIP文件中未找到VPK文件")
	}

	selected := make([]dropZipEntry, 0)
	for _, entry := range allEntries {
		if isVPKName(entry.decodedName) {
			selected = append(selected, entry)
		}
	}
	for _, entry := range allEntries {
		if isVPKName(entry.decodedName) {
			continue
		}
		if vpkBases[entryBaseWithoutExt(entry.decodedName)] && isSupportedSidecarName(entry.decodedName) {
			selected = append(selected, entry)
		}
	}

	return a.extractZipEntriesParallel(selected, destDir, progress)
}

func extractVPKFromRarWithProgress(rarPath string, destDir string, progress archiveProgressFunc) error {
	allEntries, err := listRarEntries(rarPath)
	if err != nil {
		return err
	}

	vpkBases := make(map[string]bool)
	for _, entry := range allEntries {
		if isVPKName(entry.name) {
			vpkBases[entryBaseWithoutExt(entry.name)] = true
		}
	}
	if len(vpkBases) == 0 {
		return fmt.Errorf("RAR文件中未找到VPK文件")
	}

	selected := make(map[string]dropRarEntry)
	for _, entry := range allEntries {
		if isVPKName(entry.name) || (vpkBases[entryBaseWithoutExt(entry.name)] && isSupportedSidecarName(entry.name)) {
			selected[entry.name] = entry
		}
	}

	f, err := os.Open(rarPath)
	if err != nil {
		return fmt.Errorf("无法打开RAR文件: %v", err)
	}
	defer f.Close()

	r, err := rardecode.NewReader(f, "")
	if err != nil {
		return fmt.Errorf("无法创建RAR读取器: %v", err)
	}

	totalBytes := totalRarEntryBytes(selected)
	progress(0, fmt.Sprintf("准备解压 %d 个文件", len(selected)), nil)
	var completedBytes int64
	completedEntries := 0
	for {
		header, err := r.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("读取RAR内容失败: %v", err)
		}
		if header.IsDir {
			continue
		}
		entry, ok := selected[header.Name]
		if !ok {
			continue
		}
		if err := extractReaderEntryWithProgress(r, entry.name, destDir, func(delta int64) {
			completedBytes += delta
			progress(archivePercent(completedBytes, totalBytes, completedEntries, len(selected)), fmt.Sprintf("正在解压: %s", filepath.Base(entry.name)), nil)
		}); err != nil {
			return fmt.Errorf("解压 %s 失败: %v", entry.name, err)
		}
		completedEntries++
		progress(archivePercent(completedBytes, totalBytes, completedEntries, len(selected)), fmt.Sprintf("已解压: %s", filepath.Base(entry.name)), nil)
	}

	if completedEntries == 0 {
		return fmt.Errorf("RAR文件中未找到VPK文件")
	}
	progress(100, fmt.Sprintf("已解压 %d 个文件", completedEntries), nil)
	return nil
}

func (a *App) extractVPKFrom7zWithProgress(sevenZPath string, destDir string, progress archiveProgressFunc) error {
	r, err := sevenzip.OpenReader(sevenZPath)
	if err != nil {
		return fmt.Errorf("无法打开7z文件: %v", err)
	}
	defer r.Close()

	allEntries := make([]drop7zEntry, 0, len(r.File))
	for _, f := range r.File {
		if f.FileInfo().IsDir() {
			continue
		}
		allEntries = append(allEntries, drop7zEntry{file: f, name: f.Name, size: f.FileInfo().Size()})
	}

	vpkBases := make(map[string]bool)
	for _, entry := range allEntries {
		if isVPKName(entry.name) {
			vpkBases[entryBaseWithoutExt(entry.name)] = true
		}
	}
	if len(vpkBases) == 0 {
		return fmt.Errorf("7z文件中未找到VPK文件")
	}

	selected := make([]drop7zEntry, 0)
	for _, entry := range allEntries {
		if isVPKName(entry.name) {
			selected = append(selected, entry)
		}
	}
	for _, entry := range allEntries {
		if isVPKName(entry.name) {
			continue
		}
		if vpkBases[entryBaseWithoutExt(entry.name)] && isSupportedSidecarName(entry.name) {
			selected = append(selected, entry)
		}
	}

	return a.extract7zEntriesParallel(selected, destDir, progress)
}

func (a *App) extractZipEntriesParallel(entries []dropZipEntry, destDir string, progress archiveProgressFunc) error {
	totalBytes := totalZipEntryBytes(entries)
	progress(0, fmt.Sprintf("准备并行解压 %d 个文件", len(entries)), nil)

	var mu sync.Mutex
	var wg sync.WaitGroup
	var completedBytes int64
	var completedEntries int
	var errs []string
	activeVPKs := make(map[string]bool)

	run := func(entry dropZipEntry) {
		defer wg.Done()
		activeName := filepath.Base(entry.decodedName)
		if isVPKName(entry.decodedName) {
			mu.Lock()
			activeVPKs[activeName] = true
			percent := archivePercent(completedBytes, totalBytes, completedEntries, len(entries))
			activeNames := activeArchiveNames(activeVPKs)
			mu.Unlock()
			progress(percent, "正在并行解压 VPK", activeNames)
		}
		if err := extractZipEntryWithProgress(entry.file, entry.decodedName, destDir, func(delta int64) {
			mu.Lock()
			completedBytes += delta
			percent := archivePercent(completedBytes, totalBytes, completedEntries, len(entries))
			message := parallelArchiveProgressMessage(entry.decodedName)
			activeNames := activeArchiveNames(activeVPKs)
			mu.Unlock()
			progress(percent, message, activeNames)
		}); err != nil {
			mu.Lock()
			delete(activeVPKs, activeName)
			errs = append(errs, fmt.Sprintf("%s: %v", entry.decodedName, err))
			mu.Unlock()
			return
		}
		mu.Lock()
		delete(activeVPKs, activeName)
		completedEntries++
		percent := archivePercent(completedBytes, totalBytes, completedEntries, len(entries))
		message := fmt.Sprintf("已解压: %s", filepath.Base(entry.decodedName))
		activeNames := activeArchiveNames(activeVPKs)
		mu.Unlock()
		progress(percent, message, activeNames)
	}

	for _, entry := range entries {
		wg.Add(1)
		entry := entry
		if a.goroutinePool == nil {
			run(entry)
			continue
		}
		if err := a.goroutinePool.Submit(func() { run(entry) }); err != nil {
			wg.Done()
			mu.Lock()
			errs = append(errs, fmt.Sprintf("提交解压任务失败 %s: %v", entry.decodedName, err))
			mu.Unlock()
		}
	}
	wg.Wait()

	if len(errs) > 0 {
		return fmt.Errorf("部分ZIP文件解压失败:\n%s", strings.Join(errs, "\n"))
	}
	progress(100, fmt.Sprintf("并行解压完成，共 %d 个文件", len(entries)), nil)
	return nil
}

func (a *App) extract7zEntriesParallel(entries []drop7zEntry, destDir string, progress archiveProgressFunc) error {
	totalBytes := total7zEntryBytes(entries)
	progress(0, fmt.Sprintf("准备并行解压 %d 个文件", len(entries)), nil)

	var mu sync.Mutex
	var wg sync.WaitGroup
	var completedBytes int64
	var completedEntries int
	var errs []string
	activeVPKs := make(map[string]bool)

	run := func(entry drop7zEntry) {
		defer wg.Done()
		activeName := filepath.Base(entry.name)
		if isVPKName(entry.name) {
			mu.Lock()
			activeVPKs[activeName] = true
			percent := archivePercent(completedBytes, totalBytes, completedEntries, len(entries))
			activeNames := activeArchiveNames(activeVPKs)
			mu.Unlock()
			progress(percent, "正在并行解压 VPK", activeNames)
		}
		if err := extract7zEntryWithProgress(entry.file, entry.name, destDir, func(delta int64) {
			mu.Lock()
			completedBytes += delta
			percent := archivePercent(completedBytes, totalBytes, completedEntries, len(entries))
			message := parallelArchiveProgressMessage(entry.name)
			activeNames := activeArchiveNames(activeVPKs)
			mu.Unlock()
			progress(percent, message, activeNames)
		}); err != nil {
			mu.Lock()
			delete(activeVPKs, activeName)
			errs = append(errs, fmt.Sprintf("%s: %v", entry.name, err))
			mu.Unlock()
			return
		}
		mu.Lock()
		delete(activeVPKs, activeName)
		completedEntries++
		percent := archivePercent(completedBytes, totalBytes, completedEntries, len(entries))
		message := fmt.Sprintf("已解压: %s", filepath.Base(entry.name))
		activeNames := activeArchiveNames(activeVPKs)
		mu.Unlock()
		progress(percent, message, activeNames)
	}

	for _, entry := range entries {
		wg.Add(1)
		entry := entry
		if a.goroutinePool == nil {
			run(entry)
			continue
		}
		if err := a.goroutinePool.Submit(func() { run(entry) }); err != nil {
			wg.Done()
			mu.Lock()
			errs = append(errs, fmt.Sprintf("提交解压任务失败 %s: %v", entry.name, err))
			mu.Unlock()
		}
	}
	wg.Wait()

	if len(errs) > 0 {
		return fmt.Errorf("部分7z文件解压失败:\n%s", strings.Join(errs, "\n"))
	}
	progress(100, fmt.Sprintf("并行解压完成，共 %d 个文件", len(entries)), nil)
	return nil
}

func listRarEntries(rarPath string) ([]dropRarEntry, error) {
	f, err := os.Open(rarPath)
	if err != nil {
		return nil, fmt.Errorf("无法打开RAR文件: %v", err)
	}
	defer f.Close()

	r, err := rardecode.NewReader(f, "")
	if err != nil {
		return nil, fmt.Errorf("无法创建RAR读取器: %v", err)
	}

	var entries []dropRarEntry
	for {
		header, err := r.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("读取RAR内容失败: %v", err)
		}
		if header.IsDir {
			continue
		}
		entries = append(entries, dropRarEntry{name: header.Name, size: header.UnPackedSize})
	}
	return entries, nil
}

func extractZipEntryWithProgress(file *zip.File, name string, destDir string, onDelta func(int64)) error {
	rc, err := file.Open()
	if err != nil {
		return err
	}
	defer rc.Close()
	return extractReaderEntryWithProgress(rc, name, destDir, onDelta)
}

func extract7zEntryWithProgress(file *sevenzip.File, name string, destDir string, onDelta func(int64)) error {
	rc, err := file.Open()
	if err != nil {
		return err
	}
	defer rc.Close()
	return extractReaderEntryWithProgress(rc, name, destDir, onDelta)
}

func extractReaderEntryWithProgress(reader io.Reader, name string, destDir string, onDelta func(int64)) error {
	targetPath := filepath.Join(destDir, filepath.Base(name))
	outFile, err := os.Create(targetPath)
	if err != nil {
		return err
	}

	if err := copyStreamWithProgress(outFile, reader, onDelta); err != nil {
		_ = outFile.Close()
		_ = os.Remove(targetPath)
		return err
	}
	return outFile.Close()
}

func decodeZipEntryName(file *zip.File) string {
	name := file.Name
	if file.Flags&0x800 != 0 {
		return name
	}
	decoder := transform.NewReader(bytes.NewReader([]byte(name)), simplifiedchinese.GBK.NewDecoder())
	content, err := io.ReadAll(decoder)
	if err == nil && len(content) > 0 {
		return string(content)
	}
	return name
}

func copyStreamWithProgress(dst io.Writer, src io.Reader, onDelta func(int64)) error {
	buffer := make([]byte, 1024*1024)
	for {
		n, readErr := src.Read(buffer)
		if n > 0 {
			if _, writeErr := dst.Write(buffer[:n]); writeErr != nil {
				return writeErr
			}
			if onDelta != nil {
				onDelta(int64(n))
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return readErr
		}
	}
	return nil
}

func isVPKName(name string) bool {
	return strings.EqualFold(filepath.Ext(name), ".vpk")
}

func isSupportedSidecarName(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".jpg", ".jpeg", ".png", ".gif", ".meta":
		return true
	default:
		return false
	}
}

func entryBaseWithoutExt(name string) string {
	base := strings.ToLower(filepath.Base(name))
	return strings.TrimSuffix(base, strings.ToLower(filepath.Ext(base)))
}

func totalZipEntryBytes(entries []dropZipEntry) int64 {
	var total int64
	for _, entry := range entries {
		if entry.size > 0 {
			total += entry.size
		}
	}
	return total
}

func totalRarEntryBytes(entries map[string]dropRarEntry) int64 {
	var total int64
	for _, entry := range entries {
		if entry.size > 0 {
			total += entry.size
		}
	}
	return total
}

func total7zEntryBytes(entries []drop7zEntry) int64 {
	var total int64
	for _, entry := range entries {
		if entry.size > 0 {
			total += entry.size
		}
	}
	return total
}

func archivePercent(completedBytes int64, totalBytes int64, completedEntries int, totalEntries int) int {
	if totalBytes > 0 {
		return scaledProgressPercent(0, 100, completedBytes, totalBytes)
	}
	if totalEntries <= 0 {
		return 100
	}
	return normalizeProgressPercent(completedEntries * 100 / totalEntries)
}

func parallelArchiveProgressMessage(name string) string {
	return fmt.Sprintf("正在并行解压: %s", filepath.Base(name))
}

func activeArchiveNames(active map[string]bool) []string {
	names := make([]string, 0, len(active))
	for name := range active {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func scaledProgressPercent(start int, end int, current int64, total int64) int {
	if total <= 0 {
		return normalizeProgressPercent(end)
	}
	span := end - start
	value := start + int(float64(span)*float64(current)/float64(total))
	return normalizeProgressPercent(value)
}

func normalizeProgressPercent(percent int) int {
	if percent < 0 {
		return 0
	}
	if percent > 100 {
		return 100
	}
	return percent
}
