package app

import (
	"archive/zip"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"vpk-manager/internal/platform/native"

	"github.com/hymkor/trash-go"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	snapshotSchemaVersion = 1
	snapshotKindFilename  = "filename"
	snapshotKindFull      = "full"
)

var snapshotSidecarExtensions = map[string]bool{
	".jpg":  true,
	".jpeg": true,
	".png":  true,
	".gif":  true,
	".meta": true,
}

// SnapshotAddonListInfo 记录 addonlist.txt 的原始文件和校验信息。
type SnapshotAddonListInfo struct {
	Exists bool   `json:"exists"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

// SnapshotSidecar 记录 VPK 同名图片或 .meta 文件。
type SnapshotSidecar struct {
	Name   string `json:"name"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

// SnapshotItem 是快照中的一个根目录 VPK。
type SnapshotItem struct {
	Name       string            `json:"name"`
	Size       int64             `json:"size"`
	ModifiedAt string            `json:"modifiedAt"`
	SHA256     string            `json:"sha256,omitempty"`
	Sidecars   []SnapshotSidecar `json:"sidecars"`
}

// SnapshotManifest 保存在每个快照目录的 manifest.json 中。
type SnapshotManifest struct {
	SchemaVersion int                   `json:"schemaVersion"`
	ID            string                `json:"id"`
	Name          string                `json:"name"`
	Type          string                `json:"type"`
	CreatedAt     string                `json:"createdAt"`
	AppVersion    string                `json:"appVersion"`
	SourceRoot    string                `json:"sourceRoot"`
	AddonList     SnapshotAddonListInfo `json:"addonList"`
	Items         []SnapshotItem        `json:"items"`
	TotalBytes    int64                 `json:"totalBytes"`
}

// SnapshotSummary 是快照列表使用的轻量信息。
type SnapshotSummary struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Type         string `json:"type"`
	CreatedAt    string `json:"createdAt"`
	SourceRoot   string `json:"sourceRoot"`
	ItemCount    int    `json:"itemCount"`
	TotalBytes   int64  `json:"totalBytes"`
	Directory    string `json:"directory"`
	HasAddonList bool   `json:"hasAddonList"`
	Corrupt      bool   `json:"corrupt"`
	Error        string `json:"error,omitempty"`
}

type snapshotRestoreActionKind string

type snapshotRestoreOperation struct {
	Kind           snapshotRestoreActionKind
	ModName        string
	FileName       string
	CurrentPath    string
	TargetPath     string
	SourcePath     string
	ZipEntry       string
	Size           int64
	CompanionFiles []string
}

type snapshotPendingRestorePlan struct {
	Plan        SnapshotRestorePlan
	Manifest    SnapshotManifest
	SnapshotDir string
	Fingerprint string
	Operations  []snapshotRestoreOperation
}

// GetSnapshotDirectory 返回当前配置的快照目录，不创建目录。
func (a *App) GetSnapshotDirectory() string {
	a.ensureConfigPaths()
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.snapshotDirectoryValueLocked()
}

// SetSnapshotDirectory 验证并保存快照目录。path 为空时恢复默认目录。
func (a *App) SetSnapshotDirectory(path string, migrateExisting bool) error {
	a.snapshotMu.Lock()
	defer a.snapshotMu.Unlock()

	a.ensureConfigPaths()
	oldDir := a.snapshotDirectoryValue()
	newDir, err := a.normalizeSnapshotDirectory(path)
	if err != nil {
		return err
	}

	a.mu.RLock()
	rootDir := a.rootDir
	a.mu.RUnlock()
	if rootDir != "" && pathContains(rootDir, newDir) {
		return fmt.Errorf("快照目录不能位于 addons、disabled 或 workshop 目录中")
	}
	if err := ensureSnapshotDirectoryWritable(newDir); err != nil {
		return err
	}

	if oldDir == newDir {
		return a.persistSnapshotDirectory(newDir)
	}

	if migrateExisting {
		if err := a.migrateSnapshotRoot(oldDir, newDir); err != nil {
			return fmt.Errorf("迁移现有快照失败: %w", err)
		}
	}

	return a.persistSnapshotDirectory(newDir)
}

// OpenSnapshotDirectory 使用系统文件管理器打开当前快照目录。
func (a *App) OpenSnapshotDirectory() error {
	dir, err := a.snapshotDirectoryForExecution()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("创建快照目录失败: %w", err)
	}

	if err := exec.Command("explorer", dir).Start(); err != nil {
		return fmt.Errorf("打开快照目录失败: %w", err)
	}
	return nil
}

