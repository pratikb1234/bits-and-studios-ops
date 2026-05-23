// ── Bits & Studios — Live Meeting Room ─────────────────────────────────────
// WebRTC (PeerJS) + Web Speech API transcription + Gemini summary
// Each participant transcribes their own mic — tagged with their portal identity
// Socket.io aggregates all transcript lines to all participants in real time

'use strict';

class MeetingRoom {
  constructor(dataLayer) {
    this.data       = dataLayer;
    this.isOpen     = false;
    this.isStarted  = false;
    this.roomId     = null;       // meeting node id or custom room
    this.peers      = new Map();  // peerId → { conn, stream, videoEl }
    this.localStream= null;
    this.micActive  = true;
    this.camActive  = true;
    this.transcript = [];         // [{speaker, text, ts}]
    this.recognition= null;       // Web Speech API
    this.peer       = null;       // PeerJS instance

    this._el = {
      modal:      document.getElementById('meet-room-modal'),
      videoGrid:  document.getElementById('meet-video-grid'),
      txBody:     document.getElementById('meet-transcript-body'),
      txCount:    document.getElementById('meet-line-count'),
      name:       document.getElementById('meet-room-name'),
      meta:       document.getElementById('meet-room-meta'),
      status:     document.getElementById('meet-status-badge'),
      summaryPnl: document.getElementById('meet-summary-panel'),
      summaryBody:document.getElementById('meet-summary-body'),
      startBtn:   document.getElementById('meet-btn-start'),
      endBtn:     document.getElementById('meet-btn-end'),
      micBtn:     document.getElementById('meet-btn-mic'),
      camBtn:     document.getElementById('meet-btn-cam'),
      screenBtn:  document.getElementById('meet-btn-screen'),
      saveBtn:    document.getElementById('meet-save-btn'),
      closeBtn:   document.getElementById('meet-room-close'),
    };

    this._bindEvents();
  }

  // ── Public ─────────────────────────────────────────────────────────────────
  open(nodeId, nodeLabel) {
    this.isOpen = true;
    this.roomId = nodeId || ('room_' + Date.now());

    if (this._el.name)  this._el.name.textContent  = nodeLabel || 'Live Meeting Room';
    if (this._el.meta)  this._el.meta.textContent  = `Room: ${this.roomId} · ${this._me().name}`;
    if (this._el.modal) this._el.modal.classList.remove('hidden');
    this._setStatus('idle', '● Idle');
    this._resetTranscript();
  }

  close() {
    this.isOpen = false;
    this._endMeeting(false); // stop streams but don't summarise
    if (this._el.modal) this._el.modal.classList.add('hidden');
  }

  toggle(nodeId, nodeLabel) {
    this.isOpen ? this.close() : this.open(nodeId, nodeLabel);
  }

  // ── Bindings ───────────────────────────────────────────────────────────────
  _bindEvents() {
    this._el.closeBtn?.addEventListener('click',  () => this.close());
    this._el.startBtn?.addEventListener('click',  () => this._startMeeting());
    this._el.endBtn?.addEventListener('click',    () => this._endMeeting(true));
    this._el.micBtn?.addEventListener('click',    () => this._toggleMic());
    this._el.camBtn?.addEventListener('click',    () => this._toggleCam());
    this._el.screenBtn?.addEventListener('click', () => this._shareScreen());
    this._el.saveBtn?.addEventListener('click',   () => this._saveSummaryToNode());

    // Close on backdrop click
    this._el.modal?.addEventListener('click', (e) => {
      if (e.target === this._el.modal) this.close();
    });

    // Listen for transcript events from other participants via Socket.io
    this._bindSocket();
  }

  _bindSocket() {
    const tryBind = () => {
      const socket = window._socket || window._agentSocket;
      if (!socket) return;
      socket.on('meet:transcript_line', (data) => {
        if (data.roomId !== this.roomId) return;
        this._appendTranscriptLine(data.speaker, data.text, data.speakerColor, false);
      });
      socket.on('meet:participant_joined', (data) => {
        if (data.roomId !== this.roomId) return;
        window.app?.showToast(`📹 ${data.name} joined the meeting`, 'info');
        this._setMeta();
      });
      socket.on('meet:participant_left', (data) => {
        if (data.roomId !== this.roomId) return;
        window.app?.showToast(`👋 ${data.name} left the meeting`, 'info');
      });
    };
    setTimeout(tryBind, 1000);
  }

