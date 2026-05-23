// ─── Bits & Studios — User Auth & Profile System (Server-side) ───────────────
'use strict';

let bcrypt, jwt;
try { bcrypt = require('bcryptjs'); } catch { console.warn('[Auth] bcryptjs not installed'); }
try { jwt    = require('jsonwebtoken'); } catch { console.warn('[Auth] jsonwebtoken not installed'); }

const JWT_SECRET  = process.env.JWT_SECRET  || 'bits-studios-internal-2026';
const TOKEN_TTL   = '30d';

// ── Admin password from env (set ADMIN_PIN on Render) ─────────────────────────
// NEVER hardcode this in production — set it as a secret env variable on Render
const ADMIN_PIN   = process.env.ADMIN_PIN   || 'IamgoingtoMake';

// ── Default users (bootstrapped on first run) ──────────────────────────────────
const DEFAULT_USERS = [
  {
    id:         'user_pratik',
    name:       'Pratik',
    role:       'admin',
    pin:        ADMIN_PIN,       // hashed on first save
    pinHashed:  false,
    color:      '#FF6B35',
    avatar:     'P',
    department: null,
    createdAt:  '2026-05-22',
  },
  {
    id:         'user_anjalee',
    name:       'Anjalee',
    role:       'admin',
    pin:        ADMIN_PIN,
    pinHashed:  false,
    color:      '#4ECDC4',
    avatar:     'A',
    department: null,
    createdAt:  '2026-05-22',
  },
];

class UserStore {
  constructor(sharedState, saveToDisk) {
    this._state    = sharedState;
    this._save     = saveToDisk;
    this._sessions = new Map();
    this._ensureUsers();
    this._syncAdminPins(); // always re-sync admin PINs from env on startup
  }

  // On every startup, update admin users' PINs from env so changing ADMIN_PIN
  // on Render immediately takes effect without touching the DB.
  _syncAdminPins() {
    let changed = false;
    for (const u of (this._state.users || [])) {
      if (u.role === 'admin') {
        const newHash = this._hashPin(ADMIN_PIN);
        if (u.pin !== newHash) {
          u.pin       = newHash;
          u.pinHashed = true;
          changed = true;
        }
      }
    }
    if (changed) this._save();
  }

  _ensureUsers() {
    if (!this._state.users || this._state.users.length === 0) {
      this._state.users = DEFAULT_USERS.map(u => ({
        ...u,
        pin:       this._hashPin(u.pin),
        pinHashed: true,
      }));
      this._save();
      console.log('[Auth] Bootstrapped default users:', this._state.users.map(u => u.name).join(', '));
    } else {
      // Hash any un-hashed PINs from older data
      let changed = false;
      for (const u of this._state.users) {
        if (u.pin && !u.pinHashed) {
          u.pin = this._hashPin(u.pin);
          u.pinHashed = true;
          changed = true;
        }
      }
      if (changed) this._save();
    }
  }

  _hashPin(pin) {
    if (!pin) return '';
    if (!bcrypt) return String(pin);
    return bcrypt.hashSync(String(pin), 10);
  }

  _verifyPin(plain, hashed) {
    if (!plain || !hashed) return false;
    if (!bcrypt) return String(plain) === String(hashed);
    // Also try plain-text match (migration path)
    try { return bcrypt.compareSync(String(plain), hashed); } catch { return false; }
  }

  _generateToken(userId) {
    if (jwt) {
      return jwt.sign({ userId }, JWT_SECRET, { expiresIn: TOKEN_TTL });
    }
    const token = userId + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    this._sessions.set(token, { userId, expiresAt });
    return token;
  }

  verifyToken(token) {
    if (!token) return null;
    if (jwt) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = this.getUser(decoded.userId);
        return user ? { userId: decoded.userId, role: user.role, name: user.name } : null;
      } catch { return null; }
    }
    const session = this._sessions.get(token);
    if (!session || session.expiresAt < Date.now()) return null;
    const user = this.getUser(session.userId);
    return user ? { userId: session.userId, role: user.role, name: user.name } : null;
  }

  getUsers() {
    return (this._state.users || []).map(u => ({
      id:         u.id,
      name:       u.name,
      role:       u.role,
      color:      u.color,
      avatar:     u.avatar,
      department: u.department,
      createdAt:  u.createdAt,
    }));
  }

  getUser(id) {
    return (this._state.users || []).find(u => u.id === id) || null;
  }

  login(userId) {
    const user = this.getUser(userId);
    if (!user) return null;
    const token = this._generateToken(userId);
    console.log(`[Auth] Login: ${user.name} (${user.role})`);
    return {
      token,
      user: { id: user.id, name: user.name, role: user.role,
              color: user.color, avatar: user.avatar, department: user.department },
    };
  }

  // Verify PIN against the env-driven ADMIN_PIN (for admin users)
  verifyPin(userId, pin) {
    const user = this.getUser(userId);
    if (!user) return false;
    if (user.role === 'admin') {
      // Always verify against current ADMIN_PIN from env — most up-to-date
      return String(pin) === String(ADMIN_PIN) || this._verifyPin(pin, user.pin);
    }
    return this._verifyPin(pin, user.pin);
  }

  addUser({ name, role, pin, color, department }) {
    const id = 'user_' + name.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now().toString(36);
    const colors = ['#FF6B35','#4ECDC4','#45B7D1','#96CEB4','#DDA0DD','#98D8C8','#BB8FCE','#85C1E9'];
    const actualPin = role === 'admin' ? ADMIN_PIN : (pin || '0000');
    const newUser = {
      id,
      name:       name.trim(),
      role:       role || 'employee',
      pin:        this._hashPin(actualPin),
      pinHashed:  true,
      color:      color || colors[Math.floor(Math.random() * colors.length)],
      avatar:     name.trim().charAt(0).toUpperCase(),
      department: department || null,
      createdAt:  new Date().toISOString().slice(0, 10),
    };
    this._state.users = [...(this._state.users || []), newUser];
    this._save();
    return { id: newUser.id, name: newUser.name, role: newUser.role };
  }

  updatePin(userId, newPin) {
    const user = this.getUser(userId);
    if (!user) return false;
    user.pin       = this._hashPin(newPin);
    user.pinHashed = true;
    this._save();
    return true;
  }

  deleteUser(userId) {
    if (!this._state.users) return false;
    const idx = this._state.users.findIndex(u => u.id === userId);
    if (idx === -1) return false;
    this._state.users.splice(idx, 1);
    this._save();
    return true;
  }
}

module.exports = { UserStore };
