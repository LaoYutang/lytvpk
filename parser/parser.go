package parser

import (
	"bytes"
	"encoding/base64"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
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
		return vpkFile, nil
	}

	// 设置最终的标签
	vpkFile.SecondaryTags = []string{}
	for tag := range secondaryTags {
		vpkFile.SecondaryTags = append(vpkFile.SecondaryTags, tag)
	}

	vpkFile.Chapters = chapters

	// 提取预览图
	vpkFile.PreviewImage = ExtractPreviewImage(opener, archive)

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
// 查找常见的预览图文件并返回Base64编码的图片数据
func ExtractPreviewImage(opener *vpk.Opener, archive *vpk.Archive) string {
	// 常见的预览图路径模式
	previewPatterns := []string{
		"materials/vgui/maps/menu/",
		"materials/vgui/loadingscreen",
		"resource/overviews/",
		".png",
		".jpg",
		".jpeg",
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

	// 如果没有找到预览图，返回空字符串
	if previewFile == nil {
		return ""
	}

	// 读取文件内容
	reader, err := previewFile.Open(opener)
	if err != nil {
		return ""
	}
	defer reader.Close()

	data, err := io.ReadAll(reader)
	if err != nil {
		return ""
	}

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
