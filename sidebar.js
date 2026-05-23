// ─── Bits & Studios — Task Sidebar ──────────────────────────────────────────

class Sidebar {
  constructor(dataLayer) {
    this.data = dataLayer;
    this.el = document.getElementById('sidebar');
    this.currentNodeId = null;

    this.titleInput        = document.getElementById('sb-title');
    this.descInput         = document.getElementById('sb-desc');
    this.deptSelect        = document.getElementById('sb-dept');
    this.dueDateInput      = document.getElementById('sb-due');
    this.subtaskList       = document.getElementById('sb-subtasks');
    this.newSubtaskInput   = document.getElementById('sb-new-subtask');
    this.addSubtaskBtn     = document.getElementById('sb-add-subtask');
    this.assigneeList      = document.getElementById('sb-assignees');
    this.newAssigneeSelect = document.getElementById('sb-new-assignee');
    this.collabList        = document.getElementById('sb-collabs');
    this.addCollabSelect   = document.getElementById('sb-add-collab');
    this.ownerDisplay      = document.getElementById('sb-owner-display');

    this.bindEvents();
    this.populateSelects();
  }

  bindEvents() {
    document.getElementById('sb-close').addEventListener('click', () => {
      this.close();
      if (window.app) window.app.mindMap.selectNode(null);
    });

    this.titleInput.addEventListener('change', () => this.save('label', this.titleInput.value));
    this.descInput.addEventListener('change',  () => this.save('description', this.descInput.value));
    this.deptSelect.addEventListener('change', () => {
      this.save('department', this.deptSelect.value);
      this.el.style.borderTopColor = window.DEPARTMENTS[this.deptSelect.value]?.color || 'transparent';
    });
    this.dueDateInput.addEventListener('change', () => this.save('dueDate', this.dueDateInput.value));

    document.querySelectorAll('.status-pill').forEach(pill => {
      pill.addEventListener('click', e => {
        this.save('status', e.target.dataset.status);
        this.updatePills('status', e.target.dataset.status);
      });
    });

    document.querySelectorAll('.priority-pill').forEach(pill => {
      pill.addEventListener('click', e => {
        this.save('priority', e.target.dataset.priority);
        this.updatePills('priority', e.target.dataset.priority);
      });
    });

    this.addSubtaskBtn.addEventListener('click', () => this.addSubtask());
    this.newSubtaskInput.addEventListener('keypress', e => {
      if (e.key === 'Enter') this.addSubtask();
    });

    this.newAssigneeSelect.addEventListener('change', () => {
      if (!window.RBAC?.check('assign_any', this.currentNodeId) &&
          !window.Auth?.isAdmin) {
        this.newAssigneeSelect.value = '';
        return;
      }
      if (this.newAssigneeSelect.value) {
        this.addAssignee(this.newAssigneeSelect.value);
        this.newAssigneeSelect.value = '';
      }
    });

    // Collaborator select
    if (this.addCollabSelect) {
      this.addCollabSelect.addEventListener('change', () => {
        if (this.addCollabSelect.value) {
          this.addCollaborator(this.addCollabSelect.value);
          this.addCollabSelect.value = '';
        }
      });
    }

    document.getElementById('sb-delete').addEventListener('click', () => {
      if (!window.RBAC?.check('delete_task')) return;
      if (!this.currentNodeId) return;
      if (this.currentNodeId === 'root') { alert('Cannot delete root node.'); return; }
      if (confirm('Delete this task and all sub-tasks?')) {
        this.data.deleteNode(this.currentNodeId);
        this.close();
        if (window.app) window.app.mindMap.selectNode(null);
      }
    });

    // Smart deadline suggest
    const suggestBtn = document.getElementById('sb-suggest-deadline');
    if (suggestBtn) {
      suggestBtn.addEventListener('click', () => this._suggestDeadline());
    }
  }

  populateSelects() {
    this.deptSelect.innerHTML = '<option value="">No Department</option>';
    for (const [key, dept] of Object.entries(window.DEPARTMENTS || {})) {
      this.deptSelect.innerHTML += `<option value="${key}">${dept.icon} ${dept.label}</option>`;
    }
  }

  refreshTeamList() {
    const team = this.data.getTeam();
    this.newAssigneeSelect.innerHTML = '<option value="">+ Assign to...</option>';
    team.forEach(m => {
      this.newAssigneeSelect.innerHTML += `<option value="${m}">${m}</option>`;
    });
  }

