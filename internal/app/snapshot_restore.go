package app

import (
	"archive/zip"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"vpk-manager/internal/platform/native"

	"github.com/hymkor/trash-go"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	snapshotOpMoveFromDisabled snapshotRestoreActionKind = "move_from_disabled"
	snapshotOpRestoreFromZip   snapshotRestoreActionKind = "restore_from_zip"
	snapshotOpDisableExtra     snapshotRestoreActionKind = "disable_extra"
	snapshotOpRemoveDuplicate  snapshotRestoreActionKind = "remove_duplicate"
	snapshotOpRestoreAddonList snapshotRestoreActionKind = "restore_addon_list"
)

// SnapshotProgressInfo 用于快照创建、目录迁移和恢复预览的进度展示。
type SnapshotProgressInfo struct {
	Current    int    `json:"current"`
	Total      int    `json:"total"`
	Message    string `json:"message"`
	FileName   string `json:"fileName,omitempty"`
	BytesDone  int64  `json:"bytesDone,omitempty"`
	BytesTotal int64  `json:"bytesTotal,omitempty"`
}

// SnapshotRestoreSummary 是恢复预览的汇总统计。
type SnapshotRestoreSummary struct {
	EnableCount     int  `json:"enableCount"`
	DisableCount    int  `json:"disableCount"`
	OverwriteCount  int  `json:"overwriteCount"`
	AddCount        int  `json:"addCount"`
	SkipCount       int  `json:"skipCount"`
	MissingCount    int  `json:"missingCount"`
	SidecarCount    int  `json:"sidecarCount"`
	AddonListChange bool `json:"addonListChange"`
}

// SnapshotRestoreFile 描述 Mod 内单个文件的恢复变化。
type SnapshotRestoreFile struct {
	Kind        string `json:"kind"`
	FileName    string `json:"fileName"`
	Detail      string `json:"detail"`
	Size        int64  `json:"size,omitempty"`
	Destructive bool   `json:"destructive,omitempty"`
}

// SnapshotRestoreAction 描述恢复预览中的一项变化，以 Mod 为单位：
// VPK 与同名图片、.meta 等配套文件合并为同一个 Mod；addonlist.txt 单独一项。
type SnapshotRestoreAction struct {
	Kind        string                `json:"kind"`
	Kinds       []string              `json:"kinds"`
	ModName     string                `json:"modName"`
	FileName    string                `json:"fileName"`
	Detail      string                `json:"detail"`
	Size        int64                 `json:"size,omitempty"`
	Destructive bool                  `json:"destructive,omitempty"`
	Files       []SnapshotRestoreFile `json:"files"`
}

// snapshotFileChange 是分组前的单文件变化，只在生成恢复计划时使用。
type snapshotFileChange struct {
	Kind        string
	ModName     string
	FileName    string
	Detail      string
	Size        int64
	Destructive bool
}

// SnapshotRestorePlan 是无副作用的恢复预览。
type SnapshotRestorePlan struct {
	ID           string                  `json:"id"`
	SnapshotID   string                  `json:"snapshotId"`
	SnapshotName string                  `json:"snapshotName"`
	SnapshotType string                  `json:"snapshotType"`
	SourceRoot   string                  `json:"sourceRoot"`
	TargetRoot   string                  `json:"targetRoot"`
	GeneratedAt  string                  `json:"generatedAt"`
	CanExecute   bool                    `json:"canExecute"`
	Blockers     []string                `json:"blockers"`
	Warnings     []string                `json:"warnings"`
	Summary      SnapshotRestoreSummary  `json:"summary"`
	Actions      []SnapshotRestoreAction `json:"actions"`
}

// SnapshotRestoreResult 是恢复执行结果。
type SnapshotRestoreResult struct {
	PlanID   string   `json:"planId"`
	Message  string   `json:"message"`
	Warnings []string `json:"warnings"`
}

