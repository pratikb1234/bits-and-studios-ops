// ─── Bezos-Style Memo & Document System ──────────────────────────────────────
// Creates detailed operational documents like the Launch Guide example
// AI generates each section using a panel of domain experts

// ── Templates ─────────────────────────────────────────────────────────────────
const MEMO_TEMPLATES = {
  '6pager': {
    name: '6-Pager Strategic Memo',
    icon: '📋',
    description: 'Deep strategic document — Amazon style, 2000+ words',
    sections: [
      { id: 'executive',    title: 'Executive Summary',          placeholder: 'One paragraph that captures everything. Read this alone and understand the entire document.' },
      { id: 'problem',      title: 'Problem Statement',          placeholder: 'What problem are we solving? Why does it matter now? What happens if we do nothing?' },
      { id: 'goals',        title: 'Goals & Success Metrics',    placeholder: 'What does success look like in 30/60/90 days? How do we measure it?' },
      { id: 'current',      title: 'Current State of Affairs',   placeholder: 'What is the current situation? What is working? What is broken?' },
      { id: 'solution',     title: 'Proposed Solution & Plan',   placeholder: 'What are we proposing? Step by step. Who does what?' },
      { id: 'alternatives', title: 'Alternatives Considered',    placeholder: 'What other options did we evaluate? Why did we reject them?' },
      { id: 'risks',        title: 'Risks & Mitigations',        placeholder: 'What could go wrong? Likelihood × Impact. How do we address each?' },
      { id: 'financial',    title: 'Financial Impact & ROI',     placeholder: 'Costs, expected revenue, timeline to ROI, break-even.' },
      { id: 'team',         title: 'Team, Resources & Timeline', placeholder: 'Who is responsible? What resources are needed? Key milestones and dates.' },
      { id: 'actions',      title: 'Action Items',               placeholder: 'Table of next steps — Owner | Action | Deadline | Status' },
    ]
  },
  'launch_guide': {
    name: 'Launch Guide',
    icon: '🚀',
    description: 'Comprehensive launch playbook like the example document',
    sections: [
      { id: 'brand',        title: 'Brand Foundation',           placeholder: 'Brand identity, visual system, voice, mission, vision.' },
      { id: 'social',       title: 'Social Media Architecture',  placeholder: 'Platform strategy, content pillars, posting cadence.' },
      { id: 'community',    title: 'Community Management',       placeholder: 'Inbound communication, WhatsApp, response matrix.' },
      { id: 'enrollment',   title: 'Enrollment & Intake System', placeholder: 'Lead capture form, intake process, data management.' },
      { id: 'conversion',   title: 'Lead Conversion System',     placeholder: 'Follow-up timeline, trial class blueprint, closing process.' },
      { id: 'curriculum',   title: 'Program & Curriculum',       placeholder: 'Tracks, age groups, syllabus, skill progression.' },
      { id: 'operations',   title: 'Operations & Logistics',     placeholder: 'Space setup, equipment, safety, staffing.' },
      { id: 'marketing',    title: 'Marketing & Campaigns',      placeholder: 'Launch posts, paid ads, local activation.' },
      { id: 'collateral',   title: 'Collateral & Assets',        placeholder: 'Brochure, posters, presentations, digital assets.' },
      { id: 'checklist',    title: 'Pre-Launch Checklist',       placeholder: 'Every task that must be done before doors open.' },
      { id: 'vision',       title: 'Long-Term Vision',           placeholder: 'Where are we in 1, 3, 5 years?' },
    ]
  },
  'prfaq': {
    name: 'PR/FAQ (Launch Format)',
    icon: '📰',
    description: 'Amazon press release + internal/external FAQs',
    sections: [
      { id: 'headline',  title: 'Press Release Headline',     placeholder: 'If this launched today, what would the headline read?' },
      { id: 'dateline',  title: 'Dateline & Intro Paragraph', placeholder: 'City, Date — The launch sentence that captures everything.' },
      { id: 'body',      title: 'Full Press Release Body',    placeholder: 'Who, what, why, how — written for a journalist.' },
      { id: 'quote1',    title: 'Founder Quote',              placeholder: 'What would Pratik or Anjalee say about this?' },
      { id: 'quote2',    title: 'Customer / Member Quote',    placeholder: 'What would an ideal student or parent say?' },
      { id: 'faq_ext',   title: 'External FAQs',             placeholder: 'Questions a parent, student, or press would ask.' },
      { id: 'faq_int',   title: 'Internal FAQs',             placeholder: 'Questions team members and investors would ask.' },
    ]
  },
  '1pager': {
    name: '1-Pager Brief',
    icon: '📄',
    description: 'Quick focused brief — 500 words, fast decisions',
    sections: [
      { id: 'problem',   title: 'The Problem',       placeholder: 'What are we solving? One clear paragraph.' },
      { id: 'solution',  title: 'The Plan',          placeholder: 'What do we do? Why this approach?' },
      { id: 'impact',    title: 'Expected Impact',   placeholder: 'What changes? How do we measure success?' },
      { id: 'risks',     title: 'Key Risks',         placeholder: 'Top 3 risks and how we handle them.' },
      { id: 'actions',   title: 'Action Items',      placeholder: 'Who does what by when — max 5 items.' },
    ]
  },
};

