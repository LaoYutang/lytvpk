package app

import (
	"bytes"
	"fmt"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/transform"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"
)

type AddonListItem struct {
	Name  string
	Value string
}

// readAddonList 读取并解析 addonlist.txt
func (a *App) readAddonList() ([]AddonListItem, string, error) {
	if a.rootDir == "" {
		return nil, "", fmt.Errorf("未选择L4D2目录")
	}

	parentDir := filepath.Dir(a.rootDir)
	addonListPath := filepath.Join(parentDir, "addonlist.txt")

	if _, err := os.Stat(addonListPath); os.IsNotExist(err) {
		return nil, addonListPath, fmt.Errorf("addonlist.txt 不存在")
	}

	content, err := os.ReadFile(addonListPath)
	if err != nil {
		return nil, addonListPath, fmt.Errorf("无法读取 addonlist.txt: %v", err)
	}

	// 处理 BOM
	if len(content) >= 3 && content[0] == 0xEF && content[1] == 0xBB && content[2] == 0xBF {
		content = content[3:]
	}

	// 转码
	var contentStr string
	if !utf8.Valid(content) {
		reader := transform.NewReader(bytes.NewReader(content), simplifiedchinese.GBK.NewDecoder())
		decoded, err := io.ReadAll(reader)
		if err == nil {
			contentStr = string(decoded)
		} else {
			contentStr = string(content)
		}
	} else {
		contentStr = string(content)
	}

	// 解析
	var list []AddonListItem
	lines := strings.Split(contentStr, "\n")
	kvRegex := regexp.MustCompile(`"([^"]+)"\s+"([^"]+)"`)
	inBlock := false

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "//") {
			continue
		}
		if strings.Contains(line, "\"AddonList\"") {
			continue
		}
		if strings.Contains(line, "{") {
			inBlock = true
			continue
		}
		if strings.Contains(line, "}") {
			inBlock = false
			continue
		}

		if inBlock {
			matches := kvRegex.FindStringSubmatch(line)
			if len(matches) == 3 {
				list = append(list, AddonListItem{
					Name:  matches[1],
					Value: matches[2],
				})
			}
		}
	}

	return list, addonListPath, nil
}

// writeAddonList 写入 addonlist.txt
func (a *App) writeAddonList(path string, list []AddonListItem) error {
	var buf bytes.Buffer
	buf.WriteString("\"AddonList\"\n{\n")
	for _, item := range list {
		// 确保只写入文件名，不带路径
		name := filepath.Base(item.Name)
		buf.WriteString(fmt.Sprintf("\t\"%s\"\t\t\"%s\"\n", name, item.Value))
	}
	buf.WriteString("}\n")

	// 写入文件 (使用 UTF-8)
	return os.WriteFile(path, buf.Bytes(), 0644)
}

// GetVPKLoadOrder 获取 VPK 文件的加载顺序 (1-based index)
// 如果文件不在列表中，返回 -1
func (a *App) GetVPKLoadOrder(filename string) (int, error) {
	list, _, err := a.readAddonList()
	if err != nil {
		// 如果文件不存在，必须返回错误，而不是吞掉错误
		// 这样前端才能区分是"文件不存在"还是"文件不在列表中"
		return 0, err
	}

	targetName := strings.ToLower(filepath.Base(filename))
	for i, item := range list {
		if strings.ToLower(item.Name) == targetName {
			return i + 1, nil // 1-based
		}
	}

	return -1, nil
}

