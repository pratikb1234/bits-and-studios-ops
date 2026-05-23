// ─── Bits & Studios — AI Advisor with Personas ──────────────────────────────

// ── Persona Definitions ───────────────────────────────────────────────────────
const PERSONAS = {
  gemini: {
    id:          'gemini',
    name:        'Gemini',
    title:       'Strategic Advisor',
    subtitle:    'Full context · Knows everything',
    avatar:      '✨',
    gradient:    'linear-gradient(135deg, #4f46e5, #7c3aed)',
    description: 'Master strategist with full visibility into all tasks, docs, and team activity',
    personality: `You are Gemini, the master strategic advisor for Bits & Studios. You have read every document, know every task, and understand the full business context. You respond like a brilliant COO — direct, insightful, proactive, and always grounded in the actual data you have access to.

When someone asks what they should work on today, you check their assigned tasks, priority, and deadlines and give them a crisp personal daily briefing.

You are conversational but sharp. You reference specific task names, document titles, and real data — never generic advice.`,
  },

  aria: {
    id:          'aria',
    name:        'Aria',
    title:       'Marketing & Growth',
    subtitle:    'Social media · Brand · Enrollment',
    avatar:      '📣',
    gradient:    'linear-gradient(135deg, #ec4899, #f43f5e)',
    description: 'Social media strategy, brand storytelling, enrollment campaigns',
    personality: `You are Aria, a world-class marketing strategist specializing in education brands in India. You have deep expertise in:
- Instagram Reels, YouTube content strategy, WhatsApp Business automation
- Parent psychology and conversion funnels for premium education
- Community building for makerspace/STEM audiences in Tier-1 Indian cities like Ahmedabad
- Enrollment campaigns, lead generation, trial class conversions

You are creative, energetic, and data-driven. You think in content calendars, caption templates, reel scripts, and conversion rates. You always give specific, actionable ideas — not generic marketing advice.

When analyzing tasks and documents, you focus on marketing gaps, brand consistency, and growth opportunities.`,
  },

  atlas: {
    id:          'atlas',
    name:        'Atlas',
    title:       'Finance & Ops',
    subtitle:    'Pricing · ROI · Cash flow',
    avatar:      '💰',
    gradient:    'linear-gradient(135deg, #10b981, #059669)',
    description: 'Unit economics, pricing strategy, break-even, capacity planning',
    personality: `You are Atlas, a sharp financial and operations advisor for education startups in India. You specialize in:
- Unit economics for makerspace businesses (cost per student, LTV, payback period)
- Pricing strategy for Indian ed-tech and offline academies
- Cash flow management for pre-revenue operations
- Break-even analysis, cohort sizing, revenue modeling in INR
- Operational efficiency: space utilization, staff ratios, equipment ROI

You are analytical, precise, and focused on sustainable growth. You always ask: "What does the unit economics look like?" You give numbers, not vibes. You think in spreadsheets but communicate like a CFO.`,
  },

  sage: {
    id:          'sage',
    name:        'Sage',
    title:       'Curriculum Expert',
    subtitle:    'Programs · Pedagogy · Students',
    avatar:      '🎓',
    gradient:    'linear-gradient(135deg, #f59e0b, #d97706)',
    description: 'Program design, learning outcomes, age-appropriate pedagogy',
    personality: `You are Sage, a master curriculum designer and pedagogy expert specializing in STEM + maker education for children aged 6-18. You have deep knowledge of:
- Project-based learning (PBL) frameworks for robotics, AI, and coding
- Age-appropriate skill progression from block coding → Python → ML
- Arduino, Raspberry Pi, micro:bit curriculum design
- Student engagement, assessment, and portfolio-based evaluation
- Ahmedabad education market: parent expectations, school curriculum alignment, competitive landscape

You are nurturing, enthusiastic, and student-first. You think in learning outcomes, skill milestones, and "wow moments" that hook students and make parents renew. You always ask: "What will the student be able to build by the end?"`,
  },

  max: {
    id:          'max',
    name:        'Max',
    title:       'Space & Tech',
    subtitle:    'Setup · Equipment · Logistics',
    avatar:      '🏗️',
    gradient:    'linear-gradient(135deg, #6366f1, #4f46e5)',
    description: 'Physical space design, equipment procurement, safety, logistics',
    personality: `You are Max, a veteran makerspace designer and operations engineer. You specialize in:
- Physical makerspace layout: workstation design, safety zones, tool storage
- Equipment procurement: Arduino kits, Raspberry Pi, 3D printers, laser cutters, robotics kits — with Indian vendor sourcing (Robocraze, Evive, etc.)
- Safety protocols: electrical safety, soldering guidelines, supervision ratios
- Space optimization: maximizing student capacity in a given square footage
- Tech infrastructure: networking, projectors, workstation specs for coding

You are practical, detail-obsessed, and execution-focused. You think in checklists, vendor quotes, and setup timelines. You always ask: "Is this operationally feasible before June 1st?"`,
  },
};

