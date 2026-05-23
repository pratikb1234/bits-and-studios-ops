// ─── Bits & Studios — Auth & Profile System (Client) ─────────────────────────
// Handles: login screen, user session, per-user data namespacing, PIN prompt,
//          role-based UI gating, user management panel (admin)

'use strict';

const AUTH_STORAGE_KEY = 'bits_session_v2';

// ── Session helpers ───────────────────────────────────────────────────────────
function saveSession(session) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

function loadSession() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function clearSession() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

// ── Per-user localStorage namespace ─────────────────────────────────────────
// All personal data is stored under bits_{key}_{userId} so users don't bleed into each other
function userKey(baseKey, userId) {
  return `${baseKey}_${userId || 'guest'}`;
}

// ── AuthManager ───────────────────────────────────────────────────────────────
class AuthManager {
  constructor() {
    this.session  = null;   // { token, user: { id, name, role, color, avatar, department } }
    this.users    = [];     // all users from server
    this._pinResolve = null;
  }

  // ── Current user helpers ──────────────────────────────────────────────────
  get currentUser() { return this.session?.user || null; }
  get isAdmin()     { return this.currentUser?.role === 'admin'; }
  get userId()      { return this.currentUser?.id || 'guest'; }
  get token()       { return this.session?.token || ''; }

  // Namespaced localStorage read/write
  getItem(key)        { return localStorage.getItem(userKey(key, this.userId)); }
  setItem(key, value) { localStorage.setItem(userKey(key, this.userId), value); }
  removeItem(key)     { localStorage.removeItem(userKey(key, this.userId)); }

  // Default headers for all API calls
  authHeaders() {
    return {
      'Content-Type':    'application/json',
      'X-Session-Token': this.token,
    };
  }

  // ── Boot — called on app start ────────────────────────────────────────────
  async boot() {
    // Load users list from server
    try {
      const res  = await fetch('/api/users');
      const data = await res.json();
      this.users = data.users || [];
    } catch {
      this.users = [];
    }

    // Try to restore session
    const saved = loadSession();
    if (saved?.token && saved?.user) {
      // Verify the token is still valid by checking user exists
      const userExists = this.users.find(u => u.id === saved.user.id);
      if (userExists) {
        this.session = saved;
        this._applySession();
        return true; // already logged in
      }
    }

    // Show login screen
    return false;
  }

  // ── Login ─────────────────────────────────────────────────────────────────
  async login(userId) {
    const res  = await fetch('/api/auth/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ userId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');

    this.session = data;
    saveSession(this.session);
    this._applySession();
    return this.session;
  }

  logout() {
    clearSession();
    this.session = null;
    window.location.reload();
  }

  // ── PIN verification ──────────────────────────────────────────────────────
  // Returns a promise that resolves when PIN is confirmed
  requirePin(reason = 'Admin action') {
    return new Promise((resolve, reject) => {
      if (!this.isAdmin) { reject(new Error('Admin only')); return; }
      this._showPinModal(reason, resolve, reject);
    });
  }