// PreviewSnapshotRestore 生成恢复预览。该操作只读取文件，不修改 addons 或
// addonlist.txt。
func (a *App) PreviewSnapshotRestore(id string) (SnapshotRestorePlan, error) {
	a.snapshotMu.Lock()
	defer a.snapshotMu.Unlock()

	snapshotDir, err := a.resolveSnapshotDirectory(id)
	if err != nil {
		return SnapshotRestorePlan{}, err
	}
	manifest, err := readSnapshotManifest(snapshotDir)
	if err != nil {
		return SnapshotRestorePlan{}, err
	}

	a.mu.RLock()
	rootDir := a.rootDir
	a.mu.RUnlock()
	if strings.TrimSpace(rootDir) == "" {
		return SnapshotRestorePlan{}, fmt.Errorf("请先选择 addons 目录")
	}

	plan := SnapshotRestorePlan{
		ID:           newRestorePlanID(),
		SnapshotID:   manifest.ID,
		SnapshotName: manifest.Name,
		SnapshotType: manifest.Type,
		SourceRoot:   manifest.SourceRoot,
		TargetRoot:   rootDir,
		GeneratedAt:  time.Now().Format(time.RFC3339Nano),
		CanExecute:   true,
		Blockers:     []string{},
		Warnings:     []string{},
		Actions:      []SnapshotRestoreAction{},
	}

	if filepath.Clean(manifest.SourceRoot) != filepath.Clean(rootDir) {
		plan.Warnings = append(plan.Warnings, "快照来自其他 addons 目录，恢复将按当前目录名称匹配文件")
	}
	if a.hasActiveProblemModScanSession() {
		plan.Blockers = append(plan.Blockers, "问题 Mod 查找正在进行，请先退出查找模式")
	}
	running, processErr := native.IsProcessRunning("left4dead2.exe")
	if processErr != nil {
		plan.Blockers = append(plan.Blockers, "无法确认 Left 4 Dead 2 是否正在运行: "+processErr.Error())
	} else if running {
		plan.Blockers = append(plan.Blockers, "Left 4 Dead 2 正在运行，请关闭游戏后再恢复")
	}

	zipReader, zipFiles, err := openSnapshotPayload(snapshotDir, manifest)
	if err != nil {
		plan.Blockers = append(plan.Blockers, err.Error())
		plan.CanExecute = false
		return plan, nil
	}
	if zipReader != nil {
		defer zipReader.Close()
	}

	operations, actions, summary, warnings, blockers, err := a.buildSnapshotRestorePlan(
		rootDir,
		snapshotDir,
		manifest,
		zipFiles,
	)
	if err != nil {
		return SnapshotRestorePlan{}, err
	}
	plan.Warnings = append(plan.Warnings, warnings...)
	plan.Blockers = append(plan.Blockers, blockers...)
	plan.Summary = summary
	plan.Actions = actions
	if len(plan.Blockers) > 0 {
		plan.CanExecute = false
	}

	fingerprint, err := computeSnapshotRestoreFingerprint(rootDir)
	if err != nil {
		return SnapshotRestorePlan{}, err
	}
	a.pendingRestorePlan = &snapshotPendingRestorePlan{
		Plan:        plan,
		Manifest:    manifest,
		SnapshotDir: snapshotDir,
		Fingerprint: fingerprint,
		Operations:  operations,
	}
	return plan, nil
}

// ExecuteSnapshotRestore 执行上一次预览生成的计划。执行前会重新检查文件状态，
// 如果预览与当前状态不一致则拒绝执行。
func (a *App) ExecuteSnapshotRestore(planID string) (SnapshotRestoreResult, error) {
	a.snapshotMu.Lock()
	defer a.snapshotMu.Unlock()

	pending := a.pendingRestorePlan
	a.pendingRestorePlan = nil
	if pending == nil || pending.Plan.ID != planID {
		return SnapshotRestoreResult{}, fmt.Errorf("恢复计划不存在或已过期，请重新预览")
	}
	if !pending.Plan.CanExecute {
		return SnapshotRestoreResult{}, fmt.Errorf("恢复计划存在阻塞项，无法执行")
	}

	a.mu.Lock()
	result := SnapshotRestoreResult{
		PlanID:   planID,
		Warnings: []string{},
	}
	rootDir := a.rootDir
	if strings.TrimSpace(rootDir) == "" {
		a.mu.Unlock()
		return SnapshotRestoreResult{}, fmt.Errorf("请先选择 addons 目录")
	}
	if err := validateSnapshotRestoreEnvironment(a, pending.SnapshotDir, pending.Manifest, rootDir); err != nil {
		a.mu.Unlock()
		return SnapshotRestoreResult{}, err
	}
	fingerprint, err := computeSnapshotRestoreFingerprint(rootDir)
	if err != nil {
		a.mu.Unlock()
		return SnapshotRestoreResult{}, err
	}
	if fingerprint != pending.Fingerprint {
		a.mu.Unlock()
		return SnapshotRestoreResult{}, fmt.Errorf("预览后文件状态发生变化，请重新生成恢复预览")
	}
	if err := executeSnapshotRestorePlan(a, pending, &result); err != nil {
		a.mu.Unlock()
		return result, err
	}
	a.mu.Unlock()
	result.Message = fmt.Sprintf(
		"恢复完成：启用 %d，禁用 %d，新增 %d，覆盖 %d，跳过 %d",
		pending.Plan.Summary.EnableCount,
		pending.Plan.Summary.DisableCount,
		pending.Plan.Summary.AddCount,
		pending.Plan.Summary.OverwriteCount,
		pending.Plan.Summary.SkipCount,
	)

	a.refreshSnapshotFilesAfterRestore()
	return result, nil
}

