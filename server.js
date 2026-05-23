// ─── Bits & Studios — Real-Time Collaboration Server ────────────────────────
// Node.js + Express + Socket.io + Multer + Nodemailer

const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const { AgentJobQueue, SupervisorAgent, AGENT_PERSONAS } = require('./agent-runtime');
const { UserStore } = require('./users');
const { connectMongo, loadFromMongo, saveToMongo, isReady: mongoReady } = require('./database');

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
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'collab-data.json');
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

// Debounced save — used for rapid collab edits (1.5s delay before write)

async function saveData() {
  saveToDisk();
  if (require('./database').isReady) {
    await saveToMongo(sharedState).catch(e =>
      console.error('[MongoDB] Save failed (data still on disk):', e.message));
  }
}

// Debounced version used by collab-sync (prevents hammering DB on rapid edits)
function saveToDiskDebounced() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => saveData(), 1500);
}

// ── Build default sprint state (runs when no data exists on fresh deploy) ────
function buildDefaultState() {
  const { TEAM, DOCS, MEETINGS, STANDUP, SPRINT } = require('./seed-sprint');
  const crypto = require('crypto');
  const uid = () => crypto.randomBytes(6).toString('hex');

  const DEPT_DEFS = [
    { key:'marketing',  label:'Marketing',   icon:'📣' },
    { key:'operations', label:'Operations',  icon:'⚙️' },
    { key:'curriculum', label:'Curriculum',  icon:'🎓' },
    { key:'technology', label:'Technology',  icon:'💻' },
    { key:'community',  label:'Community',   icon:'🤝' },
    { key:'management', label:'Management',  icon:'🏢' },
    { key:'finance',    label:'Finance',     icon:'💰' },
    { key:'space_design',label:'Space Design',icon:'🏗️'},
  ];

  const nodes = [];

  // Root
  nodes.push({ id:'root', label:'Bits & Studios', description: SPRINT.goal,
    icon:'🎯', status:'in_progress', parentId: null, createdAt: Date.now() });

  // Departments
  const deptIdMap = {};
  for (const d of DEPT_DEFS) {
    const id = 'dept_' + d.key;
    nodes.push({ id, label: d.label, icon: d.icon, department: d.key,
      parentId: 'root', status: 'in_progress', createdAt: Date.now() });
    deptIdMap[d.key] = id;
  }

  // Sprint group folders (one per dept used by docs)
  const usedDepts = [...new Set(DOCS.map(d => d.dept))];
  const groupIds  = {};
  const GROUP_LABELS = {
    marketing: 'Brand + Marketing Docs',
    operations: 'Operations Docs',
    curriculum: 'Curriculum Docs',
  };
  for (const dept of usedDepts) {
    const gid = 'sprint_' + dept;
    nodes.push({ id: gid, parentId: deptIdMap[dept], label: GROUP_LABELS[dept] || dept + ' Docs',
      icon: '📁', department: dept, status: 'not_started', createdAt: Date.now(),
      description: 'Documentation Week Sprint — May 24-30, 2026',
      createdBy: 'system', ownerName: 'Admin', collaborators: [] });
    groupIds[dept] = gid;
  }

  // 19 Sprint documents
  for (const doc of DOCS) {
    nodes.push({
      id: 'doc_' + uid(), parentId: groupIds[doc.dept] || deptIdMap[doc.dept] || 'root',
      label: doc.label, description: doc.description, icon: doc.icon || '📄',
      department: doc.dept, status: doc.status || 'not_started',
      priority: doc.priority || 'high', dueDate: doc.dueDate,
      assignees: [doc.owner], support: doc.support, area: doc.area,
      meetingDate: doc.meetingDate, createdBy: doc.ownerId, ownerName: doc.owner,
      collaborators: [], createdAt: Date.now(),
    });
  }

  // Daily standup
  nodes.push({ id: 'standup_daily', parentId: deptIdMap['management'],
    label: STANDUP.label, description: STANDUP.description, icon: STANDUP.icon,
    department: 'management', status: 'in_progress', priority: 'high',
    assignees: STANDUP.assignees, createdBy: 'system', ownerName: 'Team',
    collaborators: [], createdAt: Date.now() });

  // Meetings
  for (const mtg of MEETINGS) {
    nodes.push({ id: 'mtg_' + uid(),
      parentId: deptIdMap[mtg.dept] || deptIdMap['management'],
      label: mtg.label, description: `Duration: ${mtg.duration}`,
      icon: mtg.icon || '📅', department: mtg.dept, status: 'not_started',
      dueDate: mtg.dueDate, assignees: mtg.assignees,
      createdBy: 'system', ownerName: 'Admin', collaborators: [], createdAt: Date.now() });
  }

  // Team members (users)
  const users = TEAM.map(m => ({
    ...m, pin: process.env.ADMIN_PIN || 'IamgoingtoMake', createdAt: Date.now(),
  }));

  console.log(`[Server] 🌱 Built default sprint state: ${nodes.length} nodes, ${users.length} users`);
  return { nodes, users, settings: {}, version: 1 };
}

