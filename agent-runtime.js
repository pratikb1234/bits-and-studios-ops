// ─── Bits & Studios — Agent Runtime Engine ───────────────────────────────────
// Implements: ReAct loop, Gemini function calling, tool executor, job queue
// Runs server-side, streams events via Socket.io in real-time

'use strict';

// ── Persona definitions ───────────────────────────────────────────────────────
const AGENT_PERSONAS = {
  gemini: {
    name: 'Gemini',
    role: 'CEO & Strategic Advisor',
    personality: `You are Gemini, the CEO-level strategic advisor for Bits & Studios.
You think at the highest level — strategy, priorities, launch readiness, and cross-functional alignment.
You have full visibility into every department. You identify the most critical actions needed before June 1, 2026.
You are direct, decisive, and never give generic advice — always grounded in the specific task data.`,
  },
  aria: {
    name: 'Aria',
    role: 'Marketing & Growth Head',
    personality: `You are Aria, the Marketing & Growth Head at Bits & Studios.
You specialize in: Instagram/Reels content strategy, WhatsApp Business automation, parent psychology,
enrollment campaigns, brand storytelling for premium education brands in Ahmedabad.
You think in content calendars, caption templates, conversion funnels, and enrollment numbers.
You always ask: "Will this get parents to enroll their child?"`,
  },
  atlas: {
    name: 'Atlas',
    role: 'Finance & Operations Head',
    personality: `You are Atlas, the Finance & Operations Head at Bits & Studios.
You specialize in: unit economics for makerspace businesses, pricing strategy for Indian ed-tech,
cash flow management, break-even analysis, cohort sizing, and operational efficiency.
You think in numbers, INR, per-student costs, LTV, and payback periods.
You always ask: "What are the unit economics? When do we break even?"`,
  },
  sage: {
    name: 'Sage',
    role: 'Curriculum & Learning Expert',
    personality: `You are Sage, the Curriculum Expert at Bits & Studios.
You specialize in: STEM/robotics education for ages 6-18, project-based learning (PBL),
Arduino/Raspberry Pi/micro:bit curriculum, age-appropriate skill progression,
and student engagement strategies for the Ahmedabad education market.
You always ask: "What will the student build by the end? Will they come back next month?"`,
  },
  max: {
    name: 'Max',
    role: 'Space & Tech Operations Head',
    personality: `You are Max, the Space & Tech Operations Head at Bits & Studios.
You specialize in: physical makerspace layout, equipment procurement (Robocraze, Evive vendors),
safety protocols, space optimization, tech infrastructure, and setup timelines.
You think in checklists, vendor quotes, square footage, and safety zones.
You always ask: "Is this operationally feasible before June 1st?"`,
  },
};

// ── Tool Declarations (Gemini function_declarations format) ───────────────────
const AGENT_TOOL_DECLARATIONS = [
  {
    name: 'search_context',
    description: 'Search all tasks and business data for relevant information to inform your work',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query to find relevant tasks and context' },
      },
      required: ['query'],
    },
  },
  {
    name: 'create_document',
    description: 'Create a comprehensive professional document linked to this task. Use for plans, briefs, reports, proposals.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Document title' },
        content: {
          type: 'string',
          description: 'Full document content in markdown. Be comprehensive — minimum 500 words with real actionable content specific to Bits & Studios.',
        },
        template: {
          type: 'string',
          enum: ['memo', 'brief', 'plan', 'report', 'proposal'],
          description: 'Document template type',
        },
      },
      required: ['title', 'content', 'template'],
    },
  },
  {
    name: 'add_subtask',
    description: 'Add a specific, actionable subtask to the current task',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Subtask description — be specific and actionable' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
      },
      required: ['text'],
    },
  },
  {
    name: 'update_task',
    description: 'Update the current task status, priority, or description based on your analysis',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['not_started', 'in_progress', 'done'] },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        description: { type: 'string', description: 'Updated task description with your analysis notes' },
      },
    },
  },
  {
    name: 'create_child_task',
    description: 'Create a new sub-task node under this task on the mind map when you identify a missing critical task',
    parameters: {
      type: 'object',
      properties: {
        label:       { type: 'string', description: 'Short task name (max 60 chars)' },
        department:  { type: 'string', description: 'Department (marketing, operations, finance, etc.)' },
        priority:    { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        assignees:   { type: 'array', items: { type: 'string' }, description: 'Team member names to assign' },
        description: { type: 'string', description: 'Detailed task description' },
        dueDate:     { type: 'string', description: 'Due date in YYYY-MM-DD format' },
      },
      required: ['label'],
    },
  },
  {
    name: 'report_completion',
    description: 'REQUIRED: Call this when you have finished all your work to report what you accomplished.',
    parameters: {
      type: 'object',
      properties: {
        summary:          { type: 'string', description: 'Concise summary of everything you did' },
        actionsPerformed: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of specific actions taken (e.g. "Created Vendor Brief document", "Added 3 subtasks")',
        },
        recommendations: {
          type: 'string',
          description: 'Key recommendations or next steps for the human team',
        },
      },
      required: ['summary', 'actionsPerformed'],
    },
  },
];