func (a *App) buildSnapshotRestorePlan(
	rootDir string,
	snapshotDir string,
	manifest SnapshotManifest,
	zipFiles map[string]*zip.File,
) ([]snapshotRestoreOperation, []SnapshotRestoreAction, SnapshotRestoreSummary, []string, []string, error) {
	summary := SnapshotRestoreSummary{}
	operations := make([]snapshotRestoreOperation, 0)
	changes := make([]snapshotFileChange, 0)
	warnings := []string{}
	blockers := []string{}

	rootIndex, rootErr := indexSnapshotDirectory(rootDir)
	if rootErr != nil {
		return nil, nil, summary, nil, nil, rootErr
	}
	disabledDir := filepath.Join(rootDir, "disabled")
	disabledIndex, err := indexSnapshotDirectory(disabledDir)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, nil, summary, nil, nil, err
	}

	desired := make(map[string]SnapshotItem, len(manifest.Items))
	for _, item := range manifest.Items {
		key := strings.ToLower(item.Name)
		if _, exists := desired[key]; exists {
			blockers = append(blockers, "快照中存在重复 VPK 名称: "+item.Name)
			continue
		}
		desired[key] = item
	}

	for index, item := range manifest.Items {
		a.emitSnapshotRestoreProgress(SnapshotProgressInfo{
			Current:  index + 1,
			Total:    len(manifest.Items),
			Message:  "正在检查快照文件",
			FileName: item.Name,
		})
		if blocker := validateSnapshotItemName(item.Name); blocker != "" {
			blockers = append(blockers, blocker)
			continue
		}
		operations, changes, summary, warnings, blockers = a.planSnapshotItem(
			rootDir,
			disabledDir,
			snapshotDir,
			manifest,
			item,
			index,
			rootIndex,
			disabledIndex,
			zipFiles,
			operations,
			changes,
			summary,
			warnings,
			blockers,
		)
	}

	rootNames := make([]string, 0, len(rootIndex))
	for key := range rootIndex {
		if strings.EqualFold(filepath.Ext(key), ".vpk") {
			rootNames = append(rootNames, key)
		}
	}
	sort.Strings(rootNames)
	for _, key := range rootNames {
		if _, expected := desired[key]; expected {
			continue
		}
		rootPath := rootIndex[key]
		base := strings.TrimSuffix(filepath.Base(rootPath), filepath.Ext(rootPath))
		extraFiles := []string{rootPath}
		for _, name := range sidecarNamesForBase(rootDir, base) {
			extraFiles = append(extraFiles, filepath.Join(rootDir, name))
		}
		for _, sourcePath := range extraFiles {
			name := filepath.Base(sourcePath)
			targetPath := filepath.Join(disabledDir, name)
			if existing, ok := disabledIndex[strings.ToLower(name)]; ok {
				same, compareErr := filesHaveSameContent(sourcePath, existing)
				if compareErr != nil {
					blockers = append(blockers, fmt.Sprintf("无法比较 disabled 中的同名文件 %s: %v", name, compareErr))
					continue
				}
				if !same {
					blockers = append(blockers, fmt.Sprintf("disabled 中已存在不同内容的同名文件: %s", name))
					continue
				}
				operations = append(operations, snapshotRestoreOperation{
					Kind:        snapshotOpRemoveDuplicate,
					ModName:     filepath.Base(rootPath),
					FileName:    name,
					CurrentPath: sourcePath,
					Size:        fileSizeOrZero(sourcePath),
				})
				changes = append(changes, snapshotFileChange{
					Kind:        "cleanup",
					ModName:     filepath.Base(rootPath),
					FileName:    name,
					Detail:      "根目录副本与 disabled 中内容相同，将清理根目录副本",
					Size:        fileSizeOrZero(sourcePath),
					Destructive: true,
				})
				summary.DisableCount++
				continue
			}

			operations = append(operations, snapshotRestoreOperation{
				Kind:        snapshotOpDisableExtra,
				ModName:     filepath.Base(rootPath),
				FileName:    name,
				CurrentPath: sourcePath,
				TargetPath:  targetPath,
				Size:        fileSizeOrZero(sourcePath),
			})
			changes = append(changes, snapshotFileChange{
				Kind:     "disable",
				ModName:  filepath.Base(rootPath),
				FileName: name,
				Detail:   "不在快照中，将移动到 disabled",
				Size:     fileSizeOrZero(sourcePath),
			})
			summary.DisableCount++
		}
	}

	for _, item := range manifest.Items {
		if manifest.Type != snapshotKindFull {
			continue
		}
		expectedSidecars := make(map[string]bool, len(item.Sidecars))
		for _, sidecar := range item.Sidecars {
			expectedSidecars[strings.ToLower(sidecar.Name)] = true
		}
		base := strings.TrimSuffix(item.Name, filepath.Ext(item.Name))
		for _, name := range sidecarNamesForBase(rootDir, base) {
			if expectedSidecars[strings.ToLower(name)] {
				continue
			}
			sourcePath := filepath.Join(rootDir, name)
			targetPath := filepath.Join(disabledDir, name)
			if existing, ok := disabledIndex[strings.ToLower(name)]; ok {
				same, compareErr := filesHaveSameContent(sourcePath, existing)
				if compareErr != nil {
					blockers = append(blockers, fmt.Sprintf("无法比较 disabled 中的同名侧车文件 %s: %v", name, compareErr))
					continue
				}
				if !same {
					blockers = append(blockers, fmt.Sprintf("disabled 中已存在不同内容的同名侧车文件: %s", name))
					continue
				}
				operations = append(operations, snapshotRestoreOperation{
					Kind:        snapshotOpRemoveDuplicate,
					ModName:     item.Name,
					FileName:    name,
					CurrentPath: sourcePath,
					Size:        fileSizeOrZero(sourcePath),
				})
				changes = append(changes, snapshotFileChange{
					Kind:        "cleanup",
					ModName:     item.Name,
					FileName:    name,
					Detail:      "快照中不包含该侧车文件，根目录副本将清理",
					Size:        fileSizeOrZero(sourcePath),
					Destructive: true,
				})
				summary.DisableCount++
				continue
			}
			operations = append(operations, snapshotRestoreOperation{
				Kind:        snapshotOpDisableExtra,
				ModName:     item.Name,
				FileName:    name,
				CurrentPath: sourcePath,
				TargetPath:  targetPath,
				Size:        fileSizeOrZero(sourcePath),
			})
			changes = append(changes, snapshotFileChange{
				Kind:     "disable",
				ModName:  item.Name,
				FileName: name,
				Detail:   "快照中不包含该侧车文件，将移动到 disabled",
				Size:     fileSizeOrZero(sourcePath),
			})
			summary.DisableCount++
		}
	}

	addonListPath := filepath.Join(filepath.Dir(rootDir), "addonlist.txt")
	if manifest.AddonList.Exists {
		sourcePath := filepath.Join(snapshotDir, "addonlist.txt")
		source, readErr := os.ReadFile(sourcePath)
		if readErr != nil {
			blockers = append(blockers, "快照中的 addonlist.txt 缺失或无法读取")
		} else {
			digest := sha256.Sum256(source)
			if manifest.AddonList.SHA256 != "" && hex.EncodeToString(digest[:]) != manifest.AddonList.SHA256 {
				blockers = append(blockers, "快照中的 addonlist.txt 校验失败")
			} else {
				current, currentErr := os.ReadFile(addonListPath)
				if currentErr == nil && string(current) == string(source) {
					changes = append(changes, snapshotFileChange{
						Kind:     "skip",
						FileName: "addonlist.txt",
						Detail:   "当前 addonlist.txt 与快照相同",
					})
					summary.SkipCount++
				} else if currentErr != nil && !errors.Is(currentErr, os.ErrNotExist) {
					blockers = append(blockers, "无法读取当前 addonlist.txt: "+currentErr.Error())
				} else {
					operations = append(operations, snapshotRestoreOperation{
						Kind:        snapshotOpRestoreAddonList,
						FileName:    "addonlist.txt",
						CurrentPath: addonListPath,
						TargetPath:  addonListPath,
						SourcePath:  sourcePath,
						Size:        int64(len(source)),
					})
					changes = append(changes, snapshotFileChange{
						Kind:        "addonlist",
						FileName:    "addonlist.txt",
						Detail:      "恢复快照中的加载顺序和启用状态",
						Size:        int64(len(source)),
						Destructive: true,
					})
					summary.AddonListChange = true
				}
			}
		}
	} else {
		warnings = append(warnings, "快照创建时没有 addonlist.txt，本次恢复不会修改当前文件")
	}

	for _, extra := range []string{filepath.Join(rootDir, "workshop")} {
		if count := countVPKs(extra); count > 0 {
			warnings = append(warnings, fmt.Sprintf("workshop 目录中仍有 %d 个 VPK，不在快照范围内", count))
		}
	}

	return operations, groupSnapshotFileChanges(changes), summary, warnings, blockers, nil
}