// ── ChatPanel ─────────────────────────────────────────────────────────────────
class ChatPanel {
  constructor(dataLayer) {
    this.data      = dataLayer;
    this.el        = document.getElementById('chat-panel');
    this.msgCont   = document.getElementById('chat-messages');
    this.inputField = document.getElementById('chat-input');
    this.sendBtn   = document.getElementById('chat-send');
    this.typingIndicator = document.getElementById('chat-typing');
    this.apiKeyPrompt = document.getElementById('api-key-prompt');
    this.apiKeyInput  = document.getElementById('api-key-input');
    this.saveKeyBtn   = document.getElementById('save-api-key');

    this.api            = new GeminiAPI('');
    this.messages       = this.data.getChatHistory();
    this.currentPersona = PERSONAS.gemini;

    this.bindEvents();
    this._syncKey();
    this._renderPersonaBar();
    this.render();
  }

  // ── Key management ────────────────────────────────────────────────────────
  _syncKey() {
    const s = this.data.getSettings();
    const key = s.geminiApiKey || s.anthropicApiKey || '';
    this.api.setApiKey(key);
    return key;
  }
  get _hasKey() { return !!this._syncKey(); }

  // ── Persona bar ───────────────────────────────────────────────────────────
  _renderPersonaBar() {
    const bar = document.getElementById('chat-persona-bar');
    if (!bar) return;

    bar.innerHTML = Object.values(PERSONAS).map(p => `
      <button class="persona-chip ${p.id === this.currentPersona.id ? 'active' : ''}"
              id="persona-chip-${p.id}"
              onclick="window.app.chat.selectPersona('${p.id}')"
              title="${p.description}">
        <span class="persona-chip-avatar">${p.avatar}</span>
        <div class="persona-chip-text">
          <span class="persona-chip-name">${p.name}</span>
          <span class="persona-chip-role">${p.title}</span>
        </div>
      </button>
    `).join('');
  }

  selectPersona(id) {
    const persona = PERSONAS[id];
    if (!persona) return;

    this.currentPersona = persona;

    // Update header
    document.getElementById('chat-persona-avatar').textContent = persona.avatar;
    document.getElementById('chat-persona-name').textContent   = persona.name;
    document.getElementById('chat-persona-title').textContent  = persona.subtitle;

    // Update chip active state
    document.querySelectorAll('.persona-chip').forEach(el => el.classList.remove('active'));
    document.getElementById(`persona-chip-${id}`)?.classList.add('active');

    // Update avatar color via inline style on header
    const avatarEl = document.getElementById('chat-persona-avatar');
    avatarEl.style.background = persona.gradient;

    // Clear messages and greet with new persona voice
    this.messages = [];
    this.data.saveChatHistory([]);
    this._clearMessages();
    this._addPersonaGreeting();

    window.app?.showToast(`Switched to ${persona.name} — ${persona.title}`, 'success');
  }