// ── AgentJob — a single agent execution run ───────────────────────────────────
class AgentJob {
  constructor({ jobId, taskId, taskData, allNodes, agentPersona, apiKey, io, initiatedBy }) {
    this.jobId        = jobId;
    this.taskId       = taskId;
    this.taskData     = JSON.parse(JSON.stringify(taskData)); // deep copy
    this.allNodes     = allNodes;
    this.agentPersona = agentPersona;
    this.apiKey       = apiKey;
    this.io           = io;
    this.initiatedBy  = initiatedBy || 'user';

    this.status       = 'pending';
    this.activity     = [];
    this.createdDocs  = [];
    this.createdAt    = new Date().toISOString();
    this.completedAt  = null;
    this.summary      = null;
    this.cancelled    = false;
    this.turnCount    = 0;
    this.MAX_TURNS    = 12;
  }

  // ── Broadcasting ────────────────────────────────────────────────────────────
  broadcast(event, extra = {}) {
    if (this.io) {
      this.io.emit('agent:event', {
        event,
        jobId:        this.jobId,
        taskId:       this.taskId,
        agentPersona: this.agentPersona,
        timestamp:    new Date().toISOString(),
        ...extra,
      });
    }
  }

  log(type, content, extra = {}) {
    const entry = {
      type,
      content,
      timestamp: new Date().toISOString(),
      jobId: this.jobId,
      ...extra,
    };
    this.activity.push(entry);
    this.broadcast(type, { content, ...extra });
    console.log(`[Agent:${this.agentPersona}:${this.jobId.slice(-6)}] [${type}] ${content.slice(0, 120)}`);
    return entry;
  }

  // ── Main entry point ────────────────────────────────────────────────────────
  async run() {
    this.status = 'running';
    this.broadcast('agent:start', {
      agentPersona: this.agentPersona,
      taskLabel:    this.taskData.label,
      personaName:  AGENT_PERSONAS[this.agentPersona]?.name || 'AI',
    });

    try {
      await this._executeReActLoop();
      if (this.status === 'running') {
        this.status = 'completed';
        this.completedAt = new Date().toISOString();
      }
    } catch (err) {
      this.status = 'error';
      this.log('error', err.message);
      this.broadcast('agent:error', { error: err.message });
      console.error(`[Agent] Job ${this.jobId} failed:`, err);
    }
  }

