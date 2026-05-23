// ═══════════════════════════════════════════════════════════════════════════════
// AEGIS — Autonomous Executive Guardian for Information Security
// Bits & Studios Operations Hub — Background Security Clearance Officer
//
// PERSONA:
//   AEGIS is a silent, ever-watchful AI security officer embedded in the
//   Bits & Studios Operations Hub. She operates autonomously in the background,
//   continuously auditing access permissions, data exposure, and policy
//   compliance. She never sleeps, never misses a violation, and always acts
//   in the organization's best interest.
//
//   Personality: Cold, precise, professional. No small talk. Every report she
//   generates is a factual, severity-graded finding. When she detects a
//   critical violation, she escalates immediately. When everything checks out,
//   she provides quiet assurance with a single green pulse.
//
//   Clearance Philosophy: "Information flows downward only by explicit grant.
//   What is not permitted is forbidden. Trust is verified, never assumed."
//
// INFORMATION CLASSIFICATION LEVELS:
//   L0 — PUBLIC      : Task label, department colour, root node
//   L1 — TEAM        : Assignees, status, due dates, subtasks
//   L2 — DEPARTMENT  : Full task details, files, descriptions
//   L3 — MANAGEMENT  : Cross-dept view, priority, collaborators, AI agents
//   L4 — EXECUTIVE   : Settings, API keys, version history, user management,
//                       delete actions, financial/curriculum data
//
// SCAN SCHEDULE: Every 45 seconds (configurable)
// ═══════════════════════════════════════════════════════════════════════════════

'use strict';

const AEGIS_SCAN_INTERVAL_MS = 45_000;

// ── Severity levels ──────────────────────────────────────────────────────────
const SEV = {
  CRITICAL: { label: 'CRITICAL', color: '#ef4444', icon: '🚨', score: 4 },
  HIGH:     { label: 'HIGH',     color: '#f97316', icon: '⚠️',  score: 3 },
  MEDIUM:   { label: 'MEDIUM',   color: '#eab308', icon: '🟡', score: 2 },
  LOW:      { label: 'LOW',      color: '#3b82f6', icon: 'ℹ️',  score: 1 },
  INFO:     { label: 'INFO',     color: '#64748b', icon: '📋', score: 0 },
};

