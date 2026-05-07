package app

import (
	"fmt"
	"github.com/hymkor/trash-go"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	rt "runtime"
	"strings"
	"sync"
)

func (a *App) SelectDirectory() (string, error) {
	directory, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title:                "选择文件夹",
		ShowHiddenFiles:      false,
		CanCreateDirectories: true,
	})

	if err != nil {
		return "", err
	}

	return directory, nil
}

// AutoDiscoverAddons 自动搜索addons目录
func (a *App) AutoDiscoverAddons() (string, error) {
	// 常见的相对路径
	commonPaths := []string{
		"Steam/steamapps/common/Left 4 Dead 2/left4dead2/addons",
		"SteamLibrary/steamapps/common/Left 4 Dead 2/left4dead2/addons",
		"Program Files (x86)/Steam/steamapps/common/Left 4 Dead 2/left4dead2/addons",
		"Program Files/Steam/steamapps/common/Left 4 Dead 2/left4dead2/addons",
		"Games/Steam/steamapps/common/Left 4 Dead 2/left4dead2/addons",
	}

	// 获取所有盘符
	drives := []string{}
	for _, drive := range "ABCDEFGHIJKLMNOPQRSTUVWXYZ" {
		drivePath := string(drive) + ":\\"
		_, err := os.Stat(drivePath)
		if err == nil {
			drives = append(drives, drivePath)
		}
	}

	// 遍历搜索
	for _, drive := range drives {
		for _, path := range commonPaths {
			fullPath := filepath.Join(drive, path)
			// 检查目录是否存在
			info, err := os.Stat(fullPath)
			if err == nil && info.IsDir() {
				return fullPath, nil
			}
		}
	}

	return "", nil
}

// MoveResult 移动结果
type MoveResult struct {
	SuccessCount int      `json:"successCount"`
	FailCount    int      `json:"failCount"`
	Errors       []string `json:"errors"`
}

// MoveVpkFiles 移动多个VPK文件及其关联的sidecar文件到指定目录
func (a *App) MoveVpkFiles(filePaths []string, destDir string) (MoveResult, error) {
	result := MoveResult{}

	// 确保目标目录存在
	if _, err := os.Stat(destDir); os.IsNotExist(err) {
		if err := os.MkdirAll(destDir, 0755); err != nil {
			return result, fmt.Errorf("无法创建目标目录: %v", err)
		}
	}

	for _, srcPath := range filePaths {
		fileName := filepath.Base(srcPath)
		destPath := filepath.Join(destDir, fileName)

		// 移动 VPK 文件
		if err := moveFile(srcPath, destPath); err != nil {
			result.FailCount++
			result.Errors = append(result.Errors, fmt.Sprintf("移动 %s 失败: %v", fileName, err))
			continue
		}

		// 处理 Sidecar 文件 (图片)
		ext := filepath.Ext(srcPath)
		baseName := strings.TrimSuffix(srcPath, ext)

		// 常见的图片扩展名
		imageExts := []string{".jpg", ".png", ".jpeg", ".bmp"}
		for _, imgExt := range imageExts {
			imgSrc := baseName + imgExt
			if _, err := os.Stat(imgSrc); err == nil {
				imgName := filepath.Base(imgSrc)
				imgDest := filepath.Join(destDir, imgName)
				// 尝试移动图片，如果失败仅记录日志，不视为整体失败
				if err := moveFile(imgSrc, imgDest); err != nil {
					log.Printf("移动关联图片 %s 失败: %v", imgName, err)
				}
			}
		}

		// 处理meta文件
		metaSrc := baseName + ".meta"
		if _, err := os.Stat(metaSrc); err == nil {
			metaName := filepath.Base(metaSrc)
			metaDest := filepath.Join(destDir, metaName)
			if err := moveFile(metaSrc, metaDest); err != nil {
				log.Printf("移动关联meta %s 失败: %v", metaName, err)
			}
		}

		result.SuccessCount++
	}

	return result, nil
}

// moveFile 移动文件，如果跨设备移动失败则尝试复制并删除
func moveFile(src, dst string) error {
	// 检查目标文件是否存在，避免覆盖
	if _, err := os.Stat(dst); err == nil {
		return fmt.Errorf("目标文件已存在")
	}

	if err := os.Rename(src, dst); err != nil {
		// 如果是跨设备移动错误，尝试复制并删除
		// Windows: "The system cannot move the file to a different disk drive"
		// Linux/Unix: "cross-device link"
		errMsg := err.Error()
		if strings.Contains(errMsg, "cross-device link") || strings.Contains(errMsg, "different disk drive") {
			return copyAndDelete(src, dst)
		}
		return err
	}
	return nil
}

