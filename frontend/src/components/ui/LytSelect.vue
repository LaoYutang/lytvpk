<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: '请选择' },
})

const emit = defineEmits(['update:modelValue', 'change'])

const open = ref(false)

const selectedLabel = computed(() => {
  const opt = props.options.find(o => o.value === props.modelValue)
  return opt ? opt.label : props.placeholder
})

function select(value) {
  emit('update:modelValue', value)
  emit('change', value)
  open.value = false
}

function toggle() {
  open.value = !open.value
}

function onBlur() {
  setTimeout(() => { open.value = false }, 150)
}
</script>

<template>
  <div class="lyt-select" @blur="onBlur" tabindex="0">
    <div class="select-trigger" @click="toggle">
      <span class="select-value" :class="{ placeholder: !modelValue }">{{ selectedLabel }}</span>
      <svg class="select-arrow" :class="{ open }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </div>
    <Transition name="dropdown">
      <div v-if="open" class="select-dropdown">
        <div
          v-for="opt in options"
          :key="opt.value"
          class="select-option"
          :class="{ active: opt.value === modelValue }"
          @click="select(opt.value)"
        >
          {{ opt.label }}
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.lyt-select {
  position: relative;
  width: 100%;
  outline: none;
}

.select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-2) var(--spacing-3);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: all var(--duration-200) var(--ease-out);
  height: 2.5rem;
}

.select-trigger:hover {
  border-color: var(--primary);
}

.select-value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.select-value.placeholder {
  color: var(--text-muted);
}

.select-arrow {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  transition: transform var(--duration-200);
  color: var(--text-muted);
}

.select-arrow.open {
  transform: rotate(180deg);
}

.select-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: var(--bg-app);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  z-index: var(--z-dropdown);
  max-height: 250px;
  overflow-y: auto;
  padding: 4px;
}

.select-option {
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--text-sm);
  color: var(--text-primary);
  transition: all var(--duration-150);
}

.select-option:hover {
  background: var(--bg-hover);
}

.select-option.active {
  background: var(--primary-50);
  color: var(--primary);
}

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
