// ─── Bits & Studios — Agent System Client ────────────────────────────────────
// Handles: AgentPanel, task-scoped AgentChat, live activity feed, supervisor view
// Connects to server via Socket.io events + REST API

'use strict';

// ── Persona display config (mirrors server) ───────────────────────────────────
const AGENT_PERSONA_UI = {
  gemini: { name: 'Gemini', title: 'CEO · Strategic', avatar: '✨', color: '#4f46e5', gradient: 'linear-gradient(135deg,#4f46e5,#7c3aed)' },
  aria:   { name: 'Aria',   title: 'Marketing Head',  avatar: '📣', color: '#ec4899', gradient: 'linear-gradient(135deg,#ec4899,#f43f5e)' },
  atlas:  { name: 'Atlas',  title: 'Finance Head',    avatar: '💰', color: '#10b981', gradient: 'linear-gradient(135deg,#10b981,#059669)' },
  sage:   { name: 'Sage',   title: 'Curriculum Head', avatar: '🎓', color: '#f59e0b', gradient: 'linear-gradient(135deg,#f59e0b,#d97706)' },
  max:    { name: 'Max',    title: 'Space & Tech',    avatar: '🏗️', color: '#6366f1', gradient: 'linear-gradient(135deg,#6366f1,#4f46e5)' },
};

const DEPT_PERSONA_MAP = {
  marketing: 'aria', finance: 'atlas', curriculum: 'sage',
  operations: 'max', space_design: 'max', equipment: 'max',
  community: 'aria', partnerships: 'aria',
};

// ── AgentPanel ────────────────────────────────────────────────────────────────
class AgentPanel {
  constructor(dataLayer) {
    this.data = dataLayer;
    this.el   = document.getElementById('agent-panel');
    if (!this.el) { console.warn('[AgentPanel] #agent-panel not found'); return; }

    this.currentView    = 'dashboard';    // 'dashboard' | 'task-chat'
    this.activeChatTask = null;
    this.activeChatPersona = null;
    this.chatMessages   = {};             // taskId → [{role, content}]
    this.jobs           = new Map();      // jobId → job summary
    this.activityByTask = {};             // taskId → activity entries[]

    this._bindSocketEvents();
    this._bindUIEvents();
    this._pollJobs();
  }

  // ── Socket.io integration ─────────────────────────────────────────────────
  _bindSocketEvents() {
    // Wait for socket to be ready
    const tryBind = () => {
      if (typeof io === 'undefined') return;
      const socket = window._agentSocket = io(window.location.origin, {
        transports: ['websocket', 'polling'],
      });

      socket.on('agent:event', (data) => this._handleAgentEvent(data));
      socket.on('agent:doc_created', (data) => this._handleDocCreated(data));
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', tryBind);
    } else {
      setTimeout(tryBind, 500);
    }
  }

  _handleAgentEvent(data) {
    const { event, jobId, taskId, agentPersona, content, timestamp } = data;

    // Store in activity log
    if (taskId) {
      if (!this.activityByTask[taskId]) this.activityByTask[taskId] = [];
      this.activityByTask[taskId].unshift({ ...data, ts: timestamp });
    }

    // Update job map
    if (jobId) {
      const existing = this.jobs.get(jobId) || {};
      this.jobs.set(jobId, {
        ...existing, jobId, taskId, agentPersona,
        status: event === 'agent:complete' ? 'completed'
              : event === 'agent:error'    ? 'error'
              : event === 'agent:start'    ? 'running'
              : existing.status || 'running',
        lastEvent: event,
        summary:   data.summary || existing.summary,
      });
    }

    // Live-update sidebar agent section if it's the current task
    const sidebarEl = document.getElementById('agent-sidebar-section');
    if (sidebarEl && window.app?.sidebar?.currentNodeId === taskId) {
      this._refreshSidebarAgentSection(taskId, agentPersona);
    }

    // Update dashboard if open
    if (this.currentView === 'dashboard' && this.el && !this.el.classList.contains('hidden')) {
      this._renderDashboard();
    }

    // Mind map badge
    if (window.app?.mindMap) {
      window.app.mindMap.updateAgentBadge(taskId, event === 'agent:complete' ? 'done'
        : event === 'agent:error' ? 'error' : 'running');
    }

    // Toast on important events
    const node = this.data.getNode(taskId);
    const taskLabel = node?.label || 'Task';
    const p = AGENT_PERSONA_UI[agentPersona] || AGENT_PERSONA_UI.gemini;

    if (event === 'agent:start') {
      window.app?.showToast(`${p.avatar} ${p.name} agent started on "${taskLabel}"`, 'info');
    } else if (event === 'agent:complete') {
      window.app?.showToast(`✅ ${p.name} finished "${taskLabel}" — ${data.docsCreated || 0} docs created`, 'success');
    } else if (event === 'agent:error') {
      window.app?.showToast(`❌ Agent error on "${taskLabel}": ${content}`, 'error');
    }
  }