// ── Expert Panel for Bits & Studios ──────────────────────────────────────────
const BITS_EXPERT_PANEL = [
  { role: 'Strategic Vision Expert',        icon: '🎯', focus: 'long-term positioning, brand authority, competitive differentiation in the Ahmedabad ed-tech market' },
  { role: 'Operations & Space Design Expert', icon: '🏗️', focus: 'physical space layout, equipment procurement, daily operational workflows, safety protocols, capacity planning' },
  { role: 'Marketing & Community Expert',   icon: '📣', focus: 'social media strategy, content creation, parent engagement, brand storytelling, local community activation in Ahmedabad' },
  { role: 'Financial & Enrollment Expert',  icon: '💰', focus: 'pricing strategy, revenue modeling, enrollment conversion, fee collection, cash flow for a makerspace in India' },
  { role: 'Curriculum & Learning Expert',   icon: '🎓', focus: 'program design for robotics/AI/coding, age-appropriate pedagogy, skill progression, student outcomes, certification' },
  { role: 'Risk & Compliance Expert',       icon: '⚠️', focus: 'legal contracts, safety compliance, liability, insurance, data privacy for minors, regulatory requirements in Gujarat' },
];

// ── Google Drive Sync ─────────────────────────────────────────────────────────
class GoogleDriveSync {
  constructor(clientId) {
    this.clientId    = clientId;
    this.accessToken = null;
    this._tokenExpiry = 0;
  }

  get isAuthenticated() {
    return this.accessToken && Date.now() < this._tokenExpiry;
  }

  async authenticate() {
    return new Promise((resolve, reject) => {
      if (!window.google?.accounts?.oauth2) {
        reject(new Error('Google Identity Services not loaded. Check your internet connection.'));
        return;
      }
      const client = google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: [
          'https://www.googleapis.com/auth/drive.file',
          'https://www.googleapis.com/auth/drive.metadata.readonly',
        ].join(' '),
        callback: (response) => {
          if (response.error) { reject(new Error(response.error)); return; }
          this.accessToken  = response.access_token;
          this._tokenExpiry = Date.now() + (response.expires_in * 1000);
          resolve(response.access_token);
        },
      });
      client.requestAccessToken();
    });
  }

  async ensureAuth() {
    if (!this.isAuthenticated) await this.authenticate();
  }

  // Create or find a "Bits & Studios Memos" folder
  async getOrCreateFolder(name = 'Bits & Studios — Memos') {
    await this.ensureAuth();
    const search = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=name='${encodeURIComponent(name)}' and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id,name)`,
      { headers: { Authorization: `Bearer ${this.accessToken}` } }
    );
    const data = await search.json();
    if (data.files?.length) return data.files[0].id;

    // Create folder
    const create = await fetch('https://www.googleapis.com/drive/v3/files', {
      method:  'POST',
      headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' }),
    });
    const folder = await create.json();
    return folder.id;
  }

  // Upload memo HTML → Google Doc in the Bits & Studios folder
  async uploadMemo(title, htmlContent, folderId) {
    await this.ensureAuth();

    const metadata = {
      name:     title,
      mimeType: 'application/vnd.google-apps.document',  // convert to Google Doc
      parents:  folderId ? [folderId] : [],
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file',     new Blob([htmlContent],              { type: 'text/html' }));

    const resp = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
      { method: 'POST', headers: { Authorization: `Bearer ${this.accessToken}` }, body: form }
    );
    return await resp.json();
  }

  // Make file publicly viewable and return link
  async makeShareable(fileId) {
    await this.ensureAuth();
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ role: 'reader', type: 'anyone' }),
    });
    const meta = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=webViewLink`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    return (await meta.json()).webViewLink;
  }
}

