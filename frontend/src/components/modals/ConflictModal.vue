<script setup>
import { ref, computed } from 'vue'
import { CheckConflicts } from '../../api/wails.js'
import { useAppStore } from '../../stores/app.js'
import LytModal from '../ui/LytModal.vue'
import LytButton from '../ui/LytButton.vue'

const appStore = useAppStore()
const visible = ref(false)
const loading = ref(false)
const results = ref([])
const filterSeverity = ref('all')

const severityMap = {
  all: '全部',
  critical: '严重',
  warning: '警告',
  info: '普通',
}

async function open() {
  visible.value = true
  results.value = []
  filterSeverity.value = 'all'
}

async function startCheck() {
  loading.value = true
  try {
    results.value = await CheckConflicts() || []
  } catch (e) {
    appStore.addToast('冲突检测失败', 'error')
    console.error(e)
  } finally {
    loading.value = false
  }
}

const filteredResults = computed(() => {
  if (filterSeverity.value === 'all') return results.value
  return results.value.filter(r => r.severity === filterSeverity.value)
})

defineExpose({ open })
</script>

<template>
  <LytModal v-model="visible" title="Mod冲突检测" size="large">
    <div v-if="loading" class="loading-state">
      <div class="spinner"></div>
      <p>正在检测冲突...</p>
    </div>
    <div v-else-if="results.length === 0" class="empty-state">
      <div class="check-icon">✓</div>
      <p>未发现冲突</p>
      <LytButton variant="primary" @click="startCheck">开始检测</LytButton>
    </div>
    <div v-else class="results">
      <div class="results-toolbar">
        <span class="results-count">发现 {{ results.length }} 组冲突</span>
        <div class="severity-filters">
          <button
            v-for="(label, key) in severityMap"
            :key="key"
            class="severity-btn"
            :class="{ active: filterSeverity === key }"
            @click="filterSeverity = key"
          >
            {{ label }}
          </button>
        </div>
      </div>
      <div class="conflict-list">
        <div v-for="(group, idx) in filteredResults" :key="idx" class="conflict-group">
          <div class="conflict-header" :class="`severity-${group.severity}`">
            <span class="severity-badge">{{ severityMap[group.severity] || group.severity }}</span>
            <span class="conflict-desc">{{ group.description }}</span>
          </div>
          <div class="conflict-files">
            <div v-for="f in group.files" :key="f" class="conflict-file">{{ f }}</div>
          </div>
        </div>
      </div>
    </div>
    <template #footer>
      <LytButton variant="secondary" @click="visible = false">关闭</LytButton>
      <LytButton v-if="!loading && results.length > 0" variant="primary" @click="startCheck">重新检测</LytButton>
    </template>
  </LytModal>
</template>

<style scoped>
.loading-state {
  text-align: center;
  padding: 48px;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--border-light);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.75s linear infinite;
  margin: 0 auto 16px;
}

.empty-state {
  text-align: center;
  padding: 48px;
}

.check-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--success);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  margin: 0 auto 16px;
}

.results-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 8px;
}

.results-count {
  font-weight: 600;
  color: var(--text-primary);
}

.severity-filters {
  display: flex;
  gap: 6px;
}

.severity-btn {
  padding: 4px 12px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border-default);
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  cursor: pointer;
  transition: all var(--duration-150);
}

.severity-btn:hover {
  border-color: var(--primary);
}

.severity-btn.active {
  background: linear-gradient(135deg, var(--primary) 0%, var(--primary-light) 100%);
  border-color: var(--primary);
  color: white;
}

.conflict-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 400px;
  overflow-y: auto;
}

.conflict-group {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.conflict-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--bg-surface);
}

.conflict-header.severity-critical {
  background: rgba(239, 68, 68, 0.1);
}

.conflict-header.severity-warning {
  background: rgba(245, 158, 11, 0.1);
}

.conflict-header.severity-info {
  background: rgba(6, 182, 212, 0.1);
}

.severity-badge {
  padding: 2px 8px;
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  font-weight: 600;
  color: white;
  flex-shrink: 0;
}

.severity-critical .severity-badge { background: var(--danger); }
.severity-warning .severity-badge { background: var(--warning); color: black; }
.severity-info .severity-badge { background: var(--accent); }

.conflict-desc {
  font-size: var(--text-sm);
  color: var(--text-primary);
  font-weight: 500;
}

.conflict-files {
  padding: 8px 14px;
}

.conflict-file {
  font-size: var(--text-xs);
  color: var(--text-secondary);
  padding: 4px 0;
  border-bottom: 1px solid var(--border-light);
}

.conflict-file:last-child {
  border-bottom: none;
}
</style>
