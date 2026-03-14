/**
 * Popup script for ChatGPT Auto Organize
 * Uses ChatGPT itself to classify conversations
 */

// DOM Elements
const elements = {
  statusBar: document.getElementById('status-bar'),
  statusText: document.getElementById('status-text'),
  notOnChatGPT: document.getElementById('not-on-chatgpt'),
  mainContent: document.getElementById('main-content'),
  settingsPanel: document.getElementById('settings-panel'),
  statsSection: document.getElementById('stats-section'),
  infoSection: document.getElementById('info-section'),
  actionsSection: document.getElementById('actions-section'),
  uncategorizedCount: document.getElementById('uncategorized-count'),
  projectsCount: document.getElementById('projects-counts'),
  btnScan: document.getElementById('btn-scan'),
  btnRefresh: document.getElementById('btn-refresh'),
  btnSettings: document.getElementById('btn-settings'),
  previewSection: document.getElementById('preview-section'),
  previewList: document.getElementById('preview-list'),
  btnApply: document.getElementById('btn-apply'),
  btnCancel: document.getElementById('btn-cancel'),
  progressSection: document.getElementById('progress-section'),
  progressFill: document.getElementById('progress-fill'),
  progressText: document.getElementById('progress-text'),
  btnCancelTask: document.getElementById('btn-cancel-task'),
  batchSize: document.getElementById('batch-size'),
  btnSaveSettings: document.getElementById('btn-save-settings'),
  btnBack: document.getElementById('btn-back')
};

// State
let state = {
  conversations: [],
  projects: [],
  classifications: [],
  settings: {
    batchSize: 50,
    customCategories: [],
    useCustomOnly: false,
    useExistingOnly: false
  }
};

// Polling interval for task state
let pollInterval = null;

// Cache keys
const CACHE_KEY = 'chatgpt_organize_cache';

// Utility functions
function showStatus(message, type = 'loading') {
  elements.statusBar.className = `status-bar ${type}`;
  elements.statusText.textContent = message;
  elements.statusBar.classList.remove('hidden');
}

function hideStatus() {
  elements.statusBar.classList.add('hidden');
}

// Disable/enable all interactive elements
function setUIEnabled(enabled) {
  elements.btnScan.disabled = !enabled;
  if (elements.btnRefresh) elements.btnRefresh.disabled = !enabled;
  elements.btnSettings.disabled = !enabled;
}

function showError(message) {
  showStatus(message, 'error');
  setTimeout(hideStatus, 5000);
}

function showSuccess(message) {
  showStatus(message, 'success');
  setTimeout(hideStatus, 3000);
}

// Send message to content script via background
async function sendToContent(action, data = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { target: 'content', data: { action, ...data } },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (!response || !response.success) {
          reject(new Error(response?.error || 'Unknown error'));
        } else {
          resolve(response);
        }
      }
    );
  });
}

// Check if we're on a ChatGPT tab
async function checkChatGPTTab() {
  try {
    const response = await sendToContent('ping');
    return response.success;
  } catch {
    return false;
  }
}

// Cache functions
async function getCache() {
  return new Promise((resolve) => {
    chrome.storage.local.get(CACHE_KEY, (result) => {
      resolve(result[CACHE_KEY] || null);
    });
  });
}

async function setCache(data) {
  const cache = {
    conversations: data.conversations,
    projects: data.projects,
    latestConvId: data.conversations.length > 0 ? data.conversations[0].id : null
  };
  return new Promise((resolve) => {
    chrome.storage.local.set({ [CACHE_KEY]: cache }, resolve);
  });
}