// ── Check registry — every security rule AEGIS enforces ─────────────────────
const SECURITY_CHECKS = [

  // ── L4 EXECUTIVE CHECKS ───────────────────────────────────────────────────

  {
    id:       'CHK-001',
    name:     'API Key Exposure to Non-Admin',
    level:    4,
    severity: SEV.CRITICAL,
    desc:     'Gemini API key input must never be visible or focusable by an employee session.',
    check() {
      if (window.Auth?.isAdmin) return null; // admin, fine
      const keyInputs = document.querySelectorAll('#api-key-input, [type="password"][placeholder*="API"], [placeholder*="key"]');
      for (const el of keyInputs) {
        if (el.offsetParent !== null && !el.closest('.hidden')) {
          return `API key input visible to employee "${window.Auth?.currentUser?.name}". Element: ${el.id || el.className}`;
        }
      }
      return null;
    },
    remediate() {
      const keyInputs = document.querySelectorAll('#api-key-input');
      keyInputs.forEach(el => {
        const wrap = el.closest('.api-key-prompt, #api-key-prompt');
        if (wrap && !window.Auth?.isAdmin) wrap.style.display = 'none';
      });
    },
  },

  {
    id:       'CHK-002',
    name:     'Version History Access by Non-Admin',
    level:    4,
    severity: SEV.HIGH,
    desc:     'Version history is an executive-level resource. Employees must not see it.',
    check() {
      if (window.Auth?.isAdmin) return null;
      const histBtn = document.getElementById('tb-history');
      if (histBtn && histBtn.style.display !== 'none' && histBtn.offsetParent !== null) {
        return `History button visible to employee "${window.Auth?.currentUser?.name}"`;
      }
      // Check if history panel itself is open
      const panel = document.getElementById('history-panel');
      if (panel && !panel.classList.contains('hidden') && panel.offsetParent !== null) {
        return `History panel is OPEN for employee "${window.Auth?.currentUser?.name}" — immediate closure required`;
      }
      return null;
    },
    remediate() {
      if (!window.Auth?.isAdmin) {
        const histBtn = document.getElementById('tb-history');
        if (histBtn) histBtn.style.display = 'none';
        const panel = document.getElementById('history-panel');
        if (panel) panel.classList.add('hidden');
      }
    },
  },

  {
    id:       'CHK-003',
    name:     'Settings Panel Access by Non-Admin',
    level:    4,
    severity: SEV.CRITICAL,
    desc:     'Settings contain API keys, model config, and system parameters. L4 access only.',
    check() {
      if (window.Auth?.isAdmin) return null;
      const settingsBtn = document.getElementById('tb-settings');
      if (settingsBtn && settingsBtn.style.display !== 'none' && settingsBtn.offsetParent !== null) {
        return `Settings button visible to employee "${window.Auth?.currentUser?.name}"`;
      }
      const modal = document.getElementById('settings-modal');
      if (modal && !modal.classList.contains('hidden') && modal.offsetParent !== null) {
        return `Settings modal is OPEN for employee — emergency close triggered`;
      }
      return null;
    },
    remediate() {
      if (!window.Auth?.isAdmin) {
        document.querySelectorAll('[data-admin-only]').forEach(el => {
          el.style.display = 'none';
        });
        const modal = document.getElementById('settings-modal');
        if (modal) modal.classList.add('hidden');
      }
    },
  },

  {
    id:       'CHK-004',
    name:     'Delete Task Button Exposed to Non-Admin',
    level:    4,
    severity: SEV.HIGH,
    desc:     'Task deletion is irreversible. Only L4 executives may delete nodes.',
    check() {
      if (window.Auth?.isAdmin) return null;
      const delBtn = document.getElementById('sb-delete');
      if (delBtn && delBtn.style.display !== 'none' && delBtn.offsetParent !== null) {
        return `Delete button visible to employee "${window.Auth?.currentUser?.name}"`;
      }
      return null;
    },
    remediate() {
      if (!window.Auth?.isAdmin) {
        const delBtn = document.getElementById('sb-delete');
        if (delBtn) delBtn.style.display = 'none';
      }
    },
  },

  {
    id:       'CHK-005',
    name:     'Agent Control Panel Access by Non-Admin',
    level:    3,
    severity: SEV.MEDIUM,
    desc:     'AI Agent Control requires L3+ clearance. Agents can modify task data at scale.',
    check() {
      if (window.Auth?.isAdmin) return null;
      const agentPanel = document.getElementById('agent-panel');
      if (agentPanel && !agentPanel.classList.contains('hidden') && agentPanel.offsetParent !== null) {
        return `Agent Control panel open for employee "${window.Auth?.currentUser?.name}"`;
      }
      return null;
    },
    remediate() {
      if (!window.Auth?.isAdmin) {
        const agentPanel = document.getElementById('agent-panel');
        if (agentPanel) agentPanel.classList.add('hidden');
        const agentBtn = document.getElementById('toggle-agents');
        if (agentBtn) agentBtn.style.display = 'none';
      }
    },
  },

  // ── L1/L2 DATA INTEGRITY CHECKS ───────────────────────────────────────────

  {
    id:       'CHK-006',
    name:     'Tasks Missing Ownership Metadata',
    level:    2,
    severity: SEV.LOW,
    desc:     'All tasks must have createdBy field for RBAC enforcement.',
    check() {
      const data = window.DB || window.app?.data;
      if (!data) return null;
      const nodes = data.getAllNodes?.() || [];
      const orphans = nodes.filter(n => n.id !== 'root' && !n.createdBy);
      if (orphans.length > 0) {
        return `${orphans.length} task(s) missing ownership (createdBy): ${orphans.slice(0,3).map(n=>n.label).join(', ')}${orphans.length>3?'…':''}`;
      }
      return null;
    },
    remediate() {
      // Auto-assign orphaned tasks to system
      const data = window.DB || window.app?.data;
      if (!data) return;
      const nodes = data.getAllNodes?.() || [];
      nodes.filter(n => n.id !== 'root' && !n.createdBy).forEach(n => {
        data.updateNode?.(n.id, { createdBy: 'system', ownerName: 'System/Admin', collaborators: [] });
      });
    },
  },

  {
    id:       'CHK-007',
    name:     'Cross-User Chat History Bleed',
    level:    2,
    severity: SEV.HIGH,
    desc:     'Chat history must be namespaced per user. Cross-user bleed violates privacy.',
    check() {
      const userId = window.Auth?.userId;
      if (!userId) return null;
      // Check that the active chat key is user-namespaced
      const activeKey = `bits_chat_${userId}`;
      const raw = localStorage.getItem('bits_chat'); // un-namespaced legacy key
      if (raw) {
        try {
          const msgs = JSON.parse(raw);
          if (msgs?.length > 0) {
            return `Legacy un-namespaced chat history found (${msgs.length} messages). Users may see each other's conversations.`;
          }
        } catch {}
      }
      return null;
    },
    remediate() {
      // Migrate legacy chat history to namespaced key
      const userId = window.Auth?.userId;
      if (!userId) return;
      const raw = localStorage.getItem('bits_chat');
      if (raw) {
        const namespacedKey = `bits_chat_${userId}`;
        if (!localStorage.getItem(namespacedKey)) {
          localStorage.setItem(namespacedKey, raw);
        }
        localStorage.removeItem('bits_chat');
      }
    },
  },

  {
    id:       'CHK-008',
    name:     'Sidebar Field Lock Verification',
    level:    2,
    severity: SEV.MEDIUM,
    desc:     'Employees must not be able to edit tasks they do not own or collaborate on.',
    check() {
      if (window.Auth?.isAdmin) return null;
      const sidebar = document.getElementById('sidebar');
      if (!sidebar || sidebar.classList.contains('hidden')) return null;
      // Check if title is editable when it shouldn't be
      const titleInput = document.getElementById('sb-title');
      if (titleInput && !titleInput.disabled) {
        // Check RBAC
        const nodeId = window.app?.sidebar?.currentNodeId;
        if (nodeId && window.RBAC && !window.RBAC.canEditNode(nodeId)) {
          return `Sidebar fields unlocked for employee "${window.Auth?.currentUser?.name}" on task they don't own (nodeId: ${nodeId})`;
        }
      }
      return null;
    },
    remediate() {
      const nodeId = window.app?.sidebar?.currentNodeId;
      if (nodeId && window.RBAC) window.RBAC.applySidebarLock(nodeId);
    },
  },

  {
    id:       'CHK-009',
    name:     'Export/Import Button Exposure',
    level:    4,
    severity: SEV.MEDIUM,
    desc:     'Data export/import allows full database extraction. L4 only.',
    check() {
      if (window.Auth?.isAdmin) return null;
      const expBtn = document.getElementById('tb-export');
      const impBtn = document.getElementById('tb-import');
      if ((expBtn && expBtn.offsetParent !== null) ||
          (impBtn && impBtn.offsetParent !== null)) {
        return `Export/Import buttons visible to employee "${window.Auth?.currentUser?.name}"`;
      }
      return null;
    },
    remediate() {
      if (!window.Auth?.isAdmin) {
        ['tb-export','tb-import'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.style.display = 'none';
        });
      }
    },
  },

  // ── POSITIVE COMPLIANCE CONFIRMATIONS ────────────────────────────────────────

  {
    id:       'CHK-010',
    name:     'Authentication Session Validity',
    level:    1,
    severity: SEV.INFO,
    desc:     'Active session token must be present and user identity confirmed.',
    check() {
      if (!window.Auth?.currentUser) {
        return `No authenticated user. Session invalid or expired.`;
      }
      return null; // All clear — just logs green
    },
    remediate() {},
  },
];

