import './style.css?v=2.6';
import './app.css?v=2.6';

import {
  SetRootDirectory,
  GetRootDirectory,
  ScanVPKFiles,
  GetVPKFiles,
  ToggleVPKFile,
  MoveWorkshopToAddons,
  SearchVPKFiles,
  GetPrimaryTags,
  GetSecondaryTags,
  SelectDirectory,
  ValidateDirectory,
  LaunchL4D2,
  OpenFileLocation,
  GetWorkshopDetails,
  StartDownloadTask,
  GetDownloadTasks,
  ClearCompletedTasks,
  CancelDownloadTask,
  RetryDownloadTask,
  ForceExit,
  DeleteVPKFile,
  DeleteVPKFiles,
  HandleFileDrop,
  ConnectToServer,
} from '../wailsjs/go/main/App';

import { EventsOn, OnFileDrop } from '../wailsjs/runtime/runtime';

// LocalStorage 配置管理
const CONFIG_KEY = 'vpk-manager-config';

function getConfig() {
  const config = localStorage.getItem(CONFIG_KEY);
  return config ? JSON.parse(config) : { defaultDirectory: '' };
}

function saveConfig(config) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

function getDefaultDirectory() {
  return getConfig().defaultDirectory || '';
}

function setDefaultDirectory(directory) {
  const config = getConfig();
  config.defaultDirectory = directory;
  saveConfig(config);
}

// 应用状态
let appState = {
  allVpkFiles: [], // 完整的文件列表（原始数据）
  vpkFiles: [], // 当前显示的文件列表（搜索/筛选后）
  primaryTags: [], // 一级标签: ["地图", "人物", "武器", "其他"]
  selectedPrimaryTag: '', // 选中的一级标签
  selectedSecondaryTags: [], // 选中的二级标签
  selectedLocations: [], // 选中的位置标签
  searchQuery: '',
  selectedFiles: new Set(),
  currentDirectory: '',
  isLoading: false, // 是否正在加载中
};

// 初始化应用
document.addEventListener('DOMContentLoaded', function () {
  initializeApp();
});

function initializeApp() {
  setupEventListeners();
  setupWailsEvents();
  checkInitialDirectory();
}

// 设置事件监听器
function setupEventListeners() {
  // 目录选择
  document.getElementById('select-directory-btn').addEventListener('click', selectDirectory);

  // 刷新按钮
  document.getElementById('refresh-btn').addEventListener('click', refreshFilesKeepFilter);

  // 搜索框
  document.getElementById('search-input').addEventListener('input', handleSearch);

  // 批量操作按钮
  document.getElementById('select-all-btn').addEventListener('click', selectAll);
  document.getElementById('deselect-all-btn').addEventListener('click', deselectAll);
  document.getElementById('enable-selected-btn').addEventListener('click', enableSelected);
  document.getElementById('disable-selected-btn').addEventListener('click', disableSelected);
  document.getElementById('delete-selected-btn').addEventListener('click', deleteSelected);

  // 重置筛选按钮
  document.getElementById('reset-filter-btn').addEventListener('click', resetFilters);

  // 服务器收藏按钮
  document.getElementById('server-favorites-btn').addEventListener('click', openServerModal);
  
  setupServerModalListeners();

  // 启动L4D2按钮
  document.getElementById('launch-l4d2-btn').addEventListener('click', launchL4D2);

  // 关于信息按钮
  document.getElementById('info-btn').addEventListener('click', showInfoModal);

  // 阻止浏览器默认的拖拽行为（防止打开文件或下载）
  window.addEventListener('dragover', function(e) {
    e.preventDefault();
  });
  
  window.addEventListener('drop', function(e) {
    e.preventDefault();
  });

  // 退出确认模态框事件
  document.getElementById('close-exit-modal-btn').addEventListener('click', closeExitModal);
  document.getElementById('exit-cancel-btn').addEventListener('click', closeExitModal);
  document.getElementById('exit-confirm-btn').addEventListener('click', confirmExit);
  
  // 点击模态框外部关闭
  document.getElementById('exit-confirm-modal').addEventListener('click', function (e) {
    if (e.target === this) {
      closeExitModal();
    }
  });

  // 模态框关闭按钮
  document.getElementById('close-modal-header-btn').addEventListener('click', closeModal);
  document.getElementById('close-info-modal-btn').addEventListener('click', closeInfoModal);

  // 创意工坊按钮
  document.getElementById('workshop-btn').addEventListener('click', openWorkshopModal);
  document.getElementById('close-workshop-modal-btn').addEventListener('click', closeWorkshopModal);
  document.getElementById('check-workshop-btn').addEventListener('click', checkWorkshopUrl);
  document.getElementById('download-workshop-btn').addEventListener('click', downloadWorkshopFile);
  
  // 复制下载链接按钮
  document.getElementById('copy-url-btn').addEventListener('click', function() {
    const input = document.getElementById('download-url');
    if (input.value) {
      input.select();
      navigator.clipboard.writeText(input.value).then(() => {
        showNotification('链接已复制', 'success');
      }).catch(err => {
        console.error('复制失败:', err);
        showError('复制失败');
      });
    }
  });

  console.log('模态框事件监听器已设置');

  // 点击模态框外部关闭
  document.getElementById('file-detail-modal').addEventListener('click', function (e) {
    if (e.target === this) {
      closeModal();
    }
  });

  document.getElementById('workshop-modal').addEventListener('click', function (e) {
    if (e.target === this) {
      closeWorkshopModal();
    }
  });

  document.getElementById('info-modal').addEventListener('click', function (e) {
    if (e.target === this) {
      closeInfoModal();
    }
  });

  // 文件列表按钮事件委托
  console.log('正在设置文件列表按钮事件委托...');
  document.addEventListener('click', function (e) {
    console.log('全局点击事件触发:', e.target);

    // 处理更多按钮点击
    const moreBtn = e.target.closest('.more-btn');
    if (moreBtn) {
      e.preventDefault();
      e.stopPropagation();
      const dropdown = moreBtn.nextElementSibling;
      const fileItem = moreBtn.closest('.file-item');
      
      // 关闭其他所有打开的下拉菜单
      document.querySelectorAll('.dropdown-content').forEach(d => {
        if (d !== dropdown) {
          d.classList.add('hidden');
          // 移除其他 file-item 的 active 状态
          const otherFileItem = d.closest('.file-item');
          if (otherFileItem) otherFileItem.classList.remove('active-dropdown');
        }
      });
      
      dropdown.classList.toggle('hidden');
      if (fileItem) {
        if (dropdown.classList.contains('hidden')) {
          fileItem.classList.remove('active-dropdown');
        } else {
          fileItem.classList.add('active-dropdown');
        }
      }
      return;
    }

    // 点击其他地方关闭所有下拉菜单
    if (!e.target.closest('.more-actions-dropdown')) {
      document.querySelectorAll('.dropdown-content').forEach(d => {
        d.classList.add('hidden');
        const fileItem = d.closest('.file-item');
        if (fileItem) fileItem.classList.remove('active-dropdown');
      });
    }

    // 处理详情按钮点击
    const detailBtn = e.target.closest('.detail-btn');
    if (detailBtn) {
      console.log('找到详情按钮:', detailBtn);
      const filePath = detailBtn.getAttribute('data-file-path');
      console.log('文件路径:', filePath);
      if (filePath) {
        console.log('调用 showFileDetail:', filePath);
        e.preventDefault();
        e.stopPropagation();
        showFileDetail(filePath);
      } else {
        console.error('详情按钮缺少 data-file-path 属性');
      }
    }

    // 处理打开位置按钮点击
    const openLocationBtn = e.target.closest('.open-location-btn[data-action="open-location"]');
    if (openLocationBtn) {
      console.log('找到打开位置按钮:', openLocationBtn);
      const filePath = openLocationBtn.getAttribute('data-file-path');
      if (filePath) {
        console.log('调用 openFileLocation:', filePath);
        e.preventDefault();
        e.stopPropagation();
        
        // 关闭下拉菜单
        document.querySelectorAll('.dropdown-content').forEach(d => {
          d.classList.add('hidden');
          const fileItem = d.closest('.file-item');
          if (fileItem) fileItem.classList.remove('active-dropdown');
        });

        openFileLocation(filePath);
      }
    }

    // 处理切换按钮点击
    const toggleBtn = e.target.closest('.toggle-btn[data-action="toggle"]');
    if (toggleBtn) {
      console.log('找到切换按钮:', toggleBtn);
      const filePath = toggleBtn.getAttribute('data-file-path');
      if (filePath) {
        console.log('调用 toggleFile:', filePath);
        e.preventDefault();
        e.stopPropagation();
        toggleFile(filePath);
      }
    }

    // 处理转移按钮点击
    const moveBtn = e.target.closest('.move-btn[data-action="move"]');
    if (moveBtn) {
      console.log('找到转移按钮:', moveBtn);
      const filePath = moveBtn.getAttribute('data-file-path');
      if (filePath) {
        console.log('调用 moveFileToAddons:', filePath);
        e.preventDefault();
        e.stopPropagation();
        moveFileToAddons(filePath);
      }
    }

    // 处理删除按钮点击
    const deleteBtn = e.target.closest('.delete-btn[data-action="delete"]');
    if (deleteBtn) {
      console.log('找到删除按钮:', deleteBtn);
      const filePath = deleteBtn.getAttribute('data-file-path');
      if (filePath) {
        console.log('调用 deleteFile:', filePath);
        e.preventDefault();
        e.stopPropagation();

        // 关闭下拉菜单
        document.querySelectorAll('.dropdown-content').forEach(d => {
          d.classList.add('hidden');
          const fileItem = d.closest('.file-item');
          if (fileItem) fileItem.classList.remove('active-dropdown');
        });

        deleteFile(filePath);
      }
    }
  });

  console.log('文件列表按钮事件委托设置完成');

  // 添加测试函数到全局作用域
  window.testDetailButton = function () {
    console.log('测试详情按钮功能...');
    const detailBtns = document.querySelectorAll('.detail-btn');
    console.log('找到详情按钮数量:', detailBtns.length);

    if (detailBtns.length > 0) {
      const firstBtn = detailBtns[0];
      const filePath = firstBtn.getAttribute('data-file-path');
      console.log('第一个按钮的文件路径:', filePath);
      if (filePath) {
        showFileDetail(filePath);
      }
    }
  };

  // 添加强制显示模态框的测试函数
  window.testModal = function () {
    console.log('强制显示模态框测试...');
    const modal = document.getElementById('file-detail-modal');
    if (modal) {
      console.log('模态框存在，强制显示');
      modal.classList.remove('hidden');
      modal.style.display = 'flex';
    } else {
      console.error('模态框不存在!');
    }
  };

  // 测试通知系统
  window.testNotifications = function () {
    console.log('测试通知系统...');
    showNotification('这是信息通知', 'info');
    setTimeout(() => showNotification('这是成功通知', 'success'), 1000);
    setTimeout(() => showNotification('这是错误通知', 'error'), 2000);
  };

  // 添加单个文件状态更新测试函数
  window.testSingleFileUpdate = function (filePath) {
    console.log('测试单个文件更新...');
    const firstFile = appState.vpkFiles[0];
    if (firstFile) {
      console.log('测试更新文件:', firstFile.name);
      updateSingleFileStatus(firstFile.path);
    } else {
      console.log('没有找到可测试的文件');
    }
  };

  // 添加按钮状态验证测试函数
  window.testButtonStates = function () {
    console.log('=== 验证所有按钮状态 ===');
    const fileItems = document.querySelectorAll('.file-item');

    fileItems.forEach((item, index) => {
      const filePath = item.dataset.path;
      const file = appState.vpkFiles.find((f) => f.path === filePath);

      if (file) {
        const toggleBtn = item.querySelector('.toggle-btn');
        const statusEl = item.querySelector('.file-status');

        console.log(`文件 ${index + 1}: ${file.name}`);
        console.log(`- 实际状态: ${file.enabled ? '启用' : '禁用'}`);
        console.log(`- 显示状态: ${statusEl?.textContent || '未知'}`);
        console.log(`- 按钮类名: ${toggleBtn?.className || '未找到'}`);
        console.log(`- 按钮文本: ${toggleBtn?.textContent || '未找到'}`);

        // 检查状态是否一致
        const statusMatch = statusEl?.textContent.includes(file.enabled ? '启用' : '禁用');
        const btnTextMatch = toggleBtn?.textContent.includes(file.enabled ? '禁用' : '启用');

        if (!statusMatch || !btnTextMatch) {
          console.error(`❌ 状态不一致!`);
        } else {
          console.log(`✅ 状态一致`);
        }
        console.log('---');
      }
    });

    console.log('=== 按钮状态验证完成 ===');
  };

  // 添加文件排序验证测试函数
  window.testFileSorting = function () {
    console.log('=== 验证文件排序 ===');
    console.log('当前显示的文件列表顺序:');

    appState.vpkFiles.forEach((file, index) => {
      console.log(`${index + 1}. ${file.name}`);
    });

    // 检查是否已排序
    let isSorted = true;
    for (let i = 1; i < appState.vpkFiles.length; i++) {
      const prevName = appState.vpkFiles[i - 1].name.toLowerCase();
      const currName = appState.vpkFiles[i].name.toLowerCase();

      if (prevName > currName) {
        isSorted = false;
        console.error(
          `❌ 排序错误: "${appState.vpkFiles[i - 1].name}" 应该在 "${
            appState.vpkFiles[i].name
          }" 之后`
        );
        break;
      }
    }

    if (isSorted) {
      console.log('✅ 文件列表已正确排序');
    } else {
      console.error('❌ 文件列表排序有误');
    }

    console.log('=== 文件排序验证完成 ===');
  };
}

