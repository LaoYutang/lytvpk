package parser

import (
	"bytes"
	"encoding/base64"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"os"
	"path/filepath"
	"strings"

	"git.lubar.me/ben/valve/vpk"
)

// ParseVPKFile 解析VPK文件的主入口函数
// 输入文件路径,返回解析后的VPKFile结构
func ParseVPKFile(filePath string) (*VPKFile, error) {
	// 打开VPK文件
	opener := vpk.Single(filePath)
	defer opener.Close()

	archive, err := opener.ReadArchive()
	if err != nil {
		return nil, err
	}

	// 创建基础文件信息
	vpkFile := &VPKFile{
		Name:          filepath.Base(filePath),
		Path:          filePath,
		PrimaryTag:    "其他", // 默认为"其他"
		SecondaryTags: make([]string, 0),
		Chapters:      make(map[string]ChapterInfo),
	}

	// 第一步:确定VPK的主要类型
	vpkType := DetermineVPKType(archive)

	secondaryTags := make(map[string]bool)
	chapters := make(map[string]ChapterInfo)

	// 第二步：根据类型进行专门的检测
	switch vpkType {
	case "地图":
		ProcessMapVPK(opener, archive, vpkFile, secondaryTags, chapters)
	case "人物":
		ProcessCharacterVPK(archive, vpkFile, secondaryTags)
	case "武器":
		ProcessWeaponVPK(archive, vpkFile, secondaryTags)
	default:
		// 其他类型
		vpkFile.PrimaryTag = "其他"
		vpkFile.SecondaryTags = []string{}
		vpkFile.Chapters = make(map[string]ChapterInfo)
		// 注意：不在这里 return，让它继续执行提取预览图的逻辑
	}

	// 设置最终的标签
	vpkFile.SecondaryTags = []string{}
	for tag := range secondaryTags {
		vpkFile.SecondaryTags = append(vpkFile.SecondaryTags, tag)
	}

	vpkFile.Chapters = chapters

	// 提取预览图
	vpkFile.PreviewImage = ExtractPreviewImage(opener, archive, filePath)

	return vpkFile, nil
}

// GetPrimaryTags 获取所有主要标签
func GetPrimaryTags() []string {
	return []string{"地图", "人物", "武器", "其他"}
}

// GetSecondaryTags 获取指定主标签下的所有二级标签
// 从给定的VPK文件列表中提取二级标签
func GetSecondaryTags(vpkFiles []VPKFile, primaryTag string) []string {
	tagSet := make(map[string]bool)
	for _, vpkFile := range vpkFiles {
		if primaryTag == "" || vpkFile.PrimaryTag == primaryTag {
			for _, tag := range vpkFile.SecondaryTags {
				tagSet[tag] = true
			}
		}
	}

	result := make([]string, 0, len(tagSet))
	for tag := range tagSet {
		result = append(result, tag)
	}

	return result
}

// ExtractPreviewImage 从VPK中提取预览图并转换为Base64
// 采用三级查找策略:
// 1. 优先查找 addonimage.jpg (Steam 创意工坊标准)
// 2. 查找内部其他预览图
// 3. 查找外部同名 .jpg 文件
func ExtractPreviewImage(opener *vpk.Opener, archive *vpk.Archive, vpkFilePath string) string {
	// ========== 优先级 1: 查找 addonimage.jpg ==========
	// Steam 创意工坊的标准缩略图文件名
	addonImageFile := findFileInArchive(archive, "addonimage.jpg")
	if addonImageFile != nil {
		base64Data := readAndEncodeImage(opener, addonImageFile)
		if base64Data != "" {
			return base64Data
		}
	}

	// ========== 优先级 2: 查找其他预览图 (原有逻辑) ==========
	// 常见的预览图路径模式
	previewPatterns := []string{
		".jpg",
		".jpeg",
		".png",
		"materials/vgui/maps/menu/",
		"materials/vgui/loadingscreen",
		"resource/overviews/",
	}

	var previewFile *vpk.File

	// 遍历所有文件，查找预览图
	for i := range archive.Files {
		file := &archive.Files[i]
		filename := strings.ToLower(file.Name())

		// 检查是否匹配预览图模式
		for _, pattern := range previewPatterns {
			if strings.Contains(filename, pattern) {
				// 确保是图片文件
				if strings.HasSuffix(filename, ".png") ||
					strings.HasSuffix(filename, ".jpg") ||
					strings.HasSuffix(filename, ".jpeg") {
					previewFile = file
					break
				}
			}
		}

		if previewFile != nil {
			break
		}
	}

	if previewFile != nil {
		if base64Data := readAndEncodeImage(opener, previewFile); base64Data != "" {
			return base64Data
		}
	}

	// ========== 优先级 3: 查找外部同名 .jpg 文件 ==========
	// 例如: xxx.vpk -> xxx.jpg
	externalJpgPath := strings.TrimSuffix(vpkFilePath, filepath.Ext(vpkFilePath)) + ".jpg"
	if fileExists(externalJpgPath) {
		if base64Data := readExternalImageFile(externalJpgPath); base64Data != "" {
			return base64Data
		}
	}

	return ""
}

// findFileInArchive 在 VPK 中查找指定文件名（不区分大小写）
func findFileInArchive(archive *vpk.Archive, targetName string) *vpk.File {
	targetLower := strings.ToLower(targetName)
	for i := range archive.Files {
		file := &archive.Files[i]
		if strings.ToLower(file.Name()) == targetLower {
			return file
		}
	}
	return nil
}

// readAndEncodeImage 读取 VPK 内部文件并编码为 Base64
func readAndEncodeImage(opener *vpk.Opener, file *vpk.File) string {
	reader, err := file.Open(opener)
	if err != nil {
		return ""
	}
	defer reader.Close()

	data, err := io.ReadAll(reader)
	if err != nil {
		return ""
	}

	return encodeImageToBase64(data)
}

// readExternalImageFile 读取外部图片文件并编码为 Base64
func readExternalImageFile(filePath string) string {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return ""
	}

	return encodeImageToBase64(data)
}

// encodeImageToBase64 将图片数据编码为 Base64 Data URL
func encodeImageToBase64(data []byte) string {
	// 尝试解码图片以验证格式
	_, format, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return ""
	}

	// 如果是VTF格式（Valve纹理格式），我们暂时跳过
	// 因为需要特殊的VTF解码器
	if format != "png" && format != "jpeg" {
		return ""
	}

	// 将图片数据转换为Base64
	base64Str := base64.StdEncoding.EncodeToString(data)

	// 根据格式添加Data URL前缀
	var dataURL string
	switch format {
	case "png":
		dataURL = "data:image/png;base64," + base64Str
	case "jpeg":
		dataURL = "data:image/jpeg;base64," + base64Str
	default:
		return ""
	}

	return dataURL
}

// fileExists 检查文件是否存在
func fileExists(filePath string) bool {
	_, err := os.Stat(filePath)
	return err == nil
}
