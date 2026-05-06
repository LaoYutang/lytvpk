<script setup>
import { ref, onMounted } from 'vue'
import { useServerStore } from '../stores/server.js'
import { ConnectToServer } from '../api/wails.js'
import LytButton from '../components/ui/LytButton.vue'
import LytModal from '../components/ui/LytModal.vue'
import LytInput from '../components/ui/LytInput.vue'

const serverStore = useServerStore()
const showForm = ref(false)
const editingId = ref(null)
const form = ref({ name: '', address: '', weight: 0 })
const showDetails = ref(false)
const detailLoading = ref(false)

onMounted(() => {
  serverStore.loadServers()
})

function openAdd() {
  editingId.value = null
  form.value = { name: '', address: '', weight: 0 }
  showForm.value = true
}

function openEdit(server) {
  editingId.value = server.id
  form.value = { name: server.name, address: server.address, weight: server.weight || 0 }
  showForm.value = true
}

function saveForm() {
  if (!form.value.name || !form.value.address) return
  if (editingId.value) {
    serverStore.updateServer(editingId.value, form.value)
  } else {
    serverStore.addServer(form.value)
  }
  showForm.value = false
}

function remove(id) {
  if (confirm('确定要删除这个服务器吗？')) {
    serverStore.removeServer(id)
  }
}

async function showServerDetails(server) {
  serverStore.currentServer = server
  showDetails.value = true
  detailLoading.value = true
  try {
    serverStore.serverDetails = await serverStore.queryServerInfo(server.address)
    serverStore.playerList = await serverStore.queryPlayerList(server.address)
  } catch (e) {
    console.error(e)
  } finally {
    detailLoading.value = false
  }
}

async function connect(address) {
  try {
    await ConnectToServer(address)
  } catch (e) {
    console.error(e)
  }
}
</script>

<template>
  <div class="servers-view">
    <div class="page-header">
      <h2 class="page-title">收藏服务器</h2>
      <LytButton variant="success" @click="openAdd">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
        添加服务器
      </LytButton>
    </div>

    <div class="server-list">
      <div v-if="serverStore.servers.length === 0" class="empty-state">
        暂无收藏的服务器，点击上方按钮添加
      </div>
      <div
        v-for="server in serverStore.servers"
        :key="server.id"
        class="server-item"
      >
        <div class="server-info">
          <div class="server-name">{{ server.name }}</div>
          <div class="server-address">{{ server.address }}</div>
        </div>
        <div class="server-actions">
          <LytButton variant="ghost" size="small" icon-only @click="showServerDetails(server)">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
          </LytButton>
          <LytButton variant="ghost" size="small" icon-only @click="openEdit(server)">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </LytButton>
          <LytButton variant="ghost" size="small" icon-only @click="connect(server.address)">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
          </LytButton>
          <LytButton variant="ghost" size="small" icon-only @click="remove(server.id)">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </LytButton>
        </div>
      </div>
    </div>

    <!-- Add/Edit Modal -->
    <LytModal v-model="showForm" :title="editingId ? '编辑服务器' : '添加服务器'" size="small">
      <div class="form-body">
        <div class="form-group">
          <label>服务器名称</label>
          <LytInput v-model="form.name" placeholder="例如：My L4D2 Server" />
        </div>
        <div class="form-group">
          <label>服务器地址 (IP:Port)</label>
          <LytInput v-model="form.address" placeholder="例如：127.0.0.1:27015" />
        </div>
        <div class="form-group">
          <label>排序权重</label>
          <LytInput v-model="form.weight" type="number" placeholder="数值越大排序越靠前" />
        </div>
      </div>
      <template #footer>
        <LytButton variant="secondary" @click="showForm = false">取消</LytButton>
        <LytButton variant="primary" @click="saveForm">保存</LytButton>
      </template>
    </LytModal>

    <!-- Details Modal -->
    <LytModal v-model="showDetails" title="服务器详情" size="medium">
      <div v-if="detailLoading" class="detail-loading">加载中...</div>
      <div v-else-if="serverStore.serverDetails" class="detail-body">
        <div class="detail-row">
          <span class="detail-label">地图</span>
          <span class="detail-value">{{ serverStore.serverDetails.map || '-' }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">玩家</span>
          <span class="detail-value">{{ serverStore.serverDetails.players || 0 }} / {{ serverStore.serverDetails.maxPlayers || 0 }}</span>
        </div>
        <div v-if="serverStore.playerList.length > 0" class="player-section">
          <h4>玩家列表</h4>
          <table class="player-table">
            <thead>
              <tr><th>名称</th><th>分数</th><th>时长</th></tr>
            </thead>
            <tbody>
              <tr v-for="p in serverStore.playerList" :key="p.name">
                <td>{{ p.name }}</td>
                <td>{{ p.score }}</td>
                <td>{{ p.duration }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div v-else class="detail-empty">无法获取服务器信息</div>
    </LytModal>
  </div>
</template>

<style scoped>
.servers-view {
  padding: 24px 32px;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.page-title {
  font-size: var(--text-2xl);
  font-weight: 700;
  color: var(--text-primary);
}

.server-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.empty-state {
  text-align: center;
  padding: 48px;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.server-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  transition: all var(--duration-150);
}

.server-item:hover {
  border-color: var(--primary-light);
  box-shadow: var(--shadow-sm);
}

.server-name {
  font-weight: 600;
  color: var(--text-primary);
  font-size: var(--text-sm);
}

.server-address {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  margin-top: 2px;
}

.server-actions {
  display: flex;
  gap: 4px;
}

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

.detail-loading,
.detail-empty {
  text-align: center;
  padding: 32px;
  color: var(--text-muted);
}

.detail-row {
  display: flex;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-default);
}

.detail-label {
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}

.detail-value {
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-weight: 500;
}

.player-section {
  margin-top: 16px;
}

.player-section h4 {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 10px;
}

.player-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-xs);
}

.player-table th,
.player-table td {
  padding: 8px 10px;
  text-align: left;
  border-bottom: 1px solid var(--border-default);
}

.player-table th {
  color: var(--text-tertiary);
  font-weight: 500;
}

.player-table td {
  color: var(--text-secondary);
}
</style>
