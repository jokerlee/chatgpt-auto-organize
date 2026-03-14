/**
 * DomUtils - DOM manipulation utilities
 */
const DomUtils = {
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  _tryParseClassifications(content) {
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ||
                      content.match(/\{[\s\S]*"classifications"[\s\S]*\}/);
    if (!jsonMatch) return null;

    try {
      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const parsed = JSON.parse(jsonStr);
      if (parsed.classifications && Array.isArray(parsed.classifications)) {
        return parsed;
      }
    } catch (e) {
      // JSON parse failed
    }
    return null;
  },

  getLastAssistantMessage() {
    const selectors = [
      '[data-message-author-role="assistant"]',
      '.agent-turn .markdown',
      '.assistant-message',
      '[data-testid="conversation-turn"]:last-child .markdown',
      '.group\\/conversation-turn:last-child .markdown',
      'article[data-testid^="conversation-turn"] .markdown',
      '[class*="agent-turn"] .markdown',
      'div[data-message-author-role="assistant"] .markdown'
    ];

    for (const selector of selectors) {
      try {
        const messages = document.querySelectorAll(selector);
        if (messages.length > 0) {
          const lastMessage = messages[messages.length - 1];
          const text = lastMessage.textContent || lastMessage.innerText || '';
          if (text.trim()) {
            console.log(`[AutoOrganize] Found message with selector: ${selector}`);
            return text;
          }
        }
      } catch (e) {
        // Ignore invalid selectors
      }
    }

    // Fallback
    const markdownBlocks = document.querySelectorAll('.markdown.prose, .prose.markdown, [class*="markdown"]');
    if (markdownBlocks.length > 0) {
      const lastBlock = markdownBlocks[markdownBlocks.length - 1];
      const text = lastBlock.textContent || '';
      if (text.trim()) {
        console.log('[AutoOrganize] Found message with fallback markdown selector');
        return text;
      }
    }
    return '';
  },

  async waitForResponse(timeout = 120000) {
    const startTime = Date.now();
    console.log('[AutoOrganize] Waiting for response to start...');
    await this.sleep(3000);

    let lastContent = '';
    let stableCount = 0;
    let iteration = 0;

    while (Date.now() - startTime < timeout) {
      // Check if cancelled
      if (Store.taskCancelled) {
        console.log('[AutoOrganize] Task cancelled, stopping wait');
        return null;
      }

      iteration++;
      const currentContent = this.getLastAssistantMessage();

      if (iteration % 5 === 0) {
        console.log(`[AutoOrganize] Iteration ${iteration}: contentLen=${currentContent.length}, stableCount=${stableCount}`);
      }

      // Content empty or too short, keep waiting
      if (!currentContent || currentContent.length <= 10) {
        await this.sleep(1000);
        continue;
      }

      // Content changed, reset count
      if (currentContent !== lastContent) {
        stableCount = 0;
        lastContent = currentContent;
        await this.sleep(1000);
        continue;
      }

      // Content stable, try parsing JSON
      const parsed = this._tryParseClassifications(currentContent);
      if (!parsed) {
        stableCount = 0;
        await this.sleep(1000);
        continue;
      }

      // JSON valid, increment stable count
      stableCount++;
      if (stableCount >= 2) {
        console.log('[AutoOrganize] Response complete with valid JSON, length:', currentContent.length);
        return currentContent;
      }

      await this.sleep(1000);
    }

    const finalContent = this.getLastAssistantMessage();
    console.log('[AutoOrganize] Timeout reached. Final content length:', finalContent?.length || 0);
    if (finalContent) {
      console.log('[AutoOrganize] Returning timeout content');
      return finalContent;
    }
    throw new Error('Response timeout');
  }
};
