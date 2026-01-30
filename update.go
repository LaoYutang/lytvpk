package main

import (
	"archive/zip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/blang/semver"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// 全局变量存储下载地址，避免 DoUpdate 时再次请求 API 导致速率限制或网络错误
var pendingUpdateURL string

// UpdateInfo 返回给前端的结构体
type UpdateInfo struct {
	HasUpdate   bool   `json:"has_update"`
	LatestVer   string `json:"latest_ver"`
	CurrentVer  string `json:"current_ver"`
	ReleaseNote string `json:"release_note"`
	DownloadURL string `json:"download_url"`
	Error       string `json:"error,omitempty"`
}

// GithubRelease 简化的 GitHub Release 结构
type GithubRelease struct {
	TagName string `json:"tag_name"`
	Body    string `json:"body"`
	Assets  []struct {
		BrowserDownloadURL string `json:"browser_download_url"`
		Name               string `json:"name"`
	} `json:"assets"`
}

// MirrorList 镜像源列表 (与前端保持一致)
var MirrorList = []string{
	"https://hk.gh-proxy.com/",
	"https://gh-proxy.com/",
	"https://gh.llkk.cc/",
	"https://ghfast.top/",
}

// MirrorWithLatency 带有延迟信息的镜像源
type MirrorWithLatency struct {
	URL     string `json:"url"`
	Latency int64  `json:"latency"` // 毫秒，-1 表示超时或错误
}

// checkLatency 检测镜像源延迟
func checkLatency(url string) int64 {
	start := time.Now()
	client := http.Client{
		Timeout: 3 * time.Second,
	}

	// 尝试 HEAD 请求
	resp, err := client.Head(url)
	if err != nil || resp.StatusCode >= 400 {
		// 如果 HEAD 失败，尝试 GET
		resp, err = client.Get(url)
	}

	if err != nil {
		return -1
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return -1
	}

	return time.Since(start).Milliseconds()
}

// fetchReleases 获取最近的版本列表
func fetchReleases(repo string) ([]GithubRelease, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/releases?per_page=10", repo)
	client := &http.Client{Timeout: 10 * time.Second}

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("User-Agent", "vpk-manager-updater")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status: %s", resp.Status)
	}

	var releases []GithubRelease
	if err := json.NewDecoder(resp.Body).Decode(&releases); err != nil {
		return nil, err
	}

	return releases, nil
}

// fetchLatestTagFromMirror 通过镜像获取最新 Tag (解析重定向)
func fetchLatestTagFromMirror(repo, mirror string) (string, error) {
	// 构造 URL: mirror + https://github.com/user/repo/releases/latest
	target := fmt.Sprintf("%shttps://github.com/%s/releases/latest", mirror, repo)

	client := &http.Client{
		Timeout: 15 * time.Second,
		// 默认会自动跟随重定向
	}

	resp, err := client.Get(target)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	// 检查最终 URL
	finalURL := resp.Request.URL.String()
	// 预期格式: .../releases/tag/v1.0.0
	parts := strings.Split(finalURL, "/tag/")
	if len(parts) < 2 {
		return "", fmt.Errorf("无法从 URL 解析版本号: %s", finalURL)
	}

	return parts[len(parts)-1], nil
}