  // ── ReAct Loop ──────────────────────────────────────────────────────────────
  async _executeReActLoop() {
    const systemPrompt = this._buildSystemPrompt();
    const conversation = [
      {
        role:  'user',
        parts: [{ text: this._buildInitialPrompt() }],
      },
    ];

    while (this.turnCount < this.MAX_TURNS && !this.cancelled) {
      this.turnCount++;
      this.log('thought', `Turn ${this.turnCount}/${this.MAX_TURNS} — thinking...`);

      const response = await this._callGeminiWithTools(systemPrompt, conversation);

      // Add model's response to conversation history
      conversation.push({ role: 'model', parts: response.parts });

      // Extract function calls and text
      const functionCallPart = response.parts.find(p => p.functionCall);
      const textPart         = response.parts.find(p => p.text);

      if (textPart?.text) {
        this.log('thought', textPart.text);
      }

      // No function call = model is done (finishReason: STOP)
      if (!functionCallPart) break;

      const { name, args } = functionCallPart.functionCall;

      this.log('tool_call', `→ ${name}(${JSON.stringify(args).slice(0, 200)})`, {
        tool: name,
        args,
      });

      // Execute tool
      let result;
      try {
        result = await this._executeTool(name, args);
      } catch (toolErr) {
        result = { error: toolErr.message };
        this.log('observation', `Tool error: ${toolErr.message}`);
      }

      const resultSummary = JSON.stringify(result).slice(0, 300);
      this.log('observation', `← ${name} result: ${resultSummary}`, { tool: name, result });

      // If report_completion was called, we're done
      if (name === 'report_completion') {
        this.status       = 'completed';
        this.completedAt  = new Date().toISOString();
        this.summary      = args.summary;

        this.broadcast('agent:complete', {
          summary:          args.summary,
          actionsPerformed: args.actionsPerformed || [],
          recommendations:  args.recommendations  || '',
          turnCount:        this.turnCount,
          docsCreated:      this.createdDocs.length,
        });
        break;
      }

      // Feed result back into conversation
      conversation.push({
        role:  'user',
        parts: [{
          functionResponse: {
            name,
            response: { result: JSON.stringify(result) },
          },
        }],
      });
    }

    if (this.turnCount >= this.MAX_TURNS && this.status === 'running') {
      this.status      = 'completed';
      this.summary     = `Agent reached max iterations (${this.MAX_TURNS}). Partial work completed.`;
      this.completedAt = new Date().toISOString();
      this.broadcast('agent:complete', {
        summary: this.summary,
        actionsPerformed: this.activity.filter(a => a.type === 'tool_call').map(a => a.content),
        turnCount: this.turnCount,
      });
    }
  }

  // ── Gemini API call with function calling ────────────────────────────────────
  async _callGeminiWithTools(systemPrompt, contents) {
    const body = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      tools: [{ functionDeclarations: AGENT_TOOL_DECLARATIONS }],
      toolConfig: {
        functionCallingConfig: { mode: 'AUTO' },
      },
      generationConfig: {
        temperature:     0.4,
        maxOutputTokens: 8192,
        topP:            0.95,
      },
    };

    // Try primary model, fall back to flash
    const modelsToTry = ['gemini-3.1-pro-preview', 'gemini-flash-latest'];

    for (const model of modelsToTry) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;

