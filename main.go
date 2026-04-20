package main

import (
	"embed"
	"os"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

// AppVersion 版本号，会在编译时通过 -ldflags 注入
var AppVersion = "0.0.0"

const (
	// GithubRepo GitHub 仓库地址 "用户名/仓库名"
	GithubRepo = "LaoYutang/lytvpk"
)

func main() {
	// 确保单例运行
	// 如果已有实例运行，会将参数传递给已有实例并退出
	EnsureSingleton(os.Args)

	// Create an instance of the app structure
	app := NewApp()

	// Create application with options
	err := wails.Run(&options.App{
		Title:     "LytVPK MOD管理器",
		Width:     1400,
		Height:    900,
		Frameless: true,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        app.startup,
		OnBeforeClose:    app.beforeClose,
		Bind: []any{
			app,
		},
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop: true,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