// 设置Wails事件监听
function setupWailsEvents() {
  console.log("正在初始化 Wails 事件监听...");

  // 监听错误事件
  EventsOn('error', handleError);
  
  // 监听任务更新
  EventsOn("task_updated", (task) => {
    updateTaskInList(task);
  });

  // 监听任务进度
  EventsOn("task_progress", (task) => {
    updateTaskProgress(task);
  });

  // 监听任务清理
  EventsOn("tasks_cleared", () => {
    refreshTaskList();
  });

  // 监听退出确认
  EventsOn("show_exit_confirmation", () => {
    showExitModal();
  });

  // 监听文件拖拽 (使用 OnFileDrop API)
  OnFileDrop((x, y, paths) => {
    console.log("OnFileDrop检测到文件拖拽:", paths);
    if (paths && paths.length > 0) {
        updateLoadingMessage('正在处理拖入的文件...');
        showLoadingScreen();
        HandleFileDrop(paths).then(() => {
             // 处理完成后的逻辑，通常后端会发送 refresh_files 事件
             // 这里可以做一个保底的关闭加载屏
             setTimeout(() => {
                showMainScreen();
             }, 1000);
        }).catch((err) => {
            showError("处理文件失败: " + err);
            showMainScreen();
        });
    }
  }, true);

  // 监听刷新文件列表
  EventsOn("refresh_files", () => {
      if (typeof refreshFilesKeepFilter === 'function') {
          refreshFilesKeepFilter();
      } else if (typeof performSearch === 'function') {
          performSearch();
      }
  });

  // 监听Toast消息
  EventsOn("show_toast", (data) => {
      if (data.type === 'error') {
          showError(data.message);
      } else {
          showNotification(data.message, data.type || 'success');
      }
  });
}

// 退出确认相关函数
function showExitModal() {
  document.getElementById('exit-confirm-modal').classList.remove('hidden');
}

function closeExitModal() {
  document.getElementById('exit-confirm-modal').classList.add('hidden');
}

async function confirmExit() {
  try {
    await ForceExit();
  } catch (err) {
    console.error('强制退出失败:', err);
  }
}

// 检查初始目录
async function checkInitialDirectory() {
  try {
    let dir = await GetRootDirectory();

    // 如果没有设置根目录但配置中有默认目录，使用默认目录
    const defaultDir = getDefaultDirectory();
    if (!dir && defaultDir) {
      try {
        await ValidateDirectory(defaultDir);
        await SetRootDirectory(defaultDir);
        dir = defaultDir;
      } catch (error) {
        console.warn('默认目录无效:', error);
      }
    }

    if (dir) {
      appState.currentDirectory = dir;
      updateDirectoryDisplay();
      showMainScreen();
      // 自动扫描
      await loadFiles();
    } else {
      showDirectorySelection();
    }
  } catch (error) {
    console.error('初始化失败:', error);
    showDirectorySelection();
  }
}

// 显示目录选择
function showDirectorySelection() {
  document.getElementById('loading-screen').classList.add('hidden');
  document.getElementById('main-screen').classList.remove('hidden');
  updateLoadingMessage('请选择L4D2的addons目录');
}

// 选择目录
async function selectDirectory() {
  try {
    const directory = await SelectDirectory();
    if (directory) {
      // 验证目录
      await ValidateDirectory(directory);

      await SetRootDirectory(directory);
      appState.currentDirectory = directory;

      // 保存默认目录到本地配置
      setDefaultDirectory(directory);

      updateDirectoryDisplay();
      await loadFiles();
    }
  } catch (error) {
    console.error('选择目录失败:', error);
    showError('设置目录失败: ' + error);
  }
}

// 启动L4D2
async function launchL4D2() {
  try {
    await LaunchL4D2();
    showNotification('正在启动 Left 4 Dead 2...', 'success');
  } catch (error) {
    console.error('启动L4D2失败:', error);
    showNotification('启动游戏失败: ' + error, 'error');
  }
}

// 更新目录显示
function updateDirectoryDisplay() {
  document.getElementById('current-directory').textContent = appState.currentDirectory;
}

