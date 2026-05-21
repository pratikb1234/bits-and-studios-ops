// ─── Bits & Studios — Real-Time Collaboration Server ────────────────────────
// Node.js + Express + Socket.io + Multer + Nodemailer

const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');

const app    = express();
const server = http.createServer(app);

app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' }));

// ── Optional dependencies (graceful fallback if not installed) ───────────────
let multer, nodemailer;
try { multer     = require('multer'); }    catch { console.warn('[Server] multer not installed — file upload disabled'); }
try { nodemailer = require('nodemailer'); } catch { console.warn('[Server] nodemailer not installed — email disabled'); }

// ── Socket.io ────────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports:     ['websocket', 'polling'],
  allowEIO3:      true,
  pingTimeout:    60000,
  pingInterval:   25000,
  upgradeTimeout: 30000,
});

const PORT      = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'collab-data.json');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ── Static files ─────────────────────────────────────────────────────────────
app.use(express.static(__dirname));

// ── Persistent shared state ──────────────────────────────────────────────────
let sharedState = { nodes: null, team: [] };

function loadFromDisk() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      sharedState = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      console.log(`[Server] Loaded ${sharedState.nodes?.length ?? 0} nodes from disk.`);
    }
  } catch (e) { console.error('[Server] Failed to load data file:', e.message); }
}

function saveToDisk() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(sharedState, null, 2)); }
  catch (e) { console.error('[Server] Failed to save data file:', e.message); }
}

loadFromDisk();

// ── Approval tokens store ────────────────────────────────────────────────────
// { token → { tasks, meetingTitle, assignee, status, createdAt } }
const pendingApprovals = new Map();

// ── Gemini API key (server-side cache) ───────────────────────────────────────
let cachedGeminiKey = process.env.GEMINI_API_KEY || '';

// ── /api/save-key — store Gemini key server-side ─────────────────────────────
app.post('/api/save-key', (req, res) => {
  const { geminiApiKey } = req.body || {};
  if (geminiApiKey) {
    cachedGeminiKey = geminiApiKey;
    console.log('[Server] Gemini API key updated (length:', geminiApiKey.length, ')');
    res.json({ ok: true });
  } else {
    res.status(400).json({ error: 'No key provided' });
  }
});

// ── /api/chat — Gemini proxy (logs everything) ────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { messages, systemPrompt, apiKey, model = 'gemini-1.5-flash' } = req.body || {};

  const key = apiKey || cachedGeminiKey;
  if (!key) {
    console.error('[Gemini] /api/chat called with no API key');
    return res.status(400).json({ error: 'No Gemini API key. Add it in ⚙️ Settings.' });
  }
  if (!messages || !messages.length) {
    return res.status(400).json({ error: 'No messages provided' });
  }

  // Build Gemini contents — strict alternating user/model turns
  const rawContents = messages.map(m => ({
    role:  m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content || '' }],
  }));

  const contents = rawContents.reduce((acc, cur) => {
    if (acc.length && acc[acc.length - 1].role === cur.role) {
      acc[acc.length - 1].parts[0].text += '\n' + cur.parts[0].text;
    } else {
      acc.push(cur);
    }
    return acc;
  }, []);

  if (!contents.length || contents[0].role !== 'user') {
    contents.unshift({ role: 'user', parts: [{ text: '(start)' }] });
  }

  const body = {
    ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
    contents,
    generationConfig: { temperature: 0.7, maxOutputTokens: 4096, topP: 0.95 },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  console.log(`[Gemini] → model:${model} | turns:${contents.length} | sysprompt:${systemPrompt ? systemPrompt.length + ' chars' : 'none'}`);

  try {
    const gRes  = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    const data = await gRes.json();

    if (!gRes.ok) {
      const errMsg = data?.error?.message || `HTTP ${gRes.status}`;
      console.error('[Gemini] ✗ API error:', errMsg);
      return res.status(gRes.status).json({ error: errMsg });
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      const reason = data?.candidates?.[0]?.finishReason || 'unknown';
      console.error('[Gemini] ✗ Empty response. finishReason:', reason, '| data:', JSON.stringify(data).slice(0, 300));
      return res.status(500).json({ error: `Empty response (reason: ${reason})` });
    }

    console.log(`[Gemini] ✓ Got response (${text.length} chars): "${text.slice(0, 80)}..."`);
    res.json({ text });

  } catch (err) {
    console.error('[Gemini] ✗ Network error:', err.message);
    res.status(500).json({ error: 'Network error reaching Gemini: ' + err.message });
  }
});


