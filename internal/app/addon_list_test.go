package app

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"

	"golang.org/x/text/encoding/simplifiedchinese"
)

const addonListTestText = "\"AddonList\"\n{\n\t\"星雪特效平台整合版.vpk\"\t\t\"1\"\n\t\"Leek Crowbar.vpk\"\t\t\"1\"\n}\n"

func newAddonListTestApp(t *testing.T) (*App, string) {
	t.Helper()

	root := t.TempDir()
	addonsDir := filepath.Join(root, "addons")
	if err := os.MkdirAll(addonsDir, 0755); err != nil {
		t.Fatalf("创建 addons 目录失败: %v", err)
	}

	return &App{rootDir: addonsDir}, filepath.Join(root, "addonlist.txt")
}

// encodeAddonListFixture 独立于被测代码生成不同编码的测试文件
func encodeAddonListFixture(t *testing.T, text string, encoding addonListEncoding) []byte {
	t.Helper()

	switch encoding {
	case addonListEncodingANSI:
		data, err := simplifiedchinese.GBK.NewEncoder().Bytes([]byte(text))
		if err != nil {
			t.Fatalf("GBK 编码测试数据失败: %v", err)
		}
		return data
	case addonListEncodingUTF8BOM:
		return append([]byte{0xEF, 0xBB, 0xBF}, []byte(text)...)
	default:
		return []byte(text)
	}
}

func assertAddonListItems(t *testing.T, text string, want []string) {
	t.Helper()

	items := parseAddonList(text)
	if len(items) != len(want) {
		t.Fatalf("条目数 = %d, want %d, 内容: %q", len(items), len(want), text)
	}

	for i, name := range want {
		if items[i].Name != name {
			t.Fatalf("第 %d 条 = %q, want %q", i+1, items[i].Name, name)
		}
		if items[i].Value != "1" {
			t.Fatalf("第 %d 条的值 = %q, want 1", i+1, items[i].Value)
		}
	}
}

func TestSetVPKLoadOrderKeepsOriginalEncoding(t *testing.T) {
	cases := []struct {
		name     string
		encoding addonListEncoding
	}{
		{"ansi", addonListEncodingANSI},
		{"utf8", addonListEncodingUTF8},
		{"utf8-bom", addonListEncodingUTF8BOM},
	}

	wantOrder := []string{"Leek Crowbar.vpk", "星雪特效平台整合版.vpk"}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			app, path := newAddonListTestApp(t)
			if err := os.WriteFile(path, encodeAddonListFixture(t, addonListTestText, tc.encoding), 0644); err != nil {
				t.Fatalf("写入测试文件失败: %v", err)
			}

			// 把中文条目从第 1 位移动到第 2 位
			if err := app.SetVPKLoadOrder("星雪特效平台整合版.vpk", 2); err != nil {
				t.Fatalf("SetVPKLoadOrder 失败: %v", err)
			}

			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatalf("读取结果失败: %v", err)
			}

			switch tc.encoding {
			case addonListEncodingANSI:
				if utf8.Valid(data) {
					t.Fatalf("期望保持 ANSI(GBK) 编码，但结果是合法 UTF-8")
				}
				decoded, err := simplifiedchinese.GBK.NewDecoder().Bytes(data)
				if err != nil {
					t.Fatalf("结果不是合法 GBK: %v", err)
				}
				assertAddonListItems(t, string(decoded), wantOrder)
			case addonListEncodingUTF8BOM:
				if !bytes.HasPrefix(data, []byte{0xEF, 0xBB, 0xBF}) {
					t.Fatalf("期望保留 UTF-8 BOM")
				}
				assertAddonListItems(t, string(data[3:]), wantOrder)
			default:
				if !utf8.Valid(data) {
					t.Fatalf("期望保持 UTF-8 编码")
				}
				if bytes.HasPrefix(data, []byte{0xEF, 0xBB, 0xBF}) {
					t.Fatalf("原本没有 BOM 的文件不应被写入 BOM")
				}
				assertAddonListItems(t, string(data), wantOrder)
			}
		})
	}
}

func TestSetVPKLoadOrderCreatesANSIFile(t *testing.T) {
	app, path := newAddonListTestApp(t)

	if err := app.SetVPKLoadOrder("星雪特效平台整合版.vpk", 1); err != nil {
		t.Fatalf("SetVPKLoadOrder 失败: %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("读取新建文件失败: %v", err)
	}
	if utf8.Valid(data) {
		t.Fatalf("新建的 addonlist.txt 应为 ANSI(GBK) 编码")
	}

	decoded, err := simplifiedchinese.GBK.NewDecoder().Bytes(data)
	if err != nil {
		t.Fatalf("新建文件不是合法 GBK: %v", err)
	}

	assertAddonListItems(t, string(decoded), []string{"星雪特效平台整合版.vpk"})
}

func TestReadAddonListHandlesBothEncodings(t *testing.T) {
	encodings := []struct {
		name     string
		encoding addonListEncoding
	}{
		{"ansi", addonListEncodingANSI},
		{"utf8", addonListEncodingUTF8},
	}

	for _, tc := range encodings {
		t.Run(tc.name, func(t *testing.T) {
			app, path := newAddonListTestApp(t)
			if err := os.WriteFile(path, encodeAddonListFixture(t, addonListTestText, tc.encoding), 0644); err != nil {
				t.Fatalf("写入测试文件失败: %v", err)
			}

			order, err := app.GetAddonListOrder()
			if err != nil {
				t.Fatalf("GetAddonListOrder 失败: %v", err)
			}
			if len(order) != 2 || order[0] != "星雪特效平台整合版.vpk" || order[1] != "Leek Crowbar.vpk" {
				t.Fatalf("顺序 = %#v", order)
			}

			index, err := app.GetVPKLoadOrder("星雪特效平台整合版.vpk")
			if err != nil {
				t.Fatalf("GetVPKLoadOrder 失败: %v", err)
			}
			if index != 1 {
				t.Fatalf("中文条目序号 = %d, want 1", index)
			}
		})
	}
}

func TestGetVPKLoadOrderMissingFile(t *testing.T) {
	app, _ := newAddonListTestApp(t)

	_, err := app.GetVPKLoadOrder("a.vpk")
	if err == nil || !strings.Contains(err.Error(), "addonlist.txt 不存在") {
		t.Fatalf("err = %v, want 包含 addonlist.txt 不存在", err)
	}
}

func TestParseAddonListAcceptsBraceOnSameLine(t *testing.T) {
	items := parseAddonList("\"AddonList\" {\n\t\"a.vpk\"\t\t\"1\"\n}\n")

	if len(items) != 1 || items[0].Name != "a.vpk" || items[0].Value != "1" {
		t.Fatalf("items = %#v", items)
	}
}