// 加载文件
async function loadFiles() {
  // 防止重复点击
  if (appState.isLoading) {
    console.log('正在加载中，请稍候...');
    return;
  }

  appState.isLoading = true;
  showLoadingScreen();
  updateLoadingMessage('正在扫描VPK文件...');

  try {
    // 扫描VPK文件
    await ScanVPKFiles();

    // 获取文件列表和标签
    const [files, primaryTags] = await Promise.all([GetVPKFiles(), GetPrimaryTags()]);

    // 确保文件列表按名称排序，保持稳定顺序
    sortFilesByName(files);

    // 保存完整的文件列表和当前显示的列表
    appState.allVpkFiles = files;
    appState.vpkFiles = [...files]; // 复制已排序的数组
    appState.primaryTags = primaryTags;

    // 更新UI
    await renderTagFilters();
    renderFileList();
    updateStatusBar();

    console.log('扫描完成，找到', files.length, '个文件');
  } catch (error) {
    console.error('扫描文件失败:', error);
    alert('扫描文件失败: ' + error);
  } finally {
    appState.isLoading = false;
    showMainScreen();
  }
}

// 刷新文件列表
async function refreshFiles() {
  if (!appState.currentDirectory) {
    alert('请先选择目录');
    return;
  }
  await loadFiles();
}

// 保持筛选状态的刷新文件列表
async function refreshFilesKeepFilter() {
  if (!appState.currentDirectory) {
    alert('请先选择目录');
    return;
  }

  // 防止重复点击
  if (appState.isLoading) {
    console.log('正在加载中，请稍候...');
    return;
  }

  // 保存当前的筛选状态
  const currentFilters = {
    searchText: document.getElementById('search-input')?.value || '',
    primaryTag: appState.selectedPrimaryTag || '',
    secondaryTags: [...appState.selectedSecondaryTags],
    locationTags: [...appState.selectedLocations],
  };

  console.log('保存的筛选状态:', currentFilters);

  // 显示加载状态
  appState.isLoading = true;
  showLoadingScreen();
  updateLoadingMessage('正在刷新文件列表...');

  try {
    // ⭐ 重新扫描文件系统（触发智能缓存更新）
    await ScanVPKFiles();
    
    // 获取更新后的文件列表和标签
    const [files, primaryTags] = await Promise.all([GetVPKFiles(), GetPrimaryTags()]);

    // 确保文件列表按名称排序，保持稳定顺序
    sortFilesByName(files);

    // 更新状态
    appState.allVpkFiles = files;
    appState.primaryTags = primaryTags;

    // 先恢复筛选状态到 appState（这样 renderTagFilters 就能正确设置按钮状态）
    appState.searchQuery = currentFilters.searchText || '';
    appState.selectedPrimaryTag = currentFilters.primaryTag || '';
    appState.selectedSecondaryTags = currentFilters.secondaryTags || [];
    appState.selectedLocations = currentFilters.locationTags || [];

    // 重新渲染标签筛选器（会根据 appState 设置 active 状态）
    await renderTagFilters();

    // 恢复搜索框的值
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.value = currentFilters.searchText || '';
    }

    // 重新执行搜索以应用筛选
    await performSearch();

    // 更新状态栏
    updateStatusBar();

    console.log('文件列表已刷新，筛选状态已恢复');
  } catch (error) {
    console.error('刷新文件列表失败:', error);
    showError('刷新失败: ' + error);
  } finally {
    // 恢复正常状态
    appState.isLoading = false;
    showMainScreen();
  }
}

// 恢复筛选状态
function restoreFilterState(filters) {
  console.log('恢复筛选状态:', filters);

  // 恢复搜索框
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.value = filters.searchText || '';
    appState.searchQuery = filters.searchText || '';
  }

  // 恢复一级标签选择
  document.querySelectorAll('.primary-tag-btn').forEach((btn) => {
    if (btn.dataset.value === (filters.primaryTag || '')) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  appState.selectedPrimaryTag = filters.primaryTag || '';

  // 恢复二级标签选择
  appState.selectedSecondaryTags = filters.secondaryTags || [];
  
  // 如果有一级标签选择，重新渲染二级标签以恢复选中状态
  if (filters.primaryTag) {
    renderSecondaryTags(filters.primaryTag);
  }

  // 恢复位置标签
  appState.selectedLocations = filters.locationTags || [];
  document.querySelectorAll('.location-tag-btn').forEach((btn) => {
    if (appState.selectedLocations.includes(btn.dataset.tag)) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  console.log(
    '筛选状态已恢复，搜索词:',
    appState.searchQuery,
    '一级标签:',
    appState.selectedPrimaryTag,
    '二级标签:',
    appState.selectedSecondaryTags,
    '位置:',
    appState.selectedLocations
  );
}

// 显示加载屏幕
function showLoadingScreen() {
  document.getElementById('loading-screen').classList.remove('hidden');
  document.getElementById('main-screen').classList.add('hidden');
  disableActionButtons();
}

// 显示主屏幕
function showMainScreen() {
  document.getElementById('loading-screen').classList.add('hidden');
  document.getElementById('main-screen').classList.remove('hidden');
  enableActionButtons();
}

// 更新加载消息
function updateLoadingMessage(message) {
  document.getElementById('loading-message').textContent = message;
}

// 禁用操作按钮
function disableActionButtons() {
  const buttons = [
    'refresh-btn',
    'reset-filter-btn',
    'select-directory-btn',
    'select-all-btn',
    'deselect-all-btn',
    'enable-selected-btn',
    'disable-selected-btn',
  ];
  buttons.forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.disabled = true;
      btn.style.opacity = '0.5';
      btn.style.cursor = 'not-allowed';
    }
  });
}

// 启用操作按钮
function enableActionButtons() {
  const buttons = [
    'refresh-btn',
    'reset-filter-btn',
    'select-directory-btn',
    'select-all-btn',
    'deselect-all-btn',
    'enable-selected-btn',
    'disable-selected-btn',
  ];
  buttons.forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.disabled = false;
      btn.style.opacity = '';
      btn.style.cursor = '';
    }
  });
}

// 渲染标签筛选器
async function renderTagFilters() {
  const tagContainer = document.getElementById('tag-filters');
  const locationContainer = document.getElementById('location-filter-section');
  
  tagContainer.innerHTML = '';
  locationContainer.innerHTML = '';

  try {
    // 获取一级标签
    const primaryTags = await GetPrimaryTags();

    // 创建一级标签选择器
    const primaryGroup = document.createElement('div');
    primaryGroup.className = 'tag-group primary-tag-group';

    const primaryLabel = document.createElement('label');
    primaryLabel.textContent = '标签:';
    primaryGroup.appendChild(primaryLabel);

    // 创建一级标签按钮容器
    const primaryTagsContainer = document.createElement('div');
    primaryTagsContainer.className = 'primary-tags-container';

    // 添加"全部"按钮
    const allBtn = createPrimaryTagButton('', '全部');
    primaryTagsContainer.appendChild(allBtn);

    // 添加一级标签按钮
    primaryTags.forEach((tag) => {
      const tagBtn = createPrimaryTagButton(tag, tag);
      primaryTagsContainer.appendChild(tagBtn);
    });

    primaryGroup.appendChild(primaryTagsContainer);
    tagContainer.appendChild(primaryGroup);

    // 创建二级标签选择器
    const secondaryGroup = document.createElement('div');
    secondaryGroup.className = 'tag-group secondary-tag-group';
    secondaryGroup.id = 'secondary-tag-group';
    secondaryGroup.style.display = 'none'; // 默认隐藏

    const secondaryLabel = document.createElement('label');
    secondaryLabel.textContent = '子标签:';
    secondaryGroup.appendChild(secondaryLabel);

    tagContainer.appendChild(secondaryGroup);

    // 如果已选择一级标签，渲染二级标签
    if (appState.selectedPrimaryTag) {
      await renderSecondaryTags(appState.selectedPrimaryTag);
    }

    // 渲染位置标签到第一行
    const locationLabel = document.createElement('label');
    locationLabel.textContent = '位置:';
    locationLabel.className = 'filter-label';
    locationContainer.appendChild(locationLabel);

    const locationTags = ['root', 'workshop', 'disabled'];
    locationTags.forEach((tag) => {
      const tagBtn = createLocationTagButton(tag, getLocationDisplayName(tag));
      locationContainer.appendChild(tagBtn);
    });
  } catch (error) {
    console.error('渲染标签筛选器失败:', error);
  }
}