// ListSnapshots 返回当前快照目录中的所有快照。
func (a *App) ListSnapshots() ([]SnapshotSummary, error) {
	a.snapshotMu.Lock()
	defer a.snapshotMu.Unlock()

	dir, err := a.snapshotDirectoryForExecution()
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			a.mu.RLock()
			configured := strings.TrimSpace(a.snapshotDirectory)
			a.mu.RUnlock()
			if configured == "" {
				return []SnapshotSummary{}, nil
			}
			return nil, fmt.Errorf("快照目录不可用: %s", dir)
		}
		return nil, fmt.Errorf("读取快照目录失败: %w", err)
	}

	summaries := make([]SnapshotSummary, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() || !isSnapshotID(entry.Name()) {
			continue
		}
		snapshotDir := filepath.Join(dir, entry.Name())
		manifest, readErr := readSnapshotManifest(snapshotDir)
		if readErr != nil {
			summaries = append(summaries, SnapshotSummary{
				ID:        entry.Name(),
				Name:      entry.Name(),
				Directory: snapshotDir,
				Corrupt:   true,
				Error:     readErr.Error(),
			})
			continue
		}

		size, _ := directorySize(snapshotDir)
		summaries = append(summaries, SnapshotSummary{
			ID:           manifest.ID,
			Name:         manifest.Name,
			Type:         manifest.Type,
			CreatedAt:    manifest.CreatedAt,
			SourceRoot:   manifest.SourceRoot,
			ItemCount:    len(manifest.Items),
			TotalBytes:   size,
			Directory:    snapshotDir,
			HasAddonList: manifest.AddonList.Exists,
		})
	}

	sort.SliceStable(summaries, func(i, j int) bool {
		if summaries[i].CreatedAt == summaries[j].CreatedAt {
			return summaries[i].ID > summaries[j].ID
		}
		return summaries[i].CreatedAt > summaries[j].CreatedAt
	})
	return summaries, nil
}

// CreateSnapshot 创建文件名快照或完整备份。
func (a *App) CreateSnapshot(name string, kind string) (SnapshotSummary, error) {
	a.snapshotMu.Lock()
	defer a.snapshotMu.Unlock()

	a.mu.RLock()
	rootDir := a.rootDir
	a.mu.RUnlock()
	if strings.TrimSpace(rootDir) == "" {
		return SnapshotSummary{}, fmt.Errorf("请先选择 addons 目录")
	}

	snapshotDir, err := a.snapshotDirectoryForExecution()
	if err != nil {
		return SnapshotSummary{}, err
	}
	if err := os.MkdirAll(snapshotDir, 0755); err != nil {
		return SnapshotSummary{}, fmt.Errorf("创建快照目录失败: %w", err)
	}

	switch kind {
	case snapshotKindFilename:
		return a.createFilenameSnapshot(rootDir, snapshotDir, name)
	case snapshotKindFull:
		return a.createFullSnapshot(rootDir, snapshotDir, name)
	default:
		return SnapshotSummary{}, fmt.Errorf("未知的快照类型: %s", kind)
	}
}

// RenameSnapshot 修改快照的显示名称，不移动快照文件。
func (a *App) RenameSnapshot(id string, name string) error {
	a.snapshotMu.Lock()
	defer a.snapshotMu.Unlock()

	snapshotDir, err := a.resolveSnapshotDirectory(id)
	if err != nil {
		return err
	}
	manifest, err := readSnapshotManifest(snapshotDir)
	if err != nil {
		return err
	}
	cleaned, err := sanitizeSnapshotName(name)
	if err != nil {
		return err
	}
	manifest.Name = cleaned
	return writeSnapshotManifest(snapshotDir, manifest)
}

// DeleteSnapshot 将快照目录移动到回收站。
func (a *App) DeleteSnapshot(id string) error {
	a.snapshotMu.Lock()
	defer a.snapshotMu.Unlock()

	snapshotDir, err := a.resolveSnapshotDirectory(id)
	if err != nil {
		return err
	}
	if err := trash.Throw(snapshotDir); err != nil {
		return fmt.Errorf("删除快照失败: %w", err)
	}
	return nil
}

