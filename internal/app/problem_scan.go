package app

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	problemScanStatusNone     = "none"
	problemScanStatusActive   = "active"
	problemScanStatusFound    = "found"
	problemScanStatusRestored = "restored"
)

type ProblemModScanItem struct {
	Name          string   `json:"name"`
	Path          string   `json:"path"`
	Size          int64    `json:"size"`
	LastModified  string   `json:"lastModified"`
	Title         string   `json:"title"`
	PrimaryTag    string   `json:"primaryTag"`
	SecondaryTags []string `json:"secondaryTags"`
	WorkshopID    string   `json:"workshopId"`
}

type ProblemModScanSession struct {
	Active            bool                 `json:"active"`
	Status            string               `json:"status"`
	RootDir           string               `json:"rootDir"`
	Round             int                  `json:"round"`
	OriginalEnabled   []ProblemModScanItem `json:"originalEnabled"`
	CurrentCandidates []ProblemModScanItem `json:"currentCandidates"`
	CurrentDisabled   []ProblemModScanItem `json:"currentDisabled"`
	CurrentEnabled    []ProblemModScanItem `json:"currentEnabled"`
	AppliedDisabled   []ProblemModScanItem `json:"appliedDisabled"`
	SuspiciousMod     *ProblemModScanItem  `json:"suspiciousMod,omitempty"`
	StartedAt         string               `json:"startedAt"`
	UpdatedAt         string               `json:"updatedAt"`
	Message           string               `json:"message,omitempty"`
}

func (a *App) GetProblemModScanSession() ProblemModScanSession {
	session, err := a.loadProblemModScanSession()
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return ProblemModScanSession{
				Active:  false,
				Status:  problemScanStatusNone,
				Message: err.Error(),
			}
		}
		return emptyProblemModScanSession()
	}
	return session
}

func (a *App) StartProblemModScan() (ProblemModScanSession, error) {
	if strings.TrimSpace(a.rootDir) == "" {
		return emptyProblemModScanSession(), fmt.Errorf("请先选择 addons 目录")
	}

	files := a.GetVPKFiles()
	candidates := make([]ProblemModScanItem, 0)
	for _, file := range files {
		if file.Enabled && file.Location == "root" {
			candidates = append(candidates, problemScanItemFromVPK(file))
		}
	}
	sortProblemScanItems(candidates)

	if len(candidates) == 0 {
		return emptyProblemModScanSession(), fmt.Errorf("当前没有可参与查找的已启用根目录 Mod")
	}
	if err := a.validateProblemScanItems(candidates); err != nil {
		return emptyProblemModScanSession(), err
	}

	now := time.Now().Format(time.RFC3339)
	session := ProblemModScanSession{
		Active:            true,
		Status:            problemScanStatusActive,
		RootDir:           a.rootDir,
		Round:             1,
		OriginalEnabled:   cloneProblemScanItems(candidates),
		CurrentCandidates: cloneProblemScanItems(candidates),
		StartedAt:         now,
		UpdatedAt:         now,
	}

	if len(candidates) == 1 {
		session.Active = false
		session.Status = problemScanStatusFound
		session.SuspiciousMod = &session.CurrentCandidates[0]
		session.Message = "当前只有一个可疑 Mod"
		return session, nil
	}

	if err := a.prepareProblemScanRound(&session); err != nil {
		return emptyProblemModScanSession(), err
	}
	if err := a.saveProblemModScanSession(session); err != nil {
		return emptyProblemModScanSession(), err
	}

	return session, nil
}

