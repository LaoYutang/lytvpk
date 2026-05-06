<script setup>
import { ref } from 'vue'
import LytModal from '../ui/LytModal.vue'
import LytButton from '../ui/LytButton.vue'

const visible = ref(false)
const title = ref('确认')
const message = ref('')
const confirmVariant = ref('primary')
const confirmText = ref('确定')
let resolveFn = null

function open(opts) {
  title.value = opts.title || '确认'
  message.value = opts.message || ''
  confirmVariant.value = opts.confirmVariant || 'primary'
  confirmText.value = opts.confirmText || '确定'
  visible.value = true
  return new Promise((resolve) => { resolveFn = resolve })
}

function confirm() {
  visible.value = false
  if (resolveFn) resolveFn(true)
}

function cancel() {
  visible.value = false
  if (resolveFn) resolveFn(false)
}

defineExpose({ open })
</script>

<template>
  <LytModal v-model="visible" :title="title" size="small" @close="cancel">
    <p class="confirm-message">{{ message }}</p>
    <template #footer>
      <LytButton variant="secondary" @click="cancel">取消</LytButton>
      <LytButton :variant="confirmVariant" @click="confirm">{{ confirmText }}</LytButton>
    </template>
  </LytModal>
</template>

<style scoped>
.confirm-message {
  color: var(--text-primary);
  font-size: var(--text-sm);
  line-height: var(--leading-relaxed);
}
</style>
