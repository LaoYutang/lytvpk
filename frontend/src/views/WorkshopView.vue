<script setup>
import { ref, onMounted, computed } from 'vue'
import { FetchWorkshopList, FetchWorkshopDetail, BrowserOpenURL } from '../api/wails.js'
import { useDownloadStore } from '../stores/download.js'
import { formatBBCode } from '../utils/bbcode.js'
import LytButton from '../components/ui/LytButton.vue'
import LytInput from '../components/ui/LytInput.vue'
import ImagePreviewModal from '../components/modals/ImagePreviewModal.vue'

const downloadStore = useDownloadStore()

const items = ref([])
const loading = ref(false)
const searchQuery = ref('')
const sortBy = ref('popular')
const page = ref(1)
const hasMore = ref(true)
const selectedItem = ref(null)
const detailLoading = ref(false)
const selectedCategoryTags = ref([])
const activePreview = ref(0)
const previewModalRef = ref(null)

const sortOptions = [
  { value: 'popular', label: '热门' },
  { value: 'latest', label: '最新' },
  { value: 'toprated', label: '评分最高' },
]

const WORKSHOP_CATEGORIES = [
  {
    name: '幸存者 (Survivors)',
    children: [
      { name: 'Bill', tag: 'Bill' },
      { name: 'Francis', tag: 'Francis' },
      { name: 'Louis', tag: 'Louis' },
      { name: 'Zoey', tag: 'Zoey' },
      { name: 'Coach', tag: 'Coach' },
      { name: 'Ellis', tag: 'Ellis' },
      { name: 'Nick', tag: 'Nick' },
      { name: 'Rochelle', tag: 'Rochelle' },
    ],
  },
  {
    name: '感染者 (Infected)',
    children: [
      { name: '特感', tag: 'Special Infected' },
      { name: 'Tank', tag: 'Tank' },
      { name: 'Witch', tag: 'Witch' },
      { name: 'Hunter', tag: 'Hunter' },
      { name: 'Smoker', tag: 'Smoker' },
      { name: 'Boomer', tag: 'Boomer' },
      { name: 'Charger', tag: 'Charger' },
      { name: 'Jockey', tag: 'Jockey' },
      { name: 'Spitter', tag: 'Spitter' },
      { name: '普通感染者', tag: 'Common Infected' },
    ],
  },
  {
    name: '模式 & 战役',
    children: [
      { name: '战役', tag: 'Campaigns' },
      { name: '合作', tag: 'Co-op' },
      { name: '生存', tag: 'Survival' },
      { name: '对抗', tag: 'Versus' },
      { name: '清道夫', tag: 'Scavenge' },
      { name: '写实', tag: 'Realism' },
      { name: '写实对抗', tag: 'Realism Versus' },
      { name: '突变', tag: 'Mutations' },
      { name: '单人', tag: 'Single Player' },
    ],
  },
  {
    name: '武器 (Weapons)',
    children: [
      { name: '步枪', tag: 'Rifle' },
      { name: '冲锋枪', tag: 'SMG' },
      { name: '散弹枪', tag: 'Shotgun' },
      { name: '狙击枪', tag: 'Sniper' },
      { name: '手枪', tag: 'Pistol' },
      { name: '近战', tag: 'Melee' },
      { name: '榴弹', tag: 'Grenade Launcher' },
      { name: 'M60', tag: 'M60' },
      { name: '投掷物', tag: 'Throwable' },
    ],
  },
  {
    name: '物品 (Items)',
    children: [
      { name: '治疗包', tag: 'Medkit' },
      { name: '电击器', tag: 'Defibrillator' },
      { name: '肾上腺素', tag: 'Adrenaline' },
      { name: '止痛药', tag: 'Pills' },
    ],
  },
  {
    name: '其他资源',
    children: [
      { name: 'UI', tag: 'UI' },
      { name: '音效', tag: 'Sounds' },
      { name: '脚本', tag: 'Scripts' },
      { name: '模型', tag: 'Models' },
      { name: '纹理', tag: 'Textures' },
      { name: '杂项', tag: 'Miscellaneous' },
    ],
  },
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
      tags: selectedCategoryTags.value,
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
  selectedCategoryTags.value = []
  loadItems(true)
}