// ── Boot: try MongoDB first, fall back to file, fall back to defaults ─────────
async function boot() {
  const mongoOk = await connectMongo();

  if (mongoOk) {
    const mongoData = await loadFromMongo();
    if (mongoData && mongoData.nodes?.length) {
      sharedState = mongoData;
      console.log(`[Server] ✅ Loaded ${sharedState.nodes.length} nodes from MongoDB Atlas`);
      saveToDisk();
    } else {
      // MongoDB empty — try local file first
      loadFromDisk();
      if (sharedState.nodes?.length) {
        console.log('[Server] Seeding MongoDB from local file...');
        await saveToMongo(sharedState);
      } else {
        // Truly fresh deploy — build defaults and save
        console.log('[Server] 🆕 Fresh deploy detected — loading sprint defaults...');
        sharedState = buildDefaultState();
        saveToDisk();
        await saveToMongo(sharedState);
      }
    }
  } else {
    // No MongoDB
    loadFromDisk();
    if (!sharedState.nodes?.length) {
      console.log('[Server] 🆕 No data on disk — loading sprint defaults...');
      sharedState = buildDefaultState();
      saveToDisk();
    }
  }
}

// Run boot (async) — server will start after this resolves


// ── User store (init after disk load so users are in sharedState) ───────────────
const userStore = new UserStore(sharedState, saveToDisk);

// ── Gemini API key (persisted: env var > disk storage > empty) ────────────────────
let cachedGeminiKey = process.env.GEMINI_API_KEY || sharedState.settings?.geminiApiKey || '';
if (cachedGeminiKey) {
  console.log('[Server] Gemini API key ready (length:', cachedGeminiKey.length, ')');
} else {
  console.warn('[Server] ⚠️  No Gemini API key found. Set GEMINI_API_KEY env var on Render or save in ⚙️ Settings.');
}

// ── Agent Job Queue (singleton) ──────────────────────────────────────────────
const agentQueue = new AgentJobQueue();

// ── Auth middleware ─────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  const token = req.headers['x-session-token'] || req.query._token;
  const session = userStore.verifyToken(token);
  if (!session || session.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  req.session = session;
  next();
}

function getSession(req) {
  const token = req.headers['x-session-token'] || req.query._token || '';
  return userStore.verifyToken(token);
}

// ── Approval tokens store ────────────────────────────────────────────────────
// { token → { tasks, meetingTitle, assignee, status, createdAt } }
const pendingApprovals = new Map();

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/users — list all users (public, no auth needed — names/avatars only)
app.get('/api/users', (req, res) => {
  res.json({ users: userStore.getUsers() });
});

// POST /api/auth/login — select a user profile, get session token
app.post('/api/auth/login', (req, res) => {
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId required' });
  const result = userStore.login(userId);
  if (!result) return res.status(404).json({ error: 'User not found' });
  res.json(result);
});

