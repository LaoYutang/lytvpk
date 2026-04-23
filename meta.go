package main

import (
	"encoding/json"
	"os"
	"path/filepath"
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
}

// GetMetaFilePath 根据VPK路径计算对应的.meta文件路径
func GetMetaFilePath(filePath string) string {
	ext := filepath.Ext(filePath)
	return strings.TrimSuffix(filePath, ext) + ".meta"
}

// SaveWorkshopMeta 将工坊详情保存为.meta文件
func SaveWorkshopMeta(filePath string, details WorkshopFileDetails) error {
	metaPath := GetMetaFilePath(filePath)

	meta := WorkshopMeta{
		WorkshopID:   details.PublishedFileId,
		Title:        details.Title,
		Author:       details.Creator,
		Description:  details.Description,
		PreviewURL:   details.PreviewUrl,
		FileURL:      details.FileUrl,
		DownloadedAt: time.Now().Format(time.RFC3339),
	}

	data, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(metaPath, data, 0644)
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
