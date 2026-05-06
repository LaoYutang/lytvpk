<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { useVpkStore } from '../stores/vpk.js'
import { useAppStore } from '../stores/app.js'
import {
  SelectDirectory,
  LaunchL4D2,
  GetRootDirectory,
  SetRootDirectory,
  OpenFileLocation,
} from '../api/wails.js'
import LytButton from '../components/ui/LytButton.vue'
import LytInput from '../components/ui/LytInput.vue'
import LytToggle from '../components/ui/LytToggle.vue'
import LytTag from '../components/ui/LytTag.vue'
import LytModal from '../components/ui/LytModal.vue'
import FileDetailModal from '../components/modals/FileDetailModal.vue'
import ConflictModal from '../components/modals/ConflictModal.vue'

const vpkStore = useVpkStore()
const appStore = useAppStore()

const showSortDropdown = ref(false)
const showBatchDropdown = ref(false)
const showDetail = ref(false)
const detailFile = ref(null)
const showRename = ref(false)
const renameTarget = ref({ oldName: '', newName: '' })
const showLoadOrder = ref(false)
const loadOrderTarget = ref({ name: '', current: 0, newOrder: 0 })

const sortOptions = [
  { value: 'name', label: '文件名排序' },
  { value: 'date', label: '更新时间排序' },
  { value: 'loadOrder', label: '加载顺序排序' },
]

onMounted(async () => {
  try {
    const savedDir = appStore.loadSavedDirectory()
    if (savedDir) {
      await SetRootDirectory(savedDir)
      appStore.currentDirectory = savedDir
      await vpkStore.scanFiles()
    } else {
      const dir = await GetRootDirectory()
      if (dir) {
        appStore.currentDirectory = dir
        await vpkStore.loadFiles()
      }
    }
  } catch (e) { }
})

watch(() => vpkStore.searchQuery, () => vpkStore.applyFilters())
watch(() => vpkStore.showHidden, () => vpkStore.applyFilters())
watch(() => vpkStore.selectedPrimaryTag, () => vpkStore.applyFilters())
watch(() => vpkStore.selectedSecondaryTags, () => vpkStore.applyFilters())
watch(() => vpkStore.selectedLocations, () => vpkStore.applyFilters())
watch(() => vpkStore.sortType, () => vpkStore.applyFilters())

async function selectDirectory() {
  try {
    const dir = await SelectDirectory()
    if (dir) {
      await SetRootDirectory(dir)
      appStore.currentDirectory = dir
      appStore.saveDirectory(dir)
      await vpkStore.scanFiles()
    }
  } catch (e) {
    console.error(e)
  }
}

function setSort(type) {
  if (vpkStore.sortType === type) {
    vpkStore.sortOrder = vpkStore.sortOrder === 'asc' ? 'desc' : 'asc'
  } else {
    vpkStore.sortType = type
    vpkStore.sortOrder = 'asc'
  }
  vpkStore.applyFilters()
  showSortDropdown.value = false
}

function toggleTag(tag) {
  const idx = vpkStore.selectedSecondaryTags.indexOf(tag)
  if (idx === -1) {
    vpkStore.selectedSecondaryTags.push(tag)
  } else {
    vpkStore.selectedSecondaryTags.splice(idx, 1)
  }
  vpkStore.applyFilters()
}

function toggleLocation(loc) {
  const idx = vpkStore.selectedLocations.indexOf(loc)
  if (idx === -1) {
    vpkStore.selectedLocations.push(loc)
  } else {
    vpkStore.selectedLocations.splice(idx, 1)
  }
  vpkStore.applyFilters()
}

function openDetail(file) {
  detailFile.value = file
  showDetail.value = true
}

function openRename(file) {
  renameTarget.value = { oldName: file.name, newName: file.name.replace(/\.vpk$/i, '') }
  showRename.value = true
}

async function confirmRename() {
  await vpkStore.renameFile(renameTarget.value.oldName, renameTarget.value.newName + '.vpk')
  showRename.value = false
}

function resetFilters() {
  vpkStore.searchQuery = ''
  vpkStore.selectedPrimaryTag = ''
  vpkStore.selectedSecondaryTags = []
  vpkStore.selectedLocations = []
  vpkStore.showHidden = false
  vpkStore.applyFilters()
}

const hasSelected = computed(() => vpkStore.selectedCount > 0)

async function enableSelected() {
  for (const f of vpkStore.filteredFiles) {
    if (vpkStore.selectedFiles.has(f.name) && f.disabled) {
      await vpkStore.toggleFile(f.name)
    }
  }
}

async function disableSelected() {
  for (const f of vpkStore.filteredFiles) {
    if (vpkStore.selectedFiles.has(f.name) && !f.disabled) {
      await vpkStore.toggleFile(f.name)
    }
  }
}
</script>

