// ─── Version History Log ─────────────────────────────────────────────────────
// Tracks who changed what and when, across all sessions

class HistoryLog {
  constructor(data) {
    this.data    = data;
    this._log    = this._load();
    this._panel  = null;
    this._isOpen = false;
  }

  // ── Open / Close ──────────────────────────────────────────────────────────
  open()   { document.getElementById('history-panel').classList.remove('hidden'); this._isOpen = true; this._render(); }
  close()  { document.getElementById('history-panel').classList.add('hidden');    this._isOpen = false; }
  toggle() { this._isOpen ? this.close() : this.open(); }

  // ── Record a change ───────────────────────────────────────────────────────
  record(type, node, userName) {
    const name  = userName || localStorage.getItem('bits_collab_name') || 'Someone';
    const color = this._colorFor(name);

    let description = '';
    let icon        = '✏️';

    switch (type) {
      case 'add':
        description = `added <strong>${node.label}</strong>`;
        icon = '➕';
        break;
      case 'update':
        description = `updated <strong>${node.label}</strong>`;
        if (node.status === 'done')        { description += ' → marked Done'; icon = '✅'; }
        else if (node.status === 'in_progress') { description += ' → In Progress'; icon = '🔄'; }
        else icon = '✏️';
        break;
      case 'delete':
        description = `deleted a node`;
        icon = '🗑️';
        break;
      case 'move':
        description = `moved <strong>${node.label}</strong>`;
        icon = '↔️';
        break;
      case 'load':
        description = 'imported / reset the map';
        icon = '📥';
        break;
      default:
        description = `made a change`;
    }

    const entry = {
      id:          Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      timestamp:   new Date().toISOString(),
      type,
      icon,
      userName:    name,
      userColor:   color,
      description,
      nodeId:      node?.id   || null,
      nodeLabel:   node?.label || null,
    };

    this._log.unshift(entry);
    if (this._log.length > 200) this._log.pop();
    this._save();

    if (this._isOpen) this._render();
    this._updateBadge();
  }

  // ── Hook into data layer ──────────────────────────────────────────────────
  hookDataLayer() {
    this.data.onChange((type, payload) => {
      // Ignore pure 'load' on app start (too noisy) — only on user-triggered imports
      if (type === 'load') return;
      this.record(type, payload);
    });
  }

  // ── Render the panel list ─────────────────────────────────────────────────
  _render() {
    const list = document.getElementById('history-entries');
    if (!list) return;

    if (!this._log.length) {
      list.innerHTML = `<div class="hist-empty">No changes recorded yet.<br>Start editing your map!</div>`;
      return;
    }

    // Group by date
    const grouped = {};
    for (const entry of this._log) {
      const d = new Date(entry.timestamp);
      const key = this._dateLabel(d);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(entry);
    }

    list.innerHTML = Object.entries(grouped).map(([dateLabel, entries]) => `
      <div class="hist-date-group">
        <div class="hist-date-label">${dateLabel}</div>
        ${entries.map(e => `
          <div class="hist-entry" data-id="${e.id}">
            <div class="hist-avatar" style="background:${e.userColor}" title="${e.userName}">
              ${e.userName.charAt(0).toUpperCase()}
            </div>
            <div class="hist-body">
              <div class="hist-desc">
                <span class="hist-icon">${e.icon}</span>
                <span class="hist-name">${e.userName}</span>
                <span class="hist-action"> ${e.description}</span>
              </div>
              <div class="hist-time">${this._timeLabel(new Date(e.timestamp))}</div>
            </div>
          </div>
        `).join('')}
      </div>
    `).join('');
  }

  _updateBadge() {
    const badge = document.getElementById('history-badge');
    if (!badge) return;
    // Show count of changes in last 24h
    const cutoff = Date.now() - 86400000;
    const recent = this._log.filter(e => new Date(e.timestamp).getTime() > cutoff).length;
    badge.textContent = recent > 99 ? '99+' : recent;
    badge.style.display = recent > 0 ? 'flex' : 'none';
  }

  // ── Persistence ───────────────────────────────────────────────────────────
  _load() {
    try { return JSON.parse(localStorage.getItem('bits_history') || '[]'); } catch { return []; }
  }
  _save() {
    localStorage.setItem('bits_history', JSON.stringify(this._log));
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  _colorFor(name) {
    const colors = ['#FF6B35','#4ECDC4','#45B7D1','#96CEB4','#BB8FCE','#F7DC6F','#85C1E9','#F1948A'];
    let hash = 0;
    for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
    return colors[Math.abs(hash) % colors.length];
  }

  _dateLabel(d) {
    const today     = new Date(); today.setHours(0,0,0,0);
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const t = new Date(d); t.setHours(0,0,0,0);
    if (t.getTime() === today.getTime())     return 'Today';
    if (t.getTime() === yesterday.getTime()) return 'Yesterday';
    return d.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
  }

  _timeLabel(d) {
    return d.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12: true });
  }
}

window.HistoryLog = HistoryLog;
