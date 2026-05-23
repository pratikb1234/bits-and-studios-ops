// ── Bits & Studios — Meetings Archive Panel ────────────────────────────────
// Reads from server /api/meetings — shared across all users
// Handles: active session banner, archive list, transcript viewer, search
'use strict';

class MeetingsPanel {
  constructor() {
    this.meetings    = [];
    this.isOpen      = false;
    this.activeSession = null;
    this._bannerTimer  = null;
    this._searchQuery  = '';

    this._el = {
      panel:    document.getElementById('meetings-archive-panel'),
      closeBtn: document.getElementById('map-close-btn'),
      body:     document.getElementById('map-body'),
      sub:      document.getElementById('map-sub'),
      search:   document.getElementById('map-search'),

      // Active session banner
      banner:   document.getElementById('active-session-banner'),
      asbTitle: document.getElementById('asb-title'),
      asbHost:  document.getElementById('asb-host'),
      asbTime:  document.getElementById('asb-time'),
      asbJoin:  document.getElementById('asb-join-btn'),
      asbDismiss:document.getElementById('asb-dismiss'),
    };

    this._bindEvents();
    this._bindSocket();
    this._checkActiveSession();
  }

  /* ── Open / Close ─────────────────────────────────────────────────────── */
  open() {
    this.isOpen = true;
    this._el.panel?.classList.remove('hidden');
    this._loadMeetings();
  }

  close() {
    this.isOpen = false;
    this._el.panel?.classList.add('hidden');
  }

  toggle() { this.isOpen ? this.close() : this.open(); }

  /* ── Load meetings from server ───────────────────────────────────────── */
  async _loadMeetings() {
    if (this._el.body) this._el.body.innerHTML = '<div class="map-loading">⟳ Loading…</div>';
    try {
      const res  = await fetch('/api/meetings');
      const data = await res.json();
      this.meetings = data.meetings || [];
      this._render();
    } catch (err) {
      if (this._el.body) this._el.body.innerHTML = `<div class="map-empty">Could not load meetings: ${err.message}</div>`;
    }
  }

