# internal/parser 知识库

**领域**: VPK 文件解析与内容类型识别引擎

## 概述

`internal/parser` 负责 VPK 文件解析、内容类型自动识别（地图/人物/武器/其他）、标签提取和预览图生成。优先复用现有工具，禁止复制临时字符串解析逻辑。

## 文件组织

```
internal/parser/
├── parser.go           # 主入口 ParseVPKFile()、预览图提取、addoninfo 解析
├── types.go            # VPKFile、ChapterInfo 等核心数据结构
├── detector.go         # 内容类型判定（.bsp→地图，survivor→人物，weapon→武器）
├── asset_scope.go      # 角色证据路径判定：界面/HUD 资源不参与角色识别
├── map_parser.go       # 地图解析：通过 vpkmission 读取 mission.txt，提取战役/章节/模式
├── character_parser.go # 人物解析：8 个幸存者/感染者类型识别
├── weapon_parser.go    # 武器解析：40+ 武器名称匹配
└── tag_parser.go       # 文件名标签解析 `[_][标签1,标签2]文件名.vpk`
```

## 查询指南

| 任务 | 目标文件 | 备注 |
|------|----------|------|
| 新增 VPK 内容类型 | `detector.go` + 新增 `*_parser.go` | 遵循现有 detector→parser 流程 |
| 修改标签规则 | `tag_parser.go` | 前缀 `_` 表示隐藏，逗号分隔 |
| 修改地图识别 | `map_parser.go` | 复用 `l4d2-manager-next/pkg/vpkmission` 解析 mission.txt |
| 修改人物识别 | `character_parser.go` | 幸存者英文名映射（如 ellis/mechanic→Ellis），关键词表顺序即优先级 |
| 修改角色判定证据 | `asset_scope.go` | 界面/HUD 目录不参与角色识别，主标签与子标签共用同一口径 |
| 修改武器识别 | `weapon_parser.go` | 从 addoninfo 文本正则匹配 |
| 修改核心数据结构 | `types.go` | VPKFile 是前后端传输主结构 |

## 约定

- **解析流程**: `ParseVPKFile()` → `DetermineVPKType()` → `ExtractVPKResources()` → 专门 Parser
- **角色证据口径**: 判定主标签（`detector.go`）与提取子标签（`character_parser.go`）必须共用 `isCharacterAssetPath()`。`materials/vgui/`、`resource/`、`scripts/`、`particles/`、`sound/ui/` 下的资源不得作为角色证据——HUD 必然引用角色名，否则界面 Mod 会被判成人物
- **关键词表顺序**: 角色/武器关键词表用有序切片而非 map，顺序即优先级，具体关键词（如 `common_male_ceda`）必须排在笼统关键词（如 `common`）之前
- **mission 解析**: `map_parser.go` 只做本项目结构转换和模式名翻译，底层解析复用 `l4d2-manager-next/pkg/vpkmission`
- **单次遍历优化**: `ExtractVPKResources()` 同时提取预览图和 addoninfo，不重复读取 archive
- **标签格式**: 文件名中 `[_][标签1,标签2] 实际文件名.vpk`，`_` 前缀表隐藏
- **预览图查找**: 三级策略 archive → filesystem → addoninfo 占位图

## 反模式

- ❌ **禁止复制临时字符串解析逻辑** — 已有工具必须复用
- ❌ **禁止修改 VPKFile 结构后不同时更新前端类型定义** — 前后端通过 Wails 绑定传输
- ⚠️ **正则表达式全局变量非并发安全** — `tagRegex` 等不可在并发中修改
