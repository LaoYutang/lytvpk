import { defineStore } from 'pinia'
import { ref } from 'vue'
import { GetModRotation, SetModRotation, ManualRotateMods } from '../api/wails.js'

const STORAGE_KEY = 'vpk-manager-rotation'

export const useRotationStore = defineStore('rotation', () => {
  const config = ref({
    enableCharacters: false,
    enableWeapons: false,
  })

  function loadConfig() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        config.value = {
          enableCharacters: parsed.enableCharacters ?? false,
          enableWeapons: parsed.enableWeapons ?? false,
        }
      }
    } catch (e) {
      console.error('Failed to load rotation config:', e)
    }
  }

  function saveToStorage() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config.value))
  }

  async function init() {
    loadConfig()
    try {
      await SetModRotation(config.value)
    } catch (e) {
      console.error('Failed to init rotation:', e)
    }
  }

  async function updateConfig(newConfig) {
    config.value = { ...newConfig }
    saveToStorage()
    try {
      await SetModRotation(config.value)
    } catch (e) {
      console.error('Failed to update rotation:', e)
    }
  }

  async function manualRotate() {
    try {
      await ManualRotateMods(config.value)
    } catch (e) {
      console.error('Failed to manual rotate:', e)
      throw e
    }
  }

  const isEnabled = () => config.value.enableCharacters || config.value.enableWeapons

  return {
    config,
    loadConfig,
    init,
    updateConfig,
    manualRotate,
    isEnabled,
  }
})