<template>
  <div class="home-view">
    <!-- Header -->
    <header class="header-bar">
      <div class="header-left">
        <LytButton variant="primary" @click="selectDirectory">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
          选择addons目录
        </LytButton>
        <span v-if="appStore.currentDirectory" class="current-dir">{{ appStore.currentDirectory }}</span>
      </div>
      <div class="header-right">
        <LytButton variant="success" @click="LaunchL4D2">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          启动 L4D2
        </LytButton>
      </div>
    </header>

    <!-- Filter Bar -->
    <div class="filter-bar">
      <div class="filter-row">
        <div class="search-box">
          <svg class="search-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <LytInput v-model="vpkStore.searchQuery" placeholder="搜索VPK文件..." />
        </div>
        <div class="location-filters">
          <LytTag
            v-for="loc in vpkStore.locations"
            :key="loc"
            :active="vpkStore.selectedLocations.includes(loc)"
            @click="toggleLocation(loc)"
          >
            {{ loc }}
          </LytTag>
        </div>
        <div class="filter-actions">
          <LytButton variant="outline" size="small" @click="vpkStore.loadFiles()">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
            刷新
          </LytButton>
          <LytButton variant="outline" size="small" @click="$refs.conflictModal?.open()">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            冲突检测
          </LytButton>
          <LytButton variant="outline" size="small" @click="resetFilters">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="1 4 1 10 7 10"/>
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
            </svg>
            重置筛选
          </LytButton>
          <div class="sort-dropdown-wrapper">
            <LytButton variant="outline" size="small" @click="showSortDropdown = !showSortDropdown">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="8" y1="6" x2="21" y2="6"/>
                <line x1="8" y1="12" x2="21" y2="12"/>
                <line x1="8" y1="18" x2="21" y2="18"/>
                <line x1="3" y1="6" x2="3.01" y2="6"/>
                <line x1="3" y1="12" x2="3.01" y2="12"/>
                <line x1="3" y1="18" x2="3.01" y2="18"/>
              </svg>
              {{ sortOptions.find(o => o.value === vpkStore.sortType)?.label }}
            </LytButton>
            <Transition name="dropdown">
              <div v-if="showSortDropdown" class="sort-dropdown">
                <button
                  v-for="opt in sortOptions"
                  :key="opt.value"
                  class="sort-option"
                  :class="{ active: vpkStore.sortType === opt.value }"
                  @click="setSort(opt.value)"
                >
                  {{ opt.label }}
                </button>
              </div>
            </Transition>
          </div>
        </div>
      </div>
      <div class="filter-row">
        <LytToggle v-model="vpkStore.showHidden">显示隐藏VPK</LytToggle>
        <div class="tag-filters">
          <LytTag
            v-for="tag in vpkStore.primaryTags"
            :key="tag"
            :active="vpkStore.selectedPrimaryTag === tag"
            @click="vpkStore.selectedPrimaryTag = vpkStore.selectedPrimaryTag === tag ? '' : tag"
          >
            {{ tag }}
          </LytTag>
        </div>
        <div class="view-toggle">
          <button
            class="view-btn"
            :class="{ active: vpkStore.displayMode === 'list' }"
            @click="vpkStore.displayMode = 'list'"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="8" y1="6" x2="21" y2="6"/>
              <line x1="8" y1="12" x2="21" y2="12"/>
              <line x1="8" y1="18" x2="21" y2="18"/>
              <line x1="3" y1="6" x2="3.01" y2="6"/>
              <line x1="3" y1="12" x2="3.01" y2="12"/>
              <line x1="3" y1="18" x2="3.01" y2="18"/>
            </svg>
          </button>
          <button
            class="view-btn"
            :class="{ active: vpkStore.displayMode === 'card' }"
            @click="vpkStore.displayMode = 'card'"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="7" height="7"/>
              <rect x="14" y="3" width="7" height="7"/>
              <rect x="14" y="14" width="7" height="7"/>
              <rect x="3" y="14" width="7" height="7"/>
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- File List -->
    <div class="file-list-container">
      <div v-if="vpkStore.filteredFiles.length === 0" class="empty-state">
        暂无VPK文件
      </div>

      <!-- List View -->
      <div v-else-if="vpkStore.displayMode === 'list'" class="file-list">
        <div class="file-list-header">
          <div class="col-check">
            <input
              type="checkbox"
              :checked="vpkStore.selectedCount === vpkStore.filteredFiles.length && vpkStore.filteredFiles.length > 0"
              @change="vpkStore.selectedCount === vpkStore.filteredFiles.length ? vpkStore.deselectAll() : vpkStore.selectAll()"
            />
          </div>
          <div class="col-name">文件名</div>
          <div class="col-size">大小</div>
          <div class="col-status">状态</div>
          <div class="col-location">位置</div>
          <div class="col-tags">标签</div>
          <div class="col-actions">操作</div>
        </div>
        <div
          v-for="file in vpkStore.filteredFiles"
          :key="file.name"
          class="file-item"
          :class="{ disabled: file.disabled, hidden: file.hidden }"
        >
          <div class="col-check">
            <input
              type="checkbox"
              :checked="vpkStore.selectedFiles.has(file.name)"
              @change="vpkStore.toggleFileSelection(file.name)"
            />
          </div>
          <div class="col-name">
            <div class="file-title">{{ file.title || file.name }}</div>
            <div class="file-filename">{{ file.name }}</div>
          </div>
          <div class="col-size">{{ file.sizeText || file.size }}</div>
          <div class="col-status">
            <span class="status-badge" :class="file.disabled ? 'disabled' : 'enabled'">
              {{ file.disabled ? '已禁用' : '已启用' }}
            </span>
          </div>
          <div class="col-location">{{ file.location }}</div>
          <div class="col-tags">
            <LytTag v-if="file.primaryTag">{{ file.primaryTag }}</LytTag>
          </div>
          <div class="col-actions">
            <LytButton variant="ghost" size="small" icon-only @click="openDetail(file)">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="16" x2="12" y2="12"/>
                <line x1="12" y1="8" x2="12.01" y2="8"/>
              </svg>
            </LytButton>
            <LytButton variant="ghost" size="small" icon-only @click="vpkStore.toggleFile(file.name)">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path v-if="file.disabled" d="M18.36 6.64a9 9 0 1 1-12.73 0"/>
                <line x1="12" y1="2" x2="12" y2="12"/>
              </svg>
            </LytButton>
            <LytButton variant="ghost" size="small" icon-only @click="openRename(file)">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </LytButton>
            <LytButton variant="ghost" size="small" icon-only @click="OpenFileLocation(file.name)">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
            </LytButton>
          </div>
        </div>
      </div>

      <!-- Card View -->
      <div v-else class="file-grid">
        <div
          v-for="file in vpkStore.filteredFiles"
          :key="file.name"
          class="file-card"
          :class="{ disabled: file.disabled }"
          @click="openDetail(file)"
        >
          <div class="card-preview">
            <img v-if="file.previewUrl" :src="file.previewUrl" :alt="file.name" />
            <div v-else class="preview-placeholder">{{ file.name.slice(0, 2) }}</div>
          </div>
          <div class="card-body">
            <div class="card-title">{{ file.title || file.name }}</div>
            <div class="card-filename">{{ file.name }}</div>
            <div class="card-tags">
              <LytTag v-if="file.primaryTag">{{ file.primaryTag }}</LytTag>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Status Bar -->
    <div class="status-bar">
      <div class="status-info">
        <span>共 {{ vpkStore.totalCount }} 个</span>
        <span class="status-sep">|</span>
        <span>已启用 {{ vpkStore.enabledCount }}</span>
        <span class="status-sep">|</span>
        <span>已禁用 {{ vpkStore.disabledCount }}</span>
        <span v-if="vpkStore.selectedCount > 0" class="status-sep">|</span>
        <span v-if="vpkStore.selectedCount > 0">已选择 {{ vpkStore.selectedCount }}</span>
      </div>
      <div class="status-actions">
        <template v-if="hasSelected">
          <LytButton variant="success" size="small" @click="enableSelected">
            启用选中
          </LytButton>
          <LytButton variant="danger" size="small" @click="disableSelected">
            禁用选中
          </LytButton>
          <LytButton variant="outline" size="small" @click="vpkStore.deleteSelected">
            删除选中
          </LytButton>
          <LytButton variant="outline" size="small" @click="vpkStore.exportSelected">
            导出ZIP
          </LytButton>
        </template>
        <LytButton variant="ghost" size="small" @click="vpkStore.selectAll">
          全选
        </LytButton>
        <LytButton variant="ghost" size="small" @click="vpkStore.deselectAll">
          取消全选
        </LytButton>
      </div>
    </div>

    <!-- Rename Modal -->
    <LytModal v-model="showRename" title="重命名文件" size="small">
      <div class="form-body">
        <label>新文件名</label>
        <LytInput v-model="renameTarget.newName" />
        <span class="suffix">.vpk</span>
      </div>
      <template #footer>
        <LytButton variant="secondary" @click="showRename = false">取消</LytButton>
        <LytButton variant="primary" @click="confirmRename">确定</LytButton>
      </template>
    </LytModal>

    <!-- File Detail Modal -->
    <FileDetailModal v-model="showDetail" :file="detailFile" />
    <!-- Conflict Modal -->
    <ConflictModal ref="conflictModal" />
  </div>
