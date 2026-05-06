import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  GetWorkshopPreferredIP,
  SetWorkshopPreferredIP,
  GetWorkshopFixedIP,
  SetWorkshopFixedIP,
  GetWorkshopMetaEnabled,
  SetWorkshopMetaEnabled,
  GetWorkshopBrowserTarget,
  SetWorkshopBrowserTarget,
} from '../api/wails.js'

export const useSettingsStore = defineStore('settings', () => {
  const preferredIP = ref(false)
  const fixedIP = ref('')
  const metaEnabled = ref(true)
  const browserTarget = ref('mirror')

  async function loadSettings() {
    try {
      preferredIP.value = await GetWorkshopPreferredIP()
      fixedIP.value = await GetWorkshopFixedIP()
      metaEnabled.value = await GetWorkshopMetaEnabled()
      browserTarget.value = await GetWorkshopBrowserTarget()
    } catch (e) {
      console.error('Failed to load settings:', e)
    }
  }

  async function setPreferredIP(value) {
    preferredIP.value = value
    await SetWorkshopPreferredIP(value)
  }

  async function setFixedIP(value) {
    fixedIP.value = value
    await SetWorkshopFixedIP(value)
  }

  async function setMetaEnabled(value) {
    metaEnabled.value = value
    await SetWorkshopMetaEnabled(value)
  }

  async function setBrowserTarget(value) {
    browserTarget.value = value
    await SetWorkshopBrowserTarget(value)
  }

  return {
    preferredIP,
    fixedIP,
    metaEnabled,
    browserTarget,
    loadSettings,
    setPreferredIP,
    setFixedIP,
    setMetaEnabled,
    setBrowserTarget,
  }
})
