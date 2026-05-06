import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  FetchServerInfo,
  FetchPlayerList,
  ConnectToServer,
  ExportServersToFile,
} from '../api/wails.js'

const STORAGE_KEY = 'vpk-manager-servers'

export const useServerStore = defineStore('server', () => {
  const servers = ref([])
  const currentServer = ref(null)
  const serverDetails = ref(null)
  const playerList = ref([])

  function loadServers() {
    try {
      const data = localStorage.getItem(STORAGE_KEY)
      if (data) {
        servers.value = JSON.parse(data)
      }
    } catch (e) {
      console.error('Failed to load servers:', e)
      servers.value = []
    }
  }

  function saveServers() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(servers.value))
  }

  function addServer(server) {
    servers.value.push({ ...server, id: Date.now() })
    saveServers()
  }

  function updateServer(id, data) {
    const idx = servers.value.findIndex(s => s.id === id)
    if (idx !== -1) {
      servers.value[idx] = { ...servers.value[idx], ...data }
      saveServers()
    }
  }

  function removeServer(id) {
    servers.value = servers.value.filter(s => s.id !== id)
    saveServers()
  }

  async function queryServerInfo(address) {
    try {
      return await FetchServerInfo(address)
    } catch (e) {
      console.error('Failed to fetch server info:', e)
      return null
    }
  }

  async function queryPlayerList(address) {
    try {
      return await FetchPlayerList(address)
    } catch (e) {
      console.error('Failed to fetch player list:', e)
      return []
    }
  }

  async function connect(address) {
    try {
      await ConnectToServer(address)
    } catch (e) {
      console.error('Failed to connect:', e)
    }
  }

  async function exportToFile(path) {
    try {
      await ExportServersToFile(path)
    } catch (e) {
      console.error('Failed to export servers:', e)
    }
  }

  return {
    servers,
    currentServer,
    serverDetails,
    playerList,
    loadServers,
    saveServers,
    addServer,
    updateServer,
    removeServer,
    queryServerInfo,
    queryPlayerList,
    connect,
    exportToFile,
  }
})
