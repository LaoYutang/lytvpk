# LytVPK

一个专为 Left 4 Dead 2 (L4D2) 设计的现代化 VPK 插件管理工具。

![LytVPK](https://img.shields.io/badge/Platform-Windows-blue)
![Build](https://img.shields.io/badge/Build-Wails_v2-green)
![Language](https://img.shields.io/badge/Language-Go_+_JavaScript-orange)

## 🚀 功能特性

### 核心功能
- **智能扫描**: 自动扫描和解析 VPK 文件，提取详细的内容信息
- **内容识别**: 智能识别地图、武器、角色、音频等游戏内容类型
- **标签系统**: 自动生成标签，支持按类型、位置、内容筛选
- **批量管理**: 支持批量启用/禁用 VPK 文件
- **文件操作**: 安全的文件移动、备份和导出功能

### 用户体验
- **现代界面**: 基于深色主题的现代化用户界面
- **响应式设计**: 适配不同屏幕尺寸的自适应布局
- **实时反馈**: 扫描进度实时显示，操作结果即时通知
- **原生对话框**: 使用系统原生文件选择对话框

### 高级功能
- **配置管理**: 自动保存用户配置和偏好设置
- **备份系统**: 支持 VPK 列表备份和恢复
- **错误处理**: 完善的错误捕获和用户友好的提示
- **性能优化**: 使用协程池优化大量文件的处理性能

## 🎮 支持的内容类型

### 地图和模式
- 战役模式 (Campaign)
- 对抗模式 (Versus) 
- 生存模式 (Survival)
- 清道夫模式 (Scavenge)
- 突变模式 (Mutation)
- 写实模式 (Realism)

### 武器类型
- 步枪、突击步枪、狙击枪
- 霰弹枪、手枪、冲锋枪
- 近战武器：匕首、斧头、电锯、砍刀等

### 角色模型  
- **幸存者**: Bill, Francis, Louis, Zoey, Coach, Ellis, Nick, Rochelle
- **感染者**: Boomer, Hunter, Smoker, Witch, Tank, Charger, Jockey, Spitter

### 其他内容
- 音频文件（音乐、语音、音效、环境音）
- 材质文件（皮肤、界面、粒子效果）
- 脚本文件（Squirrel脚本、配置文件）
- UI界面和特效文件

## 🛠️ 技术架构

### 后端 (Go)
- **框架**: Wails v2
- **VPK解析**: 使用 `git.lubar.me/ben/valve/vpk` 库
- **并发处理**: `github.com/panjf2000/ants/v2` 协程池
- **配置管理**: JSON 格式的持久化配置

### 前端 (JavaScript + CSS)
- **原生 JavaScript**: 无框架依赖，轻量高效
- **现代 CSS**: 基于 CSS 变量的设计系统
- **响应式设计**: 支持桌面端和移动端
- **实时通信**: 通过 Wails 事件系统与后端通信

## 📦 安装和使用

### 系统要求
- Windows 10/11
- .NET Framework 4.7.2 或更高版本

### 开发环境
```bash
# 克隆项目
git clone <repository-url>
cd vpk-manager

# 安装依赖
go mod tidy

# 开发模式运行
wails dev

# 构建生产版本
wails build
```

### 使用说明
1. **选择目录**: 点击"选择L4D2目录"按钮，选择游戏的 addons 文件夹
2. **扫描文件**: 应用会自动扫描并解析所有 VPK 文件
3. **管理插件**: 使用界面上的开关来启用/禁用插件
4. **筛选搜索**: 使用搜索框和标签筛选来查找特定插件
5. **批量操作**: 选择多个文件进行批量启用/禁用

## 📂 项目结构

```
vpk-manager/
├── app.go              # 主应用逻辑
├── main.go             # 程序入口
├── go.mod              # Go 依赖管理
├── wails.json          # Wails 配置
├── frontend/           # 前端文件
│   ├── index.html      # 主页面
│   └── src/
│       ├── main.js     # JavaScript 逻辑
│       ├── app.css     # 样式文件
│       └── style.css   # 基础样式
├── build/              # 构建配置
└── IMPROVEMENTS.md     # 改进文档
```

## 🔧 配置文件

应用配置存储在用户目录：
```
~/.vpk-manager/
├── config.json        # 用户配置
└── backups/           # VPK列表备份
    └── vpk_backup_*.json
```

配置选项：
- `defaultDirectory`: 默认扫描目录
- `theme`: 主题设置（目前支持深色主题）
- `language`: 语言设置
- `autoScan`: 启动时自动扫描

## 🚀 最新改进

本次更新包含了以下重要改进：

### ✨ 用户体验升级
- 全新的现代化深色主题界面
- 原生文件夹选择对话框
- 实时进度显示和状态通知
- 响应式布局适配多种设备

### 🧠 智能化功能
- 大幅提升的 VPK 内容识别能力
- 智能标签分类和筛选系统
- 自动配置保存和恢复
- 完善的错误处理和日志记录

### ⚡ 性能优化
- 协程池优化并发处理性能
- 高效的文件扫描和解析算法
- 优化的前端渲染性能
- 内存使用优化

### 🛡️ 稳定性提升
- 统一的错误处理机制
- 安全的文件操作
- 完善的备份和恢复功能
- 配置文件容错处理

## 📝 更新日志

### v2.0.0 (2024-10-13)
- 🎨 全新现代化界面设计
- 🚀 重构 VPK 解析引擎，支持更多内容类型
- ⚙️ 添加配置文件管理系统
- 💾 实现备份和导出功能
- 🐛 完善错误处理和日志系统
- 📱 响应式设计，支持多种屏幕尺寸

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

本项目采用 MIT 许可证。

## 🙏 致谢

- [Wails](https://wails.io/) - 跨平台应用框架
- [valve/vpk](https://git.lubar.me/ben/valve) - VPK 文件解析库
- [ants](https://github.com/panjf2000/ants) - 高性能协程池