// CheckUpdate 检查更新
func (a *App) CheckUpdate() UpdateInfo {
	// 1. 解析当前版本
	vCurrent, err := semver.ParseTolerant(AppVersion)
	if err != nil {
		return UpdateInfo{Error: "当前版本号格式错误: " + err.Error()}
	}

	var release *GithubRelease
	var fetchErr error

	// 2. 尝试直连 GitHub API 获取列表
	releases, err := fetchReleases(GithubRepo)
	if err == nil && len(releases) > 0 {
		// 寻找最新版本
		var bestRel GithubRelease
		var maxVer semver.Version
		found := false

		for _, r := range releases {
			v, parseErr := semver.ParseTolerant(r.TagName)
			if parseErr != nil {
				continue
			}
			if !found || v.GT(maxVer) {
				maxVer = v
				bestRel = r
				found = true
			}
		}

		if found {
			// 如果有更新，聚合日志
			if maxVer.GT(vCurrent) {
				var sb strings.Builder
				for _, r := range releases {
					v, parseErr := semver.ParseTolerant(r.TagName)
					if parseErr != nil {
						continue
					}
					if v.GT(vCurrent) {
						sb.WriteString(fmt.Sprintf("【%s】\n%s\n\n", r.TagName, r.Body))
					}
				}
				bestRel.Body = sb.String()
			}
			release = &bestRel
		} else {
			fetchErr = fmt.Errorf("no valid versions found")
		}
	} else {
		if err != nil {
			fetchErr = err
		} else {
			fetchErr = fmt.Errorf("empty release list")
		}
	}

	// 3. 如果直连失败，尝试遍历镜像源
	if fetchErr != nil {
		fmt.Printf("直连失败: %v，尝试使用镜像源...\n", fetchErr)

		for _, mirror := range MirrorList {
			tag, mirrorErr := fetchLatestTagFromMirror(GithubRepo, mirror)
			if mirrorErr == nil && tag != "" {
				fmt.Printf("通过镜像 %s 获取到版本: %s\n", mirror, tag)
				// 构造一个伪造的 release 对象
				release = &GithubRelease{
					TagName: tag,
					Body:    "由于网络原因，无法获取详细更新日志。\n(通过镜像源检测)",
				}
				// 构造下载地址 (假设文件名格式)
				// LytVPK-MOD-Manager_v1.0.0_windows_amd64.zip
				filename := fmt.Sprintf("LytVPK-MOD-Manager_%s_windows_amd64.zip", tag)
				release.Assets = []struct {
					BrowserDownloadURL string `json:"browser_download_url"`
					Name               string `json:"name"`
				}{
					{
						Name:               filename,
						BrowserDownloadURL: fmt.Sprintf("https://github.com/%s/releases/download/%s/%s", GithubRepo, tag, filename),
					},
				}
				fetchErr = nil // 清除错误
				break
			} else {
				fmt.Printf("镜像 %s 失败: %v\n", mirror, mirrorErr)
			}
		}
	}

	if fetchErr != nil {
		return UpdateInfo{Error: "检查更新失败(所有源均不可用): " + fetchErr.Error()}
	}

	// 4. 解析最新版本号
	vLatest, err := semver.ParseTolerant(release.TagName)
	if err != nil {
		return UpdateInfo{Error: "最新版本号格式错误: " + err.Error()}
	}

	// 5. 比较版本
	if vLatest.GT(vCurrent) {
		// 预先解析下载地址
		var url string

		// 优先匹配精确架构 (兼容旧的命名方式和新的命名方式)
		// 新: LytVPK-MOD-Manager_v1.0.0_windows_amd64.zip
		// 旧: lytvpk_v1.0.0_windows_amd64.zip
		// 通用匹配: windows_amd64.zip
		suffix := "windows_amd64.zip"

		for _, asset := range release.Assets {
			if strings.HasSuffix(asset.Name, suffix) {
				url = asset.BrowserDownloadURL
				break
			}
		}

		// 降级匹配任意 zip
		if url == "" {
			for _, asset := range release.Assets {
				if strings.HasSuffix(asset.Name, ".zip") {
					url = asset.BrowserDownloadURL
					break
				}
			}
		}

		// 存入全局变量
		pendingUpdateURL = url

		return UpdateInfo{
			HasUpdate:   true,
			LatestVer:   vLatest.String(),
			CurrentVer:  AppVersion,
			ReleaseNote: release.Body,
			DownloadURL: url,
		}
	}

	return UpdateInfo{
		HasUpdate:  false,
		CurrentVer: AppVersion,
		LatestVer:  vLatest.String(),
	}
}

// GetMirrors 获取镜像列表
func (a *App) GetMirrors() []string {
	return MirrorList
}

// GetMirrorsInitial 获取镜像列表初始状态 (不含延迟)
func (a *App) GetMirrorsInitial() []MirrorWithLatency {
	var results []MirrorWithLatency

	// 1. 添加直连
	results = append(results, MirrorWithLatency{URL: "", Latency: 0}) // 0 表示未检测/检测中

	// 2. 添加镜像源
	for _, m := range MirrorList {
		results = append(results, MirrorWithLatency{URL: m, Latency: 0})
	}

	return results
}

// TestMirrorsLatency 异步测试镜像源延迟，通过事件返回结果
func (a *App) TestMirrorsLatency() {
	// 1. 直连检测
	go func() {
		target := pendingUpdateURL
		if target == "" {
			target = "https://github.com"
		}
		latency := checkLatency(target)
		wailsRuntime.EventsEmit(a.ctx, "mirror_latency_result", MirrorWithLatency{URL: "", Latency: latency})
	}()

	// 2. 镜像源检测
	for _, mirror := range MirrorList {
		go func(m string) {
			target := m
			if pendingUpdateURL != "" {
				prefix := m
				if !strings.HasSuffix(prefix, "/") {
					prefix += "/"
				}
				target = prefix + pendingUpdateURL
			}
			latency := checkLatency(target)
			wailsRuntime.EventsEmit(a.ctx, "mirror_latency_result", MirrorWithLatency{URL: m, Latency: latency})
		}(mirror)
	}
}