// ── AEGIS Engine ──────────────────────────────────────────────────────────────
class AEGISSecurityOfficer {
  constructor() {
    this.violations    = [];   // Current violation log
    this.scanCount     = 0;
    this.lastScanTime  = null;
    this.status        = 'INITIALISING'; // SECURE | WARNING | ALERT | CRITICAL
    this._intervalId   = null;
    this._widgetEl     = null;
    this._logEl        = null;
    this._logOpen      = false;
  }

  // ── Start AEGIS ────────────────────────────────────────────────────────────
  init() {
    this._buildWidget();
    // First scan after 3 seconds (let app fully load)
    setTimeout(() => this.scan(), 3000);
    // Then every 45 seconds
    this._intervalId = setInterval(() => this.scan(), AEGIS_SCAN_INTERVAL_MS);
    console.log('[AEGIS] 🛡️  Security officer online. Scan interval: 45s');
  }

  // ── Run all checks ─────────────────────────────────────────────────────────
  async scan() {
    this.scanCount++;
    this.lastScanTime = new Date();
    const findings = [];

    for (const check of SECURITY_CHECKS) {
      try {
        const violation = check.check();
        if (violation) {
          findings.push({
            id:        check.id,
            name:      check.name,
            severity:  check.severity,
            message:   violation,
            timestamp: new Date(),
            level:     check.level,
            auto:      false,
          });
          // Auto-remediate where possible
          try {
            check.remediate();
            findings[findings.length - 1].auto = true;
          } catch (e) {
            console.warn(`[AEGIS] Remediation failed for ${check.id}:`, e.message);
          }
        }
      } catch (e) {
        console.warn(`[AEGIS] Check ${check.id} threw:`, e.message);
      }
    }

    this.violations = findings;
    this._updateStatus();
    this._updateWidget();

    // Log to console
    if (findings.length === 0) {
      console.log(`[AEGIS] ✅ Scan #${this.scanCount} — No violations. All systems secure.`);
    } else {
      console.group(`[AEGIS] 🚨 Scan #${this.scanCount} — ${findings.length} violation(s) found`);
      findings.forEach(f => console.warn(`  [${f.severity.label}] ${f.id}: ${f.message}`));
      console.groupEnd();
    }

    // If CRITICAL violations found, show a toast
    const criticals = findings.filter(f => f.severity === SEV.CRITICAL);
    if (criticals.length > 0 && window.app?.showToast) {
      window.app.showToast(
        `🛡️ AEGIS: ${criticals.length} critical security issue${criticals.length>1?'s':''} detected & remediated`,
        'error'
      );
    }

    return findings;
  }