// ── DocsPanel — main controller ───────────────────────────────────────────────
class DocsPanel {
  constructor(data, geminiApi) {
    this.data       = data;
    this.gemini     = geminiApi;
    this.docs       = this._loadDocs();
    this.currentDoc = null;
    this.drive      = null;
    this._isOpen    = false;
    this._overlay   = null;
  }

  open()   { this._renderPanel(); document.getElementById('docs-overlay').classList.remove('hidden'); this._isOpen = true; }
  close()  { document.getElementById('docs-overlay').classList.add('hidden'); this._isOpen = false; }
  toggle() { this._isOpen ? this.close() : this.open(); }

  newDoc(templateKey) {
    const template = MEMO_TEMPLATES[templateKey];
    if (!template) return;

    const userName = localStorage.getItem('bits_collab_name') || 'Unknown';
    const doc = {
      id:           'doc_' + Date.now(),
      title:        'Untitled — ' + template.name,
      template:     templateKey,
      author:       userName,
      createdAt:    new Date().toISOString(),
      updatedAt:    new Date().toISOString(),
      sections:     template.sections.map(s => ({ ...s, content: '' })),
      comments:     [],
      linkedNodes:  [],
      driveLink:    null,
      wordCount:    0,
      status:       'draft',   // draft | reading | discussion | final
    };

    this.docs.unshift(doc);
    this._saveDocs();
    this._openEditor(doc);
  }

  _openEditor(doc) {
    this.currentDoc = doc;
    document.getElementById('docs-list-view').classList.add('hidden');
    document.getElementById('docs-editor-view').classList.remove('hidden');
    this._renderEditor(doc);
  }

  _backToList() {
    this.currentDoc = null;
    document.getElementById('docs-editor-view').classList.add('hidden');
    document.getElementById('docs-list-view').classList.remove('hidden');
    this._renderList();
  }

  _renderPanel() {
    document.getElementById('docs-list-view').classList.remove('hidden');
    document.getElementById('docs-editor-view').classList.add('hidden');
    this._renderList();
  }

  _renderList() {
    const list = document.getElementById('docs-doc-list');
    const tmplGrid = document.getElementById('docs-template-grid');

    // Template picker
    tmplGrid.innerHTML = Object.entries(MEMO_TEMPLATES).map(([key, t]) => `
      <div class="doc-template-card" onclick="window.app.docs.newDoc('${key}')">
        <div class="doc-tmpl-icon">${t.icon}</div>
        <div class="doc-tmpl-name">${t.name}</div>
        <div class="doc-tmpl-desc">${t.description}</div>
      </div>
    `).join('');

    // Doc list
    if (!this.docs.length) {
      list.innerHTML = `<div class="doc-empty">No documents yet.<br>Choose a template above to create your first memo.</div>`;
      return;
    }

    list.innerHTML = this.docs.map(d => `
      <div class="doc-list-item" onclick="window.app.docs._openEditor(window.app.docs.docs.find(x=>x.id==='${d.id}'))">
        <div class="doc-list-icon">${MEMO_TEMPLATES[d.template]?.icon || '📄'}</div>
        <div class="doc-list-body">
          <div class="doc-list-title">${d.title}</div>
          <div class="doc-list-meta">
            ${MEMO_TEMPLATES[d.template]?.name || 'Document'} · 
            By ${d.author} · 
            ${new Date(d.updatedAt).toLocaleDateString('en-IN', { day:'numeric', month:'short' })} · 
            ~${this._wordCount(d)} words
            ${d.driveLink ? ' · <span class="doc-drive-badge">📁 Drive</span>' : ''}
          </div>
        </div>
        <button class="doc-delete-btn" onclick="event.stopPropagation(); window.app.docs._deleteDoc('${d.id}')" title="Delete">🗑️</button>
      </div>
    `).join('');
  }