  async verifyPin(pin) {
    const res = await fetch('/api/auth/verify-pin', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ userId: this.userId, pin }),
    });
    const data = await res.json();
    return res.ok && data.ok;
  }

  // ── Apply session to UI ───────────────────────────────────────────────────
  _applySession() {
    const user = this.currentUser;
    if (!user) return;

    // Update toolbar user badge
    const badge = document.getElementById('current-user-badge');
    if (badge) {
      badge.innerHTML = `
        <div class="user-badge-avatar" style="background:${user.color}">${user.avatar}</div>
        <div class="user-badge-info">
          <div class="user-badge-name">${user.name}</div>
          <div class="user-badge-role">${user.role}</div>
        </div>
      `;
      badge.onclick = () => this._showUserMenu();
    }

    // Hide admin-only elements for employees
    if (!this.isAdmin) {
      document.querySelectorAll('[data-admin-only]').forEach(el => {
        el.style.display = 'none';
      });
    } else {
      document.querySelectorAll('[data-admin-only]').forEach(el => {
        el.style.removeProperty('display');
      });
    }

    // Dispatch event so other modules can react
    window.dispatchEvent(new CustomEvent('auth:login', { detail: { user } }));
  }

  // ── Login Screen ──────────────────────────────────────────────────────────
  showLoginScreen() {
    const overlay = document.getElementById('login-overlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');
    this._renderLoginScreen();
  }

  hideLoginScreen() {
    const overlay = document.getElementById('login-overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  _renderLoginScreen() {
    const body = document.getElementById('login-body');
    if (!body) return;

    body.innerHTML = `
      <div class="login-logo">
        <div class="login-logo-icon">🎯</div>
        <div class="login-logo-text">Bits <span>&</span> Studios</div>
        <div class="login-logo-sub">Operations Hub</div>
      </div>

      <div class="login-prompt">Who are you?</div>

      <div class="login-users-grid" id="login-users-grid">
        ${this.users.map(u => `
          <button class="login-user-card" data-userid="${u.id}"
            onclick="window.Auth._selectUser('${u.id}')">
            <div class="luc-avatar" style="background:${u.color}">${u.avatar}</div>
            <div class="luc-name">${u.name}</div>
            <div class="luc-role">${u.role}</div>
          </button>
        `).join('')}

        ${this._renderAddUserCard()}
      </div>
    `;
  }

  _renderAddUserCard() {
    // Only show "add user" on local (we don't know admin yet at this point)
    return `
      <button class="login-user-card login-add-card" onclick="window.Auth._showAddUserForm()">
        <div class="luc-avatar luc-add">+</div>
        <div class="luc-name">Add Profile</div>
        <div class="luc-role">New member</div>
      </button>
    `;
  }

  async _selectUser(userId) {
    // Highlight selected
    document.querySelectorAll('.login-user-card').forEach(c => c.classList.remove('selected'));
    document.querySelector(`[data-userid="${userId}"]`)?.classList.add('selected');

    // Check if this user is an admin — require PIN before granting access
    const user = this.users.find(u => u.id === userId);
    if (user?.role === 'admin') {
      this._showLoginPinPrompt(userId, user.name);
      return;
    }

    // Employee: log in directly
    try {
      await this.login(userId);
      this.hideLoginScreen();
      window.app?.showToast(`Welcome back, ${this.currentUser.name}! 👋`, 'success');
    } catch (err) {
      document.querySelectorAll('.login-user-card').forEach(c => c.classList.remove('selected'));
      window.app?.showToast('Login error: ' + err.message, 'error');
    }
  }

  // ── PIN prompt shown directly on the login screen for admins ──────────────
  _showLoginPinPrompt(userId, userName) {
    const body = document.getElementById('login-body');
    if (!body) return;

    body.innerHTML = `
      <div class="login-logo">
        <div class="login-logo-icon">🔐</div>
        <div class="login-logo-text">Admin Access</div>
        <div class="login-logo-sub">Enter your password to continue as <strong>${userName}</strong></div>
      </div>

      <div class="login-pin-wrap">
        <div class="login-pin-field-wrap">
          <input
            id="lp-text-input"
            type="password"
            class="login-pin-text-input"
            placeholder="Enter your admin password"
            autocomplete="current-password"
            autofocus
          />
          <button class="login-pin-submit-btn" onclick="window.Auth._submitLoginPin('${userId}')">
            Unlock →
          </button>
        </div>
        <div class="pin-error hidden" id="lp-error">❌ Incorrect password — try again</div>
        <button class="login-back-btn" onclick="window.Auth._renderLoginScreen()">← Back</button>
      </div>
    `;

    this._lpUserId = userId;

    // Allow Enter key to submit
    setTimeout(() => {
      const input = document.getElementById('lp-text-input');
      if (input) {
        input.focus();
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') this._submitLoginPin(userId);
        });
      }
    }, 50);
  }

  async _submitLoginPin(userId) {
    // Read from the text password input
    const input = document.getElementById('lp-text-input');
    const pin   = input ? input.value.trim() : '';

    if (!pin) {
      input?.focus();
      return;
    }

    // Disable button while verifying
    const btn = document.querySelector('.login-pin-submit-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }

    try {
      const r = await fetch('/api/auth/verify-pin', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ userId, pin }),
      });
      const data = await r.json();

      if (r.ok && data.ok) {
        // ✅ Password correct — NOW create session
        await this.login(userId);
        this.hideLoginScreen();
        window._adminPinVerified = true;
        window.dispatchEvent(new Event('admin:pin:ok'));
        window.app?.showToast(`Welcome, ${this.currentUser.name}! 🔐`, 'success');
      } else {
        // ❌ Wrong password — clear input, shake, show error
        if (input) { input.value = ''; input.focus(); input.classList.add('shake'); setTimeout(() => input.classList.remove('shake'), 500); }
        if (btn) { btn.disabled = false; btn.textContent = 'Unlock →'; }
        const err = document.getElementById('lp-error');
        if (err) { err.classList.remove('hidden'); setTimeout(() => err.classList.add('hidden'), 2500); }
      }
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Unlock →'; }
      window.app?.showToast('Error: ' + e.message, 'error');
    }
  }

  _showAddUserForm() {
    const body = document.getElementById('login-body');
    if (!body) return;

    body.innerHTML = `
      <div class="login-logo">
        <div class="login-logo-icon">🎯</div>
        <div class="login-logo-text">Bits <span>&</span> Studios</div>
      </div>

      <div class="login-prompt">Create your profile</div>

      <div class="login-add-form">
        <input type="text" id="new-user-name" class="login-input" placeholder="Your name" autofocus maxlength="30">

        <div class="login-role-row">
          <label class="login-radio">
            <input type="radio" name="new-role" value="employee" checked> Employee
          </label>
          <label class="login-radio">
            <input type="radio" name="new-role" value="admin"> Admin
          </label>
        </div>

        <div id="new-pin-group" class="hidden">
          <input type="password" id="new-user-pin" class="login-input" placeholder="Set a 4-digit PIN for admin access" maxlength="6">
        </div>

        <button class="login-submit-btn" onclick="window.Auth._submitNewUser()">
          Create Profile & Enter
        </button>
        <button class="login-back-btn" onclick="window.Auth._renderLoginScreen()">
          ← Back
        </button>
      </div>
    `;

    document.querySelector('input[name="new-role"]')?.addEventListener?.('change', () => {});
    document.querySelectorAll('input[name="new-role"]').forEach(r => {
      r.addEventListener('change', () => {
        const pinGroup = document.getElementById('new-pin-group');
        if (pinGroup) pinGroup.classList.toggle('hidden', r.value !== 'admin' || !r.checked);
      });
    });
  }

  async _submitNewUser() {
    const name = document.getElementById('new-user-name')?.value?.trim();
    if (!name) { alert('Please enter your name'); return; }

    const roleEl = document.querySelector('input[name="new-role"]:checked');
    const role   = roleEl?.value || 'employee';
    const pin    = document.getElementById('new-user-pin')?.value || '0000';

    try {
      // Create user on server (no auth required for first-time self-registration)
      const res = await fetch('/api/users', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-Token': '' },
        body:    JSON.stringify({ name, role, pin }),
      });

      if (!res.ok) {
        // If server rejects (requires admin), create a guest session locally
        const tempId = 'user_' + name.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now().toString(36);
        this.session = {
          token: '',
          user: { id: tempId, name, role: 'employee', color: '#6366f1', avatar: name.charAt(0).toUpperCase() },
        };
        saveSession(this.session);
        this._applySession();
        this.hideLoginScreen();
        window.app?.showToast(`Welcome, ${name}! 👋`, 'success');
        return;
      }

      const data = await res.json();
      // Refresh users list
      const usersRes = await fetch('/api/users');
      const usersData = await usersRes.json();
      this.users = usersData.users || [];

      await this.login(data.user.id);
      this.hideLoginScreen();
      window.app?.showToast(`Welcome, ${name}! 👋`, 'success');
    } catch (err) {
      alert('Error: ' + err.message);
    }
  }

  // ── PIN Modal ─────────────────────────────────────────────────────────────
  _showPinModal(reason, onSuccess, onCancel) {
    let modal = document.getElementById('pin-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'pin-modal';
      modal.className = 'pin-modal-overlay';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="pin-modal">
        <div class="pin-modal-icon">🔐</div>
        <div class="pin-modal-title">Admin PIN Required</div>
        <div class="pin-modal-reason">${reason}</div>
        <div class="pin-dots" id="pin-dots">
          <div class="pin-dot"></div>
          <div class="pin-dot"></div>
          <div class="pin-dot"></div>
          <div class="pin-dot"></div>
        </div>
        <div class="pin-keypad" id="pin-keypad">
          ${[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map(k => `
            <button class="pin-key ${k === '' ? 'pin-key-empty' : ''}"
              onclick="window.Auth._pinKeyPress('${k}')">
              ${k}
            </button>
          `).join('')}
        </div>
        <div class="pin-error hidden" id="pin-error">Incorrect PIN</div>
        <button class="pin-cancel-btn" onclick="window.Auth._closePinModal()">Cancel</button>
      </div>
    `;

    this._pinValue = '';
    this._pinSuccess = onSuccess;
    this._pinCancel  = onCancel;
    modal.classList.remove('hidden');
  }

  _pinKeyPress(key) {
    if (key === '⌫') {
      this._pinValue = this._pinValue.slice(0, -1);
    } else if (key !== '' && this._pinValue.length < 6) {
      this._pinValue += String(key);
    }

    // Update dots
    const dots = document.querySelectorAll('.pin-dot');
    dots.forEach((d, i) => d.classList.toggle('filled', i < this._pinValue.length));

    // Auto-submit at 4 digits
    if (this._pinValue.length === 4) {
      setTimeout(() => this._submitPin(), 150);
    }
  }

  async _submitPin() {
    const ok = await this.verifyPin(this._pinValue);
    if (ok) {
      this._closePinModal();
      if (this._pinSuccess) this._pinSuccess(true);
    } else {
      this._pinValue = '';
      document.querySelectorAll('.pin-dot').forEach(d => d.classList.remove('filled'));
      const err = document.getElementById('pin-error');
      if (err) {
        err.classList.remove('hidden');
        setTimeout(() => err.classList.add('hidden'), 2000);
      }
    }
  }

  _closePinModal() {
    const modal = document.getElementById('pin-modal');
    if (modal) modal.classList.add('hidden');
    if (this._pinCancel) this._pinCancel(new Error('Cancelled'));
    this._pinSuccess = null;
    this._pinCancel  = null;
  }

  // ── User Menu (top-right) ─────────────────────────────────────────────────
  _showUserMenu() {
    let menu = document.getElementById('user-menu-popup');
    if (menu) { menu.remove(); return; } // toggle

    menu = document.createElement('div');
    menu.id = 'user-menu-popup';
    menu.className = 'user-menu-popup';
    const user = this.currentUser;

    menu.innerHTML = `
      <div class="ump-header">
        <div class="ump-avatar" style="background:${user.color}">${user.avatar}</div>
        <div>
          <div class="ump-name">${user.name}</div>
          <div class="ump-role">${user.role}</div>
        </div>
      </div>
      <div class="ump-divider"></div>
      ${this.isAdmin ? `
        <button class="ump-item" onclick="window.Auth._showManageUsers(); document.getElementById('user-menu-popup').remove()">
          👥 Manage Team
        </button>
        <button class="ump-item" onclick="window.app?.sidebar?.openSettings?.(); document.getElementById('user-menu-popup').remove()">
          ⚙️ Settings
        </button>
      ` : ''}
      <button class="ump-item" onclick="window.Auth._switchUser(); document.getElementById('user-menu-popup').remove()">
        🔄 Switch User
      </button>
      <div class="ump-divider"></div>
      <button class="ump-item danger" onclick="window.Auth.logout()">
        🚪 Sign Out
      </button>
    `;

    document.body.appendChild(menu);

    // Position below user badge
    const badge = document.getElementById('current-user-badge');
    if (badge) {
      const rect = badge.getBoundingClientRect();
      menu.style.top  = (rect.bottom + 6) + 'px';
      menu.style.right = (window.innerWidth - rect.right) + 'px';
    }

    setTimeout(() => {
      document.addEventListener('click', () => menu.remove(), { once: true });
    }, 50);
  }

  _switchUser() {
    clearSession();
    this.session = null;
    this.showLoginScreen();
  }

  // ── User Management Panel (admin) ─────────────────────────────────────────
  async _showManageUsers() {
    try {
      await this.requirePin('Manage team members');
    } catch { return; }

    let panel = document.getElementById('manage-users-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'manage-users-panel';
      panel.className = 'manage-users-overlay';
      document.body.appendChild(panel);
    }

    const renderPanel = () => {
      panel.innerHTML = `
        <div class="manage-users-modal">
          <div class="mum-header">
            <h3>👥 Manage Team</h3>
            <button onclick="document.getElementById('manage-users-panel').remove()">✕</button>
          </div>

          <div class="mum-users-list">
            ${this.users.map(u => `
              <div class="mum-user-row">
                <div class="mum-avatar" style="background:${u.color}">${u.avatar}</div>
                <div class="mum-info">
                  <div class="mum-name">${u.name}</div>
                  <div class="mum-role">${u.role} ${u.department ? '· ' + u.department : ''}</div>
                </div>
                <div class="mum-actions">
                  <button class="mum-pin-btn" title="Change PIN"
                    onclick="window.Auth._changePinFor('${u.id}', '${u.name}')">🔑</button>
                  ${u.id !== this.userId ? `
                    <button class="mum-del-btn" title="Remove"
                      onclick="window.Auth._deleteUser('${u.id}', '${u.name}')">✕</button>
                  ` : '<span class="mum-you">you</span>'}
                </div>
              </div>
            `).join('')}
          </div>

          <div class="mum-add-section">
            <div class="mum-add-title">Add New Member</div>
            <div class="mum-add-row">
              <input type="text" id="mum-new-name" class="mum-input" placeholder="Name" maxlength="30">
              <select id="mum-new-role" class="mum-select">
                <option value="employee">Employee</option>
                <option value="admin">Admin</option>
              </select>
              <input type="password" id="mum-new-pin" class="mum-input mum-pin" placeholder="PIN" maxlength="6">
              <button class="mum-add-btn" onclick="window.Auth._addUserFromPanel()">Add</button>
            </div>
          </div>
        </div>
      `;
    };

    this._renderManageUsers = renderPanel;
    renderPanel();
    panel.classList.remove('hidden');
  }

  async _changePinFor(userId, name) {
    const pin = prompt(`New PIN for ${name} (4-6 digits):`);
    if (!pin || pin.length < 4) { alert('PIN must be at least 4 digits'); return; }

    const res = await fetch(`/api/users/${userId}/pin`, {
      method:  'PUT',
      headers: this.authHeaders(),
      body:    JSON.stringify({ pin }),
    });
    if (res.ok) window.app?.showToast(`PIN updated for ${name}`, 'success');
    else window.app?.showToast('Failed to update PIN', 'error');
  }

  async _deleteUser(userId, name) {
    if (!confirm(`Remove ${name} from the team?`)) return;

    const res = await fetch(`/api/users/${userId}`, {
      method:  'DELETE',
      headers: this.authHeaders(),
    });
    if (res.ok) {
      this.users = this.users.filter(u => u.id !== userId);
      window.app?.showToast(`${name} removed`, 'info');
      this._renderManageUsers?.();
    } else {
      window.app?.showToast('Failed to remove user', 'error');
    }
  }

  async _addUserFromPanel() {
    const name = document.getElementById('mum-new-name')?.value?.trim();
    const role = document.getElementById('mum-new-role')?.value || 'employee';
    const pin  = document.getElementById('mum-new-pin')?.value  || '0000';

    if (!name) { alert('Name required'); return; }

    const res = await fetch('/api/users', {
      method:  'POST',
      headers: this.authHeaders(),
      body:    JSON.stringify({ name, role, pin }),
    });
    const data = await res.json();
    if (res.ok) {
      // Refresh users list
      const usersRes = await fetch('/api/users');
      const usersData = await usersRes.json();
      this.users = usersData.users || [];
      window.app?.showToast(`${name} added`, 'success');
      this._renderManageUsers?.();
    } else {
      window.app?.showToast('Failed: ' + data.error, 'error');
    }
  }
}

// ── Export ────────────────────────────────────────────────────────────────────
window.AuthManager = AuthManager;
window.Auth = new AuthManager();