// Load data from ChatGPT with incremental sync
async function loadData(forceRefresh = false) {
  setUIEnabled(false);
  const cache = await getCache();

  // If force refresh or no cache, do full load
  if (forceRefresh || !cache) {
    return await fullLoad();
  }

  // Check if we need to sync by fetching first page
  showStatus('Checking for new conversations...');

  try {
    const firstPageResponse = await sendToContent('getConversations', { offset: 0, limit: 28 });
    const firstPageItems = firstPageResponse.data?.items || [];
    const firstPageConvs = firstPageItems.filter(c => !c.gizmo_id || c.gizmo_id === '');

    // Also check projects
    const projResponse = await sendToContent('getProjects');
    const newProjects = projResponse.projects || [];

    if (firstPageConvs.length === 0 && firstPageItems.length < 28) {
      // No uncategorized conversations and not a full page
      state.conversations = [];
      state.projects = newProjects;
      await setCache({ conversations: [], projects: newProjects });
      updateUI();
      hideStatus();
      setUIEnabled(true);
      return true;
    }

    const latestId = firstPageConvs.length > 0 ? firstPageConvs[0].id : null;
    const cachedLatestId = cache.latestConvId;

    // Quick check: if latest ID matches and first page uncategorized count is similar, use cache directly
    if (latestId && latestId === cachedLatestId) {
      // Check if first page items haven't changed much
      const cachedFirstPageIds = new Set(cache.conversations.slice(0, 28).map(c => c.id));
      const currentFirstPageIds = firstPageConvs.map(c => c.id);
      const matchCount = currentFirstPageIds.filter(id => cachedFirstPageIds.has(id)).length;

      // If most of the first page matches cache, use cache directly
      if (matchCount >= currentFirstPageIds.length * 0.8) {
        console.log('[AutoOrganize] Cache hit, using cached data directly');
        state.conversations = cache.conversations;
        state.projects = newProjects;
        // Update projects in cache if changed
        if (JSON.stringify(newProjects) !== JSON.stringify(cache.projects)) {
          await setCache({ conversations: cache.conversations, projects: newProjects });
        }
        updateUI();
        hideStatus();
        setUIEnabled(true);
        return true;
      }
    }

    // Build cache lookup: id -> isUncategorized
    const cacheStatusMap = new Map();
    for (const c of cache.conversations) {
      cacheStatusMap.set(c.id, true); // all cached are uncategorized
    }

    // Track categorized IDs from API (from first page)
    const apiCategorizedIds = new Set(
      firstPageItems.filter(c => c.gizmo_id && c.gizmo_id !== '').map(c => c.id)
    );

    // Find where cached data starts and merge (must match both id AND uncategorized status)
    console.log('[AutoOrganize] Syncing conversations...');
    showStatus('Fetching new conversations...');

    const newConversations = [];
    let foundMatchingCached = false;
    let offset = 0;
    const limit = 28;
    let totalFetched = firstPageItems.length;

    // First, add conversations from first page
    for (const conv of firstPageConvs) {
      // Stop if we find a cached conversation with same uncategorized status
      if (cacheStatusMap.has(conv.id) && !apiCategorizedIds.has(conv.id)) {
        foundMatchingCached = true;
        break;
      }
      newConversations.push(conv);
    }

    // Keep fetching until we find a matching cached conversation
    while (!foundMatchingCached) {
      offset += limit;
      showStatus(`Fetching conversations (${totalFetched} found)...`);

      const response = await sendToContent('getConversations', { offset, limit });
      const items = response.data?.items || [];

      if (items.length === 0) break;

      totalFetched += items.length;

      // Track categorized ones
      items.filter(c => c.gizmo_id && c.gizmo_id !== '').forEach(c => apiCategorizedIds.add(c.id));

      const convs = items.filter(c => !c.gizmo_id || c.gizmo_id === '');

      for (const conv of convs) {
        // Stop if we find a cached conversation with same uncategorized status
        if (cacheStatusMap.has(conv.id) && !apiCategorizedIds.has(conv.id)) {
          foundMatchingCached = true;
          break;
        }
        newConversations.push(conv);
      }
    }

    // Merge: new conversations + remaining cached conversations (that are still uncategorized)
    let mergedConversations;
    if (foundMatchingCached) {
      const newIds = new Set(newConversations.map(c => c.id));
      const remainingCached = cache.conversations.filter(c =>
        !newIds.has(c.id) && !apiCategorizedIds.has(c.id)
      );
      mergedConversations = [...newConversations, ...remainingCached];
    } else {
      // Couldn't find matching cached, use all fetched
      mergedConversations = newConversations;
    }

    state.conversations = mergedConversations;
    state.projects = newProjects;
    await setCache({ conversations: mergedConversations, projects: newProjects });
    updateUI();
    hideStatus();
    setUIEnabled(true);
    console.log(`[AutoOrganize] Synced, ${mergedConversations.length} uncategorized`);
    return true;

  } catch (error) {
    showError(`Load failed: ${error.message}`);
    setUIEnabled(true);
    return false;
  }
}

