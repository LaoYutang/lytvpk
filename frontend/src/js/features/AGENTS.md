# frontend/src/js/features 知识库

**领域**: 前端业务功能模块

## 概述

按功能拆分的前端模块，每个子目录对应一个独立业务功能。全局状态在 `state.js` 中管理，UI 渲染通过 `file-list/render.js` 驱动。新增功能优先放对应 feature 模块，禁止增加全局逻辑。

## 文件组织

```
features/
├── state.js                 # 全局状态：vpkFiles、selectedFiles、displayMode
├── app-init.js              # 应用初始化、Wails 事件监听绑定
├── app-runtime.js           # 运行时逻辑、文件拖拽处理
├── directory-dropdown.js    # 目录切换下拉
├── about/                   # 关于页面
├── conflicts/               # 冲突检测结果展示
├── downloads/               # 下载任务列表和工坊弹窗
├── file-list/               # 文件列表核心（最大模块）
│   ├── render.js            # 列表/卡片视图渲染
│   ├── events.js            # 事件绑定
│   ├── actions.js           # 操作处理
│   ├── filters.js           # 搜索和标签筛选
│   ├── sorting.js           # 排序逻辑
│   ├── tags.js              # 标签管理
│   └── context-menu.js      # 右键菜单
├── modals/                  # 通用弹窗：详情、确认、加载顺序
├── mods/                    # Mod 信息面板和轮换
├── servers/                 # 服务器浏览器（最大文件 971 行）
├── settings/                # 设置页面和问题扫描
├── update/                  # 版本更新逻辑
└── workshop/                # 创意工坊浏览器（8 个文件）
```

## 查询指南

| 任务 | 目标文件 | 备注 |
|------|----------|------|
| 修改列表/卡片渲染 | `file-list/render.js` | `createFileItem()` / `createFileCard()` |
| 修改文件操作 | `file-list/actions.js` | 调用 Wails 绑定后刷新状态 |
| 修改搜索筛选 | `file-list/filters.js` | 前端内存筛选，支持标签多选 |
| 修改 Mod 详情面板 | `mods/mod-panel.js` | 右侧信息面板渲染 |
| 修改工坊浏览器 | `workshop/*.js` | 列表/详情/侧边栏/状态分离 |
| 修改服务器功能 | `servers/servers.js` | 最大文件，修改时保持局部 |
| 修改全局状态 | `state.js` | 影响所有模块，谨慎修改 |

## 约定

- **无框架**: 原生 JavaScript，无 React/Vue/Svelte
- **状态驱动**: `state.js` 是单一数据源，修改后触发重新渲染
- **DOM 操作**: 优先使用 `createElement`/`textContent`，避免 `innerHTML`（历史遗留大量 `innerHTML`）
- **事件系统**: Wails Events 推送进度，前端 `EventsOn` 监听更新 UI
- **CSS**: 按功能拆分，复用 CSS 变量，优先使用已有命名习惯

## 反模式

- ❌ **禁止新增全局逻辑** — 新功能必须放入对应 feature 子目录
- ❌ **禁止新增 `innerHTML`** — 使用 `textContent` 或 `createElement` 防止 XSS
- ❌ **禁止新增 `console.log`** — 生产代码移除调试日志
- ⚠️ **UI 修改考虑窗口尺寸** — Wails 桌面窗口，避免文字溢出和按钮错位
- ⚠️ **大文件局部修改** — `servers.js`(971 行)、`app-runtime.js`(906 行) 只改必要部分
