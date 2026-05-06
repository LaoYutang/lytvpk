<script setup>
const props = defineProps({
  active: { type: Boolean, default: false },
  removable: { type: Boolean, default: false },
})

const emit = defineEmits(['click', 'remove'])
</script>

<template>
  <span
    class="lyt-tag"
    :class="{ active }"
    @click="emit('click', $event)"
  >
    <slot />
    <button
      v-if="removable"
      class="tag-remove"
      @click.stop="emit('remove', $event)"
    >&times;</button>
  </span>
</template>

<style scoped>
.lyt-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: var(--spacing-1) var(--spacing-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: 500;
  cursor: pointer;
  transition: all var(--duration-150) var(--ease-out);
  white-space: nowrap;
  user-select: none;
}

.lyt-tag:hover {
  border-color: var(--primary);
  background: var(--primary-50);
  color: var(--primary);
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}

.lyt-tag.active {
  background: linear-gradient(135deg, var(--primary) 0%, var(--primary-light) 100%);
  border-color: var(--primary);
  color: white;
  box-shadow: var(--shadow-sm);
}

.tag-remove {
  background: none;
  border: none;
  color: inherit;
  font-size: 14px;
  cursor: pointer;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-full);
  padding: 0;
  margin-left: 2px;
  opacity: 0.7;
  transition: opacity 0.15s;
}

.tag-remove:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.2);
}

.lyt-tag.active .tag-remove:hover {
  background: rgba(0, 0, 0, 0.2);
}
</style>
