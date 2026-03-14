/**
 * Store - State management for ChatGPT Auto Organize
 */
const Store = {
  accessToken: null,
  conversations: [],
  projects: [],

  taskState: {
    status: 'idle', // idle, classifying, classified, applying, done, error
    classifications: [],
    progress: 0,
    total: 0,
    message: '',
    error: null
  },

  taskCancelled: false,

  resetTaskState() {
    this.taskState = {
      status: 'idle',
      classifications: [],
      progress: 0,
      total: 0,
      message: '',
      error: null
    };
  },

  updateTaskState(updates) {
    Object.assign(this.taskState, updates);
  },

  async saveTaskState() {
    await chrome.storage.local.set({ taskState: this.taskState });
  },

  async loadTaskState() {
    const result = await chrome.storage.local.get('taskState');
    if (result.taskState) {
      Object.assign(this.taskState, result.taskState);
      // Reset interrupted tasks
      if (this.taskState.status === 'classifying' || this.taskState.status === 'applying') {
        console.log('[AutoOrganize] Resetting interrupted task');
        this.resetTaskState();
        await this.saveTaskState();
      }
    }
  }
};