  _addPersonaGreeting() {
    const p    = this.currentPersona;
    const user = localStorage.getItem('bits_collab_name') || 'there';

    const greetings = {
      gemini: `Hey ${user}! 👋 I'm Gemini, your strategic advisor for **Bits & Studios**.\n\nI have full context — all your tasks, documents, and team activity. Try asking:\n• *"What should I work on today?"*\n• *"What's missing before June 1st launch?"*\n• *"Add 5 tasks for the enrollment system"*`,
      aria:   `Hey ${user}! 📣 I'm **Aria**, your Marketing & Growth advisor.\n\nI live and breathe Instagram Reels, WhatsApp automation, and enrollment campaigns. Ask me:\n• *"Write 3 Instagram caption templates for launch week"*\n• *"What's our content calendar for the next 30 days?"*\n• *"How do we convert trial class attendees to paying students?"*`,
      atlas:  `Hello ${user}. 💰 I'm **Atlas**, your Finance & Operations advisor.\n\nI think in unit economics and break-even points. Let's talk numbers:\n• *"What should we charge per student per month?"*\n• *"When do we break even at 20 students?"*\n• *"What's the ROI on buying 10 Arduino kits?"*`,
      sage:   `Hi ${user}! 🎓 I'm **Sage**, your Curriculum & Learning Expert.\n\nEvery program I design creates a "wow moment" that hooks students for life. Ask me:\n• *"Design a 12-week Arduino curriculum for 10-year-olds"*\n• *"What projects are most impressive for parent demo day?"*\n• *"How do we structure trial class for maximum conversion?"*`,
      max:    `Hey ${user}! 🏗️ I'm **Max**, your Space & Tech Ops advisor.\n\nI turn empty rooms into world-class makerspaces. Let me help:\n• *"What equipment do we need before June 1st?"*\n• *"How should we lay out the space for 8 students?"*\n• *"What Indian vendors should we buy Arduino kits from?"*`,
    };

    this._addMsgToUI({
      role:    'assistant',
      content: greetings[p.id] || greetings.gemini,
    });
  }

  // ── Build full business context ───────────────────────────────────────────
  async _buildSystemPrompt() {
    const settings = this.data.getSettings();
    const team     = this.data.getTeam();
    const nodes    = this.data.getAllNodes();
    const allTasks = nodes.filter(n => n.id !== 'root');
    const userName = localStorage.getItem('bits_collab_name') || null;

    const done       = allTasks.filter(n => n.status === 'done').length;
    const inProgress = allTasks.filter(n => n.status === 'in_progress').length;

    // Group tasks by dept
    const byDept = {};
    allTasks.forEach(n => {
      const dept = n.department || 'general';
      if (!byDept[dept]) byDept[dept] = [];
      byDept[dept].push(n);
    });

    const taskLines = Object.entries(byDept).map(([dept, tasks]) =>
      `  [${dept.toUpperCase()}]\n` + tasks.map(t =>
        `    • ${t.label} | status: ${t.status || 'not_started'} | priority: ${t.priority || 'medium'}` +
        (t.assignees?.length ? ` | assigned: ${t.assignees.join(', ')}` : '') +
        (t.dueDate ? ` | due: ${t.dueDate}` : '') +
        (t.description ? `\n      desc: ${t.description.slice(0, 120)}` : '')
      ).join('\n')
    ).join('\n\n');

    // ID lookup table for map actions only — AI uses internally, never shows to user
    const idRef = allTasks.map(t => `${t.label} => ${t.id}`).join('\n');

    // Tasks assigned to current user
    let myTasksSection = '';
    if (userName) {
      const myTasks = allTasks.filter(t =>
        t.assignees?.some(a => a.toLowerCase().includes(userName.toLowerCase()))
      );
      if (myTasks.length) {
        myTasksSection = `\n════════════════════════════════════════════
👤 TASKS ASSIGNED TO ${userName.toUpperCase()}
════════════════════════════════════════════
${myTasks.map(t =>
  `• ${t.label} | ${t.status || 'not_started'} | ${t.priority || 'medium'} priority${t.dueDate ? ' | due: ' + t.dueDate : ''}`
).join('\n')}

When ${userName} asks "what should I work on today?", prioritize their overdue + high priority tasks above.`;
      }
    }

    // Docs
    let docs = [];
    try { docs = JSON.parse(localStorage.getItem('bits_docs') || '[]'); } catch {}
    const docLines = docs.map(d => {
      const wc = d.sections.reduce((s, sec) =>
        s + (sec.content||'').replace(/<[^>]+>/g,'').split(/\s+/).filter(Boolean).length, 0);
      return `  📄 "${d.title}" (${wc} words) — template: ${d.template}`;
    }).join('\n') || '  None yet.';

    // Recent history
    let history = [];
    try { history = JSON.parse(localStorage.getItem('bits_history')||'[]').slice(0,15); } catch {}
    const recentLines = history.map(h =>
      `  • ${h.userName || '?'}: ${h.description} (${new Date(h.timestamp).toLocaleDateString('en-IN')})`
    ).join('\n') || '  No activity yet.';

    // Meeting history from server (shared across all users — AI can reference)
    const meetingContext = await MeetingsPanel.buildJarvisContext().catch(() => '');

    return `${this.currentPersona.personality}

════════════════════════════════════════════
📊 BITS & STUDIOS — LIVE OPERATIONS CONTEXT
════════════════════════════════════════════

Company:    Bits & Studios (Pedagoging Studios LLP)
Founders:   Pratik and Anjalee
Location:   Ahmedabad, Gujarat, India
Launch:     June 1, 2026
Mission:    Premier Robotics + AI + Coding Makerspace for ages 6–18

Team: ${team.length ? team.join(', ') : 'Not configured'}
Current User: ${userName || 'Unknown'}

Task Progress: ${done}/${allTasks.length} done | ${inProgress} in progress | Completion: ${allTasks.length ? Math.round(done/allTasks.length*100) : 0}%
${myTasksSection}
════════════════════════════════════════════
📋 ALL TASKS (with IDs for map actions)
════════════════════════════════════════════
${taskLines || 'No tasks yet.'}

════════════════════════════════════════════
📄 DOCUMENTS
════════════════════════════════════════════
${docLines}

════════════════════════════════════════════
🕓 RECENT TEAM ACTIVITY
════════════════════════════════════════════
${recentLines}

════════════════════════════════════════════
🔑 NODE ID LOOKUP (use ONLY inside map_actions JSON — NEVER in your text responses)
════════════════════════════════════════════
${idRef}

════════════════════════════════════════════
🎯 RESPONSE RULES
════════════════════════════════════════════
- CRITICAL: NEVER mention node IDs (node_xxx format) in your visible responses. They are internal only.
- Always refer to tasks by their NAME (e.g. "Outside Signage", never "node_mpfwegz5_3")
- Reference specific task names, document titles, and real data from above
- When adding/updating items on the map, use <map_actions> JSON tags:
<map_actions>
[{"action": "add_node", "parentId": "PARENT_ID", "label": "Task", "department": "dept", "icon": "emoji", "priority": "high", "assignees": ["Name"]},
 {"action": "update_node", "id": "NODE_ID", "status": "done"}]
</map_actions>
- Available departments: marketing, operations, finance, curriculum, technology, community
- Be direct, specific, and actionable. No filler. No generic advice.
${meetingContext}`;
  }

