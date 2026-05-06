<script setup>
import { onMounted } from 'vue'
import { useSettingsStore } from '../stores/settings.js'
import { useAppStore } from '../stores/app.js'
import LytToggle from '../components/ui/LytToggle.vue'
import LytButton from '../components/ui/LytButton.vue'

const settingsStore = useSettingsStore()
const appStore = useAppStore()

onMounted(() => {
  settingsStore.loadSettings()
})
</script>

<template>
  <div class="settings-view">
    <h2 class="page-title">设置</h2>
    <div class="settings-grid">
      <div class="setting-card">
        <h3 class="card-title">网络设置</h3>
        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-name">开启优选IP加速</span>
            <span class="setting-desc">自动选择延迟最低的下载节点</span>
          </div>
          <LytToggle v-model="settingsStore.preferredIP" @change="settingsStore.setPreferredIP" />
        </div>
        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-name">固定IP</span>
            <span class="setting-desc">手动指定下载节点IP地址</span>
          </div>
          <LytToggle v-model="settingsStore.fixedIP" @change="settingsStore.setFixedIP" />
        </div>
      </div>

      <div class="setting-card">
        <h3 class="card-title">界面设置</h3>
        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-name">暗黑模式</span>
            <span class="setting-desc">切换亮色/暗色主题</span>
          </div>
          <LytToggle :model-value="appStore.isDark" @change="appStore.toggleTheme" />
        </div>
      </div>

      <div class="setting-card">
        <h3 class="card-title">工坊设置</h3>
        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-name">保存工坊元数据</span>
            <span class="setting-desc">下载时同时保存创意工坊信息</span>
          </div>
          <LytToggle v-model="settingsStore.metaEnabled" @change="settingsStore.setMetaEnabled" />
        </div>
        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-name">浏览器跳转目标</span>
            <span class="setting-desc">打开工坊链接时使用镜像站或Steam</span>
          </div>
          <span class="setting-value">{{ settingsStore.browserTarget === 'mirror' ? '镜像站' : 'Steam' }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-view {
  padding: 24px 32px;
  max-width: 800px;
}

.page-title {
  font-size: var(--text-2xl);
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 24px;
}

.settings-grid {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.setting-card {
  background: var(--bg-surface);
  border-radius: var(--radius-lg);
  padding: 20px;
  border: 1px solid var(--border-light);
}

.card-title {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 16px 0;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-light);
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  gap: 16px;
}

.setting-row + .setting-row {
  border-top: 1px solid var(--border-light);
}

.setting-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

.setting-name {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-primary);
}

.setting-desc {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.setting-value {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  font-weight: 500;
}
</style>