  /* ── Render meeting list ─────────────────────────────────────────────── */
  _render() {
    const q = this._searchQuery.toLowerCase();
    const list = q
      ? this.meetings.filter(m =>
          m.title?.toLowerCase().includes(q) ||
          m.participants?.some(p => p.toLowerCase().includes(q)) ||
          m.summary?.toLowerCase().includes(q) ||
          m.transcript?.some(l => l.text?.toLowerCase().includes(q))
        )
      : this.meetings;

    if (this._el.sub) {
      this._el.sub.textContent = `${this.meetings.length} meeting${this.meetings.length !== 1 ? 's' : ''} · ${list.length} shown`;
    }

    if (!list.length) {
      this._el.body.innerHTML = q
        ? `<div class="map-empty">No meetings match "<em>${q}</em>"</div>`
        : `<div class="map-empty">No meetings yet.<br><span style="color:#475569">Start a meeting with 📹 Live Meet.</span></div>`;
      return;
    }

    this._el.body.innerHTML = list.map(m => this._renderCard(m)).join('');

    // Bind expand toggles
    this._el.body.querySelectorAll('.map-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.map-card-expand-btn')) return;
        const id = card.dataset.meetingId;
        this._expandMeeting(id);
      });
    });
  }

  _renderCard(m) {
    const date = m.startedAt
      ? new Date(m.startedAt).toLocaleDateString('en-IN', { weekday:'short', day:'numeric', month:'short', year:'numeric' })
      : 'Unknown date';
    const time = m.startedAt
      ? new Date(m.startedAt).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' })
      : '';
    const participants = (m.participants || []).slice(0,5);
    const extra = (m.participants || []).length > 5 ? `+${m.participants.length - 5}` : '';
    const isLive = m.status === 'live';

    return `
      <div class="map-card ${isLive ? 'map-card-live' : ''}" data-meeting-id="${m.id}">
        <div class="map-card-header">
          <div class="map-card-left">
            ${isLive ? '<div class="map-live-badge">🔴 Live</div>' : ''}
            <div class="map-card-title">${m.title || 'Untitled Meeting'}</div>
            <div class="map-card-meta">
              ${date} · ${time}
              ${m.duration ? `· ${m.duration}` : ''}
              · ${m.transcriptLines || 0} lines
            </div>
          </div>
          <div class="map-card-right">
            <div class="map-card-avatars">
              ${participants.map(p => `<div class="map-avatar" style="background:${this._colorForName(p)}" title="${p}">${p[0]}</div>`).join('')}
              ${extra ? `<div class="map-avatar map-avatar-extra">+${extra.slice(1)}</div>` : ''}
            </div>
            ${isLive ? `<button class="map-join-btn" onclick="window.app?.meetRoom?.joinSession(${JSON.stringify({ meetingId: m.id, roomId: m.roomId, title: m.title, hostName: m.hostName }).replace(/"/g,'&quot;')})">Join →</button>` : ''}
          </div>
        </div>
        ${m.summary ? `<div class="map-card-summary-preview">${this._stripHtml(m.summary).slice(0,120)}…</div>` : ''}
      </div>
    `;
  }

  /* ── Expand: show full transcript + summary ──────────────────────────── */
  async _expandMeeting(id) {
    const overlay = document.createElement('div');
    overlay.className = 'map-expand-overlay';
    overlay.innerHTML = `<div class="map-expand-dialog"><div class="map-expand-loading">⟳ Loading meeting…</div></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    try {
      const res  = await fetch(`/api/meetings/${id}`);
      const data = await res.json();
      const m    = data.meeting;

      const date = new Date(m.startedAt).toLocaleString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' });
      const participants = (m.participants || []).join(', ') || 'None recorded';
      const txLines = (m.transcript || []).map(l =>
        `<div class="met-tx-row"><span class="met-tx-spk" style="color:${this._colorForName(l.speaker)}">${l.speaker}</span><span class="met-tx-text">${l.text}</span><span class="met-tx-ts">${new Date(l.ts).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}</span></div>`
      ).join('') || '<div style="color:#475569;font-size:12px;padding:16px">No transcript recorded</div>';

      overlay.querySelector('.map-expand-dialog').innerHTML = `
        <div class="map-expand-header">
          <div>
            <div class="map-expand-title">${m.title}</div>
            <div class="map-expand-meta">${date} · ${m.duration || 'Duration unknown'} · ${m.transcriptLines || 0} transcript lines</div>
            <div class="map-expand-participants">👥 ${participants}</div>
          </div>
          <button class="map-expand-close">✕</button>
        </div>
        <div class="map-expand-tabs">
          <button class="map-exp-tab active" data-tab="summary">✨ AI Summary</button>
          <button class="map-exp-tab" data-tab="transcript">📝 Full Transcript</button>
        </div>
        <div class="map-exp-body" id="map-exp-body-${id}">
          <div class="map-exp-pane active" id="met-summary-pane">
            ${m.summary || '<div style="color:#475569;padding:24px;text-align:center">No summary generated yet</div>'}
          </div>
          <div class="map-exp-pane hidden" id="met-tx-pane">
            <div class="met-tx-list">${txLines}</div>
          </div>
        </div>
      `;

      // Tab switching
      overlay.querySelectorAll('.map-exp-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          overlay.querySelectorAll('.map-exp-tab').forEach(t => t.classList.remove('active'));
          overlay.querySelectorAll('.map-exp-pane').forEach(p => p.classList.add('hidden'));
          tab.classList.add('active');
          overlay.querySelector('#met-' + tab.dataset.tab + '-pane')?.classList.remove('hidden');
        });
      });
      overlay.querySelector('.map-expand-close').addEventListener('click', () => overlay.remove());

    } catch (err) {
      overlay.querySelector('.map-expand-dialog').innerHTML = `<div style="color:#ef4444;padding:32px">Failed to load: ${err.message}</div><button onclick="this.closest('.map-expand-overlay').remove()">Close</button>`;
    }
  }

  /* ── Active Session Banner ───────────────────────────────────────────── */
  _checkActiveSession() {
    fetch('/api/meetings/active')
      .then(r => r.json())
      .then(({ session }) => { if (session) this._showBanner(session); })
      .catch(() => {});
  }

  _showBanner(session) {
    this.activeSession = session;
    if (!this._el.banner) return;
    if (this._el.asbTitle) this._el.asbTitle.textContent = session.title || 'Meeting in progress';
    if (this._el.asbHost)  this._el.asbHost.textContent  = `Started by ${session.hostName}`;
    this._el.banner.classList.remove('hidden');
    this._startBannerTimer(session.startedAt);
  }

  _hideBanner() {
    this.activeSession = null;
    this._el.banner?.classList.add('hidden');
    clearInterval(this._bannerTimer);
  }

  _startBannerTimer(startedAt) {
    clearInterval(this._bannerTimer);
    const update = () => {
      const ms   = Date.now() - new Date(startedAt).getTime();
      const mins = Math.floor(ms / 60000);
      const secs = Math.floor((ms % 60000) / 1000);
      if (this._el.asbTime) this._el.asbTime.textContent = `${mins}:${String(secs).padStart(2,'0')}`;
    };
    update();
    this._bannerTimer = setInterval(update, 1000);
  }

  /* ── Socket bindings — hear about new sessions ───────────────────────── */
  _bindSocket() {
    const tryBind = () => {
      const s = window._socket || window._agentSocket;
      if (!s) { setTimeout(tryBind, 1200); return; }

      s.on('meet:session_broadcast', (session) => {
        this._showBanner(session);
        window.app?.showToast(`📹 ${session.hostName} started "${session.title}" — Join Now`, 'info');
      });

      s.on('meet:session_ended', () => {
        this._hideBanner();
        // Reload meetings list if panel is open
        if (this.isOpen) this._loadMeetings();
      });
    };
    setTimeout(tryBind, 1000);
  }

  /* ── Bindings ─────────────────────────────────────────────────────────── */
  _bindEvents() {
    this._el.closeBtn?.addEventListener('click', () => this.close());

    this._el.asbJoin?.addEventListener('click', () => {
      if (this.activeSession) {
        window.app?.meetRoom?.joinSession(this.activeSession);
      }
    });

    this._el.asbDismiss?.addEventListener('click', () => {
      this._el.banner?.classList.add('hidden');
      clearInterval(this._bannerTimer);
    });

    this._el.search?.addEventListener('input', (e) => {
      this._searchQuery = e.target.value;
      this._render();
    });
  }

  /* ── Helpers ─────────────────────────────────────────────────────────── */
  _colorForName(name) {
    const map = { Pratik:'#534AB7', Anjalee:'#1D9E75', Sohil:'#D85A30', Mohit:'#378ADD', Aryan:'#D4537E', Mantasha:'#BA7517', Foram:'#639922' };
    for (const [k,v] of Object.entries(map)) if (name?.toLowerCase().includes(k.toLowerCase())) return v;
    return '#64748b';
  }

  _stripHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || '';
  }

  /* ── Static: build Jarvis context from all meetings ─────────────────── */
  static async buildJarvisContext() {
    try {
      const res  = await fetch('/api/meetings');
      const data = await res.json();
      const meetings = (data.meetings || []).filter(m => m.summary || m.transcriptLines > 0);
      if (!meetings.length) return '';

      const lines = meetings.map(m => {
        const date = m.startedAt ? new Date(m.startedAt).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : 'Unknown date';
        const parts = (m.participants || []).join(', ');
        const summaryText = m.summary ? MeetingsPanel._strip(m.summary).slice(0, 600) : 'No summary';
        return `[${date}] "${m.title}" (${m.duration || '?'} · ${parts})\n${summaryText}`;
      });

      return `\n\n── MEETING HISTORY (${meetings.length} meetings) ──\n` + lines.join('\n\n---\n');
    } catch { return ''; }
  }

  static _strip(html) {
    const d = document.createElement('div'); d.innerHTML = html; return d.textContent || '';
  }
}

window.MeetingsPanel = MeetingsPanel;