  _handleDocCreated(data) {
    const { doc, taskId } = data;
    if (!doc || !taskId) return;

    // Store doc in localStorage (same format as docs.js)
    try {
      const allDocs = JSON.parse(localStorage.getItem('bits_docs') || '[]');
      const existing = allDocs.findIndex(d => d.id === doc.id);
      const docEntry = {
        id:        doc.id,
        title:     doc.title,
        template:  doc.template || 'brief',
        createdAt: doc.createdAt,
        updatedAt: doc.createdAt,
        taskId:    doc.taskId,
        agentGenerated: true,
        agentPersona:   doc.createdBy,
        sections: [{
          id:      'sec_' + Date.now().toString(36),
          heading: doc.title,
          content: doc.content,
        }],
      };

      if (existing !== -1) allDocs[existing] = docEntry;
      else allDocs.unshift(docEntry);

      localStorage.setItem('bits_docs', JSON.stringify(allDocs));
    } catch (e) {
      console.error('[AgentPanel] Failed to store doc:', e);
    }

    // Add to task's file list
    const node = this.data.getNode(taskId);
    if (node) {
      const fileEntry = {
        id:        'f_ag_' + doc.id,
        name:      doc.title,
        type:      'ai_doc',
        docId:     doc.id,
        url:       null,
        createdAt: doc.createdAt,
        createdBy: doc.createdBy,
        agentGenerated: true,
      };
      const files = [...(node.files || []).filter(f => f.docId !== doc.id), fileEntry];
      this.data.updateNode(taskId, { files });

      // Refresh sidebar files if open
      if (window.app?.sidebar?.currentNodeId === taskId) {
        window.app.sidebar.renderFiles(files);
      }
    }

    window.app?.showToast(`📄 Agent created: "${doc.title}"`, 'success');
  }

  // ── REST API helpers ───────────────────────────────────────────────────────
  _getApiKey() {
    const s = this.data.getSettings();
    return window._orgApiKey || s.geminiApiKey || s.anthropicApiKey || '';
  }

  async runAgent(taskId, agentPersona) {
    const apiKey = this._getApiKey();
    if (!apiKey) {
      window.app?.showToast('Add your Gemini API key in ⚙️ Settings first', 'error');
      return null;
    }

    // Include the full node object so server can use it as fallback
    // if the node isn't in server state (e.g. after a server restart)
    const nodeData = this.data.getNode(taskId) || null;

    try {
      const res = await fetch('/api/agent/run', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ taskId, agentPersona, apiKey, nodeData }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    } catch (err) {
      window.app?.showToast(`Agent error: ${err.message}`, 'error');
      return null;
    }
  }

  async cancelJob(jobId) {
    try {
      await fetch(`/api/agent/job/${jobId}`, { method: 'DELETE' });
      window.app?.showToast('Agent job cancelled', 'info');
      this._renderDashboard();
    } catch {}
  }

