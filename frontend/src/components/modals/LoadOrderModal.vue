<script setup>
import { ref } from 'vue'
import { GetVPKLoadOrder, SetVPKLoadOrder } from '../../api/wails.js'
import { useAppStore } from '../../stores/app.js'
import LytModal from '../ui/LytModal.vue'
import LytButton from '../ui/LytButton.vue'

const appStore = useAppStore()
const visible = ref(false)
const fileName = ref('')
const currentOrder = ref(0)
const newOrder = ref(1)

async function open(file) {
  fileName.value = file.name
  newOrder.value = 1
  visible.value = true
  try {
    const order = await GetVPKLoadOrder(file.name)
    if (order !== undefined && order !== null) {
      currentOrder.value = order
      newOrder.value = order
    } else {
      currentOrder.value = 0
      newOrder.value = 1
    }
  } catch (e) {
    console.error('Failed to get load order:', e)
    currentOrder.value = 0
    newOrder.value = 1
  }
}

function close() {
  visible.value = false
}

async function save() {
  try {
    const order = parseInt(newOrder.value, 10)
    if (isNaN(order) || order < 1) {
      appStore.addToast('序号必须为正整数', 'error')
      return
    }
    await SetVPKLoadOrder(fileName.value, order)
    appStore.addToast('加载顺序已保存', 'success')
    close()
    emit('saved')
  } catch (e) {
    appStore.addToast('保存加载顺序失败', 'error')
    console.error(e)
  }
}

const emit = defineEmits(['saved'])
defineExpose({ open })
</script>

<template>
  <LytModal v-model="visible" title="编辑加载顺序" size="small">
    <div class="form-body">
      <div class="form-group">
        <label>文件名</label>
        <span class="filename">{{ fileName }}</span>
      </div>
      <div class="form-group">
        <label>当前序号</label>
        <span class="current-order">{{ currentOrder || '未设置' }}</span>
      </div>
      <div class="form-group">
        <label>新序号</label>
        <input v-model.number="newOrder" type="number" min="1" placeholder="输入新序号" @keyup.enter="save" />
        <p class="hint">数值越小越先加载，范围 1~999</p>
      </div>
    </div>
    <template #footer>
      <LytButton variant="secondary" @click="close">取消</LytButton>
      <LytButton variant="primary" @click="save">保存</LytButton>
    </template>
  </LytModal>
</template>

<style scoped>
.form-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-group label {
  display: block;
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.filename {
  font-size: var(--text-sm);
  color: var(--text-primary);
  word-break: break-all;
  background: var(--bg-surface);
  padding: 8px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-light);
}

.current-order {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--primary);
}

.form-group input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: var(--text-sm);
  outline: none;
  transition: border-color var(--duration-150);
}

.form-group input:focus {
  border-color: var(--primary);
}

.hint {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  margin-top: 4px;
  margin-bottom: 0;
}
</style>
