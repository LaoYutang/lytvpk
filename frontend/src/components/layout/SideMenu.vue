<script setup>
import { ref, watch, nextTick, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '../../stores/app.js'

const route = useRoute()
const router = useRouter()
const appStore = useAppStore()

const menuGroups = [
  {
    items: [
      { path: '/', name: 'home', label: 'VPK管理', icon: 'folder' },
      { path: '/workshop', name: 'workshop', label: '创意工坊', icon: 'grid' },
      { path: '/servers', name: 'servers', label: '收藏服务器', icon: 'star' },
      { path: '/downloads', name: 'downloads', label: '下载管理', icon: 'download' },
    ],
  },
  {
    items: [
      { path: '/settings', name: 'settings', label: '设置', icon: 'settings' },
      { path: '/about', name: 'about', label: '关于', icon: 'info' },
    ],
  },
]

const activePath = computed(() => route.path)

function navigate(path) {
  router.push(path)
}

const menuItemsRef = ref(null)
const indicatorTop = ref(0)
const indicatorHeight = ref(0)

function updateIndicator() {
  nextTick(() => {
    const activeBtn = menuItemsRef.value?.querySelector('.menu-item.active')
    if (activeBtn) {
      indicatorTop.value = activeBtn.offsetTop
      indicatorHeight.value = activeBtn.offsetHeight
    }
  })
}

watch(activePath, updateIndicator, { immediate: true })

const indicatorStyle = computed(() => ({
  top: indicatorTop.value + 'px',
  height: indicatorHeight.value + 'px',
}))
</script>

<template>
  <nav class="side-menu">
    <div class="menu-items" ref="menuItemsRef">
      <div class="active-indicator" :style="indicatorStyle"></div>
      <template v-for="(group, groupIndex) in menuGroups" :key="groupIndex">
        <div v-if="groupIndex > 0" class="menu-divider"></div>
        <button
          v-for="item in group.items"
          :key="item.name"
          class="menu-item"
          :class="{ active: activePath === item.path }"
          :data-tooltip="item.label"
          @click="navigate(item.path)"
        >
          <svg class="menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <template v-if="item.icon === 'folder'">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </template>
            <template v-else-if="item.icon === 'star'">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </template>
            <template v-else-if="item.icon === 'grid'">
              <rect x="3" y="3" width="7" height="7"/>
              <rect x="14" y="3" width="7" height="7"/>
              <rect x="14" y="14" width="7" height="7"/>
              <rect x="3" y="14" width="7" height="7"/>
            </template>
            <template v-else-if="item.icon === 'download'">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </template>
            <template v-else-if="item.icon === 'settings'">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </template>
            <template v-else-if="item.icon === 'info'">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="16" x2="12" y2="12"/>
              <line x1="12" y1="8" x2="12.01" y2="8"/>
            </template>
          </svg>
          <span class="menu-label">{{ item.label }}</span>
        </button>
      </template>
    </div>

    <div class="menu-footer">
      <button
        class="theme-btn"
        :data-tooltip="appStore.isDark ? '切换亮色' : '切换暗色'"
        @click="appStore.toggleTheme"
      >
        <svg v-if="appStore.isDark" class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="5"/>
          <line x1="12" y1="1" x2="12" y2="3"/>
          <line x1="12" y1="21" x2="12" y2="23"/>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
          <line x1="1" y1="12" x2="3" y2="12"/>
          <line x1="21" y1="12" x2="23" y2="12"/>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>
        <svg v-else class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      </button>
    </div>
  </nav>
</template>

<style scoped>
.side-menu {
  width: 68px;
  flex-shrink: 0;
  position: relative;
  z-index: var(--z-sticky);
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.7) 0%,
    rgba(248, 250, 252, 0.55) 100%
  );
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  display: flex;
  flex-direction: column;
  padding: 16px 8px;
  transition: width 0.3s ease;
  user-select: none;
  margin: 8px 0 8px 8px;
  border-radius: var(--radius-xl);
  border: 1px solid rgba(255, 255, 255, 0.6);
  box-shadow:
    var(--shadow-md),
    inset 0 1px 0 rgba(255, 255, 255, 0.8);
}

:root.dark-mode .side-menu {
  background: linear-gradient(
    180deg,
    rgba(30, 41, 59, 0.65) 0%,
    rgba(15, 23, 42, 0.55) 100%
  );
  border: 1px solid rgba(148, 163, 184, 0.18);
  box-shadow:
    var(--shadow-lg),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

.menu-items {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

.active-indicator {
  position: absolute;
  left: 0;
  right: 0;
  background: var(--primary);
  border-radius: var(--radius-lg);
  transition: top 0.3s var(--ease-out), height 0.3s var(--ease-out);
}

.menu-divider {
  height: 1px;
  background: var(--border-default);
  margin: 8px 4px;
  position: relative;
}

.menu-item {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  padding: 12px;
  border-radius: var(--radius-lg);
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: color var(--duration-150) var(--ease-out);
  position: relative;
  text-align: left;
  width: 100%;
}

.menu-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.menu-item.active {
  background: transparent;
  color: #ffffff;
  font-weight: 600;
}

.menu-item.active:hover {
  background: transparent;
  color: #ffffff;
}

.menu-icon {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
}

.menu-label {
  display: none;
}

.menu-footer {
  padding-top: 12px;
  border-top: 1px solid var(--border-default);
  display: flex;
  justify-content: center;
}

.theme-btn {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-full);
  border: none;
  background: var(--bg-hover);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--duration-150) var(--ease-out);
  position: relative;
}

.theme-btn:hover {
  background: var(--bg-active);
  color: var(--text-primary);
}

.theme-btn svg {
  width: 18px;
  height: 18px;
}

/* CSS Tooltip */
.menu-item[data-tooltip]::after,
.theme-btn[data-tooltip]::after {
  content: attr(data-tooltip);
  position: absolute;
  left: calc(100% + 10px);
  top: 50%;
  transform: translateY(-50%) scale(0.95);
  background: var(--bg-overlay);
  color: var(--text-primary);
  padding: 6px 12px;
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-weight: 500;
  white-space: nowrap;
  box-shadow: var(--shadow-lg);
  border: 1px solid var(--border-light);
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--duration-150) var(--ease-out),
              transform var(--duration-150) var(--ease-out);
  z-index: var(--z-tooltip);
}

.menu-item[data-tooltip]::before,
.theme-btn[data-tooltip]::before {
  content: "";
  position: absolute;
  left: calc(100% + 4px);
  top: 50%;
  transform: translateY(-50%);
  border: 6px solid transparent;
  border-right-color: var(--bg-overlay);
  opacity: 0;
  transition: opacity var(--duration-150) var(--ease-out);
  z-index: var(--z-tooltip);
}

.menu-item:hover[data-tooltip]::after,
.menu-item:hover[data-tooltip]::before,
.theme-btn:hover[data-tooltip]::after,
.theme-btn:hover[data-tooltip]::before {
  opacity: 1;
  transform: translateY(-50%) scale(1);
}
</style>