  // ── Meeting lifecycle ──────────────────────────────────────────────────────
  async _startMeeting() {
    try {
      this._setStatus('connecting', '⟳ Connecting…');

      // Get local media
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      // Show local video
      this._addVideoTile(null, this.localStream, this._me().name + ' (You)', true);

      // Init PeerJS for WebRTC
      await this._initPeer();

      // Start Web Speech transcription
      this._startTranscription();

      // Announce to room via socket
      this._emitSocket('meet:join', {
        roomId:  this.roomId,
        name:    this._me().name,
        color:   this._me().color,
        peerId:  this.peer?.id,
      });

      this.isStarted = true;
      this._setStatus('live', '🔴 Live');
      this._el.startBtn?.classList.add('hidden');
      this._el.endBtn?.classList.remove('hidden');
      this._resetTranscript();

    } catch (err) {
      console.error('[MeetRoom] Start failed:', err);
      this._setStatus('error', '✕ Error');
      if (err.name === 'NotAllowedError') {
        window.app?.showToast('🎙️ Camera/mic permission denied', 'error');
      } else {
        window.app?.showToast('Meeting start failed: ' + err.message, 'error');
      }
    }
  }

  async _endMeeting(summarise = true) {
    if (!this.isStarted && !summarise) return;

    // Stop transcription
    this._stopTranscription();

    // Stop local stream
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }

    // Destroy peer connections
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    this.peers.clear();

    // Clear video grid
    if (this._el.videoGrid) this._el.videoGrid.innerHTML = '';

    // Announce leaving
    this._emitSocket('meet:leave', { roomId: this.roomId, name: this._me().name });

    this.isStarted = false;
    this._setStatus('idle', '● Idle');
    this._el.startBtn?.classList.remove('hidden');
    this._el.endBtn?.classList.add('hidden');

