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
	"regexp"
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

	// 提前提取资源信息（预览图和addoninfo），为后续处理提供元数据支持
	ExtractVPKResources(opener, archive, vpkFile, filePath)

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

	// 检查自定义标签并覆盖
	if pTag, sTags, _, ok := ParseFilenameTags(vpkFile.Name); ok {
		// 只有当有明确的自定义标签结构时才覆盖
		// 允许 PrimaryTag 为空字符串（如果用户删除了）?
		// 但通常 [Primary,Secondary] 格式意味着至少有一个为空?
		// 如果 [] 空的，len(tagParts)==1 ("") -> primaryTag=""
		vpkFile.PrimaryTag = pTag
		vpkFile.SecondaryTags = sTags
	}

	return vpkFile, nil
}

var tagRegex = regexp.MustCompile(`^(_)?\[(.*?)\](.*)$`)

// ParseFilenameTags 解析文件名中的标签
// 返回: primaryTag, secondaryTags, realNameWithoutTags, hasTags
func ParseFilenameTags(filename string) (string, []string, string, bool) {
	matches := tagRegex.FindStringSubmatch(filename)
	if matches == nil {
		return "", nil, filename, false
	}

	// matches[1] 是前缀 "_"
	// matches[2] 是标签内容
	// matches[3] 是剩余文件名

	// hiddenPrefix := matches[1]
	tagsContent := matches[2]
	// realName := hiddenPrefix + matches[3]

	tagParts := strings.FieldsFunc(tagsContent, func(r rune) bool {
		return r == ',' || r == '+'
	})
	var primaryTag string
	var secondaryTags []string

	if len(tagParts) > 0 {
		primaryTag = strings.TrimSpace(tagParts[0])
		for _, t := range tagParts[1:] {
			t = strings.TrimSpace(t)
			if t != "" {
				secondaryTags = append(secondaryTags, t)
			}
		}
	}

	return primaryTag, secondaryTags, matches[1] + matches[3], true
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

	// ========== 优先级 3: 查找外部同名图片文件 (.jpg, .png, .jpeg) ==========
	// 例如: xxx.vpk -> xxx.jpg
	basePath := strings.TrimSuffix(vpkFilePath, filepath.Ext(vpkFilePath))
	exts := []string{".jpg", ".png", ".jpeg"}

	for _, ext := range exts {
		externalPath := basePath + ext
		if fileExists(externalPath) {
			if base64Data := readExternalImageFile(externalPath); base64Data != "" {
				return base64Data
			}
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

// ExtractVPKResources 一次性提取VPK中的预览图和addoninfo信息
// 优化性能：只遍历一次archive，同时查找预览图和addoninfo.txt
func ExtractVPKResources(opener *vpk.Opener, archive *vpk.Archive, vpkFile *VPKFile, vpkFilePath string) {
	var addonImageFile *vpk.File
	var addonInfoFile *vpk.File
	var previewFile *vpk.File

	// 预览图匹配模式
	previewPatterns := []string{
		".jpg",
		".jpeg",
		".png",
		"materials/vgui/maps/menu/",
		"materials/vgui/loadingscreen",
		"resource/overviews/",
	}

	// 只遍历一次archive，同时查找多个文件
	for i := range archive.Files {
		file := &archive.Files[i]
		filename := strings.ToLower(file.Name())

		// 查找 addonimage.jpg (最高优先级的预览图)
		if addonImageFile == nil && filename == "addonimage.jpg" {
			addonImageFile = file
		}

		// 查找 addoninfo.txt
		if addonInfoFile == nil && filename == "addoninfo.txt" {
			addonInfoFile = file
		}

		// 查找其他预览图（如果还没找到addonimage.jpg）
		if previewFile == nil && addonImageFile == nil {
			for _, pattern := range previewPatterns {
				if strings.Contains(filename, pattern) {
					if strings.HasSuffix(filename, ".png") ||
						strings.HasSuffix(filename, ".jpg") ||
						strings.HasSuffix(filename, ".jpeg") {
						previewFile = file
						break
					}
				}
			}
		}

		// 如果所有需要的文件都找到了，提前退出循环
		if addonImageFile != nil && addonInfoFile != nil {
			break
		}
	}

	// 处理预览图
	vpkFile.PreviewImage = extractPreviewImageFromFiles(opener, addonImageFile, previewFile, vpkFilePath)

	// 处理addoninfo
	parseAddonInfoFromFile(opener, addonInfoFile, vpkFile)
}

// extractPreviewImageFromFiles 从找到的文件中提取预览图
func extractPreviewImageFromFiles(opener *vpk.Opener, addonImageFile, previewFile *vpk.File, vpkFilePath string) string {
	// 优先级1: addonimage.jpg
	if addonImageFile != nil {
		if base64Data := readAndEncodeImage(opener, addonImageFile); base64Data != "" {
			return base64Data
		}
	}

	// 优先级2: 其他预览图
	if previewFile != nil {
		if base64Data := readAndEncodeImage(opener, previewFile); base64Data != "" {
			return base64Data
		}
	}

	// 优先级3: 外部同名.jpg文件
	externalJpgPath := strings.TrimSuffix(vpkFilePath, filepath.Ext(vpkFilePath)) + ".jpg"
	if fileExists(externalJpgPath) {
		if base64Data := readExternalImageFile(externalJpgPath); base64Data != "" {
			return base64Data
		}
	}

	return ""
}

// parseAddonInfoFromFile 从addoninfo.txt文件解析信息
func parseAddonInfoFromFile(opener *vpk.Opener, addonInfoFile *vpk.File, vpkFile *VPKFile) {
	// 初始化默认值
	vpkFile.Title = ""
	vpkFile.Author = ""
	vpkFile.Version = ""
	vpkFile.Desc = ""

	if addonInfoFile == nil {
		return
	}

	// 读取文件内容
	reader, err := addonInfoFile.Open(opener)
	if err != nil {
		return
	}
	defer reader.Close()

	data, err := io.ReadAll(reader)
	if err != nil {
		return
	}

	// 解析文件内容
	content := string(data)
	lines := strings.Split(content, "\n")

	// 解析每一行
	for _, line := range lines {
		line = strings.TrimSpace(line)
		// 跳过空行、注释
		if line == "" || strings.HasPrefix(line, "//") {
			continue
		}

		var key, value string

		// 检查键是否被引用 "key" "value"
		if strings.HasPrefix(line, "\"") {
			// 找到键的结束位置 (从第1个字符后开始查找第一个引号)
			keyEnd := strings.Index(line[1:], "\"")
			if keyEnd == -1 {
				continue
			}
			keyEnd++ // 调整索引，因为我们切片了

			key = line[1:keyEnd]

			// 找到值的开始位置 (必须在键之后)
			if keyEnd+1 >= len(line) {
				continue
			}
			remainder := line[keyEnd+1:]

			valStart := strings.Index(remainder, "\"")
			if valStart == -1 {
				continue
			}

			// 找到值的结束位置
			valEnd := strings.LastIndex(remainder, "\"")
			// 确保 valEnd 严格大于 valStart
			if valEnd <= valStart {
				continue
			}

			value = remainder[valStart+1 : valEnd]

		} else {
			// key "value" 模式 (遗留/宽松)
			// 确保不以 { 或 } 开头，这些是结构标记
			if strings.HasPrefix(line, "{") || strings.HasPrefix(line, "}") {
				continue
			}

			// 找到值的开始位置
			valStart := strings.Index(line, "\"")
			if valStart == -1 {
				continue
			}

			key = strings.TrimSpace(line[:valStart])

			valEnd := strings.LastIndex(line, "\"")
			if valEnd <= valStart {
				continue
			}

			value = line[valStart+1 : valEnd]
		}

		// 根据键设置对应的值
		switch strings.ToLower(key) {
		case "addontitle":
			vpkFile.Title = value
		case "addonauthor":
			vpkFile.Author = value
		case "addonversion":
			vpkFile.Version = value
		case "addondescription":
			vpkFile.Desc = value
		case "addonurl0":
			vpkFile.AddonURL0 = value
		}
	}
}