func (a *App) SubmitProblemModScanResult(result string) (ProblemModScanSession, error) {
	session, err := a.loadProblemModScanSession()
	if err != nil {
		return emptyProblemModScanSession(), fmt.Errorf("没有正在进行的问题 Mod 查找")
	}
	if !session.Active || session.Status != problemScanStatusActive {
		return session, fmt.Errorf("问题 Mod 查找未处于进行中")
	}

	var nextCandidates []ProblemModScanItem
	switch result {
	case "still_exists":
		nextCandidates = cloneProblemScanItems(session.CurrentEnabled)
	case "gone":
		nextCandidates = cloneProblemScanItems(session.CurrentDisabled)
	default:
		return session, fmt.Errorf("未知的查找结果: %s", result)
	}
	sortProblemScanItems(nextCandidates)

	if len(nextCandidates) == 0 {
		return session, fmt.Errorf("当前反馈无法继续缩小范围，请退出查找后重新开始")
	}

	session.CurrentCandidates = nextCandidates
	session.Round++
	session.UpdatedAt = time.Now().Format(time.RFC3339)

	if len(nextCandidates) == 1 {
		session.Active = false
		session.Status = problemScanStatusFound
		session.SuspiciousMod = &session.CurrentCandidates[0]
		session.CurrentDisabled = nil
		session.CurrentEnabled = nil
		session.AppliedDisabled = nil
		if err := a.restoreProblemScanOriginalState(&session); err != nil {
			return session, err
		}
		if err := a.deleteProblemModScanSession(); err != nil {
			return session, err
		}
		return session, nil
	}

	if err := a.prepareProblemScanRound(&session); err != nil {
		return session, err
	}
	if err := a.saveProblemModScanSession(session); err != nil {
		return session, err
	}
	return session, nil
}

func (a *App) RestoreProblemModScan() (ProblemModScanSession, error) {
	session, err := a.loadProblemModScanSession()
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return emptyProblemModScanSession(), nil
		}
		return emptyProblemModScanSession(), err
	}

	if err := a.restoreProblemScanOriginalState(&session); err != nil {
		return session, err
	}
	if err := a.deleteProblemModScanSession(); err != nil {
		return session, err
	}

	session.Active = false
	session.Status = problemScanStatusRestored
	session.CurrentDisabled = nil
	session.CurrentEnabled = nil
	session.AppliedDisabled = nil
	session.UpdatedAt = time.Now().Format(time.RFC3339)
	return session, nil
}

func (a *App) LaunchL4D2ForProblemScan() error {
	runtime.BrowserOpenURL(a.ctx, "steam://rungameid/550")
	return nil
}

func (a *App) hasActiveProblemModScanSession() bool {
	session, err := a.loadProblemModScanSession()
	return err == nil && session.Active && session.Status == problemScanStatusActive
}

func (a *App) prepareProblemScanRound(session *ProblemModScanSession) error {
	if err := a.ensureProblemScanRoot(session); err != nil {
		return err
	}

	disabled, enabled := splitProblemScanCandidates(session.CurrentCandidates)
	session.CurrentDisabled = disabled
	session.CurrentEnabled = enabled
	session.AppliedDisabled = problemScanItemsExcept(session.OriginalEnabled, session.CurrentEnabled)

	if err := a.restoreProblemScanOriginalState(session); err != nil {
		return err
	}
	for _, item := range session.AppliedDisabled {
		if _, err := a.setProblemScanItemEnabled(item, false); err != nil {
			return fmt.Errorf("禁用 %s 失败: %w", item.Name, err)
		}
	}

	if err := a.refreshProblemScanSessionPaths(session); err != nil {
		return err
	}
	if err := a.verifyProblemScanRoundApplied(session); err != nil {
		return err
	}
	session.UpdatedAt = time.Now().Format(time.RFC3339)
	return nil
}

func (a *App) restoreProblemScanOriginalState(session *ProblemModScanSession) error {
	if err := a.ensureProblemScanRoot(session); err != nil {
		return err
	}
	for _, item := range session.OriginalEnabled {
		if _, err := a.setProblemScanItemEnabled(item, true); err != nil {
			return fmt.Errorf("恢复 %s 失败: %w", item.Name, err)
		}
	}
	return a.refreshProblemScanSessionPaths(session)
}

func (a *App) setProblemScanItemEnabled(item ProblemModScanItem, enabled bool) (ProblemModScanItem, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	currentPath, currentlyEnabled, err := a.resolveProblemScanItemPath(item)
	if err != nil {
		return item, err
	}
	if currentlyEnabled == enabled {
		item.Path = currentPath
		return item, nil
	}

	var newPath string
	if enabled {
		newPath = filepath.Join(a.rootDir, item.Name)
	} else {
		disabledDir := filepath.Join(a.rootDir, "disabled")
		if err := os.MkdirAll(disabledDir, 0755); err != nil {
			return item, err
		}
		newPath = filepath.Join(disabledDir, item.Name)
	}

	if _, err := os.Stat(newPath); err == nil {
		return item, fmt.Errorf("目标文件已存在: %s", newPath)
	} else if !errors.Is(err, os.ErrNotExist) {
		return item, err
	}

	if err := os.Rename(currentPath, newPath); err != nil {
		return item, err
	}
	a.handleSidecarFile(currentPath, newPath, "move")

	if cached, ok := a.vpkCache.Load(currentPath); ok {
		cache := cached.(*VPKFileCache)
		cache.File.Path = newPath
		cache.File.Enabled = enabled
		if enabled {
			cache.File.Location = "root"
		} else {
			cache.File.Location = "disabled"
		}
		a.vpkCache.Delete(currentPath)
		a.vpkCache.Store(newPath, cache)
	} else {
		a.vpkCache.Delete(currentPath)
	}

	item.Path = newPath
	return item, nil
}