func (a *App) planSnapshotItem(
	rootDir string,
	disabledDir string,
	snapshotDir string,
	manifest SnapshotManifest,
	item SnapshotItem,
	itemIndex int,
	rootIndex map[string]string,
	disabledIndex map[string]string,
	zipFiles map[string]*zip.File,
	operations []snapshotRestoreOperation,
	changes []snapshotFileChange,
	summary SnapshotRestoreSummary,
	warnings []string,
	blockers []string,
) ([]snapshotRestoreOperation, []snapshotFileChange, SnapshotRestoreSummary, []string, []string) {
	if blocker := validateSnapshotItemName(item.Name); blocker != "" {
		return operations, changes, summary, warnings, append(blockers, blocker)
	}

	rootPath := filepath.Join(rootDir, item.Name)
	disabledPath := filepath.Join(disabledDir, item.Name)
	key := strings.ToLower(item.Name)

	if manifest.Type == snapshotKindFull {
		zipEntry := "addons/" + item.Name
		if _, ok := zipFiles[zipEntry]; !ok {
			blockers = append(blockers, fmt.Sprintf("完整备份中缺少文件: %s", item.Name))
			return operations, changes, summary, warnings, blockers
		}
		operations, changes, summary, warnings, blockers = planFullSnapshotFile(
			item.Name, item.Name, item.Size, item.SHA256, rootPath, disabledPath, zipEntry,
			false, operations, changes, summary, warnings, blockers,
		)
		for _, sidecar := range item.Sidecars {
			sidecarRoot := filepath.Join(rootDir, sidecar.Name)
			sidecarDisabled := filepath.Join(disabledDir, sidecar.Name)
			sidecarEntry := "addons/" + sidecar.Name
			if _, ok := zipFiles[sidecarEntry]; !ok {
				blockers = append(blockers, fmt.Sprintf("完整备份中缺少侧车文件: %s", sidecar.Name))
				continue
			}
			operations, changes, summary, warnings, blockers = planFullSnapshotFile(
				item.Name, sidecar.Name, sidecar.Size, sidecar.SHA256, sidecarRoot, sidecarDisabled,
				sidecarEntry, true, operations, changes, summary, warnings, blockers,
			)
		}
		return operations, changes, summary, warnings, blockers
	}

	// 文件名快照只记录根目录 VPK。根目录已经有同名文件时视为已满足状态。
	if _, exists := rootIndex[key]; exists {
		changes = append(changes, snapshotFileChange{
			Kind:     "skip",
			ModName:  item.Name,
			FileName: item.Name,
			Detail:   "根目录已存在同名文件，无需操作",
		})
		summary.SkipCount++
		return operations, changes, summary, warnings, blockers
	}
	if _, exists := disabledIndex[key]; exists {
		companions := sidecarNamesForBase(disabledDir, strings.TrimSuffix(item.Name, filepath.Ext(item.Name)))
		operations = append(operations, snapshotRestoreOperation{
			Kind:           snapshotOpMoveFromDisabled,
			ModName:        item.Name,
			FileName:       item.Name,
			CurrentPath:    disabledPath,
			TargetPath:     rootPath,
			Size:           fileSizeOrZero(disabledPath),
			CompanionFiles: companions,
		})
		changes = append(changes, snapshotFileChange{
			Kind:     "enable",
			ModName:  item.Name,
			FileName: item.Name,
			Detail:   "从 disabled 恢复到根目录",
			Size:     fileSizeOrZero(disabledPath),
		})
		summary.EnableCount++
		for _, companion := range companions {
			summary.SidecarCount++
			changes = append(changes, snapshotFileChange{
				Kind:     "enable",
				ModName:  item.Name,
				FileName: companion,
				Detail:   "同步恢复文件",
			})
		}
		return operations, changes, summary, warnings, blockers
	}

	changes = append(changes, snapshotFileChange{
		Kind:     "missing",
		ModName:  item.Name,
		FileName: item.Name,
		Detail:   "根目录和 disabled 中均未找到文件，无法恢复",
	})
	summary.MissingCount++
	return operations, changes, summary, warnings, blockers
}

