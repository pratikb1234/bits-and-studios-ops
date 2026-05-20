// ─── Bits & Studios — Real-Time Collaboration Server ────────────────────────
// Node.js + Express + Socket.io
// Run: node server.js  (or: npm start)
// Deploy to Render / Railway / Fly.io for live access

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');
const fs      = require('fs');

const app    = express();
const server = http.createServer(app);

// Trust Render's reverse proxy so Socket.io WebSocket upgrades work
app.set('trust proxy', 1);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],   // try WebSocket first, fall back to polling
  allowEIO3: true,                         // allow older Socket.io clients
  pingTimeout: 60000,                      // 60s — keeps connection alive on free tier
  pingInterval: 25000,                     // heartbeat every 25s
  upgradeTimeout: 30000,
});

const PORT      = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'collab-data.json');

// ── Serve static frontend files ─────────────────────────────────────────────
app.use(express.static(__dirname));

// ── Persistent in-memory store backed by a JSON file ────────────────────────
let sharedState = { nodes: null, team: [] };   // null = not yet loaded

function loadFromDisk() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      sharedState = JSON.parse(raw);
      console.log(`[Server] Loaded ${sharedState.nodes?.length ?? 0} nodes from disk.`);
    }
  } catch (e) {
    console.error('[Server] Failed to load data file:', e.message);
  }
}

function saveToDisk() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(sharedState, null, 2));
  } catch (e) {
    console.error('[Server] Failed to save data file:', e.message);
  }
}

loadFromDisk();

// ── Active users tracking ────────────────────────────────────────────────────
const activeUsers = new Map();   // socketId → { name, color, cursor }

const USER_COLORS = [
  '#FF6B35', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
  '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'
];

function broadcastActiveUsers() {
  io.emit('active_users', Array.from(activeUsers.values()));
}

// ── Socket.io event handlers ─────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);

  // 1. Send current state to new joiner
  socket.emit('init_state', sharedState);

  // 2. User joins with a name
  socket.on('user_join', ({ name }) => {
    const color = USER_COLORS[activeUsers.size % USER_COLORS.length];
    activeUsers.set(socket.id, { id: socket.id, name, color });
    broadcastActiveUsers();
    console.log(`[Socket] User joined: ${name}`);
  });

  // 3. Full node list sync (sent after localStorage init or import)
  socket.on('sync_full', ({ nodes, team }) => {
    sharedState.nodes = nodes;
    if (team) sharedState.team = team;
    saveToDisk();
    // Broadcast to everyone EXCEPT the sender
    socket.broadcast.emit('sync_full', { nodes, team });
    console.log(`[Socket] sync_full: ${nodes.length} nodes`);
  });

  // 4. Granular node operations — broadcast to all others, then persist
  socket.on('node_added', (node) => {
    if (sharedState.nodes) {
      sharedState.nodes = sharedState.nodes.filter(n => n.id !== node.id);
      sharedState.nodes.push(node);
      saveToDisk();
    }
    socket.broadcast.emit('node_added', node);
  });

  socket.on('node_updated', (node) => {
    if (sharedState.nodes) {
      const idx = sharedState.nodes.findIndex(n => n.id === node.id);
      if (idx !== -1) sharedState.nodes[idx] = node;
      else sharedState.nodes.push(node);
      saveToDisk();
    }
    socket.broadcast.emit('node_updated', node);
  });

  socket.on('node_deleted', ({ id, descendants }) => {
    if (sharedState.nodes) {
      const toDelete = new Set([id, ...(descendants || [])]);
      sharedState.nodes = sharedState.nodes.filter(n => !toDelete.has(n.id));
      saveToDisk();
    }
    socket.broadcast.emit('node_deleted', { id, descendants });
  });

  socket.on('node_moved', ({ id, newParentId }) => {
    if (sharedState.nodes) {
      const node = sharedState.nodes.find(n => n.id === id);
      if (node) node.parentId = newParentId;
      saveToDisk();
    }
    socket.broadcast.emit('node_moved', { id, newParentId });
  });

  // 5. Cursor position (live presence)
  socket.on('cursor_move', ({ x, y }) => {
    const user = activeUsers.get(socket.id);
    if (user) {
      user.cursor = { x, y };
      socket.broadcast.emit('peer_cursor', { userId: socket.id, name: user.name, color: user.color, x, y });
    }
  });

  // 6. Team changes
  socket.on('team_updated', (team) => {
    sharedState.team = team;
    saveToDisk();
    socket.broadcast.emit('team_updated', team);
  });

  // 7. Disconnect
  socket.on('disconnect', () => {
    const user = activeUsers.get(socket.id);
    activeUsers.delete(socket.id);
    broadcastActiveUsers();
    io.emit('peer_disconnected', { userId: socket.id });
    console.log(`[Socket] Disconnected: ${user?.name ?? socket.id}`);
  });
});

// ── Health check endpoint ────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', users: activeUsers.size, nodes: sharedState.nodes?.length ?? 0 });
});

// ── Start server ─────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n🚀 Bits & Studios Collaboration Server`);
  console.log(`   Running at: http://localhost:${PORT}`);
  console.log(`   Share this URL with teammates to collaborate!\n`);
});