  _renderEditor(doc) {
    const template = MEMO_TEMPLATES[doc.template];
    const wc = this._wordCount(doc);
    const readMins = Math.max(1, Math.ceil(wc / 250));

    document.getElementById('doc-editor-title-input').value = doc.title;
    document.getElementById('doc-editor-meta').innerHTML =
      `${template.icon} ${template.name} · By ${doc.author} · ~${wc} words · ~${readMins} min read · ${doc.status}`;

    const sectionsEl = document.getElementById('doc-sections');
    sectionsEl.innerHTML = doc.sections.map((section, idx) => `
      <div class="doc-section" data-section-id="${section.id}">
        <div class="doc-section-header">
          <div class="doc-section-num">${idx + 1}</div>
          <div class="doc-section-title-wrap">
            <div class="doc-section-title">${section.title}</div>
          </div>
          <button class="doc-ai-btn" onclick="window.app.docs._generateSection('${doc.id}', '${section.id}')" title="Generate with Gemini AI Expert Panel">
            ✨ Generate
          </button>
        </div>
        <div class="doc-section-toolbar">
          <button onclick="document.execCommand('bold')" title="Bold"><b>B</b></button>
          <button onclick="document.execCommand('italic')" title="Italic"><i>I</i></button>
          <button onclick="document.execCommand('underline')" title="Underline"><u>U</u></button>
          <span class="doc-toolbar-sep"></span>
          <button onclick="document.execCommand('formatBlock', false, 'h2')" title="Heading 2">H2</button>
          <button onclick="document.execCommand('formatBlock', false, 'h3')" title="Heading 3">H3</button>
          <button onclick="document.execCommand('formatBlock', false, 'h4')" title="Heading 4">H4</button>
          <span class="doc-toolbar-sep"></span>
          <button onclick="document.execCommand('insertUnorderedList')" title="Bullet List">• List</button>
          <button onclick="document.execCommand('insertOrderedList')" title="Numbered List">1. List</button>
          <span class="doc-toolbar-sep"></span>
          <button onclick="window.app.docs._insertTable('${section.id}')" title="Insert Table">⊞ Table</button>
          <button onclick="window.app.docs._addComment('${doc.id}', '${section.id}')" title="Add Comment">💬 Comment</button>
        </div>
        <div class="doc-section-content"
             id="section-content-${section.id}"
             contenteditable="true"
             data-section="${section.id}"
             placeholder="${section.placeholder}"
             oninput="window.app.docs._onSectionInput('${doc.id}', '${section.id}', this)"
        >${section.content || ''}</div>
        <div class="doc-section-comments" id="section-comments-${section.id}">
          ${this._renderComments(doc, section.id)}
        </div>
        <div class="doc-ai-generating hidden" id="generating-${section.id}">
          <div class="doc-ai-spinner">
            <div class="dot"></div><div class="dot"></div><div class="dot"></div>
          </div>
          <span>Gemini expert panel is writing this section…</span>
        </div>
      </div>
    `).join('');

    // Update Drive button state
    const driveBtn = document.getElementById('doc-drive-btn');
    if (driveBtn) {
      driveBtn.innerHTML = doc.driveLink
        ? `<a href="${doc.driveLink}" target="_blank" class="doc-drive-link">📁 Open in Drive</a>`
        : '📁 Upload to Drive';
    }
  }

