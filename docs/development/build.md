# 文档站构建

文档站是根目录下独立的 VitePress 项目。

## 安装依赖

```powershell
cd docs
npm install
```

## 本地预览

```powershell
npm run docs:dev
```

默认会启动 VitePress 开发服务器，终端会显示访问地址。

## 构建静态站点

```powershell
npm run docs:build
```

构建产物位于：

```text
docs/.vitepress/dist
```

该目录是生成产物，不需要提交到仓库。

## 预览构建产物

```powershell
npm run docs:preview
```

## 项目验证命令

文档站不依赖 Wails 运行时。修改应用代码时，可以按需要运行：

```powershell
go test ./...
wails build
```

在受限环境中，`wails build` 可能因为权限问题失败，需要在本机正常权限下重新验证。
