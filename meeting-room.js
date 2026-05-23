// ── Bits & Studios — Live Meeting Room v2 ──────────────────────────────────
// Jitsi Meet (free, open-source, full Zoom/Meet feature parity) +
// Web Speech API per-user transcription (diarized by portal identity) +
// Socket.io team notifications + Gemini end-of-meeting AI summary
'use strict';

const JITSI_DOMAIN = 'meet.jit.si';

class MeetingRoom {
  constructor(dataLayer) {
    this.data        = dataLayer;
    this.isOpen      = false;
    this.isStarted   = false;
    this.roomId      = null;
    this.nodeId      = null;
    this.jitsi       = null;        // JitsiMeetExternalAPI instance
    this.transcript  = [];          // [{speaker, text, color, ts}]
    this.recognition = null;        // Web Speech API
    this.micMuted    = false;       // mirrors Jitsi mute state
    this.participants= new Map();   // peerId → {name, color}

    // Cache DOM refs
    this._el = {
      overlay:    document.getElementById('meet-room-modal'),
      roomName:   document.getElementById('meet-room-name'),
      roomMeta:   document.getElementById('meet-room-meta'),
      status:     document.getElementById('meet-status-badge'),
      jitsiWrap:  document.getElementById('jitsi-container'),
      closeBtn:   document.getElementById('meet-room-close'),
      linkBtn:    document.getElementById('meet-link-btn'),
      endBtn:     document.getElementById('meet-end-btn'),
      txBody:     document.getElementById('meet-transcript-body'),
      txCount:    document.getElementById('meet-line-count'),
      participantList: document.getElementById('meet-participants'),
      summaryPnl: document.getElementById('meet-summary-panel'),
      summaryBody:document.getElementById('meet-summary-body'),
      saveBtn:    document.getElementById('meet-save-btn'),
      chatInput:  document.getElementById('meet-chat-input'),
      chatSend:   document.getElementById('meet-chat-send'),
      chatBody:   document.getElementById('meet-chat-body'),
    };

    this._bindEvents();
    this._bindSocket();
  }

  /* ── Public ─────────────────────────────────────────────────────────────── */
  open(nodeId, label) {
    this.nodeId = nodeId || null;
    this.roomId = nodeId
      ? 'bits-studios-' + nodeId.replace(/[^a-zA-Z0-9]/g, '-')
      : 'bits-studios-' + Math.random().toString(36).slice(2, 9);

    if (this._el.roomName) this._el.roomName.textContent = label || 'Live Meeting Room';
    if (this._el.roomMeta) this._el.roomMeta.textContent = `Room: ${this.roomId}`;

    this._resetPanels();
    this._el.overlay?.classList.remove('hidden');
    this.isOpen = true;

    this._setStatus('lobby', '○ Lobby');
    this._startJitsi();
  }

  close() {
    this._stopTranscription();
    if (this.jitsi) { try { this.jitsi.dispose(); } catch(e) {} this.jitsi = null; }
    if (this._el.jitsiWrap) this._el.jitsiWrap.innerHTML = '';
    this._el.overlay?.classList.add('hidden');
    this.isOpen    = false;
    this.isStarted = false;
    this._emitSocket('meet:leave', { roomId: this.roomId, name: this._me().name });
  }

  toggle(nodeId, label) {
    this.isOpen ? this.close() : this.open(nodeId, label);
  }

