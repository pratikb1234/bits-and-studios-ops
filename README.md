# Bits & Studios — Strategic Operations Mind Map

> **Build What You Imagine** — Pedagoging Studios LLP

A real-time, collaborative mind map for the Bits & Studios team to plan, track, and manage every operational area leading up to the **June 1, 2026 launch**.

---

## ✨ Features

- 🗺️ **Interactive Mind Map** — Horizontal tree layout with D3.js
- 🤖 **Claude AI Integration** — Chat with AI to add nodes, analyze gaps, and get strategic advice
- 🔴 **Real-Time Collaboration** — Google Docs-style multi-user editing with live presence cursors
- 📊 **Progress Tracking** — Status, priority, assignees, due dates, and subtasks per node
- ↩️ **Undo / Redo** — Full history navigation
- 📥 **Import / Export** — JSON backup and restore
- ⌨️ **Keyboard Shortcuts** — `Tab` (add child), `Enter` (add sibling), `Backspace` (delete), `Escape` (close)

---

## 🚀 Quick Start (Local)

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm start

# 3. Open your browser
open http://localhost:3000
```

Share `http://<your-ip>:3000` with teammates on the same network for **instant collaboration**.

---

## ☁️ Deploy to the Web (Free)

### Option A — Render (Recommended)
1. Push this repo to GitHub (already done ✅).
2. Go to [render.com](https://render.com) → **New Web Service**.
3. Connect your `bits-and-studios-ops` repo.
4. Set: **Runtime = Node**, **Start Command = `npm start`**.
5. Click **Deploy**. Done!

### Option B — Railway
```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

---

## 🔑 Claude AI Setup

1. Click **🤖 Claude AI** in the toolbar.
2. Enter your Anthropic API key (`sk-ant-...`).
3. Chat with Claude to add nodes, get strategy suggestions, or analyze gaps.

---

## 📁 Project Structure

```
├── index.html           # App shell + HTML structure
├── index.css            # Full design system (variables, components)
├── data.js              # Data layer (MindMapData class + real-time sync)
├── mindmap.js           # D3.js tree renderer
├── sidebar.js           # Node detail panel
├── chat.js              # Claude AI chat UI
├── claude-integration.js # Claude API calls + mind map mutations
├── app.js               # App bootstrap & event wiring
├── server.js            # Node.js + Socket.io collaboration server
└── package.json
```

---

## 👥 Team

- **Pratik Bhatt** — Founder
- **Anjalee Bhatt** — Co-Founder

**Location**: Alpha Business Park, Judges Bungalow Road, Bodakdev, Ahmedabad
**Launch**: June 1, 2026
