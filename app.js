// ─── Bits & Studios — Main Controller ─────────────────────────────────────

class App {
  constructor() {
    // ⚡ Set window.app FIRST so buttons always work even if a module fails
    window.app = this;

    this.data = new MindMapData();
    if (!this.data.load()) this.data.initDefaults();

    // Expose globals early
    window.showToast = (msg, type) => this.showToast(msg, type);
    window.DB = this.data;

    // Init each module with individual fault isolation
    this._initModule('mindMap',    () => new MindMap('mindmap-container', this.data));
    this._initModule('sidebar',    () => new Sidebar(this.data));
    this._initModule('chat',       () => new ChatPanel(this.data));
    this._initModule('meeting',    () => new MeetingProcessor(this.data, new GeminiAPI()));
    this._initModule('history',    () => new HistoryLog(this.data));
    this._initModule('docs',       () => new DocsPanel(this.data, new GeminiAPI()));
    this._initModule('search',     () => new SearchOverlay(this.data, this.mindMap));
    this._initModule('agentPanel', () => new AgentPanel(this.data));  // must be last

    if (this.history) this.history.hookDataLayer();

    // Step 1 — use any locally saved key immediately (fast)
    try {
      const settings  = this.data.getSettings();
      const localKey  = window.Auth?.getItem('bits_gemini_key') || settings.geminiApiKey || settings.anthropicApiKey || '';
      if (localKey) {
        window._orgApiKey = localKey;
        if (this.docs)    this.docs.gemini.setApiKey(localKey);
        if (this.meeting) this.meeting.api.setApiKey(localKey);
        if (this.chat)    this.chat.api.setApiKey(localKey);
      }
    } catch(e) { console.warn('[App] Local key error:', e.message); }

    // Step 2 — always fetch from server env var (GEMINI_API_KEY overrides everything)
    fetch('/api/check-key')
      .then(r => r.json())
      .then(({ key }) => {
        if (!key) return;
        window._orgApiKey = key;
        if (this.docs)    this.docs.gemini.setApiKey(key);
        if (this.meeting) this.meeting.api.setApiKey(key);
        if (this.chat)    this.chat.api.setApiKey(key);
        console.log('[App] ✅ Org API key loaded from server env');
      })
      .catch(e => console.warn('[App] Could not fetch org key:', e.message));

    this.bindEvents();
    this.updateStats();

    console.log('[App] ✅ Initialized. Modules:',
      ['mindMap','sidebar','chat','meeting','history','docs','search','agentPanel']
        .map(k => `${k}:${this[k] ? '✓' : '✗'}`).join(' '));
  }

  _initModule(name, factory) {
    try {
      this[name] = factory();
    } catch(err) {
      console.error(`[App] ❌ ${name} failed to init:`, err);
      this[name] = null;
      // Show a visible but non-blocking error
      setTimeout(() => {
        this.showToast(`⚠️ Module "${name}" failed: ${err.message}`, 'error');
      }, 1000);
    }
  }

