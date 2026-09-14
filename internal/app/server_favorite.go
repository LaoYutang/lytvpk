package app

import (
	"errors"
	"fmt"
	"os"
	"strings"

	"vpk-manager/internal/serveraddress"
)

// addFavoriteServer 将协议传入的服务器持久化到收藏列表。
// 服务器地址作为幂等键，避免重复打开同一深链时产生重复记录。
func (a *App) addFavoriteServer(name string, address string) (bool, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return false, fmt.Errorf("服务器名称不能为空")
	}
	var err error
	address, err = serveraddress.Normalize(address)
	if err != nil {
		return false, err
	}

	a.serverStorageMu.Lock()
	defer a.serverStorageMu.Unlock()

	a.ensureConfigPaths()
	storage := ServerStorage{
		Servers:       []SavedServer{},
		RecentServers: []RecentServer{},
	}
	if err := readJSONFile(a.serversPath, &storage); err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return false, fmt.Errorf("读取服务器收藏失败: %w", err)
		}
	}

	normalizedAddress := normalizeStoredAddress(address)
	for _, server := range storage.Servers {
		if normalizeStoredAddress(server.Address) == normalizedAddress {
			return false, nil
		}
	}

	storage.Servers = append(storage.Servers, SavedServer{
		Name:    name,
		Address: address,
		Weight:  0,
	})
	if err := a.saveServerStorage(storage); err != nil {
		return false, fmt.Errorf("保存服务器收藏失败: %w", err)
	}

	return true, nil
}