// POST /api/save-key — store org Gemini key server-side
app.post('/api/save-key', (req, res) => {
  const key = req.body?.key || req.body?.geminiApiKey;
  if (!key) return res.status(400).json({ error: 'Key required' });
  cachedGeminiKey = key;
  if (!sharedState.settings) sharedState.settings = {};
  sharedState.settings.geminiApiKey = key;
  saveToDiskDebounced();
  saveData().catch(() => {});
  console.log('[Server] Gemini API key saved (length:', key.length, ')');
  res.json({ ok: true });
});

// GET /api/check-key — org-wide key status (used by all clients)
app.get('/api/check-key', (req, res) => {
  const key = cachedGeminiKey || process.env.GEMINI_API_KEY || sharedState.settings?.geminiApiKey || '';
  res.json({ hasKey: !!key, key });
});

// POST /api/auth/verify-pin — verify admin PIN for sensitive actions
app.post('/api/auth/verify-pin', (req, res) => {
  const { userId, pin } = req.body || {};
  if (!userId || !pin) return res.status(400).json({ error: 'userId and pin required' });
  const ok = userStore.verifyPin(userId, pin);
  if (!ok) return res.status(401).json({ error: 'Incorrect PIN' });
  res.json({ ok: true });
});

// POST /api/users — create user (employee: open, admin: requires token)
app.post('/api/users', (req, res) => {
  const { name, role, pin, color, department } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });

  // Creating an admin user requires admin token
  if (role === 'admin') {
    const token   = req.headers['x-session-token'] || req.query._token;
    const session = userStore.verifyToken(token);
    if (!session || session.role !== 'admin') {
      return res.status(403).json({ error: 'Admin token required to create admin users' });
    }
  }

  const user = userStore.addUser({ name, role: role || 'employee', pin, color, department });
  io.emit('users_updated', { users: userStore.getUsers() });
  res.json({ ok: true, user });
});

// PUT /api/users/:id/pin — change PIN (admin only)
app.put('/api/users/:id/pin', requireAdmin, (req, res) => {
  const { pin } = req.body || {};
  if (!pin) return res.status(400).json({ error: 'pin required' });
  const ok = userStore.updatePin(req.params.id, pin);
  res.json({ ok });
});

// DELETE /api/users/:id — delete user (admin only)
app.delete('/api/users/:id', requireAdmin, (req, res) => {
  const ok = userStore.deleteUser(req.params.id);
  io.emit('users_updated', { users: userStore.getUsers() });
  res.json({ ok });
});

// (duplicate save-key removed — consolidated above)

// ── Load API key from disk on startup ─────────────────────────────────────────
// (runs after loadFromDisk + UserStore init)
function loadApiKeyFromDisk() {
  // Priority: env var > disk > empty
  if (process.env.GEMINI_API_KEY) {
    cachedGeminiKey = process.env.GEMINI_API_KEY;
    console.log('[Server] Gemini API key loaded from environment variable');
  } else if (sharedState.settings?.geminiApiKey) {
    cachedGeminiKey = sharedState.settings.geminiApiKey;
    console.log('[Server] Gemini API key loaded from disk (length:', cachedGeminiKey.length, ')');
  } else {
    console.warn('[Server] ⚠️  No Gemini API key found. Set GEMINI_API_KEY env var on Render, or save it via Settings.');
  }
}

