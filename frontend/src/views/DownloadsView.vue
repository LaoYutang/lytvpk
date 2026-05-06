<script setup>
import { onMounted, onUnmounted } from 'vue'
import { useDownloadStore } from '../stores/download.js'
import { useAppStore } from '../stores/app.js'
import { EventsOn } from '../api/wails.js'
import LytButton from '../components/ui/LytButton.vue'

const downloadStore = useDownloadStore()
const appStore = useAppStore()

let unsubTask = null
let unsubProgress = null

onMounted(() => {
  downloadStore.loadTasks()
  unsubTask = EventsOn('task_updated', () => downloadStore.loadTasks())
  unsubProgress = EventsOn('task_progress', () => downloadStore.loadTasks())
})

onUnmounted(() => {
  if (unsubTask) unsubTask()
  if (unsubProgress) unsubProgress()
})

function statusText(status) {
  const map = {
    pending: '等待中',
    downloading: '下载中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
  }
  return map[status] || status
}

function statusClass(status) {
  return `status-${status}`
}
</script>

<template>
  <div class="downloads-view">
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
            v-if="task.status === 'downloading' || task.status === 'pending'"
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
</template>

<style scoped>
.downloads-view {
  padding: 24px 32px;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
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
