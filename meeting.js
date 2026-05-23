// ─── Meeting Transcript Processor ────────────────────────────────────────────
// Core agentic feature: paste/upload meeting notes → Gemini extracts actions
// → preview changes → one-click apply to mind map

class MeetingProcessor {
  constructor(data, geminiApi) {
    this.data     = data;
    this.api      = geminiApi;
    this.panel    = null;
    this.isOpen   = false;
    this.meetings = this._loadMeetings();
    this._pendingActions = [];
  }

  // ── Open / Close ──────────────────────────────────────────────────────────
  open() {
    this.panel = document.getElementById('meeting-panel');
    this.panel.classList.remove('hidden');
    this.isOpen = true;
    this._renderHistory();
  }

  close() {
    if (this.panel) this.panel.classList.add('hidden');
    this.isOpen = false;
  }

  toggle() { this.isOpen ? this.close() : this.open(); }

  // ── Process transcript with Gemini ────────────────────────────────────
  async processTranscript(transcript, meetingTitle) {
    if (!transcript.trim()) return;

    const settings = this.data.getSettings();
    const apiKey = window._orgApiKey || settings.geminiApiKey || settings.anthropicApiKey || '';
    if (!apiKey) {
      this._showError('No Gemini API key configured. Contact admin.');
      return;
    }

    this.api.setApiKey(apiKey);
    this._setLoading(true);

    try {
      const systemPrompt = this._buildSystemPrompt();
      const userMessage  = `Meeting Title: "${meetingTitle || 'Team Meeting'}"\n\nTranscript / Notes:\n${transcript}`;

      const response = await this.api.sendMessage(
        [{ role: 'user', content: userMessage }],
        systemPrompt
      );

      const parsed = this._parseMeetingResponse(response);
      this._pendingActions = parsed.actions || [];
      this._showPreview(parsed, meetingTitle, transcript);

    } catch (e) {
      this._showError('Gemini error: ' + e.message);
    } finally {
      this._setLoading(false);
    }
  }

  // ── Apply approved actions to mind map ───────────────────────────────────
  applyActions() {
    if (!this._pendingActions.length) return 0;

    let applied = 0;
    const nodeIdMap = {}; // temp label → real id for chaining add_node refs

    for (const action of this._pendingActions) {
      try {
        if (action.action === 'add_node') {
          const parentId = nodeIdMap[action.parentId] || action.parentId;
          const node = this.data.addNode(parentId, {
            label:       action.label,
            department:  action.department || null,
            icon:        action.icon || '📌',
            status:      action.status || 'not_started',
            priority:    action.priority || 'medium',
            assignees:   action.assignees || [],
            dueDate:     action.dueDate || null,
            description: action.description || '',
          });
          nodeIdMap[action._tempId] = node.id;
          applied++;

        } else if (action.action === 'update_node') {
          const id = nodeIdMap[action.id] || action.id;
          const updates = {};
          if (action.status)      updates.status      = action.status;
          if (action.priority)    updates.priority    = action.priority;
          if (action.label)       updates.label       = action.label;
          if (action.assignees)   updates.assignees   = action.assignees;
          if (action.dueDate)     updates.dueDate     = action.dueDate;
          if (action.description) updates.description = action.description;
          if (Object.keys(updates).length) {
            this.data.updateNode(id, updates);
            applied++;
          }
        }
      } catch (e) {
        console.warn('[Meeting] Action failed:', action, e);
      }
    }

    this._pendingActions = [];
    return applied;
  }

  // ── Save meeting to history ───────────────────────────────────────────────
  saveMeeting(title, transcript, summary, actionsCount) {
    const meeting = {
      id:           'mtg_' + Date.now(),
      title:        title || 'Team Meeting',
      date:         new Date().toISOString(),
      transcript:   transcript,
      summary:      summary,
      actionsCount: actionsCount,
    };
    this.meetings.unshift(meeting);
    if (this.meetings.length > 50) this.meetings.pop();
    this._saveMeetings();
    this._renderHistory();

    // Sync to server if socket is connected
    if (window.CollabSync) window.CollabSync.emitMeeting?.(meeting);
  }

