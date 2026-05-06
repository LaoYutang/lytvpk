<script setup>
import { ref, onMounted } from 'vue'
import { GetAppVersion, CheckUpdate } from '../api/wails.js'
import LytButton from '../components/ui/LytButton.vue'

const version = ref('')
const checking = ref(false)

onMounted(async () => {
  try {
    version.value = await GetAppVersion()
  } catch (e) {
    console.error(e)
  }
})

async function checkUpdate() {
  checking.value = true
  try {
    await CheckUpdate()
  } catch (e) {
    console.error(e)
  } finally {
    checking.value = false
  }
}
</script>

<template>
  <div class="about-view">
    <div class="about-card">
      <h1 class="about-title">关于 LytVPK</h1>
      <p class="about-desc">L4D2 MOD 管理工具，帮助您轻松管理、浏览和下载求生之路2的创意工坊内容。</p>

      <div class="about-section">
        <span class="section-label">作者</span>
        <span class="section-value">LaoYutang</span>
      </div>

      <div class="about-section">
        <span class="section-label">开源协议</span>
        <span class="section-value">Apache-2.0</span>
      </div>

      <div class="about-section">
        <span class="section-label">版本</span>
        <span class="section-value">{{ version }}</span>
      </div>

      <div class="about-actions">
        <LytButton variant="primary" @click="checkUpdate" :disabled="checking">
          {{ checking ? '检查中...' : '检查更新' }}
        </LytButton>
        <LytButton variant="outline" @click="() => window.open('https://github.com/LaoYutang/lytvpk', '_blank')">
          GitHub
        </LytButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.about-view {
  padding: 32px;
  display: flex;
  justify-content: center;
  align-items: flex-start;
}

.about-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2xl);
  padding: 40px;
  max-width: 480px;
  width: 100%;
  box-shadow: var(--shadow-lg);
}

.about-title {
  font-size: var(--text-2xl);
  font-weight: 700;
  background: linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin-bottom: 12px;
}

.about-desc {
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-relaxed);
  margin-bottom: 24px;
}

.about-section {
  display: flex;
  justify-content: space-between;
  padding: 12px 0;
  border-bottom: 1px solid var(--border-default);
}

.about-section:last-of-type {
  border-bottom: none;
}

.section-label {
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}

.section-value {
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-weight: 500;
}

.about-actions {
  display: flex;
  gap: var(--spacing-3);
  margin-top: 24px;
  justify-content: center;
}
</style>