  // ── Determine overall status ───────────────────────────────────────────────
  _updateStatus() {
    if (this.violations.length === 0) {
      this.status = 'SECURE';
    } else {
      const maxSev = Math.max(...this.violations.map(v => v.severity.score));
      if (maxSev >= 4)      this.status = 'CRITICAL';
      else if (maxSev >= 3) this.status = 'ALERT';
      else if (maxSev >= 2) this.status = 'WARNING';
      else                  this.status = 'NOTICE';
    }
  }

  // ── Build the floating widget ─────────────────────────────────────────────
  _buildWidget() {
    if (this._widgetEl) return;

    const widget = document.createElement('div');
    widget.id = 'aegis-widget';
    widget.className = 'aegis-widget';
    widget.title = 'AEGIS Security Officer — click to view report';
    widget.innerHTML = `
      <div class="aegis-avatar">
        <div class="aegis-avatar-ring"></div>
        <div class="aegis-avatar-core">🛡️</div>
        <div class="aegis-pulse"></div>
      </div>
      <div class="aegis-info">
        <div class="aegis-name">AEGIS</div>
        <div class="aegis-status-line" id="aegis-status-line">Initialising…</div>
      </div>
      <div class="aegis-badge" id="aegis-badge" style="display:none">0</div>
    `;
    widget.addEventListener('click', () => this._toggleLog());
    document.body.appendChild(widget);
    this._widgetEl = widget;

    // Log panel (hidden by default)
    const log = document.createElement('div');
    log.id = 'aegis-log';
    log.className = 'aegis-log hidden';
    log.innerHTML = `
      <div class="aegis-log-header">
        <div class="aegis-log-title">
          <span>🛡️ AEGIS Security Report</span>
          <span class="aegis-log-sub">Clearance Officer — Scan #<span id="aegis-scan-num">0</span></span>
        </div>
        <button class="aegis-log-close" onclick="window.AEGIS._toggleLog()">✕</button>
      </div>
      <div class="aegis-log-meta" id="aegis-log-meta">No scans yet</div>
      <div class="aegis-log-body" id="aegis-log-body">
        <div class="aegis-empty">Waiting for first scan…</div>
      </div>
      <div class="aegis-log-footer">
        <button class="aegis-scan-now-btn" onclick="window.AEGIS.scan()">🔍 Scan Now</button>
        <span class="aegis-footer-note">Auto-scans every 45s</span>
      </div>
    `;
    document.body.appendChild(log);
    this._logEl = log;
  }