func planFullSnapshotFile(
	modName string,
	fileName string,
	expectedSize int64,
	expectedSHA string,
	rootPath string,
	disabledPath string,
	zipEntry string,
	isSidecar bool,
	operations []snapshotRestoreOperation,
	changes []snapshotFileChange,
	summary SnapshotRestoreSummary,
	warnings []string,
	blockers []string,
) ([]snapshotRestoreOperation, []snapshotFileChange, SnapshotRestoreSummary, []string, []string) {
	if _, err := os.Stat(rootPath); err == nil {
		same, err := snapshotFileMatches(rootPath, expectedSize, expectedSHA)
		if err != nil {
			blockers = append(blockers, fmt.Sprintf("无法校验 %s: %v", fileName, err))
			return operations, changes, summary, warnings, blockers
		}
		if same {
			changes = append(changes, snapshotFileChange{
				Kind:     "skip",
				ModName:  modName,
				FileName: fileName,
				Detail:   "当前文件与快照内容相同，跳过写入",
				Size:     expectedSize,
			})
			summary.SkipCount++
			return operations, changes, summary, warnings, blockers
		}
		operations = append(operations, snapshotRestoreOperation{
			Kind:        snapshotOpRestoreFromZip,
			ModName:     modName,
			FileName:    fileName,
			CurrentPath: rootPath,
			TargetPath:  rootPath,
			ZipEntry:    zipEntry,
			Size:        expectedSize,
		})
		changes = append(changes, snapshotFileChange{
			Kind:        "overwrite",
			ModName:     modName,
			FileName:    fileName,
			Detail:      "当前文件与快照不同，将覆盖为快照版本",
			Size:        expectedSize,
			Destructive: true,
		})
		summary.OverwriteCount++
		if isSidecar {
			summary.SidecarCount++
		}
		return operations, changes, summary, warnings, blockers
	} else if !errors.Is(err, os.ErrNotExist) {
		blockers = append(blockers, fmt.Sprintf("无法读取 %s: %v", fileName, err))
		return operations, changes, summary, warnings, blockers
	}

	if _, err := os.Stat(disabledPath); err == nil {
		same, err := snapshotFileMatches(disabledPath, expectedSize, expectedSHA)
		if err != nil {
			blockers = append(blockers, fmt.Sprintf("无法校验 disabled 中的 %s: %v", fileName, err))
			return operations, changes, summary, warnings, blockers
		}
		if same {
			operations = append(operations, snapshotRestoreOperation{
				Kind:        snapshotOpMoveFromDisabled,
				ModName:     modName,
				FileName:    fileName,
				CurrentPath: disabledPath,
				TargetPath:  rootPath,
				Size:        expectedSize,
			})
			changes = append(changes, snapshotFileChange{
				Kind:     "enable",
				ModName:  modName,
				FileName: fileName,
				Detail:   "disabled 中的文件与快照相同，将移动到根目录",
				Size:     expectedSize,
			})
			summary.EnableCount++
			if isSidecar {
				summary.SidecarCount++
			}
			return operations, changes, summary, warnings, blockers
		}
		operations = append(operations, snapshotRestoreOperation{
			Kind:        snapshotOpRestoreFromZip,
			ModName:     modName,
			FileName:    fileName,
			CurrentPath: disabledPath,
			TargetPath:  rootPath,
			ZipEntry:    zipEntry,
			Size:        expectedSize,
		})
		changes = append(changes, snapshotFileChange{
			Kind:        "overwrite",
			ModName:     modName,
			FileName:    fileName,
			Detail:      "disabled 中的文件与快照不同，将替换为快照版本",
			Size:        expectedSize,
			Destructive: true,
		})
		summary.OverwriteCount++
		if isSidecar {
			summary.SidecarCount++
		}
		return operations, changes, summary, warnings, blockers
	} else if !errors.Is(err, os.ErrNotExist) {
		blockers = append(blockers, fmt.Sprintf("无法读取 disabled 中的 %s: %v", fileName, err))
		return operations, changes, summary, warnings, blockers
	}

	operations = append(operations, snapshotRestoreOperation{
		Kind:       snapshotOpRestoreFromZip,
		ModName:    modName,
		FileName:   fileName,
		TargetPath: rootPath,
		ZipEntry:   zipEntry,
		Size:       expectedSize,
	})
	changes = append(changes, snapshotFileChange{
		Kind:     "add",
		ModName:  modName,
		FileName: fileName,
		Detail:   "将从完整备份恢复到根目录",
		Size:     expectedSize,
	})
	summary.AddCount++
	if isSidecar {
		summary.SidecarCount++
	}
	return operations, changes, summary, warnings, blockers
}