  // ── Render ────────────────────────────────────────────────────────────────
  // Clear messages without destroying the typingIndicator DOM node
  _clearMessages() {
    Array.from(this.msgCont.children).forEach(child => {
      if (child !== this.typingIndicator) child.remove();
    });
    // Ensure typingIndicator is still inside msgCont
    if (!this.msgCont.contains(this.typingIndicator)) {
      this.msgCont.appendChild(this.typingIndicator);
    }
  }

  render() {
    const hasKey = this._hasKey;
    this.apiKeyPrompt?.classList.toggle('hidden', hasKey);
    this.msgCont.style.display = hasKey ? 'flex' : 'none';

    if (hasKey) {
      this._clearMessages();
      if (!this.messages.length) {
        this._addPersonaGreeting();
      } else {
        this.messages.forEach(m => this._addMsgToUI(m));
      }
    }
    this.scrollToBottom();
  }

  bindEvents() {
    document.getElementById('toggle-chat').addEventListener('click', () => {
      this.el.classList.toggle('hidden');
      if (!this.el.classList.contains('hidden')) {
        this._syncKey();
        if (!this.msgCont.children.length || this.msgCont.children.length <= 1) this.render();
      }
    });
    document.getElementById('close-chat').addEventListener('click', () => this.el.classList.add('hidden'));

    this.sendBtn.addEventListener('click', () => this.handleSend());
    this.inputField.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.handleSend(); }
    });
    this.inputField.addEventListener('input', () => {
      this.inputField.style.height = 'auto';
      this.inputField.style.height = this.inputField.scrollHeight + 'px';
      this.sendBtn.disabled = !this.inputField.value.trim();
    });

    this.saveKeyBtn?.addEventListener('click', () => {
      const key = this.apiKeyInput?.value?.trim();
      if (key) {
        const s = this.data.getSettings();
        this.data.saveSettings({ ...s, geminiApiKey: key });
        this._syncKey();
        this.render();
        window.app?.showToast('✅ Gemini API key saved', 'success');
      }
    });
  }

  // ── Send & receive ────────────────────────────────────────────────────────
  async handleSend() {
    const text = this.inputField.value.trim();
    if (!text) return;

    const key = this._syncKey();
    if (!key) {
      window.app?.showToast('Add your Gemini API key in ⚙️ Settings', 'error');
      return;
    }

    this.inputField.value = '';
    this.inputField.style.height = 'auto';
    this.sendBtn.disabled = true;

    const userMsg = { role: 'user', content: text };
    this.messages.push(userMsg);
    this._addMsgToUI(userMsg);
    this.scrollToBottom();
    this.data.saveChatHistory(this.messages);

    this.typingIndicator.classList.remove('hidden');
    this.scrollToBottom();

    try {
      // Build system prompt fresh every call (picks up latest tasks/docs/meetings)
      const systemPrompt = await this._buildSystemPrompt();

      const apiMessages = this.messages.map(m => ({ role: m.role, content: m.content }));
      const responseText = await this.api.sendMessage(apiMessages, systemPrompt);

      const parsed         = this.api.parseActions(responseText);
      const appliedActions = parsed.actions?.length ? this._applyActions(parsed.actions) : 0;

      const assistantMsg = { role: 'assistant', content: parsed.text, appliedActions };
      this.messages.push(assistantMsg);
      this._addMsgToUI(assistantMsg);
      this.data.saveChatHistory(this.messages);

      if (appliedActions > 0) window.app?.showToast(`✨ ${this.currentPersona.name} added ${appliedActions} tasks`, 'success');

    } catch (err) {
      console.error('[ChatPanel] Error:', err);
      this._addMsgToUI({
        role:    'assistant',
        content: `❌ **Error:** ${err.message}\n\nMake sure your Gemini API key (starts with **AIza...**) is correct in ⚙️ Settings.`,
      });
      window.app?.showToast('AI error: ' + err.message, 'error');
    } finally {
      this.typingIndicator.classList.add('hidden');
      this.scrollToBottom();
    }
  }

  _addMsgToUI(msg) {
    const isUser = msg.role === 'user';
    const div    = document.createElement('div');
    div.className = `chat-message ${msg.role}`;

    const html = (msg.content || '')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g,     '<em>$1</em>')
      .replace(/`([^`]+)`/g,     '<code>$1</code>')
      .replace(/\n/g,            '<br>');

    const badge = msg.appliedActions > 0
      ? `<div class="msg-actions-badge">✨ Added ${msg.appliedActions} task${msg.appliedActions>1?'s':''} to map</div>`
      : '';

    const persona = isUser ? null : this.currentPersona;

    div.innerHTML = `
      <div class="msg-avatar" ${persona ? `style="background:${persona.gradient}"` : ''}>${isUser ? '👤' : persona?.avatar || '✨'}</div>
      <div class="msg-bubble">
        ${!isUser ? `<div class="msg-persona-name">${persona?.name || 'AI'}</div>` : ''}
        ${html}${badge}
      </div>
    `;
    // Guard: re-attach typingIndicator if it was somehow removed
    if (!this.msgCont.contains(this.typingIndicator)) {
      this.msgCont.appendChild(this.typingIndicator);
    }
    this.msgCont.insertBefore(div, this.typingIndicator);
  }

  scrollToBottom() { this.msgCont.scrollTop = this.msgCont.scrollHeight; }

  _applyActions(actions) {
    let count = 0;
    actions.forEach(act => {
      try {
        if (act.action === 'add_node') {
          this.data.addNode(act.parentId || 'root', {
            label: act.label || 'New Task', department: act.department || null,
            icon: act.icon || this.currentPersona.avatar, priority: act.priority || 'medium',
            assignees: act.assignees || [],
          });
          count++;
        } else if (act.action === 'update_node' && act.id) {
          this.data.updateNode(act.id, act); count++;
        } else if (act.action === 'delete_node' && act.id) {
          this.data.deleteNode(act.id); count++;
        }
      } catch (e) { console.warn('[ChatPanel] Action failed:', act, e); }
    });
    if (count > 0 && window.app) window.app.mindMap.render();
    return count;
  }
}

window.ChatPanel = ChatPanel;
