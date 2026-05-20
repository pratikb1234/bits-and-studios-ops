// ─── Bits & Studios — Real-Time Collaboration Sync Layer ────────────────────
// Bridges Socket.io ↔ MindMapData events.
// Loaded AFTER data.js, BEFORE mindmap.js

(function () {
  'use strict';

  // ── Config ─────────────────────────────────────────────────────────────────
  const RECONNECT_DELAY = 3000;

  // ── State ──────────────────────────────────────────────────────────────────
  let socket = null;
  let myName  = '';
  let myColor = '#FF6B35';
  let _suppressRemoteEvents = false;

  // ── UI refs (set after DOM ready) ──────────────────────────────────────────
  let $joinModal, $joinInput, $joinBtn;
  let $collabStatus, $presenceAvatars, $peerCursors;

  // ── Helpers ────────────────────────────────────────────────────────────────
  function setStatus(text, cls) {
    if (!$collabStatus) return;
    $collabStatus.textContent = text;
    $collabStatus.className = 'collab-status ' + (cls || '');
  }

  function renderPresence(users) {
    if (!$presenceAvatars) return;
    $presenceAvatars.innerHTML = users.map(u => `
      <div class="presence-avatar" style="background:${u.color}" title="${u.name}">
        ${u.name.charAt(0).toUpperCase()}
      </div>
    `).join('');
  }

  function renderPeerCursor(data) {
    let el = document.getElementById('cursor_' + data.userId);
    if (!el) {
      el = document.createElement('div');
      el.id = 'cursor_' + data.userId;
      el.className = 'peer-cursor';
      el.innerHTML = `
        <div class="peer-cursor-dot" style="background:${data.color}"></div>
        <div class="peer-cursor-label" style="background:${data.color}">${data.name}</div>
      `;
      $peerCursors.appendChild(el);
    }
    el.style.left = data.x + 'px';
    el.style.top  = data.y + 'px';

    // Fade out after 3 s of no movement
    clearTimeout(el._hideTimer);
    el.style.opacity = '1';
    el._hideTimer = setTimeout(() => { el.style.opacity = '0'; }, 3000);
  }

  function removePeerCursor(userId) {
    const el = document.getElementById('cursor_' + userId);
    if (el) el.remove();
  }

  // ── Show join modal ────────────────────────────────────────────────────────
  function showJoinModal() {
    $joinModal.classList.remove('hidden');
    $joinInput.focus();
  }

  function hideJoinModal() {
    $joinModal.classList.add('hidden');
  }

  function joinSession(name) {
    if (!name.trim()) return;
    myName = name.trim();
    localStorage.setItem('bits_collab_name', myName);
    hideJoinModal();
    initSocket();
  }

  // ── Socket connection ──────────────────────────────────────────────────────
  function initSocket() {
    // Only connect when served from Node server (not plain file://)
    if (typeof io === 'undefined') {
      setStatus('Offline (open via server)', 'offline');
      return;
    }

    setStatus('Connecting…', 'connecting');
    socket = io({ reconnectionDelay: RECONNECT_DELAY });

    socket.on('connect', () => {
      setStatus('Live ●', 'live');
      socket.emit('user_join', { name: myName });

      // On first connect: push our full local state to server
      if (window.DB) {
        const nodes = window.DB.getAllNodes();
        if (nodes.length) {
          socket.emit('sync_full', { nodes, team: window.DB.getTeam() });
        }
      }
    });

    socket.on('disconnect', () => setStatus('Reconnecting…', 'connecting'));
    socket.on('connect_error', () => setStatus('Offline', 'offline'));

    // ── Receive initial state from server ─────────────────────────────────
    socket.on('init_state', ({ nodes, team }) => {
      if (!nodes || nodes.length === 0) return;  // server has no data yet; keep local
      if (!window.DB) return;
      _suppressRemoteEvents = true;
      window.DB._nodes.clear();
      for (const n of nodes) window.DB._nodes.set(n.id, n);
      if (team && team.length) window.DB.saveTeam(team);
      window.DB.save();
      window.DB._emit('load');
      _suppressRemoteEvents = false;
    });

    // ── Receive full sync (another user imported/reset) ──────────────────
    socket.on('sync_full', ({ nodes, team }) => {
      if (!window.DB) return;
      _suppressRemoteEvents = true;
      window.DB._nodes.clear();
      for (const n of nodes) window.DB._nodes.set(n.id, n);
      if (team) window.DB.saveTeam(team);
      window.DB.save();
      window.DB._emit('load');
      _suppressRemoteEvents = false;
      showToast('📡 Map synced from a teammate', 'info');
    });

    // ── Granular node events ──────────────────────────────────────────────
    socket.on('node_added', (node) => {
      if (!window.DB) return;
      _suppressRemoteEvents = true;
      window.DB._nodes.set(node.id, node);
      window.DB.save();
      window.DB._emit('add', node);
      _suppressRemoteEvents = false;
    });

    socket.on('node_updated', (node) => {
      if (!window.DB) return;
      _suppressRemoteEvents = true;
      window.DB._nodes.set(node.id, node);
      window.DB.save();
      window.DB._emit('update', node);
      _suppressRemoteEvents = false;
    });

    socket.on('node_deleted', ({ id, descendants }) => {
      if (!window.DB) return;
      _suppressRemoteEvents = true;
      const toDelete = new Set([id, ...(descendants || [])]);
      for (const did of toDelete) window.DB._nodes.delete(did);
      window.DB.save();
      window.DB._emit('delete', { id, descendants });
      _suppressRemoteEvents = false;
    });

    socket.on('node_moved', ({ id, newParentId }) => {
      if (!window.DB) return;
      _suppressRemoteEvents = true;
      const node = window.DB.getNode(id);
      if (node) {
        node.parentId = newParentId;
        window.DB.save();
        window.DB._emit('move', node);
      }
      _suppressRemoteEvents = false;
    });

    socket.on('team_updated', (team) => {
      if (!window.DB) return;
      window.DB.saveTeam(team);
    });

    // ── Presence ──────────────────────────────────────────────────────────
    socket.on('active_users', renderPresence);
    socket.on('peer_cursor', renderPeerCursor);
    socket.on('peer_disconnected', ({ userId }) => removePeerCursor(userId));
  }

  // ── Intercept MindMapData events to emit to server ─────────────────────────
  function hookDataLayer() {
    if (!window.DB) return;
    window.DB.onChange((type, payload) => {
      if (_suppressRemoteEvents || !socket || !socket.connected) return;

      switch (type) {
        case 'add':
          socket.emit('node_added', payload);
          break;
        case 'update':
          socket.emit('node_updated', payload);
          break;
        case 'delete':
          socket.emit('node_deleted', payload);
          break;
        case 'move':
          socket.emit('node_moved', { id: payload.id, newParentId: payload.parentId });
          break;
        case 'load':
          // Full re-load (import / undo etc.)
          socket.emit('sync_full', {
            nodes: window.DB.getAllNodes(),
            team: window.DB.getTeam(),
          });
          break;
      }
    });
  }

  // ── Cursor broadcasting ────────────────────────────────────────────────────
  function hookCursorBroadcast() {
    let _throttle = null;
    document.addEventListener('mousemove', (e) => {
      if (!socket || !socket.connected) return;
      if (_throttle) return;
      _throttle = setTimeout(() => {
        socket.emit('cursor_move', { x: e.clientX, y: e.clientY });
        _throttle = null;
      }, 50);   // 20 fps max
    });
  }

  // ── Toast helper (may not be defined yet, so wrap safely) ─────────────────
  function showToast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type);
    else console.log('[Collab]', msg);
  }

  // ── Expose collab emit for team changes ──────────────────────────────────
  window.CollabSync = {
    emitTeamUpdate(team) {
      if (socket && socket.connected) socket.emit('team_updated', team);
    },
  };

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    $joinModal       = document.getElementById('join-modal');
    $joinInput       = document.getElementById('join-name-input');
    $joinBtn         = document.getElementById('join-btn');
    $collabStatus    = document.getElementById('collab-status');
    $presenceAvatars = document.getElementById('presence-avatars');
    $peerCursors     = document.getElementById('peer-cursors');

    // Join button
    $joinBtn.addEventListener('click', () => joinSession($joinInput.value));
    $joinInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') joinSession($joinInput.value);
    });

    // Auto-fill saved name
    const savedName = localStorage.getItem('bits_collab_name');
    if (savedName) {
      $joinInput.value = savedName;
    }

    // Hook data layer once DB is ready
    // DB is initialized in app.js → we wait a tick
    setTimeout(() => {
      hookDataLayer();
      hookCursorBroadcast();

      // If running from file:// (not node server), skip socket
      if (window.location.protocol === 'file:') {
        setStatus('Local (no collab)', 'offline');
        hideJoinModal();
        return;
      }

      showJoinModal();
    }, 100);
  });
})();