func (a *App) createFilenameSnapshot(rootDir string, snapshotDir string, name string) (SnapshotSummary, error) {
	cleaned, err := sanitizeSnapshotName(name)
	if err != nil {
		return SnapshotSummary{}, err
	}
	id, err := newSnapshotID()
	if err != nil {
		return SnapshotSummary{}, err
	}

	items, err := collectSnapshotItems(rootDir, false)
	if err != nil {
		return SnapshotSummary{}, err
	}
	manifest := SnapshotManifest{
		SchemaVersion: snapshotSchemaVersion,
		ID:            id,
		Name:          cleaned,
		Type:          snapshotKindFilename,
		CreatedAt:     time.Now().Format(time.RFC3339Nano),
		AppVersion:    AppVersion,
		SourceRoot:    rootDir,
		Items:         items,
	}
	if err := fillSnapshotAddonListInfo(rootDir, &manifest); err != nil {
		return SnapshotSummary{}, err
	}

	finalDir := filepath.Join(snapshotDir, id)
	tmpDir, err := os.MkdirTemp(snapshotDir, ".creating-")
	if err != nil {
		return SnapshotSummary{}, fmt.Errorf("创建快照临时目录失败: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	if manifest.AddonList.Exists {
		raw, _, err := readAddonListRaw(rootDir)
		if err != nil {
			return SnapshotSummary{}, err
		}
		if err := os.WriteFile(filepath.Join(tmpDir, "addonlist.txt"), raw, 0644); err != nil {
			return SnapshotSummary{}, fmt.Errorf("保存 addonlist.txt 失败: %w", err)
		}
	}
	if err := writeSnapshotManifest(tmpDir, manifest); err != nil {
		return SnapshotSummary{}, err
	}
	if err := os.Rename(tmpDir, finalDir); err != nil {
		return SnapshotSummary{}, fmt.Errorf("完成快照创建失败: %w", err)
	}

	size, _ := directorySize(finalDir)
	return snapshotSummaryFromManifest(manifest, finalDir, size), nil
}

func (a *App) createFullSnapshot(rootDir string, snapshotDir string, name string) (SnapshotSummary, error) {
	cleaned, err := sanitizeSnapshotName(name)
	if err != nil {
		return SnapshotSummary{}, err
	}
	id, err := newSnapshotID()
	if err != nil {
		return SnapshotSummary{}, err
	}

	items, err := collectSnapshotItems(rootDir, true)
	if err != nil {
		return SnapshotSummary{}, err
	}
	manifest := SnapshotManifest{
		SchemaVersion: snapshotSchemaVersion,
		ID:            id,
		Name:          cleaned,
		Type:          snapshotKindFull,
		CreatedAt:     time.Now().Format(time.RFC3339Nano),
		AppVersion:    AppVersion,
		SourceRoot:    rootDir,
		Items:         items,
	}
	if err := fillSnapshotAddonListInfo(rootDir, &manifest); err != nil {
		return SnapshotSummary{}, err
	}

	totalSourceBytes := snapshotSourceBytes(manifest)
	requiredBytes := totalSourceBytes + totalSourceBytes/100 + 1024*1024
	freeBytes, err := native.FreeDiskSpace(snapshotDir)
	if err == nil && freeBytes < uint64(requiredBytes) {
		return SnapshotSummary{}, fmt.Errorf("快照目录空间不足: 需要至少 %s", formatBytes(requiredBytes))
	}

	tmpDir, err := os.MkdirTemp(snapshotDir, ".creating-")
	if err != nil {
		return SnapshotSummary{}, fmt.Errorf("创建快照临时目录失败: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	zipTmpPath := filepath.Join(tmpDir, "payload.zip.tmp")
	zipFile, err := os.Create(zipTmpPath)
	if err != nil {
		return SnapshotSummary{}, fmt.Errorf("创建完整备份失败: %w", err)
	}
	zipWriter := zip.NewWriter(zipFile)

	var addonListRaw []byte
	if manifest.AddonList.Exists {
		addonListRaw, _, err = readAddonListRaw(rootDir)
		if err != nil {
			_ = zipWriter.Close()
			_ = zipFile.Close()
			return SnapshotSummary{}, err
		}
		if _, err := addBytesToZip(zipWriter, "addonlist.txt", addonListRaw, zip.Deflate); err != nil {
			_ = zipWriter.Close()
			_ = zipFile.Close()
			return SnapshotSummary{}, fmt.Errorf("写入 addonlist.txt 失败: %w", err)
		}
		if err := os.WriteFile(filepath.Join(tmpDir, "addonlist.txt"), addonListRaw, 0644); err != nil {
			_ = zipWriter.Close()
			_ = zipFile.Close()
			return SnapshotSummary{}, fmt.Errorf("保存 addonlist.txt 副本失败: %w", err)
		}
	}

	for i := range manifest.Items {
		item := &manifest.Items[i]
		a.emitSnapshotProgress(SnapshotProgressInfo{
			Current:    i + 1,
			Total:      len(manifest.Items),
			Message:    "正在创建完整备份",
			FileName:   item.Name,
			BytesTotal: totalSourceBytes,
		})
		// VPK 虽多为压缩容器，但仍存在未压缩打包的 Mod，统一用 Deflate 以减少快照体积。
		vpkPath := filepath.Join(rootDir, item.Name)
		size, digest, err := addFileToSnapshotZip(zipWriter, vpkPath, "addons/"+item.Name, zip.Deflate)
		if err != nil {
			_ = zipWriter.Close()
			_ = zipFile.Close()
			return SnapshotSummary{}, fmt.Errorf("备份 %s 失败: %w", item.Name, err)
		}
		item.Size = size
		item.SHA256 = digest
		for j := range item.Sidecars {
			sidecar := &item.Sidecars[j]
			sidecarPath := filepath.Join(rootDir, sidecar.Name)
			sidecarSize, sidecarDigest, err := addFileToSnapshotZip(zipWriter, sidecarPath, "addons/"+sidecar.Name, zip.Deflate)
			if err != nil {
				_ = zipWriter.Close()
				_ = zipFile.Close()
				return SnapshotSummary{}, fmt.Errorf("备份 %s 失败: %w", sidecar.Name, err)
			}
			sidecar.Size = sidecarSize
			sidecar.SHA256 = sidecarDigest
		}
	}

	if err := zipWriter.Close(); err != nil {
		_ = zipFile.Close()
		return SnapshotSummary{}, fmt.Errorf("关闭完整备份失败: %w", err)
	}
	if err := zipFile.Close(); err != nil {
		return SnapshotSummary{}, fmt.Errorf("保存完整备份失败: %w", err)
	}
	if err := os.Rename(zipTmpPath, filepath.Join(tmpDir, "payload.zip")); err != nil {
		return SnapshotSummary{}, fmt.Errorf("完成完整备份失败: %w", err)
	}

	manifest.TotalBytes = totalSourceBytes
	if err := writeSnapshotManifest(tmpDir, manifest); err != nil {
		return SnapshotSummary{}, err
	}

	finalDir := filepath.Join(snapshotDir, id)
	if err := os.Rename(tmpDir, finalDir); err != nil {
		return SnapshotSummary{}, fmt.Errorf("完成快照创建失败: %w", err)
	}

	size, _ := directorySize(finalDir)
	return snapshotSummaryFromManifest(manifest, finalDir, size), nil
}

func fillSnapshotAddonListInfo(rootDir string, manifest *SnapshotManifest) error {
	raw, path, err := readAddonListRaw(rootDir)
	if err != nil {
		if errors.Is(err, errAddonListNotFound) {
			manifest.AddonList = SnapshotAddonListInfo{}
			return nil
		}
		return err
	}
	if path == "" {
		return fmt.Errorf("无法定位 addonlist.txt")
	}
	digest := sha256.Sum256(raw)
	manifest.AddonList = SnapshotAddonListInfo{
		Exists: true,
		Size:   int64(len(raw)),
		SHA256: hex.EncodeToString(digest[:]),
	}
	return nil
}

func readAddonListRaw(rootDir string) ([]byte, string, error) {
	path := filepath.Join(filepath.Dir(rootDir), "addonlist.txt")
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, path, errAddonListNotFound
		}
		return nil, path, fmt.Errorf("无法读取 addonlist.txt: %w", err)
	}
	return raw, path, nil
}

func collectSnapshotItems(rootDir string, includeSidecars bool) ([]SnapshotItem, error) {
	entries, err := os.ReadDir(rootDir)
	if err != nil {
		return nil, fmt.Errorf("扫描 addons 根目录失败: %w", err)
	}

	filesByBase := make(map[string][]fs.DirEntry)
	vpkEntries := make([]fs.DirEntry, 0)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if strings.EqualFold(filepath.Ext(name), ".vpk") {
			vpkEntries = append(vpkEntries, entry)
			continue
		}
		if includeSidecars && snapshotSidecarExtensions[strings.ToLower(filepath.Ext(name))] {
			base := strings.TrimSuffix(name, filepath.Ext(name))
			key := strings.ToLower(base)
			filesByBase[key] = append(filesByBase[key], entry)
		}
	}

	sort.SliceStable(vpkEntries, func(i, j int) bool {
		return strings.ToLower(vpkEntries[i].Name()) < strings.ToLower(vpkEntries[j].Name())
	})

	items := make([]SnapshotItem, 0, len(vpkEntries))
	for _, entry := range vpkEntries {
		info, err := entry.Info()
		if err != nil {
			return nil, fmt.Errorf("读取 %s 信息失败: %w", entry.Name(), err)
		}
		item := SnapshotItem{
			Name:       entry.Name(),
			Size:       info.Size(),
			ModifiedAt: info.ModTime().Format(time.RFC3339Nano),
			Sidecars:   []SnapshotSidecar{},
		}
		if includeSidecars {
			base := strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name()))
			sidecars := append([]fs.DirEntry(nil), filesByBase[strings.ToLower(base)]...)
			sort.SliceStable(sidecars, func(i, j int) bool {
				return strings.ToLower(sidecars[i].Name()) < strings.ToLower(sidecars[j].Name())
			})
			for _, sidecarEntry := range sidecars {
				sidecarInfo, err := sidecarEntry.Info()
				if err != nil {
					return nil, fmt.Errorf("读取 %s 信息失败: %w", sidecarEntry.Name(), err)
				}
				item.Sidecars = append(item.Sidecars, SnapshotSidecar{
					Name: sidecarEntry.Name(),
					Size: sidecarInfo.Size(),
				})
			}
		}
		items = append(items, item)
	}
	return items, nil
}