// Full load (no cache or force refresh)
async function fullLoad() {
  setUIEnabled(false);
  showStatus('Loading conversations...');

  try {
    // Fetch all uncategorized conversations with progress
    const allConversations = [];
    let offset = 0;
    const limit = 28;
    let hasMore = true;

    while (hasMore) {
      showStatus(`Loading conversations (${allConversations.length} found)...`);
      const response = await sendToContent('getConversations', { offset, limit });
      const items = response.data?.items || [];

      // Filter uncategorized
      const uncategorized = items.filter(c => !c.gizmo_id || c.gizmo_id === '');
      allConversations.push(...uncategorized);

      hasMore = items.length === limit;
      offset += limit;
    }

    showStatus('Loading projects...');
    const projResponse = await sendToContent('getProjects');
    const newProjects = projResponse.projects || [];

    state.conversations = allConversations;
    state.projects = newProjects;

    await setCache({ conversations: allConversations, projects: newProjects });
    updateUI();
    hideStatus();
    setUIEnabled(true);
    return true;
  } catch (error) {
    showError(`Load failed: ${error.message}`);
    setUIEnabled(true);
    return false;
  }
}

function updateUI() {
  elements.uncategorizedCount.textContent = state.conversations.length;
  elements.projectsCount.textContent = state.projects.length;
}

// Scan and classify conversations using ChatGPT
async function scanAndClassify() {
  if (state.conversations.length === 0) {
    showStatus('No uncategorized conversations', 'success');
    setTimeout(hideStatus, 3000);
    return;
  }

  if (state.projects.length === 0 && state.settings.customCategories.length === 0) {
    showError('No projects found. Please create a project in ChatGPT or add custom categories');
    return;
  }

  // Limit to batch size
  const batchSize = state.settings.batchSize;
  const conversationsToClassify = state.conversations.slice(0, batchSize);

  showStatus(`Classifying ${conversationsToClassify.length} conversations with ChatGPT...`);

  try {
    // Start task (runs independently in content script)
    await sendToContent('startClassificationTask', {
      conversations: conversationsToClassify,
      projects: state.projects,
      customCategories: state.settings.customCategories,
      useCustomOnly: state.settings.useCustomOnly,
      useExistingOnly: state.settings.useExistingOnly
    });

    // Start polling for task state
    startPolling();

  } catch (error) {
    showError(`Classification failed: ${error.message}`);
  }
}

// Start polling for task state
function startPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
  }

  pollInterval = setInterval(async () => {
    try {
      const response = await sendToContent('getTaskState');
      if (response.success && response.taskState) {
        handleTaskState(response.taskState);
      }
    } catch (e) {
      console.error('[AutoOrganize] Polling error:', e);
    }
  }, 1000);
}

// Stop polling
function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

// Show/hide main control sections
function setMainSectionsVisible(visible) {
  if (visible) {
    elements.statsSection.classList.remove('hidden');
    elements.infoSection.classList.remove('hidden');
    elements.actionsSection.classList.remove('hidden');
  } else {
    elements.statsSection.classList.add('hidden');
    elements.infoSection.classList.add('hidden');
    elements.actionsSection.classList.add('hidden');
  }
}

// Handle task state updates
function handleTaskState(taskState) {
  switch (taskState.status) {
    case 'idle':
      hideStatus();
      elements.previewSection.classList.add('hidden');
      elements.progressSection.classList.add('hidden');
      setMainSectionsVisible(true);
      setUIEnabled(true);
      stopPolling();
      break;

    case 'classifying':
      setUIEnabled(false);
      setMainSectionsVisible(false);
      showStatus(taskState.message || 'Asking ChatGPT to classify...');
      elements.progressSection.classList.remove('hidden');
      elements.progressText.textContent = taskState.message || 'Asking ChatGPT to classify...';
      elements.progressFill.style.width = '0%';
      break;

    case 'classified':
      hideStatus();
      elements.progressSection.classList.add('hidden');
      setMainSectionsVisible(false);
      setUIEnabled(true);
      state.classifications = taskState.classifications || [];
      if (state.classifications.length === 0) {
        setMainSectionsVisible(true);
        showStatus('No matching categories found', 'success');
        setTimeout(hideStatus, 5000);
        stopPolling();
      } else {
        renderPreview();
        elements.previewSection.classList.remove('hidden');
        stopPolling();
      }
      break;

    case 'applying':
      setUIEnabled(false);
      setMainSectionsVisible(false);
      elements.previewSection.classList.add('hidden');
      elements.progressSection.classList.remove('hidden');
      if (taskState.total > 0) {
        elements.progressFill.style.width = `${(taskState.progress / taskState.total) * 100}%`;
        elements.progressText.textContent = `Moving conversations (${taskState.progress}/${taskState.total})...`;
      } else {
        elements.progressText.textContent = taskState.message || 'Organizing...';
      }
      break;

    case 'done':
      elements.progressFill.style.width = '100%';
      elements.progressText.textContent = `Done! Moved ${taskState.progress}/${taskState.total} conversations`;
      setTimeout(() => {
        elements.progressSection.classList.add('hidden');
        setMainSectionsVisible(true);
        loadData(); // Reload data to update counts
        stopPolling();
      }, 2000);
      break;

    case 'error':
      setUIEnabled(true);
      setMainSectionsVisible(true);
      elements.progressSection.classList.add('hidden');
      showError(taskState.message || 'Something went wrong');
      stopPolling();
      break;
  }
}

