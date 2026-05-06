<script setup>
import { ref, onMounted } from 'vue'
import { FetchWorkshopList, FetchWorkshopDetail, GetVPKPreviewImage } from '../api/wails.js'
import { useDownloadStore } from '../stores/download.js'
import LytButton from '../components/ui/LytButton.vue'
import LytInput from '../components/ui/LytInput.vue'

const downloadStore = useDownloadStore()

const items = ref([])
const loading = ref(false)
const searchQuery = ref('')
const sortBy = ref('popular')
const page = ref(1)
const hasMore = ref(true)
const selectedItem = ref(null)
const detailLoading = ref(false)

const sortOptions = [
  { value: 'popular', label: '热门' },
  { value: 'latest', label: '最新' },
  { value: 'toprated', label: '评分最高' },
]

onMounted(() => {
  loadItems()
})

async function loadItems(reset = false) {
  if (loading.value) return
  if (reset) {
    page.value = 1
    items.value = []
  }
  loading.value = true
  try {
    const result = await FetchWorkshopList({
      query: searchQuery.value,
      sort: sortBy.value,
      page: page.value,
    })
    if (result && result.items) {
      items.value.push(...result.items)
      hasMore.value = result.hasMore || false
    }
  } catch (e) {
    console.error(e)
  } finally {
    loading.value = false
  }
}

function search() {
  loadItems(true)
}

function reset() {
  searchQuery.value = ''
  sortBy.value = 'popular'
  loadItems(true)
}

function loadMore() {
  page.value++
  loadItems()
}

async function openDetail(item) {
  selectedItem.value = item
  detailLoading.value = true
  try {
    const detail = await FetchWorkshopDetail(item.id)
    selectedItem.value = { ...item, ...detail }
  } catch (e) {
    console.error(e)
  } finally {
    detailLoading.value = false
  }
}

function closeDetail() {
  selectedItem.value = null
}

async function subscribe(item) {
  try {
    await downloadStore.startDownload(item.id, item.title || item.name)
  } catch (e) {
    console.error(e)
  }
}
</script>

<template>
  <div class="workshop-view">
    <div class="page-header">
      <h2 class="page-title">创意工坊</h2>
      <div class="search-bar">
        <LytInput v-model="searchQuery" placeholder="搜索创意工坊..." @keyup.enter="search" />
        <LytButton variant="primary" @click="search">搜索</LytButton>
        <LytButton variant="outline" @click="reset">重置</LytButton>
      </div>
    </div>

    <div class="sort-tabs">
      <button
        v-for="opt in sortOptions"
        :key="opt.value"
        class="sort-tab"
        :class="{ active: sortBy === opt.value }"
        @click="sortBy = opt.value; loadItems(true)"
      >
        {{ opt.label }}
      </button>
    </div>

    <div class="workshop-grid">
      <div
        v-for="item in items"
        :key="item.id"
        class="workshop-card"
        @click="openDetail(item)"
      >
        <div class="card-preview">
          <img v-if="item.previewUrl" :src="item.previewUrl" :alt="item.title" />
          <div v-else class="preview-placeholder">暂无预览</div>
        </div>
        <div class="card-body">
          <div class="card-title">{{ item.title }}</div>
          <div class="card-meta">
            <span>{{ item.author || '未知作者' }}</span>
            <span>{{ item.subscriptions || 0 }} 订阅</span>
          </div>
        </div>
      </div>
    </div>

    <div v-if="loading" class="loading-more">加载中...</div>
    <div v-else-if="hasMore" class="load-more">
      <LytButton variant="outline" @click="loadMore">加载更多</LytButton>
    </div>

    <!-- Detail Overlay -->
    <Transition name="slide">
      <div v-if="selectedItem" class="detail-overlay" @click.self="closeDetail">
        <div class="detail-panel">
          <button class="detail-close" @click="closeDetail">&times;</button>
          <div v-if="detailLoading" class="detail-loading">加载中...</div>
          <div v-else class="detail-content">
            <div class="detail-preview">
              <img v-if="selectedItem.previewUrl" :src="selectedItem.previewUrl" :alt="selectedItem.title" />
            </div>
            <h3 class="detail-title">{{ selectedItem.title }}</h3>
            <p class="detail-desc">{{ selectedItem.description || '暂无描述' }}</p>
            <div class="detail-actions">
              <LytButton variant="success" @click="subscribe(selectedItem)">订阅</LytButton>
              <LytButton variant="outline" @click="closeDetail">关闭</LytButton>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.workshop-view {
  position: relative;
  padding: 24px 32px;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  gap: 16px;
  flex-wrap: wrap;
}

.page-title {
  font-size: var(--text-2xl);
  font-weight: 700;
  color: var(--text-primary);
}

.search-bar {
  display: flex;
  gap: 8px;
  flex: 1;
  max-width: 500px;
}

.sort-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.sort-tab {
  padding: 6px 14px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border-default);
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: 500;
  cursor: pointer;
  transition: all var(--duration-150);
}

.sort-tab:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.sort-tab.active {
  background: linear-gradient(135deg, var(--primary) 0%, var(--primary-light) 100%);
  border-color: var(--primary);
  color: white;
}

.workshop-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
}

.workshop-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  overflow: hidden;
  cursor: pointer;
  transition: all var(--duration-200);
}

.workshop-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-lg);
  border-color: var(--primary-light);
}

.card-preview {
  height: 140px;
  background: var(--bg-card);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.card-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform var(--duration-300);
}

.workshop-card:hover .card-preview img {
  transform: scale(1.05);
}

.preview-placeholder {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.card-body {
  padding: 12px;
}

.card-title {
  font-weight: 600;
  font-size: var(--text-sm);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
}

.card-meta {
  display: flex;
  justify-content: space-between;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.loading-more,
.load-more {
  text-align: center;
  padding: 24px;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

/* Detail overlay */
.detail-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(15, 23, 42, 0.6);
  -webkit-backdrop-filter: blur(4px);
  backdrop-filter: blur(4px);
  z-index: var(--z-modal);
  display: flex;
  justify-content: flex-end;
}

.detail-panel {
  width: 420px;
  max-width: 100%;
  background: var(--bg-app);
  border-left: 1px solid var(--border-default);
  box-shadow: var(--shadow-2xl);
  padding: 24px;
  overflow-y: auto;
  position: relative;
}

.detail-close {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 32px;
  height: 32px;
  border: none;
  background: var(--bg-hover);
  color: var(--text-muted);
  border-radius: var(--radius-full);
  font-size: 20px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--duration-150);
}

.detail-close:hover {
  background: var(--danger);
  color: white;
  transform: rotate(90deg);
}

.detail-preview {
  height: 200px;
  border-radius: var(--radius-lg);
  overflow: hidden;
  margin-bottom: 16px;
  background: var(--bg-surface);
}

.detail-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.detail-title {
  font-size: var(--text-xl);
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 12px;
}

.detail-desc {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: var(--leading-relaxed);
  margin-bottom: 20px;
  max-height: 200px;
  overflow-y: auto;
}

.detail-actions {
  display: flex;
  gap: 12px;
}

/* Slide transition */
.slide-enter-active,
.slide-leave-active {
  transition: opacity var(--duration-300);
}

.slide-enter-from,
.slide-leave-to {
  opacity: 0;
}

.slide-enter-active .detail-panel,
.slide-leave-active .detail-panel {
  transition: transform var(--duration-300) var(--ease-out);
}

.slide-enter-from .detail-panel,
.slide-leave-to .detail-panel {
  transform: translateX(100%);
}
</style>