func snapshotSourceBytes(manifest SnapshotManifest) int64 {
	var total int64
	for _, item := range manifest.Items {
		total += item.Size
		for _, sidecar := range item.Sidecars {
			total += sidecar.Size
		}
	}
	total += manifest.AddonList.Size
	return total
}

func addFileToSnapshotZip(zipWriter *zip.Writer, filePath string, zipName string, method uint16) (int64, string, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return 0, "", err
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return 0, "", err
	}
	header, err := zip.FileInfoHeader(info)
	if err != nil {
		return 0, "", err
	}
	header.Name = zipName
	header.Method = method
	writer, err := zipWriter.CreateHeader(header)
	if err != nil {
		return 0, "", err
	}

	hasher := sha256.New()
	written, err := io.Copy(io.MultiWriter(writer, hasher), file)
	if err != nil {
		return 0, "", err
	}
	return written, hex.EncodeToString(hasher.Sum(nil)), nil
}

func addBytesToZip(zipWriter *zip.Writer, zipName string, data []byte, method uint16) (int64, error) {
	header := &zip.FileHeader{Name: zipName, Method: method}
	header.SetModTime(time.Now())
	writer, err := zipWriter.CreateHeader(header)
	if err != nil {
		return 0, err
	}
	n, err := writer.Write(data)
	return int64(n), err
}