  // ── Update widget display ──────────────────────────────────────────────────
  _updateWidget() {
    if (!this._widgetEl) return;

    const statusLine = document.getElementById('aegis-status-line');
    const badge      = document.getElementById('aegis-badge');
    const widget     = this._widgetEl;

    const STATUS_COLORS = {
      SECURE:   '#22c55e',
      NOTICE:   '#3b82f6',
      WARNING:  '#eab308',
      ALERT:    '#f97316',
      CRITICAL: '#ef4444',
    };
    const STATUS_LABELS = {
      SECURE:   '✅ All Secure',
      NOTICE:   'ℹ️ 1 notice',
      WARNING:  '🟡 Warning',
      ALERT:    '⚠️ Alert',
      CRITICAL: '🚨 Critical',
    };

    const color = STATUS_COLORS[this.status] || '#64748b';
    widget.style.setProperty('--aegis-color', color);

    if (statusLine) {
      statusLine.textContent = STATUS_LABELS[this.status] || this.status;
      statusLine.style.color = color;
    }

    if (badge) {
      const count = this.violations.length;
      badge.textContent = count;
      badge.style.display = count > 0 ? 'flex' : 'none';
      badge.style.background = count > 0 ? color : 'transparent';
    }

    // Update ring color
    const ring = widget.querySelector('.aegis-avatar-ring');
    if (ring) ring.style.borderColor = color;

    // Update log if open
    if (this._logOpen) this._renderLog();
  }

  // ── Toggle log panel ───────────────────────────────────────────────────────
  _toggleLog() {
    if (!this._logEl) return;
    this._logOpen = !this._logOpen;
    this._logEl.classList.toggle('hidden', !this._logOpen);
    if (this._logOpen) this._renderLog();
  }

  // ── Render the violation log ───────────────────────────────────────────────
  _renderLog() {
    const scanNum = document.getElementById('aegis-scan-num');
    const meta    = document.getElementById('aegis-log-meta');
    const body    = document.getElementById('aegis-log-body');
    if (!body) return;

    if (scanNum) scanNum.textContent = this.scanCount;
    if (meta && this.lastScanTime) {
      meta.textContent = `Last scan: ${this.lastScanTime.toLocaleTimeString('en-IN')} · ${this.violations.length} finding(s) · User: ${window.Auth?.currentUser?.name || 'Unknown'} (${window.Auth?.currentUser?.role || '?'})`;
    }

    if (this.violations.length === 0) {
      body.innerHTML = `
        <div class="aegis-all-clear">
          <div class="aegis-all-clear-icon">✅</div>
          <div class="aegis-all-clear-title">All Systems Secure</div>
          <div class="aegis-all-clear-sub">No access violations detected. All ${SECURITY_CHECKS.length} checks passed.</div>
        </div>
      `;
      return;
    }

    body.innerHTML = this.violations.map(v => `
      <div class="aegis-finding" style="border-left-color:${v.severity.color}">
        <div class="aegis-finding-header">
          <span class="aegis-finding-sev" style="color:${v.severity.color}">${v.severity.icon} ${v.severity.label}</span>
          <span class="aegis-finding-id">${v.id}</span>
          ${v.auto ? '<span class="aegis-remediated">✓ Auto-remediated</span>' : '<span class="aegis-not-remediated">⚡ Manual action needed</span>'}
        </div>
        <div class="aegis-finding-name">${v.name}</div>
        <div class="aegis-finding-msg">${v.message}</div>
        <div class="aegis-finding-time">${v.timestamp.toLocaleTimeString('en-IN')} · Classification Level L${v.level}</div>
      </div>
    `).join('');
  }

  // ── Manual force-scan (called externally) ─────────────────────────────────
  forceScan() { return this.scan(); }
}

// ── Classification level helper (for other modules to check) ─────────────────
window.CLEARANCE = {
  L0: 0, // Public
  L1: 1, // Team
  L2: 2, // Department
  L3: 3, // Management
  L4: 4, // Executive (admin)

  // Get the current user's clearance level
  get current() {
    const user = window.Auth?.currentUser;
    if (!user) return -1;
    if (user.role === 'admin') return 4;
    if (user.role === 'manager' || user.role === 'supervisor') return 3;
    return 2; // default employee gets L2
  },

  // Can the current user access content at this level?
  allows(level) { return this.current >= level; },
};

// ── Bootstrap ────────────────────────────────────────────────────────────────
window.AEGIS = new AEGISSecurityOfficer();

// Start after auth is ready
window.addEventListener('auth:login', () => {
  // Small delay to let UI settle after login
  setTimeout(() => window.AEGIS.init(), 1000);
});

// Also start if already logged in (page refresh)
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    if (window.Auth?.currentUser && !window.AEGIS._intervalId) {
      window.AEGIS.init();
    }
  }, 4000);
});