  async _pollJobs() {
    const refresh = async () => {
      if (this.el && !this.el.classList.contains('hidden') && this.currentView === 'dashboard') {
        try {
          const res  = await fetch('/api/agent/jobs');
          const data = await res.json();
          if (data.jobs) {
            data.jobs.forEach(j => this.jobs.set(j.jobId, j));
            this._renderDashboard();
          }
        } catch {}
      }
    };
    setInterval(refresh, 5000);
  }

  // ── Open / close ───────────────────────────────────────────────────────────
  open(view = 'dashboard', opts = {}) {
    if (!this.el) return;
    this.el.classList.remove('hidden');
    this.currentView = view;

    if (view === 'dashboard') {
      this._renderDashboard();
    } else if (view === 'task-chat') {
      this.activeChatTask    = opts.taskId;
      this.activeChatPersona = opts.persona;
      this._renderTaskChat(opts.taskId, opts.persona);
    } else if (view === 'supervisor') {
      this._renderSupervisor(opts.department);
    }
  }

  close() {
    if (this.el) this.el.classList.add('hidden');
  }

  toggle() {
    if (!this.el) return;
    if (this.el.classList.contains('hidden')) this.open();
    else this.close();
  }

  // ── UI Events ──────────────────────────────────────────────────────────────
  _bindUIEvents() {
    document.getElementById('agent-panel-close')?.addEventListener('click', () => this.close());
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DASHBOARD VIEW — all active + recent jobs
  // ═══════════════════════════════════════════════════════════════════════════
  _renderDashboard() {
    const content = document.getElementById('agent-panel-content');
    if (!content) return;

    const allJobs      = Array.from(this.jobs.values());
    const activeJobs   = allJobs.filter(j => j.status === 'running');
    const completedJobs = allJobs.filter(j => j.status === 'completed').slice(0, 10);

    const allNodes    = this.data.getAllNodes().filter(n => n.id !== 'root');
    const withAgents  = allNodes.filter(n => n.agent?.persona);

    const depts = ['marketing', 'finance', 'curriculum', 'operations', 'space_design', 'equipment'];

    content.innerHTML = `
      <div class="agent-dashboard">

        <!-- Header -->
        <div class="agent-dash-header">
          <h2>🤖 Agent Control Centre</h2>
          <p class="agent-dash-sub">${withAgents.length} tasks with agents · ${activeJobs.length} running now</p>
        </div>

        <!-- Active jobs -->
        ${activeJobs.length ? `
          <div class="agent-section">
            <div class="agent-section-title">⚡ Running Now</div>
            ${activeJobs.map(j => this._renderJobCard(j, true)).join('')}
          </div>
        ` : ''}

        <!-- Supervisor panels -->
        <div class="agent-section">
          <div class="agent-section-title">🏢 Department Supervisors</div>
          <div class="supervisor-grid">
            ${depts.map(dept => {
              const persona = DEPT_PERSONA_MAP[dept] || 'gemini';
              const p       = AGENT_PERSONA_UI[persona];
              const tasks   = allNodes.filter(n => n.department === dept);
              const done    = tasks.filter(t => t.status === 'done').length;
              return `
                <div class="supervisor-card" onclick="window.app.agentPanel.open('supervisor', {department: '${dept}'})">
                  <div class="supervisor-avatar" style="background:${p.gradient}">${p.avatar}</div>
                  <div class="supervisor-info">
                    <div class="supervisor-name">${p.name}</div>
                    <div class="supervisor-dept">${dept.replace('_', ' ')}</div>
                    <div class="supervisor-progress">
                      <div class="supervisor-bar" style="width:${tasks.length ? Math.round(done/tasks.length*100) : 0}%"></div>
                    </div>
                    <div class="supervisor-stat">${done}/${tasks.length} done</div>
                  </div>
                  <div class="supervisor-brief-btn">Brief →</div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- Assigned agents on tasks -->
        ${withAgents.length ? `
          <div class="agent-section">
            <div class="agent-section-title">🤖 Task Agents</div>
            ${withAgents.slice(0, 12).map(node => {
              const p = AGENT_PERSONA_UI[node.agent.persona] || AGENT_PERSONA_UI.gemini;
              const status = node.agent.status || 'idle';
              return `
                <div class="task-agent-row" onclick="window.app.sidebar.open('${node.id}'); window.app.mindMap?.selectNode('${node.id}')">
                  <div class="ta-avatar" style="background:${p.gradient}">${p.avatar}</div>
                  <div class="ta-info">
                    <div class="ta-label">${node.label}</div>
                    <div class="ta-meta">${p.name} · ${node.department || 'General'}</div>
                  </div>
                  <div class="ta-status ta-status-${status}">
                    ${status === 'running' ? '<span class="agent-pulse"></span>' : ''}
                    ${status}
                  </div>
                  <button class="ta-chat-btn" onclick="event.stopPropagation(); window.app.agentPanel.open('task-chat', {taskId:'${node.id}', persona:'${node.agent.persona}'})">
                    💬
                  </button>
                </div>
              `;
            }).join('')}
          </div>
        ` : `
          <div class="agent-empty">
            <div class="agent-empty-icon">🤖</div>
            <div>No agents assigned yet</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:4px">
              Click a task → Agent section → Assign & Run
            </div>
          </div>
        `}

        <!-- Recent completions -->
        ${completedJobs.length ? `
          <div class="agent-section">
            <div class="agent-section-title">✅ Recent Completions</div>
            ${completedJobs.map(j => this._renderJobCard(j, false)).join('')}
          </div>
        ` : ''}

      </div>
    `;
  }

  _renderJobCard(job, isActive) {
    const p = AGENT_PERSONA_UI[job.agentPersona] || AGENT_PERSONA_UI.gemini;
    const node = this.data.getNode(job.taskId);
    const taskLabel = job.taskLabel || node?.label || job.taskId;
    const elapsed = job.completedAt
      ? `${Math.round((new Date(job.completedAt) - new Date(job.createdAt)) / 1000)}s`
      : 'running…';

    return `
      <div class="agent-job-card ${isActive ? 'active' : ''}">
        <div class="job-avatar" style="background:${p.gradient}">
          ${p.avatar}
          ${isActive ? '<span class="agent-pulse-ring"></span>' : ''}
        </div>
        <div class="job-info">
          <div class="job-task">${taskLabel}</div>
          <div class="job-meta">${p.name} · ${elapsed} · ${job.activityCount || 0} steps</div>
          ${job.summary ? `<div class="job-summary">${job.summary.slice(0, 100)}${job.summary.length > 100 ? '…' : ''}</div>` : ''}
        </div>
        <div class="job-actions">
          ${isActive
            ? `<button class="job-cancel-btn" onclick="window.app.agentPanel.cancelJob('${job.jobId}')">⏹</button>`
            : `<button class="job-view-btn" onclick="window.app.agentPanel._openJobDetail('${job.jobId}')">View</button>`
          }
        </div>
      </div>
    `;
  }

  async _openJobDetail(jobId) {
    try {
      const res  = await fetch(`/api/agent/job/${jobId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      this._renderJobDetail(data);
    } catch (err) {
      window.app?.showToast('Could not load job details: ' + err.message, 'error');
    }
  }

  _renderJobDetail(job) {
    const content = document.getElementById('agent-panel-content');
    if (!content) return;
    const p = AGENT_PERSONA_UI[job.agentPersona] || AGENT_PERSONA_UI.gemini;

    content.innerHTML = `
      <div class="agent-job-detail">
        <div class="job-detail-header">
          <button class="agent-back-btn" onclick="window.app.agentPanel._renderDashboard()">← Back</button>
          <div class="job-detail-title">
            <span style="background:${p.gradient}" class="jd-avatar">${p.avatar}</span>
            ${p.name} on "${job.taskLabel}"
          </div>
          <div class="job-detail-meta">
            ${job.status} · ${job.turnCount} turns · ${job.createdDocs?.length || 0} docs
          </div>
        </div>

        ${job.summary ? `
          <div class="job-summary-box">
            <strong>Summary:</strong> ${job.summary}
          </div>
        ` : ''}

        ${job.createdDocs?.length ? `
          <div class="agent-section">
            <div class="agent-section-title">📄 Documents Created</div>
            ${job.createdDocs.map(d => `
              <div class="agent-doc-item">
                <span>📄</span>
                <span class="agent-doc-title">${d.title}</span>
                <span class="agent-doc-template">${d.template}</span>
              </div>
            `).join('')}
          </div>
        ` : ''}

        <div class="agent-section">
          <div class="agent-section-title">🔍 Full Activity Log</div>
          <div class="agent-activity-log">
            ${(job.activity || []).map(entry => `
              <div class="activity-entry activity-${entry.type}">
                <span class="activity-icon">${this._activityIcon(entry.type)}</span>
                <div class="activity-body">
                  <div class="activity-content">${entry.content}</div>
                  <div class="activity-time">${new Date(entry.timestamp).toLocaleTimeString()}</div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  _activityIcon(type) {
    const icons = {
      thought:     '🧠',
      tool_call:   '🔧',
      observation: '👁',
      tool_result: '✅',
      complete:    '🎉',
      error:       '❌',
      'agent:start': '🚀',
    };
    return icons[type] || '•';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TASK CHAT VIEW — scoped chat with a task agent
  // ═══════════════════════════════════════════════════════════════════════════
  _renderTaskChat(taskId, persona) {
    const content = document.getElementById('agent-panel-content');
    if (!content) return;

    const node = this.data.getNode(taskId);
    const p    = AGENT_PERSONA_UI[persona] || AGENT_PERSONA_UI.gemini;
    const msgs = this.chatMessages[taskId] || [];

    content.innerHTML = `
      <div class="agent-task-chat">
        <div class="atc-header">
          <button class="agent-back-btn" onclick="window.app.agentPanel._renderDashboard()">← Back</button>
          <div class="atc-persona" style="background:${p.gradient}">${p.avatar}</div>
          <div class="atc-info">
            <div class="atc-name">${p.name}</div>
            <div class="atc-task">${node?.label || taskId}</div>
          </div>
        </div>

        <div class="atc-messages" id="atc-msg-list">
          ${msgs.length === 0 ? `
            <div class="atc-welcome">
              <div class="atc-welcome-avatar" style="background:${p.gradient}">${p.avatar}</div>
              <p>Hi! I'm <strong>${p.name}</strong>, your dedicated agent for <strong>"${node?.label}"</strong>.</p>
              <p>I know everything about this task. Ask me anything — analysis, blockers, next steps, vendor details…</p>
            </div>
          ` : msgs.map(m => this._renderChatMsg(m)).join('')}
        </div>

        <div class="atc-input-row">
          <textarea id="atc-input" class="atc-input" placeholder="Ask ${p.name} about this task…" rows="1"
            onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();window.app.agentPanel._sendTaskChat()}"
            oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,120)+'px'"
          ></textarea>
          <button class="atc-send-btn" id="atc-send" onclick="window.app.agentPanel._sendTaskChat()"
            style="background:${p.gradient}">
            ↑
          </button>
        </div>
      </div>
    `;

    this._scrollChatToBottom();
  }

  _renderChatMsg(msg) {
    const isUser = msg.role === 'user';
    return `
      <div class="atc-msg ${isUser ? 'atc-msg-user' : 'atc-msg-agent'}">
        ${!isUser ? `<div class="atc-msg-avatar">${AGENT_PERSONA_UI[this.activeChatPersona]?.avatar || '🤖'}</div>` : ''}
        <div class="atc-msg-bubble">${this._formatMarkdown(msg.content)}</div>
      </div>
    `;
  }

  async _sendTaskChat() {
    const input = document.getElementById('atc-input');
    const text  = input?.value?.trim();
    if (!text) return;

    const taskId  = this.activeChatTask;
    const persona = this.activeChatPersona;
    const apiKey  = this._getApiKey();

    if (!apiKey) {
      window.app?.showToast('Add your Gemini API key in ⚙️ Settings', 'error');
      return;
    }

    if (!this.chatMessages[taskId]) this.chatMessages[taskId] = [];
    this.chatMessages[taskId].push({ role: 'user', content: text });
    input.value = '';
    input.style.height = 'auto';

    this._renderTaskChat(taskId, persona);

    // Show typing indicator
    const msgList = document.getElementById('atc-msg-list');
    if (msgList) {
      const typing = document.createElement('div');
      typing.id        = 'atc-typing';
      typing.className = 'atc-msg atc-msg-agent';
      typing.innerHTML = `<div class="atc-msg-avatar">${AGENT_PERSONA_UI[persona]?.avatar || '🤖'}</div>
        <div class="atc-msg-bubble atc-typing-dots"><span></span><span></span><span></span></div>`;
      msgList.appendChild(typing);
      this._scrollChatToBottom();
    }

    const sendBtn = document.getElementById('atc-send');
    if (sendBtn) sendBtn.disabled = true;

    try {
      const res = await fetch('/api/agent/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          taskId,
          agentPersona: persona,
          messages:     this.chatMessages[taskId],
          apiKey,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      this.chatMessages[taskId].push({ role: 'assistant', content: data.text });
    } catch (err) {
      this.chatMessages[taskId].push({ role: 'assistant', content: `❌ Error: ${err.message}` });
    } finally {
      if (sendBtn) sendBtn.disabled = false;
      this._renderTaskChat(taskId, persona);
    }
  }

  _scrollChatToBottom() {
    setTimeout(() => {
      const list = document.getElementById('atc-msg-list');
      if (list) list.scrollTop = list.scrollHeight;
    }, 50);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SUPERVISOR VIEW — department briefing
  // ═══════════════════════════════════════════════════════════════════════════
  async _renderSupervisor(department) {
    const content = document.getElementById('agent-panel-content');
    if (!content) return;

    const persona = DEPT_PERSONA_MAP[department] || 'gemini';
    const p       = AGENT_PERSONA_UI[persona];

    content.innerHTML = `
      <div class="agent-supervisor-view">
        <div class="sv-header">
          <button class="agent-back-btn" onclick="window.app.agentPanel._renderDashboard()">← Back</button>
          <div class="sv-persona" style="background:${p.gradient}">${p.avatar}</div>
          <div>
            <div class="sv-name">${p.name} — ${p.title}</div>
            <div class="sv-dept">${department.replace('_', ' ')} Department</div>
          </div>
        </div>
        <div class="sv-loading">
          <div class="agent-spinner"></div>
          <div>Generating department brief…</div>
        </div>
      </div>
    `;

    const apiKey = this._getApiKey();
    if (!apiKey) {
      content.querySelector('.sv-loading').innerHTML =
        `<div>❌ No API key. Add one in ⚙️ Settings.</div>`;
      return;
    }

    try {
      const res  = await fetch(`/api/supervisor/brief/${department}?key=${apiKey}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const allNodes  = this.data.getAllNodes().filter(n => n.id !== 'root');
      const deptTasks = allNodes.filter(n => n.department === department);

      content.innerHTML = `
        <div class="agent-supervisor-view">
          <div class="sv-header">
            <button class="agent-back-btn" onclick="window.app.agentPanel._renderDashboard()">← Back</button>
            <div class="sv-persona" style="background:${p.gradient}">${p.avatar}</div>
            <div>
              <div class="sv-name">${p.name} — ${p.title}</div>
              <div class="sv-dept">${department.replace('_', ' ')} · ${data.done}/${data.taskCount} done</div>
            </div>
          </div>

          <div class="sv-stats">
            <div class="sv-stat"><span>${data.done}</span>Done</div>
            <div class="sv-stat"><span>${data.inProgress}</span>In Progress</div>
            <div class="sv-stat"><span>${data.notStarted}</span>Not Started</div>
          </div>

          <div class="sv-brief">
            ${this._formatMarkdown(data.brief)}
          </div>

          <div class="sv-actions">
            <button class="sv-run-all-btn" onclick="window.app.agentPanel._runAllDeptAgents('${department}', '${persona}')">
              ▶ Run All ${deptTasks.length} ${department} agents
            </button>
          </div>

          <div class="agent-section">
            <div class="agent-section-title">All ${department} Tasks</div>
            ${deptTasks.map(node => `
              <div class="sv-task-row" onclick="window.app.sidebar.open('${node.id}')">
                <div class="sv-task-status sv-status-${node.status}"></div>
                <div class="sv-task-label">${node.label}</div>
                <div class="sv-task-priority sv-priority-${node.priority}">${node.priority}</div>
                ${node.agent?.persona ? `
                  <div class="sv-task-agent" title="${AGENT_PERSONA_UI[node.agent.persona]?.name}">
                    ${AGENT_PERSONA_UI[node.agent.persona]?.avatar || '🤖'}
                  </div>
                ` : `<div class="sv-task-no-agent">—</div>`}
              </div>
            `).join('')}
          </div>
        </div>
      `;
    } catch (err) {
      content.querySelector('.sv-loading').innerHTML =
        `<div>❌ ${err.message}</div>`;
    }
  }

  async _runAllDeptAgents(department, persona) {
    const apiKey = this._getApiKey();
    if (!apiKey) { window.app?.showToast('No API key', 'error'); return; }

    window.app?.showToast(`🚀 Starting all ${department} agents…`, 'info');
    try {
      const res  = await fetch('/api/supervisor/run-all', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ department, agentPersona: persona, apiKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      window.app?.showToast(`✅ Started ${data.started} agents`, 'success');
      this._renderDashboard();
    } catch (err) {
      window.app?.showToast('Failed: ' + err.message, 'error');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SIDEBAR AGENT SECTION — rendered inside the task sidebar
  // ═══════════════════════════════════════════════════════════════════════════
  renderSidebarSection(taskId) {
    const container = document.getElementById('agent-sidebar-section');
    if (!container) return;

    const node    = this.data.getNode(taskId);
    const agentInfo = node?.agent || {};
    const persona   = agentInfo.persona || '';
    const status    = agentInfo.status  || 'idle';
    const p         = AGENT_PERSONA_UI[persona];

    // Recent activity for this task
    const recentActivity = (this.activityByTask[taskId] || []).slice(0, 5);

    container.innerHTML = `
      <div class="sb-agent-section">
        <div class="sb-agent-assign">
          <select class="sb-agent-select" id="sb-agent-select-${taskId}"
            onchange="window.app.agentPanel._assignAgent('${taskId}', this.value)">
            <option value="">— Assign Agent —</option>
            ${Object.entries(AGENT_PERSONA_UI).map(([id, ap]) =>
              `<option value="${id}" ${persona === id ? 'selected' : ''}>${ap.avatar} ${ap.name} · ${ap.title}</option>`
            ).join('')}
          </select>
        </div>

        ${persona ? `
          <div class="sb-agent-controls">
            <div class="sb-agent-who">
              <div class="sb-agent-avatar" style="background:${p.gradient}">${p.avatar}</div>
              <div>
                <div class="sb-agent-name">${p.name}</div>
                <div class="sb-agent-status sb-status-${status}">
                  ${status === 'running' ? '<span class="agent-pulse"></span>' : ''}
                  ${status}
                </div>
              </div>
            </div>

            <div class="sb-agent-btns">
              ${status === 'running'
                ? `<button class="sb-agent-btn sb-agent-stop"
                     onclick="window.app.agentPanel._stopTaskAgent('${taskId}')">
                     ⏹ Stop
                   </button>`
                : `<button class="sb-agent-btn sb-agent-run"
                     onclick="window.app.agentPanel._runTaskAgent('${taskId}', '${persona}')"
                     style="background:${p.gradient}">
                     ▶ Run Agent
                   </button>`
              }
              <button class="sb-agent-btn sb-agent-chat"
                onclick="window.app.agentPanel.open('task-chat', {taskId:'${taskId}', persona:'${persona}'})">
                💬 Chat
              </button>
            </div>
          </div>

          ${recentActivity.length ? `
            <div class="sb-agent-log">
              ${recentActivity.map(entry => `
                <div class="sb-log-entry sb-log-${entry.type}">
                  <span class="sb-log-icon">${this._activityIcon(entry.type)}</span>
                  <span class="sb-log-text">${(entry.content || '').slice(0, 80)}</span>
                </div>
              `).join('')}
              ${agentInfo.lastJobId ? `
                <button class="sb-view-log-btn"
                  onclick="window.app.agentPanel.open(); window.app.agentPanel._openJobDetail('${agentInfo.lastJobId}')">
                  View full log →
                </button>
              ` : ''}
            </div>
          ` : `
            <div class="sb-agent-hint">
              Click ▶ Run Agent to let ${p.name} autonomously analyze this task,<br>
              create documents, add subtasks, and update status.
            </div>
          `}
        ` : `
          <div class="sb-agent-hint">
            Assign an AI agent to autonomously work on this task —<br>
            research, create documents, add subtasks, update status.
          </div>
        `}
      </div>
    `;
  }

  async _assignAgent(taskId, persona) {
    if (!taskId) return;
    const node = this.data.getNode(taskId);
    if (!node) return;

    const agentData = persona
      ? { ...(node.agent || {}), persona, status: 'idle' }
      : null;

    this.data.updateNode(taskId, { agent: agentData });
    this.renderSidebarSection(taskId);

    if (persona) {
      const p = AGENT_PERSONA_UI[persona];
      window.app?.showToast(`${p.avatar} ${p.name} assigned to "${node.label}"`, 'success');
      if (window.app?.mindMap) window.app.mindMap.updateAgentBadge(taskId, 'idle');
    } else {
      if (window.app?.mindMap) window.app.mindMap.updateAgentBadge(taskId, null);
    }
  }

  async _runTaskAgent(taskId, persona) {
    const node = this.data.getNode(taskId);
    if (!node) return;

    // Update status optimistically
    this.data.updateNode(taskId, {
      agent: { ...(node.agent || {}), persona, status: 'running' },
    });
    this.renderSidebarSection(taskId);

    const result = await this.runAgent(taskId, persona);
    if (!result) {
      // Failed — revert
      this.data.updateNode(taskId, {
        agent: { ...(node.agent || {}), status: 'idle' },
      });
      this.renderSidebarSection(taskId);
    }
  }

  _stopTaskAgent(taskId) {
    const node = this.data.getNode(taskId);
    const jobId = node?.agent?.lastJobId;
    if (jobId) this.cancelJob(jobId);

    this.data.updateNode(taskId, {
      agent: { ...(node?.agent || {}), status: 'idle' },
    });
    this.renderSidebarSection(taskId);
  }

  // ── Called by sidebar when node updates arrive ─────────────────────────────
  _refreshSidebarAgentSection(taskId, agentPersona) {
    // Update node's agent status in data
    const node = this.data.getNode(taskId);
    if (node?.agent) {
      // Status will be read from activityByTask
      this.renderSidebarSection(taskId);
    }
  }

  // ── Utility ────────────────────────────────────────────────────────────────
  _formatMarkdown(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^#{1,3}\s+(.+)$/gm, '<h4>$1</h4>')
      .replace(/^•\s+(.+)$/gm, '<li>$1</li>')
      .replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>')
      .replace(/^(.+)$/, '<p>$1</p>');
  }
}

window.AgentPanel = AgentPanel;
