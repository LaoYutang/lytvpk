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
  <label class="lyt-checkbox" @click.prevent="toggle">
    <input
      type="checkbox"
      :checked="modelValue"
      @change="toggle"
    />
    <span class="checkmark"></span>
    <span v-if="$slots.default" class="checkbox-label">
      <slot />
    </span>
  </label>
</template>

<style scoped>
.lyt-checkbox {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-2);
  cursor: pointer;
  user-select: none;
}

.lyt-checkbox input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.checkmark {
  width: 1.125rem;
  height: 1.125rem;
  border: 2px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  cursor: pointer;
  transition: all var(--duration-150) var(--ease-out);
  position: relative;
  flex-shrink: 0;
}

.lyt-checkbox input:checked + .checkmark {
  background: linear-gradient(135deg, var(--primary) 0%, var(--primary-light) 100%);
  border-color: var(--primary);
}

.lyt-checkbox input:checked + .checkmark::before {
  content: "✓";
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: white;
  font-size: var(--text-xs);
  font-weight: 600;
}

.checkmark:hover {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-50);
}

.checkbox-label {
  font-size: var(--text-sm);
  color: var(--text-secondary);
}
</style>
