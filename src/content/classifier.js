/**
 * Classifier - ChatGPT-based classification
 */
const Classifier = {
  async classifyWithChatGPT(conversations, projects, customCategories = [], useCustomOnly = false, useExistingOnly = false) {
    console.log('[AutoOrganize] classifyWithChatGPT called with', conversations.length, 'conversations');
    const prompt = this._buildPrompt(conversations, projects, customCategories, useCustomOnly, useExistingOnly);
    console.log('[AutoOrganize] Navigating to new chat...');
    await this._navigateToNewChat();

    if (Store.taskCancelled) return null;

    console.log('[AutoOrganize] Entering prompt...');
    await this._enterPrompt(prompt);

    if (Store.taskCancelled) return null;

    console.log('[AutoOrganize] Waiting for response...');
    const response = await DomUtils.waitForResponse();

    if (!response || Store.taskCancelled) return null;

    console.log('[AutoOrganize] Got response, processing...');
    return this._processResponse(response, conversations, projects, useExistingOnly);
  },

  _buildPrompt(conversations, projects, customCategories, useCustomOnly, useExistingOnly) {
    const existingProjectsList = projects.map((p, i) => `${i + 1}. ${p.name}`).join('\n');
    const existingProjectsInline = projects.map(p => p.name).join('、');
    const customCategoriesStr = customCategories.length > 0 ? customCategories.join('、') : '';
    const conversationList = conversations.map((c, i) => `${i + 1}. ${c.title || '(Untitled)'}`).join('\n');

    let categoryInstructions;
    if (useCustomOnly && customCategories.length > 0) {
      categoryInstructions = `## Available categories (use only these):\n${customCategoriesStr}\n\nRules:\n1. Only use the categories listed above, do not create new ones\n2. If no category fits well, choose the closest one`;
    } else if (useExistingOnly && projects.length > 0) {
      categoryInstructions = `## Existing projects (must choose from these):\n${existingProjectsList}\n\nImportant rules:\n1. You must choose from the existing projects above\n2. The category output must match the project name exactly\n3. Do not create new category names\n4. If a conversation relates to multiple projects, choose the most relevant one\n5. If no project clearly matches, choose the closest one`;
    } else if (customCategories.length > 0) {
      categoryInstructions = `## Preferred categories:\n${customCategoriesStr}\n\n## Existing projects (reference):\n${existingProjectsInline || '(none)'}\n\nRules:\n1. Prefer using categories from "Preferred categories"\n2. If none fit, use existing projects or create new categories\n3. New category names should be concise (2-4 words)`;
    } else {
      categoryInstructions = `## Existing projects (reference):\n${existingProjectsInline || '(none)'}\n\nRules:\n1. Prefer using existing project names\n2. Create new categories only if none fit\n3. Category names should be concise (2-4 words)`;
    }

    return `You are a conversation classification assistant. Please assign a category to each conversation based on its title.

## Conversations to classify:
${conversationList}

${categoryInstructions}

## Output requirements:
Please output the classification results in JSON format as follows:
\`\`\`json
{
  "classifications": [
    {"conversation_index": 1, "category": "Programming", "confidence": "high"},
    {"conversation_index": 2, "category": "Learning Notes", "confidence": "medium"}
  ]
}
\`\`\`

Additional rules:
1. conversation_index starts from 1
2. confidence can be "high", "medium", or "low"
3. Similar topics should be grouped into the same category
4. Only output JSON, no other explanations

Begin classification:`;
  },

  async _navigateToNewChat() {
    const newChatBtn = document.querySelector('a[href="/"]') ||
                       document.querySelector('[data-testid="create-new-chat-button"]') ||
                       document.querySelector('nav a[href="/"]');
    if (newChatBtn) {
      newChatBtn.click();
      await DomUtils.sleep(1500);
    }
  },

  async _enterPrompt(prompt) {
    const textarea = document.querySelector('#prompt-textarea') ||
                     document.querySelector('textarea[data-id="composer-text-input"]') ||
                     document.querySelector('div[contenteditable="true"][id="prompt-textarea"]') ||
                     document.querySelector('div[contenteditable="true"]');

    if (!textarea) throw new Error('Cannot find input box. Please make sure you are on ChatGPT page');

    if (textarea.tagName === 'TEXTAREA') {
      textarea.focus();
      textarea.value = prompt;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      textarea.focus();
      textarea.innerHTML = '';
      const p = document.createElement('p');
      p.textContent = prompt;
      textarea.appendChild(p);
      textarea.dispatchEvent(new InputEvent('input', {
        bubbles: true, cancelable: true, inputType: 'insertText', data: prompt
      }));
    }

    await DomUtils.sleep(500);

    let sendButton = null;
    for (let i = 0; i < 10; i++) {
      sendButton = document.querySelector('button[data-testid="send-button"]') ||
                   document.querySelector('button[aria-label*="Send"]') ||
                   document.querySelector('button[aria-label*="Send"]') ||
                   document.querySelector('form button[type="submit"]:not([disabled])') ||
                   document.querySelector('button svg path[d*="M15.192"]')?.closest('button') ||
                   document.querySelector('button:has(svg[viewBox="0 0 24 24"])');
      if (sendButton && !sendButton.disabled) break;
      await DomUtils.sleep(300);
    }

    if (!sendButton || sendButton.disabled) {
      console.log('[AutoOrganize] Send button not found, trying Enter key');
      textarea.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
      }));
    } else {
      sendButton.click();
    }
  },

  async _processResponse(response, conversations, projects, useExistingOnly) {
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/) ||
                      response.match(/\{[\s\S]*"classifications"[\s\S]*\}/);

    if (!jsonMatch) {
      console.error('[AutoOrganize] Response:', response);
      throw new Error('Cannot parse classification results');
    }

    const jsonStr = jsonMatch[1] || jsonMatch[0];
    const result = JSON.parse(jsonStr);

    const projectMap = new Map(projects.map(p => [p.name.toLowerCase(), p]));
    const classifications = [];
    const newProjectsCache = new Map();

    for (const item of result.classifications) {
      if (!item.category) continue;

      const convIndex = item.conversation_index - 1;
      if (convIndex < 0 || convIndex >= conversations.length) continue;

      const categoryName = item.category.trim();
      const categoryLower = categoryName.toLowerCase();

      let project = projectMap.get(categoryLower) || newProjectsCache.get(categoryLower);
      let isNewProject = newProjectsCache.has(categoryLower);

      if (!project) {
        if (useExistingOnly) {
          console.log(`[AutoOrganize] Skipping "${conversations[convIndex].title}" - no matching project for "${categoryName}"`);
          continue;
        }

        try {
          console.log(`[AutoOrganize] Creating new project: ${categoryName}`);
          project = await Api.createProject(categoryName);
          newProjectsCache.set(categoryLower, project);
          isNewProject = true;
        } catch (e) {
          console.error(`[AutoOrganize] Failed to create project: ${e.message}`);
          continue;
        }
      }

      classifications.push({
        conversation: { id: conversations[convIndex].id, title: conversations[convIndex].title },
        project,
        confidence: item.confidence === 'high' ? 0.9 : item.confidence === 'medium' ? 0.7 : 0.5,
        isNewProject
      });
    }

    return classifications;
  }
};
