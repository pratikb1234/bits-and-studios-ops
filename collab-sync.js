// ─── Bits & Studios — Real-Time Collaboration Sync Layer ────────────────────
// No more "join session" modal — identity comes from Auth (login screen).
// Loaded AFTER data.js, BEFORE mindmap.js

(function () {
  'use strict';

  const RECONNECT_DELAY = 3000;

  let socket = null;
  let _suppressRemoteEvents = false;

  // ── UI refs ────────────────────────────────────────────────────────────────
  let $collabStatus, $presenceAvatars, $peerCursors;

  // ── Get current user identity from Auth (no manual name entry needed) ──────
  function getMe() {
    const user = window.Auth?.currentUser;
    return {
      name:  user?.name  || 'Unknown',
      color: user?.color || '#FF6B35',
      role:  user?.role  || 'employee',
      id:    user?.id    || 'anon',
    };
  }

  // ── Status indicator ───────────────────────────────────────────────────────
  function setStatus(text, cls) {
    if (!$collabStatus) return;
    $collabStatus.textContent = text;
    $collabStatus.className = 'collab-status ' + (cls || '');
  }

  // ── Presence avatars ───────────────────────────────────────────────────────
  function renderPresence(users) {
    if (!$presenceAvatars) return;
    $presenceAvatars.innerHTML = users.map(u => `
      <div class="presence-avatar" style="background:${u.color}" title="${u.name}">
        ${u.name.charAt(0).toUpperCase()}
      </div>
    `).join('');
  }

  // ── Peer cursors ───────────────────────────────────────────────────────────
  function renderPeerCursor(data) {
    if (!$peerCursors) return;
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
    clearTimeout(el._hideTimer);
    el.style.opacity = '1';
    el._hideTimer = setTimeout(() => { el.style.opacity = '0'; }, 3000);
  }

  function removePeerCursor(userId) {
    const el = document.getElementById('cursor_' + userId);
    if (el) el.remove();
  }

  // ── Connect socket ─────────────────────────────────────────────────────────
  function initSocket() {
    if (typeof io === 'undefined') {
      setStatus('Offline', 'offline');
      return;
    }

    setStatus('Connecting…', 'connecting');

    socket = io(window.location.origin, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: RECONNECT_DELAY,
      reconnectionAttempts: Infinity,
      timeout: 20000,
    });

    socket.on('connect', () => {
      setStatus('Live ●', 'live');
      const me = getMe();
      // Announce with name + colour from Auth profile
      socket.emit('user_join', { name: me.name, color: me.color });
    });

    socket.on('disconnect',    () => setStatus('Reconnecting…', 'connecting'));
    socket.on('connect_error', () => setStatus('Offline', 'offline'));

    // ── Receive initial state from server ──────────────────────────────────
    socket.on('init_state', ({ nodes, team }) => {
      if (!nodes || nodes.length === 0) {
        // Server has no data — if admin, auto-seed the sprint
        if (window.Auth?.isAdmin) {
          console.log('[Collab] Empty map detected — auto-seeding sprint data...');
          _autoSeedSprint();
        }
        return;
      }
      if (!window.DB) return;
      _suppressRemoteEvents = true;
      window.DB._nodes.clear();
      for (const n of nodes) window.DB._nodes.set(n.id, n);
      if (team && team.length) window.DB.saveTeam(team);
      window.DB.save();
      window.DB._emit('load');
      _suppressRemoteEvents = false;
    });

    // ── Server pushed fresh state (e.g. after seed) ────────────────────────
    socket.on('state_update', ({ nodes }) => {
      if (!nodes || !window.DB) return;
      _suppressRemoteEvents = true;
      window.DB._nodes.clear();
      for (const n of nodes) window.DB._nodes.set(n.id, n);
      window.DB.save();
      window.DB._emit('load');
      _suppressRemoteEvents = false;
      window.app?.showToast('✅ Sprint data loaded!', 'success');
    });

    // ── Full sync (another user imported/reset) ────────────────────────────
    socket.on('sync_full', ({ nodes, team }) => {
      if (!window.DB) return;
      _suppressRemoteEvents = true;
      window.DB._nodes.clear();
      for (const n of nodes) window.DB._nodes.set(n.id, n);
      if (team) window.DB.saveTeam(team);
      window.DB.save();
      window.DB._emit('load');
      _suppressRemoteEvents = false;
      window.app?.showToast('📡 Map synced from a teammate', 'info');
    });

    // ── Granular node events ───────────────────────────────────────────────
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
      if (node) { node.parentId = newParentId; window.DB.save(); window.DB._emit('move', node); }
      _suppressRemoteEvents = false;
    });

    socket.on('team_updated',     (team) => { if (window.DB) window.DB.saveTeam(team); });
    socket.on('active_users',     renderPresence);
    socket.on('peer_cursor',      renderPeerCursor);
    socket.on('peer_disconnected',({ userId }) => removePeerCursor(userId));
  }

  // ── Hook data layer → emit to server ──────────────────────────────────────
  function hookDataLayer() {
    if (!window.DB) return;
    window.DB.onChange((type, payload) => {
      if (_suppressRemoteEvents || !socket || !socket.connected) return;
      switch (type) {
        case 'add':    socket.emit('node_added',   payload); break;
        case 'update': socket.emit('node_updated', payload); break;
        case 'delete': socket.emit('node_deleted', payload); break;
        case 'move':   socket.emit('node_moved', { id: payload.id, newParentId: payload.parentId }); break;
        case 'load':
          socket.emit('sync_full', { nodes: window.DB.getAllNodes(), team: window.DB.getTeam() });
          break;
      }
    });
  }

  // ── Auto-seed sprint data when admin finds empty map ──────────────────────
  async function _autoSeedSprint() {
    try {
      setStatus('Loading sprint data…', 'connecting');
      const r = await fetch('/api/admin/seed-sprint', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Token': window.Auth?.token || '',
        },
      });
      const data = await r.json();
      if (r.ok && data.ok) {
        setStatus('Live ●', 'live');
        console.log('[Collab] Sprint seeded:', data.msg);
        // state_update event will fire from server and refresh the map
      } else {
        console.warn('[Collab] Seed failed:', data.error);
        setStatus('Live ●', 'live');
      }
    } catch (e) {
      console.warn('[Collab] Auto-seed error:', e.message);
      setStatus('Live ●', 'live');
    }
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
      }, 50);
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  window.CollabSync = {
    emitTeamUpdate(team) {
      if (socket && socket.connected) socket.emit('team_updated', team);
    },
    // Re-announce identity (call after login)
    reidentify() {
      if (socket && socket.connected) {
        const me = getMe();
        socket.emit('user_join', { name: me.name, color: me.color });
      }
    },
  };

  // ── Bootstrap — start automatically after auth login ──────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    $collabStatus    = document.getElementById('collab-status');
    $presenceAvatars = document.getElementById('presence-avatars');
    $peerCursors     = document.getElementById('peer-cursors');

    // Hide the old join modal permanently (kept in HTML for safety)
    const joinModal = document.getElementById('join-modal');
    if (joinModal) joinModal.remove();

    // Start collab once user is authenticated
    function startCollab() {
      setTimeout(() => {
        hookDataLayer();
        hookCursorBroadcast();
        if (window.location.protocol === 'file:') {
          setStatus('Local (no collab)', 'offline');
          return;
        }
        initSocket();
      }, 300);
    }

    // If already logged in (page refresh with session)
    if (window.Auth?.currentUser) {
      startCollab();
    } else {
      // Wait for login to complete
      window.addEventListener('auth:login', startCollab, { once: true });
      window.addEventListener('admin:pin:ok', () => {
        // Re-identify after admin PIN confirmed
        setTimeout(() => window.CollabSync.reidentify(), 500);
      });
    }
  });
})();