</template>

<style scoped>
.home-view {
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* Header */
.header-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  background: rgba(255, 255, 255, 0.9);
  -webkit-backdrop-filter: blur(20px);
  backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--border-light);
  gap: 16px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.current-dir {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.header-right {
  display: flex;
  gap: 8px;
}

/* Filter Bar */
.filter-bar {
  padding: 12px 24px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-default);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.filter-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.search-box {
  position: relative;
  flex: 1;
  max-width: 300px;
  min-width: 200px;
}

.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  z-index: 1;
  pointer-events: none;
}

.search-box :deep(.lyt-input) {
  padding-left: 36px;
}

.location-filters {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.filter-actions {
  display: flex;
  gap: 6px;
  margin-left: auto;
}

.sort-dropdown-wrapper {
  position: relative;
}

.sort-dropdown {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  background: var(--bg-app);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  z-index: var(--z-dropdown);
  min-width: 160px;
  padding: 4px;
}

.sort-option {
  display: block;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: var(--text-sm);
  text-align: left;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--duration-150);
}

.sort-option:hover {
  background: var(--bg-hover);
}

.sort-option.active {
  background: var(--primary-50);
  color: var(--primary);
}

.tag-filters {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  flex: 1;
}

.view-toggle {
  display: flex;
  gap: 4px;
  margin-left: auto;
}