// ── /api/list-models — list available Gemini models ───────────────────────────
app.get('/api/list-models', async (req, res) => {
  const key = req.query.key || cachedGeminiKey;
  if (!key) return res.status(400).json({ error: 'No API key available. Save one in Settings first.' });
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    // Filter to only models that support generateContent
    const models = (data.models || [])
      .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
      .map(m => ({ name: m.name.replace('models/', ''), displayName: m.displayName, description: m.description }));
    res.json({ models });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── /api/chat — Gemini proxy with auto model fallback ─────────────────────────
app.post('/api/chat', async (req, res) => {
  const { messages, systemPrompt, apiKey, model = 'gemini-flash-latest' } = req.body || {};

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
    generationConfig: { temperature: 0.7, maxOutputTokens: 8192, topP: 0.95 },
  };

  // ── Auto-fallback: try requested model, fall back to gemini-flash-latest ──
  const FALLBACK_MODEL = 'gemini-flash-latest';
  const modelsToTry = model === FALLBACK_MODEL ? [model] : [model, FALLBACK_MODEL];

  for (const tryModel of modelsToTry) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${tryModel}:generateContent?key=${key}`;
    console.log(`[Gemini] → model:${tryModel} | turns:${contents.length} | sysprompt:${systemPrompt ? systemPrompt.length + ' chars' : 'none'}`);

    try {
      const gRes = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });

      const data = await gRes.json();

      if (!gRes.ok) {
        const errMsg = data?.error?.message || `HTTP ${gRes.status}`;
        const isNotFound = errMsg.includes('not found') || errMsg.includes('not supported');

        if (isNotFound && tryModel !== FALLBACK_MODEL) {
          console.warn(`[Gemini] ⚠ ${tryModel} not available — falling back to ${FALLBACK_MODEL}`);
          continue; // try next model
        }

        console.error('[Gemini] ✗ API error:', errMsg);
        return res.status(gRes.status).json({ error: errMsg });
      }

      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        const reason = data?.candidates?.[0]?.finishReason || 'unknown';
        console.error('[Gemini] ✗ Empty response. finishReason:', reason);
        return res.status(500).json({ error: `Empty response (reason: ${reason})` });
      }

      console.log(`[Gemini] ✓ model:${tryModel} | response: ${text.length} chars`);
      return res.json({ text, model: tryModel });

    } catch (err) {
      console.error('[Gemini] ✗ Network error:', err.message);
      return res.status(500).json({ error: 'Network error reaching Gemini: ' + err.message });
    }
  }

  // All models failed
  return res.status(503).json({ error: 'No available Gemini model could process this request.' });
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
  res.json({
    status: 'ok',
    users:       activeUsers.size,
    nodes:       sharedState.nodes?.length ?? 0,
    activeJobs:  agentQueue.getActiveJobs().length,
    totalJobs:   agentQueue.getAll().length,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AGENT ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/agent/run — Start an agent job on a task
app.post('/api/agent/run', async (req, res) => {
  const { taskId, agentPersona, apiKey } = req.body || {};
  const key = apiKey || cachedGeminiKey;

  if (!taskId)       return res.status(400).json({ error: 'taskId required' });
  if (!agentPersona) return res.status(400).json({ error: 'agentPersona required' });
  if (!key)          return res.status(400).json({ error: 'No API key. Save one in ⚙️ Settings.' });
  if (!AGENT_PERSONAS[agentPersona]) return res.status(400).json({ error: `Unknown persona: ${agentPersona}` });

  // Find task in server state
  const allNodes = sharedState.nodes || [];
  const taskData = allNodes.find(n => n.id === taskId);
  if (!taskData) return res.status(404).json({ error: `Task ${taskId} not found on server` });

  // Create job
  const job = agentQueue.create({ taskId, taskData, allNodes, agentPersona, apiKey: key, io });

  // Start async (non-blocking)
  job.run().catch(err => console.error('[Agent] Unhandled job error:', err));

  // Save agent info to node
  const nodeIdx = allNodes.findIndex(n => n.id === taskId);
  if (nodeIdx !== -1) {
    allNodes[nodeIdx].agent = {
      ...(allNodes[nodeIdx].agent || {}),
      persona:   agentPersona,
      status:    'running',
      lastJobId: job.jobId,
      lastRun:   job.createdAt,
    };
    saveToDisk();
    io.emit('node_updated', allNodes[nodeIdx]);
  }

  console.log(`[Agent] Started job ${job.jobId} | task:${taskData.label} | persona:${agentPersona}`);
  res.json({ jobId: job.jobId, status: 'running', taskId, agentPersona });
});

// GET /api/agent/job/:jobId — Full job state + activity log
app.get('/api/agent/job/:jobId', (req, res) => {
  const job = agentQueue.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({
    jobId:        job.jobId,
    taskId:       job.taskId,
    taskLabel:    job.taskData?.label,
    agentPersona: job.agentPersona,
    personaName:  AGENT_PERSONAS[job.agentPersona]?.name,
    status:       job.status,
    createdAt:    job.createdAt,
    completedAt:  job.completedAt,
    summary:      job.summary,
    turnCount:    job.turnCount,
    activity:     job.activity,
    createdDocs:  job.createdDocs,
  });
});

// GET /api/agent/jobs — List all jobs (summaries)
app.get('/api/agent/jobs', (req, res) => {
  const { taskId } = req.query;
  let summaries = agentQueue.getSummaries();
  if (taskId) summaries = summaries.filter(j => j.taskId === taskId);
  res.json({ jobs: summaries, activeCount: agentQueue.getActiveJobs().length });
});

// DELETE /api/agent/job/:jobId — Cancel a running job
app.delete('/api/agent/job/:jobId', (req, res) => {
  agentQueue.cancel(req.params.jobId);
  res.json({ ok: true });
});

// POST /api/agent/chat — Chat with a task-scoped agent
app.post('/api/agent/chat', async (req, res) => {
  const { taskId, agentPersona, messages, apiKey } = req.body || {};
  const key = apiKey || cachedGeminiKey;

  if (!key)    return res.status(400).json({ error: 'No API key' });
  if (!taskId) return res.status(400).json({ error: 'taskId required' });

  const allNodes = sharedState.nodes || [];
  const taskData = allNodes.find(n => n.id === taskId);
  if (!taskData) return res.status(404).json({ error: 'Task not found' });

  const persona = AGENT_PERSONAS[agentPersona] || AGENT_PERSONAS.gemini;

  // Find recent job activity for this task to give agent memory
  const recentJobs = agentQueue.getByTask(taskId).slice(-3);
  const agentMemory = recentJobs.map(j =>
    `[Previous run ${new Date(j.createdAt).toLocaleDateString()}]: ${j.summary || 'No summary'}`
  ).join('\n');

  const siblingContext = allNodes
    .filter(n => n.parentId === taskData.parentId && n.id !== taskId)
    .map(n => `• ${n.label} [${n.status}]`).join('\n');

  const systemPrompt = `${persona.personality}

You are the dedicated AI agent for this specific task. Answer questions, provide analysis, and help with anything related to this task.

TASK: ${taskData.label}
Status: ${taskData.status} | Priority: ${taskData.priority}
Description: ${taskData.description || 'None'}
Assignees: ${(taskData.assignees || []).join(', ') || 'Unassigned'}
Due Date: ${taskData.dueDate || 'Not set'}
Subtasks: ${(taskData.subtasks || []).map(s => (s.done ? '✓' : '○') + ' ' + s.text).join(', ') || 'None'}

RELATED TASKS:
${siblingContext || 'None'}

${agentMemory ? 'YOUR PREVIOUS WORK:\n' + agentMemory : ''}

Answer as the task expert. Be specific, concise, and helpful. Reference actual task data.`;

  try {
    const contents = (messages || []).map(m => ({
      role:  m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    if (!contents.length || contents[0].role !== 'user') {
      contents.unshift({ role: 'user', parts: [{ text: '(start)' }] });
    }

    const gRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${key}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: { temperature: 0.6, maxOutputTokens: 4096 },
        }),
      }
    );

    const data = await gRes.json();
    if (!gRes.ok) throw new Error(data?.error?.message || `HTTP ${gRes.status}`);

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Empty response');

    res.json({ text, taskId, agentPersona });
  } catch (err) {
    console.error('[AgentChat] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/supervisor/brief/:dept — Department supervisor briefing
app.get('/api/supervisor/brief/:dept', async (req, res) => {
  const { dept } = req.params;
  const apiKey   = req.query.key || cachedGeminiKey;

  if (!apiKey) return res.status(400).json({ error: 'No API key' });

  const DEPT_PERSONA_MAP = {
    marketing:    'aria',
    finance:      'atlas',
    curriculum:   'sage',
    operations:   'max',
    space_design: 'max',
    equipment:    'max',
    community:    'aria',
    partnerships: 'aria',
  };

  const agentPersona = DEPT_PERSONA_MAP[dept] || 'gemini';
  const allNodes     = sharedState.nodes || [];

  try {
    const supervisor = new SupervisorAgent({ department: dept, agentPersona, allNodes, apiKey, io });
    const brief      = await supervisor.runBrief();
    res.json(brief);
  } catch (err) {
    console.error('[Supervisor] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/supervisor/run-all — Run all agents for a department
app.post('/api/supervisor/run-all', async (req, res) => {
  const { department, agentPersona, apiKey } = req.body || {};
  const key = apiKey || cachedGeminiKey;

  if (!key || !department) return res.status(400).json({ error: 'department and apiKey required' });

  const allNodes  = sharedState.nodes || [];
  const deptTasks = allNodes.filter(n => n.department === department && n.id !== 'root');

  const jobs = [];
  for (const task of deptTasks) {
    const job = agentQueue.create({ taskId: task.id, taskData: task, allNodes, agentPersona, apiKey: key, io });
    job.run().catch(err => console.error('[Agent] Batch job error:', err));
    jobs.push({ jobId: job.jobId, taskId: task.id, taskLabel: task.label });

    // Small delay between agent starts to avoid rate limits
    await new Promise(r => setTimeout(r, 1500));
  }

  res.json({ started: jobs.length, jobs });
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

// ── Sprint Seeder ─────────────────────────────────────────────────────────────
app.post('/api/admin/seed-sprint', requireAdmin, async (req, res) => {
  try {
    const { TEAM, DOCS, MEETINGS, STANDUP, SPRINT } = require('./seed-sprint');
    const crypto = require('crypto');
    const uid = () => crypto.randomBytes(6).toString('hex');

    // 1. Find department node IDs (keep them)
    const all = sharedState.nodes || [];
    const deptNodeIds = new Set(
      all.filter(n => n.parentId === 'root').map(n => n.id)
    );

    // 2. Delete ALL non-root, non-dept nodes
    const kept = all.filter(n => n.id === 'root' || deptNodeIds.has(n.id));
    sharedState.nodes = kept;

    // Update root label
    const root = sharedState.nodes.find(n => n.id === 'root');
    if (root) {
      root.label = 'Bits & Studios';
      root.description = SPRINT.goal;
    }

    // Dept key → node id map
    const deptIdMap = {};
    sharedState.nodes.forEach(n => {
      if (n.parentId === 'root') deptIdMap[n.department] = n.id;
    });

    // Dept name → key mapping (handle 'curriculum' dept which may not exist)
    const DEPT_NAME_MAP = {
      marketing:  'marketing',
      operations: 'operations',
      curriculum: 'curriculum',
      community:  'community',
      management: 'management',
      technology: 'technology',
      finance:    'finance',
    };

    // Create missing dept nodes
    for (const deptKey of ['curriculum','management','community','technology']) {
      if (!deptIdMap[deptKey]) {
        const deptLabels = {
          curriculum: 'Curriculum', management: 'Management',
          community: 'Community', technology: 'Technology',
        };
        const deptNode = {
          id: 'dept_' + deptKey,
          label: deptLabels[deptKey] || deptKey,
          parentId: 'root',
          department: deptKey,
          status: 'in_progress',
          icon: { curriculum:'🎓', management:'🏢', community:'🤝', technology:'💻' }[deptKey] || '📂',
          createdAt: Date.now(),
        };
        sharedState.nodes.push(deptNode);
        deptIdMap[deptKey] = deptNode.id;
      }
    }

    // 3. Upsert team members
    if (!sharedState.users) sharedState.users = [];
    for (const member of TEAM) {
      const existing = sharedState.users.find(u => u.id === member.id);
      if (!existing) {
        sharedState.users.push({
          ...member,
          pin:      '1234',  // default PIN — admin should change via Manage Team
          createdAt: Date.now(),
        });
      } else {
        Object.assign(existing, { name: member.name, color: member.color, avatar: member.avatar });
      }
    }

    // 4. Create a parent "Documentation Week Sprint" node under each dept used
    const usedDepts = [...new Set(DOCS.map(d => d.dept))];
    const sprintGroupIds = {};
    for (const dept of usedDepts) {
      const parentId = deptIdMap[dept];
      if (!parentId) continue;
      const groupId = 'sprint_' + dept;
      // Remove existing sprint group if present (idempotent)
      sharedState.nodes = sharedState.nodes.filter(n => n.id !== groupId);
      const groupNode = {
        id:          groupId,
        parentId,
        label:       { marketing:'Brand + Marketing Docs', operations:'Operations Docs', curriculum:'Curriculum Docs' }[dept] || dept + ' Docs',
        icon:        '📁',
        department:  dept,
        status:      'not_started',
        description: `Documentation Week Sprint — May 24-30, 2026`,
        createdAt:   Date.now(),
        createdBy:   'system',
        ownerName:   'Admin',
        collaborators: [],
      };
      sharedState.nodes.push(groupNode);
      sprintGroupIds[dept] = groupId;
    }

    // 5. Create all 19 document nodes
    for (const doc of DOCS) {
      const nodeId = 'doc_' + uid();
      const deptKey = DEPT_NAME_MAP[doc.dept] || doc.dept;
      const parentId = sprintGroupIds[deptKey] || deptIdMap[deptKey] || 'root';
      sharedState.nodes.push({
        id:           nodeId,
        parentId,
        label:        doc.label,
        description:  doc.description,
        icon:         doc.icon || '📄',
        department:   deptKey,
        status:       doc.status || 'not_started',
        priority:     doc.priority || 'high',
        dueDate:      doc.dueDate,
        assignees:    [doc.owner],
        support:      doc.support,
        area:         doc.area,
        meetingDate:  doc.meetingDate,
        createdBy:    doc.ownerId,
        ownerName:    doc.owner,
        collaborators:[],
        createdAt:    Date.now(),
      });
    }

    // 6. Create standup node
    const standupParent = deptIdMap['management'] || 'root';
    sharedState.nodes.push({
      id:          'standup_daily',
      parentId:    standupParent,
      label:       STANDUP.label,
      description: STANDUP.description,
      icon:        STANDUP.icon,
      department:  'management',
      status:      'in_progress',
      priority:    'high',
      assignees:   STANDUP.assignees,
      createdBy:   'system',
      ownerName:   'Team',
      collaborators:[],
      createdAt:   Date.now(),
    });

    // 7. Create meeting nodes
    for (const mtg of MEETINGS) {
      const parentId = deptIdMap[mtg.dept] || deptIdMap['management'] || 'root';
      sharedState.nodes.push({
        id:          'mtg_' + uid(),
        parentId,
        label:       mtg.label,
        description: `Duration: ${mtg.duration}`,
        icon:        mtg.icon || '📅',
        department:  mtg.dept,
        status:      'not_started',
        dueDate:     mtg.dueDate,
        assignees:   mtg.assignees,
        createdBy:   'system',
        ownerName:   'Admin',
        collaborators:[],
        createdAt:   Date.now(),
      });
    }

    await saveData();
    io.emit('state_update', { nodes: sharedState.nodes });

    res.json({
      ok:    true,
      nodes: sharedState.nodes.length,
      docs:  DOCS.length,
      team:  TEAM.length,
      msg:   `Sprint seeded: ${DOCS.length} documents, ${MEETINGS.length} meetings, standup, ${TEAM.length} team members`,
    });
  } catch (e) {
    console.error('[Seed] Error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Start (async boot so MongoDB loads before requests) ──────────────────────
boot().then(() => {
  // Re-init UserStore after boot (sharedState may have been updated from MongoDB)
  userStore._sync?.();

  server.listen(PORT, () => {
    console.log(`
🚀 Bits & Studios Collaboration Server`);
    console.log(`   Running at: http://localhost:${PORT}`);
    if (require('./database').isReady) {
      console.log(`   💾 Data: MongoDB Atlas (persistent across deploys)`);
    } else {
      console.log(`   💾 Data: Local file (set MONGODB_URI on Render for persistence)`);
    }
    console.log(`   Share this URL with teammates to collaborate!
`);
  });
}).catch(err => {
  console.error('Boot error:', err);
  process.exit(1);
});