  async _generateSection(docId, sectionId) {
    const doc = this.docs.find(d => d.id === docId);
    if (!doc) return;
    const section = doc.sections.find(s => s.id === sectionId);
    if (!section) return;

    const settings = this.data.getSettings();
    const apiKey = settings.geminiApiKey || settings.anthropicApiKey;
    if (!apiKey) {
      window.app?.showToast('Please add your Gemini API key in ⚙️ Settings', 'error');
      return;
    }

    this.gemini.setApiKey(apiKey);
    this.gemini.model = 'gemini-flash-latest';

    // Show loading state
    document.getElementById(`generating-${sectionId}`)?.classList.remove('hidden');
    const aiBtn = document.querySelector(`[data-section-id="${sectionId}"] .doc-ai-btn`);
    if (aiBtn) { aiBtn.disabled = true; aiBtn.textContent = 'Generating…'; }

    try {
      const expertList = BITS_EXPERT_PANEL.map((e, i) =>
        `${i + 1}. ${e.icon} ${e.role}: focuses on ${e.focus}`).join('\n');

      // Check if there's any existing content as context
      const existingContent = section.content?.replace(/<[^>]+>/g, '').trim();

      const prompt = `You are facilitating a structured expert panel review session, creating a detailed section for a professional business document for **Bits & Studios** — a premium Robotics + AI + Coding Makerspace in Ahmedabad, India.

BUSINESS CONTEXT:
- Founders: Pratik and Anjalee (Pedagoging Studios LLP)
- Target audience: Students aged 6-18, parents, schools in Ahmedabad, Gujarat
- Programs: Robotics, Artificial Intelligence, Coding, Electronics, Makerspace Prototyping
- Launch date: June 1, 2026
- Physical space: Premium makerspace with high-end imported equipment
- Revenue model: Monthly/quarterly/annual enrollment + workshops + B2B school partnerships
- Competition: After-school coding centers; differentiation through physical hardware + AI
- City: Ahmedabad — vibrant entrepreneurial city, tech-forward families, strong STEM demand

DOCUMENT: "${doc.title}" (${MEMO_TEMPLATES[doc.template]?.name})
SECTION: "${section.title}"
${existingContent ? `EXISTING DRAFT TO EXPAND/IMPROVE:\n${existingContent}` : ''}

EXPERT PANEL (each gives their perspective):
${expertList}

INSTRUCTIONS:
Each expert gives their detailed, specific, opinionated perspective on "${section.title}" for Bits & Studios. They reference specific Ahmedabad context, real-world examples, and concrete action items. They disagree where appropriate and synthesize to the best solution.

Then write the final synthesized section that:
1. Is written in professional, authoritative prose (like an Amazon 6-pager or McKinsey report)
2. Uses clear **subheadings** for each sub-topic
3. Includes **specific action items** with owners (Pratik / Anjalee / Team)
4. Uses bullet points, numbered lists, and **tables** where they add clarity
5. References specific Ahmedabad context (neighborhoods, schools, competitors, pricing in INR)
6. Is minimum 500 words with maximum specificity — no generic filler
7. Uses HTML formatting (use <h3>, <h4>, <ul>, <ol>, <li>, <strong>, <em>, <table>, <tr>, <th>, <td>, <blockquote>)

Write only the section content — no introductory text, no "Here is the section:" preamble.`;

      const response = await this.gemini.sendMessage([{ role: 'user', content: prompt }], '');

      // Clean up the response — remove markdown if any, keep HTML
      let html = response
        .replace(/```html\n?/g, '').replace(/```\n?/g, '')  // remove code fences
        .replace(/^#{1,6}\s+(.+)$/gm, (_, t) => `<h3>${t}</h3>`)  // convert ## to h3
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/\n\n/g, '</p><p>')
        .trim();

      // Insert into contenteditable
      const contentEl = document.getElementById(`section-content-${sectionId}`);
      if (contentEl) {
        contentEl.innerHTML = html;
        section.content = html;
        doc.updatedAt = new Date().toISOString();
        this._saveDocs();
        this._updateWordCount(doc);
      }

      // Log to history
      if (window.app?.history) {
        window.app.history.record('update', { id: doc.id, label: `"${section.title}" in ${doc.title}` }, null);
      }

      window.app?.showToast(`✨ "${section.title}" generated by Gemini expert panel`, 'success');

    } catch (e) {
      window.app?.showToast('Generation failed: ' + e.message, 'error');
    } finally {
      document.getElementById(`generating-${sectionId}`)?.classList.add('hidden');
      if (aiBtn) { aiBtn.disabled = false; aiBtn.textContent = '✨ Generate'; }
      this.gemini.model = 'gemini-flash-latest';
    }
  }

