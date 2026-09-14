package app

import (
	"log"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// 窗口尺寸约束，单位为 Wails 逻辑像素（96 DPI 基准），与 options.App.Width/Height 同一套单位
const (
	MinWindowWidth      = 1024
	MinWindowHeight     = 640
	DefaultWindowWidth  = 1400
	DefaultWindowHeight = 900
)

// windowResizedEvent 由前端在窗口尺寸变化结束后上报
const windowResizedEvent = "window:resized"

// InitialWindowState 返回启动窗口应使用的尺寸与最大化状态
func InitialWindowState(a *App) WindowState {
	a.mu.RLock()
	state := a.windowState
	a.mu.RUnlock()

	// 没有记录或记录不可用时回退到默认尺寸
	if state.Width < MinWindowWidth || state.Height < MinWindowHeight {
		state.Width = DefaultWindowWidth
		state.Height = DefaultWindowHeight
	}
	return state
}

// setupWindowStateTracking 监听前端上报的窗口尺寸变化。
// Wails 没有获取"还原尺寸"的接口，窗口最大化时读到的是占满工作区的尺寸，
// 因此需要在前端尺寸稳定时先把普通尺寸记下来，否则关闭时会把最大化尺寸当成普通尺寸保存。
func (a *App) setupWindowStateTracking() {
	if a.ctx == nil {
		return
	}
	runtime.EventsOn(a.ctx, windowResizedEvent, func(...interface{}) {
		a.rememberWindowState()
	})
}

// rememberWindowState 读取当前窗口尺寸记入内存，不写盘
func (a *App) rememberWindowState() {
	if a.ctx == nil {
		return
	}
	if runtime.WindowIsMinimised(a.ctx) {
		return
	}
	if runtime.WindowIsMaximised(a.ctx) {
		a.mu.Lock()
		a.windowState.Maximised = true
		a.mu.Unlock()
		return
	}

	width, height := runtime.WindowGetSize(a.ctx)
	if width <= 0 || height <= 0 {
		return
	}

	a.mu.Lock()
	a.windowState.Width = width
	a.windowState.Height = height
	a.windowState.Maximised = false
	a.mu.Unlock()
}

// clampWindowToScreen 把窗口尺寸限制在当前显示器范围内，
// 避免换显示器或调整缩放后保存的尺寸超出可见区域
func (a *App) clampWindowToScreen() {
	if a.ctx == nil || runtime.WindowIsMaximised(a.ctx) {
		return
	}

	screens, err := runtime.ScreenGetAll(a.ctx)
	if err != nil {
		log.Printf("读取显示器信息失败，跳过窗口尺寸校正: %v", err)
		return
	}

	maxWidth, maxHeight := 0, 0
	for _, screen := range screens {
		if screen.IsCurrent {
			maxWidth, maxHeight = screen.Size.Width, screen.Size.Height
			break
		}
	}
	if maxWidth <= 0 || maxHeight <= 0 {
		return
	}

	width, height := runtime.WindowGetSize(a.ctx)
	nextWidth, nextHeight := width, height
	if nextWidth > maxWidth {
		nextWidth = maxWidth
	}
	if nextHeight > maxHeight {
		nextHeight = maxHeight
	}
	if nextWidth == width && nextHeight == height {
		return
	}

	log.Printf("窗口尺寸 %dx%d 超出当前显示器 %dx%d，已校正为 %dx%d", width, height, maxWidth, maxHeight, nextWidth, nextHeight)
	runtime.WindowSetSize(a.ctx, nextWidth, nextHeight)

	a.mu.Lock()
	a.windowState.Width = nextWidth
	a.windowState.Height = nextHeight
	a.mu.Unlock()
}