// GetMirrorsWithLatency 获取带有延迟信息的镜像列表 (保留向后兼容，但建议使用 TestMirrorsLatency)
func (a *App) GetMirrorsWithLatency() []MirrorWithLatency {
	var results []MirrorWithLatency
	var wg sync.WaitGroup
	var mu sync.Mutex

	// 1. 添加直连检测
	wg.Add(1)
	go func() {
		defer wg.Done()
		target := pendingUpdateURL
		if target == "" {
			// 如果没有待更新的 URL，检测 GitHub 主站作为参考
			target = "https://github.com"
		}
		latency := checkLatency(target)
		mu.Lock()
		// 直连的 URL 为空字符串，与 DoUpdate 逻辑保持一致
		results = append(results, MirrorWithLatency{URL: "", Latency: latency})
		mu.Unlock()
	}()

	// 2. 检测镜像源
	for _, mirror := range MirrorList {
		wg.Add(1)
		go func(m string) {
			defer wg.Done()
			target := m
			// 如果有具体的下载地址，拼接检测更准确
			if pendingUpdateURL != "" {
				prefix := m
				if !strings.HasSuffix(prefix, "/") {
					prefix += "/"
				}
				target = prefix + pendingUpdateURL
			}

			latency := checkLatency(target)
			mu.Lock()
			results = append(results, MirrorWithLatency{URL: m, Latency: latency})
			mu.Unlock()
		}(mirror)
	}
	wg.Wait()

	// 排序：延迟低的在前，失败的(-1)在后
	sort.Slice(results, func(i, j int) bool {
		if results[i].Latency == -1 {
			return false
		}
		if results[j].Latency == -1 {
			return true
		}
		return results[i].Latency < results[j].Latency
	})

	return results
}

// DoUpdate 执行更新
func (a *App) DoUpdate(mirror string) string {
	downloadURL := pendingUpdateURL

	// 如果缓存为空，尝试重新获取
	if downloadURL == "" {
		// 复用 CheckUpdate 的逻辑 (这里简化处理，直接调用 CheckUpdate)
		info := a.CheckUpdate()
		if info.Error != "" {
			return "更新检测失败: " + info.Error
		}
		if !info.HasUpdate {
			return "当前已是最新版本"
		}
		downloadURL = info.DownloadURL
	}

	if downloadURL == "" {
		return "未找到适合当前系统的更新包"
	}

	// 获取当前执行文件路径
	exe, err := os.Executable()
	if err != nil {
		return "无法获取程序路径"
	}

	// 构造最终下载地址
	targetURL := downloadURL
	if mirror != "" {
		if !strings.HasSuffix(mirror, "/") {
			mirror += "/"
		}
		targetURL = mirror + downloadURL
	}

	// 创建临时文件
	tmpFile, err := os.CreateTemp("", "update-*.zip")
	if err != nil {
		return "创建临时文件失败: " + err.Error()
	}
	tmpFile.Close()
	defer os.Remove(tmpFile.Name())

	// 下载带进度
	if err := a.downloadWithProgress(targetURL, tmpFile.Name()); err != nil {
		return "下载失败: " + err.Error()
	}

	// 安装更新
	if err := installUpdate(tmpFile.Name(), exe); err != nil {
		return "安装更新失败: " + err.Error()
	}

	return "success"
}

// downloadWithProgress 下载文件并发送进度
func (a *App) downloadWithProgress(url string, destPath string) error {
	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download failed: %s", resp.Status)
	}

	out, err := os.Create(destPath)
	if err != nil {
		return err
	}
	defer out.Close()

	total := resp.ContentLength
	counter := &WriteCounter{
		Total: uint64(total),
		Ctx:   a.ctx,
	}

	if _, err = io.Copy(out, io.TeeReader(resp.Body, counter)); err != nil {
		return err
	}
	return nil
}

type WriteCounter struct {
	Total   uint64
	Current uint64
	Ctx     context.Context
}

func (wc *WriteCounter) Write(p []byte) (int, error) {
	n := len(p)
	wc.Current += uint64(n)
	if wc.Total > 0 {
		percent := float64(wc.Current) / float64(wc.Total) * 100
		wailsRuntime.EventsEmit(wc.Ctx, "update_progress", int(percent))
	}
	return n, nil
}

// installUpdate 解压 zip 并替换当前 exe
func installUpdate(zipPath, currentExe string) error {
	// 1. 解压 zip
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer r.Close()

	// 寻找 exe 文件
	var file *zip.File
	for _, f := range r.File {
		if strings.HasSuffix(f.Name, ".exe") {
			file = f
			break
		}
	}
	if file == nil {
		return fmt.Errorf("zip 中未找到 exe 文件")
	}

	// 2. 解压出新文件
	newExePath := currentExe + ".new"
	outFile, err := os.Create(newExePath)
	if err != nil {
		return err
	}

	rc, err := file.Open()
	if err != nil {
		outFile.Close()
		return err
	}

	_, err = io.Copy(outFile, rc)
	rc.Close()
	outFile.Close()
	if err != nil {
		return err
	}

	// 3. 替换逻辑 (Windows)
	oldExePath := currentExe + ".old"

	// 如果存在旧的 .old，先删除
	os.Remove(oldExePath)

	// 重命名当前 exe -> .old
	if err := os.Rename(currentExe, oldExePath); err != nil {
		return fmt.Errorf("备份旧文件失败: %w", err)
	}

	// 重命名新 exe -> 当前 exe
	if err := os.Rename(newExePath, currentExe); err != nil {
		// 尝试回滚
		os.Rename(oldExePath, currentExe)
		return fmt.Errorf("替换文件失败: %w", err)
	}

	return nil
}
