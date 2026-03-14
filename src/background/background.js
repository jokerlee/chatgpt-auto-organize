/**
 * Background service worker for ChatGPT Auto Organize
 */

// Track active tabs with content scripts
const activeTabs = new Set();

// Single message handler for all messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Content script ready notification
  if (message.action === 'contentScriptReady' && sender.tab) {
    activeTabs.add(sender.tab.id);
    console.log('[AutoOrganize] Content script ready in tab:', sender.tab.id);
    return;
  }

  // Get ChatGPT tab
  if (message.action === 'getChatGPTTab') {
    chrome.tabs.query({
      url: ['https://chatgpt.com/*', 'https://chat.openai.com/*']
    }, (tabs) => {
      if (tabs.length > 0) {
        sendResponse({ success: true, tabId: tabs[0].id });
      } else {
        sendResponse({ success: false, error: 'No ChatGPT tab found' });
      }
    });
    return true;
  }

  // Relay messages to content script
  if (message.target === 'content') {
    chrome.tabs.query({
      url: ['https://chatgpt.com/*', 'https://chat.openai.com/*']
    }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, message.data)
          .then(response => {
            console.log('[AutoOrganize] Got response from content:', response);
            sendResponse(response);
          })
          .catch(err => {
            console.error('[AutoOrganize] Error sending to content:', err);
            sendResponse({ success: false, error: err.message });
          });
      } else {
        sendResponse({ success: false, error: 'No ChatGPT tab found' });
      }
    });
    return true;
  }

  // Get settings
  if (message.action === 'getSettings') {
    chrome.storage.local.get('settings', (result) => {
      sendResponse(result.settings || {
        batchSize: 50,
        customCategories: [],
        useCustomOnly: false,
        useExistingOnly: false
      });
    });
    return true;
  }

  // Save settings
  if (message.action === 'saveSettings') {
    chrome.storage.local.set({ settings: message.settings }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
});

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  activeTabs.delete(tabId);
});

console.log('[ChatGPT Auto Organize] Background service worker loaded');