// snapshotRestoreKindPriority 决定 Mod 合并后用于标记整体状态的动作类型，
// 数值越小越优先展示。
var snapshotRestoreKindPriority = map[string]int{
	"missing":   0,
	"overwrite": 1,
	"cleanup":   2,
	"disable":   3,
	"add":       4,
	"enable":    5,
	"skip":      6,
	"addonlist": 7,
}

// groupSnapshotFileChanges 把单文件变化按 Mod 合并：VPK 与同名图片、.meta
// 等配套文件属于同一个 Mod，addonlist.txt 单独成为一项。
func groupSnapshotFileChanges(changes []snapshotFileChange) []SnapshotRestoreAction {
	order := make([]string, 0, len(changes))
	groups := make(map[string]*SnapshotRestoreAction, len(changes))

	for _, change := range changes {
		key := strings.ToLower(change.ModName)
		group, exists := groups[key]
		if !exists {
			group = &SnapshotRestoreAction{
				ModName:  change.ModName,
				FileName: change.FileName,
				Kinds:    make([]string, 0, 1),
				Files:    make([]SnapshotRestoreFile, 0, 1),
			}
			groups[key] = group
			order = append(order, key)
		}

		group.Files = append(group.Files, SnapshotRestoreFile{
			Kind:        change.Kind,
			FileName:    change.FileName,
			Detail:      change.Detail,
			Size:        change.Size,
			Destructive: change.Destructive,
		})
		if !containsString(group.Kinds, change.Kind) {
			group.Kinds = append(group.Kinds, change.Kind)
		}
		if rank, ok := snapshotRestoreKindPriority[change.Kind]; ok {
			if current, hasCurrent := snapshotRestoreKindPriority[group.Kind]; !hasCurrent || rank < current {
				group.Kind = change.Kind
			}
		}
		group.Size += change.Size
		group.Destructive = group.Destructive || change.Destructive
	}

	result := make([]SnapshotRestoreAction, 0, len(order))
	for _, key := range order {
		group := groups[key]
		if group.ModName == "" {
			group.FileName = group.Files[0].FileName
		}
		if len(group.Files) == 1 {
			// 单文件 Mod 直接沿用文件说明，界面无需再嵌套一层。
			group.Detail = group.Files[0].Detail
		}
		result = append(result, *group)
	}
	return result
}

func openSnapshotPayload(snapshotDir string, manifest SnapshotManifest) (*zip.ReadCloser, map[string]*zip.File, error) {
	if manifest.Type != snapshotKindFull {
		return nil, map[string]*zip.File{}, nil
	}
	reader, err := zip.OpenReader(filepath.Join(snapshotDir, "payload.zip"))
	if err != nil {
		return nil, nil, fmt.Errorf("无法打开完整备份: %w", err)
	}
	files := make(map[string]*zip.File, len(reader.File))
	for _, file := range reader.File {
		files[filepath.ToSlash(file.Name)] = file
	}
	return reader, files, nil
}

func validateSnapshotRestoreEnvironment(a *App, snapshotDir string, manifest SnapshotManifest, rootDir string) error {
	if strings.TrimSpace(rootDir) == "" {
		return fmt.Errorf("请先选择 addons 目录")
	}
	if a.hasActiveProblemModScanSession() {
		return fmt.Errorf("问题 Mod 查找正在进行，请先退出查找模式")
	}
	running, err := native.IsProcessRunning("left4dead2.exe")
	if err != nil {
		return fmt.Errorf("无法确认 Left 4 Dead 2 是否正在运行: %w", err)
	}
	if running {
		return fmt.Errorf("Left 4 Dead 2 正在运行，请关闭游戏后再恢复")
	}
	if manifest.Type == snapshotKindFull {
		if _, err := os.Stat(filepath.Join(snapshotDir, "payload.zip")); err != nil {
			return fmt.Errorf("完整备份文件不可用: %w", err)
		}
	}
	return nil
}

func executeSnapshotRestorePlan(a *App, pending *snapshotPendingRestorePlan, result *SnapshotRestoreResult) error {
	rootDir := a.rootDir
	rollbackRoot := filepath.Join(rootDir, ".snapshot-rollback")
	rollbackDir := filepath.Join(rollbackRoot, pending.Plan.ID)
	if err := os.MkdirAll(rollbackDir, 0755); err != nil {
		return fmt.Errorf("创建回滚目录失败: %w", err)
	}

	journal := &snapshotRestoreJournal{}
	var zipReader *zip.ReadCloser
	var err error
	if pending.Manifest.Type == snapshotKindFull {
		zipReader, err = zip.OpenReader(filepath.Join(pending.SnapshotDir, "payload.zip"))
		if err != nil {
			_ = os.RemoveAll(rollbackDir)
			_ = os.Remove(rollbackRoot)
			return fmt.Errorf("打开完整备份失败: %w", err)
		}
		defer zipReader.Close()
	}

	zipFiles := map[string]*zip.File{}
	if zipReader != nil {
		for _, file := range zipReader.File {
			zipFiles[filepath.ToSlash(file.Name)] = file
		}
	}

	for _, operation := range pending.Operations {
		if err := executeSnapshotRestoreOperation(operation, rollbackDir, zipFiles, journal); err != nil {
			rollbackErr := journal.rollback()
			_ = os.RemoveAll(rollbackDir)
			_ = os.Remove(rollbackRoot)
			if rollbackErr != nil {
				return fmt.Errorf("恢复失败: %v；回滚也失败: %w", err, rollbackErr)
			}
			return fmt.Errorf("恢复失败，已回滚: %w", err)
		}
	}

	if err := trash.Throw(rollbackDir); err != nil {
		result.Warnings = append(result.Warnings, "恢复成功，但覆盖文件的回滚目录未能移入回收站")
	}
	_ = os.Remove(rollbackRoot)
	return nil
}

