<script setup>
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  size: { type: String, default: 'medium' },
  title: { type: String, default: '' },
  closable: { type: Boolean, default: true },
})

const emit = defineEmits(['update:modelValue', 'close'])

function close() {
  emit('update:modelValue', false)
  emit('close')
}

function onBackdropClick(e) {
  if (e.target === e.currentTarget && props.closable) {
    close()
  }
}

const sizeClass = `modal-${props.size}`
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="modelValue" class="modal" @click="onBackdropClick">
        <div class="modal-content" :class="sizeClass">
          <div v-if="title || closable" class="modal-header">
            <h3 v-if="title" class="modal-title">{{ title }}</h3>
            <button v-if="closable" class="close-btn" @click="close">&times;</button>
          </div>
          <div class="modal-body">
            <slot />
          </div>
          <div v-if="$slots.footer" class="modal-footer">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(15, 23, 42, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-modal);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}

.modal-content {
  background: var(--bg-app);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-2xl);
  width: 90vw;
  max-height: 80vh;
  overflow: hidden;
  border: 1px solid var(--border-light);
  display: flex;
  flex-direction: column;
}

.modal-small {
  max-width: 24rem;
}

.modal-medium {
  max-width: 36rem;
}

.modal-large {
  max-width: 48rem;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-6);
  border-bottom: 1px solid var(--border-default);
  background: linear-gradient(135deg, rgba(79, 70, 229, 0.03) 0%, rgba(6, 182, 212, 0.03) 100%);
}

.modal-title {
  font-size: var(--text-xl);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  word-break: break-word;
  margin-right: var(--spacing-4);
}

.close-btn {
  width: 2rem;
  height: 2rem;
  border: none;
  background: var(--bg-hover);
  color: var(--text-muted);
  font-size: var(--text-lg);
  cursor: pointer;
  border-radius: var(--radius-full);
  transition: all var(--duration-150) var(--ease-out);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.close-btn:hover {
  background: var(--danger);
  color: white;
  transform: rotate(90deg);
}

.modal-body {
  padding: var(--spacing-6);
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.modal-footer {
  display: flex;
  gap: var(--spacing-3);
  padding: var(--spacing-6);
  border-top: 1px solid var(--border-default);
  justify-content: flex-end;
  background: rgba(248, 250, 252, 0.8);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}

/* Vue transition */
.modal-enter-active,
.modal-leave-active {
  transition: opacity var(--duration-300) var(--ease-out);
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-active .modal-content,
.modal-leave-active .modal-content {
  transition: transform var(--duration-300) var(--ease-out);
}

.modal-enter-from .modal-content,
.modal-leave-to .modal-content {
  transform: scale(0.95) translateY(1rem);
}
</style>
