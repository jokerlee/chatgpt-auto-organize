/**
 * Api - ChatGPT API functions
 */
const Api = {
  async getAccessToken() {
    if (!Store.accessToken) {
      const response = await fetch('/api/auth/session', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        Store.accessToken = data.accessToken;
      }
    }
    return Store.accessToken;
  },

  async request(endpoint, options = {}) {
    const token = await this.getAccessToken();
    if (!token) throw new Error('No access token available');

    const response = await fetch(`/backend-api${endpoint}`, {
      ...options,
      credentials: 'include',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    if (!response.ok) throw new Error(`API Error: ${response.status}`);
    return response.json();
  },

  async getConversations(offset = 0, limit = 28) {
    return this.request(`/conversations?offset=${offset}&limit=${limit}&order=updated`);
  },

  async getAllUncategorized() {
    const allConversations = [];
    let offset = 0;
    const limit = 28;
    let hasMore = true;

    while (hasMore) {
      const data = await this.getConversations(offset, limit);
      const conversations = data.items || [];
      const uncategorized = conversations.filter(c => !c.gizmo_id || c.gizmo_id === '');
      allConversations.push(...uncategorized);
      hasMore = conversations.length === limit;
      offset += limit;
    }
    return allConversations;
  },

  async getProjects() {
    try {
      const allProjects = [];
      let cursor = null;

      while (true) {
        let url = '/gizmos/snorlax/sidebar?owned_only=true&conversations_per_gizmo=0&limit=50';
        if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

        const data = await this.request(url);
        const projects = (data.items || []).map(item => {
          const gizmo = item.gizmo?.gizmo || {};
          return {
            id: gizmo.id,
            name: gizmo.display?.name || '(Unnamed project)',
            description: gizmo.display?.description || '',
            created_at: gizmo.created_at,
            updated_at: gizmo.updated_at
          };
        }).filter(p => p.id);

        allProjects.push(...projects);
        cursor = data.cursor;
        if (!cursor || projects.length === 0) break;
      }
      return { items: allProjects };
    } catch (e) {
      console.warn('Could not fetch projects:', e);
      return { items: [] };
    }
  },

  async moveToProject(conversationId, projectId) {
    return this.request(`/conversation/${conversationId}`, {
      method: 'PATCH',
      body: JSON.stringify({ gizmo_id: projectId })
    });
  },

  async createProject(name) {
    const token = await this.getAccessToken();
    if (!token) throw new Error('No access token available');

    const response = await fetch('/backend-api/gizmos/snorlax/upsert', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        instructions: '',
        display: { name, description: '', prompt_starters: [] },
        tools: [],
        memory_scope: 'unset',
        files: [],
        training_disabled: false,
        sharing: [{
          type: 'private',
          capabilities: {
            can_read: true, can_view_config: false, can_write: false,
            can_delete: false, can_export: false, can_share: false
          }
        }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create project: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return { id: data.gizmo?.id || data.id, name };
  },

  async getConversationPreview(conversationId) {
    const conv = await this.request(`/conversation/${conversationId}`);
    const messages = [];
    if (conv.mapping) {
      for (const nodeId in conv.mapping) {
        const node = conv.mapping[nodeId];
        if (node.message?.author?.role === 'user') {
          const content = node.message.content?.parts?.join(' ') || '';
          if (content) {
            messages.push(content);
            if (messages.length >= 3) break;
          }
        }
      }
    }
    return { title: conv.title, messages };
  }
};