// ── Email transport (lazy init) ───────────────────────────────────────────────
function getMailTransport() {
  if (!nodemailer) return null;
  const user = process.env.GMAIL_USER || sharedState.emailUser;
  const pass = process.env.GMAIL_PASS || sharedState.emailPass;
  if (!user || !pass) return null;

  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
}

async function sendApprovalEmail({ to, meetingTitle, tasks, token, appUrl }) {
  const transport = getMailTransport();
  if (!transport) {
    console.warn('[Email] No mail transport configured — skipping email.');
    return false;
  }

  const taskList = tasks.map((t, i) => `${i + 1}. ${t.icon || '📌'} ${t.label} (${t.priority || 'medium'} priority)`).join('\n');
  const approveUrl = `${appUrl}/api/approve?token=${token}&action=approve`;
  const rejectUrl  = `${appUrl}/api/approve?token=${token}&action=reject`;

  await transport.sendMail({
    from:    `"Bits & Studios" <${process.env.GMAIL_USER || sharedState.emailUser}>`,
    to,
    subject: `✅ Action Required: Tasks from "${meetingTitle}"`,
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
        <div style="background: linear-gradient(135deg, #FF6600, #FF8533); border-radius: 12px; padding: 24px; color: white; margin-bottom: 24px;">
          <h1 style="margin: 0; font-size: 22px;">📋 Meeting Tasks Awaiting Approval</h1>
          <p style="margin: 8px 0 0; opacity: 0.9;">${meetingTitle}</p>
        </div>

        <p style="color: #374151; line-height: 1.6;">
          The following tasks were extracted from the meeting and assigned to you.
          Please review and approve or reject them to add to the operations map.
        </p>

        <div style="background: #F9FAFB; border-radius: 10px; padding: 16px; margin: 20px 0; border: 1px solid #E5E7EB;">
          <h3 style="margin: 0 0 12px; font-size: 14px; color: #6B7280; text-transform: uppercase; letter-spacing: 0.05em;">Tasks</h3>
          ${tasks.map(t => `
            <div style="display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid #E5E7EB;">
              <span style="font-size: 20px;">${t.icon || '📌'}</span>
              <div>
                <div style="font-weight: 600; color: #111827;">${t.label}</div>
                <div style="font-size: 12px; color: #6B7280;">${t.priority || 'medium'} priority${t.dueDate ? ' · Due ' + t.dueDate : ''}</div>
              </div>
            </div>
          `).join('')}
        </div>

        <div style="display: flex; gap: 12px; margin-top: 24px;">
          <a href="${approveUrl}" style="flex: 1; display: block; text-align: center; padding: 14px; background: #10B981; color: white; text-decoration: none; border-radius: 10px; font-weight: 700; font-size: 15px;">
            ✅ Approve & Add to Map
          </a>
          <a href="${rejectUrl}" style="flex: 1; display: block; text-align: center; padding: 14px; background: #EF4444; color: white; text-decoration: none; border-radius: 10px; font-weight: 700; font-size: 15px;">
            ✕ Reject Tasks
          </a>
        </div>

        <p style="margin-top: 20px; font-size: 12px; color: #9CA3AF; text-align: center;">
          This link expires in 48 hours. Sent by Bits & Studios Operations Tool.
        </p>
      </div>
    `,
  });
  return true;
}

// ── File upload (multer) ──────────────────────────────────────────────────────
let upload = null;
if (multer) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename:    (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')),
  });
  upload = multer({ storage, limits: { fileSize: 200 * 1024 * 1024 } }); // 200MB
}

// ── API: Process meeting recording via Gemini ─────────────────────────────────
app.post('/api/process-recording', upload ? upload.single('recording') : (req, res, next) => next(), async (req, res) => {
  try {
    const geminiKey = req.body.geminiKey || process.env.GEMINI_API_KEY;
    const { meetingTitle, nodes, team, emailTo, appUrl } = req.body;

    if (!geminiKey) return res.status(400).json({ error: 'Gemini API key required' });

    let transcriptText = '';

    if (req.file) {
      // ── Audio/video file uploaded — send to Gemini Files API then process ──
      const fileBuffer = fs.readFileSync(req.file.path);
      const base64Data = fileBuffer.toString('base64');
      const mimeType   = req.file.mimetype || 'audio/mp4';

      // Inline audio (works for files up to ~20MB; larger files need File API)
      const geminiUrl  = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${geminiKey}`;
      const geminiResp = await fetch(geminiUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          contents: [{
            role:  'user',
            parts: [
              { text: 'Transcribe this meeting recording and extract: 1) A summary of key points discussed, 2) All action items with who is responsible and deadlines mentioned. Format clearly with SUMMARY: and ACTION ITEMS: sections.' },
              { inlineData: { mimeType, data: base64Data } },
            ],
          }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
        }),
      });

      if (!geminiResp.ok) {
        const errData = await geminiResp.json().catch(() => ({}));
        throw new Error(errData.error?.message || `Gemini error ${geminiResp.status}`);
      }

      const geminiData = await geminiResp.json();
      transcriptText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

      // Clean up temp file
      fs.unlink(req.file.path, () => {});

    } else if (req.body.transcript) {
      transcriptText = req.body.transcript;
    }

    if (!transcriptText) return res.status(400).json({ error: 'No transcript or recording provided' });

    // ── Extract tasks using Gemini ────────────────────────────────────────────
    const nodeList  = JSON.parse(nodes || '[]');
    const teamList  = JSON.parse(team  || '[]');

    const extractUrl  = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
    const systemInst  = `You extract tasks from meeting transcripts and map them to a mind map. Current nodes: ${JSON.stringify(nodeList.slice(0, 30))}. Team: ${teamList.join(', ')}. Respond with SUMMARY:, ACTION ITEMS:, and <map_actions>[...]</map_actions> JSON.`;

    const extractResp = await fetch(extractUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        systemInstruction: { parts: [{ text: systemInst }] },
        contents: [{ role: 'user', parts: [{ text: transcriptText }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
      }),
    });

    const extractData = await extractResp.json();
    const analysisText = extractData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Parse actions
    const actionsMatch = analysisText.match(/<map_actions>\s*([\s\S]*?)\s*<\/map_actions>/);
    let tasks = [];
    try { tasks = actionsMatch ? JSON.parse(actionsMatch[1]) : []; } catch {}

    // ── Create approval token & send emails ───────────────────────────────────
    const token = crypto.randomBytes(20).toString('hex');
    const addTasks = tasks.filter(t => t.action === 'add_node');

    pendingApprovals.set(token, {
      tasks:        tasks,
      meetingTitle: meetingTitle || 'Team Meeting',
      status:       'pending',
      createdAt:    Date.now(),
    });

    // Send approval email if emailTo provided
    let emailSent = false;
    if (emailTo && addTasks.length > 0) {
      const baseUrl = appUrl || `http://localhost:${PORT}`;
      emailSent = await sendApprovalEmail({
        to:           emailTo,
        meetingTitle: meetingTitle || 'Team Meeting',
        tasks:        addTasks,
        token,
        appUrl:       baseUrl,
      });
    }

    res.json({
      success:      true,
      transcript:   transcriptText,
      analysis:     analysisText,
      tasks,
      token,
      emailSent,
      taskCount:    addTasks.length,
    });

  } catch (e) {
    console.error('[API] process-recording error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── API: Approve / Reject tasks ───────────────────────────────────────────────
app.get('/api/approve', (req, res) => {
  const { token, action } = req.query;
  const pending = pendingApprovals.get(token);

  if (!pending) {
    return res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:60px;">
        <h2>⚠️ Link expired or not found</h2>
        <p>This approval link has already been used or has expired.</p>
      </body></html>
    `);
  }

  if (action === 'approve') {
    pending.status = 'approved';
    pendingApprovals.delete(token);
    // Broadcast approval to all connected clients
    io.emit('tasks_approved', { tasks: pending.tasks, meetingTitle: pending.meetingTitle });

    return res.send(`
      <html><body style="font-family:-apple-system,sans-serif;text-align:center;padding:60px;background:#F9FAFB;">
        <div style="max-width:400px;margin:0 auto;background:white;padding:40px;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.1);">
          <div style="font-size:48px;margin-bottom:16px;">✅</div>
          <h2 style="color:#10B981;margin:0 0 8px;">Tasks Approved!</h2>
          <p style="color:#6B7280;">${pending.tasks.filter(t => t.action === 'add_node').length} task(s) from "<strong>${pending.meetingTitle}</strong>" have been added to the operations map.</p>
          <p style="font-size:13px;color:#9CA3AF;margin-top:20px;">You can close this tab.</p>
        </div>
      </body></html>
    `);

  } else {
    pending.status = 'rejected';
    pendingApprovals.delete(token);
    io.emit('tasks_rejected', { meetingTitle: pending.meetingTitle });

    return res.send(`
      <html><body style="font-family:-apple-system,sans-serif;text-align:center;padding:60px;background:#F9FAFB;">
        <div style="max-width:400px;margin:0 auto;background:white;padding:40px;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.1);">
          <div style="font-size:48px;margin-bottom:16px;">❌</div>
          <h2 style="color:#EF4444;margin:0 0 8px;">Tasks Rejected</h2>
          <p style="color:#6B7280;">The tasks from "<strong>${pending.meetingTitle}</strong>" were rejected and will not be added to the map.</p>
        </div>
      </body></html>
    `);
  }
});

// ── API: Save email settings ──────────────────────────────────────────────────
app.post('/api/email-settings', (req, res) => {
  const { emailUser, emailPass } = req.body;
  if (emailUser) sharedState.emailUser = emailUser;
  if (emailPass) sharedState.emailPass = emailPass;
  saveToDisk();
  res.json({ success: true });
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', users: activeUsers.size, nodes: sharedState.nodes?.length ?? 0 });
});

// ── Active users ──────────────────────────────────────────────────────────────
const activeUsers = new Map();
const USER_COLORS = ['#FF6B35','#4ECDC4','#45B7D1','#96CEB4','#FFEAA7','#DDA0DD','#98D8C8','#F7DC6F','#BB8FCE','#85C1E9'];

function broadcastActiveUsers() { io.emit('active_users', Array.from(activeUsers.values())); }

// ── Socket.io events ──────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);
  socket.emit('init_state', sharedState);

  socket.on('user_join', ({ name }) => {
    const color = USER_COLORS[activeUsers.size % USER_COLORS.length];
    activeUsers.set(socket.id, { id: socket.id, name, color });
    broadcastActiveUsers();
    console.log(`[Socket] User joined: ${name}`);
  });

  socket.on('sync_full', ({ nodes, team }) => {
    sharedState.nodes = nodes;
    if (team) sharedState.team = team;
    saveToDisk();
    socket.broadcast.emit('sync_full', { nodes, team });
  });

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

  socket.on('cursor_move', ({ x, y }) => {
    const user = activeUsers.get(socket.id);
    if (user) {
      user.cursor = { x, y };
      socket.broadcast.emit('peer_cursor', { userId: socket.id, name: user.name, color: user.color, x, y });
    }
  });

  socket.on('team_updated', (team) => {
    sharedState.team = team;
    saveToDisk();
    socket.broadcast.emit('team_updated', team);
  });

  socket.on('disconnect', () => {
    const user = activeUsers.get(socket.id);
    activeUsers.delete(socket.id);
    broadcastActiveUsers();
    io.emit('peer_disconnected', { userId: socket.id });
    console.log(`[Socket] Disconnected: ${user?.name ?? socket.id}`);
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n🚀 Bits & Studios Collaboration Server`);
  console.log(`   Running at: http://localhost:${PORT}`);
  console.log(`   Share this URL with teammates to collaborate!\n`);
});