// Render classification preview
function renderPreview() {
  elements.previewList.innerHTML = '';

  for (let i = 0; i < state.classifications.length; i++) {
    const cls = state.classifications[i];
    const confidenceLabel = cls.confidence >= 0.9 ? 'High' :
                            cls.confidence >= 0.7 ? 'Med' : 'Low';
    const confidenceClass = cls.confidence >= 0.9 ? 'high' :
                            cls.confidence >= 0.7 ? 'medium' : 'low';

    const projectClass = cls.isNewProject ? 'preview-project new' : 'preview-project';
    const newBadge = cls.isNewProject ? '<span class="new-badge">New</span>' : '';

    const item = document.createElement('div');
    item.className = 'preview-item';
    item.innerHTML = `
      <input type="checkbox" ${cls.selected ? 'checked' : ''} data-index="${i}">
      <span class="preview-conversation" title="${cls.conversation.title}">
        ${cls.conversation.title || '(Untitled)'}
      </span>
      <span class="preview-arrow">→</span>
      <span class="${projectClass}" title="${cls.project.name}">
        ${cls.project.name}${newBadge}
      </span>
      <span class="preview-confidence ${confidenceClass}">${confidenceLabel}</span>
    `;
    elements.previewList.appendChild(item);
  }

  // Add checkbox listeners
  elements.previewList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', async (e) => {
      const index = parseInt(e.target.dataset.index);
      state.classifications[index].selected = e.target.checked;
      updateApplyButton();
      // Sync with content script
      try {
        await sendToContent('updateClassificationSelection', {
          index: index,
          selected: e.target.checked
        });
      } catch (err) {
        console.error('[AutoOrganize] Failed to sync selection:', err);
      }
    });
  });

  updateApplyButton();
}

function updateApplyButton() {
  const selectedCount = state.classifications.filter(c => c.selected).length;
  elements.btnApply.disabled = selectedCount === 0;
  elements.btnApply.textContent = `Apply Changes (${selectedCount})`;
}

// Apply classifications
async function applyClassifications() {
  const selected = state.classifications.filter(c => c.selected);
  if (selected.length === 0) return;

  elements.previewSection.classList.add('hidden');
  elements.progressSection.classList.remove('hidden');
  elements.progressText.textContent = 'Moving conversations...';
  elements.progressFill.style.width = '0%';

  try {
    // Start apply task (runs independently in content script)
    await sendToContent('startApplyTask', {
      classifications: selected
    });

    // Start polling for task state
    startPolling();

  } catch (error) {
    showError(`Move failed: ${error.message}`);
    elements.progressSection.classList.add('hidden');
  }
}

// Settings functions
async function loadSettings() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
      if (response) {
        state.settings = { ...state.settings, ...response };
      }
      resolve();
    });
  });
}

async function saveSettings() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action: 'saveSettings', settings: state.settings },
      resolve
    );
  });
}

function showSettings() {
  elements.mainContent.classList.add('hidden');
  elements.settingsPanel.classList.remove('hidden');

  // Populate settings UI
  if (elements.batchSize) {
    elements.batchSize.value = state.settings.batchSize;
  }

  // Populate custom categories
  renderCustomCategories();

  // Set checkbox state
  const useCustomOnly = document.getElementById('use-custom-only');
  if (useCustomOnly) {
    useCustomOnly.checked = state.settings.useCustomOnly;
  }

  const useExistingOnly = document.getElementById('use-existing-only');
  if (useExistingOnly) {
    useExistingOnly.checked = state.settings.useExistingOnly;
  }
}