type snapshotRestoreJournal struct {
	undos []func() error
}

func (j *snapshotRestoreJournal) add(undo func() error) {
	j.undos = append(j.undos, undo)
}

func (j *snapshotRestoreJournal) rollback() error {
	var errs []string
	for i := len(j.undos) - 1; i >= 0; i-- {
		if err := j.undos[i](); err != nil {
			errs = append(errs, err.Error())
		}
	}
	if len(errs) > 0 {
		return errors.New(strings.Join(errs, "; "))
	}
	return nil
}

func executeSnapshotRestoreOperation(
	operation snapshotRestoreOperation,
	rollbackDir string,
	zipFiles map[string]*zip.File,
	journal *snapshotRestoreJournal,
) error {
	switch operation.Kind {
	case snapshotOpMoveFromDisabled:
		return moveRestoreFile(operation.CurrentPath, operation.TargetPath, journal)
	case snapshotOpDisableExtra:
		return moveRestoreFile(operation.CurrentPath, operation.TargetPath, journal)
	case snapshotOpRemoveDuplicate:
		_, err := moveFileToRollback(operation.CurrentPath, rollbackDir, journal, "duplicate")
		return err
	case snapshotOpRestoreFromZip:
		if operation.CurrentPath != "" {
			if _, err := moveFileToRollback(operation.CurrentPath, rollbackDir, journal, "sources"); err != nil {
				return err
			}
		}
		entry, ok := zipFiles[operation.ZipEntry]
		if !ok {
			return fmt.Errorf("完整备份中缺少 %s", operation.ZipEntry)
		}
		return extractSnapshotZipEntry(entry, operation.TargetPath, journal)
	case snapshotOpRestoreAddonList:
		if _, err := os.Stat(operation.CurrentPath); err == nil {
			if _, err := moveFileToRollback(operation.CurrentPath, rollbackDir, journal, "addonlist"); err != nil {
				return err
			}
		} else if !errors.Is(err, os.ErrNotExist) {
			return err
		}
		data, err := os.ReadFile(operation.SourcePath)
		if err != nil {
			return err
		}
		if err := os.WriteFile(operation.TargetPath, data, 0644); err != nil {
			return err
		}
		target := operation.TargetPath
		journal.add(func() error { return os.Remove(target) })
		return nil
	default:
		return fmt.Errorf("未知的恢复操作: %s", operation.Kind)
	}
}

func moveRestoreFile(source string, target string, journal *snapshotRestoreJournal) error {
	if source == "" || target == "" {
		return fmt.Errorf("恢复操作缺少源路径或目标路径")
	}
	if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
		return err
	}
	if err := os.Rename(source, target); err != nil {
		return err
	}
	journal.add(func() error {
		if err := os.MkdirAll(filepath.Dir(source), 0755); err != nil {
			return err
		}
		return os.Rename(target, source)
	})
	return nil
}

func moveFileToRollback(source string, rollbackDir string, journal *snapshotRestoreJournal, category string) (string, error) {
	if source == "" {
		return "", nil
	}
	if _, err := os.Stat(source); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", nil
		}
		return "", err
	}
	dest := filepath.Join(rollbackDir, category, filepath.Base(source))
	if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
		return "", err
	}
	if err := os.Rename(source, dest); err != nil {
		return "", err
	}
	journal.add(func() error {
		if err := os.MkdirAll(filepath.Dir(source), 0755); err != nil {
			return err
		}
		return os.Rename(dest, source)
	})
	return dest, nil
}

func extractSnapshotZipEntry(entry *zip.File, target string, journal *snapshotRestoreJournal) error {
	if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
		return err
	}
	targetTmp := target + ".restore-tmp"
	if err := writeZipEntryToFile(entry, targetTmp); err != nil {
		_ = os.Remove(targetTmp)
		return err
	}
	if err := os.Rename(targetTmp, target); err != nil {
		_ = os.Remove(targetTmp)
		return err
	}
	journal.add(func() error { return os.Remove(target) })
	return nil
}

func writeZipEntryToFile(entry *zip.File, path string) error {
	reader, err := entry.Open()
	if err != nil {
		return err
	}
	defer reader.Close()
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()
	_, err = io.Copy(file, reader)
	return err
}

