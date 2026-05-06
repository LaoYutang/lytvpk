<script setup>
import { ref } from 'vue'

const visible = ref(false)
const imageSrc = ref('')

function open(src) {
  imageSrc.value = src
  visible.value = true
}

function close() {
  visible.value = false
}

defineExpose({ open })
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="visible" class="image-modal" @click.self="close">
        <img :src="imageSrc" class="image-modal-content" @click.stop />
        <button class="image-modal-close" @click="close">&times;</button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.image-modal {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 99999;
  padding: 32px;
}

.image-modal-content {
  max-width: 90vw;
  max-height: 90vh;
  object-fit: contain;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-2xl);
  animation: zoom var(--duration-300) var(--ease-out);
}

.image-modal-close {
  position: absolute;
  top: 16px;
  right: 24px;
  width: 40px;
  height: 40px;
  border: none;
  background: rgba(255, 255, 255, 0.1);
  color: white;
  font-size: 28px;
  border-radius: var(--radius-full);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--duration-150);
}

.image-modal-close:hover {
  background: rgba(255, 255, 255, 0.25);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--duration-300);
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
