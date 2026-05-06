<script setup>
import { ref } from 'vue'
import LytModal from '../ui/LytModal.vue'
import LytButton from '../ui/LytButton.vue'

const visible = ref(false)
const title = ref('提示')
const message = ref('')
let resolveFn = null

function open(opts) {
  title.value = opts.title || '提示'
  message.value = opts.message || ''
  visible.value = true
  return new Promise((resolve) => { resolveFn = resolve })
}

function close() {
  visible.value = false
  if (resolveFn) resolveFn()
}

defineExpose({ open })
</script>

<template>
  <LytModal v-model="visible" :title="title" size="small" @close="close">
    <p class="message-content">{{ message }}</p>
    <template #footer>
      <LytButton variant="primary" @click="close">确定</LytButton>
    </template>
  </LytModal>
</template>

<style scoped>
.message-content {
  color: var(--text-primary);
  font-size: var(--text-sm);
  line-height: var(--leading-relaxed);
}
</style>