// 创建一级标签按钮
function createPrimaryTagButton(value, text) {
  const button = document.createElement('button');
  button.className = 'primary-tag-btn';
  button.textContent = text;
  button.dataset.value = value;

  if (appState.selectedPrimaryTag === value) {
    button.classList.add('active');
  }

  button.addEventListener('click', async function () {
    // 移除所有一级标签的active状态
    document.querySelectorAll('.primary-tag-btn').forEach((btn) => {
      btn.classList.remove('active');
    });

    // 设置当前按钮为active
    button.classList.add('active');

    // 更新状态
    appState.selectedPrimaryTag = value;
    appState.selectedSecondaryTags = []; // 清空二级标签选择

    // 渲染二级标签
    await renderSecondaryTags(appState.selectedPrimaryTag);

    // 执行搜索
    performSearch();
  });

  return button;
}

// 渲染二级标签
async function renderSecondaryTags(primaryTag) {
  const secondaryGroup = document.getElementById('secondary-tag-group');

  // 清除现有的二级标签按钮
  const existingContainer = secondaryGroup.querySelector('.secondary-tags-container');
  if (existingContainer) {
    existingContainer.remove();
  }

  if (!primaryTag) {
    // 没有选择标签时隐藏整个子标签组
    secondaryGroup.style.display = 'none';
    return;
  }

  try {
    const secondaryTags = await GetSecondaryTags(primaryTag);

    if (secondaryTags.length > 0) {
      // 对二级标签进行排序（按字母顺序）
      secondaryTags.sort((a, b) => a.localeCompare(b, 'zh-CN'));

      // 显示子标签组
      secondaryGroup.style.display = 'flex';

      const container = document.createElement('div');
      container.className = 'secondary-tags-container';

      secondaryTags.forEach((tag) => {
        const tagBtn = createSecondaryTagButton(tag);
        container.appendChild(tagBtn);
      });

      secondaryGroup.appendChild(container);
    } else {
      // 没有子标签时隐藏
      secondaryGroup.style.display = 'none';
    }
  } catch (error) {
    console.error('获取二级标签失败:', error);
    secondaryGroup.style.display = 'none';
  }
}

// 创建二级标签按钮
function createSecondaryTagButton(tag) {
  const button = document.createElement('button');
  button.className = 'secondary-tag-btn';
  button.textContent = tag;
  button.dataset.tag = tag;

  if (appState.selectedSecondaryTags.includes(tag)) {
    button.classList.add('active');
  }

  button.addEventListener('click', function () {
    toggleSecondaryTag(tag, button);
  });

  return button;
}

// 切换二级标签
function toggleSecondaryTag(tag, button) {
  const index = appState.selectedSecondaryTags.indexOf(tag);
  if (index > -1) {
    appState.selectedSecondaryTags.splice(index, 1);
    button.classList.remove('active');
  } else {
    appState.selectedSecondaryTags.push(tag);
    button.classList.add('active');
  }

  performSearch();
}

// 创建位置标签按钮
function createLocationTagButton(tag, displayName) {
  const button = document.createElement('button');
  button.className = 'location-tag-btn';
  button.textContent = displayName;
  button.dataset.tag = tag;

  // 根据 appState 设置 active 状态
  if (appState.selectedLocations.includes(tag)) {
    button.classList.add('active');
  }

  button.addEventListener('click', function () {
    toggleLocationFilter(tag, button);
  });

  return button;
}

// 获取位置标签显示名称
function getLocationDisplayName(tag) {
  const displayNames = {
    root: '根目录',
    workshop: '创意工坊',
    disabled: '已禁用',
  };
  return displayNames[tag] || tag;
}

// 切换位置筛选
function toggleLocationFilter(location, button) {
  const index = appState.selectedLocations.indexOf(location);
  if (index > -1) {
    appState.selectedLocations.splice(index, 1);
    button.classList.remove('active');
  } else {
    appState.selectedLocations.push(location);
    button.classList.add('active');
  }

  performSearch();
}

// 重置所有筛选条件
async function resetFilters() {
  // 防止重复点击
  if (appState.isLoading) {
    console.log('正在加载中，请稍候...');
    return;
  }

  appState.isLoading = true;
  showLoadingScreen();
  updateLoadingMessage('正在重置筛选...');

  try {
    // 清空搜索框
    document.getElementById('search-input').value = '';
    appState.searchQuery = '';

    // 清空一级标签
    document.querySelectorAll('.primary-tag-btn').forEach((btn) => {
      btn.classList.remove('active');
      if (btn.dataset.value === '') {
        btn.classList.add('active'); // 激活"全部"按钮
      }
    });
    appState.selectedPrimaryTag = '';

    // 清空二级标签
    appState.selectedSecondaryTags = [];
    
    // 清空位置筛选
    appState.selectedLocations = [];
    document.querySelectorAll('.location-tag-btn').forEach((btn) => {
      btn.classList.remove('active');
    });

    // 清空二级标签显示
    await renderSecondaryTags('');

    // 重新执行搜索
    await performSearch();
  } finally {
    appState.isLoading = false;
    showMainScreen();
  }
}

// 处理搜索
function handleSearch(event) {
  appState.searchQuery = event.target.value;
  performSearch();
}

// 执行搜索
async function performSearch() {
  try {
    console.log(
      '执行搜索，查询词:',
      appState.searchQuery,
      '一级标签:',
      appState.selectedPrimaryTag,
      '二级标签:',
      appState.selectedSecondaryTags,
      '位置:',
      appState.selectedLocations
    );

    // 如果没有搜索条件，显示所有文件
    if (
      !appState.searchQuery &&
      !appState.selectedPrimaryTag &&
      appState.selectedSecondaryTags.length === 0
    ) {
      appState.vpkFiles = [...appState.allVpkFiles];
    } else {
      // 执行搜索
      const results = await SearchVPKFiles(
        appState.searchQuery,
        appState.selectedPrimaryTag,
        appState.selectedSecondaryTags
      );
      appState.vpkFiles = results;
    }

    // 应用位置过滤
    if (appState.selectedLocations.length > 0) {
      appState.vpkFiles = appState.vpkFiles.filter((file) =>
        appState.selectedLocations.includes(file.location)
      );
    }

    // 确保结果按名称排序，保持稳定顺序
    sortFilesByName(appState.vpkFiles);

    renderFileList();
    updateStatusBar();

    console.log(`搜索完成，显示 ${appState.vpkFiles.length} 个文件`);
  } catch (error) {
    console.error('搜索失败:', error);
    showError('搜索失败: ' + error);
  }
}

// 渲染文件列表
function renderFileList() {
  const container = document.getElementById('file-list');
  container.innerHTML = '';

  appState.vpkFiles.forEach((file) => {
    const fileItem = createFileItem(file);
    container.appendChild(fileItem);
  });
}