  open(nodeId) {
    const node = this.data.getNode(nodeId);
    if (!node) return;

    this.currentNodeId = nodeId;
    this.refreshTeamList();
    this._refreshUserList();

    this.titleInput.value   = node.label       || '';
    this.descInput.value    = node.description || '';
    this.deptSelect.value   = node.department  || '';
    this.dueDateInput.value = node.dueDate     || '';

    this.updatePills('status',   node.status   || 'not_started');
    this.updatePills('priority', node.priority || 'medium');

    this.renderSubtasks(node.subtasks || []);
    this.renderAssignees(node.assignees || []);
    this.renderCollaborators(node.collaborators || [], node);
    this.renderOwner(node);
    this.renderFiles(node.files || []);

    // Apply RBAC locking
    if (window.RBAC) window.RBAC.applySidebarLock(nodeId);

    // Agent section
    if (window.app?.agentPanel) {
      window.app.agentPanel.renderSidebarSection(nodeId);
    }

    if (node.department && window.DEPARTMENTS[node.department]) {
      this.el.style.borderTop = `3px solid ${window.DEPARTMENTS[node.department].color}`;
    } else {
      this.el.style.borderTop = 'none';
    }

    document.getElementById('sb-delete').style.display = node.id === 'root' || !window.Auth?.isAdmin ? 'none' : 'block';
    this.el.classList.remove('hidden');
  }

  close() {
    this.el.classList.add('hidden');
    this.currentNodeId = null;
  }

  save(key, value) {
    if (!this.currentNodeId) return;
    // RBAC: only allow save if user has edit access
    if (window.RBAC && !window.RBAC.canEditNode(this.currentNodeId)) {
      window.app?.showToast('⛔ View only — you don\'t have edit access to this task', 'error');
      return;
    }
    this.data.updateNode(this.currentNodeId, { [key]: value });
  }

  updatePills(group, value) {
    document.querySelectorAll(`.${group}-pill`).forEach(pill => {
      pill.classList.toggle('active', pill.dataset[group] === value);
    });
  }

  // ── Subtasks ────────────────────────────────────────────────────────────────
  renderSubtasks(subtasks) {
    this.subtaskList.innerHTML = '';
    if (!subtasks.length) {
      this.subtaskList.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:4px 0">No subtasks yet.</div>';
      return;
    }
    subtasks.forEach(st => {
      const item = document.createElement('div');
      item.className = 'subtask-item';
      const cb  = document.createElement('input');
      cb.type   = 'checkbox';
      cb.checked = st.done;
      cb.onchange = () => this.toggleSubtask(st.id, cb.checked);
      const txt = document.createElement('span');
      txt.className = 'subtask-text' + (st.done ? ' done' : '');
      txt.textContent = st.text;
      const del = document.createElement('span');
      del.className = 'delete-subtask';
      del.innerHTML = '✕';
      del.onclick = () => this.deleteSubtask(st.id);
      item.append(cb, txt, del);
      this.subtaskList.appendChild(item);
    });
  }

  addSubtask() {
    const text = this.newSubtaskInput.value.trim();
    if (!text || !this.currentNodeId) return;
    const node = this.data.getNode(this.currentNodeId);
    const subtasks = [...(node.subtasks || []), { id: 'st_' + Date.now().toString(36), text, done: false }];
    this.data.updateNode(this.currentNodeId, { subtasks });
    this.newSubtaskInput.value = '';
    this.renderSubtasks(subtasks);
  }

  toggleSubtask(id, isDone) {
    const node = this.data.getNode(this.currentNodeId);
    const subtasks = node.subtasks.map(st => st.id === id ? { ...st, done: isDone } : st);
    this.data.updateNode(this.currentNodeId, { subtasks });
    this.renderSubtasks(subtasks);
  }

  deleteSubtask(id) {
    const node = this.data.getNode(this.currentNodeId);
    const subtasks = node.subtasks.filter(st => st.id !== id);
    this.data.updateNode(this.currentNodeId, { subtasks });
    this.renderSubtasks(subtasks);
  }

  // ── Collaborators ───────────────────────────────────────────────────────────
  renderCollaborators(collaborators, node) {
    if (!this.collabList) return;
    this.collabList.innerHTML = '';
    if (!collaborators.length) {
      this.collabList.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:4px 0">No collaborators yet.</div>';
      return;
    }
    collaborators.forEach(uid => {
      // Try to find user name
      const users = window._cachedUsers || [];
      const u = users.find(u => u.id === uid);
      const label = u ? u.name : uid;
      const chip = document.createElement('div');
      chip.className = 'assignee-chip';
      chip.innerHTML = `${label}<span class="remove-assignee" title="Remove">✕</span>`;
      chip.querySelector('.remove-assignee').onclick = () => this.removeCollaborator(uid);
      this.collabList.appendChild(chip);
    });
  }