  /* ── Jitsi setup ────────────────────────────────────────────────────────── */
  async _startJitsi() {
    // Load Jitsi External API if not present
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
        startWithAudioMuted:     false,
        startWithVideoMuted:     false,
        prejoinPageEnabled:      false,
        disableDeepLinking:      true,
        enableWelcomePage:       false,
        enableClosePage:         false,
        disableInviteFunctions:  false,
        defaultLanguage:         'en',
        enableNoisyMicDetection: true,
        enableTalkWhileMuted:    true,
        resolution:              720,
        constraints: {
          video: { height: { ideal: 720, max: 1080, min: 180 } }
        },
        // Show all toolbar buttons like a real video call app
        toolbarButtons: [
          'microphone', 'camera', 'desktop', 'fullscreen',
          'fodeviceselection', 'hangup', 'profile', 'chat',
          'recording', 'sharedvideo', 'settings', 'raisehand',
          'videoquality', 'filmstrip', 'tileview', 'select-background',
          'stats', 'shortcuts', 'download', 'mute-everyone',
          'security', 'participants-pane',
        ],
      },
      interfaceConfigOverwrite: {
        SHOW_JITSI_WATERMARK:      false,
        SHOW_WATERMARK_FOR_GUESTS: false,
        SHOW_POWERED_BY:           false,
        DEFAULT_REMOTE_DISPLAY_NAME: 'Team Member',
        APP_NAME:                  'Bits & Studios Meet',
        NATIVE_APP_NAME:           'Bits & Studios',
        PROVIDER_NAME:             'Bits & Studios',
        HIDE_INVITE_MORE_HEADER:   false,
        TOOLBAR_ALWAYS_VISIBLE:    false,
        DISABLE_JOIN_LEAVE_NOTIFICATIONS: false,
      },
      userInfo: {
        displayName: me.name,
        email:       me.email || '',
        avatarUrl:   me.avatarUrl || '',
      },
    };

    try {
      this.jitsi = new JitsiMeetExternalAPI(JITSI_DOMAIN, options);
      this._bindJitsiEvents();
      this._setStatus('connecting', '⟳ Connecting…');
    } catch (err) {
      console.error('[MeetRoom] Jitsi init failed:', err);
      window.app?.showToast('Could not start meeting: ' + err.message, 'error');
    }
  }

  _bindJitsiEvents() {
    if (!this.jitsi) return;

    // Joined the conference
    this.jitsi.addListener('videoConferenceJoined', (data) => {
      this.isStarted = true;
      this._setStatus('live', '🔴 Live');
      this._startTranscription();
      this._emitSocket('meet:join', { roomId: this.roomId, name: this._me().name, color: this._me().color });
      this._updateParticipant('me', { name: this._me().name + ' (You)', color: this._me().color, active: true });
      window.app?.showToast('📹 Joined meeting — transcription started', 'success');
    });

    // Someone else joined
    this.jitsi.addListener('participantJoined', (data) => {
      const name = data.displayName || 'Participant';
      this._updateParticipant(data.id, { name, color: this._colorForName(name), active: true });
      this._addSystemLine(`${name} joined the call`);
    });

    // Someone left
    this.jitsi.addListener('participantLeft', (data) => {
      const p = this.participants.get(data.id);
      if (p) this._addSystemLine(`${p.name} left the call`);
      this.participants.delete(data.id);
      this._renderParticipants();
    });

    // Display names updated (when remote participant sets their name)
    this.jitsi.addListener('displayNameChange', (data) => {
      if (data.id && data.displayname) {
        this._updateParticipant(data.id, { name: data.displayname, color: this._colorForName(data.displayname) });
      }
    });

    // Mute state — pause transcription when muted
    this.jitsi.addListener('audioMuteStatusChanged', (data) => {
      this.micMuted = data.muted;
      if (this.micMuted) {
        try { this.recognition?.stop(); } catch(e) {}
      } else if (this.isStarted) {
        setTimeout(() => { try { this.recognition?.start(); } catch(e) {} }, 300);
      }
    });

    // Chat messages from Jitsi — show in our chat panel too
    this.jitsi.addListener('incomingMessage', (data) => {
      this._addChatMessage(data.from || 'Participant', data.message, false);
    });
    this.jitsi.addListener('outgoingMessage', (data) => {
      this._addChatMessage(this._me().name + ' (You)', data.message, true);
    });

    // Meeting ended (someone clicked Hangup)
    this.jitsi.addListener('videoConferenceLeft', () => {
      this.isStarted = false;
      this._setStatus('ended', '✕ Ended');
      this._stopTranscription();
      this._emitSocket('meet:leave', { roomId: this.roomId, name: this._me().name });
      if (this.transcript.length > 0) this._summariseMeeting();
    });

    // Screen share
    this.jitsi.addListener('screenSharingStatusChanged', (data) => {
      this._addSystemLine(data.on
        ? `${this._me().name} started screen sharing`
        : `Screen sharing stopped`);
    });

    // Recording
    this.jitsi.addListener('recordingStatusChanged', (data) => {
      if (data.on) window.app?.showToast('🔴 Recording started', 'info');
    });

    // Error
    this.jitsi.addListener('errorOccurred', (data) => {
      console.warn('[MeetRoom] Jitsi error:', data);
    });
  }

  /* ── Transcription ──────────────────────────────────────────────────────── */
  _startTranscription() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      this._addSystemLine('⚠️ Live transcription requires Chrome browser');
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous     = true;
    this.recognition.interimResults = true;
    this.recognition.lang           = 'en-IN';
    this.recognition.maxAlternatives= 1;

    const me = this._me();
    let interimEl = null;

    this.recognition.onresult = (e) => {
      if (this.micMuted) return;

      let interim = '';
      let final   = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t;
        else interim += t;
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
          interimEl.innerHTML = `<span class="meet-tx-spk" style="color:${me.color}">${me.name}</span><span class="meet-tx-txt"></span>`;
          this._el.txBody?.appendChild(interimEl);
        }
        interimEl.querySelector('.meet-tx-txt').textContent = interim;
        this._scrollTx();
      }
    };

    this.recognition.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      console.warn('[MeetRoom] Speech error:', e.error);
    };

    this.recognition.onend = () => {
      if (this.isStarted && !this.micMuted) {
        setTimeout(() => { try { this.recognition?.start(); } catch(e) {} }, 300);
      }
    };

    try { this.recognition.start(); } catch(e) {}
  }

  _stopTranscription() {
    try { this.recognition?.stop(); } catch(e) {}
    this.recognition = null;
  }

  /* ── Transcript UI ──────────────────────────────────────────────────────── */
  _appendTxLine(speaker, text, color, isLocal) {
    const body = this._el.txBody;
    if (!body) return;
    body.querySelector('.meet-tx-empty')?.remove();

    const el  = document.createElement('div');
    el.className = 'meet-tx-line' + (isLocal ? ' meet-tx-mine' : '');
    const t  = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    el.innerHTML = `
      <div class="meet-tx-header">
        <span class="meet-tx-spk" style="color:${color || '#94a3b8'}">${speaker}</span>
        <span class="meet-tx-time">${t}</span>
      </div>
      <div class="meet-tx-txt">${text}</div>
    `;
    body.appendChild(el);
    this._scrollTx();

    const n = body.querySelectorAll('.meet-tx-line:not(.meet-tx-interim)').length;
    if (this._el.txCount) this._el.txCount.textContent = n + ' lines';
  }

  _addSystemLine(msg) {
    const body = this._el.txBody;
    if (!body) return;
    const el = document.createElement('div');
    el.className = 'meet-tx-system';
    el.textContent = msg;
    body.appendChild(el);
    this._scrollTx();
  }

  _scrollTx() {
    if (this._el.txBody) this._el.txBody.scrollTop = this._el.txBody.scrollHeight;
  }

  /* ── Chat panel ──────────────────────────────────────────────────────────── */
  _addChatMessage(name, text, isMe) {
    const body = this._el.chatBody;
    if (!body) return;
    body.querySelector('.meet-chat-empty')?.remove();

    const el = document.createElement('div');
    el.className = 'meet-chat-msg' + (isMe ? ' meet-chat-mine' : '');
    const t = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    el.innerHTML = `
      <span class="meet-chat-name">${isMe ? 'You' : name}</span>
      <div class="meet-chat-bubble">${text}</div>
      <span class="meet-chat-time">${t}</span>
    `;
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
  }

  _sendChat() {
    const input = this._el.chatInput;
    const text  = input?.value?.trim();
    if (!text) return;

    // Send via Jitsi (shows in their chat) + our panel
    if (this.jitsi) {
      try { this.jitsi.executeCommand('sendChatMessage', text, '', false); } catch(e) {}
    } else {
      // If Jitsi not active, send via Socket.io only
      this._addChatMessage(this._me().name, text, true);
      this._emitSocket('meet:chat', { roomId: this.roomId, name: this._me().name, text });
    }
    input.value = '';
  }

  /* ── Participants panel ───────────────────────────────────────────────────── */
  _updateParticipant(id, data) {
    this.participants.set(id, { ...(this.participants.get(id) || {}), ...data });
    this._renderParticipants();
  }

  _renderParticipants() {
    const el = this._el.participantList;
    if (!el) return;
    const list = Array.from(this.participants.values());
    if (list.length === 0) { el.innerHTML = '<div class="meet-p-empty">No one yet</div>'; return; }

    el.innerHTML = list.map(p => `
      <div class="meet-participant">
        <div class="meet-p-avatar" style="background:${p.color || '#64748b'}">${(p.name || '?').charAt(0)}</div>
        <div class="meet-p-name">${p.name || 'Unknown'}</div>
        ${p.active ? '<div class="meet-p-live"></div>' : ''}
      </div>
    `).join('');
  }

  /* ── AI Summary ─────────────────────────────────────────────────────────── */
  async _summariseMeeting() {
    if (!this._el.summaryPnl) return;
    this._el.summaryPnl.classList.remove('hidden');
    if (this._el.summaryBody) this._el.summaryBody.innerHTML = '<div class="meet-summarising"><span class="spin">✨</span> Gemini is reading the transcript…</div>';

    const apiKey = window._orgApiKey;
    if (!apiKey || this.transcript.length === 0) {
      if (this._el.summaryBody) this._el.summaryBody.innerHTML = '<p style="color:#64748b;font-size:12px">No transcript to summarise.</p>';
      return;
    }

    const txText = this.transcript.map(l => `${l.speaker}: ${l.text}`).join('\n');
    const prompt = `You are summarising a business meeting for Bits & Studios — a premium Robotics + AI + Coding Makerspace launching June 1, 2026 in Ahmedabad, India.

MEETING TRANSCRIPT (${this.transcript.length} lines):
${txText}

Write a clean, structured meeting summary with:

1. **Key Decisions** — bulleted list of concrete decisions made
2. **Action Items** — table format: | Owner | Action | Deadline |
3. **Discussion Highlights** — brief paragraph per main topic
4. **Open Questions** — things unresolved, need follow-up

Rules:
- Use real names from transcript
- Reference specific Bits & Studios context (launch date June 1, team members, programs)
- Be concise but complete
- Format in HTML with <h3>, <ul>, <li>, <table>, <tr>, <th>, <td>, <strong>
- Write only the content, no preamble`;

    try {
      const res  = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 2048 } }),
      });
      const data = await res.json();
      let html = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'Summary unavailable';
      html = html.replace(/```html\n?/g,'').replace(/```\n?/g,'')
                 .replace(/^#{1,6}\s+(.+)$/gm,'<h3>$1</h3>')
                 .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').trim();
      if (this._el.summaryBody) this._el.summaryBody.innerHTML = html;
      this._persistSummary(html);
    } catch (err) {
      if (this._el.summaryBody) this._el.summaryBody.innerHTML = `<p style="color:#ef4444">Summary failed: ${err.message}</p>`;
    }
  }

  _persistSummary(html) {
    if (this.nodeId) {
      const node = this.data.getNode(this.nodeId);
      if (node) {
        this.data.updateNode(this.nodeId, {
          meetingSummary:  html,
          transcriptLines: this.transcript.length,
          meetingDate:     new Date().toISOString(),
        });
      }
    }
    localStorage.setItem('meet_tx_' + this.roomId, JSON.stringify(this.transcript));
  }

  _saveSummaryToNode() {
    const node = this.nodeId ? this.data.getNode(this.nodeId) : null;
    if (node) {
      window.app?.showToast(`💾 Summary saved to "${node.label}"`, 'success');
      window.app?.sidebar?.open(this.nodeId);
    } else {
      window.app?.showToast('💾 Summary saved locally (no node linked)', 'info');
    }
  }

  /* ── Bindings ────────────────────────────────────────────────────────────── */
  _bindEvents() {
    this._el.closeBtn?.addEventListener('click',  () => this.close());
    this._el.saveBtn?.addEventListener('click',   () => this._saveSummaryToNode());
    this._el.endBtn?.addEventListener('click',    () => {
      if (this.jitsi) {
        try { this.jitsi.executeCommand('hangup'); } catch(e) {}
      } else {
        this.isStarted = false;
        this._stopTranscription();
        if (this.transcript.length > 0) this._summariseMeeting();
      }
    });
    this._el.linkBtn?.addEventListener('click',   () => this._copyLink());
    this._el.chatSend?.addEventListener('click',  () => this._sendChat());
    this._el.chatInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._sendChat(); }
    });
    this._el.overlay?.addEventListener('click', (e) => {
      if (e.target === this._el.overlay) this.close();
    });
  }

  _bindSocket() {
    const tryBind = () => {
      const socket = window._socket || window._agentSocket;
      if (!socket) return;
      socket.on('meet:transcript_line', (d) => {
        if (d.roomId !== this.roomId || d.speaker === this._me().name) return;
        const line = { speaker: d.speaker, text: d.text, color: d.color, ts: d.ts };
        this.transcript.push(line);
        this._appendTxLine(d.speaker, d.text, d.color, false);
      });
      socket.on('meet:chat', (d) => {
        if (d.roomId !== this.roomId) return;
        this._addChatMessage(d.name, d.text, false);
      });
      socket.on('meet:join', (d) => {
        if (d.roomId !== this.roomId) return;
        window.app?.showToast(`📹 ${d.name} joined the meeting`, 'info');
      });
    };
    setTimeout(tryBind, 800);
  }

  /* ── Helpers ─────────────────────────────────────────────────────────────── */
  _me() {
    const u = window.Auth?.currentUser;
    return {
      id:       u?.id    || 'anon',
      name:     u?.name  || localStorage.getItem('bits_collab_name') || 'Me',
      color:    u?.color || '#534AB7',
      email:    u?.email || '',
    };
  }

  _colorForName(name) {
    const map = {
      'Pratik': '#534AB7', 'Anjalee': '#1D9E75', 'Sohil': '#D85A30',
      'Mohit':  '#378ADD', 'Aryan':   '#D4537E',  'Mantasha': '#BA7517',
      'Foram':  '#639922',
    };
    for (const [key, color] of Object.entries(map)) {
      if (name?.toLowerCase().includes(key.toLowerCase())) return color;
    }
    return '#64748b';
  }

  _setStatus(state, text) {
    const el = this._el.status;
    if (!el) return;
    el.textContent = text;
    el.className = `meet-status-badge meet-status-${state}`;
  }

  _copyLink() {
    const link = `https://${JITSI_DOMAIN}/${this.roomId}`;
    navigator.clipboard?.writeText(link).then(() => {
      window.app?.showToast('🔗 Meeting link copied! Share with anyone', 'success');
    });
  }

  _emitSocket(event, data) {
    const socket = window._socket || window._agentSocket;
    socket?.emit?.(event, data);
  }

  _resetPanels() {
    this.transcript = [];
    this.participants.clear();
    if (this._el.txBody)    this._el.txBody.innerHTML  = '<div class="meet-tx-empty">Join the call to start transcription</div>';
    if (this._el.chatBody)  this._el.chatBody.innerHTML= '<div class="meet-chat-empty">Chat will appear here</div>';
    if (this._el.txCount)   this._el.txCount.textContent = '0 lines';
    if (this._el.summaryPnl) this._el.summaryPnl.classList.add('hidden');
    this._renderParticipants();
  }

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
