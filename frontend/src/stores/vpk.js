import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  ScanVPKFiles,
  GetVPKFiles,
  SearchVPKFiles,
  GetPrimaryTags,
  GetSecondaryTags,
  ToggleVPKFile,
  ToggleVPKVisibility,
  DeleteVPKFile,
  DeleteVPKFiles,
  RenameVPKFile,
  MoveVpkFiles,
  ExportVPKFilesToZip,
  SetVPKTags,
  GetVPKLoadOrder,
  SetVPKLoadOrder,
  GetAddonListOrder,
} from '../api/wails.js'

export const useVpkStore = defineStore('vpk', () => {
  // State
  const allFiles = ref([])
  const filteredFiles = ref([])
  const selectedFiles = ref(new Set())
  const primaryTags = ref([])
  const selectedPrimaryTag = ref('')
  const selectedSecondaryTags = ref([])
  const selectedLocations = ref([])
  const searchQuery = ref('')
  const showHidden = ref(false)
  const sortType = ref('name')
  const sortOrder = ref('asc')
  const displayMode = ref('list')
  const locations = ref([])

  // Getters
  const totalCount = computed(() => filteredFiles.value.length)
  const enabledCount = computed(() => filteredFiles.value.filter(f => !f.disabled).length)
  const disabledCount = computed(() => filteredFiles.value.filter(f => f.disabled).length)
  const selectedCount = computed(() => selectedFiles.value.size)

  // Actions
  async function loadFiles() {
    try {
      const files = await GetVPKFiles()
      allFiles.value = files || []
      applyFilters()
      extractLocations()
      await loadTags()
    } catch (e) {
      console.error('Failed to load VPK files:', e)
    }
  }

  async function scanFiles() {
    try {
      await ScanVPKFiles()
      await loadFiles()
    } catch (e) {
      console.error('Failed to scan VPK files:', e)
    }
  }

  async function loadTags() {
    try {
      const tags = await GetPrimaryTags()
      primaryTags.value = tags || []
    } catch (e) {
      console.error('Failed to load primary tags:', e)
      primaryTags.value = []
    }
  }

  function extractLocations() {
    const locs = new Set()
    allFiles.value.forEach(f => {
      if (f.location) locs.add(f.location)
    })
    locations.value = Array.from(locs)
  }

  function applyFilters() {
    let result = [...allFiles.value]

    if (!showHidden.value) {
      result = result.filter(f => !f.hidden)
    }

    if (searchQuery.value) {
      const q = searchQuery.value.toLowerCase()
      result = result.filter(f =>
        (f.name && f.name.toLowerCase().includes(q)) ||
        (f.title && f.title.toLowerCase().includes(q)) ||
        (f.tags && f.tags.some(t => t.toLowerCase().includes(q)))
      )
    }

    if (selectedPrimaryTag.value) {
      result = result.filter(f => f.primaryTag === selectedPrimaryTag.value)
    }

    if (selectedSecondaryTags.value.length > 0) {
      result = result.filter(f =>
        f.secondaryTags && selectedSecondaryTags.value.some(t => f.secondaryTags.includes(t))
      )
    }

    if (selectedLocations.value.length > 0) {
      result = result.filter(f => selectedLocations.value.includes(f.location))
    }

    // Sort
    result.sort((a, b) => {
      let cmp = 0
      if (sortType.value === 'name') {
        cmp = (a.name || '').localeCompare(b.name || '')
      } else if (sortType.value === 'date') {
        cmp = (b.modified || 0) - (a.modified || 0)
      } else if (sortType.value === 'loadOrder') {
        cmp = (a.loadOrder || 9999) - (b.loadOrder || 9999)
      } else if (sortType.value === 'size') {
        cmp = (b.size || 0) - (a.size || 0)
      }
      return sortOrder.value === 'desc' ? -cmp : cmp
    })

    filteredFiles.value = result
  }

  function toggleFileSelection(name) {
    if (selectedFiles.value.has(name)) {
      selectedFiles.value.delete(name)
    } else {
      selectedFiles.value.add(name)
    }
  }

  function selectAll() {
    filteredFiles.value.forEach(f => selectedFiles.value.add(f.name))
  }

  function deselectAll() {
    selectedFiles.value.clear()
  }

  async function toggleFile(name) {
    try {
      await ToggleVPKFile(name)
      await loadFiles()
    } catch (e) {
      console.error('Failed to toggle VPK:', e)
    }
  }

  async function toggleVisibility(name) {
    try {
      await ToggleVPKVisibility(name)
      await loadFiles()
    } catch (e) {
      console.error('Failed to toggle visibility:', e)
    }
  }

  async function deleteFile(name) {
    try {
      await DeleteVPKFile(name)
      selectedFiles.value.delete(name)
      await loadFiles()
    } catch (e) {
      console.error('Failed to delete VPK:', e)
    }
  }

  async function deleteSelected() {
    try {
      const names = Array.from(selectedFiles.value)
      await DeleteVPKFiles(names)
      selectedFiles.value.clear()
      await loadFiles()
    } catch (e) {
      console.error('Failed to delete selected:', e)
    }
  }

  async function renameFile(oldName, newName) {
    try {
      await RenameVPKFile(oldName, newName)
      await loadFiles()
    } catch (e) {
      console.error('Failed to rename:', e)
    }
  }

  async function exportSelected() {
    try {
      const names = Array.from(selectedFiles.value)
      await ExportVPKFilesToZip(names)
    } catch (e) {
      console.error('Failed to export:', e)
    }
  }

  return {
    allFiles,
    filteredFiles,
    selectedFiles,
    primaryTags,
    selectedPrimaryTag,
    selectedSecondaryTags,
    selectedLocations,
    searchQuery,
    showHidden,
    sortType,
    sortOrder,
    displayMode,
    locations,
    totalCount,
    enabledCount,
    disabledCount,
    selectedCount,
    loadFiles,
    scanFiles,
    loadTags,
    applyFilters,
    toggleFileSelection,
    selectAll,
    deselectAll,
    toggleFile,
    toggleVisibility,
    deleteFile,
    deleteSelected,
    renameFile,
    exportSelected,
  }
})
