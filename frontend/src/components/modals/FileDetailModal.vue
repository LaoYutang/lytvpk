<script setup>
import LytModal from '../ui/LytModal.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  file: { type: Object, default: null },
})

const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <LytModal
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    title="文件详情"
    size="medium"
  >
    <div v-if="file" class="detail-body">
      <div class="detail-preview">
        <img v-if="file.previewUrl" :src="file.previewUrl" :alt="file.name" />
        <div v-else class="preview-placeholder">暂无预览</div>
      </div>
      <div class="detail-section">
        <h4>VPK 信息</h4>
        <div class="detail-row">
          <span class="label">标题</span>
          <span class="value">{{ file.title || '-' }}</span>
        </div>
        <div class="detail-row">
          <span class="label">作者</span>
          <span class="value">{{ file.author || '-' }}</span>
        </div>
        <div class="detail-row">
          <span class="label">版本</span>
          <span class="value">{{ file.version || '-' }}</span>
        </div>
        <div class="detail-row">
          <span class="label">描述</span>
          <span class="value">{{ file.description || '-' }}</span>
        </div>
      </div>
      <div class="detail-section">
        <h4>基本信息</h4>
        <div class="detail-row">
          <span class="label">文件名</span>
          <span class="value">{{ file.name }}</span>
        </div>
        <div class="detail-row">
          <span class="label">大小</span>
          <span class="value">{{ file.sizeText || file.size }}</span>
        </div>
        <div class="detail-row">
          <span class="label">位置</span>
          <span class="value">{{ file.location || '-' }}</span>
        </div>
        <div class="detail-row">
          <span class="label">状态</span>
          <span class="value">{{ file.disabled ? '已禁用' : '已启用' }}</span>
        </div>
      </div>
    </div>
  </LytModal>
</template>

<style scoped>
.detail-body {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.detail-preview {
  height: 200px;
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: var(--bg-surface);
  display: flex;
  align-items: center;
  justify-content: center;
}

.detail-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.preview-placeholder {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.detail-section {
  background: var(--bg-surface);
  border-radius: var(--radius-lg);
  padding: 16px;
  border: 1px solid var(--border-light);
}

.detail-section h4 {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 12px 0;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-default);
}

.detail-row {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  gap: 16px;
}

.detail-row .label {
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  flex-shrink: 0;
}

.detail-row .value {
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-weight: 500;
  text-align: right;
  word-break: break-all;
}
</style>