func (a *App) verifyProblemScanRoundApplied(session *ProblemModScanSession) error {
	for _, item := range session.AppliedDisabled {
		_, currentlyEnabled, err := a.resolveProblemScanItemPath(item)
		if err != nil {
			return err
		}
		if currentlyEnabled {
			return fmt.Errorf("本轮禁用未生效: %s", item.Name)
		}
	}

	for _, item := range session.CurrentEnabled {
		_, currentlyEnabled, err := a.resolveProblemScanItemPath(item)
		if err != nil {
			return err
		}
		if !currentlyEnabled {
			return fmt.Errorf("本轮启用状态异常: %s", item.Name)
		}
	}
	return nil
}

func (a *App) resolveProblemScanItemPath(item ProblemModScanItem) (string, bool, error) {
	if strings.TrimSpace(a.rootDir) == "" {
		return "", false, fmt.Errorf("请先选择 addons 目录")
	}

	rootPath := filepath.Join(a.rootDir, item.Name)
	disabledPath := filepath.Join(a.rootDir, "disabled", item.Name)

	rootMatches, rootExists, rootErr := problemScanPathMatches(rootPath, item)
	if rootErr != nil {
		return "", false, rootErr
	}
	disabledMatches, disabledExists, disabledErr := problemScanPathMatches(disabledPath, item)
	if disabledErr != nil {
		return "", false, disabledErr
	}

	if rootMatches && disabledMatches {
		return "", false, fmt.Errorf("发现重复文件，无法安全切换: %s", item.Name)
	}
	if rootMatches {
		return rootPath, true, nil
	}
	if disabledMatches {
		return disabledPath, false, nil
	}
	if rootExists || disabledExists {
		return "", false, fmt.Errorf("文件 %s 已被修改，查找会话已不安全", item.Name)
	}
	return "", false, fmt.Errorf("文件不存在: %s", item.Name)
}

func problemScanPathMatches(path string, item ProblemModScanItem) (bool, bool, error) {
	info, err := os.Stat(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return false, false, nil
		}
		return false, false, err
	}
	if info.IsDir() {
		return false, true, nil
	}
	if item.Size > 0 && info.Size() != item.Size {
		return false, true, nil
	}
	if item.LastModified != "" && info.ModTime().Format(time.RFC3339) != item.LastModified {
		return false, true, nil
	}
	return true, true, nil
}

func (a *App) validateProblemScanItems(items []ProblemModScanItem) error {
	seen := make(map[string]bool, len(items))
	for _, item := range items {
		key := problemScanItemKey(item)
		if seen[key] {
			return fmt.Errorf("发现重复文件名，无法安全查找: %s", item.Name)
		}
		seen[key] = true

		rootPath := filepath.Join(a.rootDir, item.Name)
		if ok, exists, err := problemScanPathMatches(rootPath, item); err != nil {
			return err
		} else if !ok || !exists {
			return fmt.Errorf("文件状态已变化，请刷新后重试: %s", item.Name)
		}

		disabledPath := filepath.Join(a.rootDir, "disabled", item.Name)
		if _, exists, err := problemScanPathMatches(disabledPath, item); err != nil {
			return err
		} else if exists {
			return fmt.Errorf("disabled 目录中已存在同名文件，无法安全禁用: %s", item.Name)
		}
	}
	return nil
}

