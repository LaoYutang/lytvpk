package app

import (
	"context"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	rt "runtime"
	"sync"
	"time"

	"vpk-manager/internal/network"
	"vpk-manager/internal/parser"

	"github.com/go-resty/resty/v2"
	"github.com/panjf2000/ants/v2"
)

// VPKFile 类型别名,用于Wails绑定
type VPKFile = parser.VPKFile

// ServerInfo 服务器信息
type ServerInfo struct {
	Name       string `json:"name"`
	Map        string `json:"map"`
	Players    int    `json:"players"`
	MaxPlayers int    `json:"max_players"`
	GameDir    string `json:"gamedir"`
	Mode       string `json:"mode"`
}

// ProgressInfo 加载进度信息
type ProgressInfo struct {
	Current int    `json:"current"`
	Total   int    `json:"total"`
	Message string `json:"message"`
}

// ErrorInfo 错误信息
type ErrorInfo struct {
	Type    string `json:"type"`
	Message string `json:"message"`
	File    string `json:"file"`
}

// VPKFileCache 缓存的VPK文件信息
type VPKFileCache struct {
	File         VPKFile
	ModTime      time.Time
	Size         int64
	ImageModTime time.Time // 外部图片修改时间
	MetaModTime  time.Time // meta文件修改时间
	CachedAt     time.Time
}

// App struct
type App struct {
	ctx           context.Context
	vpkCache      sync.Map // map[string]*VPKFileCache, key是文件路径
	mu            sync.RWMutex
	rootDir       string
	goroutinePool *ants.Pool
	forceClose    bool
	restyClient   *resty.Client
	proxyServer   *network.ImageProxyServer
	singletonMgr  *SingletonManager // 单例管理器

	// 配置项
	modRotationConfig     RotationConfig
	workshopPreferredIP   bool
	workshopFixedIP       string
	workshopMetaEnabled   bool
	workshopBrowserTarget string
	migrationVersion      int
	configPath            string
}

// ConfigFile 定义配置文件结构
type ConfigFile struct {
	ModRotationConfig     RotationConfig `json:"modRotationConfig"`
	WorkshopPreferredIP   *bool          `json:"workshopPreferredIP,omitempty"`
	WorkshopFixedIP       *string        `json:"workshopFixedIP,omitempty"`
	WorkshopMetaEnabled   *bool          `json:"workshopMetaEnabled,omitempty"`
	WorkshopBrowserTarget *string        `json:"workshopBrowserTarget,omitempty"`
	// 记录已完成的迁移版本，例如: 1 表示已完成逗号到加号的迁移
	MigrationVersion int `json:"migrationVersion"`
}

// RotationConfig Mod轮换配置
type RotationConfig struct {
	EnableCharacters bool `json:"enableCharacters"`
	EnableWeapons    bool `json:"enableWeapons"`
}

// NewApp creates a new App application struct
func NewApp() *App {
	cores := rt.GOMAXPROCS(0)
	// 确保至少有 4 个并发，提升体验
	if cores < 4 {
		cores = 4
	}
	log.Printf("应用启动，CPU核心数: %d, 协程池大小: %d", rt.GOMAXPROCS(0), cores)

	pool, _ := ants.NewPool(cores) // 创建协程池

	// 初始化 Resty 客户端（强制 IPv4，避免伪 IPv6 导致连接失败）
	ipv4Dialer := &net.Dialer{
		Timeout:   30 * time.Second,
		KeepAlive: 30 * time.Second,
	}
	ipv4Transport := &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			return ipv4Dialer.DialContext(ctx, "tcp4", addr)
		},
	}
	client := resty.New()
	client.SetTimeout(2 * time.Second)
	client.SetTransport(ipv4Transport)

	// 启动本地图片代理
	proxy := network.NewImageProxyServer(network.GlobalIPSelector)
	proxy.Start()

	// 确定配置文件路径
	configDir, _ := os.UserConfigDir()
	appConfigDir := filepath.Join(configDir, "LytVPK")
	os.MkdirAll(appConfigDir, 0755)
	configPath := filepath.Join(appConfigDir, "config.json")

	app := &App{
		goroutinePool:         pool,
		restyClient:           client,
		proxyServer:           proxy,
		configPath:            configPath,
		workshopPreferredIP:   true,     // 默认开启优选IP
		workshopBrowserTarget: "mirror", // 默认使用镜像站
	}

	// 加载配置
	app.loadConfig()

	return app
}
