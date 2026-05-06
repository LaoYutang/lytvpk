<script setup>
const props = defineProps({
  variant: { type: String, default: 'primary' },
  size: { type: String, default: 'default' },
  iconOnly: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  type: { type: String, default: 'button' },
})

defineEmits(['click'])

const variantClass = `btn-${props.variant}`
const sizeClass = props.size !== 'default' ? `btn-${props.size}` : ''
</script>

<template>
  <button
    :type="type"
    class="btn"
    :class="[variantClass, sizeClass, { 'btn-icon-only': iconOnly }]"
    :disabled="disabled"
    @click="$emit('click', $event)"
  >
    <slot />
  </button>
</template>

<style scoped>
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-2);
  padding: var(--spacing-2) var(--spacing-4);
  border: none;
  border-radius: var(--radius-lg);
  font-family: inherit;
  font-size: var(--text-sm);
  font-weight: 500;
  line-height: var(--leading-tight);
  text-decoration: none;
  cursor: pointer;
  -webkit-user-select: none;
  user-select: none;
  transition: all var(--duration-150) var(--ease-out);
  position: relative;
  overflow: hidden;
  white-space: nowrap;
  min-height: 2.5rem;
  background: none;
  color: inherit;
}

/* 扫光效果 */
.btn::before {
  content: "";
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
  transition: left var(--duration-500) var(--ease-out);
}

.btn:hover::before {
  left: 100%;
}

.btn:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}

.btn:active {
  animation: bounce 0.6s ease-out;
}

/* Primary */
.btn-primary {
  background: linear-gradient(135deg, var(--primary) 0%, var(--primary-light) 100%);
  color: white;
  box-shadow: var(--shadow-sm);
}

.btn-primary:hover {
  background: linear-gradient(135deg, var(--primary-light) 0%, var(--accent) 100%);
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}

.btn-primary:active {
  transform: translateY(0);
  box-shadow: var(--shadow-sm);
}

/* Success */
.btn-success {
  background: linear-gradient(135deg, var(--success) 0%, var(--success-light) 100%);
  color: white;
  box-shadow: var(--shadow-sm);
}

.btn-success:hover {
  background: linear-gradient(135deg, var(--success-light) 0%, var(--success) 100%);
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}

/* Danger */
.btn-danger {
  background: linear-gradient(135deg, var(--danger) 0%, var(--danger-light) 100%);
  color: white;
  box-shadow: var(--shadow-sm);
}

.btn-danger:hover {
  background: linear-gradient(135deg, var(--danger-light) 0%, var(--danger-dark) 100%);
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}

/* Accent */
.btn-accent {
  background: linear-gradient(135deg, var(--accent) 0%, var(--accent-light) 100%);
  color: white;
  box-shadow: var(--shadow-sm);
}

.btn-accent:hover {
  background: linear-gradient(135deg, var(--accent-light) 0%, var(--accent-dark) 100%);
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}

/* Secondary */
.btn-secondary {
  background: var(--bg-card);
  color: var(--text-secondary);
  border: 1px solid var(--border-light);
  box-shadow: var(--shadow-xs);
}

.btn-secondary:hover {
  background: var(--bg-hover);
  border-color: var(--border-strong);
  color: var(--text-primary);
  box-shadow: var(--shadow-sm);
  transform: translateY(-1px);
}

/* Outline */
.btn-outline {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border-light);
}

.btn-outline:hover {
  background: var(--primary-50);
  border-color: var(--primary);
  color: var(--primary-light);
}

/* Ghost */
.btn-ghost {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border-default);
  box-shadow: none;
}

.btn-ghost:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
  border-color: var(--border-strong);
  box-shadow: var(--shadow-xs);
}

/* Sizes */
.btn-small {
  padding: var(--spacing-1) var(--spacing-3);
  font-size: var(--text-xs);
  min-height: 2rem;
}

.btn-large {
  padding: var(--spacing-3) var(--spacing-6);
  font-size: var(--text-lg);
  min-height: 3rem;
}

.btn-icon-only {
  padding: var(--spacing-2);
  min-width: 2.5rem;
  width: 2.5rem;
  gap: 0;
}

.btn-icon-only :deep(svg) {
  width: 16px;
  height: 16px;
}
</style>
