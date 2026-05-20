// ─── Bits & Studios — Data Layer ──────────────────────────────────────
// Manages mind-map node tree, localStorage persistence, import/export

const DEPARTMENTS = {
  space_design:   { label: 'Space Design & Build-out', icon: '🏗️', color: '#f472b6' },
  operations:     { label: 'Operations (Daily)',       icon: '⚙️', color: '#6366f1' },
  marketing:      { label: 'Marketing & Branding',     icon: '📢', color: '#8b5cf6' },
  finance:        { label: 'Finance & Revenue',         icon: '💰', color: '#10b981' },
  community:      { label: 'Community & Memberships',   icon: '👥', color: '#06b6d4' },
  equipment:      { label: 'Equipment & Tools',         icon: '🛠️', color: '#f59e0b' },
  legal:          { label: 'Legal & Compliance',         icon: '📋', color: '#64748b' },
  partnerships:   { label: 'Partnerships & Events',     icon: '🤝', color: '#f97316' },
};

const STATUS_META = {
  not_started:  { label: 'Not Started',  color: '#64748b', weight: 0 },
  in_progress:  { label: 'In Progress',  color: '#f59e0b', weight: 0.5 },
  done:         { label: 'Done',          color: '#10b981', weight: 1 },
};

const PRIORITY_META = {
  low:      { label: 'Low',      color: '#64748b' },
  medium:   { label: 'Medium',   color: '#3b82f6' },
  high:     { label: 'High',     color: '#f59e0b' },
  critical: { label: 'Critical', color: '#ef4444' },
};

const STORAGE_KEY = 'bits_studios_mindmap';
const TEAM_STORAGE_KEY = 'bits_studios_team';
const CHAT_STORAGE_KEY = 'bits_studios_chat';
const SETTINGS_KEY = 'bits_studios_settings';

/* ── helpers ── */
let _idCounter = 0;
function generateId() {
  return 'node_' + Date.now().toString(36) + '_' + (++_idCounter).toString(36);
}