// SetVPKLoadOrder 设置 VPK 文件的加载顺序
func (a *App) SetVPKLoadOrder(filename string, newOrder int) error {
	list, path, err := a.readAddonList()

	// 如果文件不存在，初始化为空列表，准备新建
	if err != nil && strings.Contains(err.Error(), "不存在") {
		list = []AddonListItem{}
		// 重新计算路径，因为 readAddonList 出错时可能返回了空路径或正确路径
		// 既然 readAddonList 返回了 path，我们就用它
		if path == "" {
			parentDir := filepath.Dir(a.rootDir)
			path = filepath.Join(parentDir, "addonlist.txt")
		}
	} else if err != nil {
		return err
	}

	targetName := filepath.Base(filename)
	lowerTargetName := strings.ToLower(targetName)

	// 1. 先查找并移除已存在的条目
	var existingItem AddonListItem
	found := false
	cleanList := make([]AddonListItem, 0, len(list))

	for _, item := range list {
		if strings.ToLower(item.Name) == lowerTargetName {
			existingItem = item
			found = true
		} else {
			cleanList = append(cleanList, item)
		}
	}

	// 如果没找到，创建一个新的，默认为开启状态 "1"
	if !found {
		existingItem = AddonListItem{
			Name:  targetName,
			Value: "1",
		}
	}

	// 2. 确定插入位置
	// newOrder 是 1-based
	// 转换到 0-based slice index
	index := newOrder - 1

	if index < 0 {
		index = 0
	}
	if index > len(cleanList) {
		index = len(cleanList)
	}

	// 3. 插入
	finalList := make([]AddonListItem, 0, len(cleanList)+1)
	finalList = append(finalList, cleanList[:index]...)
	finalList = append(finalList, existingItem)
	finalList = append(finalList, cleanList[index:]...)

	// 4. 写入文件
	return a.writeAddonList(path, finalList)
}

// GetAddonListOrder 读取并解析 addonlist.txt 获取加载顺序
func (a *App) GetAddonListOrder() ([]string, error) {
	if a.rootDir == "" {
		return nil, fmt.Errorf("未选择L4D2目录")
	}

	// 1. 尝试在 addons 文件夹同级查找 (优先，根据用户要求)
	// a.rootDir 是 addons 目录
	parentDir := filepath.Dir(a.rootDir)
	addonListPath := filepath.Join(parentDir, "addonlist.txt")

	// 检查同级文件是否存在
	if _, err := os.Stat(addonListPath); os.IsNotExist(err) {
		return nil, fmt.Errorf("找不到 addonlist.txt 文件 (在 %s)", addonListPath)
	}

	content, err := os.ReadFile(addonListPath)
	if err != nil {
		return nil, fmt.Errorf("无法读取 addonlist.txt: %v", err)
	}

	// 处理 BOM (UTF-8 BOM: EF BB BF)
	if len(content) >= 3 && content[0] == 0xEF && content[1] == 0xBB && content[2] == 0xBF {
		content = content[3:]
	}

	// 尝试转码：如果不是有效的 UTF-8，尝试 GBK
	var contentStr string
	if !utf8.Valid(content) {
		// 尝试 GBK 解码
		reader := transform.NewReader(bytes.NewReader(content), simplifiedchinese.GBK.NewDecoder())
		decoded, err := io.ReadAll(reader)
		if err == nil {
			contentStr = string(decoded)
		} else {
			// 如果 GBK 解码也失败，就回退到原始字节转换（虽然可能是乱码）
			contentStr = string(content)
		}
	} else {
		contentStr = string(content)
	}

	// 解析文件
	var order []string
	lines := strings.Split(contentStr, "\n")

	// 正则表达式匹配键值对: "key" "value"
	kvRegex := regexp.MustCompile(`"([^"]+)"\s+"([^"]+)"`)

	inBlock := false

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "//") {
			continue
		}

		// 简单的状态机处理 AddonList 块
		if strings.Contains(line, "\"AddonList\"") {
			continue
		}
		if strings.Contains(line, "{") {
			inBlock = true
			continue
		}
		if strings.Contains(line, "}") {
			inBlock = false
			continue
		}

		if inBlock {
			matches := kvRegex.FindStringSubmatch(line)
			if len(matches) == 3 {
				filename := matches[1]
				// 只有启用的插件("1")才会被计入顺序？
				// 用户只给了文件格式，没说只排启用的。
				// 通常 addonlist.txt 包含所有插件的状态。
				// 既然是"按加载顺序排序"，那就是文件在 addonlist.txt 中出现的顺序。
				// 不管值是 "1" 还是 "0"。
				// 但通常 addonlist.txt 的顺序就是加载顺序吗？
				// L4D2 实际上是按字母顺序加载 VPK 的，除非 addonlist.txt 指定了顺序？
				// 实际上 addonlist.txt 主要是开关。
				// 但是用户想"按加载顺序排序"，可能用户认为 addonlist.txt 的顺序就是加载顺序，或者想要这个特定的顺序。
				// 我就按文件里出现的顺序返回。

				order = append(order, filename)
			}
		}
	}

	if len(order) == 0 {
		return nil, fmt.Errorf("解析 addonlist.txt 失败或未找到任何条目")
	}

	return order, nil
}