func readSnapshotManifest(snapshotDir string) (SnapshotManifest, error) {
	data, err := os.ReadFile(filepath.Join(snapshotDir, "manifest.json"))
	if err != nil {
		return SnapshotManifest{}, fmt.Errorf("读取快照清单失败: %w", err)
	}
	var manifest SnapshotManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return SnapshotManifest{}, fmt.Errorf("解析快照清单失败: %w", err)
	}
	if manifest.SchemaVersion <= 0 || manifest.SchemaVersion > snapshotSchemaVersion {
		return SnapshotManifest{}, fmt.Errorf("不支持的快照版本: %d", manifest.SchemaVersion)
	}
	if manifest.ID == "" || manifest.Name == "" || manifest.Type == "" {
		return SnapshotManifest{}, fmt.Errorf("快照清单不完整")
	}
	if manifest.ID != filepath.Base(snapshotDir) {
		return SnapshotManifest{}, fmt.Errorf("快照 ID 与目录不一致")
	}
	if manifest.Type != snapshotKindFilename && manifest.Type != snapshotKindFull {
		return SnapshotManifest{}, fmt.Errorf("未知的快照类型: %s", manifest.Type)
	}
	if manifest.Items == nil {
		manifest.Items = []SnapshotItem{}
	}
	for i := range manifest.Items {
		if problem := validateSnapshotItemName(manifest.Items[i].Name); problem != "" {
			return SnapshotManifest{}, fmt.Errorf("快照清单无效: %s", problem)
		}
		if manifest.Items[i].Sidecars == nil {
			manifest.Items[i].Sidecars = []SnapshotSidecar{}
		}
		if manifest.Type == snapshotKindFull && manifest.Items[i].SHA256 == "" {
			return SnapshotManifest{}, fmt.Errorf("完整备份缺少 VPK 校验值: %s", manifest.Items[i].Name)
		}
		for _, sidecar := range manifest.Items[i].Sidecars {
			if problem := validateSnapshotSidecarName(sidecar.Name); problem != "" {
				return SnapshotManifest{}, fmt.Errorf("快照清单无效: %s", problem)
			}
			if manifest.Type == snapshotKindFull && sidecar.SHA256 == "" {
				return SnapshotManifest{}, fmt.Errorf("完整备份缺少侧车文件校验值: %s", sidecar.Name)
			}
		}
	}
	if manifest.Type == snapshotKindFull && manifest.AddonList.Exists && manifest.AddonList.SHA256 == "" {
		return SnapshotManifest{}, fmt.Errorf("完整备份缺少 addonlist.txt 校验值")
	}
	return manifest, nil
}