  // ── Build Gemini system prompt for meeting processing ─────────────────────
  _buildSystemPrompt() {
    const nodes = this.data.getAllNodes().map(n => ({
      id: n.id, label: n.label, department: n.department,
      parentId: n.parentId, status: n.status, assignees: n.assignees,
    }));

    const team    = this.data.getTeam();
    const deptIds = Object.keys(window.DEPARTMENTS || {}).map(k => 'dept_' + k);

    return `You are an AI operations assistant for a business. You will be given meeting notes or a transcript.

Your job is to:
1. Extract a short SUMMARY (3-5 bullet points) of what was discussed
2. Extract all ACTION ITEMS — who does what, by when
3. Map those action items to the mind map as structured data
4. Update existing task statuses if they were discussed (e.g. "we finished the logo" → update that node to "done")

CURRENT MIND MAP NODES:
\`\`\`json
${JSON.stringify(nodes, null, 2)}
\`\`\`

TEAM MEMBERS: ${team.join(', ') || 'Not set'}
AVAILABLE DEPARTMENT IDs: ${deptIds.join(', ')}
AVAILABLE STATUS VALUES: not_started, in_progress, done
AVAILABLE PRIORITY VALUES: low, medium, high, critical

You MUST respond in this EXACT format — no deviation:

SUMMARY:
• [bullet 1]
• [bullet 2]
• [bullet 3]

ACTION ITEMS:
• [Person]: [Task] by [Date if mentioned]

<map_actions>
[
  {
    "action": "add_node",
    "parentId": "dept_marketing",
    "label": "Create Instagram content calendar",
    "department": "marketing",
    "icon": "📱",
    "assignees": ["Pratik"],
    "dueDate": "2026-06-01",
    "priority": "high",
    "description": "Discussed in meeting — 3 posts/week schedule"
  },
  {
    "action": "update_node",
    "id": "existing_node_id",
    "status": "done"
  }
]
</map_actions>

RULES:
- Only use parentIds that exist in the current node list above
- Prefer adding under department nodes (dept_marketing, dept_finance, etc.)
- If no node matches, add under "root"
- Keep labels concise (max 60 chars) but specific
- Only include map_actions if there are actual tasks/updates to make
- If a due date is mentioned, format as YYYY-MM-DD`;
  }

  // ── Parse Gemini response ─────────────────────────────────────────────────
  _parseMeetingResponse(text) {
    // Extract summary section
    const summaryMatch = text.match(/SUMMARY:\s*([\s\S]*?)(?=ACTION ITEMS:|<map_actions>|$)/i);
    const summary = summaryMatch ? summaryMatch[1].trim() : '';

    // Extract action items section
    const actionsTextMatch = text.match(/ACTION ITEMS:\s*([\s\S]*?)(?=<map_actions>|$)/i);
    const actionsText = actionsTextMatch ? actionsTextMatch[1].trim() : '';

    // Extract JSON actions
    const jsonMatch = text.match(/<map_actions>\s*([\s\S]*?)\s*<\/map_actions>/);
    let actions = null;
    if (jsonMatch) {
      try { actions = JSON.parse(jsonMatch[1]); } catch (e) { console.warn('JSON parse error', e); }
    }

    return { summary, actionsText, actions: actions || [] };
  }