.view-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-default);
  background: var(--bg-card);
  color: var(--text-secondary);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--duration-150);
}

.view-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.view-btn.active {
  background: linear-gradient(135deg, var(--primary) 0%, var(--primary-light) 100%);
  border-color: var(--primary);
  color: white;
}

/* File List Container */
.file-list-container {
  flex: 1;
  overflow: auto;
  min-height: 0;
}

.empty-state {
  text-align: center;
  padding: 64px;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

/* List View */
.file-list {
  display: flex;
  flex-direction: column;
}

.file-list-header {
  display: grid;
  grid-template-columns: 40px minmax(200px, 2fr) 100px 90px 120px minmax(120px, 1fr) 160px;
  gap: 8px;
  padding: 10px 24px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-default);
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  position: sticky;
  top: 0;
  z-index: 10;
}

.file-item {
  display: grid;
  grid-template-columns: 40px minmax(200px, 2fr) 100px 90px 120px minmax(120px, 1fr) 160px;
  gap: 8px;
  padding: 10px 24px;
  border-bottom: 1px solid var(--border-default);
  align-items: center;
  background: var(--bg-app);
  transition: all var(--duration-150);
  animation: fadeIn var(--duration-300) var(--ease-out);
  position: relative;
}

.file-item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: transparent;
  transition: background var(--duration-200);
}

.file-item:hover {
  background: var(--primary-50);
  box-shadow: var(--shadow-sm);
}

.file-item:hover::before {
  background: linear-gradient(180deg, var(--primary) 0%, var(--accent) 100%);
}

.file-item.disabled {
  opacity: 0.7;
}

.file-item.disabled .file-title {
  text-decoration: line-through;
  color: var(--text-muted);
}

.col-check {
  display: flex;
  align-items: center;
  justify-content: center;
}

.col-check input {
  width: 16px;
  height: 16px;
}

.file-title {
  font-weight: 500;
  font-size: var(--text-sm);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-filename {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.col-size {
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.status-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  font-weight: 500;
}

.status-badge.enabled {
  background: rgba(16, 185, 129, 0.1);
  color: var(--success);
}

.status-badge.disabled {
  background: rgba(239, 68, 68, 0.1);
  color: var(--danger);
}

.col-location {
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.col-actions {
  display: flex;
  gap: 2px;
}

/* Card View */
.file-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
  padding: 16px 24px;
}

.file-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  overflow: hidden;
  cursor: pointer;
  transition: all var(--duration-200);
}

.file-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-lg);
  border-color: var(--primary-light);
}

.file-card.disabled {
  opacity: 0.75;
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

.file-card:hover .card-preview img {
  transform: scale(1.05);
}

.preview-placeholder {
  font-size: 32px;
  font-weight: 700;
  color: var(--text-muted);
  opacity: 0.3;
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

.card-filename {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  margin-bottom: 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-tags {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

/* Status Bar */
.status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 24px;
  background: rgba(255, 255, 255, 0.9);
  -webkit-backdrop-filter: blur(20px);
  backdrop-filter: blur(20px);
  border-top: 1px solid var(--border-default);
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  gap: 12px;
}

.status-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-sep {
  color: var(--border-strong);
}

.status-actions {
  display: flex;
  gap: 6px;
}

/* Form body */
.form-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.form-body label {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-secondary);
}

.suffix {
  font-size: var(--text-sm);
  color: var(--text-tertiary);
}

/* Dropdown transition */
.dropdown-enter-active,
.dropdown-leave-active {
  transition: opacity var(--duration-150), transform var(--duration-150);
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
