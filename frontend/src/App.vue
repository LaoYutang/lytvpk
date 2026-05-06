<script setup>
import { onMounted, ref } from 'vue'
import { useAppStore } from './stores/app.js'
import { useServerStore } from './stores/server.js'
import { EventsOn } from './api/wails.js'
import { registerConfirmModal, registerMessageModal } from './composables/useDialog.js'
import TitleBar from './components/layout/TitleBar.vue'
import SideMenu from './components/layout/SideMenu.vue'
import LytToast from './components/ui/LytToast.vue'
import ConfirmModal from './components/modals/ConfirmModal.vue'
import MessageModal from './components/modals/MessageModal.vue'

const appStore = useAppStore()
const serverStore = useServerStore()
const confirmRef = ref(null)
const messageRef = ref(null)

onMounted(() => {
  appStore.initTheme()
  serverStore.loadServers()

  if (confirmRef.value) registerConfirmModal(confirmRef.value)
  if (messageRef.value) registerMessageModal(messageRef.value)

  // Wails events
  EventsOn('error', (msg) => {
    appStore.addToast(msg, 'error')
  })
  EventsOn('show_toast', (msg, type) => {
    appStore.addToast(msg, type || 'info')
  })
  EventsOn('refresh_files', () => {
    // Handled by HomeView via store
  })
})
</script>

<template>
  <div class="app-layout">
    <SideMenu />
    <div class="right-area">
      <TitleBar />
      <main class="main-content">
        <RouterView />
      </main>
    </div>
  </div>
  <LytToast />
  <ConfirmModal ref="confirmRef" />
  <MessageModal ref="messageRef" />
</template>

<style scoped>
.app-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.right-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.main-content {
  flex: 1;
  overflow: auto;
  min-width: 0;
}
</style>