    if (summarise && this.transcript.length > 0) {
      await this._summariseMeeting();
    }
  }

  // ── WebRTC via PeerJS ─────────────────────────────────────────────────────
  async _initPeer() {
    // Load PeerJS from CDN if not already loaded
    if (typeof Peer === 'undefined') {
      await this._loadScript('https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js');
    }

    return new Promise((resolve, reject) => {
      // Use a deterministic peer ID: roomId_userId
      const peerId = (this.roomId + '_' + this._me().id).replace(/[^a-zA-Z0-9_-]/g, '_');

      this.peer = new Peer(peerId, {
        host: '0.peerjs.com',
        port: 443,
        path: '/',
        secure: true,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
          ]
        }
      });

      this.peer.on('open', (id) => {
        console.log('[MeetRoom] PeerJS ID:', id);
        resolve(id);
      });

      this.peer.on('error', (err) => {
        console.warn('[MeetRoom] PeerJS error:', err.type, err.message);
        // Non-fatal — continue without WebRTC (audio-only transcription still works)
        resolve(null);
      });

      // Answer incoming calls
      this.peer.on('call', (call) => {
        call.answer(this.localStream);
        call.on('stream', (remoteStream) => {
          const name = call.metadata?.name || 'Participant';
          this._addVideoTile(call.peer, remoteStream, name, false);
        });
        call.on('close', () => this._removeVideoTile(call.peer));
      });

      // Timeout — continue even if PeerJS cloud is slow
      setTimeout(() => resolve(null), 5000);
    });
  }

  _addVideoTile(peerId, stream, name, isLocal) {
    if (!this._el.videoGrid) return;

    const id = 'vt_' + (peerId || 'local');
    let tile = document.getElementById(id);
    if (!tile) {
      tile = document.createElement('div');
      tile.id = id;
      tile.className = 'meet-video-tile' + (isLocal ? ' meet-video-local' : '');
      tile.innerHTML = `
        <video autoplay ${isLocal ? 'muted' : ''} playsinline></video>
        <div class="meet-video-name">${name}</div>
        <div class="meet-video-mic">🎙️</div>
      `;
      this._el.videoGrid.appendChild(tile);
    }

    const video = tile.querySelector('video');
    if (video) {
      video.srcObject = stream;
      video.play().catch(() => {});
    }
  }

  _removeVideoTile(peerId) {
    document.getElementById('vt_' + peerId)?.remove();
  }

  // ── Web Speech API transcription ──────────────────────────────────────────
  _startTranscription() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('[MeetRoom] Web Speech API not supported');
      this._appendTranscriptLine('System', '⚠️ Live transcription not supported in this browser. Try Chrome.', '#94a3b8', false);
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous     = true;
    this.recognition.interimResults = true;
    this.recognition.lang           = 'en-IN'; // Indian English
    this.recognition.maxAlternatives= 1;

    const me = this._me();
    let interimEl = null;

    this.recognition.onresult = (e) => {
      let interim = '';
      let final   = '';

      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += text;
        else interim += text;
      }

      if (final.trim()) {
        // Remove interim element
        interimEl?.remove();
        interimEl = null;

        const line = { speaker: me.name, text: final.trim(), ts: Date.now(), speakerColor: me.color };
        this.transcript.push(line);
        this._appendTranscriptLine(me.name, final.trim(), me.color, true);

        // Broadcast to other participants via socket
        this._emitSocket('meet:transcript_line', {
          roomId: this.roomId,
          ...line,
        });
      } else if (interim.trim()) {
        // Show interim (live preview)
        if (!interimEl) {
          interimEl = document.createElement('div');
          interimEl.className = 'meet-tx-line meet-tx-interim';
          interimEl.innerHTML = `<span class="meet-tx-speaker" style="color:${me.color}">${me.name}</span><span class="meet-tx-text"></span>`;
          this._el.txBody?.appendChild(interimEl);
        }
        const textEl = interimEl.querySelector('.meet-tx-text');
        if (textEl) textEl.textContent = interim;
        this._scrollTranscript();
      }
    };

    this.recognition.onerror = (e) => {
      if (e.error === 'no-speech') return; // normal silence
      console.warn('[MeetRoom] Speech recognition error:', e.error);
    };

    this.recognition.onend = () => {
      // Auto-restart if meeting is still going
      if (this.isStarted) {
        setTimeout(() => {
          try { this.recognition?.start(); } catch(e) {}
        }, 200);
      }
    };

    this.recognition.start();
    console.log('[MeetRoom] 🎙️ Transcription started');
  }

  _stopTranscription() {
    if (this.recognition) {
      try { this.recognition.stop(); } catch(e) {}
      this.recognition = null;
    }
  }

  // ── Transcript UI ──────────────────────────────────────────────────────────
  _appendTranscriptLine(speaker, text, color, isLocal) {
    const body = this._el.txBody;
    if (!body) return;

    // Remove empty state
    body.querySelector('.meet-transcript-empty')?.remove();

    const line = document.createElement('div');
    line.className = 'meet-tx-line' + (isLocal ? ' meet-tx-local' : '');
    const time = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    line.innerHTML = `
      <div class="meet-tx-meta">
        <span class="meet-tx-speaker" style="color:${color || '#94a3b8'}">${speaker}</span>
        <span class="meet-tx-time">${time}</span>
      </div>
      <div class="meet-tx-text">${text}</div>
    `;

    body.appendChild(line);
    this._scrollTranscript();

    // Update count
    const count = body.querySelectorAll('.meet-tx-line:not(.meet-tx-interim)').length;
    if (this._el.txCount) this._el.txCount.textContent = count + ' lines';
  }

  _scrollTranscript() {
    if (this._el.txBody) this._el.txBody.scrollTop = this._el.txBody.scrollHeight;
  }

  _resetTranscript() {
    this.transcript = [];
    if (this._el.txBody) this._el.txBody.innerHTML = '<div class="meet-transcript-empty">Start the meeting to begin live transcription</div>';
    if (this._el.txCount) this._el.txCount.textContent = '0 lines';
    if (this._el.summaryPnl) this._el.summaryPnl.classList.add('hidden');
  }

  // ── AI Summary ─────────────────────────────────────────────────────────────
  async _summariseMeeting() {
    if (!this._el.summaryPnl) return;

    this._el.summaryPnl.classList.remove('hidden');
    if (this._el.summaryBody) {
      this._el.summaryBody.innerHTML = '<div class="meet-summarising">✨ Gemini is summarising the meeting…</div>';
    }

    const apiKey = window._orgApiKey;
    if (!apiKey) {
      if (this._el.summaryBody) this._el.summaryBody.innerHTML = '<p>No API key available for summary.</p>';
      return;
    }

    const transcriptText = this.transcript
      .map(l => `${l.speaker}: ${l.text}`)
      .join('\n');

    const prompt = `You are summarising a meeting for Bits & Studios — a premium Robotics + AI + Coding Makerspace in Ahmedabad, India.

MEETING TRANSCRIPT:
${transcriptText}

Write a structured meeting summary with:
1. **Key Decisions Made** — bulleted list
2. **Action Items** — table: Owner | Action | Deadline
3. **Discussion Summary** — brief paragraph per major topic
4. **Open Questions / Follow-ups** — things not yet resolved

Be specific. Use names from the transcript. Format in HTML using <h3>, <ul>, <li>, <table>, <strong>.
Write only the summary content — no preamble.`;

    try {
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 2000 },
        }),
      });

      const data = await res.json();
      let html = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'Summary unavailable';
      html = html
        .replace(/```html\n?/g, '').replace(/```\n?/g, '')
        .replace(/^#{1,6}\s+(.+)$/gm, (_, t) => `<h3>${t}</h3>`)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .trim();

      if (this._el.summaryBody) this._el.summaryBody.innerHTML = html;
      this._storeSummary(html);

    } catch (err) {
      if (this._el.summaryBody) this._el.summaryBody.innerHTML = `<p>Summary failed: ${err.message}</p>`;
    }
  }

  _storeSummary(html) {
    // Store in meeting node if linked
    if (this.roomId && window.DB) {
      const node = window.DB.getNode(this.roomId);
      if (node) {
        window.DB.updateNode(this.roomId, {
          meetingSummary: html,
          transcriptLines: this.transcript.length,
          meetingDate: new Date().toISOString(),
        });
      }
    }
    // Also store raw transcript in localStorage
    const key = 'meet_transcript_' + this.roomId;
    localStorage.setItem(key, JSON.stringify(this.transcript));
  }

  _saveSummaryToNode() {
    if (!this.roomId) return;
    const node = window.DB?.getNode(this.roomId);
    if (!node) {
      window.app?.showToast('No meeting node linked — summary saved locally', 'info');
      return;
    }
    window.app?.showToast(`💾 Summary saved to "${node.label}"`, 'success');
    window.app?.sidebar?.open(this.roomId);
  }

  // ── Controls ───────────────────────────────────────────────────────────────
  _toggleMic() {
    if (!this.localStream) return;
    this.micActive = !this.micActive;
    this.localStream.getAudioTracks().forEach(t => { t.enabled = this.micActive; });
    if (this._el.micBtn) {
      this._el.micBtn.textContent = this.micActive ? '🎙️' : '🔇';
      this._el.micBtn.classList.toggle('meet-ctrl-muted', !this.micActive);
    }
  }

  _toggleCam() {
    if (!this.localStream) return;
    this.camActive = !this.camActive;
    this.localStream.getVideoTracks().forEach(t => { t.enabled = this.camActive; });
    if (this._el.camBtn) {
      this._el.camBtn.textContent = this.camActive ? '📷' : '📷🚫';
      this._el.camBtn.classList.toggle('meet-ctrl-muted', !this.camActive);
    }
  }

  async _shareScreen() {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      this._addVideoTile('screen', screenStream, 'Screen Share', true);
      screenStream.getVideoTracks()[0].onended = () => this._removeVideoTile('screen');
    } catch (e) {
      if (e.name !== 'AbortError') window.app?.showToast('Screen share failed: ' + e.message, 'error');
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  _me() {
    const user = window.Auth?.currentUser;
    return {
      id:    user?.id    || 'anon',
      name:  user?.name  || localStorage.getItem('bits_collab_name') || 'Me',
      color: user?.color || '#534AB7',
    };
  }

  _setStatus(state, text) {
    if (!this._el.status) return;
    this._el.status.textContent = text;
    this._el.status.className = 'meet-status-badge meet-status-' + state;
  }

  _setMeta() {
    if (this._el.meta) this._el.meta.textContent = `Room: ${this.roomId} · ${this._me().name}`;
  }

  _emitSocket(event, data) {
    const socket = window._socket || window._agentSocket;
    if (socket?.emit) socket.emit(event, data);
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

// ── Expose globally ──────────────────────────────────────────────────────────
window.MeetingRoom = MeetingRoom;
