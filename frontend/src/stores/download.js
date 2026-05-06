import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  GetDownloadTasks,
  StartDownloadTask,
  CancelDownloadTask,
  RetryDownloadTask,
  ClearCompletedTasks,
  GetWorkshopDetails,
  ParseWorkshopID,
} from '../api/wails.js'

export const useDownloadStore = defineStore('download', () => {
  const tasks = ref([])
  const currentWorkshopDetails = ref(null)

  async function loadTasks() {
    try {
      tasks.value = await GetDownloadTasks() || []
    } catch (e) {
      console.error('Failed to load download tasks:', e)
    }
  }

  async function startDownload(id, fileName) {
    try {
      await StartDownloadTask(id, fileName)
      await loadTasks()
    } catch (e) {
      console.error('Failed to start download:', e)
    }
  }

  async function cancelTask(taskId) {
    try {
      await CancelDownloadTask(taskId)
      await loadTasks()
    } catch (e) {
      console.error('Failed to cancel task:', e)
    }
  }

  async function retryTask(taskId) {
    try {
      await RetryDownloadTask(taskId)
      await loadTasks()
    } catch (e) {
      console.error('Failed to retry task:', e)
    }
  }

  async function clearCompleted() {
    try {
      await ClearCompletedTasks()
      await loadTasks()
    } catch (e) {
      console.error('Failed to clear completed:', e)
    }
  }

  async function parseWorkshopUrl(url) {
    try {
      return await ParseWorkshopID(url)
    } catch (e) {
      console.error('Failed to parse workshop URL:', e)
      return null
    }
  }

  async function fetchWorkshopDetails(id) {
    try {
      currentWorkshopDetails.value = await GetWorkshopDetails(id)
      return currentWorkshopDetails.value
    } catch (e) {
      console.error('Failed to fetch workshop details:', e)
      return null
    }
  }

  return {
    tasks,
    currentWorkshopDetails,
    loadTasks,
    startDownload,
    cancelTask,
    retryTask,
    clearCompleted,
    parseWorkshopUrl,
    fetchWorkshopDetails,
  }
})
