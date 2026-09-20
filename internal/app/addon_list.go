package app

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/encoding/simplifiedchinese"
)

type AddonListItem struct {
	Name  string
	Value string
}

// addonListEncoding 表示 addonlist.txt 在磁盘上的编码。
// 游戏按系统 ANSI（简体中文系统为 GBK）读写该文件，如果被改成 UTF-8，
// 游戏会认为列表失效并按自己的顺序重写整个文件，因此写回时必须沿用原编码。
type addonListEncoding int

const (
	addonListEncodingANSI addonListEncoding = iota
	addonListEncodingUTF8
	addonListEncodingUTF8BOM
)

var (
	errAddonListNotFound = errors.New("addonlist.txt 不存在")
	addonListKVRegex     = regexp.MustCompile(`"([^"]+)"\s+"([^"]+)"`)
)

// addonListFile 是一次读取的结果：路径、条目和原始编码
type addonListFile struct {
	Path     string
	Items    []AddonListItem
	Encoding addonListEncoding
}

// addonListPath 返回 addonlist.txt 路径（位于 addons 目录的上一级）
func (a *App) addonListPath() (string, error) {
	if a.rootDir == "" {
		return "", fmt.Errorf("未选择L4D2目录")
	}

	return filepath.Join(filepath.Dir(a.rootDir), "addonlist.txt"), nil
}

// readAddonList 读取并解析 addonlist.txt，同时记录原始编码
func (a *App) readAddonList() (*addonListFile, error) {
	path, err := a.addonListPath()
	if err != nil {
		return nil, err
	}

	content, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, errAddonListNotFound
		}
		return nil, fmt.Errorf("无法读取 addonlist.txt: %v", err)
	}

	encoding := addonListEncodingANSI
	switch {
	case bytes.HasPrefix(content, []byte{0xEF, 0xBB, 0xBF}):
		encoding = addonListEncodingUTF8BOM
		content = content[3:]
	case utf8.Valid(content):
		encoding = addonListEncodingUTF8
	}

	return &addonListFile{
		Path:     path,
		Items:    parseAddonList(decodeAddonListText(content, encoding)),
		Encoding: encoding,
	}, nil
}

// decodeAddonListText 把文件字节解码成 UTF-8 文本
func decodeAddonListText(content []byte, encoding addonListEncoding) string {
	if encoding != addonListEncodingANSI {
		return string(content)
	}

	decoded, err := simplifiedchinese.GBK.NewDecoder().Bytes(content)
	if err != nil {
		// 解码失败时保留原始字节，避免直接丢内容
		return string(content)
	}

	return string(decoded)
}

// parseAddonList 解析 AddonList 块内的键值对
func parseAddonList(text string) []AddonListItem {
	var list []AddonListItem
	inBlock := false

	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "//") {
			continue
		}
		if strings.Contains(line, "}") {
			inBlock = false
			continue
		}
		if strings.Contains(line, "{") {
			inBlock = true
			continue
		}
		if !inBlock {
			continue
		}

		matches := addonListKVRegex.FindStringSubmatch(line)
		if len(matches) == 3 {
			list = append(list, AddonListItem{
				Name:  matches[1],
				Value: matches[2],
			})
		}
	}

	return list
}

// writeAddonList 按指定编码写入 addonlist.txt
func (a *App) writeAddonList(path string, list []AddonListItem, encoding addonListEncoding) error {
	var buf bytes.Buffer
	buf.WriteString("\"AddonList\"\n{\n")
	for _, item := range list {
		// 确保只写入文件名，不带路径
		name := filepath.Base(item.Name)
		buf.WriteString(fmt.Sprintf("\t\"%s\"\t\t\"%s\"\n", name, item.Value))
	}
	buf.WriteString("}\n")

	data, err := encodeAddonListText(buf.String(), encoding)
	if err != nil {
		return err
	}

	return os.WriteFile(path, data, 0644)
}

// encodeAddonListText 把文本编码成文件字节，保持原有编码与 BOM
func encodeAddonListText(text string, encoding addonListEncoding) ([]byte, error) {
	raw := []byte(text)

	switch encoding {
	case addonListEncodingUTF8BOM:
		return append([]byte{0xEF, 0xBB, 0xBF}, raw...), nil
	case addonListEncodingUTF8:
		return raw, nil
	}

	encoded, err := simplifiedchinese.GBK.NewEncoder().Bytes(raw)
	if err != nil {
		return nil, fmt.Errorf("无法按 ANSI(GBK) 编码写回 addonlist.txt: %v", err)
	}

	// GBK 无法表示的字符会被静默替换成问号，往返校验一次避免写坏文件名
	decoded, err := simplifiedchinese.GBK.NewDecoder().Bytes(encoded)
	if err != nil || string(decoded) != text {
		return nil, fmt.Errorf("addonlist.txt 中存在 GBK 无法表示的字符，无法按原编码写回")
	}

	return encoded, nil
}

// GetVPKLoadOrder 获取 VPK 文件的加载顺序 (1-based index)
// 如果文件不在列表中，返回 -1
func (a *App) GetVPKLoadOrder(filename string) (int, error) {
	file, err := a.readAddonList()
	if err != nil {
		// 如果文件不存在，必须返回错误，而不是吞掉错误
		// 这样前端才能区分是"文件不存在"还是"文件不在列表中"
		return 0, err
	}

	targetName := strings.ToLower(filepath.Base(filename))
	for i, item := range file.Items {
		if strings.ToLower(item.Name) == targetName {
			return i + 1, nil // 1-based
		}
	}

	return -1, nil
}

// SetVPKLoadOrder 设置 VPK 文件的加载顺序
func (a *App) SetVPKLoadOrder(filename string, newOrder int) error {
	file, err := a.readAddonList()
	if err != nil {
		if !errors.Is(err, errAddonListNotFound) {
			return err
		}

		// 文件不存在时从空列表开始，按游戏自身的 ANSI 编码新建
		path, pathErr := a.addonListPath()
		if pathErr != nil {
			return pathErr
		}
		file = &addonListFile{Path: path, Encoding: addonListEncodingANSI}
	}

	targetName := filepath.Base(filename)
	lowerTargetName := strings.ToLower(targetName)

	// 1. 先查找并移除已存在的条目
	var existingItem AddonListItem
	found := false
	cleanList := make([]AddonListItem, 0, len(file.Items))

	for _, item := range file.Items {
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

	// 4. 写入文件，沿用原编码
	return a.writeAddonList(file.Path, finalList, file.Encoding)
}

// GetAddonListOrder 读取并解析 addonlist.txt 获取加载顺序
func (a *App) GetAddonListOrder() ([]string, error) {
	file, err := a.readAddonList()
	if err != nil {
		if errors.Is(err, errAddonListNotFound) {
			path, pathErr := a.addonListPath()
			if pathErr != nil {
				return nil, pathErr
			}
			return nil, fmt.Errorf("找不到 addonlist.txt 文件 (在 %s)", path)
		}
		return nil, err
	}

	// 按文件里的出现顺序返回，"1"（启用）和"0"（禁用）都计入
	order := make([]string, 0, len(file.Items))
	for _, item := range file.Items {
		order = append(order, item.Name)
	}

	if len(order) == 0 {
		return nil, fmt.Errorf("解析 addonlist.txt 失败或未找到任何条目")
	}

	return order, nil
}
