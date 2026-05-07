package app

// AppVersion is set by main at startup so existing -ldflags targeting
// main.AppVersion continue to work.
var AppVersion = "0.0.0"

const (
	// GithubRepo GitHub 仓库地址 "用户名/仓库名"
	GithubRepo = "LaoYutang/lytvpk"
)
