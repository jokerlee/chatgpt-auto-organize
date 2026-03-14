/**
 * Content script entry point for ChatGPT Auto Organize
 *
 * Module load order (defined in manifest.json):
 * 1. store.js        - State management
 * 2. interceptor.js  - XHR/Fetch token capture
 * 3. dom-utils.js    - DOM utilities
 * 4. api.js          - ChatGPT API
 * 5. classifier.js   - Classification logic
 * 6. task-manager.js - Task management
 * 7. message-handler.js - Chrome messaging
 * 8. content.js      - Entry point (this file)
 */

(function() {
  'use strict';

  function init() {
    Interceptor.setup();
    MessageHandler.setup();
    Store.loadTaskState();

    console.log('[ChatGPT Auto Organize] Content script loaded');

    chrome.runtime.sendMessage({ action: 'contentScriptReady' }).catch(() => {
      // Ignore errors if background script isn't ready yet
    });
  }

  init();
})();
