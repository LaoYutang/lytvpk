const CONFIG_KEY = "vpk-manager-config";

// 最大保存目录数量
export const MAX_DIRECTORIES = 10;

// 获取配置，自动迁移旧版本
export function getConfig() {
  const stored = localStorage.getItem(CONFIG_KEY);
  const config = stored ? JSON.parse(stored) : { defaultDirectory: "", boxSelectionEnabled: false, ctrlClickSelectionEnabled: false };

  // 配置迁移：将旧版 defaultDirectory 转换为新结构
  migrateConfigIfNeeded(config);

  return config;
}

// 保存配置
export function saveConfig(config) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

// 配置迁移（兼容旧版本）
function migrateConfigIfNeeded(config) {
  // 如果已有新结构，无需迁移
  if (config.savedDirectories !== undefined) return;

  // 如果有旧的 defaultDirectory 且非空
  if (config.defaultDirectory && config.defaultDirectory.trim()) {
    config.savedDirectories = [
      {
        path: config.defaultDirectory,
        lastUsed: new Date().toISOString(),
      },
    ];
    config.lastActiveDirectory = config.defaultDirectory;
    console.log("已迁移旧配置到新结构");
  } else {
    // 初始化空的新结构
    config.savedDirectories = [];
    config.lastActiveDirectory = "";
  }

  // 立即保存迁移后的配置
  saveConfig(config);
}
