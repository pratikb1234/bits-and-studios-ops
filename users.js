// ─── Bits & Studios — User Auth & Profile System (Server-side) ───────────────
// Simple PIN-based auth for internal team use. No external OAuth needed.

'use strict';

let bcrypt, jwt;
try { bcrypt = require('bcryptjs'); } catch { console.warn('[Auth] bcryptjs not installed — PIN hashing disabled'); }
try { jwt    = require('jsonwebtoken'); } catch { console.warn('[Auth] jsonwebtoken not installed — using simple tokens'); }

const JWT_SECRET  = process.env.JWT_SECRET || 'bits-studios-internal-2026';
const TOKEN_TTL   = '30d'; // tokens last 30 days

// ── Default users (bootstrapped on first run) ─────────────────────────────────
const DEFAULT_USERS = [
  {
    id:        'user_pratik',
    name:      'Pratik',
    role:      'admin',
    pin:       '1234',          // will be hashed on first save
    color:     '#FF6B35',
    avatar:    'P',
    department: null,           // admins see all
    createdAt: '2026-05-22',
  },
  {
    id:        'user_anjalee',
    name:      'Anjalee',
    role:      'admin',
    pin:       '1234',
    color:     '#4ECDC4',
    avatar:    'A',
    department: null,
    createdAt: '2026-05-22',
  },
];

// ── UserStore — manages users in the collab-data.json sharedState ─────────────
class UserStore {
  constructor(sharedState, saveToDisk) {
    this._state    = sharedState;
    this._save     = saveToDisk;
    this._sessions = new Map(); // token → { userId, expiresAt }

    this._ensureUsers();
  }

  _ensureUsers() {
    if (!this._state.users || this._state.users.length === 0) {
      // Bootstrap with defaults — hash PINs
      this._state.users = DEFAULT_USERS.map(u => ({
        ...u,
        pin: this._hashPin(u.pin),
        pinHashed: true,
      }));
      this._save();
      console.log('[Auth] Bootstrapped default users:', this._state.users.map(u => u.name).join(', '));
    } else {
      // Hash any un-hashed PINs (migration)
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
    if (!bcrypt) return pin; // fallback: store plain (shouldn't happen)
    return bcrypt.hashSync(String(pin), 10);
  }

  _verifyPin(plain, hashed) {
    if (!plain || !hashed) return false;
    if (!bcrypt) return plain === hashed;
    return bcrypt.compareSync(String(plain), hashed);
  }

  _generateToken(userId) {
    if (jwt) {
      return jwt.sign({ userId }, JWT_SECRET, { expiresIn: TOKEN_TTL });
    }
    // Fallback: random UUID-style token
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
    // Fallback
    const session = this._sessions.get(token);
    if (!session || session.expiresAt < Date.now()) return null;
    const user = this.getUser(session.userId);
    return user ? { userId: session.userId, role: user.role, name: user.name } : null;
  }

  // ── CRUD ────────────────────────────────────────────────────────────────────
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

  getUserByName(name) {
    return (this._state.users || []).find(u =>
      u.name.toLowerCase() === (name || '').toLowerCase()
    ) || null;
  }

  // Login — returns token or null
  login(userId) {
    const user = this.getUser(userId);
    if (!user) return null;
    const token = this._generateToken(userId);
    console.log(`[Auth] Login: ${user.name} (${user.role})`);
    return {
      token,
      user: {
        id:         user.id,
        name:       user.name,
        role:       user.role,
        color:      user.color,
        avatar:     user.avatar,
        department: user.department,
      },
    };
  }

  // Verify PIN — returns true/false
  verifyPin(userId, pin) {
    const user = this.getUser(userId);
    if (!user) return false;
    return this._verifyPin(pin, user.pin);
  }

  // Add new user (admin only)
  addUser({ name, role, pin, color, department }) {
    const id = 'user_' + name.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now().toString(36);
    const colors = ['#FF6B35','#4ECDC4','#45B7D1','#96CEB4','#DDA0DD','#98D8C8','#BB8FCE','#85C1E9'];
    const newUser = {
      id,
      name:       name.trim(),
      role:       role || 'employee',
      pin:        this._hashPin(pin || '0000'),
      pinHashed:  true,
      color:      color || colors[Math.floor(Math.random() * colors.length)],
      avatar:     name.trim().charAt(0).toUpperCase(),
      department: department || null,
      createdAt:  new Date().toISOString().slice(0, 10),
    };
    this._state.users = [...(this._state.users || []), newUser];
    this._save();
    console.log(`[Auth] Created user: ${name} (${role || 'employee'})`);
    return { id: newUser.id, name: newUser.name, role: newUser.role };
  }

  // Update user PIN (admin only)
  updatePin(userId, newPin) {
    const user = this.getUser(userId);
    if (!user) return false;
    user.pin       = this._hashPin(newPin);
    user.pinHashed = true;
    this._save();
    return true;
  }

  // Delete user (admin only)
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
