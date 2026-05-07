<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useDownloadStore } from '../stores/download.js'
import { useAppStore } from '../stores/app.js'
import { EventsOn, BrowserOpenURL } from '../api/wails.js'
import LytButton from '../components/ui/LytButton.vue'
import LytInput from '../components/ui/LytInput.vue'

const downloadStore = useDownloadStore()
const appStore = useAppStore()

let unsubTask = null
let unsubProgress = null

const workshopUrl = ref('')
const parsing = ref(false)
const parsedResult = ref(null)

onMounted(() => {
  downloadStore.loadTasks()
  unsubTask = EventsOn('task_updated', () => downloadStore.loadTasks())
  unsubProgress = EventsOn('task_progress', () => downloadStore.loadTasks())
})

onUnmounted(() => {
  if (unsubTask) unsubTask()
  if (unsubProgress) unsubProgress()
})

async function parseUrl() {
  if (!workshopUrl.value.trim()) return
  parsing.value = true
  parsedResult.value = null
  try {
    const id = await downloadStore.parseWorkshopUrl(workshopUrl.value.trim())
    if (id) {
      const detail = await downloadStore.fetchWorkshopDetails(id)
      if (detail) {
        parsedResult.value = { id, ...detail }
      } else {
        appStore.addToast('无法获取工坊详情', 'error')
      }
    } else {
      appStore.addToast('无法解析工坊链接', 'error')
    }
  } catch (e) {
    appStore.addToast('解析失败', 'error')
    console.error(e)
  } finally {
    parsing.value = false
  }
}

async function downloadParsed() {
  if (!parsedResult.value) return
  try {
    await downloadStore.startDownload(
      parsedResult.value.id,
      parsedResult.value.title || parsedResult.value.name
    )
    appStore.addToast('下载任务已创建', 'success')
    parsedResult.value = null
    workshopUrl.value = ''
  } catch (e) {
    appStore.addToast('创建下载任务失败', 'error')
    console.error(e)
  }
}

function openInBrowser(id) {
  BrowserOpenURL(`https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`)
}

function statusText(status) {
  const map = {
    pending: '等待中',
    downloading: '下载中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
    selecting_ip: '优选节点中',
  }
  return map[status] || status
}

function statusClass(status) {
  return `status-${status}`
}