  // ── UI: show preview of what Gemini found ─────────────────────────────────
  _showPreview(parsed, title, transcript) {
    const preview = document.getElementById('meeting-preview');
    const input   = document.getElementById('meeting-input-area');

    input.classList.add('hidden');
    preview.classList.remove('hidden');

    // Summary
    document.getElementById('mtg-summary-text').innerHTML =
      parsed.summary
        .split('\n')
        .filter(l => l.trim())
        .map(l => `<div class="mtg-bullet">${l.replace(/^[•\-]\s*/, '')}</div>`)
        .join('');

    // Action items text
    document.getElementById('mtg-actions-text').innerHTML =
      parsed.actionsText
        .split('\n')
        .filter(l => l.trim())
        .map(l => `<div class="mtg-bullet">${l.replace(/^[•\-]\s*/, '')}</div>`)
        .join('') || '<div class="mtg-muted">No action items found.</div>';

    // Map changes preview
    const mapChanges = document.getElementById('mtg-map-changes');
    if (parsed.actions.length) {
      mapChanges.innerHTML = parsed.actions.map(a => {
        if (a.action === 'add_node') {
          return `<div class="mtg-change add">
            <span class="mtg-change-icon">➕</span>
            <div>
              <div class="mtg-change-label">${a.icon || '📌'} ${a.label}</div>
              <div class="mtg-change-meta">Add under ${a.parentId} · ${a.department || ''} · ${a.priority || 'medium'} priority ${a.assignees?.length ? '· ' + a.assignees.join(', ') : ''}</div>
            </div>
          </div>`;
        } else if (a.action === 'update_node') {
          const node = this.data.getNode(a.id);
          return `<div class="mtg-change update">
            <span class="mtg-change-icon">✏️</span>
            <div>
              <div class="mtg-change-label">${node?.label || a.id}</div>
              <div class="mtg-change-meta">Update → ${a.status || ''} ${a.priority || ''}</div>
            </div>
          </div>`;
        }
        return '';
      }).join('');
    } else {
      mapChanges.innerHTML = '<div class="mtg-muted">No map changes suggested.</div>';
    }

    // Wire up approve / discard buttons
    document.getElementById('mtg-approve-btn').onclick = () => {
      const count = this.applyActions();
      this.saveMeeting(title, transcript, parsed.summary, count);
      this._resetToInput();
      if (window.app) window.app.showToast(`✅ ${count} change${count !== 1 ? 's' : ''} applied to your mind map`, 'success');
    };

    document.getElementById('mtg-discard-btn').onclick = () => {
      this._pendingActions = [];
      this._resetToInput();
    };
  }

  _resetToInput() {
    document.getElementById('meeting-preview').classList.add('hidden');
    document.getElementById('meeting-input-area').classList.remove('hidden');
    document.getElementById('mtg-transcript').value = '';
    document.getElementById('mtg-title').value = '';
  }

  _setLoading(loading) {
    const btn = document.getElementById('mtg-process-btn');
    const spinner = document.getElementById('mtg-spinner');
    btn.disabled = loading;
    btn.textContent = loading ? 'Analysing…' : '✨ Analyse Meeting';
    if (spinner) spinner.classList.toggle('hidden', !loading);
  }

  _showError(msg) {
    const err = document.getElementById('mtg-error');
    err.textContent = msg;
    err.classList.remove('hidden');
    setTimeout(() => err.classList.add('hidden'), 5000);
  }

  // ── History ───────────────────────────────────────────────────────────────
  _renderHistory() {
    const list = document.getElementById('mtg-history-list');
    if (!list) return;
    if (!this.meetings.length) {
      list.innerHTML = '<div class="mtg-muted">No meetings processed yet.</div>';
      return;
    }
    list.innerHTML = this.meetings.slice(0, 10).map(m => `
      <div class="mtg-history-item" data-id="${m.id}">
        <div class="mtg-history-icon">📋</div>
        <div class="mtg-history-body">
          <div class="mtg-history-title">${m.title}</div>
          <div class="mtg-history-meta">${new Date(m.date).toLocaleDateString('en-IN', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })} · ${m.actionsCount} changes applied</div>
        </div>
      </div>
    `).join('');
  }

  _loadMeetings() {
    try { return JSON.parse(localStorage.getItem('bits_meetings') || '[]'); } catch { return []; }
  }

  _saveMeetings() {
    localStorage.setItem('bits_meetings', JSON.stringify(this.meetings));
  }
}

window.MeetingProcessor = MeetingProcessor;