function createNode(overrides = {}) {
  return {
    id: generateId(),
    label: 'New Node',
    description: '',
    department: null,
    status: 'not_started',
    priority: 'medium',
    assignees: [],
    dueDate: null,
    subtasks: [],        // [{id, text, done}]
    parentId: null,
    icon: '',
    collapsed: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/* ── MindMapData class ── */
class MindMapData {
  constructor() {
    this._nodes = new Map();   // id → node
    this._listeners = [];
    this._undoStack = [];
    this._redoStack = [];
  }

  /* ── CRUD ── */
  getNode(id)     { return this._nodes.get(id) || null; }
  getAllNodes()    { return Array.from(this._nodes.values()); }
  getRootNode()   { return this.getAllNodes().find(n => n.parentId === null) || null; }

  getChildren(id) {
    return this.getAllNodes().filter(n => n.parentId === id);
  }

  getDescendants(id) {
    const result = [];
    const stack = [...this.getChildren(id)];
    while (stack.length) {
      const node = stack.pop();
      result.push(node);
      stack.push(...this.getChildren(node.id));
    }
    return result;
  }

  getAncestors(id) {
    const result = [];
    let current = this.getNode(id);
    while (current && current.parentId) {
      current = this.getNode(current.parentId);
      if (current) result.push(current);
    }
    return result;
  }

  addNode(parentId, data = {}) {
    this._pushUndo();
    const parent = this.getNode(parentId);
    if (!parent) throw new Error('Parent not found: ' + parentId);
    const dept = data.department || parent.department;
    const node = createNode({
      ...data,
      parentId,
      department: dept,
    });
    this._nodes.set(node.id, node);
    this.save();
    this._emit('add', node);
    return node;
  }

  updateNode(id, updates) {
    this._pushUndo();
    const node = this.getNode(id);
    if (!node) throw new Error('Node not found: ' + id);
    Object.assign(node, updates, { updatedAt: new Date().toISOString() });
    this.save();
    this._emit('update', node);
    return node;
  }

  deleteNode(id) {
    this._pushUndo();
    const node = this.getNode(id);
    if (!node) return;
    if (!node.parentId) return; // Can't delete root
    const descendants = this.getDescendants(id);
    for (const d of descendants) this._nodes.delete(d.id);
    this._nodes.delete(id);
    this.save();
    this._emit('delete', { id, descendants: descendants.map(d => d.id) });
  }

  moveNode(id, newParentId) {
    this._pushUndo();
    const node = this.getNode(id);
    if (!node || !node.parentId) return; // Can't move root
    // Prevent circular move
    const ancestorIds = this.getAncestors(newParentId).map(n => n.id);
    if (ancestorIds.includes(id) || newParentId === id) return;
    node.parentId = newParentId;
    // Update department to match new parent branch
    const parent = this.getNode(newParentId);
    if (parent) {
      const dept = parent.department;
      if (dept) {
        node.department = dept;
        for (const d of this.getDescendants(id)) d.department = dept;
      }
    }
    node.updatedAt = new Date().toISOString();
    this.save();
    this._emit('move', node);
  }

  /* ── Progress ── */
  getNodeProgress(id) {
    const children = this.getChildren(id);
    if (children.length === 0) {
      return STATUS_META[this.getNode(id)?.status || 'not_started'].weight;
    }
    const total = children.reduce((sum, c) => sum + this.getNodeProgress(c.id), 0);
    return total / children.length;
  }

  getDepartmentProgress(department) {
    const deptNodes = this.getAllNodes().filter(n => n.department === department && n.parentId);
    if (deptNodes.length === 0) return 0;
    // Get top-level department node
    const root = this.getRootNode();
    if (!root) return 0;
    const deptRoot = this.getChildren(root.id).find(n => n.department === department);
    if (!deptRoot) return 0;
    return this.getNodeProgress(deptRoot.id);
  }

  getOverallProgress() {
    const root = this.getRootNode();
    if (!root) return 0;
    return this.getNodeProgress(root.id);
  }

  /* ── Tree conversion for D3 ── */
  toTreeData() {
    const root = this.getRootNode();
    if (!root) return null;

    const buildTree = (node) => {
      const children = this.getChildren(node.id)
        .filter(c => !node.collapsed || false);
      return {
        ...node,
        progress: this.getNodeProgress(node.id),
        children: node.collapsed ? [] : children.map(c => buildTree(c)),
        _childCount: this.getDescendants(node.id).length,
      };
    };
    return buildTree(root);
  }

  /* Flat links for force layout */
  getLinks() {
    return this.getAllNodes()
      .filter(n => n.parentId)
      .map(n => ({ source: n.parentId, target: n.id }));
  }

  /* ── Persistence ── */
  save() {
    try {
      const data = JSON.stringify(this.getAllNodes());
      localStorage.setItem(STORAGE_KEY, data);
    } catch (e) {
      console.error('Failed to save:', e);
    }
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const nodes = JSON.parse(raw);
        this._nodes.clear();
        for (const n of nodes) this._nodes.set(n.id, n);
        this._emit('load');
        return true;
      }
    } catch (e) {
      console.error('Failed to load:', e);
    }
    return false;
  }

  exportJSON() {
    return JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      nodes: this.getAllNodes(),
      team: this.getTeam(),
    }, null, 2);
  }

  importJSON(jsonStr) {
    try {
      const data = JSON.parse(jsonStr);
      if (!data.nodes) throw new Error('Invalid format');
      this._pushUndo();
      this._nodes.clear();
      for (const n of data.nodes) this._nodes.set(n.id, n);
      if (data.team) this.saveTeam(data.team);
      this.save();
      this._emit('load');
      return true;
    } catch (e) {
      console.error('Import failed:', e);
      return false;
    }
  }

  /* ── Team ── */
  getTeam() {
    try {
      return JSON.parse(localStorage.getItem(TEAM_STORAGE_KEY) || '[]');
    } catch { return []; }
  }

  saveTeam(members) {
    localStorage.setItem(TEAM_STORAGE_KEY, JSON.stringify(members));
  }

  addTeamMember(name) {
    const team = this.getTeam();
    if (!team.includes(name)) {
      team.push(name);
      this.saveTeam(team);
    }
    return team;
  }

  removeTeamMember(name) {
    let team = this.getTeam();
    team = team.filter(m => m !== name);
    this.saveTeam(team);
    return team;
  }

  /* ── Chat History ── */
  getChatHistory() {
    try {
      return JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY) || '[]');
    } catch { return []; }
  }

  saveChatHistory(messages) {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages));
  }

  /* ── Settings ── */
  getSettings() {
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    } catch { return {}; }
  }

  saveSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  /* ── Undo/Redo ── */
  _pushUndo() {
    const snap = JSON.stringify(this.getAllNodes());
    this._undoStack.push(snap);
    if (this._undoStack.length > 50) this._undoStack.shift();
    this._redoStack = [];
  }

  undo() {
    if (this._undoStack.length === 0) return false;
    this._redoStack.push(JSON.stringify(this.getAllNodes()));
    const snap = this._undoStack.pop();
    const nodes = JSON.parse(snap);
    this._nodes.clear();
    for (const n of nodes) this._nodes.set(n.id, n);
    this.save();
    this._emit('load');
    return true;
  }

  redo() {
    if (this._redoStack.length === 0) return false;
    this._undoStack.push(JSON.stringify(this.getAllNodes()));
    const snap = this._redoStack.pop();
    const nodes = JSON.parse(snap);
    this._nodes.clear();
    for (const n of nodes) this._nodes.set(n.id, n);
    this.save();
    this._emit('load');
    return true;
  }

  /* ── Events ── */
  onChange(callback) {
    this._listeners.push(callback);
    return () => {
      this._listeners = this._listeners.filter(l => l !== callback);
    };
  }

  _emit(type, payload) {
    for (const cb of this._listeners) {
      try { cb(type, payload); } catch (e) { console.error('Listener error:', e); }
    }
  }

  /* ── Initialize with default makerspace nodes ── */
  initDefaults() {
    this._nodes.clear();

    const root = createNode({
      id: 'root',
      label: 'Bits & Studios',
      description: 'Build What You Imagine - Pedagoging Studios LLP (Launch: 2026-06-01)',
      icon: '🎯',
      status: 'in_progress',
    });
    this._nodes.set(root.id, root);

    // Department nodes
    for (const [key, dept] of Object.entries(DEPARTMENTS)) {
      const deptNode = createNode({
        id: 'dept_' + key,
        label: dept.label,
        icon: dept.icon,
        department: key,
        parentId: 'root',
        status: 'in_progress',
      });
      this._nodes.set(deptNode.id, deptNode);
    }

    // Custom Bits and Studios Data
    const customData = [
      {
        department: 'marketing',
        label: 'Brand Manifesto',
        icon: '💎',
        children: [
          { label: 'Five-line manifesto', description: 'Every child is a builder. Schools teach what to think. We teach how to make.', status: 'done', priority: 'critical', assignees: ['Pratik'] },
          { label: 'Long-form brand story', description: 'Why we exist, what we believe, who we are', status: 'not_started', priority: 'high', assignees: ['Pratik'], dueDate: '2026-05-31' },
          { label: 'Define brand enemy explicitly', description: "What we stand against - aggressive edtech (Byju's), shallow enrichment", status: 'not_started', priority: 'critical', assignees: ['Pratik'] },
        ]
      },
      {
        department: 'finance',
        label: 'Monthly Burn Management',
        icon: '🔥',
        children: [
          { label: 'Monthly burn ₹5.5L target', description: 'Rent ₹1.55L + Team ₹1.90L + Personal ₹2L + Ops ₹50k', status: 'not_started', priority: 'critical', assignees: ['Pratik'] },
          { label: 'Daily expense tracking', description: 'Every expense logged. Monthly P&L review with CA.', status: 'not_started', priority: 'critical', assignees: ['Pratik', 'CA'] },
          { label: '12-month rolling cash flow forecast', description: 'Updated monthly. Identifies cash gaps before they happen.', status: 'not_started', priority: 'critical', assignees: ['Pratik'] },
        ]
      },
      {
        department: 'finance',
        label: 'Revenue & Compliance',
        icon: '⚖️',
        children: [
          { label: 'Setup Pedagoging LLP account', description: 'LLP account -> setup costs directly', status: 'not_started', priority: 'critical', assignees: ['Pratik'], dueDate: '2026-05-25' },
          { label: 'Collect AIS settlement ₹14.5L', description: 'Follow up with AIS. Goes to emergency buffer.', status: 'in_progress', priority: 'critical', assignees: ['Pratik'], dueDate: '2026-06-30' }
        ]
      }
    ];

    for (const group of customData) {
      const groupNode = createNode({
        label: group.label,
        icon: group.icon,
        department: group.department,
        parentId: 'dept_' + group.department,
        status: 'in_progress'
      });
      this._nodes.set(groupNode.id, groupNode);

      if (group.children) {
        for (const child of group.children) {
          const childNode = createNode({
            ...child,
            department: group.department,
            parentId: groupNode.id,
          });
          this._nodes.set(childNode.id, childNode);
        }
      }
    }

    // Fill in other departments so map is not empty
    const defaultSubAreas = {
      space_design: [
        { label: 'Floor Plan & Layout', icon: '📐' },
        { label: 'Workstation Zones', icon: '🪑' },
        { label: 'Safety Infrastructure', icon: '🧯' },
      ],
      operations: [
        { label: 'Opening/Closing SOPs', icon: '📖' },
        { label: 'Staff Scheduling', icon: '📅' },
      ],
      community: [
        { label: 'Membership Tiers', icon: '🎫' },
        { label: 'Events Calendar', icon: '🗓️' },
      ],
      equipment: [
        { label: '3D Printers', icon: '🖨️' },
        { label: 'Laser Cutters', icon: '⚡' },
        { label: 'Woodworking Tools', icon: '🪚' },
      ],
      legal: [
        { label: 'Waivers & Liability', icon: '✍️' },
        { label: 'Permits & Zoning', icon: '🏛️' },
      ],
      partnerships: [
        { label: 'Local Schools & Colleges', icon: '🎓' },
        { label: 'Workshop Instructors', icon: '👨‍🏫' },
      ],
    };

    for (const [dept, areas] of Object.entries(defaultSubAreas)) {
      for (const area of areas) {
        const node = createNode({
          label: area.label,
          icon: area.icon,
          department: dept,
          parentId: 'dept_' + dept,
        });
        this._nodes.set(node.id, node);
      }
    }

    this.save();
    this._emit('load');
  }
}

// Export as global
window.MindMapData = MindMapData;
window.DEPARTMENTS = DEPARTMENTS;
window.STATUS_META = STATUS_META;
window.PRIORITY_META = PRIORITY_META;
window.generateId = generateId;
window.createNode = createNode;
