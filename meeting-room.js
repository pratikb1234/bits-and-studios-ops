// ── Bits & Studios — Live Meeting Room v3 ──────────────────────────────────
// Jitsi Meet + Web Speech transcription + Server-side meeting storage
// All meeting data saved to server — shared across all users, visible to Jarvis
'use strict';

const JITSI_DOMAIN = 'meet.jit.si';

class MeetingRoom {
  constructor(dataLayer) {
    this.data       = dataLayer;
    this.isOpen     = false;
    this.isStarted  = false;
    this.meetingId  = null;   // server-side meeting record ID
    this.roomId     = null;   // Jitsi room name
    this.title      = null;
    this.jitsi      = null;
    this.transcript = [];
    this.recognition= null;
    this.micMuted   = false;
    this.participants = new Map();
    this._txFlushInterval = null;

    this._el = {
      overlay:      document.getElementById('meet-room-modal'),
      roomName:     document.getElementById('meet-room-name'),
      roomMeta:     document.getElementById('meet-room-meta'),
      status:       document.getElementById('meet-status-badge'),
      jitsiWrap:    document.getElementById('jitsi-container'),
      closeBtn:     document.getElementById('meet-room-close'),
      linkBtn:      document.getElementById('meet-link-btn'),
      endBtn:       document.getElementById('meet-end-btn'),
      txBody:       document.getElementById('meet-transcript-body'),
      txCount:      document.getElementById('meet-line-count'),
      pList:        document.getElementById('meet-participants'),
      summaryPnl:   document.getElementById('meet-summary-panel'),
      summaryBody:  document.getElementById('meet-summary-body'),
      saveBtn:      document.getElementById('meet-save-btn'),
      chatInput:    document.getElementById('meet-chat-input'),
      chatSend:     document.getElementById('meet-chat-send'),
      chatBody:     document.getElementById('meet-chat-body'),
    };

    this._bindEvents();
    this._bindSocket();
  }

  /* ── Open ─────────────────────────────────────────────────────────────────── */
  async open() {
    // Show a pre-meeting dialog to set title
    const title = await this._showStartDialog();
    if (title === null) return; // user cancelled

    this.title  = title;
    this.roomId = 'bits-studios-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now().toString(36);

    this._resetPanels();
    if (this._el.overlay) this._el.overlay.classList.remove('hidden');
    if (this._el.roomName) this._el.roomName.textContent = title;
    if (this._el.roomMeta) this._el.roomMeta.textContent = 'Starting…';
    this.isOpen = true;

    // Create server-side record first
    await this._createMeetingOnServer();

    // Broadcast to all portal users via socket
    this._emitSocket('meet:start_session', {
      meetingId: this.meetingId,
      roomId:    this.roomId,
      title:     this.title,
      hostName:  this._me().name,
    });

    // Start Jitsi
    this._startJitsi();
    this._setStatus('connecting', '⟳ Connecting…');
  }