// 创建文件项
function createFileItem(file) {
  const item = document.createElement('div');
  item.className = 'file-item';
  item.dataset.path = file.path;

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'file-checkbox';
  checkbox.addEventListener('change', function () {
    toggleFileSelection(file.path, checkbox.checked);
  });

  const statusIcon = file.enabled ? '✅' : '❌';
  const locationIcon = getLocationIcon(file.location);
  const displayTitle = file.title || file.name;

  item.innerHTML = `
        <div class="file-checkbox-container"></div>
        <div class="file-name" title="${file.path}">
            <div class="file-title">${displayTitle}</div>
            <div class="file-filename">${file.name}</div>
        </div>
        <div class="file-size">${formatFileSize(file.size)}</div>
        <div class="file-status">${statusIcon} ${file.enabled ? '启用' : '禁用'}</div>
        <div class="file-location">${locationIcon} ${getLocationDisplayName(file.location)}</div>
        <div class="file-tags">${formatTags(file.primaryTag, file.secondaryTags)}</div>
        <div class="file-actions">
            <button class="btn-small action-btn detail-btn" data-file-path="${file.path}">
                <span class="btn-icon">🔍</span>
                <span class="btn-text">详情</span>
            </button>
            ${getActionButton(file)}
            <div class="more-actions-dropdown">
                <button class="btn-small action-btn more-btn" title="更多操作">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                        <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
                    </svg>
                </button>
                <div class="dropdown-content hidden">
                    <button class="dropdown-item open-location-btn" data-file-path="${file.path}" data-action="open-location">
                        <span class="btn-icon">📂</span> 位置
                    </button>
                    <button class="dropdown-item delete-btn" data-file-path="${file.path}" data-action="delete">
                        <span class="btn-icon">🗑️</span> 删除
                    </button>
                </div>
            </div>
        </div>
    `;

  // 插入复选框
  item.querySelector('.file-checkbox-container').appendChild(checkbox);

  // 为整个 item 添加双击事件（除了复选框和按钮）
  item.addEventListener('dblclick', function(e) {
    // 如果双击的是复选框或按钮，不触发详情
    if (e.target.closest('.file-checkbox-container') || 
        e.target.closest('.file-actions') ||
        e.target.type === 'checkbox' ||
        e.target.closest('button')) {
      return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    showFileDetail(file.path);
  });

  return item;
}

// 获取操作按钮
function getActionButton(file) {
  if (file.location === 'workshop') {
    // Workshop文件显示转移按钮
    return `
      <button class="btn-small action-btn move-btn" data-file-path="${file.path}" data-action="move">
        <span class="btn-icon">📦</span>
        <span class="btn-text">转移</span>
      </button>
    `;
  } else {
    // Root和Disabled文件显示启用/禁用按钮
    return `
      <button class="btn-small action-btn toggle-btn ${
        file.enabled ? 'toggle-disable' : 'toggle-enable'
      }" data-file-path="${file.path}" data-action="toggle">
        <span class="btn-icon">${file.enabled ? '⛔' : '✅'}</span>
        <span class="btn-text">${file.enabled ? '禁用' : '启用'}</span>
      </button>
    `;
  }
}

// 获取位置图标
function getLocationIcon(location) {
  const icons = {
    root: '📁',
    workshop: '🔧',
    disabled: '🚫',
  };
  return icons[location] || '📄';
}

// 格式化文件大小
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 格式化标签
function formatTags(primaryTag, secondaryTags = []) {
  const tags = [];

  // 添加一级标签
  if (primaryTag) {
    tags.push(`<span class="tag primary-tag">${primaryTag}</span>`);
  }

  // 添加二级标签（最多显示2个）
  if (secondaryTags && secondaryTags.length > 0) {
    secondaryTags.slice(0, 2).forEach((tag) => {
      tags.push(`<span class="tag secondary-tag">${tag}</span>`);
    });

    // 如果还有更多二级标签，显示省略号
    if (secondaryTags.length > 2) {
      tags.push(`<span class="tag more-tags">+${secondaryTags.length - 2}</span>`);
    }
  }

  return tags.join('');
}

// 切换文件选择
function toggleFileSelection(filePath, selected) {
  if (selected) {
    appState.selectedFiles.add(filePath);
  } else {
    appState.selectedFiles.delete(filePath);
  }

  updateStatusBar();
}

// 全选
function selectAll() {
  const checkboxes = document.querySelectorAll('.file-checkbox');
  
  checkboxes.forEach((checkbox, index) => {
    checkbox.checked = true;
    const file = appState.vpkFiles[index];
    if (file) {
      toggleFileSelection(file.path, true);
    }
  });
}

// 取消全选
function deselectAll() {
  const checkboxes = document.querySelectorAll('.file-checkbox');
  
  checkboxes.forEach((checkbox, index) => {
    checkbox.checked = false;
    const file = appState.vpkFiles[index];
    if (file) {
      toggleFileSelection(file.path, false);
    }
  });
}

// 启用选中的文件
async function enableSelected() {
  if (appState.selectedFiles.size === 0) {
    alert('请先选择文件');
    return;
  }

  const filesToToggle = Array.from(appState.selectedFiles).filter((filePath) => {
    const file = appState.vpkFiles.find((f) => f.path === filePath);
    // 只处理disabled目录中的文件（workshop文件不能直接启用）
    return file && !file.enabled && file.location === 'disabled';
  });

  if (filesToToggle.length === 0) {
    showNotification('没有需要启用的文件（只能启用disabled目录中的文件）', 'info');
    return;
  }

  try {
    console.log(`批量启用 ${filesToToggle.length} 个文件...`);

    // 并行处理所有文件
    const promises = filesToToggle.map(async (filePath) => {
      try {
        await ToggleVPKFile(filePath);
        return filePath;
      } catch (error) {
        console.error('启用文件失败:', filePath, error);
        return null;
      }
    });

    const results = await Promise.all(promises);
    const successFiles = results.filter((path) => path !== null);

    // 批量更新成功的文件状态
    await batchUpdateFileStatus(successFiles);

    // 刷新列表以反映位置变化
    await refreshFilesKeepFilter();

    showNotification(`成功启用 ${successFiles.length} 个文件`, 'success');

    if (successFiles.length < filesToToggle.length) {
      const failedCount = filesToToggle.length - successFiles.length;
      showNotification(`${failedCount} 个文件启用失败`, 'error');
    }
  } catch (error) {
    console.error('批量启用失败:', error);
    showError('批量启用失败: ' + error);
  }
}

// 禁用选中的文件
async function disableSelected() {
  if (appState.selectedFiles.size === 0) {
    alert('请先选择文件');
    return;
  }

  const filesToToggle = Array.from(appState.selectedFiles).filter((filePath) => {
    const file = appState.vpkFiles.find((f) => f.path === filePath);
    // 只处理root目录中的启用文件（workshop文件不能直接禁用）
    return file && file.enabled && file.location === 'root';
  });

  if (filesToToggle.length === 0) {
    showNotification('没有需要禁用的文件（只能禁用root目录中的文件）', 'info');
    return;
  }

  try {
    console.log(`批量禁用 ${filesToToggle.length} 个文件...`);

    // 并行处理所有文件
    const promises = filesToToggle.map(async (filePath) => {
      try {
        await ToggleVPKFile(filePath);
        return filePath;
      } catch (error) {
        console.error('禁用文件失败:', filePath, error);
        return null;
      }
    });

    const results = await Promise.all(promises);
    const successFiles = results.filter((path) => path !== null);

    // 批量更新成功的文件状态
    await batchUpdateFileStatus(successFiles);

    // 刷新列表以反映位置变化
    await refreshFilesKeepFilter();

    showNotification(`成功禁用 ${successFiles.length} 个文件`, 'success');

    if (successFiles.length < filesToToggle.length) {
      const failedCount = filesToToggle.length - successFiles.length;
      showNotification(`${failedCount} 个文件禁用失败`, 'error');
    }
  } catch (error) {
    console.error('批量禁用失败:', error);
    showError('批量禁用失败: ' + error);
  }
}

// 批量删除选中的文件
async function deleteSelected() {
  if (appState.selectedFiles.size === 0) {
    alert('请先选择文件');
    return;
  }

  showConfirmModal(
    '确认批量删除',
    `确定要删除选中的 ${appState.selectedFiles.size} 个文件吗？文件将被移动到回收站。`,
    async () => {
      const filesToDelete = Array.from(appState.selectedFiles);

      try {
        console.log(`批量删除 ${filesToDelete.length} 个文件...`);
        
        await DeleteVPKFiles(filesToDelete);
        
        // 从选中集合中移除
        filesToDelete.forEach(filePath => appState.selectedFiles.delete(filePath));
        
        // 刷新列表
        await refreshFilesKeepFilter();
        
        showNotification(`成功删除 ${filesToDelete.length} 个文件`, 'success');
      } catch (error) {
        console.error('批量删除失败:', error);
        showError('批量删除失败: ' + error);
      }
    }
  );
}

// 更新状态栏
function updateStatusBar() {
  // 使用完整列表进行统计
  const totalFiles = appState.allVpkFiles.length;
  const enabledFiles = appState.allVpkFiles.filter((f) => f.enabled).length;
  const disabledFiles = totalFiles - enabledFiles;
  const selectedCount = appState.selectedFiles.size;

  document.getElementById('total-files').textContent = `总文件数: ${totalFiles}`;
  document.getElementById('enabled-files').textContent = `已启用: ${enabledFiles}`;
  document.getElementById('disabled-files').textContent = `已禁用: ${disabledFiles}`;
  document.getElementById('selected-files').textContent = `已选择: ${selectedCount}`;
}

// 显示文件详情
let currentDetailFile = null;

window.showFileDetail = function (filePath) {
  console.log('=== showFileDetail 开始执行 ===');
  console.log('文件路径:', filePath);
  console.log('appState.vpkFiles 长度:', appState.vpkFiles.length);

  const file = appState.vpkFiles.find((f) => f.path === filePath);
  if (!file) {
    console.error('未找到文件:', filePath);
    console.log(
      '可用文件列表:',
      appState.vpkFiles.map((f) => f.path)
    );
    return;
  }

  console.log('找到文件:', file.name);
  currentDetailFile = file;
  console.log('当前详情文件:', currentDetailFile);

  // 检查模态框元素是否存在
  const modal = document.getElementById('file-detail-modal');
  console.log('模态框元素:', modal);

  if (!modal) {
    console.error('模态框元素不存在!');
    return;
  }

  // 填充基本信息
  document.getElementById('detail-file-name').textContent = file.name;
  document.getElementById('detail-name').textContent = file.name;
  document.getElementById('detail-size').textContent = formatFileSize(file.size);
  document.getElementById('detail-location').textContent = getLocationDisplayName(file.location);
  document.getElementById('detail-status').textContent = file.enabled ? '启用' : '禁用';
  document.getElementById('detail-modified').textContent = new Date(
    file.lastModified
  ).toLocaleString();

  // 显示预览图
  const previewSection = document.getElementById('preview-section');
  const previewImage = document.getElementById('detail-preview-image');
  if (file.previewImage) {
    previewSection.classList.remove('hidden');
    previewImage.src = file.previewImage;
    previewImage.style.display = 'block';
  } else {
    previewSection.classList.add('hidden');
    previewImage.style.display = 'none';
  }

  // 填充标签
  const tagsContainer = document.getElementById('detail-tags');
  const primaryTagHtml = file.primaryTag
    ? `<span class="tag primary-tag">${file.primaryTag}</span>`
    : '';
  tagsContainer.innerHTML = primaryTagHtml;

  const detailTagsContainer = document.getElementById('detail-detail-tags');
  const secondaryTagsHtml =
    file.secondaryTags && file.secondaryTags.length > 0
      ? file.secondaryTags.map((tag) => `<span class="tag secondary-tag">${tag}</span>`).join('')
      : '';
  detailTagsContainer.innerHTML = secondaryTagsHtml;

  // 填充VPK信息
  const vpkInfoSection = document.getElementById('vpk-info-section');
  document.getElementById('detail-vpk-title').textContent = file.title || '无标题';
  
  // 作者信息（若有才显示）
  const authorItem = document.getElementById('detail-vpk-author-item');
  if (file.author && file.author !== '') {
    authorItem.style.display = 'grid';
    document.getElementById('detail-vpk-author').textContent = file.author;
  } else {
    authorItem.style.display = 'none';
  }
  
  // 版本信息（若有才显示）
  const versionItem = document.getElementById('detail-vpk-version-item');
  if (file.version && file.version !== '') {
    versionItem.style.display = 'grid';
    document.getElementById('detail-vpk-version').textContent = file.version;
  } else {
    versionItem.style.display = 'none';
  }
  
  // 描述信息（若有才显示）
  const descItem = document.getElementById('detail-vpk-desc-item');
  if (file.desc && file.desc !== '') {
    descItem.style.display = 'grid';
    document.getElementById('detail-vpk-desc').textContent = file.desc;
  } else {
    descItem.style.display = 'none';
  }

  // 填充地图信息
  const mapInfoSection = document.getElementById('map-info-section');
  if (file.primaryTag === '地图') {
    mapInfoSection.classList.remove('hidden');

    // 显示战役名（第一行）
    const campaignElement = document.getElementById('detail-campaign');
    campaignElement.textContent = file.campaign || '未知战役';

    // 显示章节和模式信息（第二行开始）
    const chaptersListElement = document.getElementById('detail-chapters-list');
    if (file.chapters && Object.keys(file.chapters).length > 0) {
      let chaptersHtml = '';
      // 遍历章节对象，key是章节代码，value是ChapterInfo
      Object.entries(file.chapters).forEach(([chapterCode, chapterInfo]) => {
        const chapterName = chapterInfo.title || chapterCode;
        const modes = chapterInfo.modes || [];
        chaptersHtml += `
          <div class="chapter-item">
            <div class="chapter-name">${chapterName}</div>
            <div class="chapter-modes">${modes.length > 0 ? modes.join(' | ') : '未知模式'}</div>
          </div>
        `;
      });
      chaptersListElement.innerHTML = chaptersHtml;
    } else {
      chaptersListElement.innerHTML = '<div class="no-chapters">无章节信息</div>';
    }
  } else {
    mapInfoSection.classList.add('hidden');
  }

  console.log('显示模态框...');
  modal.classList.remove('hidden');
  
  // 将模态框内容滚动到顶部（使用 setTimeout 确保 DOM 更新后执行）
  setTimeout(() => {
    const modalContent = modal.querySelector('.modal-content');
    const modalBody = modal.querySelector('.modal-body');
    
    if (modalContent) {
      modalContent.scrollTop = 0;
    }
    if (modalBody) {
      modalBody.scrollTop = 0;
    }
  }, 0);
  
  console.log('模态框已显示, 当前类:', modal.className);
  console.log('=== showFileDetail 执行完成 ===');
};

// 关闭模态框
function closeModal() {
  document.getElementById('file-detail-modal').classList.add('hidden');
  currentDetailFile = null;
}

// 显示关于信息弹窗
function showInfoModal() {
  document.getElementById('info-modal').classList.remove('hidden');
}

// 关闭关于信息弹窗
function closeInfoModal() {
  document.getElementById('info-modal').classList.add('hidden');
}

// 切换文件状态（全局函数）
window.toggleFile = async function (filePath) {
  try {
    console.log('切换文件状态:', filePath);

    // 调用后端切换状态
    await ToggleVPKFile(filePath);

    // 保持筛选状态的完整刷新
    await refreshFilesKeepFilter();

    showNotification('文件状态已更新', 'success');
  } catch (error) {
    console.error('切换文件状态失败:', error);
    showError('操作失败: ' + error);
  }
};

// 转移文件到插件目录（全局函数）
window.moveFileToAddons = async function (filePath) {
  try {
    console.log('转移文件到插件目录:', filePath);

    // 调用后端转移文件
    await MoveWorkshopToAddons(filePath);

    // 保持筛选状态的完整刷新
    await refreshFilesKeepFilter();

    showNotification('文件已转移到插件目录', 'success');
  } catch (error) {
    console.error('转移文件失败:', error);
    showError('转移失败: ' + error);
  }
};

// 删除文件（全局函数）
window.deleteFile = function (filePath) {
  showConfirmModal('确认删除', '确定要将此文件移至回收站吗？', async () => {
    try {
      console.log('删除文件:', filePath);
      await DeleteVPKFile(filePath);
      await refreshFilesKeepFilter();
      showNotification('文件已移至回收站', 'success');
    } catch (error) {
      console.error('删除文件失败:', error);
      showError('删除失败: ' + error);
    }
  });
};

// 打开文件所在位置（全局函数）
window.openFileLocation = async function (filePath) {
  try {
    console.log('打开文件所在位置:', filePath);

    // 调用后端打开文件位置
    await OpenFileLocation(filePath);

    showNotification('已打开文件所在位置', 'success');
  } catch (error) {
    console.error('打开文件位置失败:', error);
    showError('打开位置失败: ' + error);
  }
};

// LytVPK v2.8 - 启用/禁用逻辑重构版
//
// 功能特性：
// 1. Workshop文件只能转移，不能直接启用/禁用
// 2. Root文件可以禁用（移动到disabled目录）
// 3. Disabled文件可以启用（移动到root目录）
// 4. 文件状态切换后使用 refreshFilesKeepFilter() 完整刷新
// 5. 自动保存和恢复筛选状态（搜索词、标签筛选、状态筛选）
// 6. 确保文件列表按名称稳定排序，避免乱序跳动
// 7. 保持选中状态和UI一致性// 统一的文件排序函数
function sortFilesByName(files) {
  return files.sort((a, b) => {
    // 使用更稳定的排序算法
    const nameA = a.name.toLowerCase();
    const nameB = b.name.toLowerCase();

    // 先按名称排序，如果名称相同则按路径排序确保稳定性
    if (nameA === nameB) {
      return a.path.localeCompare(b.path);
    }

    return nameA.localeCompare(nameB, 'zh-CN', {
      numeric: true,
      sensitivity: 'accent',
    });
  });
}

// 批量更新文件状态（保持列表顺序和筛选状态）
async function batchUpdateFileStatus(filePaths) {
  if (!filePaths || filePaths.length === 0) {
    return;
  }

  try {
    console.log(`批量更新 ${filePaths.length} 个文件状态...`);

    // 获取最新的文件列表
    const updatedFiles = await GetVPKFiles();

    // 创建一个映射以便快速查找
    const updatedFileMap = new Map(updatedFiles.map((f) => [f.path, f]));

    // 更新文件状态
    filePaths.forEach((filePath) => {
      const updatedFile = updatedFileMap.get(filePath);

      if (updatedFile) {
        // 更新原始完整列表
        const allFileIndex = appState.allVpkFiles.findIndex((f) => f.path === filePath);
        if (allFileIndex >= 0) {
          appState.allVpkFiles[allFileIndex] = updatedFile;
        }

        // 更新当前显示列表中的文件（如果存在）
        const displayFileIndex = appState.vpkFiles.findIndex((f) => f.path === filePath);
        if (displayFileIndex >= 0) {
          appState.vpkFiles[displayFileIndex] = updatedFile;

          // 更新单个文件的显示
          updateSingleFileDisplay(updatedFile);
        }
      }
    });

    // 更新状态栏
    updateStatusBar();

    console.log(`批量更新完成，共更新 ${filePaths.length} 个文件`);

    // 同步选中状态
    syncSelectedFiles();
  } catch (error) {
    console.error('批量更新文件状态失败:', error);
    // 如果批量更新失败，回退到完整刷新
    console.log('回退到完整刷新...');
    await refreshFiles();
  }
}

// 同步选中文件状态，确保界面显示的复选框状态正确
function syncSelectedFiles() {
  const checkboxes = document.querySelectorAll('.file-checkbox');
  checkboxes.forEach((checkbox, index) => {
    const file = appState.vpkFiles[index];
    if (file) {
      checkbox.checked = appState.selectedFiles.has(file.path);
    }
  });
}

// 错误处理
function handleError(errorInfo) {
  console.error('应用错误:', errorInfo);
  showError(`${errorInfo.type}: ${errorInfo.message}`);
}

function showError(message) {
  // 创建错误提示
  const errorDiv = document.createElement('div');
  errorDiv.className = 'error-notification';
  errorDiv.innerHTML = `
    <div class="error-content">
      <span class="error-icon">⚠️</span>
      <span class="error-message">${message}</span>
      <button class="error-close" onclick="this.parentElement.parentElement.remove()">×</button>
    </div>
  `;

  document.body.appendChild(errorDiv);

  // 3秒后自动消失
  setTimeout(() => {
    if (errorDiv.parentNode) {
      errorDiv.parentNode.removeChild(errorDiv);
    }
  }, 3000);
}

// 通用通知函数
function showNotification(message, type = 'info') {
  console.log(`显示通知: ${message} (类型: ${type})`);

  switch (type) {
    case 'success':
      showSuccess(message);
      break;
    case 'error':
      showError(message);
      break;
    case 'info':
    default:
      showInfo(message);
      break;
  }
}

function showSuccess(message) {
  // 创建成功提示
  const successDiv = document.createElement('div');
  successDiv.className = 'success-notification';
  successDiv.innerHTML = `
    <div class="success-content">
      <span class="success-icon">✅</span>
      <span class="success-message">${message}</span>
      <button class="success-close" onclick="this.parentElement.parentElement.remove()">×</button>
    </div>
  `;

  document.body.appendChild(successDiv);

  // 3秒后自动消失
  setTimeout(() => {
    if (successDiv.parentNode) {
      successDiv.parentNode.removeChild(successDiv);
    }
  }, 3000);
}

// 显示信息提示
function showInfo(message) {
  const infoDiv = document.createElement('div');
  infoDiv.className = 'info-notification';
  infoDiv.innerHTML = `
    <div class="info-content">
      <span class="info-icon">ℹ️</span>
      <span class="info-message">${message}</span>
      <button class="info-close" onclick="this.parentElement.parentElement.remove()">×</button>
    </div>
  `;

  document.body.appendChild(infoDiv);

  // 3秒后自动消失
  setTimeout(() => {
    if (infoDiv.parentNode) {
      infoDiv.style.opacity = '0';
      infoDiv.style.transform = 'translateX(100%)';
      setTimeout(() => {
        if (infoDiv.parentNode) {
          infoDiv.parentNode.removeChild(infoDiv);
        }
      }, 300);
    }
  }, 3000);
}

// 创意工坊相关
let currentWorkshopDetails = null;

function openWorkshopModal() {
  document.getElementById('workshop-modal').classList.remove('hidden');
  document.getElementById('workshop-url').focus();
  refreshTaskList();
}

function closeWorkshopModal() {
  document.getElementById('workshop-modal').classList.add('hidden');
  // Reset state
  document.getElementById('workshop-url').value = '';
  document.getElementById('download-url').value = '';
  document.getElementById('workshop-result').classList.add('hidden');
  currentWorkshopDetails = null;
}

async function checkWorkshopUrl() {
  const url = document.getElementById('workshop-url').value.trim();
  if (!url) {
    showError('请输入创意工坊链接');
    return;
  }

  const checkBtn = document.getElementById('check-workshop-btn');
  const result = document.getElementById('workshop-result');
  const downloadUrlInput = document.getElementById('download-url');
  
  // Set loading state
  const originalBtnText = checkBtn.innerHTML;
  checkBtn.disabled = true;
  checkBtn.innerHTML = '<span class="btn-spinner"></span> 解析中...';
  
  result.classList.add('hidden');
  downloadUrlInput.value = '';

  try {
    const details = await GetWorkshopDetails(url);
    currentWorkshopDetails = details;
    
    document.getElementById('workshop-title').textContent = details.title;
    document.getElementById('workshop-filename').textContent = details.filename;
    document.getElementById('workshop-filesize').textContent = formatBytes(parseInt(details.file_size));
    
    const creatorContainer = document.getElementById('workshop-creator-container');
    if (details.creator && details.creator.trim() !== '') {
      creatorContainer.style.display = 'block';
      document.getElementById('workshop-creator').textContent = details.creator;
    } else {
      creatorContainer.style.display = 'none';
    }

    document.getElementById('workshop-preview').src = details.preview_url;
    
    // Fill download URL
    downloadUrlInput.value = details.file_url;
    
    result.classList.remove('hidden');
  } catch (err) {
    showError('解析失败: ' + err);
  } finally {
    // Restore button state
    checkBtn.disabled = false;
    checkBtn.innerHTML = originalBtnText;
  }
}

async function downloadWorkshopFile() {
  const downloadUrl = document.getElementById('download-url').value.trim();
  
  if (!downloadUrl) {
    showError('请输入或解析下载链接');
    return;
  }

  // If we have details, update the URL from input (in case user edited it)
  if (currentWorkshopDetails) {
    currentWorkshopDetails.file_url = downloadUrl;
  } else {
    // Create dummy details for direct download
    // Try to extract filename from URL
    let filename = 'unknown.vpk';
    try {
      const urlObj = new URL(downloadUrl);
      const pathParts = urlObj.pathname.split('/');
      if (pathParts.length > 0) {
        const lastPart = pathParts[pathParts.length - 1];
        if (lastPart && lastPart.trim() !== '') {
          filename = decodeURIComponent(lastPart);
        }
      }
    } catch (e) {
      console.warn('Failed to parse URL for filename:', e);
    }

    currentWorkshopDetails = {
      title: 'Direct Download',
      filename: filename,
      file_url: downloadUrl,
      file_size: '0',
      preview_url: '', // No preview
      publishedfileid: 'direct-' + Date.now(),
      result: 1
    };
  }
  
  try {
    await StartDownloadTask(currentWorkshopDetails);
    showInfo('已添加到后台下载队列');
    
    // Reset UI for next input
    document.getElementById('workshop-url').value = '';
    document.getElementById('download-url').value = '';
    document.getElementById('workshop-result').classList.add('hidden');
    currentWorkshopDetails = null;
    
    refreshTaskList();
  } catch (err) {
    showError('启动下载失败: ' + err);
  }
}

async function refreshTaskList() {
  const listContainer = document.getElementById('download-tasks-list');
  try {
    const tasks = await GetDownloadTasks();
    
    if (!tasks || tasks.length === 0) {
      listContainer.innerHTML = '<div class="empty-tasks" style="text-align: center; color: #888; padding: 20px;">暂无下载任务</div>';
      return;
    }

    // Sort tasks: pending/downloading first, then by time
    tasks.sort((a, b) => {
      const statusOrder = { 'downloading': 0, 'pending': 1, 'failed': 2, 'completed': 3 };
      if (statusOrder[a.status] !== statusOrder[b.status]) {
        return statusOrder[a.status] - statusOrder[b.status];
      }
      return b.id.localeCompare(a.id);
    });

    listContainer.innerHTML = '';
    tasks.forEach(task => {
      const item = createTaskElement(task);
      listContainer.appendChild(item);
    });
  } catch (err) {
    console.error("Failed to refresh tasks:", err);
  }
}

function createTaskElement(task) {
  const div = document.createElement('div');
  div.className = 'task-item';
  div.id = `task-${task.id}`;
  div.style.cssText = 'padding: 10px; border-bottom: 1px solid #eee; display: flex; gap: 10px; align-items: center;';
  
  const statusColors = {
    'pending': '#ff9800',
    'downloading': '#2196f3',
    'completed': '#4caf50',
    'failed': '#f44336'
  };

  const statusText = {
    'pending': '等待中',
    'downloading': '下载中',
    'completed': '已完成',
    'failed': '失败',
    'cancelled': '已取消'
  };

  let actionButtons = '';
  if (task.status === 'downloading' || task.status === 'pending') {
    actionButtons = `
      <button class="task-action-btn cancel-btn cancel-task-btn" data-id="${task.id}" title="取消下载">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>`;
  } else if (task.status === 'failed' || task.status === 'cancelled') {
    actionButtons = `
      <button class="task-action-btn retry-btn retry-task-btn" data-id="${task.id}" title="重试下载">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M23 4v6h-6"></path>
          <path d="M1 20v-6h6"></path>
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
        </svg>
      </button>`;
  }

  let previewHtml = '';
  if (task.preview_url) {
    previewHtml = `<img src="${task.preview_url}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 4px;">`;
  } else {
    previewHtml = `
      <div style="width: 50px; height: 50px; background-color: #f0f0f0; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: #888;">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
      </div>`;
  }

  div.innerHTML = `
    ${previewHtml}
    <div style="flex: 1;">
      <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
        <span class="task-title" style="font-weight: bold; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 250px;">${task.title}</span>
        <div style="display: flex; align-items: center; gap: 5px;">
          <span class="task-status" style="font-size: 12px; color: ${statusColors[task.status] || '#666'};">${statusText[task.status] || task.status}</span>
          ${actionButtons}
        </div>
      </div>
      <div style="font-size: 12px; color: #666; margin-bottom: 5px;">${task.filename}</div>
      <div class="progress-bar" style="width: 100%; height: 6px; background-color: #eee; border-radius: 3px; overflow: hidden;">
        <div class="progress-fill" style="width: ${task.progress}%; height: 100%; background-color: ${statusColors[task.status] || '#ccc'}; transition: width 0.3s;"></div>
      </div>
      <div style="display: flex; justify-content: space-between; font-size: 11px; color: #888; margin-top: 2px;">
        <span class="task-size">${formatBytes(task.downloaded_size)} / ${formatBytes(task.total_size)} ${task.speed ? `(${task.speed})` : ''}</span>
        <span class="task-percent">${task.progress}%</span>
      </div>
      ${task.error ? `<div style="color: #f44336; font-size: 11px; margin-top: 2px;">${task.error}</div>` : ''}
    </div>
  `;
  
  // Add event listeners for buttons
  const cancelBtn = div.querySelector('.cancel-task-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showConfirmModal('取消下载', '确定要取消这个下载任务吗？', async () => {
        try {
          await CancelDownloadTask(task.id);
          showNotification('任务已取消', 'info');
        } catch (err) {
          console.error('取消任务失败:', err);
          showError('取消失败: ' + err);
        }
      });
    });
  }

  const retryBtn = div.querySelector('.retry-task-btn');
  if (retryBtn) {
    retryBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await RetryDownloadTask(task.id);
        showNotification('任务已重试', 'success');
      } catch (err) {
        console.error('重试任务失败:', err);
        showError('重试失败: ' + err);
      }
    });
  }

  return div;
}

