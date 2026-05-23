// ─── Bits & Studios — Co-Jarvis: AI Advisor powered by Gemini ───────────────

// ── Persona Definitions ───────────────────────────────────────────────────────
const PERSONAS = {
  gemini: {
    id:          'gemini',
    name:        'Jarvis',
    title:       'Strategic Advisor',
    subtitle:    'Full context · Knows everything',
    avatar:      '✨',
    gradient:    'linear-gradient(135deg, #4f46e5, #7c3aed)',
    description: 'Master strategist with full visibility into all tasks, docs, and team activity',
    personality: `You are Jarvis (Co-Jarvis), the master strategic advisor for Bits & Studios. You have read every document, know every task, and understand the full business context. You respond like a brilliant COO — direct, insightful, proactive, and always grounded in the actual data you have access to.

You can also take actions on the mind map: set deadlines, update task statuses, add tasks, mark things complete. When the user asks you to set a deadline or if no deadline exists for a task they mention, SET IT using map_actions.

If a user asks about a completed task, you still have full context on it — don't say you don't know.

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
    this._orgKeyReady   = false;

    this.bindEvents();
    this._renderPersonaBar();

    // Fetch org key async — render after resolved, not during constructor
    this._checkOrgKey().then(() => this.render());
  }

  // ── Key management ────────────────────────────────────────────────────────
  // Checks org-level key from server (admin sets once, all users benefit)
  async _checkOrgKey() {
    try {
      const r = await fetch('/api/check-key');
      const { hasKey, key } = await r.json();
      if (hasKey && key) {
        this.api.setApiKey(key);
        this._orgKeyReady = true;
        return true;
      }
    } catch {}
    // Fallback to local settings (admin-only legacy path)
    const s = this.data.getSettings();
    const localKey = s.geminiApiKey || s.anthropicApiKey || '';
    if (localKey) {
      this.api.setApiKey(localKey);
      this._orgKeyReady = true;
      return true;
    }
    this._orgKeyReady = false;
    return false;
  }

  _syncKey() {
    // Return cached state synchronously (populated by _checkOrgKey)
    if (this._orgKeyReady) return 'org_key_set'; // truthy sentinel
    // Try local as fallback
    const s = this.data.getSettings();
    const key = s.geminiApiKey || s.anthropicApiKey || '';
    if (key) this.api.setApiKey(key);
    return key;
  }
  get _hasKey() { return this._orgKeyReady || !!this._syncKey(); }

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
    const user = window.Auth?.currentUser?.name || localStorage.getItem('bits_collab_name') || 'there';

    const greetings = {
      gemini: `Hey ${user}! ✨ I'm **Jarvis**, your strategic advisor for **Bits & Studios**.\n\nI have full context — all your tasks, documents, and team activity. I can also set deadlines, update statuses, and add tasks directly from our conversation. Try:\n• *"What should I work on today?"*\n• *"Set a deadline for Outside Signage to June 5th"*\n• *"What's missing before June 1st launch?"*`,
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
  _buildSystemPrompt() {
    const settings = this.data.getSettings();
    const team     = this.data.getTeam();
    const nodes    = this.data.getAllNodes();
    const allTasks = nodes.filter(n => n.id !== 'root');
    const userName = window.Auth?.currentUser?.name || localStorage.getItem('bits_collab_name') || null;

    // Separate active vs completed tasks
    const DONE_STATUSES = new Set(['done', 'completed', 'cancelled']);
    const activeTasks    = allTasks.filter(n => !DONE_STATUSES.has(n.status));
    const completedTasks = allTasks.filter(n => DONE_STATUSES.has(n.status));
    const inProgress     = allTasks.filter(n => n.status === 'in_progress').length;

    const _taskLine = t =>
      `    • [${t.status || 'not_started'}] ${t.label}` +
      ` | priority: ${t.priority || 'medium'}` +
      (t.assignees?.length ? ` | assigned: ${t.assignees.join(', ')}` : '') +
      (t.dueDate ? ` | due: ${t.dueDate}` : ' | NO DEADLINE') +
      (t.description ? `\n      desc: ${t.description.slice(0, 100)}` : '');

    // Group active tasks by dept
    const byDept = {};
    activeTasks.forEach(n => {
      const dept = n.department || 'general';
      if (!byDept[dept]) byDept[dept] = [];
      byDept[dept].push(n);
    });
    const taskLines = Object.entries(byDept).map(([dept, tasks]) =>
      `  [${dept.toUpperCase()}]\n` + tasks.map(_taskLine).join('\n')
    ).join('\n\n');

    // Completed tasks section (AI has full memory of these)
    const completedLines = completedTasks.length
      ? completedTasks.map(t => `    • ✅ ${t.label} (${t.status})${t.dueDate ? ' | was due: ' + t.dueDate : ''}`).join('\n')
      : '    None yet.';

    // ID lookup table (internal only, never shown to user)
    const idRef = allTasks.map(t => `${t.label} => ${t.id}`).join('\n');

    // My tasks
    let myTasksSection = '';
    if (userName) {
      const myTasks = activeTasks.filter(t =>
        t.assignees?.some(a => a.toLowerCase().includes(userName.toLowerCase())) ||
        t.createdBy === window.Auth?.userId
      );
      if (myTasks.length) {
        const overdueNow = myTasks.filter(t => t.dueDate && new Date(t.dueDate) < new Date());
        myTasksSection = `\n════════════════════════════════════════════
👤 ${userName.toUpperCase()}'S TASKS
════════════════════════════════════════════
${myTasks.map(_taskLine).join('\n')}
${overdueNow.length ? `\n⚠️ OVERDUE: ${overdueNow.map(t => t.label).join(', ')}` : ''}`;
      }
    }

    // Docs
    let docs = [];
    try { docs = JSON.parse(localStorage.getItem('bits_docs') || '[]'); } catch {}
    const docLines = docs.map(d => {
      const wc = d.sections.reduce((s, sec) =>
        s + (sec.content||'').replace(/<[^>]+>/g,'').split(/\s+/).filter(Boolean).length, 0);
      return `  📄 "${d.title}" (${wc} words)`;
    }).join('\n') || '  None yet.';

    // Recent history (per-user namespaced)
    let history = [];
    try {
      const uid = window.Auth?.userId;
      const key = uid ? `bits_history_${uid}` : 'bits_history';
      history = JSON.parse(localStorage.getItem(key)||'[]').slice(0,15);
    } catch {}
    const recentLines = history.map(h =>
      `  • ${h.userName || '?'}: ${h.description} (${new Date(h.timestamp).toLocaleDateString('en-IN')})`
    ).join('\n') || '  No activity yet.';

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

Task Summary: ${completedTasks.length} done | ${inProgress} in progress | ${activeTasks.length} active | ${allTasks.length} total
${myTasksSection}
════════════════════════════════════════════
📋 ACTIVE TASKS (ALL NEED ACTION)
════════════════════════════════════════════
${taskLines || 'No active tasks.'}

════════════════════════════════════════════
✅ COMPLETED / DONE TASKS (full memory — user may ask about these)
════════════════════════════════════════════
${completedLines}

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
- Be direct, specific, and actionable. No filler. No generic advice.`;
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
    const isAdmin = window.Auth?.isAdmin;

    if (!hasKey) {
      // Admin sees the key setup prompt; employees see a friendly locked state
      if (this.apiKeyPrompt) {
        this.apiKeyPrompt.classList.toggle('hidden', !isAdmin);
      }
      // Employee fallback message
      let empMsg = document.getElementById('jarvis-no-key-msg');
      if (!isAdmin) {
        if (!empMsg) {
          empMsg = document.createElement('div');
          empMsg.id = 'jarvis-no-key-msg';
          empMsg.className = 'jarvis-no-key-msg';
          empMsg.innerHTML = `
            <div class="jnk-icon">🛡️</div>
            <div class="jnk-title">Jarvis is warming up</div>
            <div class="jnk-sub">Your admin is setting up the AI key.<br>Come back in a moment!</div>
          `;
          this.el.querySelector('.chat-body')?.appendChild(empMsg);
        }
        empMsg.style.display = 'flex';
      } else {
        if (empMsg) empMsg.style.display = 'none';
      }
      this.msgCont.style.display = 'none';
      return;
    }

    // Key is present — hide setup UI, show chat
    if (this.apiKeyPrompt) this.apiKeyPrompt.classList.add('hidden');
    const empMsg = document.getElementById('jarvis-no-key-msg');
    if (empMsg) empMsg.style.display = 'none';
    this.msgCont.style.display = 'flex';

    this._clearMessages();
    if (!this.messages.length) {
      this._addPersonaGreeting();
    } else {
      this.messages.forEach(m => this._addMsgToUI(m));
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

    this.saveKeyBtn?.addEventListener('click', async () => {
      const key = this.apiKeyInput?.value?.trim();
      if (!key) return;
      try {
        // Save org-wide on the server (persists across deploys)
        const r = await fetch('/api/save-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Session-Token': window.Auth?.token || '' },
          body: JSON.stringify({ key }),
        });
        if (!r.ok) throw new Error('Server rejected key');
        // Also cache locally for this session
        const s = this.data.getSettings();
        this.data.saveSettings({ ...s, geminiApiKey: key });
        this.api.setApiKey(key);
        this._orgKeyReady = true;
        this.render();
        window.app?.showToast('✅ Gemini API key saved org-wide — all users now have Jarvis!', 'success');
      } catch (e) {
        window.app?.showToast('❌ Could not save key: ' + e.message, 'error');
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
      // Build system prompt fresh every call (picks up latest tasks/docs)
      const systemPrompt = this._buildSystemPrompt();

      const apiMessages = this.messages.map(m => ({ role: m.role, content: m.content }));
      const responseText = await this.api.sendMessage(apiMessages, systemPrompt);

      const parsed         = this.api.parseActions(responseText);
      const appliedActions = parsed.actions?.length ? this._applyActions(parsed.actions) : 0;

      const assistantMsg = { role: 'assistant', content: parsed.text, appliedActions };
      this.messages.push(assistantMsg);
      this._addMsgToUI(assistantMsg);
      this.data.saveChatHistory(this.messages);

      if (appliedActions > 0) window.app?.showToast(`✨ Jarvis updated ${appliedActions} task${appliedActions>1?'s':''}`, 'success');

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
          const user = window.Auth?.currentUser;
          this.data.addNode(act.parentId || 'root', {
            label:        act.label || 'New Task',
            department:   act.department || null,
            icon:         act.icon || this.currentPersona.avatar,
            priority:     act.priority || 'medium',
            assignees:    act.assignees || [],
            dueDate:      act.dueDate   || null,
            status:       act.status    || 'not_started',
            createdBy:    user?.id   || null,
            ownerName:    user?.name || null,
            collaborators: [],
          });
          count++;
        } else if (act.action === 'update_node' && act.id) {
          // Only update known safe fields (never overwrite createdBy from chat)
          const safe = {};
          if (act.status)   safe.status   = act.status;
          if (act.dueDate)  safe.dueDate  = act.dueDate;
          if (act.priority) safe.priority = act.priority;
          if (act.label)    safe.label    = act.label;
          if (act.assignees) safe.assignees = act.assignees;
          if (Object.keys(safe).length) { this.data.updateNode(act.id, safe); count++; }
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
