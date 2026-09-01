package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// WorkshopMeta 存储工坊文件的元数据
type WorkshopMeta struct {
	WorkshopID   string `json:"workshop_id"`
	Title        string `json:"title"`
	Author       string `json:"author"`
	Description  string `json:"description"`
	PreviewURL   string `json:"preview_url"`
	FileURL      string `json:"file_url"`
	DownloadedAt string `json:"downloaded_at"`
	TimeUpdated  string `json:"time_updated"` // 远端最后更新时间（RFC3339）
}

// GetMetaFilePath 根据VPK路径计算对应的.meta文件路径
func GetMetaFilePath(filePath string) string {
	ext := filepath.Ext(filePath)
	return strings.TrimSuffix(filePath, ext) + ".meta"
}

// SaveWorkshopMeta 将工坊详情保存为.meta文件
func SaveWorkshopMeta(filePath string, details WorkshopFileDetails) error {
	meta := WorkshopMeta{
		WorkshopID:   details.PublishedFileId,
		Title:        details.Title,
		Author:       details.Creator,
		Description:  details.Description,
		PreviewURL:   details.PreviewUrl,
		FileURL:      details.FileUrl,
		DownloadedAt: time.Now().Format(time.RFC3339),
	}
	return writeWorkshopMeta(filePath, meta)
}

// SaveWorkshopDetailMeta 保存从工坊详情接口获取的完整元数据。
func SaveWorkshopDetailMeta(filePath string, workshopID string, detail WorkshopItemDetail) (WorkshopMeta, error) {
	meta := WorkshopMeta{
		WorkshopID:   workshopID,
		Title:        detail.Title,
		Author:       detail.Creator,
		Description:  detail.Description,
		PreviewURL:   detail.PreviewUrl,
		FileURL:      detail.FileUrl,
		DownloadedAt: time.Now().Format(time.RFC3339),
		TimeUpdated:  workshopTimeUpdatedRFC3339(detail.TimeUpdated),
	}
	return meta, writeWorkshopMeta(filePath, meta)
}

func writeWorkshopMeta(filePath string, meta WorkshopMeta) error {
	metaPath := GetMetaFilePath(filePath)

	data, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(metaPath, data, 0644)
}

func workshopTimeUpdatedRFC3339(value interface{}) string {
	var timestamp int64
	var ok bool

	switch v := value.(type) {
	case float64:
		timestamp, ok = int64(v), true
	case float32:
		timestamp, ok = int64(v), true
	case int:
		timestamp, ok = int64(v), true
	case int64:
		timestamp, ok = v, true
	case int32:
		timestamp, ok = int64(v), true
	case json.Number:
		parsed, err := v.Int64()
		if err == nil {
			timestamp, ok = parsed, true
		}
	case string:
		trimmed := strings.TrimSpace(v)
		if parsed, err := strconv.ParseInt(trimmed, 10, 64); err == nil {
			timestamp, ok = parsed, true
		} else if parsedTime, err := time.Parse(time.RFC3339, trimmed); err == nil {
			return parsedTime.Format(time.RFC3339)
		}
	}

	if !ok || timestamp <= 0 {
		return ""
	}
	return time.Unix(timestamp, 0).UTC().Format(time.RFC3339)
}

// LoadWorkshopMeta 读取.meta文件，不存在时返回nil
func LoadWorkshopMeta(filePath string) (*WorkshopMeta, error) {
	metaPath := GetMetaFilePath(filePath)

	data, err := os.ReadFile(metaPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	var meta WorkshopMeta
	if err := json.Unmarshal(data, &meta); err != nil {
		return nil, err
	}

	return &meta, nil
}

// UpdateWorkshopMetaTimeUpdated 更新meta文件中的TimeUpdated字段（保留其他字段）
func UpdateWorkshopMetaTimeUpdated(filePath string, timeUpdated string) error {
	meta, err := LoadWorkshopMeta(filePath)
	if meta == nil || err != nil {
		return err
	}
	meta.TimeUpdated = timeUpdated
	data, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(GetMetaFilePath(filePath), data, 0644)
}