func writeSnapshotManifest(snapshotDir string, manifest SnapshotManifest) error {
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return fmt.Errorf("生成快照清单失败: %w", err)
	}
	path := filepath.Join(snapshotDir, "manifest.json")
	tmpPath := path + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0644); err != nil {
		return fmt.Errorf("写入快照清单失败: %w", err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("保存快照清单失败: %w", err)
	}
	return nil
}

func snapshotSummaryFromManifest(manifest SnapshotManifest, directory string, size int64) SnapshotSummary {
	return SnapshotSummary{
		ID:           manifest.ID,
		Name:         manifest.Name,
		Type:         manifest.Type,
		CreatedAt:    manifest.CreatedAt,
		SourceRoot:   manifest.SourceRoot,
		ItemCount:    len(manifest.Items),
		TotalBytes:   size,
		Directory:    directory,
		HasAddonList: manifest.AddonList.Exists,
	}
}

func (a *App) snapshotDirectoryValue() string {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.snapshotDirectoryValueLocked()
}

func (a *App) snapshotDirectoryValueLocked() string {
	if dir := strings.TrimSpace(a.snapshotDirectory); dir != "" {
		return filepath.Clean(dir)
	}
	if a.configDir == "" {
		return ""
	}
	return filepath.Join(a.configDir, "snapshots")
}

func (a *App) snapshotDirectoryForExecution() (string, error) {
	a.ensureConfigPaths()
	dir := a.snapshotDirectoryValue()
	if dir == "" {
		return "", fmt.Errorf("无法确定快照目录")
	}
	return dir, nil
}

func (a *App) resolveSnapshotDirectory(id string) (string, error) {
	if !isSnapshotID(id) {
		return "", fmt.Errorf("无效的快照 ID")
	}
	rootDir, err := a.snapshotDirectoryForExecution()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(rootDir, id)
	if !pathContains(rootDir, dir) || filepath.Clean(dir) == filepath.Clean(rootDir) {
		return "", fmt.Errorf("无效的快照路径")
	}
	info, err := os.Stat(dir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", fmt.Errorf("快照不存在: %s", id)
		}
		return "", err
	}
	if !info.IsDir() {
		return "", fmt.Errorf("快照路径不是目录: %s", id)
	}
	return dir, nil
}

func (a *App) normalizeSnapshotDirectory(path string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		path = filepath.Join(a.configDir, "snapshots")
	}
	if !filepath.IsAbs(path) {
		return "", fmt.Errorf("快照目录必须是绝对路径")
	}
	path = filepath.Clean(path)
	return path, nil
}

func ensureSnapshotDirectoryWritable(path string) error {
	if err := os.MkdirAll(path, 0755); err != nil {
		return fmt.Errorf("无法创建快照目录: %w", err)
	}
	testPath := filepath.Join(path, ".lytvpk-write-test")
	if err := os.WriteFile(testPath, []byte("test"), 0644); err != nil {
		return fmt.Errorf("快照目录不可写: %w", err)
	}
	_ = os.Remove(testPath)
	return nil
}

