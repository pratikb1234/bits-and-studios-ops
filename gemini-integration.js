// ─── Gemini API Client ────────────────────────────────────────────────────────
// Replaces Claude — uses Google Gemini 1.5 Flash (fast, free tier available)

class GeminiAPI {
  constructor(apiKey, model = 'gemini-1.5-flash') {
    this.apiKey = apiKey;
    this.model  = model;
  }

  setApiKey(key) { this.apiKey = key; }
  setModel(model) { this.model = model; }

  async sendMessage(messages, systemPrompt) {
    if (!this.apiKey) throw new Error('Gemini API Key is missing. Add it in ⚙️ Settings.');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    // Convert messages to Gemini format (role: 'user' | 'model')
    const contents = messages.map(m => ({
      role:  m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const body = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: {
        temperature:     0.7,
        maxOutputTokens: 4096,
        topP:            0.95,
      },
    };

    const response = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `Gemini API error ${response.status}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Empty response from Gemini');
    return text;
  }

  // ── System prompt for the mind map context ────────────────────────────────
  generateSystemPrompt(mapData) {
    const nodes = mapData.getAllNodes().map(n => ({
      id: n.id, label: n.label, department: n.department,
      parentId: n.parentId, status: n.status,
    }));

    return `You are an expert strategic advisor and project manager for "Bits & Studios", a makerspace launching on 2026-06-01.
Your job is to help the team build and manage their business strategy mind map.

CURRENT MIND MAP STATE:
\`\`\`json
${JSON.stringify(nodes, null, 2)}
\`\`\`

You can analyze the map to find gaps, suggest new strategies, and propose new tasks.

When you want to modify the mind map, output a JSON block inside <map_actions> tags.
Available actions:
1. {"action": "add_node", "parentId": "parent_node_id", "label": "Task Name", "department": "dept_id", "icon": "emoji"}
2. {"action": "update_node", "id": "node_id", "status": "in_progress|done"}
3. {"action": "delete_node", "id": "node_id"}

Example:
I will add social media tasks under Marketing.

<map_actions>
[
  {"action": "add_node", "parentId": "dept_marketing", "label": "Create Instagram Strategy", "department": "marketing", "icon": "📱"}
]
</map_actions>

Guidelines:
- Keep conversational responses concise.
- ALWAYS use valid JSON inside <map_actions> tags.
- Group tasks under existing department nodes when possible.
- If no map change is needed, skip the <map_actions> block.`;
  }

  parseActions(responseText) {
    const match = responseText.match(/<map_actions>\s*([\s\S]*?)\s*<\/map_actions>/);
    if (!match) return { text: responseText, actions: null };

    let actions = null;
    try { actions = JSON.parse(match[1]); } catch (e) { console.error('Gemini action parse error', e); }

    const text = responseText.replace(/<map_actions>[\s\S]*?<\/map_actions>/g, '').trim();
    return { text, actions };
  }

  // ── Meeting transcript prompt (for MeetingProcessor) ──────────────────────
  generateMeetingPrompt(nodes, team) {
    const nodeList = nodes.map(n => ({ id: n.id, label: n.label, parentId: n.parentId, status: n.status }));

    return `You are an AI operations assistant. You will be given meeting notes or a transcript.

Your job:
1. Write a short SUMMARY (3-5 bullets)
2. Extract all ACTION ITEMS — who does what, by when
3. Map those action items to the mind map as structured data
4. Update existing task statuses if discussed (e.g. "finished the logo" → update to "done")

CURRENT MIND MAP NODES:
\`\`\`json
${JSON.stringify(nodeList, null, 2)}
\`\`\`

TEAM MEMBERS: ${team.join(', ') || 'Not set'}
AVAILABLE STATUS: not_started, in_progress, done
AVAILABLE PRIORITY: low, medium, high, critical

Respond in EXACTLY this format:

SUMMARY:
• [bullet 1]
• [bullet 2]

ACTION ITEMS:
• [Person]: [Task] by [Date if mentioned]

<map_actions>
[
  {
    "action": "add_node",
    "parentId": "dept_marketing",
    "label": "Create Instagram content calendar",
    "department": "marketing",
    "icon": "📱",
    "assignees": ["Pratik"],
    "dueDate": "2026-06-01",
    "priority": "high",
    "description": "Discussed in meeting"
  }
]
</map_actions>

RULES:
- Only use parentIds from the node list above
- Prefer adding under department nodes
- If no parent matches, add under "root"
- Labels max 60 chars
- Only include map_actions if there are real tasks to add/update
- Format due dates as YYYY-MM-DD`;
  }
}

window.GeminiAPI = GeminiAPI;

// Back-compat alias so existing code using ClaudeAPI still works
window.ClaudeAPI = GeminiAPI;