// 确认对话框逻辑
function showConfirmModal(title, message, onConfirm) {
  const modal = document.getElementById('confirm-modal');
  const titleEl = document.getElementById('confirm-title');
  const messageEl = document.getElementById('confirm-message');
  const okBtn = document.getElementById('confirm-ok-btn');
  const cancelBtn = document.getElementById('confirm-cancel-btn');
  const closeBtn = document.getElementById('close-confirm-modal-btn');

  titleEl.textContent = title;
  messageEl.textContent = message;
  modal.classList.remove('hidden');

  const cleanup = () => {
    modal.classList.add('hidden');
    okBtn.onclick = null;
    cancelBtn.onclick = null;
    closeBtn.onclick = null;
  };

  okBtn.onclick = () => {
    cleanup();
    onConfirm();
  };

  cancelBtn.onclick = cleanup;
  closeBtn.onclick = cleanup;
}

function updateTaskInList(task) {
  const existing = document.getElementById(`task-${task.id}`);
  if (existing) {
    // Simple update: replace content or just update specific fields
    // For simplicity, replace the whole element to ensure state consistency
    const newItem = createTaskElement(task);
    existing.replaceWith(newItem);
  } else {
    // New task, refresh list to insert in correct order
    refreshTaskList();
  }
  
  // If completed, refresh file list
  if (task.status === 'completed') {
     if (typeof refreshFilesKeepFilter === 'function') {
        refreshFilesKeepFilter();
    } else if (typeof loadFiles === 'function') {
        loadFiles();
    }
  }
}

