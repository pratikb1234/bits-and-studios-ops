// ─── Bits & Studios — Anthropic API Client ──────────────────────────────

class ClaudeAPI {
  constructor(apiKey, model = 'claude-3-haiku-20240307') {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = 'https://api.anthropic.com/v1/messages';
  }

  setApiKey(key) {
    this.apiKey = key;
  }
  
  setModel(model) {
    this.model = model;
  }

  async sendMessage(messages, systemPrompt) {
    if (!this.apiKey) {
      throw new Error('API Key is missing');
    }

    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true' // Required for client-side API calls
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 4096,
          system: systemPrompt,
          messages: messages,
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || `API Error: ${response.status}`);
      }

      const data = await response.json();
      return data.content[0].text;
    } catch (error) {
      console.error('Claude API Error:', error);
      throw error;
    }
  }

  // Generate system prompt incorporating current map state
  generateSystemPrompt(mapData) {
    // Simplify map data to avoid token limits
    const simplifiedNodes = mapData.getAllNodes().map(n => ({
      id: n.id,
      label: n.label,
      department: n.department,
      parentId: n.parentId,
      status: n.status
    }));

    return `You are an expert strategic advisor and project manager for "Bits & Studios", a makerspace. 
Your job is to help the user build and manage their business strategy mind map.

CURRENT MIND MAP STATE:
\`\`\`json
${JSON.stringify(simplifiedNodes, null, 2)}
\`\`\`

You can analyze the map to find gaps, suggest new strategies, and propose new tasks.

When you want to modify the mind map, you MUST output a JSON block inside \`<map_actions>\` tags.
The format of the JSON should be an array of action objects.
Available actions:
1. {"action": "add_node", "parentId": "parent_node_id", "label": "Task Name", "department": "dept_id", "icon": "emoji"}
2. {"action": "update_node", "id": "node_id", "status": "in_progress|done"}
3. {"action": "delete_node", "id": "node_id"}

Example Response:
This is a great idea. I will add a few tasks under Marketing to cover social media.

<map_actions>
[
  {
    "action": "add_node",
    "parentId": "dept_marketing",
    "label": "Create Instagram Strategy",
    "department": "marketing",
    "icon": "📱"
  },
  {
    "action": "add_node",
    "parentId": "dept_marketing",
    "label": "Setup TikTok Account",
    "department": "marketing",
    "icon": "🎵"
  }
]
</map_actions>

Guidelines:
- Keep your conversational responses concise.
- ALWAYS use valid JSON inside the <map_actions> tags.
- When suggesting tasks, try to group them under existing departments.
- If you don't need to modify the map, just answer normally without the <map_actions> block.`;
  }

  parseActions(responseText) {
    const match = responseText.match(/<map_actions>\s*([\s\S]*?)\s*<\/map_actions>/);
    if (!match) return { text: responseText, actions: null };
    
    let actions = null;
    try {
      actions = JSON.parse(match[1]);
    } catch (e) {
      console.error("Failed to parse map actions JSON:", e);
    }
    
    // Remove the xml block from the text meant for the user
    const text = responseText.replace(/<map_actions>\s*([\s\S]*?)\s*<\/map_actions>/g, '').trim();
    
    return { text, actions };
  }
}

window.ClaudeAPI = ClaudeAPI;
