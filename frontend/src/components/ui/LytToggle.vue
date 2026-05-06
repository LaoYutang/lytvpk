<script setup>
const props = defineProps({
  modelValue: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue', 'change'])

function toggle() {
  const v = !props.modelValue
  emit('update:modelValue', v)
  emit('change', v)
}
</script>

<template>
  <label class="toggle-switch">
    <input
      type="checkbox"
      :checked="modelValue"
      @change="toggle"
    />
    <span class="toggle-slider"></span>
    <span v-if="$slots.default" class="toggle-label">
      <slot />
    </span>
  </label>
</template>

<style scoped>
.toggle-switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  gap: var(--spacing-2);
  vertical-align: middle;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
  position: absolute;
  z-index: -1;
}

.toggle-slider {
  position: relative;
  width: 40px;
  height: 22px;
  background-color: var(--gray-300);
  border-radius: 22px;
  transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  flex-shrink: 0;
}

.toggle-slider::before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 2px;
  bottom: 2px;
  background-color: white;
  border-radius: 50%;
  transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.toggle-switch input:checked + .toggle-slider {
  background: linear-gradient(135deg, var(--primary) 0%, var(--primary-light) 100%);
}

.toggle-switch input:focus + .toggle-slider {
  box-shadow: 0 0 0 3px var(--primary-50);
}

.toggle-switch input:checked + .toggle-slider::before {
  transform: translateX(18px);
}

.toggle-switch:hover .toggle-slider {
  background-color: var(--gray-400);
}

.toggle-switch:hover input:checked + .toggle-slider {
  background: linear-gradient(135deg, var(--primary-light) 0%, var(--accent) 100%);
}

.toggle-label {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  font-weight: 500;
  user-select: none;
  white-space: nowrap;
}
</style>