function formatSize(size) {
  if (!size && size !== 0) return '-'
  const s = Number(size)
  if (s >= 1024 * 1024 * 1024) return (s / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
  if (s >= 1024 * 1024) return (s / (1024 * 1024)).toFixed(2) + ' MB'
  if (s >= 1024) return (s / 1024).toFixed(2) + ' KB'
  return s + ' B'
}
</script>

<template>
  <div class="downloads-view">
    <!-- Workshop URL Parse -->
    <div class="parse-section">
      <h3 class="section-title">工坊链接解析</h3>
      <div class="parse-row">
        <LytInput
          v-model="workshopUrl"
          placeholder="粘贴 Steam 创意工坊链接..."
          class="parse-input"
          @keyup.enter="parseUrl"
        />
        <LytButton variant="primary" @click="parseUrl" :disabled="parsing">
          {{ parsing ? '解析中...' : '解析' }}
        </LytButton>
      </div>

      <div v-if="parsedResult" class="parse-result">
        <div class="result-preview">
          <img v-if="parsedResult.previewUrl" :src="parsedResult.previewUrl" />
          <div v-else class="result-placeholder">暂无预览</div>
        </div>
        <div class="result-info">
          <div class="result-title">{{ parsedResult.title || '未知标题' }}</div>
          <div class="result-meta">
            <span v-if="parsedResult.file_size">大小: {{ formatSize(parsedResult.file_size) }}</span>
            <span v-if="parsedResult.author || parsedResult.creator">作者: {{ parsedResult.author || parsedResult.creator }}</span>
          </div>
          <div class="result-actions">
            <LytButton variant="success" size="small" @click="downloadParsed">下载此文件</LytButton>
            <LytButton variant="outline" size="small" @click="openInBrowser(parsedResult.id)">在浏览器打开</LytButton>
            <LytButton variant="ghost" size="small" @click="parsedResult = null">清除</LytButton>
          </div>
        </div>
      </div>
    </div>

    <!-- Task List -->
    <div class="task-section">
      <div class="page-header">
        <h2 class="page-title">下载管理</h2>
        <LytButton variant="outline" size="small" @click="downloadStore.clearCompleted">
          清理已完成
        </LytButton>
      </div>

      <div class="task-list">
        <div v-if="downloadStore.tasks.length === 0" class="empty-state">
          暂无下载任务
        </div>
        <div
          v-for="task in downloadStore.tasks"
          :key="task.id"
          class="task-item"
          :class="statusClass(task.status)"
        >
          <div class="task-info">
            <div class="task-name">{{ task.name || task.id }}</div>
            <div class="task-meta">
              <span class="task-status" :class="statusClass(task.status)">
                {{ statusText(task.status) }}
              </span>
              <span v-if="task.progress" class="task-progress-text">{{ task.progress }}%</span>
            </div>
          </div>
          <div v-if="task.progress && task.status === 'downloading'" class="progress-bar">
            <div class="progress-fill" :style="{ width: task.progress + '%' }"></div>
          </div>
          <div class="task-actions">
            <LytButton
              v-if="task.status === 'failed'"
              variant="ghost"
              size="small"
              @click="downloadStore.retryTask(task.id)"
            >
              重试
            </LytButton>
            <LytButton
              v-if="task.status === 'downloading' || task.status === 'pending' || task.status === 'selecting_ip'"
              variant="ghost"
              size="small"
              @click="downloadStore.cancelTask(task.id)"
            >
              取消
            </LytButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.downloads-view {
  padding: 24px 32px;
}

.parse-section {
  background: var(--bg-surface);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  padding: 16px 20px;
  margin-bottom: 20px;
}

.section-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 12px 0;
}

.parse-row {
  display: flex;
  gap: 8px;
}

.parse-input {
  flex: 1;
}

.parse-result {
  display: flex;
  gap: 16px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border-light);
}

.result-preview {
  width: 120px;
  height: 90px;
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--bg-card);
  flex-shrink: 0;
}

.result-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.result-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.result-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.result-title {
  font-weight: 600;
  font-size: var(--text-sm);
  color: var(--text-primary);
}

.result-meta {
  display: flex;
  gap: 12px;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.result-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.task-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.page-title {
  font-size: var(--text-2xl);
  font-weight: 700;
  color: var(--text-primary);
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.empty-state {
  text-align: center;
  padding: 48px;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.task-item {
  background: var(--bg-surface);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  padding: 14px 18px;
  transition: all var(--duration-150);
}

.task-item:hover {
  border-color: var(--primary-light);
}

.task-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.task-name {
  font-weight: 500;
  color: var(--text-primary);
  font-size: var(--text-sm);
}

.task-meta {
  display: flex;
  align-items: center;
  gap: 10px;
}

.task-status {
  font-size: var(--text-xs);
  padding: 2px 8px;
  border-radius: var(--radius-full);
  font-weight: 500;
}

.status-pending {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.status-downloading {
  background: var(--primary-50);
  color: var(--primary);
}

.status-completed {
  background: rgba(16, 185, 129, 0.1);
  color: var(--success);
}

.status-failed {
  background: rgba(239, 68, 68, 0.1);
  color: var(--danger);
}

.status-cancelled {
  background: var(--bg-hover);
  color: var(--text-muted);
}

.status-selecting_ip {
  background: rgba(6, 182, 212, 0.1);
  color: var(--accent);
}

.task-progress-text {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.progress-bar {
  height: 4px;
  background: var(--bg-hover);
  border-radius: var(--radius-full);
  overflow: hidden;
  margin-bottom: 8px;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(135deg, var(--primary) 0%, var(--primary-light) 100%);
  border-radius: var(--radius-full);
  transition: width 0.3s ease;
}

.task-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>