  bindEvents() {
    // Data changes -> Update UI
    this.data.onChange((type, payload) => {
      this.mindMap.render();
      this.updateStats();
      
      // Keep sidebar in sync if node changes
      if (this.sidebar.currentNodeId) {
         // Don't re-render entire sidebar on every tiny keystroke save,
         // only if structural changes or external updates happen.
         if (['add', 'delete', 'move'].includes(type)) {
           // Basic handle
         }
      }
    });
    
    // Node interactions
    this.mindMap.callbacks.onNodeSelect = (nodeId) => {
      if (nodeId) {
        this.sidebar.open(nodeId);
      } else {
        this.sidebar.close();
      }
    };
    
    // ── Undo / Redo ────────────────────────────────────────────────────────
    document.getElementById('tb-undo')?.addEventListener('click', () => this._undo());
    document.getElementById('tb-redo')?.addEventListener('click', () => this._redo());

    // ── Live Meeting Room ───────────────────────────────────────────────────
    this.meetRoom = new MeetingRoom(this.data);
    document.getElementById('tb-meet-room')?.addEventListener('click', () => this.meetRoom.open());

    this.meetingsPanel = new MeetingsPanel();
    document.getElementById('tb-meetings-archive')?.addEventListener('click', () => this.meetingsPanel.toggle());

    // Meeting room tab switcher
    document.querySelectorAll('.meet-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.meet-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.meet-tab-pane').forEach(p => p.classList.add('hidden'));
        tab.classList.add('active');
        const pane = document.getElementById('meet-tab-' + tab.dataset.tab);
        pane?.classList.remove('hidden');
      });
    });

    // ── Keyboard shortcuts ──────────────────────────────────────────────────
    document.addEventListener('keydown', (e) => {
      const meta = e.metaKey || e.ctrlKey;
      // Undo: Cmd+Z
      if (meta && !e.shiftKey && e.key === 'z' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        this._undo();
      }
      // Redo: Cmd+Shift+Z
      if (meta && e.shiftKey && e.key === 'z') {
        e.preventDefault();
        this._redo();
      }
      // Delete selected node: Del / Backspace (only when nothing is focused)
      if ((e.key === 'Delete' || e.key === 'Backspace') && document.activeElement === document.body) {
        const nodeId = this.mindMap?.selectedNodeId;
        if (nodeId) { e.preventDefault(); this._confirmDelete(nodeId); }
      }
    });

    // ── Node change flash ───────────────────────────────────────────────────
    this.data.onChange((type, payload) => {
      if (type === 'update' && payload?.id) {
        setTimeout(() => {
          const el = document.getElementById('ui-' + payload.id);
          if (el) {
            el.classList.add('mm-node-flash');
            setTimeout(() => el.classList.remove('mm-node-flash'), 1800);
          }
        }, 60);
      }
      this._updateUndoRedoBtns();
    });

    // Toolbar Actions
    document.getElementById('tb-add-node').addEventListener('click', () => {
      const parentId = this.mindMap.selectedNodeId || 'root';
      const node = this.data.addNode(parentId, { label: 'New Task', icon: '📌' });
      this.mindMap.selectNode(node.id);
    });
    
    document.getElementById('tb-zoom-in').addEventListener('click', () => {
       this.mindMap.svg.transition().call(this.mindMap.zoom.scaleBy, 1.2);
    });
    document.getElementById('tb-zoom-out').addEventListener('click', () => {
       this.mindMap.svg.transition().call(this.mindMap.zoom.scaleBy, 0.8);
    });
    document.getElementById('tb-zoom-fit').addEventListener('click', () => {
       this.mindMap.svg.transition().call(this.mindMap.zoom.transform, d3.zoomIdentity.translate(this.mindMap.width/2, this.mindMap.height/2).scale(0.8));
    });
    
    // Settings / Export / Import
    document.getElementById('tb-settings').addEventListener('click', () => this.showSettingsModal());
    document.getElementById('tb-export').addEventListener('click', () => this.exportData());
    document.getElementById('tb-import').addEventListener('click', () => {
       document.getElementById('import-file-input').click();
    });
    
    document.getElementById('import-file-input').addEventListener('change', (e) => {
       if (e.target.files.length > 0) {
         this.importData(e.target.files[0]);
       }
    });

    // ── Meeting Panel ──────────────────────────────────────────────────────
    document.getElementById('tb-meeting').addEventListener('click', () => this.meeting.toggle());
    document.getElementById('close-meeting').addEventListener('click',  () => this.meeting.close());

    document.getElementById('mtg-process-btn').addEventListener('click', () => {
      const transcript = document.getElementById('mtg-transcript').value.trim();
      const title      = document.getElementById('mtg-title').value.trim();
      if (!transcript) {
        this.meeting._showError('Please paste a meeting transcript first.');
        return;
      }
      const settings = this.data.getSettings();
      this.meeting.api.setApiKey(settings.anthropicApiKey || '');
      this.meeting.processTranscript(transcript, title);
    });

    document.getElementById('mtg-file-upload').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        document.getElementById('mtg-transcript').value = ev.target.result;
        document.getElementById('mtg-title').value = file.name.replace(/\.[^.]+$/, '');
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    document.querySelectorAll('.mtg-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.mtg-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.dataset.tab;
        document.getElementById('mtg-tab-process').classList.toggle('hidden', target !== 'process');
        document.getElementById('mtg-tab-history').classList.toggle('hidden', target !== 'history');
        if (target === 'history') this.meeting._renderHistory();
      });
    });

    // ── Docs Panel ─────────────────────────────────────────────
    document.getElementById('tb-docs').addEventListener('click', () => this.docs.toggle());

    // ── History Panel ─────────────────────────────────────────────────
    document.getElementById('tb-history').addEventListener('click', () => this.history.toggle());
    document.getElementById('close-history').addEventListener('click', () => this.history.close());

    // ── Mobile Hamburger ───────────────────────────────────────────
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const toolbarActions = document.getElementById('toolbar-actions');
    const toolbarStats   = document.querySelector('.toolbar-stats');
    const mobileOverlay  = document.getElementById('mobile-overlay');

    const closeMobileMenu = () => {
      toolbarActions.classList.remove('mobile-open');
      toolbarStats?.classList.remove('mobile-open');
      mobileOverlay.classList.remove('visible');
      mobileMenuBtn.textContent = '☰';
    };

    mobileMenuBtn.addEventListener('click', () => {
      const isOpen = toolbarActions.classList.contains('mobile-open');
      if (isOpen) {
        closeMobileMenu();
      } else {
        toolbarActions.classList.add('mobile-open');
        toolbarStats?.classList.add('mobile-open');
        mobileOverlay.classList.add('visible');
        mobileMenuBtn.textContent = '✕';
      }
    });

    mobileOverlay.addEventListener('click', closeMobileMenu);

    // Close mobile menu when any panel-opening action is triggered
    ['tb-add-node','tb-zoom-in','tb-zoom-out','tb-zoom-fit','tb-history','tb-export','tb-import','tb-settings'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', closeMobileMenu);
    });

    // Modal closes
    document.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
       btn.addEventListener('click', () => {
         btn.closest('.modal-overlay').classList.add('hidden');
       });
    });
  }
  
  // ── Undo / Redo ─────────────────────────────────────────────────────────────
  _undo() {
    const ok = this.data.undo();
    if (ok) {
      this.mindMap?.render(true);
      this.showToast('↩ Undone — Cmd+Shift+Z to redo', 'info');
    } else {
      this.showToast('Nothing to undo', 'info');
    }
    this._updateUndoRedoBtns();
  }

  _redo() {
    const ok = this.data.redo();
    if (ok) {
      this.mindMap?.render(true);
      this.showToast('↪ Redone', 'info');
    } else {
      this.showToast('Nothing to redo', 'info');
    }
    this._updateUndoRedoBtns();
  }

  _updateUndoRedoBtns() {
    const undoBtn = document.getElementById('tb-undo');
    const redoBtn = document.getElementById('tb-redo');
    if (undoBtn) undoBtn.disabled = (this.data._undoStack?.length || 0) === 0;
    if (redoBtn) redoBtn.disabled = (this.data._redoStack?.length || 0) === 0;
  }

  _confirmDelete(nodeId) {
    const node = this.data.getNode(nodeId);
    if (!node || !node.parentId) return; // can't delete root

    const descendants = this.data.getDescendants(nodeId);
    const childCount  = descendants.length;

    const modal    = document.getElementById('delete-confirm-modal');
    const titleEl  = document.getElementById('delete-modal-title');
    const subEl    = document.getElementById('delete-modal-sub');
    const cancelEl = document.getElementById('delete-modal-cancel');
    const confirmEl= document.getElementById('delete-modal-confirm');
    if (!modal) {
      // Fallback to native confirm
      if (confirm(`Delete "${node.label}"${childCount ? ` and ${childCount} sub-tasks` : ''}?`)) {
        this.data.deleteNode(nodeId);
        this.mindMap?.selectNode(null);
        this.sidebar?.close();
      }
      return;
    }

    titleEl.textContent = `Delete "${node.label}"?`;
    subEl.innerHTML = (childCount > 0
      ? `This will also delete <strong>${childCount} sub-task${childCount !== 1 ? 's' : ''}</strong>. `
      : '') + 'Can be undone with <kbd>Cmd+Z</kbd>.';

    modal.classList.remove('hidden');

    const cleanup = () => modal.classList.add('hidden');
    const doDelete = () => {
      cleanup();
      this.data.deleteNode(nodeId);
      this.mindMap?.selectNode(null);
      this.sidebar?.close();
      this._updateUndoRedoBtns();
      this.showToast(`🗑 "${node.label}" deleted — Cmd+Z to undo`, 'info');
    };

    // Remove old listeners then re-add
    cancelEl.replaceWith(cancelEl.cloneNode(true));
    confirmEl.replaceWith(confirmEl.cloneNode(true));
    document.getElementById('delete-modal-cancel').addEventListener('click', cleanup);
    document.getElementById('delete-modal-confirm').addEventListener('click', doDelete);
    // Close on backdrop
    const backdropClose = (e) => { if (e.target === modal) { cleanup(); modal.removeEventListener('click', backdropClose); } };
    modal.addEventListener('click', backdropClose);
  }

  updateStats() {

    const nodes = this.data.getAllNodes();
    const tasks = nodes.filter(n => n.id !== 'root' && n.parentId !== 'root');
    const doneTasks = tasks.filter(n => n.status === 'done');
    
    document.getElementById('stat-total-tasks').textContent = tasks.length;
    
    const overallProgress = this.data.getOverallProgress();
    const pct = Math.round(overallProgress * 100);
    
    document.getElementById('stat-completion-pct').textContent = `${pct}%`;
    
    // Update top progress ring
    const ring = document.querySelector('#toolbar .coverage-ring .fg');
    if (ring) {
       const len = 2 * Math.PI * 10; // r=10
       ring.style.strokeDasharray = len;
       ring.style.strokeDashoffset = len - (len * overallProgress);
    }
  }
  
  showSettingsModal() {
    const modal = document.getElementById('settings-modal');
    modal.classList.remove('hidden');

    const settings = this.data.getSettings();
    document.getElementById('setting-api-key').value       = settings.geminiApiKey || settings.anthropicApiKey || '';
    document.getElementById('setting-gmail-user').value    = settings.gmailUser    || '';
    document.getElementById('setting-gmail-pass').value    = settings.gmailPass    || '';
    document.getElementById('setting-google-client-id').value = settings.googleClientId || '';
    
    const team = this.data.getTeam();
    document.getElementById('setting-team').value = team.join(', ');
    
    const saveBtn = document.getElementById('save-settings');
    // Remove old listeners to avoid multiple fires
    const newSaveBtn = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
    
    newSaveBtn.addEventListener('click', () => {
      const apiKey      = document.getElementById('setting-api-key').value.trim();
      const gmailUser   = document.getElementById('setting-gmail-user').value.trim();
      const gmailPass   = document.getElementById('setting-gmail-pass').value.trim();
      const googleId    = document.getElementById('setting-google-client-id').value.trim();
      const teamStr     = document.getElementById('setting-team').value;

      const newSettings = { ...settings, geminiApiKey: apiKey, gmailUser, gmailPass, googleClientId: googleId };
      this.data.saveSettings(newSettings);

      // Update live API instances
      if (apiKey) {
        this.chat.api.setApiKey(apiKey);
        this.docs.gemini.setApiKey(apiKey);
        this.meeting.api.setApiKey(apiKey);
        // Push key to server so /api/chat proxy always has it
        fetch('/api/save-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ geminiApiKey: apiKey }),
        }).then(() => console.log('[App] Gemini key synced to server'))
          .catch(e => console.warn('[App] Key sync failed:', e.message));
      }
      this.chat.settings = newSettings;
      this.chat.render();

      // Persist Gmail creds to server
      if (gmailUser || gmailPass) {
        fetch('/api/email-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ emailUser: gmailUser, emailPass: gmailPass }),
        }).catch(() => {});
      }

      const teamArr = teamStr.split(',').map(s => s.trim()).filter(Boolean);
      this.data.saveTeam(teamArr);
      if (this.sidebar) this.sidebar.refreshTeamList();

      modal.classList.add('hidden');
      this.showToast('✅ Settings saved', 'success');
    });
  }
  
  exportData() {
    const json = this.data.exportJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bits_studios_map_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.showToast('Data exported successfully', 'success');
  }
  
  importData(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      if (this.data.importJSON(e.target.result)) {
        this.mindMap.render();
        this.showToast('Data imported successfully', 'success');
      } else {
        this.showToast('Invalid JSON file format', 'error');
      }
    };
    reader.readAsText(file);
    document.getElementById('import-file-input').value = '';
  }
  
  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');

    // Cap at 3 — remove oldest if more
    while (container.children.length >= 3) {
      container.firstChild.remove();
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icon = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' }[type] || 'ℹ️';

    toast.innerHTML = `
      <span class="toast-icon">${icon}</span>
      <span class="toast-message">${message}</span>
      <button class="toast-close" onclick="this.closest('.toast').remove()">✕</button>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('leaving');
      toast.addEventListener('animationend', () => toast.remove(), { once: true });
    }, 2500);
  }
}

// Bootstrap — auth first, then app
document.addEventListener('DOMContentLoaded', async () => {
  // Boot auth — loads users list, clears stale session
  try { await window.Auth.boot(); } catch(e) { console.warn('[Auth] boot:', e.message); }

  // Always show login screen — no auto-bypass
  window.Auth.showLoginScreen();

  // App starts only after user clicks their profile
  window.addEventListener('auth:login', () => {
    window.Auth.hideLoginScreen();
    try {
      window.app = new App();
      _bindGlobalShortcuts();
    } catch(e) {
      console.error('[App] Init failed after login:', e);
      alert('Error starting app: ' + e.message + '\n\nPlease reload the page.');
    }
  }, { once: true });
});

function _bindGlobalShortcuts() {
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      if (e.shiftKey) {
        window.app.data.redo();
      } else {
        window.app.data.undo();
      }
    }
  });
}