function loadMore() {
  page.value++
  loadItems()
}

function selectCategory(tag) {
  if (selectedCategoryTags.value.includes(tag)) {
    selectedCategoryTags.value = []
  } else {
    selectedCategoryTags.value = [tag]
  }
  loadItems(true)
}

async function openDetail(item) {
  selectedItem.value = item
  detailLoading.value = true
  activePreview.value = 0
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

function openInBrowser(item) {
  const url = `https://steamcommunity.com/sharedfiles/filedetails/?id=${item.id}`
  BrowserOpenURL(url)
}

function openPreviewImage(url) {
  previewModalRef.value?.open(url)
}

// Helpers
function formatSize(size) {
  if (!size && size !== 0) return '-'
  const s = Number(size)
  if (s >= 1024 * 1024 * 1024) return (s / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
  if (s >= 1024 * 1024) return (s / (1024 * 1024)).toFixed(2) + ' MB'
  if (s >= 1024) return (s / 1024).toFixed(2) + ' KB'
  return s + ' B'
}

function formatNumber(num) {
  if (!num && num !== 0) return '-'
  const n = Number(num)
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return String(n)
}

function formatDate(ts) {
  if (!ts) return '-'
  const date = new Date(Number(ts) * 1000)
  return date.toLocaleDateString('zh-CN')
}

const imagePreviews = computed(() => {
  if (!selectedItem.value?.previews) return []
  return selectedItem.value.previews
    .filter(p => p.preview_type === 0 && p.preview_url)
    .map(p => p.preview_url)
})

const renderedDescription = computed(() => {
  if (!selectedItem.value?.description) return ''
  return formatBBCode(selectedItem.value.description)
})

function handleBBCodeClick(e) {
  const link = e.target.closest('.bbcode-link')
  if (link) {
    e.preventDefault()
    BrowserOpenURL(link.href)
  }
  const img = e.target.closest('.bbcode-img')
  if (img) {
    e.preventDefault()
    openPreviewImage(img.src)
  }
}
</script>

<template>
  <div class="workshop-view">
    <!-- Sidebar -->
    <aside class="category-sidebar">
      <div class="sidebar-header">排序</div>
      <div class="sort-list">
        <button
          v-for="opt in sortOptions"
          :key="opt.value"
          class="sort-item"
          :class="{ active: sortBy === opt.value && selectedCategoryTags.length === 0 }"
          @click="sortBy = opt.value; loadItems(true)"
        >
          {{ opt.label }}
        </button>
      </div>
      <div class="sidebar-divider"></div>
      <div class="sidebar-header">分类筛选</div>
      <div class="category-list">
        <div v-for="cat in WORKSHOP_CATEGORIES" :key="cat.name" class="category-group">
          <div class="category-name">{{ cat.name }}</div>
          <div class="category-children">
            <button
              v-for="child in cat.children"
              :key="child.tag"
              class="category-child"
              :class="{ active: selectedCategoryTags.includes(child.tag) }"
              @click="selectCategory(child.tag)"
            >
              {{ child.name }}
            </button>
          </div>
        </div>
      </div>
    </aside>

    <!-- Main Content -->
    <div class="main-content">
      <div class="page-header">
        <h2 class="page-title">创意工坊</h2>
        <div class="search-bar">
          <LytInput v-model="searchQuery" placeholder="搜索创意工坊..." @keyup.enter="search" />
          <LytButton variant="primary" @click="search">搜索</LytButton>
          <LytButton variant="outline" @click="reset">重置</LytButton>
        </div>
      </div>

      <div v-if="selectedCategoryTags.length > 0" class="active-filters">
        <span class="filter-label">已选分类:</span>
        <span v-for="tag in selectedCategoryTags" :key="tag" class="filter-tag">
          {{ tag }}
          <button @click="selectedCategoryTags = []; loadItems(true)">&times;</button>
        </span>
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
              <span>{{ item.author || item.creator || '未知作者' }}</span>
              <span>{{ formatNumber(item.subscriptions) }} 订阅</span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="loading" class="loading-more">加载中...</div>
      <div v-else-if="hasMore" class="load-more">
        <LytButton variant="outline" @click="loadMore">加载更多</LytButton>
      </div>
    </div>

    <!-- Detail Overlay -->
    <Transition name="slide">
      <div v-if="selectedItem" class="detail-overlay" @click.self="closeDetail">
        <div class="detail-panel">
          <button class="detail-close" @click="closeDetail">&times;</button>
          <div v-if="detailLoading" class="detail-loading">加载中...</div>
          <div v-else class="detail-content">
            <!-- Main preview -->
            <div class="detail-preview" @click="openPreviewImage(selectedItem.previewUrl)">
              <img
                v-if="selectedItem.previewUrl"
                :src="selectedItem.previewUrl"
                :alt="selectedItem.title"
              />
              <div v-else class="preview-placeholder">暂无预览</div>
            </div>

            <!-- Thumbnail strip -->
            <div v-if="imagePreviews.length > 1" class="thumbnail-strip">
              <button
                v-for="(url, idx) in imagePreviews.slice(0, 6)"
                :key="idx"
                class="thumb-item"
                :class="{ active: activePreview === idx }"
                @click="activePreview = idx; selectedItem.previewUrl = url"
              >
                <img :src="url" />
              </button>
            </div>

            <h3 class="detail-title">{{ selectedItem.title }}</h3>

            <!-- Stats -->
            <div class="detail-stats">
              <div class="stat-item">
                <span class="stat-label">订阅</span>
                <span class="stat-value">{{ formatNumber(selectedItem.subscriptions) }}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">收藏</span>
                <span class="stat-value">{{ formatNumber(selectedItem.favorited) }}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">浏览</span>
                <span class="stat-value">{{ formatNumber(selectedItem.views) }}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">大小</span>
                <span class="stat-value">{{ formatSize(selectedItem.file_size) }}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">更新</span>
                <span class="stat-value">{{ formatDate(selectedItem.time_updated) }}</span>
              </div>
            </div>

            <!-- Tags -->
            <div v-if="selectedItem.tags?.length" class="detail-tags">
              <span v-for="t in selectedItem.tags" :key="t.tag" class="detail-tag">{{ t.tag }}</span>
            </div>

            <!-- Description (BBCode) -->
            <div
              class="detail-desc bbcode-content"
              v-html="renderedDescription"
              @click="handleBBCodeClick"
            ></div>

            <div class="detail-actions">
              <LytButton variant="success" @click="subscribe(selectedItem)"><span>&#128229;</span> 订阅</LytButton>
              <LytButton variant="outline" @click="openInBrowser(selectedItem)"><span>&#127760;</span> 在浏览器打开</LytButton>
              <LytButton variant="outline" @click="closeDetail">关闭</LytButton>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <ImagePreviewModal ref="previewModalRef" />
  </div>
</template>

<style scoped>
.workshop-view {
  display: flex;
  height: 100%;
  position: relative;
}

/* Sidebar */
.category-sidebar {
  width: 200px;
  flex-shrink: 0;
  background: var(--bg-surface);
  border-right: 1px solid var(--border-default);
  padding: 16px 12px;
  overflow-y: auto;
  border-radius: var(--radius-lg) 0 0 var(--radius-lg);
}

.sidebar-header {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.sidebar-divider {
  height: 1px;
  background: var(--border-default);
  margin: 12px 0;
}

.sort-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sort-item {
  padding: 6px 10px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  text-align: left;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--duration-150);
}

.sort-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.sort-item.active {
  background: var(--primary-50);
  color: var(--primary);
  font-weight: 500;
}

.category-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.category-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.category-name {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-tertiary);
  padding: 2px 4px;
}

.category-children {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.category-child {
  padding: 4px 10px 4px 16px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  text-align: left;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--duration-150);
}

.category-child:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.category-child.active {
  background: var(--primary-50);
  color: var(--primary);
  font-weight: 500;
}

/* Main Content */
.main-content {
  flex: 1;
  padding: 24px 32px;
  overflow-y: auto;
  min-width: 0;
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

.active-filters {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.filter-label {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.filter-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  background: var(--primary-50);
  color: var(--primary);
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  font-weight: 500;
}

.filter-tag button {
  width: 14px;
  height: 14px;
  border: none;
  background: transparent;
  color: var(--primary);
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-full);
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
  width: 480px;
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

.detail-loading {
  text-align: center;
  padding: 48px;
  color: var(--text-muted);
}

.detail-preview {
  height: 220px;
  border-radius: var(--radius-lg);
  overflow: hidden;
  margin-bottom: 12px;
  background: var(--bg-surface);
  cursor: pointer;
}

.detail-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform var(--duration-300);
}

.detail-preview:hover img {
  transform: scale(1.03);
}

/* Thumbnail strip */
.thumbnail-strip {
  display: flex;
  gap: 6px;
  margin-bottom: 16px;
  overflow-x: auto;
  padding-bottom: 4px;
}

.thumb-item {
  width: 60px;
  height: 60px;
  border: 2px solid var(--border-default);
  border-radius: var(--radius-md);
  overflow: hidden;
  cursor: pointer;
  flex-shrink: 0;
  padding: 0;
  background: var(--bg-surface);
  transition: border-color var(--duration-150);
}

.thumb-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.thumb-item.active {
  border-color: var(--primary);
}

.thumb-item:hover {
  border-color: var(--primary-light);
}

.detail-title {
  font-size: var(--text-xl);
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 12px;
}

.detail-stats {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
  margin-bottom: 12px;
  padding: 10px;
  background: var(--bg-surface);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-light);
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.stat-label {
  font-size: var(--text-2xs);
  color: var(--text-tertiary);
}

.stat-value {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.detail-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}

.detail-tag {
  padding: 2px 10px;
  background: var(--bg-hover);
  color: var(--text-secondary);
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
}

.detail-desc {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: var(--leading-relaxed);
  margin-bottom: 20px;
  max-height: 300px;
  overflow-y: auto;
  padding: 12px;
  background: var(--bg-surface);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-light);
}

.detail-desc :deep(.bbcode-img) {
  max-width: 100%;
  border-radius: var(--radius-md);
  margin: 4px 0;
}

.detail-desc :deep(.bbcode-link) {
  color: var(--primary);
  text-decoration: underline;
}

.detail-desc :deep(.bbcode-list) {
  padding-left: 1.5em;
  margin: 4px 0;
}

.detail-desc :deep(.bbcode-table) {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-xs);
  margin: 4px 0;
}

.detail-desc :deep(.bbcode-table td),
.detail-desc :deep(.bbcode-table th) {
  border: 1px solid var(--border-default);
  padding: 4px 8px;
}

.detail-desc :deep(blockquote) {
  border-left: 3px solid var(--primary);
  padding-left: 12px;
  margin: 4px 0;
  color: var(--text-secondary);
}

.detail-desc :deep(pre) {
  background: var(--bg-card);
  padding: 8px 12px;
  border-radius: var(--radius-md);
  overflow-x: auto;
  font-size: var(--text-xs);
  margin: 4px 0;
}

.detail-desc :deep(.bbcode-spoiler) {
  background: var(--text-primary);
  color: var(--text-primary);
  border-radius: var(--radius-sm);
  padding: 0 4px;
  cursor: pointer;
  transition: color var(--duration-150);
}

.detail-desc :deep(.bbcode-spoiler:hover) {
  color: var(--text-secondary);
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