// copyAndDelete 复制并删除源文件
func copyAndDelete(src, dst string) error {
	sourceFile, err := os.Open(src)
	if err != nil {
		return err
	}
	defer sourceFile.Close()

	destFile, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer destFile.Close()

	if _, err := io.Copy(destFile, sourceFile); err != nil {
		return err
	}

	// 确保写入完成
	sourceFile.Close()
	destFile.Close()

	return os.Remove(src)
}

// SelectFiles 选择文件对话框 (支持多选)
func (a *App) SelectFiles() ([]string, error) {
	files, err := runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择文件 (VPK, ZIP, RAR, 7Z)",
		Filters: []runtime.FileFilter{
			{
				DisplayName: "支持的文件 (*.vpk;*.zip;*.rar;*.7z)",
				Pattern:     "*.vpk;*.zip;*.rar;*.7z",
			},
			{
				DisplayName: "VPK 文件 (*.vpk)",
				Pattern:     "*.vpk",
			},
			{
				DisplayName: "压缩包 (*.zip;*.rar;*.7z)",
				Pattern:     "*.zip;*.rar;*.7z",
			},
			{
				DisplayName: "所有文件 (*.*)",
				Pattern:     "*.*",
			},
		},
	})
	if err != nil {
		return nil, err
	}
	return files, nil
}

// LogError 记录错误
func (a *App) LogError(errorType, message, file string) {
	errorInfo := ErrorInfo{
		Type:    errorType,
		Message: message,
		File:    file,
	}

	log.Printf("[%s] %s: %s", errorType, file, message)
	runtime.EventsEmit(a.ctx, "error", errorInfo)
}

// ValidateDirectory 验证目录是否有效
func (a *App) ValidateDirectory(path string) error {
	if path == "" {
		return fmt.Errorf("路径不能为空")
	}

	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("目录不存在: %s", path)
		}
		return fmt.Errorf("无法访问目录: %s", err.Error())
	}

	if !info.IsDir() {
		return fmt.Errorf("路径不是一个目录: %s", path)
	}

	// 检查是否有读取权限
	testFile := filepath.Join(path, ".vpk-manager-test")
	if err := os.WriteFile(testFile, []byte("test"), 0644); err != nil {
		return fmt.Errorf("没有写入权限: %s", err.Error())
	}
	os.Remove(testFile)

	return nil
}

// LaunchL4D2 启动L4D2游戏
func (a *App) LaunchL4D2() error {
	// 尝试执行 Mod 轮换
	if err := a.RotateMods(); err != nil {
		// 仅记录日志，不弹窗，因为 RotateMods 内部已经弹窗报错了
		log.Printf("Mod轮换失败: %v", err)
		// 即使轮换失败，也继续启动游戏
	}

	// 使用 Steam 协议启动游戏
	steamURL := "steam://rungameid/550"

	// 使用 Wails 的 BrowserOpenURL 方法打开 Steam 链接
	runtime.BrowserOpenURL(a.ctx, steamURL)

	return nil
}

// ConnectToServer 连接到指定服务器
func (a *App) ConnectToServer(address string) error {
	// 尝试执行 Mod 轮换
	if err := a.RotateMods(); err != nil {
		log.Printf("Mod轮换失败: %v", err)
	}

	steamURL := fmt.Sprintf("steam://connect/%s", address)
	runtime.BrowserOpenURL(a.ctx, steamURL)
	return nil
}

// OpenFileLocation 打开文件所在位置
func (a *App) OpenFileLocation(filePath string) error {
	if filePath == "" {
		return fmt.Errorf("文件路径为空")
	}

	// 规范化路径，解决 Windows 路径分隔符不一致的问题
	cleanPath := filepath.Clean(filePath)

	absPath, err := filepath.Abs(cleanPath)
	if err == nil {
		cleanPath = absPath
	}

	// 检查文件是否存在
	if _, statErr := os.Stat(cleanPath); os.IsNotExist(statErr) {
		return fmt.Errorf("文件不存在: %s", cleanPath)
	}

	// 根据操作系统打开文件管理器
	var cmd *exec.Cmd
	switch rt.GOOS {
	case "windows":
		// Windows: 使用 explorer 并选中文件
		// 尝试先替换掉正斜杠
		winPath := strings.ReplaceAll(cleanPath, "/", "\\")

		// 如果路径包含逗号，explorer /select,path 会失败，因为逗号是分隔符
		if strings.Contains(winPath, ",") {
			// 如果包含逗号，/select, 可能无法工作。尝试只打开文件夹
			cmd = exec.Command("explorer", filepath.Dir(winPath))
		} else {
			cmd = exec.Command("explorer", "/select,", winPath)
		}
	case "darwin":
		// macOS: 使用 open 并选中文件
		cmd = exec.Command("open", "-R", cleanPath)
	case "linux":
		// Linux: 使用 xdg-open 打开目录
		dir := filepath.Dir(cleanPath)
		cmd = exec.Command("xdg-open", dir)
	default:
		return fmt.Errorf("不支持的操作系统: %s", rt.GOOS)
	}

	err = cmd.Start()
	if err != nil {
		return fmt.Errorf("打开文件位置失败: %s", err.Error())
	}

	return nil
}

