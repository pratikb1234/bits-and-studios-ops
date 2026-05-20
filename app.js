// ─── Bits & Studios — Main Controller ─────────────────────────────────────

class App {
  constructor() {
    this.data = new MindMapData();
    
    // Try to load existing data, else init defaults
    if (!this.data.load()) {
      this.data.initDefaults();
    }
    
    // Init components
    this.mindMap = new MindMap('mindmap-container', this.data);
    this.sidebar = new Sidebar(this.data);
    this.chat = new ChatPanel(this.data);
    
    this.bindEvents();
    this.updateStats();
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
    document.getElementById('setting-api-key').value = settings.anthropicApiKey || '';
    
    const team = this.data.getTeam();
    document.getElementById('setting-team').value = team.join(', ');
    
    const saveBtn = document.getElementById('save-settings');
    // Remove old listeners to avoid multiple fires
    const newSaveBtn = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
    
    newSaveBtn.addEventListener('click', () => {
      const apiKey = document.getElementById('setting-api-key').value.trim();
      const teamStr = document.getElementById('setting-team').value;
      
      this.data.saveSettings({ ...settings, anthropicApiKey: apiKey });
      this.chat.api.setApiKey(apiKey);
      this.chat.render();
      
      const teamArr = teamStr.split(',').map(s => s.trim()).filter(s => s);
      this.data.saveTeam(teamArr);
      if (this.sidebar) this.sidebar.refreshTeamList();
      
      modal.classList.add('hidden');
      this.showToast('Settings saved successfully', 'success');
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
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '❌';
    if (type === 'warning') icon = '⚠️';
    
    toast.innerHTML = `
      <span class="toast-icon">${icon}</span>
      <span class="toast-message">${message}</span>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
      toast.classList.add('leaving');
      toast.addEventListener('animationend', () => toast.remove());
    }, 3000);
  }
}

// Bootstrap
document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
  
  // Undo/Redo shortcuts
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      if (e.shiftKey) {
        window.app.data.redo();
      } else {
        window.app.data.undo();
      }
    }
  });
});
