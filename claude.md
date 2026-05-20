# CLAUDE.md

这是本仓库的 agent 入口文件。任何 coding agent 在修改代码前都应先阅读本文件，了解项目定位、目录结构、构建验证方式和协作约定。

## 项目概述

LytVPK 是一个面向 Left 4 Dead 2 的 Windows 桌面端 VPK Mod 管理器。项目基于 Wails v2 构建：Go 负责桌面端后端、文件系统、网络、解析和系统集成；前端使用 Vite、原生 JavaScript 和 CSS 实现界面。

核心能力包括：扫描和解析 `.vpk` 文件、识别地图/人物/武器等内容类型、管理标签和启用状态、导入 VPK 或压缩包、下载 Steam 创意工坊 Mod、浏览服务器、检测和执行应用更新。

## 技术栈

- Go 1.24，模块名为 `vpk-manager`
- Wails v2.10.2
- 前端：Vite 3、原生 JavaScript、按功能拆分的 CSS
- 发布：推送 `v*` tag 后由 GitHub Actions 在 Windows 环境构建
- 主要依赖：
  - `git.lubar.me/ben/valve`：VPK 解析
  - `github.com/panjf2000/ants/v2`：协程池
  - `github.com/go-resty/resty/v2`：HTTP 请求
  - `github.com/bodgit/sevenzip`、`github.com/nwaples/rardecode` 等：压缩包处理

## 文件结构

```text
.
├── main.go                         # Wails 入口，绑定后端 App，嵌入 frontend/dist
├── go.mod / go.sum                 # Go 模块与依赖
├── wails.json                      # Wails 构建、前端安装和开发配置
├── README.md                       # 面向用户的项目说明
├── AGENTS.md                       # 面向 agent 的项目入口说明
├── claude.md                       # 既有 agent 备注，要求修改后用 wails build 验证
├── .github/workflows/release.yml   # Windows Release 构建流程
├── build/                          # Wails 构建资源、图标、平台配置
├── frontend/                       # Vite 前端应用
│   ├── package.json                # 前端脚本和依赖
│   ├── index.html                  # 前端 HTML 入口
│   ├── src/
│   │   ├── js/
│   │   │   ├── main.js             # 前端 JS 入口
│   │   │   ├── core/               # UI shell、配置、主题、toast、工具函数
│   │   │   └── features/           # 业务功能：mods、downloads、workshop、servers、settings 等
│   │   ├── css/                    # 全局、布局、页面和功能样式
│   │   └── assets/                 # 图片和字体资源
│   ├── wailsjs/                    # Wails 生成的 JS/TS 绑定，通常不要手动修改
│   └── scripts/                    # 前端辅助脚本
├── internal/
│   ├── app/                        # Wails 绑定的后端 App 方法和业务流程
│   ├── parser/                     # VPK 解析、内容检测、标签、地图/武器/人物识别
│   ├── network/                    # Steam 图片代理、IP 优选等网络辅助逻辑
│   └── platform/                   # Windows 协议、注册表等平台集成
└── worker/                         # Steam Workshop 和网络相关外部脚本
```

## 构建与测试

除特别说明外，命令都在仓库根目录执行。

### 首次准备

`wails build` 会根据 `wails.json` 执行 `frontend:install`。

### 本地开发

```powershell
wails dev
```

该命令会启动 Wails 桌面应用，并按 `wails.json` 配置启动 Vite watcher。

### 验证命令

```powershell
wails build
```
在 Codex 受限沙箱中，`wails build` 会访问 `%LOCALAPPDATA%\go-build`，通常会因沙箱权限报 `Access is denied`。需要验证构建时，直接以提权方式运行 `wails build`，不要先在普通沙箱里试跑一次。
该命令会执行完整构建流程，验证前后端集成和产物正确性。
不需要分别再执行`npm run build`和`gp build .`。

### 发布构建

发布流程在推送 `v*` tag 时触发，运行环境为 `windows-latest`，使用 Go 1.24、Node.js 20 和 Wails v2.10.2。核心构建命令为：

```powershell
wails build -platform windows/amd64 -ldflags "-X main.AppVersion=<version>" -o "LytVPK MOD管理器.exe"
```

`main.AppVersion` 本地默认值为 `0.0.0`，发布时通过 `-ldflags` 注入版本号。

## 修改约定

- 修改前先阅读相关文件，并查看 `git status --short`，不要回退用户已有改动。
- 保持改动小而聚焦，优先沿用现有代码风格和文件组织。
- Go 代码修改后运行 `gofmt`。
- 前端保持原生 JavaScript + CSS 的组织方式，不引入框架级依赖，除非任务明确要求。
- 前端调用后端应通过 `frontend/wailsjs` 生成的绑定；后端导出给前端的方法主要位于 `internal/app`。
- 通常不要手动编辑 `frontend/wailsjs`。如果新增或修改后端导出模型/方法，需要通过 Wails 重新生成绑定。
- VPK 解析、标签解析和内容识别优先复用 `internal/parser` 中的现有工具，不要复制一套临时字符串解析逻辑。
- 该应用主要面向 Windows 10/11，涉及路径、注册表、URL protocol、打包和文件操作时要优先考虑 Windows 行为。
- 后端很多操作会移动、重命名或删除用户的 Mod 文件。除非用户明确要求，避免破坏性行为，并保留清晰的错误处理。
- 大文件中也尽量做局部修改，不做无关重构。

## 后端要点

- `main.go` 创建 Wails 应用，嵌入 `frontend/dist`，绑定 `internal/app.App`，开启文件拖拽，并执行单例检测。
- `internal/app` 是主要业务层，包含扫描、导入、压缩包处理、下载、创意工坊、服务器、设置、更新和生命周期逻辑。
- `internal/parser` 负责 VPK 检查和内容分类。当前主标签包括 `地图`、`人物`、`武器`、`其他`。
- `internal/network` 提供本地图片代理和 IP 优选能力，主要服务于 Steam 图片和网络请求。
- 配置文件写入用户配置目录下的 `LytVPK/config.json`。

## 前端要点

- `frontend/src/js/main.js` 是前端入口。
- `frontend/src/js/core` 放置 UI shell、主题、toast、配置和通用工具。
- `frontend/src/js/features` 按业务功能拆分。新增功能时优先放到对应 feature 模块，而不是增加全局逻辑。
- CSS 分为全局/布局/页面样式和功能样式，优先复用已有 CSS 变量和命名习惯。
- UI 修改要考虑 Wails 桌面窗口尺寸，避免文字溢出、按钮错位和固定尺寸控件抖动。

## Agent 工作流

1. 先读相关代码，再动手。
2. 用 `git status --short` 确认工作区状态。
3. 实施最小可行改动。
4. 对改过的 Go 文件运行 `gofmt`。
5. 先跑与改动最相关的验证命令；涉及应用行为时，最后优先跑 `wails build`。
6. 最终回复中说明改了什么、验证了什么、哪些命令因环境限制未能运行。

## 常见注意事项

- Go 会嵌入 `frontend/dist`。如果前端产物缺失或过期，请运行 `npm run build`。
- 修改导出的后端方法或模型后，Wails 绑定可能需要重新生成。
- 创意工坊、图片代理和服务器查询依赖外部网络，在受限环境中可能无法完整验证。
- 文件移动、删除、重命名会影响用户真实 addon 目录，新增相关逻辑时要谨慎。
- 当前没有 Go 单元测试，所以 `go test ./...` 通过不等同于完整集成验证。
