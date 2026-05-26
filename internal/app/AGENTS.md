# internal/app 知识库

**领域**: Wails 后端绑定层与核心业务逻辑

## 概述

`internal/app` 是前后端交互的唯一入口，通过 Wails 将 208 个方法暴露给前端。包含 VPK 扫描、创意工坊、服务器查询、冲突检测、配置管理等全部业务逻辑。

## 文件组织

```
internal/app/
├── app.go                  # App 结构体定义和生命周期方法
├── vpk_scan.go             # VPK 扫描、缓存、搜索（核心入口）
├── vpk_actions.go          # 文件操作：启用/禁用/移动/删除/重命名
├── config.go               # 配置读写、迁移（当前版本 v2）
├── workshop.go             # 创意工坊 API 交互和下载任务管理
├── workshop_download.go    # 下载逻辑（大文件 520+ 行）
├── workshop_browser.go     # 工坊浏览器数据获取
├── servers.go              # A2S 协议服务器查询
├── conflict.go             # Mod 冲突检测与严重程度分级
├── panel_upload.go         # 文件上传/导入面板（大文件 823 行）
├── problem_scan.go         # 问题 Mod 扫描
├── update.go               # 应用自更新和 Mod 更新检测
├── app_map.go              # 地图列表外部 API
├── lifecycle.go            # 启动/关闭钩子
├── singleton.go            # TCP 端口单例（127.0.0.1:19527）
├── filesystem.go           # 文件系统工具：Steam 路径检测等
└── *_test.go               # 单元测试文件（共 4 个）
```

## 查询指南

| 任务 | 目标文件 | 备注 |
|------|----------|------|
| 修改 VPK 扫描逻辑 | `vpk_scan.go` | 缓存逻辑在此，基于文件修改时间+大小校验 |
| 修改文件操作 | `vpk_actions.go` | 涉及 `os.Rename`/`os.Remove`，需谨慎处理错误 |
| 修改创意工坊下载 | `workshop_download.go` | 大文件，注意并发安全 |
| 修改配置格式 | `config.go` | 修改后需更新 `MigrationVersion` 并写迁移逻辑 |
| 修改服务器查询 | `servers.go` | A2S 协议，硬编码延迟 `200*(i+1)` |
| 修改冲突检测 | `conflict.go` | 三级严重程度：critical/warning/info |
| 新增 Wails 导出方法 | `app.go` 或对应功能文件 | 新增后需重新生成 `frontend/wailsjs` 绑定 |
| 修改单例行为 | `singleton.go` | TCP 端口 19527 硬编码，URL Protocol 深度链接 |

## 约定

- **文件命名**: 按功能前缀分组：`workshop_*.go`、`vpk_*.go`、`panel_*.go`、`secret_*.go`
- **平台隔离**: `secret_windows.go` / `secret_other.go` 用构建标签分离
- **错误处理**: 用户文件操作（移动/删除/重命名）必须返回清晰错误信息
- **并发**: 优先使用 `a.goroutinePool.Submit()`，避免裸 `go func()`

## 反模式

- ❌ **禁止直接修改 `frontend/wailsjs`** — Wails 自动生成，会被覆盖
- ❌ **禁止在业务逻辑中硬编码 URL** — 所有外部 API 应提取为常量
- ❌ **禁止字符串拼接路径** — 使用 `filepath.Join`，考虑 Windows 特殊性
- ❌ **新增代码不要使用裸 goroutine** — 使用协程池管理并发
- ⚠️ **文件操作必须处理错误** — 当前部分代码缺少完整的错误分支