  _onSectionInput(docId, sectionId, el) {
    const doc = this.docs.find(d => d.id === docId);
    if (!doc) return;
    const section = doc.sections.find(s => s.id === sectionId);
    if (section) {
      section.content = el.innerHTML;
      doc.updatedAt = new Date().toISOString();
    }
    // Debounced save
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveDocs();
      this._updateWordCount(doc);
    }, 1500);
  }

  _updateWordCount(doc) {
    const wc = this._wordCount(doc);
    const readMins = Math.max(1, Math.ceil(wc / 250));
    const meta = document.getElementById('doc-editor-meta');
    if (meta) {
      const template = MEMO_TEMPLATES[doc.template];
      meta.innerHTML = `${template.icon} ${template.name} · By ${doc.author} · ~${wc} words · ~${readMins} min read · ${doc.status}`;
    }
  }

  _insertTable(sectionId) {
    const html = `
<table>
  <thead><tr><th>Column 1</th><th>Column 2</th><th>Column 3</th></tr></thead>
  <tbody>
    <tr><td>Row 1</td><td>Data</td><td>Data</td></tr>
    <tr><td>Row 2</td><td>Data</td><td>Data</td></tr>
  </tbody>
</table>`;
    document.execCommand('insertHTML', false, html);
  }

  _addComment(docId, sectionId) {
    const doc = this.docs.find(d => d.id === docId);
    if (!doc) return;
    const text = prompt('Add your comment:');
    if (!text?.trim()) return;

    const comment = {
      id:        'cmt_' + Date.now(),
      sectionId,
      text:      text.trim(),
      author:    localStorage.getItem('bits_collab_name') || 'Someone',
      timestamp: new Date().toISOString(),
      resolved:  false,
    };

    doc.comments.push(comment);
    this._saveDocs();

    const commentsEl = document.getElementById(`section-comments-${sectionId}`);
    if (commentsEl) commentsEl.innerHTML = this._renderComments(doc, sectionId);
  }

  _renderComments(doc, sectionId) {
    const comments = (doc.comments || []).filter(c => c.sectionId === sectionId && !c.resolved);
    if (!comments.length) return '';
    return `<div class="doc-comments-list">${comments.map(c => `
      <div class="doc-comment" data-id="${c.id}">
        <div class="doc-comment-header">
          <span class="doc-comment-author">${c.author}</span>
          <span class="doc-comment-time">${new Date(c.timestamp).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' })}</span>
          <button class="doc-comment-resolve" onclick="window.app.docs._resolveComment('${doc.id}', '${c.id}', '${sectionId}')">✓ Resolve</button>
        </div>
        <div class="doc-comment-text">${c.text}</div>
      </div>
    `).join('')}</div>`;
  }

  _resolveComment(docId, commentId, sectionId) {
    const doc = this.docs.find(d => d.id === docId);
    if (!doc) return;
    const comment = doc.comments.find(c => c.id === commentId);
    if (comment) comment.resolved = true;
    this._saveDocs();
    const commentsEl = document.getElementById(`section-comments-${sectionId}`);
    if (commentsEl) commentsEl.innerHTML = this._renderComments(doc, sectionId);
  }

  // ── Title editing ────────────────────────────────────────────────────────────
  updateTitle(docId, title) {
    const doc = this.docs.find(d => d.id === docId);
    if (doc) { doc.title = title; doc.updatedAt = new Date().toISOString(); this._saveDocs(); }
  }

  // ── Export to HTML ───────────────────────────────────────────────────────────
  exportHTML(doc) {
    const template = MEMO_TEMPLATES[doc.template];
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${doc.title}</title>
  <style>
    body { font-family: -apple-system, 'Segoe UI', sans-serif; max-width: 860px; margin: 0 auto; padding: 48px 32px; color: #1a1a2e; line-height: 1.7; }
    h1 { font-size: 32px; font-weight: 800; margin-bottom: 4px; color: #0F172A; }
    .meta { color: #64748b; font-size: 14px; margin-bottom: 40px; padding-bottom: 20px; border-bottom: 2px solid #FF6600; }
    .section { margin-bottom: 48px; }
    .section-num { color: #FF6600; font-weight: 700; font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px; }
    .section h2 { font-size: 24px; font-weight: 700; margin: 0 0 16px; color: #0F172A; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; }
    h3 { font-size: 18px; font-weight: 700; color: #1e293b; margin: 24px 0 8px; }
    h4 { font-size: 15px; font-weight: 700; color: #334155; margin: 16px 0 6px; }
    p { margin: 0 0 14px; }
    ul, ol { margin: 0 0 14px; padding-left: 24px; }
    li { margin-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px; }
    th { background: #0F172A; color: white; padding: 10px 14px; text-align: left; font-weight: 600; }
    td { padding: 8px 14px; border-bottom: 1px solid #e2e8f0; }
    tr:nth-child(even) td { background: #f8fafc; }
    blockquote { border-left: 4px solid #FF6600; margin: 16px 0; padding: 12px 16px; background: #fff7ed; border-radius: 0 8px 8px 0; font-style: italic; }
    strong { color: #0F172A; }
    .footer { margin-top: 60px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 13px; color: #94a3b8; }
  </style>
</head>
<body>
  <h1>${doc.title}</h1>
  <div class="meta">
    ${template.icon} ${template.name} &nbsp;·&nbsp;
    By ${doc.author} &nbsp;·&nbsp;
    ${new Date(doc.createdAt).toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' })} &nbsp;·&nbsp;
    ~${this._wordCount(doc)} words
  </div>
  ${doc.sections.map((s, i) => `
    <div class="section">
      <div class="section-num">Section ${i + 1}</div>
      <h2>${s.title}</h2>
      <div>${s.content || '<p><em>Not yet written.</em></p>'}</div>
    </div>
  `).join('')}
  <div class="footer">
    Prepared by Bits &amp; Studios (Pedagoging Studios LLP) &nbsp;·&nbsp;
    Ahmedabad, India &nbsp;·&nbsp;
    Generated ${new Date().toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' })}
  </div>
</body>
</html>`;
    return html;
  }

  downloadHTML(doc) {
    const html = this.exportHTML(doc);
    const blob = new Blob([html], { type: 'text/html' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = doc.title.replace(/[^a-zA-Z0-9_-]/g, '_') + '.html';
    a.click();
    URL.revokeObjectURL(a.href);
    window.app?.showToast('📥 Document downloaded', 'success');
  }

  async uploadToDrive(doc) {
    const settings = this.data.getSettings();
    const clientId = settings.googleClientId;

    if (!clientId) {
      window.app?.showToast('Please add your Google Client ID in ⚙️ Settings', 'error');
      return;
    }

    const driveBtn = document.getElementById('doc-drive-btn');
    if (driveBtn) { driveBtn.textContent = '⏳ Uploading…'; driveBtn.disabled = true; }

    try {
      if (!this.drive || this.drive.clientId !== clientId) {
        this.drive = new GoogleDriveSync(clientId);
      }

      const html     = this.exportHTML(doc);
      const folderId = await this.drive.getOrCreateFolder();
      const file     = await this.drive.uploadMemo(doc.title, html, folderId);
      const link     = await this.drive.makeShareable(file.id);

      doc.driveLink = link;
      this._saveDocs();

      if (driveBtn) {
        driveBtn.innerHTML = `<a href="${link}" target="_blank" class="doc-drive-link">📁 Open in Drive</a>`;
        driveBtn.disabled = false;
      }

      window.app?.showToast('✅ Uploaded to Google Drive as a Google Doc!', 'success');
    } catch (e) {
      if (driveBtn) { driveBtn.textContent = '📁 Upload to Drive'; driveBtn.disabled = false; }
      window.app?.showToast('Drive upload failed: ' + e.message, 'error');
    }
  }

  _deleteDoc(docId) {
    if (!confirm('Delete this document? This cannot be undone.')) return;
    this.docs = this.docs.filter(d => d.id !== docId);
    this._saveDocs();
    this._renderList();
  }

  _wordCount(doc) {
    return doc.sections.reduce((sum, s) => {
      return sum + (s.content || '').replace(/<[^>]+>/g, '').split(/\s+/).filter(Boolean).length;
    }, 0);
  }

  _loadDocs() {
    try { return JSON.parse(localStorage.getItem('bits_docs') || '[]'); } catch { return []; }
  }

  _saveDocs() {
    localStorage.setItem('bits_docs', JSON.stringify(this.docs));
  }
}

window.DocsPanel = DocsPanel;
window.GoogleDriveSync = GoogleDriveSync;