function renderCustomCategories() {
  const container = document.getElementById('custom-categories');
  if (!container) return;

  container.innerHTML = '';
  for (const category of state.settings.customCategories) {
    const tag = document.createElement('span');
    tag.className = 'category-tag';
    tag.innerHTML = `
      ${category}
      <button class="remove-btn" data-category="${category}">×</button>
    `;
    container.appendChild(tag);
  }

  // Add remove listeners
  container.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.category;
      state.settings.customCategories = state.settings.customCategories.filter(c => c !== cat);
      renderCustomCategories();
    });
  });
}

function addCategory() {
  const input = document.getElementById('new-category-input');
  if (!input) return;

  const value = input.value.trim();
  if (value && !state.settings.customCategories.includes(value)) {
    state.settings.customCategories.push(value);
    renderCustomCategories();
    input.value = '';
  }
}

function hideSettings() {
  elements.settingsPanel.classList.add('hidden');
  elements.mainContent.classList.remove('hidden');
}

// Event listeners
elements.btnScan.addEventListener('click', async () => {
  elements.btnScan.disabled = true;
  await scanAndClassify();
  elements.btnScan.disabled = false;
});

if (elements.btnRefresh) {
  elements.btnRefresh.addEventListener('click', async () => {
    elements.btnRefresh.disabled = true;
    await loadData(true); // Force refresh
    showSuccess('Refreshed');
    elements.btnRefresh.disabled = false;
  });
}

elements.btnSettings.addEventListener('click', showSettings);

elements.btnApply.addEventListener('click', applyClassifications);

elements.btnCancel.addEventListener('click', async () => {
  elements.previewSection.classList.add('hidden');
  setMainSectionsVisible(true);
  state.classifications = [];
  // Reset task state in content script
  try {
    await sendToContent('resetTask');
  } catch (e) {
    console.log('[AutoOrganize] Could not reset task:', e);
  }
});

// Cancel running task button
if (elements.btnCancelTask) {
  elements.btnCancelTask.addEventListener('click', async () => {
    try {
      await sendToContent('cancelTask');
      stopPolling();
      elements.progressSection.classList.add('hidden');
      setMainSectionsVisible(true);
      hideStatus();
      setUIEnabled(true);
      showSuccess('Task cancelled');
    } catch (e) {
      console.log('[AutoOrganize] Could not cancel task:', e);
    }
  });
}

if (elements.btnSaveSettings) {
  elements.btnSaveSettings.addEventListener('click', async () => {
    if (elements.batchSize) {
      state.settings.batchSize = parseInt(elements.batchSize.value) || 20;
    }
    const useCustomOnly = document.getElementById('use-custom-only');
    if (useCustomOnly) {
      state.settings.useCustomOnly = useCustomOnly.checked;
    }
    const useExistingOnly = document.getElementById('use-existing-only');
    if (useExistingOnly) {
      state.settings.useExistingOnly = useExistingOnly.checked;
    }
    await saveSettings();
    showSuccess('Settings saved');
    hideSettings();
  });
}

// Add category button
const btnAddCategory = document.getElementById('btn-add-category');
if (btnAddCategory) {
  btnAddCategory.addEventListener('click', addCategory);
}

// Add category on Enter key
const newCategoryInput = document.getElementById('new-category-input');
if (newCategoryInput) {
  newCategoryInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCategory();
    }
  });
}

if (elements.btnBack) {
  elements.btnBack.addEventListener('click', hideSettings);
}

// Initialize
async function init() {
  await loadSettings();

  const isOnChatGPT = await checkChatGPTTab();

  if (!isOnChatGPT) {
    elements.notOnChatGPT.classList.remove('hidden');
    return;
  }

  elements.mainContent.classList.remove('hidden');

  // Check if there's a running task first
  try {
    const response = await sendToContent('getTaskState');
    if (response.success && response.taskState) {
      const taskState = response.taskState;
      if (taskState.status !== 'idle') {
        // Show task progress immediately, disable scan button
        elements.btnScan.disabled = true;
        handleTaskState(taskState);
        if (taskState.status === 'classifying' || taskState.status === 'applying') {
          startPolling();
        }
        // Load data in background
        loadData().then(() => {
          elements.btnScan.disabled = false;
        });
        return;
      }
    }
  } catch (e) {
    console.log('[AutoOrganize] Could not get task state:', e);
  }

  // No running task, load data normally
  await loadData();
}

init();