func computeSnapshotRestoreFingerprint(rootDir string) (string, error) {
	type item struct {
		Section string
		Name    string
		Size    int64
		ModTime string
	}
	items := make([]item, 0)
	collect := func(section string, dir string) error {
		entries, err := os.ReadDir(dir)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return nil
			}
			return err
		}
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			info, err := entry.Info()
			if err != nil {
				return err
			}
			items = append(items, item{
				Section: section,
				Name:    entry.Name(),
				Size:    info.Size(),
				ModTime: info.ModTime().Format(time.RFC3339Nano),
			})
		}
		return nil
	}

	if err := collect("root", rootDir); err != nil {
		return "", err
	}
	if err := collect("disabled", filepath.Join(rootDir, "disabled")); err != nil {
		return "", err
	}
	addonList := filepath.Join(filepath.Dir(rootDir), "addonlist.txt")
	if info, err := os.Stat(addonList); err == nil {
		data, readErr := os.ReadFile(addonList)
		if readErr != nil {
			return "", readErr
		}
		digest := sha256.Sum256(data)
		items = append(items, item{
			Section: "addonlist",
			Name:    "addonlist.txt",
			Size:    info.Size(),
			ModTime: hex.EncodeToString(digest[:]),
		})
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}

	sort.SliceStable(items, func(i, j int) bool {
		if items[i].Section != items[j].Section {
			return items[i].Section < items[j].Section
		}
		return strings.ToLower(items[i].Name) < strings.ToLower(items[j].Name)
	})
	hasher := sha256.New()
	for _, item := range items {
		_, _ = fmt.Fprintf(hasher, "%s\x00%s\x00%d\x00%s\n", item.Section, strings.ToLower(item.Name), item.Size, item.ModTime)
	}
	return hex.EncodeToString(hasher.Sum(nil)), nil
}

func indexSnapshotDirectory(dir string) (map[string]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	result := make(map[string]string, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		key := strings.ToLower(entry.Name())
		if _, exists := result[key]; exists {
			return nil, fmt.Errorf("目录中存在仅大小写不同的重名文件: %s", dir)
		}
		result[key] = filepath.Join(dir, entry.Name())
	}
	return result, nil
}

func snapshotFileMatches(path string, expectedSize int64, expectedSHA string) (bool, error) {
	info, err := os.Stat(path)
	if err != nil {
		return false, err
	}
	if expectedSize >= 0 && info.Size() != expectedSize {
		return false, nil
	}
	if expectedSHA == "" {
		return true, nil
	}
	digest, err := hashSnapshotFile(path)
	if err != nil {
		return false, err
	}
	return strings.EqualFold(digest, expectedSHA), nil
}

func filesHaveSameContent(first string, second string) (bool, error) {
	firstInfo, err := os.Stat(first)
	if err != nil {
		return false, err
	}
	secondInfo, err := os.Stat(second)
	if err != nil {
		return false, err
	}
	if firstInfo.Size() != secondInfo.Size() {
		return false, nil
	}
	firstHash, err := hashSnapshotFile(first)
	if err != nil {
		return false, err
	}
	secondHash, err := hashSnapshotFile(second)
	if err != nil {
		return false, err
	}
	return strings.EqualFold(firstHash, secondHash), nil
}

func hashSnapshotFile(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hasher := sha256.New()
	if _, err := io.Copy(hasher, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hasher.Sum(nil)), nil
}

func sidecarNamesForBase(dir string, base string) []string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	names := make([]string, 0)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		ext := strings.ToLower(filepath.Ext(name))
		if !snapshotSidecarExtensions[ext] {
			continue
		}
		if strings.EqualFold(strings.TrimSuffix(name, filepath.Ext(name)), base) {
			names = append(names, name)
		}
	}
	sort.SliceStable(names, func(i, j int) bool {
		return strings.ToLower(names[i]) < strings.ToLower(names[j])
	})
	return names
}

func validateSnapshotItemName(name string) string {
	if strings.TrimSpace(name) == "" {
		return "快照中存在空文件名"
	}
	if filepath.Base(name) != name || name == "." || name == ".." {
		return "快照中存在不安全文件名: " + name
	}
	if strings.ContainsAny(name, `\/:*?"<>|`) {
		return "快照中存在非法文件名: " + name
	}
	if !strings.EqualFold(filepath.Ext(name), ".vpk") {
		return "快照中存在非 VPK 文件: " + name
	}
	return ""
}

func validateSnapshotSidecarName(name string) string {
	if strings.TrimSpace(name) == "" {
		return "快照中存在空侧车文件名"
	}
	if filepath.Base(name) != name || name == "." || name == ".." {
		return "快照中存在不安全侧车文件名: " + name
	}
	if strings.ContainsAny(name, `\/:*?"<>|`) {
		return "快照中存在非法侧车文件名: " + name
	}
	if !snapshotSidecarExtensions[strings.ToLower(filepath.Ext(name))] {
		return "快照中存在不支持的侧车文件: " + name
	}
	return ""
}

func fileSizeOrZero(path string) int64 {
	info, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return info.Size()
}

func countVPKs(dir string) int {
	count := 0
	_ = filepath.WalkDir(dir, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if !entry.IsDir() && strings.EqualFold(filepath.Ext(entry.Name()), ".vpk") {
			count++
		}
		return nil
	})
	return count
}

func newRestorePlanID() string {
	var random [8]byte
	if _, err := rand.Read(random[:]); err != nil {
		return fmt.Sprintf("plan_%d", time.Now().UnixNano())
	}
	return "plan_" + hex.EncodeToString(random[:])
}

func (a *App) refreshSnapshotFilesAfterRestore() {
	a.vpkCache.Range(func(key, _ interface{}) bool {
		a.vpkCache.Delete(key)
		return true
	})
	if a.goroutinePool != nil {
		if err := a.ScanVPKFiles(); err != nil {
			a.LogError("快照恢复", "刷新Mod列表失败: "+err.Error(), "")
		}
	}
	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, "refresh_files", nil)
	}
}

func (a *App) emitSnapshotRestoreProgress(info SnapshotProgressInfo) {
	if a.ctx == nil {
		return
	}
	runtime.EventsEmit(a.ctx, "snapshot_restore_progress", info)
}
