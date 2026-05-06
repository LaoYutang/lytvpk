<script setup>
const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: '' },
  type: { type: String, default: 'text' },
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue', 'focus', 'blur', 'keyup'])
</script>

<template>
  <div class="input-wrapper">
    <div v-if="$slots.prefix" class="input-prefix">
      <slot name="prefix" />
    </div>
    <input
      :type="type"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      class="lyt-input"
      @input="emit('update:modelValue', $event.target.value)"
      @focus="emit('focus', $event)"
      @blur="emit('blur', $event)"
      @keyup="emit('keyup', $event)"
    />
    <div v-if="$slots.suffix" class="input-suffix">
      <slot name="suffix" />
    </div>
  </div>
</template>

<style scoped>
.input-wrapper {
  display: flex;
  align-items: center;
  position: relative;
  width: 100%;
}

.lyt-input {
  flex: 1;
  padding: var(--spacing-2) var(--spacing-3);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-family: inherit;
  transition: all var(--duration-200) var(--ease-out);
  height: 2.5rem;
  width: 100%;
  outline: none;
}

.lyt-input::placeholder {
  color: var(--text-muted);
}

.lyt-input:focus {
  border-color: var(--primary);
  background: var(--bg-hover);
  box-shadow: 0 0 0 3px var(--primary-100);
}

.lyt-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.input-prefix,
.input-suffix {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.input-prefix {
  margin-right: var(--spacing-2);
}

.input-suffix {
  margin-left: var(--spacing-2);
}
</style>