  addCollaborator(userId) {
    const node = this.data.getNode(this.currentNodeId);
    const collabs = [...(node.collaborators || [])];
    if (!collabs.includes(userId)) {
      collabs.push(userId);
      this.data.updateNode(this.currentNodeId, { collaborators: collabs });
      this.renderCollaborators(collabs, node);
    }
  }

  removeCollaborator(userId) {
    const node = this.data.getNode(this.currentNodeId);
    const collabs = (node.collaborators || []).filter(id => id !== userId);
    this.data.updateNode(this.currentNodeId, { collaborators: collabs });
    this.renderCollaborators(collabs, node);
  }

  // ── Owner display ─────────────────────────────────────────────────────────
  renderOwner(node) {
    if (!this.ownerDisplay) return;
    if (node.ownerName) {
      this.ownerDisplay.innerHTML = `<span class="assignee-chip" style="pointer-events:none">${node.ownerName} 🔑</span>`;
    } else if (node.createdBy === 'system' || !node.createdBy) {
      this.ownerDisplay.innerHTML = '<span style="font-size:12px;color:var(--text-muted)">System / Admin</span>';
    } else {
      this.ownerDisplay.innerHTML = `<span class="assignee-chip" style="pointer-events:none">${node.createdBy}</span>`;
    }
  }

  // ── Smart deadline suggest ──────────────────────────────────────────────
  _suggestDeadline() {
    const node = this.data.getNode(this.currentNodeId);
    if (!node) return;
    if (node.dueDate) {
      window.app?.showToast('Deadline already set. Clear it first to suggest a new one.', 'info');
      return;
    }
    const today = new Date();
    const DAYS = { critical: 3, high: 7, medium: 14, low: 30 };
    const days = DAYS[node.priority] || 14;
    today.setDate(today.getDate() + days);
    const suggested = today.toISOString().slice(0, 10);
    this.dueDateInput.value = suggested;
    this.save('dueDate', suggested);
    window.app?.showToast(`✨ Deadline set to ${suggested} (${days} days for ${node.priority || 'medium'} priority)`, 'success');
  }

  // ── Populate user list for collaborator dropdown ─────────────────────────
  async _refreshUserList() {
    try {
      const r = await fetch('/api/users');
      const { users } = await r.json();
      window._cachedUsers = users || [];

      if (this.addCollabSelect) {
        this.addCollabSelect.innerHTML = '<option value="">+ Add collaborator...</option>';
        (users || []).forEach(u => {
          if (u.id !== window.Auth?.userId) {
            this.addCollabSelect.innerHTML += `<option value="${u.id}">${u.name} (${u.role})</option>`;
          }
        });
      }
    } catch(e) {
      console.warn('[Sidebar] Could not load users:', e.message);
    }
  }

  // ── Assignees ───────────────────────────────────────────────────────────────
  renderAssignees(assignees) {
    this.assigneeList.innerHTML = '';
    assignees.forEach(member => {
      const chip = document.createElement('div');
      chip.className = 'assignee-chip';
      chip.innerHTML = `${member}<span class="remove-assignee" title="Remove">✕</span>`;
      chip.querySelector('.remove-assignee').onclick = () => this.removeAssignee(member);
      this.assigneeList.appendChild(chip);
    });
  }

  addAssignee(member) {
    const node = this.data.getNode(this.currentNodeId);
    const assignees = [...(node.assignees || [])];
    if (!assignees.includes(member)) {
      assignees.push(member);
      this.data.updateNode(this.currentNodeId, { assignees });
      this.renderAssignees(assignees);
    }
  }

  removeAssignee(member) {
    const node = this.data.getNode(this.currentNodeId);
    const assignees = (node.assignees || []).filter(m => m !== member);
    this.data.updateNode(this.currentNodeId, { assignees });
    this.renderAssignees(assignees);
  }

  // ── Files & Documents ───────────────────────────────────────────────────────
  _fileIcon(name) {
    const ext = (name || '').split('.').pop().toLowerCase();
    const map = { pdf:'📕', doc:'📘', docx:'📘', xls:'📗', xlsx:'📗',
                  ppt:'📙', pptx:'📙', txt:'📄', jpg:'🖼️', jpeg:'🖼️',
                  png:'🖼️', gif:'🖼️', mp4:'🎥', mov:'🎥', zip:'🗜️', mp3:'🎵' };
    return map[ext] || '📎';
  }

