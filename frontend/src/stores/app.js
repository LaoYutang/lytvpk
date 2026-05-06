import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { WindowSetDarkTheme, WindowSetLightTheme } from '../api/wails.js'

const CONFIG_KEY = 'vpk-manager-config'

export const useAppStore = defineStore('app', () => {
  // State
  const currentDirectory = ref('')
  const isLoading = ref(false)
  const theme = ref('light')
  const toasts = ref([])

  // Getters
  const isDark = computed(() => theme.value === 'dark')

  // Config helpers
  function getConfig() {
    const config = localStorage.getItem(CONFIG_KEY)
    return config ? JSON.parse(config) : { defaultDirectory: '' }
  }

  function saveConfig(config) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
  }

  // Directory persistence
  function loadSavedDirectory() {
    return getConfig().defaultDirectory || ''
  }

  function saveDirectory(dir) {
    const config = getConfig()
    config.defaultDirectory = dir
    saveConfig(config)
  }

  // Actions
  function initTheme() {
    const saved = localStorage.getItem('theme')
    if (saved) {
      setTheme(saved)
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      setTheme('dark')
    }
  }

  function setTheme(newTheme) {
    theme.value = newTheme
    const html = document.documentElement
    if (newTheme === 'dark') {
      html.classList.add('dark-mode')
      WindowSetDarkTheme()
    } else {
      html.classList.remove('dark-mode')
      WindowSetLightTheme()
    }
    localStorage.setItem('theme', newTheme)
  }

  function toggleTheme() {
    setTheme(theme.value === 'dark' ? 'light' : 'dark')
  }

  function addToast(message, type = 'info', duration = 3000) {
    const id = Date.now() + Math.random()
    toasts.value.push({ id, message, type, duration })
    if (duration > 0) {
      setTimeout(() => removeToast(id), duration)
    }
    return id
  }

  function removeToast(id) {
    const idx = toasts.value.findIndex(t => t.id === id)
    if (idx !== -1) toasts.value.splice(idx, 1)
  }

  return {
    currentDirectory,
    isLoading,
    theme,
    toasts,
    isDark,
    initTheme,
    setTheme,
    toggleTheme,
    addToast,
    removeToast,
    loadSavedDirectory,
    saveDirectory,
  }
})
