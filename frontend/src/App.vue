<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from './stores/app.js'
import { useServerStore } from './stores/server.js'
import { useRotationStore } from './stores/rotation.js'
import {
  EventsOn,
  OnFileDrop,
  HandleFileDrop,
  ForceExit,
  HasActiveDownloads,
  GetRootDirectory,
  SetRootDirectory,
  ScanVPKFiles,
  BrowserOpenURL,
} from './api/wails.js'
import { confirm } from './composables/useDialog.js'
import { registerConfirmModal, registerMessageModal } from './composables/useDialog.js'
import TitleBar from './components/layout/TitleBar.vue'
import SideMenu from './components/layout/SideMenu.vue'
import LytToast from './components/ui/LytToast.vue'
import ConfirmModal from './components/modals/ConfirmModal.vue'
import MessageModal from './components/modals/MessageModal.vue'

const appStore = useAppStore()
const serverStore = useServerStore()
const rotationStore = useRotationStore()
const router = useRouter()
const confirmRef = ref(null)
const messageRef = ref(null)

onMounted(() => {
  appStore.initTheme()
  serverStore.loadServers()
  rotationStore.init()

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

  // Protocol handlers
  EventsOn('protocol:parse', (data) => {
    if (data && data.workshopId) {
      appStore.pendingProtocolParseId = data.workshopId
      router.push('/downloads')
    }
  })
  EventsOn('protocol:workshop', (data) => {
    if (data && data.workshopId) {
      appStore.pendingProtocolWorkshopId = data.workshopId
      router.push('/workshop')
    }
  })
  EventsOn('protocol:error', (data) => {
    if (data && data.message) {
      appStore.addToast(`协议处理失败: ${data.message}`, 'error')
    }
  })

  // Drag and drop file installation
  OnFileDrop((x, y, paths) => {
    if (paths && paths.length > 0) {
      appStore.addToast('正在处理拖入的文件...', 'info')
      HandleFileDrop(paths).then(() => {
        appStore.addToast('文件处理完成', 'success')
        // Trigger file refresh - HomeView will pick this up
      }).catch((e) => {
        appStore.addToast(`文件处理失败: ${e}`, 'error')
      })
    }
  })

  // Exit confirmation
  EventsOn('show_exit_confirmation', async () => {
    const hasActive = await HasActiveDownloads()
    if (hasActive) {
      const ok = await confirm({
        title: '确认退出',
        message: '当前有下载任务正在进行，确定要退出吗？',
        confirmVariant: 'danger',
        confirmText: '强制退出',
      })
      if (ok) {
        ForceExit()
      }
    } else {
      ForceExit()
    }
  })

  // IP optimization events
  EventsOn('ip_selection_start', () => {
    appStore.addToast('正在优选下载节点...', 'info', 3000)
  })
  EventsOn('ip_selection_end', () => {
    appStore.addToast('下载节点优选完成', 'success', 3000)
  })

  // Export progress
  EventsOn('export-progress', (data) => {
    if (data && data.percent !== undefined) {
      appStore.addToast(`导出进度: ${data.percent}%`, 'info', 1500)
    }
  })

  // Rotation log
  EventsOn('rotation_log', (msg) => {
    console.log(`[ModRotation] ${msg}`)
  })

  // Prevent browser default drag behaviors
  window.addEventListener('dragover', (e) => e.preventDefault())
  window.addEventListener('drop', (e) => e.preventDefault())
  window.addEventListener('dragstart', (e) => {
    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault()
    }
  })
})
</script>

<template>
  <div class="app-layout">
    <TitleBar />
    <div class="main-area">
      <SideMenu />
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
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.main-area {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.main-content {
  flex: 1;
  overflow: auto;
  min-width: 0;
  padding: var(--spacing-6);
}
</style>
