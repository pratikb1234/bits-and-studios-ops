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

    // Sync API key: prefer server-cached key (set by admin), fallback to user's own
    try {
      const settings = this.data.getSettings();
      // Try to get per-user API key first, then fall back to shared settings
      const userApiKey = window.Auth?.getItem('bits_gemini_key') || '';
      const savedKey   = userApiKey || settings.geminiApiKey || settings.anthropicApiKey || '';
      if (savedKey) {
        if (this.docs)    this.docs.gemini.setApiKey(savedKey);
        if (this.meeting) this.meeting.api.setApiKey(savedKey);
        if (this.chat)    this.chat.api.setApiKey(savedKey);
      }
    } catch(e) { console.warn('[App] Key sync error:', e.message); }

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
    
    this.mindMap.callbacks.onNodeDoubleTap = (node) => {
      // Focus node
      this.mindMap.focusNode(node.id);
    };
    
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
  // Safety net — if JS crashes entirely, remove the overlay after 4s so page isn't blank
  const safetyTimer = setTimeout(() => {
    const overlay = document.getElementById('login-overlay');
    if (overlay && !overlay.classList.contains('hidden')) {
      overlay.classList.add('hidden');
    }
    if (!window.app) {
      try { window.app = new App(); } catch(e) { console.error('[App] Safety init failed:', e); }
    }
  }, 4000);

  // 1. Boot auth (restore session or show login)
  let loggedIn = false;
  try {
    loggedIn = await window.Auth.boot();
  } catch (e) {
    console.warn('[Auth] Boot failed, skipping auth:', e.message);
    loggedIn = true; // let app load even if auth server is unreachable
  }

  if (!loggedIn) {
    // Show login screen — app inits after user picks profile
    window.Auth.showLoginScreen();

    window.addEventListener('auth:login', () => {
      clearTimeout(safetyTimer);
      window.Auth.hideLoginScreen();
      try {
        window.app = new App();
        _bindGlobalShortcuts();
      } catch(e) {
        console.error('[App] Init failed after login:', e);
      }
    }, { once: true });
    return;
  }

  // Already logged in — hide overlay (safety) and launch app
  clearTimeout(safetyTimer);
  window.Auth.hideLoginScreen();
  try {
    window.app = new App();
    _bindGlobalShortcuts();
  } catch(e) {
    console.error('[App] Init failed:', e);
  }
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
