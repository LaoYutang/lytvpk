<script setup>
import { ref, watch } from 'vue'
import { SetVPKTags } from '../../api/wails.js'
import { useAppStore } from '../../stores/app.js'
import LytModal from '../ui/LytModal.vue'
import LytButton from '../ui/LytButton.vue'

const appStore = useAppStore()
const visible = ref(false)
const filePath = ref('')
const fileName = ref('')
const primaryTag = ref('')
const secondaryTags = ref([])
const newTagInput = ref('')

const primaryOptions = ['', '地图', '人物', '武器', '其他']

const PRIMARY_TAG_MAP = {
  '': '',
  '地图': '地图',
  '人物': '人物',
  '武器': '武器',
  '其他': '其他',
}

function open(file) {
  filePath.value = file.path || file.name
  fileName.value = file.name
  primaryTag.value = file.primaryTag || ''
  secondaryTags.value = [...(file.secondaryTags || [])]
  newTagInput.value = ''
  visible.value = true
}

function close() {
  visible.value = false
}

function addTag() {
  const tag = newTagInput.value.trim()
  if (tag && !secondaryTags.value.includes(tag)) {
    secondaryTags.value.push(tag)
  }
  newTagInput.value = ''
}

function removeTag(tag) {
  const idx = secondaryTags.value.indexOf(tag)
  if (idx !== -1) secondaryTags.value.splice(idx, 1)
}

function reset() {
  primaryTag.value = ''
  secondaryTags.value = []
}

async function save() {
  try {
    await SetVPKTags(fileName.value, primaryTag.value, secondaryTags.value)
    appStore.addToast('标签已保存', 'success')
    close()
    emit('saved')
  } catch (e) {
    appStore.addToast('保存标签失败', 'error')
    console.error(e)
  }
}

const emit = defineEmits(['saved'])
defineExpose({ open })
</script>

<template>
  <LytModal v-model="visible" title="设置标签" size="small">
    <div class="form-body">
      <div class="form-group">
        <label>一级标签</label>
        <select v-model="primaryTag" class="tag-select">
          <option v-for="opt in primaryOptions" :key="opt" :value="opt">
            {{ opt || '无' }}
          </option>
        </select>
      </div>

      <div class="form-group">
        <label>二级标签</label>
        <div class="tag-list">
          <span v-for="tag in secondaryTags" :key="tag" class="tag-item">
            {{ tag }}
            <button class="tag-remove" @click="removeTag(tag)">&times;</button>
          </span>
          <span v-if="secondaryTags.length === 0" class="tag-empty">暂无二级标签</span>
        </div>
        <div class="tag-input-row">
          <input v-model="newTagInput" placeholder="输入标签名称" @keyup.enter="addTag" />
          <LytButton variant="outline" size="small" @click="addTag">添加</LytButton>
        </div>
      </div>
    </div>
    <template #footer>
      <LytButton variant="ghost" @click="reset">重置</LytButton>
      <LytButton variant="secondary" @click="close">取消</LytButton>
      <LytButton variant="primary" @click="save">保存</LytButton>
    </template>
  </LytModal>
</template>

<style scoped>
.form-body {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.form-group label {
  display: block;
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.tag-select {
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

.tag-select:focus {
  border-color: var(--primary);
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
  min-height: 28px;
}

.tag-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: var(--primary-50);
  color: var(--primary);
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  font-weight: 500;
}

.tag-remove {
  width: 16px;
  height: 16px;
  border: none;
  background: transparent;
  color: var(--primary);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-full);
  transition: background var(--duration-150);
}

.tag-remove:hover {
  background: rgba(0, 0, 0, 0.1);
}

.tag-empty {
  font-size: var(--text-xs);
  color: var(--text-muted);
  padding: 4px 0;
}

.tag-input-row {
  display: flex;
  gap: 8px;
}

.tag-input-row input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: var(--text-sm);
  outline: none;
  transition: border-color var(--duration-150);
}

.tag-input-row input:focus {
  border-color: var(--primary);
}
</style>
