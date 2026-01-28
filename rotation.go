package main

import (
	"fmt"
	"math/rand"
	"path/filepath"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// 官方标签白名单（只允许这些标签参与随机轮换）
var officialTags = map[string]bool{
	// 幸存者
	"Bill": true, "Francis": true, "Louis": true, "Zoey": true,
	"Coach": true, "Ellis": true, "Nick": true, "Rochelle": true,

	// 感染者 (虽然目前轮换逻辑只处理武器和人物，但保留这些标签作为参考)
	"tank": true, "witch": true, "hunter": true, "smoker": true,
	"boomer": true, "charger": true, "jockey": true, "spitter": true,
	"common": true, "uncommon_infected": true,

	// 武器 - 步枪
	"AK47": true, "M16": true, "sg552": true, "三连发": true, "M60": true,
	// 武器 - 冲锋枪
	"乌兹": true, "消音": true, "MP5": true,
	// 武器 - 狙击枪
	"大狙": true, "军狙": true, "猎枪": true, "鸟狙": true,
	// 武器 - 霰弹枪
	"铁喷": true, "木喷": true, "一代连喷": true, "二代连喷": true,
	// 武器 - 手枪
	"马格南": true, "小手枪": true,
	// 武器 - 其他
	"榴弹": true,

	// 近战武器
	"砍刀": true, "武士刀": true, "棒球棍": true, "匕首": true, "电锯": true,
	"撬棍": true, "消防斧": true, "平底锅": true, "吉他": true, "板球拍": true,
	"警棍": true, "高尔夫球杆": true, "铁铲": true, "草叉": true,
}

// SetModRotation 设置Mod随机轮换功能是否开启
func (a *App) SetModRotation(config RotationConfig) {
	a.mu.Lock()
	a.modRotationConfig = config
	a.mu.Unlock()

	a.saveConfig()
}

// GetModRotation 获取Mod随机轮换功能状态
func (a *App) GetModRotation() RotationConfig {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.modRotationConfig
}

// RotateMods 执行Mod随机轮换逻辑
func (a *App) RotateMods() error {
	a.mu.Lock()
	config := a.modRotationConfig
	if !config.EnableCharacters && !config.EnableWeapons {
		a.mu.Unlock()
		return nil
	}
	a.mu.Unlock() // 解锁以允许后续操作获取锁

	logMsg := func(msg string) {
		runtime.EventsEmit(a.ctx, "rotation_log", msg)
		fmt.Println("[ModRotation]", msg)
	}

	logMsg("开始执行Mod随机轮换...")

	// 1. 获取所有VPK文件
	files := a.GetVPKFiles()

	// 2. 识别当前启用的武器和人物Mod，并收集二级标签
	targetTags := make(map[string]bool)
	enabledMods := make(map[string]VPKFile) // Path -> File

	for _, file := range files {
		if file.Enabled {
			enabledMods[file.Path] = file
			if file.PrimaryTag == "武器" || file.PrimaryTag == "人物" {
				// 根据配置过滤
				if file.PrimaryTag == "人物" && !config.EnableCharacters {
					continue
				}
				if file.PrimaryTag == "武器" && !config.EnableWeapons {
					continue
				}

				for _, tag := range file.SecondaryTags {
					// 只收集官方标签，忽略自定义标签
					if tag != "" && officialTags[tag] {
						targetTags[tag] = true
					}
				}
			}
		}
	}

	if len(targetTags) == 0 {
		logMsg("未发现启用的官方武器或人物Mod（符合当前配置），跳过轮换")
		return nil
	}

	// 3. 为每个标签构建随机池并选择
	rand.Seed(time.Now().UnixNano())

	// 记录操作：需要禁用的路径和需要启用的路径
	toDisable := make(map[string]bool)
	toEnable := make(map[string]VPKFile)

	for tag := range targetTags {
		// 构建池：包含该标签的所有Mod（启用和禁用）
		var pool []VPKFile
		for _, file := range files {
			// 检查是否包含该标签
			hasTag := false
			for _, t := range file.SecondaryTags {
				if t == tag {
					hasTag = true
					break
				}
			}
			if hasTag {
				pool = append(pool, file)
			}
		}

		if len(pool) == 0 {
			logMsg(fmt.Sprintf("标签 [%s] 无可用Mod", tag))
			continue
		}

		// 随机选择一个
		selected := pool[rand.Intn(len(pool))]
		logMsg(fmt.Sprintf("标签 [%s] 选中 Mod: %s", tag, selected.Name))

		// 标记需要启用的
		toEnable[selected.Path] = selected

		// 找出该标签下当前所有已启用但不是选中的Mod，标记为禁用
		for _, file := range files {
			if file.Enabled && file.Path != selected.Path {
				hasTag := false
				for _, t := range file.SecondaryTags {
					if t == tag {
						hasTag = true
						break
					}
				}
				if hasTag {
					toDisable[file.Path] = true
				}
			}
		}
	}

	// 4. 执行启用和禁用操作
	// 注意：先执行禁用，再执行启用，避免冲突（虽然VPK是覆盖式的，但逻辑上清晰）
	// 由于 ToggleVPKFile 会修改文件路径（移动文件），我们需要小心处理

	// 执行禁用
	for path := range toDisable {
		// 如果这个文件同时也需要被启用（可能在另一个标签被选中了），则不需要禁用
		if _, ok := toEnable[path]; ok {
			continue
		}

		// 检查文件是否确实是启用状态
		// 注意：path是原始路径，如果文件被移动了，ToggleVPKFile 内部会处理缓存更新
		// 但我们需要确保 path 是准确的。
		// 这里我们重新从缓存获取最新状态
		if err := a.ToggleVPKFile(path); err != nil {
			logMsg(fmt.Sprintf("禁用 Mod 失败: %s, 错误: %v", filepath.Base(path), err))
		} else {
			logMsg(fmt.Sprintf("已禁用 Mod: %s", filepath.Base(path)))
		}
	}

	// 执行启用
	for path := range toEnable {
		// 检查是否已经是启用状态
		// 注意：我们需要检查最新的状态，因为上面的禁用循环可能影响了（虽然逻辑上排除了）

		// 实际上 ToggleVPKFile 会检查状态。如果已经是 Enabled，调用它会变成 Disabled。
		// 所以我们需要先检查当前状态。

		// 获取最新状态
		a.mu.RLock()
		cached, ok := a.vpkCache.Load(path)
		a.mu.RUnlock()

		if ok {
			cache := cached.(*VPKFileCache)
			if !cache.File.Enabled {
				if err := a.ToggleVPKFile(path); err != nil {
					logMsg(fmt.Sprintf("启用 Mod 失败: %s, 错误: %v", filepath.Base(path), err))
				} else {
					logMsg(fmt.Sprintf("已启用 Mod: %s", filepath.Base(path)))
				}
			}
		}
	}

	// 5. 刷新前端文件列表
	runtime.EventsEmit(a.ctx, "refresh_files", nil)
	logMsg("Mod轮换完成")

	return nil
}