func (a *App) persistSnapshotDirectory(dir string) error {
	defaultDir := filepath.Join(a.configDir, "snapshots")
	if filepath.Clean(dir) == filepath.Clean(defaultDir) {
		dir = ""
	}
	a.mu.Lock()
	a.snapshotDirectory = dir
	a.mu.Unlock()
	a.saveConfig()
	return nil
}

func sanitizeSnapshotName(name string) (string, error) {
	cleaned := strings.TrimSpace(name)
	cleaned = strings.Trim(cleaned, ".")
	cleaned = strings.Map(func(r rune) rune {
		if r < 0x20 {
			return -1
		}
		switch r {
		case '\\', '/', ':', '*', '?', '"', '<', '>', '|':
			return '_'
		}
		return r
	}, cleaned)
	cleaned = strings.Join(strings.Fields(cleaned), " ")
	if cleaned == "" {
		return "", fmt.Errorf("快照名称不能为空")
	}
	if utf8.RuneCountInString(cleaned) > 80 {
		return "", fmt.Errorf("快照名称不能超过 80 个字符")
	}
	return cleaned, nil
}

func newSnapshotID() (string, error) {
	var random [4]byte
	if _, err := rand.Read(random[:]); err != nil {
		return "", fmt.Errorf("生成快照 ID 失败: %w", err)
	}
	return fmt.Sprintf("snap_%s_%s", time.Now().Format("20060102_150405"), hex.EncodeToString(random[:])), nil
}

func isSnapshotID(id string) bool {
	if !strings.HasPrefix(id, "snap_") || strings.ContainsAny(id, `\/:*?"<>|`) {
		return false
	}
	return filepath.Base(id) == id && id != "." && id != ".."
}

func pathContains(parent string, child string) bool {
	parent = filepath.Clean(parent)
	child = filepath.Clean(child)
	rel, err := filepath.Rel(parent, child)
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)))
}

func directorySize(dir string) (int64, error) {
	var total int64
	err := filepath.WalkDir(dir, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		total += info.Size()
		return nil
	})
	return total, err
}