  renderFiles(files) {
    const list    = document.getElementById('sb-files-list');
    const countEl = document.getElementById('sb-files-count');
    if (!list) return;

    countEl.textContent = files.length ? `(${files.length})` : '';

    if (!files.length) {
      list.innerHTML = `<div class="sb-files-empty">No files yet — upload or generate one below.</div>`;
      return;
    }

    list.innerHTML = files.map(f => `
      <div class="sb-file-item" data-id="${f.id}">
        <span class="sb-file-icon">${f.type === 'ai_doc' ? '✨' : this._fileIcon(f.name)}</span>
        <div class="sb-file-body">
          <div class="sb-file-name">${f.name}</div>
          <div class="sb-file-meta">
            ${new Date(f.createdAt).toLocaleDateString('en-IN', { day:'numeric', month:'short' })}
            · ${f.type === 'ai_doc' ? 'AI Generated' : 'Uploaded'}
          </div>
        </div>
        <div class="sb-file-btns">
          <button onclick="window.app.sidebar.openFile('${f.id}')" title="Open">↗</button>
          <button onclick="window.app.sidebar.removeFile('${f.id}')" title="Remove">✕</button>
        </div>
      </div>
    `).join('');
  }

  _addFileToNode(file) {
    if (!this.currentNodeId) return;
    const node  = this.data.getNode(this.currentNodeId);
    const files = [...(node.files || []), file];
    this.data.updateNode(this.currentNodeId, { files });
    this.renderFiles(files);
  }

  removeFile(fileId) {
    const node  = this.data.getNode(this.currentNodeId);
    const files = (node.files || []).filter(f => f.id !== fileId);
    this.data.updateNode(this.currentNodeId, { files });
    this.renderFiles(files);
    window.app?.showToast('File removed', 'info');
  }

  openFile(fileId) {
    const node = this.data.getNode(this.currentNodeId);
    const file = (node.files || []).find(f => f.id === fileId);
    if (!file) return;
    if (file.type === 'ai_doc' && file.docId && window.app?.docs) {
      const doc = window.app.docs.docs.find(d => d.id === file.docId);
      if (doc) { window.app.docs.open(); window.app.docs._openEditor(doc); }
      else window.app?.showToast('Document not found', 'error');
    } else if (file.url) {
      window.open(file.url, '_blank');
    }
  }

  async uploadFiles(fileList) {
    if (!fileList?.length) return;
    const btn = document.querySelector('.sb-btn-upload');
    if (btn) btn.style.opacity = '0.5';

    for (const file of Array.from(fileList)) {
      try {
        const form = new FormData();
        form.append('file', file);
        const res  = await fetch('/api/upload-file', { method: 'POST', body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        this._addFileToNode({
          id: 'f_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
          name: file.name,
          type: 'upload',
          url:  data.url,
          docId: null,
          createdAt: new Date().toISOString(),
          size: file.size,
        });
        window.app?.showToast(`📎 "${file.name}" uploaded`, 'success');
      } catch(e) {
        window.app?.showToast('Upload failed: ' + e.message, 'error');
      }
    }
    if (btn) btn.style.opacity = '';
    // Reset file input
    const inp = document.getElementById('sb-file-upload');
    if (inp) inp.value = '';
  }

  async generateDocForTask() {
    if (!this.currentNodeId) return;
    const node = this.data.getNode(this.currentNodeId);
    if (!node) return;

    const settings = this.data.getSettings();
    if (!window._orgApiKey && !settings.geminiApiKey && !settings.anthropicApiKey) {
      window.app?.showToast('Add your Gemini API key in ⚙️ Settings first', 'error');
      return;
    }

    const btn = document.getElementById('sb-gen-doc');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Generating…'; }

    try {
      // Create doc and open it
      if (!window.app?.docs) throw new Error('Docs module not available');
      const doc = window.app.docs.newDocForTask(node);

      // Link it to this task's file list
      this._addFileToNode({
        id:        'f_' + Date.now(),
        name:      doc.title,
        type:      'ai_doc',
        url:       null,
        docId:     doc.id,
        createdAt: new Date().toISOString(),
      });

      window.app?.showToast(`✨ Doc created and linked to "${node.label}"`, 'success');
    } catch(e) {
      window.app?.showToast('Generation failed: ' + e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '✨ AI Doc'; }
    }
  }
}

window.Sidebar = Sidebar;
