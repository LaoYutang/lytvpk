package main

import (
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	// 单例监听端口（仅 localhost）
	SingletonPort = 19527
	// 连接超时时间
	PipeTimeout = 5 * time.Second
	// 消息最大长度
	MaxMessageSize = 4096
)

// SingletonManager 单例管理器
type SingletonManager struct {
	listener net.Listener
	app      *App
}

// IsFirstInstance 检查是否是第一个实例
// 如果是第一个实例，返回 true 并启动监听
// 如果不是第一个实例，将参数发送给已有实例并返回 false
func IsFirstInstance(args []string) bool {
	// 获取命令行参数（排除程序路径）
	urlArgs := extractURLArgs(args)

	// 尝试连接已有实例
	conn, err := connectToExistingInstance()
	if err == nil {
		// 已有实例存在，发送参数
		if len(urlArgs) > 0 {
			for _, arg := range urlArgs {
				if err := sendMessage(conn, arg); err != nil {
					log.Printf("发送消息失败: %v", err)
				}
			}
		}
		conn.Close()
		return false // 不是第一个实例
	}

	// 没有已有实例，这是第一个实例
	return true
}

// extractURLArgs 从命令行参数中提取 URL 协议参数
func extractURLArgs(args []string) []string {
	var urlArgs []string
	for i := 1; i < len(args); i++ {
		arg := args[i]
		// 检查是否是 lytvpk:// 协议
		if strings.HasPrefix(arg, "lytvpk://") {
			urlArgs = append(urlArgs, arg)
		}
	}
	return urlArgs
}

// connectToExistingInstance 尝试连接到已有实例
func connectToExistingInstance() (net.Conn, error) {
	addr := fmt.Sprintf("127.0.0.1:%d", SingletonPort)

	conn, err := net.DialTimeout("tcp", addr, PipeTimeout)
	if err != nil {
		return nil, fmt.Errorf("无法连接到已有实例: %w", err)
	}

	return conn, nil
}

// sendMessage 通过连接发送消息
func sendMessage(conn net.Conn, message string) error {
	_, err := conn.Write([]byte(message + "\n"))
	return err
}

// StartSingletonListener 启动单例监听器
func StartSingletonListener(app *App) (*SingletonManager, error) {
	addr := fmt.Sprintf("127.0.0.1:%d", SingletonPort)

	// 创建 TCP 监听器（仅 localhost）
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("创建监听器失败: %w", err)
	}

	manager := &SingletonManager{
		listener: listener,
		app:      app,
	}

	// 启动监听协程
	go manager.listen()

	return manager, nil
}

// listen 监听来自其他实例的连接
func (m *SingletonManager) listen() {
	for {
		conn, err := m.listener.Accept()
		if err != nil {
			// 监听器关闭时退出
			if strings.Contains(err.Error(), "closed") {
				return
			}
			log.Printf("接受连接失败: %v", err)
			continue
		}

		// 处理连接
		go m.handleConnection(conn)
	}
}

// handleConnection 处理来自其他实例的连接
func (m *SingletonManager) handleConnection(conn net.Conn) {
	defer conn.Close()

	// 设置读取超时
	conn.SetReadDeadline(time.Now().Add(PipeTimeout))

	// 读取消息
	buffer := make([]byte, MaxMessageSize)
	n, err := conn.Read(buffer)
	if err != nil {
		if err != io.EOF {
			log.Printf("读取消息失败: %v", err)
		}
		return
	}

	message := strings.TrimSpace(string(buffer[:n]))
	if message == "" {
		return
	}

	// 先显示窗口（确保用户能看到）
	m.showWindow()

	// 处理 URL 协议消息
	if strings.HasPrefix(message, "lytvpk://") {
		m.app.HandleProtocolURL(message)
	}
}

// showWindow 显示并激活窗口
func (m *SingletonManager) showWindow() {
	if m.app.ctx == nil {
		return
	}

	// 取消最小化状态
	runtime.WindowUnminimise(m.app.ctx)
	// 显示窗口（如果被隐藏）
	runtime.WindowShow(m.app.ctx)
	// 将窗口置于前台
	runtime.WindowSetAlwaysOnTop(m.app.ctx, true)
	// 稍后取消置顶（避免一直置顶）
	time.AfterFunc(500*time.Millisecond, func() {
		runtime.WindowSetAlwaysOnTop(m.app.ctx, false)
	})
}

// Close 关闭单例监听器
func (m *SingletonManager) Close() error {
	if m.listener != nil {
		return m.listener.Close()
	}
	return nil
}

// EnsureSingleton 确保单例运行
// 如果不是第一个实例，会发送参数给已有实例并退出
func EnsureSingleton(args []string) bool {
	if !IsFirstInstance(args) {
		// 不是第一个实例，已经发送参数给已有实例，应该退出
		os.Exit(0)
	}
	return true
}

// HandleStartupArgs 处理启动时的命令行参数
// 用于第一个实例处理自己的启动参数
func HandleStartupArgs(app *App, args []string) {
	urlArgs := extractURLArgs(args)
	for _, arg := range urlArgs {
		if strings.HasPrefix(arg, "lytvpk://") {
			// 延迟处理，等待前端初始化完成
			go func(url string) {
				time.Sleep(2 * time.Second)
				app.HandleProtocolURL(url)
			}(arg)
		}
	}
}