func (a *App) migrateSnapshotRoot(oldDir string, newDir string) error {
	if filepath.Clean(oldDir) == filepath.Clean(newDir) {
		return nil
	}
	a.emitSnapshotMigrationProgress(SnapshotProgressInfo{Message: "正在检查可迁移的快照..."})
	entries, err := os.ReadDir(oldDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			a.emitSnapshotMigrationProgress(SnapshotProgressInfo{Message: "没有需要迁移的快照"})
			return nil
		}
		return err
	}
	if err := os.MkdirAll(newDir, 0755); err != nil {
		return err
	}

	type migration struct {
		source string
		final  string
		temp   string
	}
	migrations := make([]migration, 0)
	for _, entry := range entries {
		if !entry.IsDir() || !isSnapshotID(entry.Name()) {
			continue
		}
		final := filepath.Join(newDir, entry.Name())
		if _, err := os.Stat(final); err == nil {
			return fmt.Errorf("目标位置已存在同名快照: %s", entry.Name())
		} else if !errors.Is(err, os.ErrNotExist) {
			return err
		}
		migrations = append(migrations, migration{
			source: filepath.Join(oldDir, entry.Name()),
			final:  final,
			temp:   filepath.Join(newDir, ".migrating-"+entry.Name()),
		})
	}

	var totalBytes int64
	for i := range migrations {
		size, err := directorySize(migrations[i].source)
		if err != nil {
			return fmt.Errorf("统计快照 %s 大小失败: %w", filepath.Base(migrations[i].source), err)
		}
		totalBytes += size
		a.emitSnapshotMigrationProgress(SnapshotProgressInfo{
			Message:  "正在统计迁移数据...",
			FileName: filepath.Base(migrations[i].source),
		})
	}

	if len(migrations) == 0 {
		a.emitSnapshotMigrationProgress(SnapshotProgressInfo{Message: "没有需要迁移的快照"})
		return nil
	}

	created := make([]string, 0, len(migrations))
	cleanup := func() {
		for _, path := range created {
			_ = os.RemoveAll(path)
		}
		for _, item := range migrations {
			_ = os.RemoveAll(item.temp)
		}
	}

	var bytesDone int64
	lastProgressAt := time.Time{}
	for i, item := range migrations {
		fileName := filepath.Base(item.source)
		a.emitSnapshotMigrationProgress(SnapshotProgressInfo{
			Current:    i + 1,
			Total:      len(migrations),
			Message:    fmt.Sprintf("正在迁移快照 %d/%d", i+1, len(migrations)),
			FileName:   fileName,
			BytesDone:  bytesDone,
			BytesTotal: totalBytes,
		})
		reportProgress := func(delta int64) {
			bytesDone += delta
			now := time.Now()
			if !lastProgressAt.IsZero() && now.Sub(lastProgressAt) < 100*time.Millisecond && bytesDone < totalBytes {
				return
			}
			lastProgressAt = now
			a.emitSnapshotMigrationProgress(SnapshotProgressInfo{
				Current:    i + 1,
				Total:      len(migrations),
				Message:    fmt.Sprintf("正在迁移快照 %d/%d", i+1, len(migrations)),
				FileName:   fileName,
				BytesDone:  bytesDone,
				BytesTotal: totalBytes,
			})
		}
		if err := copyDirectory(item.source, item.temp, reportProgress); err != nil {
			cleanup()
			return err
		}
		if err := os.Rename(item.temp, item.final); err != nil {
			cleanup()
			return err
		}
		created = append(created, item.final)
		if _, err := readSnapshotManifest(item.final); err != nil {
			cleanup()
			return fmt.Errorf("校验迁移快照 %s 失败: %w", filepath.Base(item.source), err)
		}
	}

	a.emitSnapshotMigrationProgress(SnapshotProgressInfo{
		Current:    len(migrations),
		Total:      len(migrations),
		Message:    "正在清理旧位置中的快照...",
		BytesDone:  bytesDone,
		BytesTotal: totalBytes,
	})
	for _, item := range migrations {
		if err := os.RemoveAll(item.source); err != nil {
			// 新位置已经校验成功，旧副本清理失败时保留它比把配置回退到
			// 一半迁移状态更安全。
			log.Printf("清理旧快照失败，已保留副本 %s: %v", item.source, err)
		}
	}
	a.emitSnapshotMigrationProgress(SnapshotProgressInfo{
		Current:    len(migrations),
		Total:      len(migrations),
		Message:    "快照迁移完成",
		BytesDone:  bytesDone,
		BytesTotal: totalBytes,
	})
	return nil
}

type progressReader struct {
	reader io.Reader
	onRead func(int64)
}

func (r *progressReader) Read(p []byte) (int, error) {
	n, err := r.reader.Read(p)
	if n > 0 && r.onRead != nil {
		r.onRead(int64(n))
	}
	return n, err
}

func copyDirectory(source string, target string, onProgress func(int64)) error {
	return filepath.WalkDir(source, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		dest := filepath.Join(target, rel)
		if entry.IsDir() {
			return os.MkdirAll(dest, 0755)
		}

		info, err := entry.Info()
		if err != nil {
			return err
		}
		in, err := os.Open(path)
		if err != nil {
			return err
		}

		out, err := os.OpenFile(dest, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, info.Mode().Perm())
		if err != nil {
			_ = in.Close()
			return err
		}
		var reader io.Reader = in
		if onProgress != nil {
			reader = &progressReader{reader: in, onRead: onProgress}
		}
		if _, err := io.Copy(out, reader); err != nil {
			_ = in.Close()
			_ = out.Close()
			return err
		}
		if err := in.Close(); err != nil {
			_ = out.Close()
			return err
		}
		return out.Close()
	})
}

func formatBytes(size int64) string {
	const unit = 1024
	if size < unit {
		return fmt.Sprintf("%d B", size)
	}
	div, exp := int64(unit), 0
	for n := size / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %ciB", float64(size)/float64(div), "KMGTPE"[exp])
}

func (a *App) emitSnapshotProgress(info SnapshotProgressInfo) {
	if a.ctx == nil {
		return
	}
	runtime.EventsEmit(a.ctx, "snapshot_progress", info)
}

func (a *App) emitSnapshotMigrationProgress(info SnapshotProgressInfo) {
	if a.ctx == nil {
		return
	}
	runtime.EventsEmit(a.ctx, "snapshot_migration_progress", info)
}