  // Join an existing session (called when user clicks "Join" on the banner)
  async joinSession(session) {
    this.meetingId = session.meetingId;
    this.roomId    = session.roomId;
    this.title     = session.title;

    this._resetPanels();
    if (this._el.overlay) this._el.overlay.classList.remove('hidden');
    if (this._el.roomName) this._el.roomName.textContent = session.title;
    if (this._el.roomMeta) this._el.roomMeta.textContent = `Hosted by ${session.hostName}`;
    this.isOpen = true;

    // Register as participant
    await fetch(`/api/meetings/${this.meetingId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ participant: this._me().name }),
    }).catch(() => {});

    this._startJitsi();
    this._setStatus('connecting', '⟳ Connecting…');
  }

  close() {
    this._stopTranscription();
    clearInterval(this._txFlushInterval);
    if (this.jitsi) { try { this.jitsi.dispose(); } catch(e){} this.jitsi = null; }
    if (this._el.jitsiWrap) this._el.jitsiWrap.innerHTML = '';
    if (this._el.overlay)   this._el.overlay.classList.add('hidden');
    this.isOpen = this.isStarted = false;
  }

  toggle() { this.isOpen ? this.close() : this.open(); }

  /* ── Pre-meeting dialog ─────────────────────────────────────────────────── */
  _showStartDialog() {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'meet-start-overlay';
      overlay.innerHTML = `
        <div class="meet-start-dialog">
          <div class="meet-start-icon">📹</div>
          <div class="meet-start-title">Start a Meeting</div>
          <div class="meet-start-sub">Give this meeting a name so the team knows what it's about</div>
          <input class="meet-start-input" id="meet-title-input" placeholder="e.g. Sprint Review, Daily Standup, Design Review…" maxlength="80" />
          <div class="meet-start-btns">
            <button class="meet-start-cancel">Cancel</button>
            <button class="meet-start-go" id="meet-start-go-btn">📹 Start Meeting</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const input   = overlay.querySelector('#meet-title-input');
      const goBtn   = overlay.querySelector('#meet-start-go-btn');
      const cancel  = overlay.querySelector('.meet-start-cancel');

      // Suggest based on time of day
      const h = new Date().getHours();
      if (h < 10)      input.placeholder = 'Morning Standup';
      else if (h < 13) input.placeholder = 'Mid-Day Check-in';
      else if (h < 18) input.placeholder = 'Afternoon Review';
      else             input.placeholder = 'Evening Sync';

      setTimeout(() => input.focus(), 100);

      const done = (val) => { overlay.remove(); resolve(val); };

      goBtn.addEventListener('click', () => {
        const t = input.value.trim();
        done(t || input.placeholder);
      });
      cancel.addEventListener('click', () => done(null));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { const t = input.value.trim(); done(t || input.placeholder); }
        if (e.key === 'Escape') done(null);
      });
      overlay.addEventListener('click', (e) => { if (e.target === overlay) done(null); });
    });
  }

  /* ── Server: Create meeting record ──────────────────────────────────────── */
  async _createMeetingOnServer() {
    try {
      const res = await fetch('/api/meetings', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ title: this.title, hostName: this._me().name, roomId: this.roomId }),
      });
      const data = await res.json();
      this.meetingId = data.meeting?.id || null;
      console.log('[MeetRoom] Created server meeting:', this.meetingId);
    } catch (err) {
      console.error('[MeetRoom] Failed to create server meeting:', err);
    }
  }

  /* ── Flush transcript to server every 30s ────────────────────────────────── */
  _startTxFlush() {
    let lastFlushCount = 0;
    this._txFlushInterval = setInterval(async () => {
      if (!this.meetingId || this.transcript.length === lastFlushCount) return;
      const newLines = this.transcript.slice(lastFlushCount);
      lastFlushCount = this.transcript.length;
      fetch(`/api/meetings/${this.meetingId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ transcriptLines: newLines }),
      }).catch(() => {});
    }, 30000);
  }

  /* ── Jitsi ──────────────────────────────────────────────────────────────── */
  async _startJitsi() {
    if (typeof JitsiMeetExternalAPI === 'undefined') {
      await this._loadScript(`https://${JITSI_DOMAIN}/external_api.js`);
    }

    const me = this._me();
    if (this._el.jitsiWrap) this._el.jitsiWrap.innerHTML = '';

    const options = {
      roomName:   this.roomId,
      parentNode: this._el.jitsiWrap,
      width:      '100%',
      height:     '100%',
      configOverwrite: {
        startWithAudioMuted:    false,
        startWithVideoMuted:    false,
        prejoinPageEnabled:     false,
        disableDeepLinking:     true,
        enableWelcomePage:      false,
        defaultLanguage:        'en',
        enableNoisyMicDetection:true,
        resolution:             720,
        toolbarButtons: [
          'microphone','camera','desktop','fullscreen',
          'fodeviceselection','hangup','profile','chat',
          'recording','sharedvideo','settings','raisehand',
          'videoquality','filmstrip','tileview','select-background',
          'stats','shortcuts','download','mute-everyone','security',
          'participants-pane',
        ],
      },
      interfaceConfigOverwrite: {
        SHOW_JITSI_WATERMARK:      false,
        SHOW_WATERMARK_FOR_GUESTS: false,
        SHOW_POWERED_BY:           false,
        APP_NAME:                  'Bits & Studios Meet',
        PROVIDER_NAME:             'Bits & Studios',
        TOOLBAR_ALWAYS_VISIBLE:    false,
      },
      userInfo: { displayName: me.name, email: me.email || '' },
    };

    try {
      this.jitsi = new JitsiMeetExternalAPI(JITSI_DOMAIN, options);
      this._bindJitsiEvents();
    } catch (err) {
      this._setStatus('error', '✕ Failed');
      window.app?.showToast('Meeting failed: ' + err.message, 'error');
    }
  }

  _bindJitsiEvents() {
    if (!this.jitsi) return;

    this.jitsi.addListener('videoConferenceJoined', () => {
      this.isStarted = true;
      this._setStatus('live', '🔴 Live');
      this._startTranscription();
      this._startTxFlush();
      this._updateParticipant('me', { name: this._me().name + ' (You)', color: this._me().color });
      if (this._el.roomMeta) this._el.roomMeta.textContent = `Room code: ${this.roomId.split('-').slice(-1)[0]}`;

      // Register self as participant on server
      if (this.meetingId) {
        fetch(`/api/meetings/${this.meetingId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ participant: this._me().name }),
        }).catch(() => {});
      }
    });

    this.jitsi.addListener('participantJoined', (d) => {
      const name = d.displayName || 'Participant';
      this._updateParticipant(d.id, { name, color: this._colorForName(name) });
      this._addSystemLine(`${name} joined`);
      if (this.meetingId) {
        fetch(`/api/meetings/${this.meetingId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ participant: name }),
        }).catch(() => {});
      }
    });

    this.jitsi.addListener('participantLeft', (d) => {
      const p = this.participants.get(d.id);
      if (p) this._addSystemLine(`${p.name} left`);
      this.participants.delete(d.id);
      this._renderParticipants();
    });

    this.jitsi.addListener('displayNameChange', (d) => {
      if (d.id && d.displayname) {
        this._updateParticipant(d.id, { name: d.displayname, color: this._colorForName(d.displayname) });
      }
    });

    this.jitsi.addListener('audioMuteStatusChanged', (d) => {
      this.micMuted = d.muted;
      if (this.micMuted) {
        try { this.recognition?.stop(); } catch(e) {}
      } else if (this.isStarted) {
        setTimeout(() => { try { this.recognition?.start(); } catch(e) {} }, 300);
      }
    });

    this.jitsi.addListener('incomingMessage', (d) => this._addChatMsg(d.from || 'Participant', d.message, false));
    this.jitsi.addListener('outgoingMessage', (d) => this._addChatMsg(this._me().name, d.message, true));

    this.jitsi.addListener('videoConferenceLeft', async () => {
      this.isStarted = false;
      this._setStatus('ended', '✕ Ended');
      this._stopTranscription();
      clearInterval(this._txFlushInterval);
      this._emitSocket('meet:end_session', { roomId: this.roomId });
      await this._endMeeting();
    });
  }

  /* ── End meeting: save everything to server ────────────────────────────── */
  async _endMeeting() {
    if (!this.meetingId) { this._summarise(); return; }

    // First flush all remaining transcript lines
    await fetch(`/api/meetings/${this.meetingId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcriptLines: this.transcript,
        endedAt: new Date().toISOString(),
        status: 'completed',
        participants: Array.from(this.participants.values()).map(p => p.name.replace(' (You)', '')),
      }),
    }).catch(() => {});

    // Generate and save summary
    await this._summarise();
  }

  /* ── AI Summary ─────────────────────────────────────────────────────────── */
  async _summarise() {
    if (!this._el.summaryPnl) return;
    this._el.summaryPnl.classList.remove('hidden');
    if (this._el.summaryBody) {
      this._el.summaryBody.innerHTML = '<div class="meet-summarising"><span class="spin">✨</span> Generating summary…</div>';
    }

    // Switch to transcript tab to show summary
    document.querySelector('[data-tab="transcript"]')?.click();

    const apiKey = window._orgApiKey;
    if (!apiKey || !this.transcript.length) {
      if (this._el.summaryBody) this._el.summaryBody.innerHTML = '<p style="color:#64748b;font-size:12px">No transcript to summarise.</p>';
      return;
    }

    const txText = this.transcript.map(l => `${l.speaker}: ${l.text}`).join('\n');
    const prompt = `You are summarising a meeting for Bits & Studios — a premium Robotics + AI + Coding Makerspace, Ahmedabad, launching June 1 2026.

Meeting title: "${this.title}"
Participants: ${Array.from(this.participants.values()).map(p=>p.name).join(', ')}
Transcript (${this.transcript.length} lines):
${txText}

Write a structured summary:
1. **Key Decisions** — bullet list of concrete decisions
2. **Action Items** — table: | Owner | Action | Deadline |
3. **Discussion Highlights** — 2–3 sentences per topic
4. **Open Questions** — unresolved items

Use names. Be specific. Format in HTML with <h3>, <ul>, <li>, <table>. Content only, no preamble.`;

    try {
      const res  = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 2048 } }),
      });
      const data = await res.json();
      let html = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No summary generated';
      html = html.replace(/```html\n?/g,'').replace(/```\n?/g,'')
                 .replace(/^#{1,6}\s+(.+)$/gm,'<h3>$1</h3>')
                 .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').trim();

      if (this._el.summaryBody) this._el.summaryBody.innerHTML = html;

      // Save summary to server
      if (this.meetingId) {
        await fetch(`/api/meetings/${this.meetingId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ summary: html }),
        }).catch(() => {});
      }

      // Offer to create mindmap node
      this._offerMindmapNode(html);

    } catch (err) {
      if (this._el.summaryBody) this._el.summaryBody.innerHTML = `<p style="color:#ef4444">Summary failed: ${err.message}</p>`;
    }
  }

  /* ── Create mindmap node (with confirmation) ─────────────────────────────── */
  _offerMindmapNode(summary) {
    const overlay = document.createElement('div');
    overlay.className = 'meet-node-offer-overlay';
    overlay.innerHTML = `
      <div class="meet-node-offer">
        <div class="meet-node-offer-icon">🗂</div>
        <div class="meet-node-offer-title">Create a Meeting Node?</div>
        <div class="meet-node-offer-sub">
          Add <strong>"${this.title}"</strong> to the mindmap under the 📅 Meetings node with the AI summary attached.
        </div>
        <div class="meet-node-offer-btns">
          <button class="meet-node-skip">Skip</button>
          <button class="meet-node-create">📅 Create Node</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('.meet-node-skip').onclick = () => overlay.remove();
    overlay.querySelector('.meet-node-create').onclick = () => {
      overlay.remove();
      this._createMindmapNode(summary);
    };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  }

  _createMindmapNode(summary) {
    // Find or create the "📅 Meetings" top-level node
    const root = this.data.getRootNode();
    if (!root) return;

    let meetingsNode = this.data.getAllNodes().find(n =>
      n.parentId === root.id && (n.label?.includes('Meetings') || n.icon === '📅')
    );

    if (!meetingsNode) {
      meetingsNode = this.data.addNode(root.id, {
        label: 'Meetings',
        icon: '📅',
        description: 'All team meeting records — transcripts and AI summaries stored here.',
        status: 'not_started',
        priority: 'medium',
      });
    }

    // Create the meeting record node
    const date = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const participants = Array.from(this.participants.values()).map(p => p.name.replace(' (You)','')).join(', ');

    const node = this.data.addNode(meetingsNode.id, {
      label:       this.title,
      icon:        '📹',
      description: `Meeting on ${date}.\nParticipants: ${participants}\n\n[AI Summary saved — view in Meetings Panel]`,
      status:      'done',
      priority:    'medium',
      meetingId:   this.meetingId,
      meetingDate: new Date().toISOString(),
      ownerName:   this._me().name,
    });

    // Link back on server
    if (this.meetingId) {
      fetch(`/api/meetings/${this.meetingId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkedNodeId: node.id }),
      }).catch(() => {});
    }

    window.app?.showToast(`📅 Meeting node created under "Meetings"`, 'success');
    window.app?.mindMap?.render(true);
  }

  /* ── Transcription ──────────────────────────────────────────────────────── */
  _startTranscription() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { this._addSystemLine('⚠️ Transcription requires Chrome'); return; }

    this.recognition = new SR();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-IN';

    const me = this._me();
    let interimEl = null;

    this.recognition.onresult = (e) => {
      if (this.micMuted) return;
      let interim = '', final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t; else interim += t;
      }
      if (final.trim()) {
        interimEl?.remove(); interimEl = null;
        const line = { speaker: me.name, text: final.trim(), color: me.color, ts: Date.now() };
        this.transcript.push(line);
        this._appendTxLine(me.name, final.trim(), me.color, true);
        this._emitSocket('meet:transcript_line', { roomId: this.roomId, ...line });
      } else if (interim.trim()) {
        if (!interimEl) {
          interimEl = document.createElement('div');
          interimEl.className = 'meet-tx-line meet-tx-interim';
          interimEl.innerHTML = `<span class="meet-tx-spk" style="color:${me.color}">${me.name}</span> <span class="meet-tx-txt"></span>`;
          this._el.txBody?.appendChild(interimEl);
        }
        interimEl.querySelector('.meet-tx-txt').textContent = interim;
        this._scrollTx();
      }
    };
    this.recognition.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') console.warn('[MeetRoom]', e.error); };
    this.recognition.onend = () => {
      if (this.isStarted && !this.micMuted) setTimeout(() => { try { this.recognition?.start(); } catch(e){} }, 300);
    };
    try { this.recognition.start(); } catch(e) {}
  }

  _stopTranscription() { try { this.recognition?.stop(); } catch(e){} this.recognition = null; }

  /* ── UI helpers ─────────────────────────────────────────────────────────── */
  _appendTxLine(speaker, text, color, isLocal) {
    const body = this._el.txBody;
    if (!body) return;
    body.querySelector('.meet-tx-empty')?.remove();
    const el = document.createElement('div');
    el.className = 'meet-tx-line' + (isLocal ? ' meet-tx-mine' : '');
    const t = new Date().toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });
    el.innerHTML = `<div class="meet-tx-header"><span class="meet-tx-spk" style="color:${color||'#94a3b8'}">${speaker}</span><span class="meet-tx-time">${t}</span></div><div class="meet-tx-txt">${text}</div>`;
    body.appendChild(el);
    this._scrollTx();
    const n = body.querySelectorAll('.meet-tx-line:not(.meet-tx-interim)').length;
    if (this._el.txCount) this._el.txCount.textContent = n;
  }

  _addSystemLine(msg) {
    const el = document.createElement('div');
    el.className = 'meet-tx-system';
    el.textContent = msg;
    this._el.txBody?.appendChild(el);
    this._scrollTx();
  }

  _scrollTx() { if (this._el.txBody) this._el.txBody.scrollTop = this._el.txBody.scrollHeight; }

  _addChatMsg(name, text, isMe) {
    const body = this._el.chatBody;
    if (!body) return;
    body.querySelector('.meet-chat-empty')?.remove();
    const el = document.createElement('div');
    el.className = 'meet-chat-msg' + (isMe ? ' meet-chat-mine' : '');
    const t = new Date().toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });
    el.innerHTML = `<span class="meet-chat-name">${isMe ? 'You' : name}</span><div class="meet-chat-bubble">${text}</div><span class="meet-chat-time">${t}</span>`;
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
  }

  _sendChat() {
    const input = this._el.chatInput;
    const text = input?.value?.trim();
    if (!text) return;
    if (this.jitsi) { try { this.jitsi.executeCommand('sendChatMessage', text, '', false); } catch(e){} }
    else { this._addChatMsg(this._me().name, text, true); this._emitSocket('meet:chat', { roomId: this.roomId, name: this._me().name, text }); }
    input.value = '';
  }

  _updateParticipant(id, data) {
    this.participants.set(id, { ...(this.participants.get(id) || {}), ...data });
    this._renderParticipants();
  }

  _renderParticipants() {
    const el = this._el.pList;
    if (!el) return;
    const list = Array.from(this.participants.values());
    if (!list.length) { el.innerHTML = '<div class="meet-p-empty">Join the call to see participants</div>'; return; }
    el.innerHTML = list.map(p => `
      <div class="meet-participant">
        <div class="meet-p-avatar" style="background:${p.color||'#64748b'}">${(p.name||'?')[0]}</div>
        <div class="meet-p-name">${p.name||'Unknown'}</div>
        <div class="meet-p-live"></div>
      </div>`).join('');
  }

  _resetPanels() {
    this.transcript = []; this.participants.clear();
    if (this._el.txBody)   this._el.txBody.innerHTML  = '<div class="meet-tx-empty">Join the call to start transcription</div>';
    if (this._el.chatBody) this._el.chatBody.innerHTML = '<div class="meet-chat-empty">Chat will appear here</div>';
    if (this._el.txCount)  this._el.txCount.textContent = '0';
    if (this._el.summaryPnl) this._el.summaryPnl.classList.add('hidden');
    this._renderParticipants();
  }

  /* ── Socket ─────────────────────────────────────────────────────────────── */
  _bindSocket() {
    const tryBind = () => {
      const s = window._socket || window._agentSocket;
      if (!s) return;
      s.on('meet:transcript_line', (d) => {
        if (d.roomId !== this.roomId || d.speaker === this._me().name) return;
        this.transcript.push(d);
        this._appendTxLine(d.speaker, d.text, d.color, false);
      });
      s.on('meet:chat', (d) => { if (d.roomId === this.roomId) this._addChatMsg(d.name, d.text, false); });
    };
    setTimeout(tryBind, 800);
  }

  /* ── Misc ───────────────────────────────────────────────────────────────── */
  _bindEvents() {
    this._el.closeBtn?.addEventListener('click', () => this.close());
    this._el.saveBtn?.addEventListener('click', () => {
      const node = this.data.getNode(this._linkedNodeId);
      window.app?.showToast(node ? `💾 Saved to "${node.label}"` : '💾 Summary saved to server', 'success');
    });
    this._el.endBtn?.addEventListener('click', () => {
      if (this.jitsi) { try { this.jitsi.executeCommand('hangup'); } catch(e){} }
    });
    this._el.linkBtn?.addEventListener('click', () => {
      const link = `https://${JITSI_DOMAIN}/${this.roomId}`;
      navigator.clipboard?.writeText(link).then(() => window.app?.showToast('🔗 Link copied — share it!', 'success'));
    });
    this._el.chatSend?.addEventListener('click', () => this._sendChat());
    this._el.chatInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._sendChat(); } });
    this._el.overlay?.addEventListener('click', (e) => { if (e.target === this._el.overlay) this.close(); });
  }

  _setStatus(state, text) {
    if (!this._el.status) return;
    this._el.status.textContent = text;
    this._el.status.className = `meet-status-badge meet-status-${state}`;
  }

  _me() {
    const u = window.Auth?.currentUser;
    return { id: u?.id||'anon', name: u?.name||localStorage.getItem('bits_collab_name')||'Me', color: u?.color||'#534AB7', email: u?.email||'' };
  }

  _colorForName(name) {
    const map = { Pratik:'#534AB7', Anjalee:'#1D9E75', Sohil:'#D85A30', Mohit:'#378ADD', Aryan:'#D4537E', Mantasha:'#BA7517', Foram:'#639922' };
    for (const [k,v] of Object.entries(map)) if (name?.toLowerCase().includes(k.toLowerCase())) return v;
    return '#64748b';
  }

  _emitSocket(event, data) { const s = window._socket||window._agentSocket; s?.emit?.(event, data); }

  _loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }
}

window.MeetingRoom = MeetingRoom;
