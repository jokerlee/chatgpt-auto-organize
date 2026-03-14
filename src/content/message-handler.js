/**
 * MessageHandler - Chrome extension messaging
 */
const MessageHandler = {
  setup() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this._handleRequest(request).then(sendResponse);
      return true;
    });
  },

  async _handleRequest(request) {
    try {
      switch (request.action) {
        case 'ping':
          return { success: true, message: 'Content script ready' };

        case 'getAccessToken':
          return { success: true, token: await Api.getAccessToken() };

        case 'getConversations':
          return { success: true, data: await Api.getConversations(request.offset || 0, request.limit || 28) };

        case 'getAllUncategorized':
          return { success: true, conversations: await Api.getAllUncategorized() };

        case 'getProjects':
          const projects = await Api.getProjects();
          return { success: true, projects: projects.items || projects };

        case 'moveToProject':
          await Api.moveToProject(request.conversationId, request.projectId);
          return { success: true };

        case 'classifyWithChatGPT':
          const classifications = await Classifier.classifyWithChatGPT(
            request.conversations, request.projects, request.customCategories || [], request.useCustomOnly || false
          );
          return { success: true, classifications };

        case 'getConversationPreview':
          return { success: true, ...(await Api.getConversationPreview(request.conversationId)) };

        case 'startClassificationTask':
          TaskManager.startClassification(
            request.conversations, request.projects, request.customCategories || [],
            request.useCustomOnly || false, request.useExistingOnly || false
          ).catch(e => console.error('[AutoOrganize] Classification task error:', e));
          return { success: true, message: 'Task started' };

        case 'startApplyTask':
          TaskManager.startApply(request.classifications)
            .catch(e => console.error('[AutoOrganize] Apply task error:', e));
          return { success: true, message: 'Task started' };

        case 'getTaskState':
          return { success: true, taskState: Store.taskState };

        case 'updateClassificationSelection':
          if (Store.taskState.classifications && request.index >= 0) {
            Store.taskState.classifications[request.index].selected = request.selected;
            await Store.saveTaskState();
          }
          return { success: true };

        case 'cancelTask':
          TaskManager.cancel();
          await Store.saveTaskState();
          return { success: true };

        case 'resetTask':
          Store.resetTaskState();
          await Store.saveTaskState();
          return { success: true };

        default:
          return { success: false, error: 'Unknown action' };
      }
    } catch (error) {
      console.error('Content script error:', error);
      return { success: false, error: error.message };
    }
  }
};
