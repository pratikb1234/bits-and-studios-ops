// ─── Bits & Studios — Chat Panel ──────────────────────────────────────────

class ChatPanel {
  constructor(dataLayer) {
    this.data = dataLayer;
    this.el = document.getElementById('chat-panel');
    this.messagesContainer = document.getElementById('chat-messages');
    this.inputField = document.getElementById('chat-input');
    this.sendBtn = document.getElementById('chat-send');
    this.typingIndicator = document.getElementById('chat-typing');
    this.apiKeyPrompt = document.getElementById('api-key-prompt');
    this.apiKeyInput = document.getElementById('api-key-input');
    this.saveKeyBtn = document.getElementById('save-api-key');
    
    this.settings = this.data.getSettings();
    this.api = new GeminiAPI(this.settings.geminiApiKey || this.settings.anthropicApiKey || '');
    this.messages = this.data.getChatHistory();
    
    this.bindEvents();
    this.render();
  }

  bindEvents() {
    // Toggle chat panel
    document.getElementById('toggle-chat').addEventListener('click', () => {
      this.el.classList.toggle('hidden');
    });

    document.getElementById('close-chat').addEventListener('click', () => {
      this.el.classList.add('hidden');
    });
    
    // Send message
    this.sendBtn.addEventListener('click', () => this.handleSend());
    this.inputField.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
    });

    // Auto-resize textarea
    this.inputField.addEventListener('input', () => {
      this.inputField.style.height = 'auto';
      this.inputField.style.height = (this.inputField.scrollHeight) + 'px';
      this.sendBtn.disabled = this.inputField.value.trim() === '';
    });
    
    // API Key Save
    this.saveKeyBtn.addEventListener('click', () => {
       const key = this.apiKeyInput.value.trim();
       if (key) {
         this.settings.geminiApiKey = key;
         this.data.saveSettings(this.settings);
         this.api.setApiKey(key);
         this.render();
       }
    });
  }

  render() {
    const hasKey = !!(this.settings.geminiApiKey || this.settings.anthropicApiKey);
    if (!hasKey) {
      this.apiKeyPrompt.classList.remove('hidden');
      this.messagesContainer.style.display = 'none';
      this.inputField.parentElement.style.display = 'none';
    } else {
      this.apiKeyPrompt.classList.add('hidden');
      this.messagesContainer.style.display = 'flex';
      this.inputField.parentElement.style.display = 'flex';
      
      this.messagesContainer.innerHTML = '';
      if (this.messages.length === 0) {
        // Initial greeting
        this.addMessageToUI({
          role: 'assistant',
          content: 'Hi! I am Gemini, your AI advisor for Bits & Studios. I can help you brainstorm strategies, find gaps in your plan, and automatically add tasks to your mind map. What would you like to work on?'
        });
      } else {
        this.messages.forEach(msg => this.addMessageToUI(msg));
      }
      this.scrollToBottom();
    }
  }

  addMessageToUI(msg) {
    const div = document.createElement('div');
    div.className = `chat-message ${msg.role}`;
    
    const isUser = msg.role === 'user';
    
    // Parse markdown (basic)
    let htmlContent = msg.content
       .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
       .replace(/\*(.*?)\*/g, '<em>$1</em>')
       .replace(/\n/g, '<br>');
       
    let actionsHtml = '';
    if (msg.appliedActions && msg.appliedActions > 0) {
       actionsHtml = `<div class="msg-actions-badge">✨ Applied ${msg.appliedActions} changes to map</div>`;
    }

    div.innerHTML = `
      <div class="msg-avatar">${isUser ? '👤' : '🤖'}</div>
      <div class="msg-bubble">
        ${htmlContent}
        ${actionsHtml}
      </div>
    `;
    this.messagesContainer.insertBefore(div, this.typingIndicator);
  }

  scrollToBottom() {
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  async handleSend() {
    const text = this.inputField.value.trim();
    const hasKey = !!(this.settings.geminiApiKey || this.settings.anthropicApiKey);
    if (!text || !hasKey) return;

    // Clear input
    this.inputField.value = '';
    this.inputField.style.height = 'auto';
    this.sendBtn.disabled = true;

    // Add user message
    const userMsg = { role: 'user', content: text };
    this.messages.push(userMsg);
    this.addMessageToUI(userMsg);
    this.scrollToBottom();
    this.data.saveChatHistory(this.messages);

    // Show typing
    this.typingIndicator.classList.remove('hidden');
    this.scrollToBottom();

    try {
      // Prepare messages for API (exclude appliedActions meta)
      const apiMessages = this.messages.map(m => ({
        role: m.role,
        content: m.content
      }));
      
      const systemPrompt = this.api.generateSystemPrompt(this.data);
      const responseText = await this.api.sendMessage(apiMessages, systemPrompt);
      
      // Parse response
      const parsed = this.api.parseActions(responseText);
      
      let appliedActionsCount = 0;
      
      // Apply actions to mind map if any
      if (parsed.actions && Array.isArray(parsed.actions)) {
         appliedActionsCount = this.applyActions(parsed.actions);
      }
      
      // Add assistant message
      const assistantMsg = { 
         role: 'assistant', 
         content: parsed.text,
         appliedActions: appliedActionsCount
      };
      
      this.messages.push(assistantMsg);
      this.addMessageToUI(assistantMsg);
      this.data.saveChatHistory(this.messages);
      
    } catch (error) {
      window.app.showToast('AI Error: ' + error.message, 'error');
      // Add error message
      this.addMessageToUI({
        role: 'assistant',
        content: `**Error:** I couldn't process that request. (${error.message})`
      });
    } finally {
      this.typingIndicator.classList.add('hidden');
      this.scrollToBottom();
    }
  }
  
  applyActions(actions) {
    let count = 0;
    actions.forEach(act => {
       try {
         if (act.action === 'add_node') {
           this.data.addNode(act.parentId || 'root', {
              label: act.label || 'New AI Task',
              department: act.department || null,
              icon: act.icon || '✨'
           });
           count++;
         } else if (act.action === 'update_node' && act.id) {
           this.data.updateNode(act.id, act);
           count++;
         } else if (act.action === 'delete_node' && act.id) {
           this.data.deleteNode(act.id);
           count++;
         }
       } catch (e) {
         console.warn("Failed to apply AI action:", act, e);
       }
    });
    
    // Refresh mind map visualization
    if (count > 0 && window.app) {
       window.app.mindMap.render();
    }
    
    return count;
  }
}

window.ChatPanel = ChatPanel;