      const response = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        const msg = data?.error?.message || `HTTP ${response.status}`;
        const isUnavailable = msg.includes('not found') || msg.includes('not supported');
        if (isUnavailable && model !== 'gemini-flash-latest') {
          this.log('thought', `Model ${model} unavailable, switching to gemini-flash-latest`);
          continue;
        }
        throw new Error(msg);
      }

      const candidate = data?.candidates?.[0];
      if (!candidate?.content) throw new Error('Empty response from Gemini');

      return candidate.content;
    }

    throw new Error('All Gemini models failed');
  }

  // ── Tool Executor ────────────────────────────────────────────────────────────
  async _executeTool(name, args) {
    switch (name) {
      case 'search_context':    return this._toolSearchContext(args);
      case 'create_document':   return this._toolCreateDocument(args);
      case 'add_subtask':       return this._toolAddSubtask(args);
      case 'update_task':       return this._toolUpdateTask(args);
      case 'create_child_task': return this._toolCreateChildTask(args);
      case 'report_completion': return { ok: true };
      default:                  return { error: `Unknown tool: ${name}` };
    }
  }

  _toolSearchContext({ query }) {
    const q = (query || '').toLowerCase();
    const relevant = this.allNodes
      .filter(n => n.id !== 'root')
      .filter(n =>
        n.label?.toLowerCase().includes(q) ||
        n.description?.toLowerCase().includes(q) ||
        n.department?.toLowerCase().includes(q) ||
        n.assignees?.some(a => a.toLowerCase().includes(q))
      )
      .slice(0, 15)
      .map(n => ({
        label:       n.label,
        status:      n.status,
        priority:    n.priority,
        department:  n.department,
        description: n.description?.slice(0, 200),
        assignees:   n.assignees,
        dueDate:     n.dueDate,
        subtasks:    (n.subtasks || []).length,
      }));

    return { query, count: relevant.length, nodes: relevant };
  }

  _toolCreateDocument({ title, content, template }) {
    const docId = 'agdoc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    const doc = {
      id:             docId,
      title:          title || 'Untitled',
      content,
      template:       template || 'brief',
      taskId:         this.taskId,
      taskLabel:      this.taskData.label,
      createdAt:      new Date().toISOString(),
      createdBy:      this.agentPersona,
      agentGenerated: true,
      jobId:          this.jobId,
    };
    this.createdDocs.push(doc);

    // Broadcast to all clients — they store it in localStorage
    this.io?.emit('agent:doc_created', {
      jobId:  this.jobId,
      taskId: this.taskId,
      doc,
    });

    this.broadcast('tool_result', {
      tool:    'create_document',
      message: `📄 Created document: "${title}"`,
      docId,
      title,
    });

    return { ok: true, docId, title };
  }

  _toolAddSubtask({ text, priority }) {
    const subtask = {
      id:       'st_' + Date.now().toString(36),
      text:     text || '',
      done:     false,
      priority: priority || 'medium',
      addedBy:  `agent:${this.agentPersona}`,
    };

    this.taskData.subtasks = [...(this.taskData.subtasks || []), subtask];
    this.taskData.updatedAt = new Date().toISOString();

    this.io?.emit('node_updated', { ...this.taskData });

    this.broadcast('tool_result', {
      tool:    'add_subtask',
      message: `✅ Added subtask: "${text}"`,
    });

    return { ok: true, subtaskId: subtask.id, text };
  }

  _toolUpdateTask(fields) {
    const allowed = ['status', 'priority', 'description', 'dueDate'];
    const updates = {};
    for (const k of allowed) {
      if (fields[k] !== undefined) updates[k] = fields[k];
    }

    Object.assign(this.taskData, updates, { updatedAt: new Date().toISOString() });
    this.io?.emit('node_updated', { ...this.taskData });

    this.broadcast('tool_result', {
      tool:    'update_task',
      message: `🔄 Updated task: ${JSON.stringify(updates)}`,
      updates,
    });

    return { ok: true, updated: updates };
  }

  _toolCreateChildTask({ label, department, priority, assignees, description, dueDate }) {
    const newNode = {
      id:          'node_' + Date.now().toString(36) + '_ag',
      label:       label || 'New Task',
      description: description || `Created by ${this.agentPersona} agent`,
      department:  department || this.taskData.department,
      status:      'not_started',
      priority:    priority    || 'medium',
      assignees:   assignees   || [],
      dueDate:     dueDate     || null,
      subtasks:    [],
      parentId:    this.taskId,
      icon:        '🤖',
      collapsed:   false,
      createdAt:   new Date().toISOString(),
      updatedAt:   new Date().toISOString(),
      agentCreated: true,
    };

    this.io?.emit('node_added', newNode);

    this.broadcast('tool_result', {
      tool:    'create_child_task',
      message: `🗺️ Created task: "${label}"`,
      nodeId:  newNode.id,
      label,
    });

    return { ok: true, nodeId: newNode.id, label };
  }

  // ── Prompt builders ──────────────────────────────────────────────────────────
  _buildSystemPrompt() {
    const persona = AGENT_PERSONAS[this.agentPersona] || AGENT_PERSONAS.gemini;
    const allTasks = this.allNodes.filter(n => n.id !== 'root');
    const deptTasks = allTasks.filter(n => n.department === this.taskData.department);

    const taskJSON = JSON.stringify({
      label:       this.taskData.label,
      description: this.taskData.description,
      status:      this.taskData.status,
      priority:    this.taskData.priority,
      assignees:   this.taskData.assignees,
      dueDate:     this.taskData.dueDate,
      subtasks:    this.taskData.subtasks,
      department:  this.taskData.department,
    }, null, 2);

    const siblingContext = this.allNodes
      .filter(n => n.parentId === this.taskData.parentId && n.id !== this.taskId)
      .map(n => `  • ${n.label} [${n.status}] [${n.priority}]`)
      .join('\n') || '  None';

    const deptSummary = deptTasks.length > 0
      ? `${deptTasks.filter(n => n.status === 'done').length}/${deptTasks.length} done`
      : 'No tasks';

    return `${persona.personality}

════════════════════════════════════════════
COMPANY CONTEXT
════════════════════════════════════════════
Company: Bits & Studios (Pedagoging Studios LLP)
Founders: Pratik and Anjalee
Location: Ahmedabad, Gujarat, India  
Launch Date: June 1, 2026 (CRITICAL deadline)
Mission: Premier Robotics + AI + Coding Makerspace for children ages 6-18

Total Tasks: ${allTasks.length} | Done: ${allTasks.filter(n => n.status === 'done').length}
Department Progress: ${deptSummary}

════════════════════════════════════════════
YOUR ASSIGNED TASK
════════════════════════════════════════════
${taskJSON}

RELATED TASKS (siblings):
${siblingContext}

════════════════════════════════════════════
AGENT INSTRUCTIONS
════════════════════════════════════════════
You are an autonomous AI agent. Work systematically:
1. ANALYZE: Understand the task deeply in context of the June 1 launch
2. RESEARCH: Use search_context to find related tasks and avoid duplication
3. CREATE: Build documents with real, specific, actionable content (not generic templates)
4. STRUCTURE: Add subtasks that break the work into concrete next steps
5. UPDATE: Set appropriate status and priority based on urgency
6. REPORT: Always finish with report_completion summarizing exactly what you did

CRITICAL RULES:
- All content must be specific to Bits & Studios, Ahmedabad, India — never generic
- Documents must be comprehensive (500+ words) with real actionable detail
- Subtasks must be specific, not vague ("Get 3 quotes from Robocraze" not "Research vendors")
- Never make up information — base everything on the task context provided
- Always call report_completion as your final action`;
  }

  _buildInitialPrompt() {
    return `I need you to autonomously work on this task: "${this.taskData.label}"

Current status: ${this.taskData.status || 'not_started'}
Current subtasks: ${this.taskData.subtasks?.length || 0}
Description: ${this.taskData.description || 'No description provided'}

Please:
1. Use search_context to understand related work
2. Create at least one comprehensive document for this task
3. Add 3-5 specific, actionable subtasks (if fewer than 3 exist)
4. Update the task status if appropriate (set to in_progress if you're doing real work)
5. Finish with report_completion

Go deep. Be specific. Reference Bits & Studios context throughout.`;
  }
}

