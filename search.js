// ─── Search Overlay — Spotlight-style node navigation ─────────────────────────

class SearchOverlay {
  constructor(data, mindMap) {
    this.data    = data;
    this.mindMap = mindMap;
    this.isOpen  = false;
    this._selectedIdx = 0;
    this._results     = [];
    this._bindKeys();
  }

  // ── Open / Close ───────────────────────────────────────────────────────────
  open() {
    this.isOpen = true;
    document.getElementById('search-overlay').classList.remove('hidden');
    const inp = document.getElementById('search-input-field');
    inp.value = '';
    inp.focus();
    this._query('');
  }

  close() {
    this.isOpen = false;
    document.getElementById('search-overlay').classList.add('hidden');
    document.getElementById('search-input-field').value = '';
    // Remove any highlight
    document.querySelectorAll('.mm-node.search-highlight').forEach(el =>
      el.classList.remove('search-highlight')
    );
  }

  toggle() { this.isOpen ? this.close() : this.open(); }

  // ── Global keyboard shortcuts ──────────────────────────────────────────────
  _bindKeys() {
    document.addEventListener('keydown', (e) => {
      // Open with Ctrl+F / Cmd+F or just "/"
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        this.open();
        return;
      }
      if (e.key === '/' && !this.isOpen &&
          !['INPUT','TEXTAREA'].includes(document.activeElement?.tagName) &&
          !document.activeElement?.isContentEditable) {
        e.preventDefault();
        this.open();
        return;
      }
      if (!this.isOpen) return;

      if (e.key === 'Escape')   { this.close(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); this._moveSelection(1); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); this._moveSelection(-1); return; }
      if (e.key === 'Enter')     { e.preventDefault(); this._navigateToSelected(); return; }
    });
  }

  // ── Query & render results ─────────────────────────────────────────────────
  _query(text) {
    const q = (text || '').toLowerCase().trim();
    const all = this.data.getAllNodes().filter(n => n.id !== 'root');

    if (!q) {
      // Show recent / in-progress / high-priority nodes first
      this._results = all
        .sort((a, b) => {
          const score = n => {
            let s = 0;
            if (n.status === 'in_progress') s += 3;
            if (n.priority === 'critical')  s += 4;
            if (n.priority === 'high')      s += 2;
            if (n.dueDate && new Date(n.dueDate) < new Date()) s += 5; // overdue
            return s;
          };
          return score(b) - score(a);
        })
        .slice(0, 12);
    } else {
      this._results = all.filter(n =>
        (n.label        || '').toLowerCase().includes(q) ||
        (n.description  || '').toLowerCase().includes(q) ||
        (n.department   || '').toLowerCase().includes(q) ||
        (n.assignees    || []).some(a => a.toLowerCase().includes(q)) ||
        (n.status       || '').toLowerCase().includes(q) ||
        (n.priority     || '').toLowerCase().includes(q)
      ).slice(0, 12);
    }

    this._selectedIdx = 0;
    this._renderResults(q);
  }

  _renderResults(q) {
    const list = document.getElementById('search-results-list');
    const count = document.getElementById('search-result-count');
    const statusMap   = { not_started: 'Not Started', in_progress: '🔄 In Progress', done: '✅ Done' };
    const priorityMap = { low: '', medium: '', high: '🔴', critical: '🚨' };

    count.textContent = this._results.length
      ? `${this._results.length} result${this._results.length !== 1 ? 's' : ''}`
      : (q ? 'No results' : 'Showing priority tasks');

    if (!this._results.length) {
      list.innerHTML = `<div class="search-empty">
        ${q ? `<span>No nodes match "<strong>${q}</strong>"</span>` : '<span>No tasks yet. Add nodes to your map.</span>'}
      </div>`;
      return;
    }

    list.innerHTML = this._results.map((node, i) => {
      const deptColors = {
        marketing:'#ec4899', operations:'#6366f1', finance:'#10b981',
        curriculum:'#f59e0b', technology:'#3b82f6', community:'#8b5cf6',
      };
      const deptColor = deptColors[node.department] || '#94a3b8';
      const isOverdue = node.dueDate && new Date(node.dueDate) < new Date() && node.status !== 'done';
      const due = node.dueDate
        ? new Date(node.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
        : '';

      // Highlight matched text
      const label = q
        ? (node.label || '').replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi'),
            '<mark>$1</mark>')
        : (node.label || '');

      return `
        <div class="search-result-item ${i === this._selectedIdx ? 'selected' : ''}"
             data-idx="${i}"
             onclick="window.app.search._navigateTo('${node.id}')">
          <div class="sr-icon">${node.icon || '📌'}</div>
          <div class="sr-body">
            <div class="sr-label">${label}</div>
            <div class="sr-meta">
              ${node.department ? `<span class="sr-dept" style="background:${deptColor}20;color:${deptColor}">${node.department}</span>` : ''}
              <span class="sr-status">${statusMap[node.status] || 'Not Started'}</span>
              ${node.assignees?.length ? `<span class="sr-assignee">👤 ${node.assignees.join(', ')}</span>` : ''}
              ${due ? `<span class="sr-due ${isOverdue ? 'overdue' : ''}">📅 ${due}${isOverdue ? ' ⚠️' : ''}</span>` : ''}
              ${priorityMap[node.priority] ? `<span class="sr-priority">${priorityMap[node.priority]}</span>` : ''}
            </div>
            ${node.description ? `<div class="sr-desc">${node.description.slice(0, 80)}${node.description.length > 80 ? '…' : ''}</div>` : ''}
          </div>
          <div class="sr-arrow">→</div>
        </div>`;
    }).join('');
  }

  _moveSelection(dir) {
    const max = this._results.length;
    if (!max) return;
    this._selectedIdx = (this._selectedIdx + dir + max) % max;
    this._renderResults(document.getElementById('search-input-field').value);
    // Scroll selected into view
    const sel = document.querySelector('.search-result-item.selected');
    sel?.scrollIntoView({ block: 'nearest' });
  }

  _navigateToSelected() {
    const node = this._results[this._selectedIdx];
    if (node) this._navigateTo(node.id);
  }

  _navigateTo(nodeId) {
    this.close();

    // Select the node in sidebar
    this.mindMap.selectNode(nodeId);

    // Find the node's rendered position in the SVG and zoom to it
    const nodeEl = document.getElementById('ui-' + nodeId);
    if (!nodeEl) return;

    const svgEl    = this.mindMap.svg.node();
    const svgRect  = svgEl.getBoundingClientRect();
    const nodeRect = nodeEl.getBoundingClientRect();

    // Node center relative to SVG
    const nx = nodeRect.left + nodeRect.width  / 2 - svgRect.left;
    const ny = nodeRect.top  + nodeRect.height / 2 - svgRect.top;

    // Current transform
    const currentTransform = d3.zoomTransform(svgEl);

    // Compute translation to center this node
    const targetX = svgRect.width  / 2 - nx * currentTransform.k / currentTransform.k;
    const targetY = svgRect.height / 2 - ny * currentTransform.k / currentTransform.k;

    // Zoom in slightly and center
    const scale = Math.max(currentTransform.k, 1.0);
    const t = d3.zoomIdentity
      .translate(
        svgRect.width  / 2 - (nx - svgRect.width  / 2 + svgRect.width  / 2 - currentTransform.x) * scale / currentTransform.k,
        svgRect.height / 2 - (ny - svgRect.height / 2 + svgRect.height / 2 - currentTransform.y) * scale / currentTransform.k
      )
      .scale(scale);

    // Simpler approach — use the raw SVG node position
    this._zoomToNode(nodeId, scale);

    // Pulse highlight
    nodeEl.classList.add('search-highlight');
    setTimeout(() => nodeEl.classList.remove('search-highlight'), 2500);
  }

  _zoomToNode(nodeId, targetScale = 1.2) {
    // Get node data position from D3 layout
    const svgEl = this.mindMap.svg.node();
    const svgRect = svgEl.getBoundingClientRect();

    // Find the D3 node element transform
    const nodeEl = d3.select('#ui-' + nodeId);
    if (nodeEl.empty()) return;

    const transform = nodeEl.attr('transform');
    if (!transform) return;

    const match = transform.match(/translate\(([^,]+),([^)]+)\)/);
    if (!match) return;

    const nx = parseFloat(match[1]);
    const ny = parseFloat(match[2]);

    const tx = svgRect.width  / 2 - nx * targetScale;
    const ty = svgRect.height / 2 - ny * targetScale;

    this.mindMap.svg.transition().duration(600).call(
      this.mindMap.zoom.transform,
      d3.zoomIdentity.translate(tx, ty).scale(targetScale)
    );
  }
}

window.SearchOverlay = SearchOverlay;
