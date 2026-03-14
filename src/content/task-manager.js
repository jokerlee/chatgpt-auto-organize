/**
 * TaskManager - Background task management
 */
const TaskManager = {
  async startClassification(conversations, projects, customCategories, useCustomOnly, useExistingOnly) {
    Store.taskCancelled = false;
    Store.updateTaskState({
      status: 'classifying',
      classifications: [],
      progress: 0,
      total: conversations.length,
      message: 'Classifying with ChatGPT...',
      error: null
    });
    await Store.saveTaskState();

    console.log('[AutoOrganize] Starting classification task...');
    const classifications = await Classifier.classifyWithChatGPT(
      conversations, projects, customCategories, useCustomOnly, useExistingOnly
    );

    if (Store.taskCancelled || !classifications) {
      console.log('[AutoOrganize] Task was cancelled');
      Store.resetTaskState();
      await Store.saveTaskState();
      return null;
    }

    console.log('[AutoOrganize] Classification complete, got', classifications.length, 'results');
    Store.updateTaskState({
      status: 'classified',
      classifications: classifications.map(c => ({ ...c, selected: true })),
      message: `Classification complete, ${classifications.length} results`
    });
    await Store.saveTaskState();
    return classifications;
  },

  async startApply(classifications) {
    const selected = classifications.filter(c => c.selected);
    if (selected.length === 0) return;

    Store.taskCancelled = false;
    Store.updateTaskState({
      status: 'applying',
      progress: 0,
      total: selected.length,
      message: 'Moving conversations...'
    });
    await Store.saveTaskState();

    let completed = 0;
    const movedIds = [];

    for (const cls of selected) {
      if (Store.taskCancelled) break;

      try {
        Store.updateTaskState({
          message: `Moving "${cls.conversation.title}"...`,
          progress: completed
        });
        await Store.saveTaskState();

        await Api.moveToProject(cls.conversation.id, cls.project.id);
        movedIds.push(cls.conversation.id);
        completed++;
        await DomUtils.sleep(300);
      } catch (error) {
        console.error(`Failed to move conversation ${cls.conversation.id}:`, error);
      }
    }

    // Update cache
    if (movedIds.length > 0) {
      await this._updateCache(movedIds);
    }

    if (Store.taskCancelled) {
      Store.updateTaskState({ message: `Cancelled, moved ${completed} conversations`, progress: completed });
    } else {
      Store.updateTaskState({ status: 'done', message: `Done! Moved ${completed} conversations`, progress: completed });
    }
    await Store.saveTaskState();

    // Auto-reset
    if (!Store.taskCancelled) {
      setTimeout(async () => {
        Store.resetTaskState();
        await Store.saveTaskState();
      }, 5000);
    }
  },

  async _updateCache(movedIds) {
    try {
      const result = await chrome.storage.local.get('chatgpt_organize_cache');
      const cache = result.chatgpt_organize_cache;
      if (cache?.conversations) {
        cache.conversations = cache.conversations.filter(c => !movedIds.includes(c.id));
        await chrome.storage.local.set({ chatgpt_organize_cache: cache });
        console.log(`[AutoOrganize] Removed ${movedIds.length} conversations from cache`);
      }
    } catch (e) {
      console.error('[AutoOrganize] Failed to update cache:', e);
    }
  },

  cancel() {
    Store.taskCancelled = true;
    Store.resetTaskState();
  }
};
