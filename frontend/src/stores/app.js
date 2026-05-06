import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { WindowSetDarkTheme, WindowSetLightTheme } from '../api/wails.js'

export const useAppStore = defineStore('app', () => {
  // State
  const currentDirectory = ref('')
  const isLoading = ref(false)
  const theme = ref('light')
  const toasts = ref([])

  // Getters
  const isDark = computed(() => theme.value === 'dark')

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
  }
})
