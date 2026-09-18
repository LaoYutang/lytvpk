package app

import (
	"errors"
	"log"
	"os"
	"strings"
	"time"
)

// workshopHistoryLimit 解析历史最多保留的条数
const workshopHistoryLimit = 10

// WorkshopHistoryStorage 最近解析记录存储结构
type WorkshopHistoryStorage struct {
	Items []WorkshopHistoryItem `json:"items"`
}

// WorkshopHistoryItem 单条解析记录，保存解析时的完整结果快照
type WorkshopHistoryItem struct {
	RootID   string               `json:"rootId"`
	Title    string               `json:"title"`
	FileType int                  `json:"fileType"` // 2 = 合集
	ParsedAt int64                `json:"parsedAt"` // Unix 毫秒
	Group    WorkshopDetailsGroup `json:"group"`
}

// GetWorkshopHistory 返回最近解析记录（最多 workshopHistoryLimit 条，最新在前）
func (a *App) GetWorkshopHistory() WorkshopHistoryStorage {
	a.workshopHistoryMu.Lock()
	defer a.workshopHistoryMu.Unlock()
	return a.loadWorkshopHistory()
}

func (a *App) loadWorkshopHistory() WorkshopHistoryStorage {
	a.ensureConfigPaths()
	var storage WorkshopHistoryStorage
	if err := readJSONFile(a.workshopHistoryPath, &storage); err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			log.Printf("读取解析历史失败，已使用空记录: %v", err)
		}
		return WorkshopHistoryStorage{Items: []WorkshopHistoryItem{}}
	}
	storage.Items = cloneWorkshopHistoryItems(storage.Items)
	return storage
}

// AddWorkshopHistoryEntries 将本次解析的条目置顶写入历史，返回写入后的完整列表
func (a *App) AddWorkshopHistoryEntries(items []WorkshopHistoryItem) (WorkshopHistoryStorage, error) {
	a.workshopHistoryMu.Lock()
	defer a.workshopHistoryMu.Unlock()

	existing := a.loadWorkshopHistory()
	now := time.Now().UnixMilli()

	merged := make([]WorkshopHistoryItem, 0, len(items)+len(existing.Items))
	seen := make(map[string]bool, len(items))
	for _, item := range items {
		item.RootID = strings.TrimSpace(item.RootID)
		if item.RootID == "" || seen[item.RootID] {
			continue
		}
		seen[item.RootID] = true
		if item.ParsedAt == 0 {
			item.ParsedAt = now
		}
		merged = append(merged, item)
	}

	for _, item := range existing.Items {
		if seen[item.RootID] {
			continue
		}
		merged = append(merged, item)
	}

	if len(merged) > workshopHistoryLimit {
		merged = merged[:workshopHistoryLimit]
	}

	storage := WorkshopHistoryStorage{Items: cloneWorkshopHistoryItems(merged)}
	if err := writeJSONFile(a.configDir, a.workshopHistoryPath, storage); err != nil {
		return WorkshopHistoryStorage{Items: []WorkshopHistoryItem{}}, err
	}
	return storage, nil
}

// ClearWorkshopHistory 清空解析历史
func (a *App) ClearWorkshopHistory() error {
	a.workshopHistoryMu.Lock()
	defer a.workshopHistoryMu.Unlock()

	a.ensureConfigPaths()
	return writeJSONFile(a.configDir, a.workshopHistoryPath, WorkshopHistoryStorage{Items: []WorkshopHistoryItem{}})
}

func cloneWorkshopHistoryItems(items []WorkshopHistoryItem) []WorkshopHistoryItem {
	if items == nil {
		return []WorkshopHistoryItem{}
	}
	next := make([]WorkshopHistoryItem, len(items))
	copy(next, items)
	return next
}
