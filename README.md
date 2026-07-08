# LytVPK

一个专为 Left 4 Dead 2 (L4D2) 设计的现代化 VPK 插件管理工具。
> 该项目通篇使用AI生成，本人只在AI陷入困境时进行少量修改。仔细阅读代码你就会发现大量无用变量、不符合规范的函数定义，一个文件几千行的屎山，均不代表本人水平，谢谢！

![LytVPK](https://img.shields.io/badge/Platform-Windows-blue)
![Build](https://img.shields.io/badge/Build-Wails_v2-green)
![Language](https://img.shields.io/badge/Language-Go_+_JavaScript-orange)
![License](https://img.shields.io/badge/License-GPL--3.0--only-blue)

## 📖 使用文档

完整使用说明请查看：[https://lytvpk-docs.laoyutang.cn](https://lytvpk-docs.laoyutang.cn)

## 🚀 功能特性

### 核心功能
- **智能扫描**: 自动扫描和解析 VPK 文件，提取详细的内容信息
- **内容识别**: 智能识别地图、武器、角色、音频等游戏内容类型
- **标签系统**: 自动生成标签，支持按类型、位置、内容筛选
- **批量管理**: 支持批量启用/禁用 VPK 文件
- **文件导入**: 支持拖拽或选择文件导入 VPK/压缩包 到 addons 目录
- **创意工坊下载**: 支持解析创意工坊链接，直接下载并安装 Mod
- **服务器浏览器**: 支持查询服务器信息、玩家列表，一键连接服务器，收藏常用服务器
- **自动更新**: 启动时自动检测新版本，支持国内镜像源加速下载，一键无感更新

## 🛠️ 技术架构

### 后端 (Go)
- **框架**: Wails v2
- **VPK解析**: 使用 `l4d2-manager-next/pkg/valve/vpk` 和 `l4d2-manager-next/pkg/vpkmission`
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

### 使用说明
1. **选择目录**: 点击"选择L4D2目录"按钮，选择游戏的 addons 文件夹
2. **扫描文件**: 应用会自动扫描并解析所有 VPK 文件
3. **管理插件**: 使用界面上的开关来启用/禁用插件
4. **筛选搜索**: 使用搜索框和标签筛选来查找特定插件
5. **批量操作**: 选择多个文件进行批量启用/禁用
6. **导入文件**: 点击上传按钮或直接拖拽文件到窗口即可导入
7. **下载 Mod**: 输入创意工坊链接，点击下载即可自动安装
8. **服务器连接**: 在服务器页面添加 IP，查看状态并一键连接
9. **版本更新**: 应用启动会自动检查更新，发现新版本会提示升级

## 🙏 致谢

- [Wails](https://wails.io/) - 跨平台应用框架
- [l4d2-server-next](https://github.com/LaoYutang/l4d2-server-next/tree/master/backend/pkg) - VPK 与 mission 文件解析库
- [ants](https://github.com/panjf2000/ants) - 高性能协程池

## 📄 开源协议

本项目自 2026-06-29 起以 [GNU General Public License v3.0 only](./LICENSE) 授权发布。

分发二进制、修改版或衍生版本时，请遵守 GPLv3 关于对应源码、版权声明、许可证文本和修改说明等要求。第三方依赖与资源遵循各自许可证。