// ── AgentJobQueue ────────────────────────────────────────────────────────────
class AgentJobQueue {
  constructor() {
    this.jobs = new Map();
    this.MAX_JOBS = 100;
  }

  create(jobData) {
    const ts    = Date.now().toString(36);
    const rand  = Math.random().toString(36).slice(2, 6);
    const jobId = `job_${ts}_${rand}`;
    const job   = new AgentJob({ ...jobData, jobId });
    this.jobs.set(jobId, job);
    this._cleanup();
    return job;
  }

  get(jobId)  { return this.jobs.get(jobId) || null; }
  getAll()    { return Array.from(this.jobs.values()); }

  getByTask(taskId) {
    return this.getAll().filter(j => j.taskId === taskId);
  }

  cancel(jobId) {
    const job = this.jobs.get(jobId);
    if (job && job.status === 'running') {
      job.cancelled = true;
      job.status = 'cancelled';
      job.broadcast('agent:cancelled', {});
    }
  }

  getActiveJobs() {
    return this.getAll().filter(j => j.status === 'running' || j.status === 'pending');
  }

  getSummaries() {
    return this.getAll()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 50)
      .map(j => ({
        jobId:        j.jobId,
        taskId:       j.taskId,
        taskLabel:    j.taskData?.label,
        agentPersona: j.agentPersona,
        personaName:  AGENT_PERSONAS[j.agentPersona]?.name || j.agentPersona,
        status:       j.status,
        createdAt:    j.createdAt,
        completedAt:  j.completedAt,
        summary:      j.summary,
        activityCount: j.activity.length,
        docsCreated:  j.createdDocs.length,
        turnCount:    j.turnCount,
      }));
  }

  _cleanup() {
    if (this.jobs.size > this.MAX_JOBS) {
      const sorted = Array.from(this.jobs.entries())
        .sort(([, a], [, b]) => new Date(a.createdAt) - new Date(b.createdAt));
      const toDelete = sorted.slice(0, this.jobs.size - this.MAX_JOBS);
      for (const [id] of toDelete) this.jobs.delete(id);
    }
  }
}

