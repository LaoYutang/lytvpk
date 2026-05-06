<script setup>
import { WindowMinimise, WindowToggleMaximise, Quit } from '../../api/wails.js'
</script>

<template>
  <div id="custom-title-bar">
    <div class="title-drag-region" style="--wails-draggable: drag">
      <span class="app-title">LytVPK MOD管理器</span>
    </div>
    <div class="window-controls">
      <div class="control-btn" id="w-min-btn" title="最小化" @click="WindowMinimise">
        <svg viewBox="0 0 12 12">
          <path d="M2,6 L10,6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
        </svg>
      </div>
      <div class="control-btn" id="w-max-btn" title="最大化/还原" @click="WindowToggleMaximise">
        <svg viewBox="0 0 12 12">
          <path d="M2.5,2.5 L9.5,2.5 L9.5,9.5 L2.5,9.5 Z" stroke="currentColor" stroke-width="1.2" fill="none" />
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
  border-bottom: 1px solid var(--border-default);
}

.title-drag-region {
  flex: 1;
  height: 100%;
  display: flex;
  align-items: center;
  padding-left: 16px;
  font-size: 13px;
  color: var(--text-secondary);
}

.app-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
  font-family: "Nunito", "Segoe UI", "Microsoft YaHei", sans-serif;
  letter-spacing: 0.5px;
}

.window-controls {
  display: flex;
  height: 100%;
  overflow: hidden;
  -webkit-app-region: no-drag;
  --wails-draggable: no-drag;
}

.control-btn {
  width: 46px;
  height: 32px;
  display: flex;
  justify-content: center;
  align-items: center;
  cursor: default;
  transition: background-color 0.08s ease;
  color: var(--text-primary);
  border-radius: 0;
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