function updateTaskProgress(task) {
  const el = document.getElementById(`task-${task.id}`);
  if (el) {
    const fill = el.querySelector('.progress-fill');
    const percentText = el.querySelector('.task-percent');
    const sizeText = el.querySelector('.task-size');
    
    if (fill) fill.style.width = `${task.progress}%`;
    if (percentText) percentText.textContent = `${task.progress}%`;
    if (sizeText) sizeText.textContent = `${formatBytes(task.downloaded_size)} / ${formatBytes(task.total_size)} ${task.speed ? `(${task.speed})` : ''}`;
  }
}

document.getElementById('clear-completed-tasks-btn').addEventListener('click', async () => {
  await ClearCompletedTasks();
});

// Helper for file size
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function handleDroppedPaths(paths) {
    if (typeof HandleFileDrop === 'function') {
        updateLoadingMessage('正在处理拖入的文件...');
        showLoadingScreen();
        
        HandleFileDrop(paths).then(() => {
            showMainScreen();
        }).catch(err => {
            showMainScreen();
            showError('处理文件失败: ' + err);
        });
    } else {
        console.error("HandleFileDrop function not found");
        showError("请重新构建应用以启用拖拽功能");
    }
}

// --- 服务器收藏功能 ---

const SERVER_CONFIG_KEY = 'vpk-manager-servers';

