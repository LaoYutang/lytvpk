<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { WindowMinimise, WindowToggleMaximise, WindowIsMaximised, Quit } from '../../api/wails.js'

const isMaximised = ref(false)

async function syncMaximised() {
  try {
    isMaximised.value = await WindowIsMaximised()
  } catch (e) {
    // ignore
  }
}

function toggleMaximise() {
  WindowToggleMaximise()
  setTimeout(syncMaximised, 50)
}

onMounted(() => {
  syncMaximised()
  window.addEventListener('resize', syncMaximised)
})

onUnmounted(() => {
  window.removeEventListener('resize', syncMaximised)
})
</script>

<template>
  <div id="custom-title-bar">
    <div class="title-drag-region" style="--wails-draggable: drag" @dblclick="toggleMaximise">
      <img src="../../assets/images/logo.png" class="title-logo" alt="Logo" />
      <span class="title-text">LytVPK</span>
    </div>
    <div class="window-controls">
      <div class="control-btn" id="w-min-btn" title="最小化" @click="WindowMinimise">
        <svg viewBox="0 0 12 12">
          <path d="M2,6 L10,6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
        </svg>
      </div>
      <div class="control-btn" id="w-max-btn" :title="isMaximised ? '还原' : '最大化'" @click="toggleMaximise">
        <svg v-if="!isMaximised" viewBox="0 0 12 12">
          <path d="M2.5,2.5 L9.5,2.5 L9.5,9.5 L2.5,9.5 Z" stroke="currentColor" stroke-width="1.2" fill="none" />
        </svg>
        <svg v-else viewBox="0 0 12 12">
          <path d="M4.5,4 L4.5,2.5 L9.5,2.5 L9.5,7.5 L8,7.5" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linejoin="miter" />
          <path d="M2.5,4.5 L8,4.5 L8,9.5 L2.5,9.5 Z" stroke="currentColor" stroke-width="1.2" fill="none" />
        </svg>
      </div>
      <div class="control-btn" id="w-close-btn" title="关闭" @click="Quit">
        <svg viewBox="0 0 12 12">
          <path d="M3,3 L9,9 M9,3 L3,9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
        </svg>
      </div>
    </div>
  </div>
</template>

<style scoped>
#custom-title-bar {
  height: 32px;
  flex-shrink: 0;
  background: var(--bg-app);
  display: flex;
  justify-content: space-between;
  align-items: center;
  user-select: none;
  -webkit-user-select: none;
  border-bottom: 1px solid var(--border-light);
}

.title-drag-region {
  flex: 1;
  height: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 12px;
  font-size: 13px;
  color: var(--text-secondary);
}

.title-logo {
  width: 22px;
  height: 22px;
  object-fit: contain;
  -webkit-user-drag: none;
}

.title-text {
  font-size: 15px;
  font-weight: 700;
  font-family: "Nunito", "Segoe UI", "Microsoft YaHei", sans-serif;
  background: linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  letter-spacing: 0.5px;
}

.window-controls {
  display: flex;
  height: 100%;
  overflow: hidden;
  -webkit-app-region: no-drag;
  --wails-draggable: no-drag;
  gap: 4px;
  padding-right: 8px;
  align-items: center;
}

.control-btn {
  width: 40px;
  height: 28px;
  display: flex;
  justify-content: center;
  align-items: center;
  cursor: pointer;
  transition: background-color 0.08s ease;
  color: var(--text-primary);
  border-radius: var(--radius-sm);
  background-color: transparent;
  overflow: hidden;
}

.control-btn svg {
  width: 12px;
  height: 12px;
  pointer-events: none;
}

.control-btn:hover {
  background-color: rgba(0, 0, 0, 0.05) !important;
}

#w-close-btn:hover {
  background-color: #c42b1c !important;
}

#w-close-btn:hover svg,
#w-close-btn:hover svg path {
  color: white;
  stroke: white;
}
</style>
