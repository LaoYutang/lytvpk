<script setup>
import { useAppStore } from '../../stores/app.js'

const appStore = useAppStore()

const typeColors = {
  success: 'var(--success)',
  error: 'var(--danger)',
  info: 'var(--accent)',
}
</script>

<template>
  <Teleport to="body">
    <div class="toast-container">
      <TransitionGroup name="toast">
        <div
          v-for="toast in appStore.toasts"
          :key="toast.id"
          class="toast"
          :class="`toast-${toast.type}`"
          :style="{ borderBottomColor: typeColors[toast.type] || typeColors.info }"
        >
          <span class="toast-message">{{ toast.message }}</span>
          <button class="toast-close" @click="appStore.removeToast(toast.id)">&times;</button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-container {
  position: fixed;
  top: 48px;
  right: 16px;
  z-index: var(--z-toast);
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}

.toast {
  pointer-events: auto;
  min-width: 20rem;
  max-width: 28rem;
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
  -webkit-backdrop-filter: blur(20px);
  backdrop-filter: blur(20px);
  border: 1px solid var(--border-light);
  border-bottom: 4px solid;
  background: var(--bg-overlay);
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.toast-message {
  color: var(--text-primary);
  font-size: var(--text-sm);
  line-height: var(--leading-snug);
}

.toast-close {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 18px;
  cursor: pointer;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-full);
  flex-shrink: 0;
  transition: all var(--duration-150);
}

.toast-close:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

/* Transition */
.toast-enter-active {
  animation: slideInRight var(--duration-300) var(--ease-out);
}

.toast-leave-active {
  animation: slideInRight var(--duration-300) var(--ease-out) reverse;
}
</style>