function getServers() {
  const servers = localStorage.getItem(SERVER_CONFIG_KEY);
  return servers ? JSON.parse(servers) : [];
}

function saveServers(servers) {
  localStorage.setItem(SERVER_CONFIG_KEY, JSON.stringify(servers));
}

function setupServerModalListeners() {
  document.getElementById('close-server-modal-btn').addEventListener('click', closeServerModal);
  document.getElementById('add-server-btn').addEventListener('click', addServer);
  
  // 全局删除按钮事件
  document.getElementById('global-delete-server-btn').addEventListener('click', (e) => {
    const dropdown = document.getElementById('global-dropdown');
    const index = parseInt(dropdown.dataset.index);
    if (!isNaN(index)) {
      deleteServer(index);
      dropdown.classList.add('hidden');
    }
  });

  // 点击模态框外部关闭
  window.addEventListener('click', (event) => {
    const modal = document.getElementById('server-modal');
    if (event.target === modal) {
      closeServerModal();
    }
    
    // 点击任意位置关闭全局下拉菜单
    if (!event.target.closest('.server-more-btn') && !event.target.closest('#global-dropdown')) {
      document.getElementById('global-dropdown').classList.add('hidden');
    }
  });
  
  // 滚动时关闭下拉菜单
  window.addEventListener('scroll', () => {
      document.getElementById('global-dropdown').classList.add('hidden');
  }, true);
}

function openServerModal() {
  const modal = document.getElementById('server-modal');
  modal.classList.remove('hidden');
  renderServers();
}

function closeServerModal() {
  const modal = document.getElementById('server-modal');
  modal.classList.add('hidden');
}

function renderServers() {
  const servers = getServers();
  const list = document.getElementById('server-list');
  list.innerHTML = '';

  servers.forEach((server, index) => {
    const li = document.createElement('li');
    li.className = 'server-item';
    li.innerHTML = `
      <div class="server-info">
        <span class="server-name">${server.name}</span>
        <span class="server-address">${server.address}</span>
      </div>
      <div class="server-actions">
        <button class="btn btn-small btn-success connect-server-btn" data-address="${server.address}">
          <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 1em; height: 1em; margin-right: 4px;">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
          </svg>
          连接
        </button>
        <button class="btn btn-small btn-outline server-more-btn" title="更多操作" data-index="${index}">
            <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="1"></circle>
                <circle cx="12" cy="5" r="1"></circle>
                <circle cx="12" cy="19" r="1"></circle>
            </svg>
        </button>
      </div>
    `;
    list.appendChild(li);
  });

  // 添加事件监听
  document.querySelectorAll('.connect-server-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const target = e.target.closest('.connect-server-btn');
      const address = target.dataset.address;
      connectServer(address);
    });
  });

  // 更多按钮点击事件
  document.querySelectorAll('.server-more-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const index = btn.dataset.index;
          const dropdown = document.getElementById('global-dropdown');
          
          // 如果已经显示且是同一个按钮触发的，则隐藏
          if (!dropdown.classList.contains('hidden') && dropdown.dataset.index === index) {
              dropdown.classList.add('hidden');
              return;
          }

          // 计算位置
          const rect = btn.getBoundingClientRect();
          dropdown.style.top = `${rect.bottom + 5}px`;
          dropdown.style.left = `${rect.right - 100}px`; // 假设宽度约100px，右对齐
          
          // 存储当前操作的索引
          dropdown.dataset.index = index;
          dropdown.classList.remove('hidden');
      });
  });
}

function addServer() {
  const nameInput = document.getElementById('server-name-input');
  const addressInput = document.getElementById('server-address-input');
  
  const name = nameInput.value.trim();
  const address = addressInput.value.trim();

  if (!name || !address) {
    alert('请输入服务器名称和地址');
    return;
  }

  const servers = getServers();
  servers.push({ name, address });
  saveServers(servers);
  
  nameInput.value = '';
  addressInput.value = '';
  
  renderServers();
}

function deleteServer(index) {
  showConfirmModal('删除服务器', '确定要删除这个服务器吗？', () => {
    const servers = getServers();
    servers.splice(index, 1);
    saveServers(servers);
    renderServers();
  });
}

function connectServer(address) {
  ConnectToServer(address).then(() => {
    // 可以添加一些提示，比如“正在启动...”
  }).catch(err => {
    console.error('连接服务器失败:', err);
    alert('连接服务器失败: ' + err);
  });
}