// DeleteVPKFile 删除VPK文件到回收站
func (a *App) DeleteVPKFile(filePath string) error {
	if filePath == "" {
		return fmt.Errorf("文件路径为空")
	}

	// 检查文件是否存在
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return fmt.Errorf("文件不存在: %s", filePath)
	}

	// 使用 trash 库删除文件到回收站
	err := trash.Throw(filePath)
	if err != nil {
		return fmt.Errorf("删除文件失败: %s", err.Error())
	}
	// 同步删除同名图片
	a.handleSidecarFile(filePath, "", "delete")

	return nil
}

// DeleteVPKFiles 批量删除VPK文件到回收站
func (a *App) DeleteVPKFiles(filePaths []string) error {
	if len(filePaths) == 0 {
		return fmt.Errorf("文件列表为空")
	}

	var errs []string
	for _, filePath := range filePaths {
		if filePath == "" {
			continue
		}
		// 检查文件是否存在
		if _, err := os.Stat(filePath); os.IsNotExist(err) {
			errs = append(errs, fmt.Sprintf("文件不存在: %s", filePath))
			continue
		}

		// 使用 trash 库删除文件到回收站
		err := trash.Throw(filePath)
		if err != nil {
			errs = append(errs, fmt.Sprintf("删除文件 %s 失败: %v", filePath, err))
		} else {
			// 同步删除同名图片
			a.handleSidecarFile(filePath, "", "delete")
		}
	}

	if len(errs) > 0 {
		return fmt.Errorf("批量删除部分失败:\n%s", strings.Join(errs, "\n"))
	}

	return nil
}

func (a *App) HandleFileDrop(paths []string) {
	if a.rootDir == "" {
		a.LogError("拖拽安装", "请先设置游戏根目录", "")
		return
	}

	successCount := 0
	failCount := 0
	var mu sync.Mutex
	var wg sync.WaitGroup

	for _, path := range paths {
		wg.Add(1)
		go func(p string) {
			defer wg.Done()

			lowerPath := strings.ToLower(p)
			var err error
			success := false

			if strings.HasSuffix(lowerPath, ".vpk") {
				// Copy VPK to rootDir
				err = a.installVPKFile(p)
				if err != nil {
					a.LogError("安装VPK失败", err.Error(), filepath.Base(p))
				} else {
					success = true
				}
			} else if strings.HasSuffix(lowerPath, ".zip") || strings.HasSuffix(lowerPath, ".rar") || strings.HasSuffix(lowerPath, ".7z") {
				// Extract Archive to rootDir
				err = a.ExtractVPKFromArchive(p, a.rootDir)
				if err != nil {
					a.LogError("解压压缩包失败", err.Error(), filepath.Base(p))
				} else {
					success = true
				}
			} else {
				a.LogError("不支持的文件格式", "仅支持 .vpk, .zip, .rar, .7z 文件", filepath.Base(p))
			}

			mu.Lock()
			if success {
				successCount++
			} else {
				failCount++
			}
			mu.Unlock()
		}(path)
	}

	wg.Wait()

	if successCount > 0 {
		// 刷新文件列表
		runtime.EventsEmit(a.ctx, "refresh_files", nil)

		msg := fmt.Sprintf("成功处理 %d 个文件", successCount)
		if failCount > 0 {
			msg += fmt.Sprintf("，失败 %d 个", failCount)
		}
		runtime.EventsEmit(a.ctx, "show_toast", map[string]string{"type": "success", "message": msg})
	}
}

// queryA2S 使用 UDP 协议直接查询 Source 引擎服务器信息

func (a *App) installVPKFile(srcPath string) error {
	src, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer src.Close()

	destPath := filepath.Join(a.rootDir, filepath.Base(srcPath))

	dst, err := os.Create(destPath)
	if err != nil {
		return err
	}
	defer dst.Close()

	_, err = io.Copy(dst, src)
	if err != nil {
		return err
	}

	log.Printf("已安装: %s -> %s", srcPath, destPath)
	return nil
}

func (a *App) RestartApplication() error {
	self, err := os.Executable()
	if err != nil {
		return err
	}

	// 直接启动新进程
	// 之前的 cmd /c start 会导致弹黑框，因为 cmd.exe 本身是控制台程序
	// 直接运行编译为 GUI 的 exe 不会弹框
	cmd := exec.Command(self)

	// 启动但不等待
	if err := cmd.Start(); err != nil {
		return err
	}

	// 退出当前应用
	runtime.Quit(a.ctx)
	return nil
}