// ── SupervisorAgent ───────────────────────────────────────────────────────────
class SupervisorAgent {
  constructor({ department, agentPersona, allNodes, apiKey, io }) {
    this.department   = department;
    this.agentPersona = agentPersona;
    this.allNodes     = allNodes;
    this.apiKey       = apiKey;
    this.io           = io;
  }

  async runBrief() {
    const persona   = AGENT_PERSONAS[this.agentPersona] || AGENT_PERSONAS.gemini;
    const deptTasks = this.allNodes.filter(n =>
      n.department === this.department && n.id !== 'root'
    );

    const taskSummary = deptTasks.map(t =>
      `• [${t.status?.toUpperCase()}] [${t.priority}] ${t.label}` +
      (t.assignees?.length ? ` → assigned: ${t.assignees.join(', ')}` : '') +
      (t.dueDate ? ` | due: ${t.dueDate}` : '') +
      (t.subtasks?.length
        ? ` | subtasks: ${t.subtasks.filter(s => s.done).length}/${t.subtasks.length} done`
        : '')
    ).join('\n');

    const prompt = `${persona.personality}

You are the department supervisor. Review ALL tasks in your department and provide:

1. DEPARTMENT STATUS BRIEF (2-3 sentences)
2. 🚨 CRITICAL BLOCKERS (what will prevent June 1 launch if not addressed immediately)
3. ✅ WINS THIS WEEK (what's going well)
4. 📋 TOP 3 PRIORITIES (specific tasks that need attention right now)
5. 👥 TEAM RECOMMENDATIONS (who should work on what)
6. 🎯 SUPERVISOR VERDICT (one sentence: are we on track for June 1?)

DEPARTMENT: ${this.department}
TOTAL TASKS: ${deptTasks.length}
DONE: ${deptTasks.filter(t => t.status === 'done').length}
IN PROGRESS: ${deptTasks.filter(t => t.status === 'in_progress').length}
NOT STARTED: ${deptTasks.filter(t => t.status === 'not_started').length}

ALL TASKS:
${taskSummary || 'No tasks in this department.'}

Be direct. Be specific. Use actual task names. This is a real operations briefing.`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${this.apiKey}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          systemInstruction: { parts: [{ text: persona.personality }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.5, maxOutputTokens: 4096 },
        }),
      }
    );

    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || 'Supervisor brief failed');

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Empty supervisor response');

    return {
      department:   this.department,
      agentPersona: this.agentPersona,
      personaName:  persona.name,
      brief:        text,
      taskCount:    deptTasks.length,
      done:         deptTasks.filter(t => t.status === 'done').length,
      inProgress:   deptTasks.filter(t => t.status === 'in_progress').length,
      notStarted:   deptTasks.filter(t => t.status === 'not_started').length,
      generatedAt:  new Date().toISOString(),
    };
  }
}

module.exports = { AgentJob, AgentJobQueue, SupervisorAgent, AGENT_PERSONAS };
