// ─── Bits & Studios — Task Sidebar ──────────────────────────────────────────

class Sidebar {
  constructor(dataLayer) {
    this.data = dataLayer;
    this.el = document.getElementById('sidebar');
    this.currentNodeId = null;
    
    // UI Elements
    this.titleInput = document.getElementById('sb-title');
    this.descInput = document.getElementById('sb-desc');
    this.deptSelect = document.getElementById('sb-dept');
    this.dueDateInput = document.getElementById('sb-due');
    this.subtaskList = document.getElementById('sb-subtasks');
    this.newSubtaskInput = document.getElementById('sb-new-subtask');
    this.addSubtaskBtn = document.getElementById('sb-add-subtask');
    this.assigneeList = document.getElementById('sb-assignees');
    this.newAssigneeSelect = document.getElementById('sb-new-assignee');
    
    this.bindEvents();
    this.populateSelects();
  }
  
  bindEvents() {
    // Close button
    document.getElementById('sb-close').addEventListener('click', () => {
      this.close();
      if (window.app) window.app.mindMap.selectNode(null);
    });
    
    // Auto-save on input blur/change
    this.titleInput.addEventListener('change', () => this.save('label', this.titleInput.value));
    this.descInput.addEventListener('change', () => this.save('description', this.descInput.value));
    this.deptSelect.addEventListener('change', () => {
      this.save('department', this.deptSelect.value);
      // Change color immediately for visual feedback
      this.el.style.borderTopColor = window.DEPARTMENTS[this.deptSelect.value]?.color || 'transparent';
    });
    this.dueDateInput.addEventListener('change', () => this.save('dueDate', this.dueDateInput.value));
    
    // Status pills
    document.querySelectorAll('.status-pill').forEach(pill => {
      pill.addEventListener('click', (e) => {
        this.save('status', e.target.dataset.status);
        this.updatePills('status', e.target.dataset.status);
      });
    });
    
    // Priority pills
    document.querySelectorAll('.priority-pill').forEach(pill => {
      pill.addEventListener('click', (e) => {
        this.save('priority', e.target.dataset.priority);
        this.updatePills('priority', e.target.dataset.priority);
      });
    });
    
    // Subtasks
    this.addSubtaskBtn.addEventListener('click', () => this.addSubtask());
    this.newSubtaskInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.addSubtask();
    });
    
    // Assignees
    this.newAssigneeSelect.addEventListener('change', () => {
       if (this.newAssigneeSelect.value) {
         this.addAssignee(this.newAssigneeSelect.value);
         this.newAssigneeSelect.value = '';
       }
    });
    
    // Actions
    document.getElementById('sb-delete').addEventListener('click', () => {
      if (!this.currentNodeId) return;
      if (this.currentNodeId === 'root') {
         alert("Cannot delete the root node.");
         return;
      }
      if (confirm('Delete this task and all its sub-tasks?')) {
        this.data.deleteNode(this.currentNodeId);
        this.close();
        if (window.app) window.app.mindMap.selectNode(null);
      }
    });
  }
  
  populateSelects() {
    // Departments
    this.deptSelect.innerHTML = '<option value="">No Department</option>';
    for (const [key, dept] of Object.entries(window.DEPARTMENTS)) {
      this.deptSelect.innerHTML += `<option value="${key}">${dept.icon} ${dept.label}</option>`;
    }
  }
  
  refreshTeamList() {
    const team = this.data.getTeam();
    this.newAssigneeSelect.innerHTML = '<option value="">+ Assign to...</option>';
    team.forEach(member => {
      this.newAssigneeSelect.innerHTML += `<option value="${member}">${member}</option>`;
    });
  }
  
  open(nodeId) {
    const node = this.data.getNode(nodeId);
    if (!node) return;
    
    this.currentNodeId = nodeId;
    this.refreshTeamList();
    
    // Populate form
    this.titleInput.value = node.label || '';
    this.descInput.value = node.description || '';
    this.deptSelect.value = node.department || '';
    this.dueDateInput.value = node.dueDate || '';
    
    this.updatePills('status', node.status || 'not_started');
    this.updatePills('priority', node.priority || 'medium');
    
    this.renderSubtasks(node.subtasks || []);
    this.renderAssignees(node.assignees || []);
    
    // Dept color border
    if (node.department && window.DEPARTMENTS[node.department]) {
       this.el.style.borderTop = `3px solid ${window.DEPARTMENTS[node.department].color}`;
    } else {
       this.el.style.borderTop = `none`;
    }
    
    // Disable root delete
    document.getElementById('sb-delete').style.display = (node.id === 'root') ? 'none' : 'block';
    
    this.el.classList.remove('hidden');
  }
  
  close() {
    this.el.classList.add('hidden');
    this.currentNodeId = null;
  }
  
  save(key, value) {
    if (!this.currentNodeId) return;
    this.data.updateNode(this.currentNodeId, { [key]: value });
  }
  
  updatePills(group, value) {
    document.querySelectorAll(`.${group}-pill`).forEach(pill => {
      if (pill.dataset[group] === value) {
        pill.classList.add('active');
      } else {
        pill.classList.remove('active');
      }
    });
  }
  
  // --- Subtasks ---
  renderSubtasks(subtasks) {
    this.subtaskList.innerHTML = '';
    if (!subtasks.length) {
      this.subtaskList.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:4px 0;">No subtasks yet.</div>';
      return;
    }
    
    subtasks.forEach(st => {
      const item = document.createElement('div');
      item.className = 'subtask-item';
      
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = st.done;
      cb.onchange = () => this.toggleSubtask(st.id, cb.checked);
      
      const txt = document.createElement('span');
      txt.className = 'subtask-text' + (st.done ? ' done' : '');
      txt.textContent = st.text;
      
      const del = document.createElement('span');
      del.className = 'delete-subtask';
      del.innerHTML = '✕';
      del.onclick = () => this.deleteSubtask(st.id);
      
      item.appendChild(cb);
      item.appendChild(txt);
      item.appendChild(del);
      this.subtaskList.appendChild(item);
    });
  }
  
  addSubtask() {
    const text = this.newSubtaskInput.value.trim();
    if (!text || !this.currentNodeId) return;
    
    const node = this.data.getNode(this.currentNodeId);
    const subtasks = [...(node.subtasks || [])];
    subtasks.push({
      id: 'st_' + Date.now().toString(36),
      text: text,
      done: false
    });
    
    this.data.updateNode(this.currentNodeId, { subtasks });
    this.newSubtaskInput.value = '';
    this.renderSubtasks(subtasks);
  }
  
  toggleSubtask(id, isDone) {
    const node = this.data.getNode(this.currentNodeId);
    const subtasks = node.subtasks.map(st => 
      st.id === id ? { ...st, done: isDone } : st
    );
    this.data.updateNode(this.currentNodeId, { subtasks });
    this.renderSubtasks(subtasks);
  }
  
  deleteSubtask(id) {
    const node = this.data.getNode(this.currentNodeId);
    const subtasks = node.subtasks.filter(st => st.id !== id);
    this.data.updateNode(this.currentNodeId, { subtasks });
    this.renderSubtasks(subtasks);
  }
  
  // --- Assignees ---
  renderAssignees(assignees) {
    this.assigneeList.innerHTML = '';
    if (!assignees.length) return;
    
    assignees.forEach(member => {
      const chip = document.createElement('div');
      chip.className = 'assignee-chip';
      chip.innerHTML = `
        ${member}
        <span class="remove-assignee" title="Remove">✕</span>
      `;
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
}

window.Sidebar = Sidebar;