func (a *App) refreshProblemScanSessionPaths(session *ProblemModScanSession) error {
	updateList := func(items []ProblemModScanItem) error {
		for i := range items {
			path, _, err := a.resolveProblemScanItemPath(items[i])
			if err != nil {
				return err
			}
			items[i].Path = path
		}
		return nil
	}
	if err := updateList(session.OriginalEnabled); err != nil {
		return err
	}
	if err := updateList(session.CurrentCandidates); err != nil {
		return err
	}
	if err := updateList(session.CurrentDisabled); err != nil {
		return err
	}
	if err := updateList(session.CurrentEnabled); err != nil {
		return err
	}
	if err := updateList(session.AppliedDisabled); err != nil {
		return err
	}
	if session.SuspiciousMod != nil {
		path, _, err := a.resolveProblemScanItemPath(*session.SuspiciousMod)
		if err == nil {
			session.SuspiciousMod.Path = path
		}
	}
	return nil
}

func (a *App) ensureProblemScanRoot(session *ProblemModScanSession) error {
	if session.RootDir == "" {
		return fmt.Errorf("查找会话缺少 addons 目录")
	}
	if a.rootDir == "" {
		a.rootDir = session.RootDir
		return nil
	}
	if filepath.Clean(a.rootDir) != filepath.Clean(session.RootDir) {
		return fmt.Errorf("当前 addons 目录与查找会话不一致")
	}
	return nil
}

func (a *App) loadProblemModScanSession() (ProblemModScanSession, error) {
	a.ensureConfigPaths()
	var session ProblemModScanSession
	if err := readJSONFile(a.problemScanPath, &session); err != nil {
		return session, err
	}
	if session.Status == "" {
		session.Status = problemScanStatusActive
	}
	session.Active = session.Status == problemScanStatusActive
	return session, nil
}

func (a *App) saveProblemModScanSession(session ProblemModScanSession) error {
	a.ensureConfigPaths()
	return writeJSONFile(a.configDir, a.problemScanPath, session)
}

func (a *App) deleteProblemModScanSession() error {
	a.ensureConfigPaths()
	if err := os.Remove(a.problemScanPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func splitProblemScanCandidates(candidates []ProblemModScanItem) ([]ProblemModScanItem, []ProblemModScanItem) {
	items := cloneProblemScanItems(candidates)
	sortProblemScanItems(items)
	disableCount := len(items) / 2
	if disableCount == 0 && len(items) > 1 {
		disableCount = 1
	}
	disabled := cloneProblemScanItems(items[:disableCount])
	enabled := cloneProblemScanItems(items[disableCount:])
	return disabled, enabled
}

func problemScanItemsExcept(items []ProblemModScanItem, except []ProblemModScanItem) []ProblemModScanItem {
	excluded := make(map[string]bool, len(except))
	for _, item := range except {
		excluded[problemScanItemKey(item)] = true
	}

	result := make([]ProblemModScanItem, 0, len(items))
	for _, item := range items {
		if !excluded[problemScanItemKey(item)] {
			result = append(result, item)
		}
	}
	sortProblemScanItems(result)
	return result
}

func problemScanItemFromVPK(file VPKFile) ProblemModScanItem {
	return ProblemModScanItem{
		Name:          file.Name,
		Path:          file.Path,
		Size:          file.Size,
		LastModified:  file.LastModified,
		Title:         file.Title,
		PrimaryTag:    file.PrimaryTag,
		SecondaryTags: append([]string{}, file.SecondaryTags...),
		WorkshopID:    file.WorkshopID,
	}
}

func cloneProblemScanItems(items []ProblemModScanItem) []ProblemModScanItem {
	if items == nil {
		return []ProblemModScanItem{}
	}
	next := make([]ProblemModScanItem, len(items))
	for i, item := range items {
		next[i] = item
		next[i].SecondaryTags = append([]string{}, item.SecondaryTags...)
	}
	return next
}

func sortProblemScanItems(items []ProblemModScanItem) {
	sort.SliceStable(items, func(i, j int) bool {
		return strings.ToLower(items[i].Name) < strings.ToLower(items[j].Name)
	})
}

func problemScanItemKey(item ProblemModScanItem) string {
	return strings.ToLower(item.Name)
}

func emptyProblemModScanSession() ProblemModScanSession {
	return ProblemModScanSession{
		Active:            false,
		Status:            problemScanStatusNone,
		OriginalEnabled:   []ProblemModScanItem{},
		CurrentCandidates: []ProblemModScanItem{},
		CurrentDisabled:   []ProblemModScanItem{},
		CurrentEnabled:    []ProblemModScanItem{},
		AppliedDisabled:   []ProblemModScanItem{},
	}
}
