// Accounts, sessions and chat logic.

import { getDb, saveDb, withLock } from "./store.js";
import { pbkdf2, toHex, randomHex, utf8 } from "./sha256.js";

const PBKDF2_ITERATIONS = 30000; // kept moderate: QuickJS on Edge is slower than V8
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,20}$/;

export function hashPassword(password, salt) {
  return toHex(pbkdf2(password, salt, PBKDF2_ITERATIONS, 32));
}

export function signup(username, password) {
  username = String(username || "").trim();
  password = String(password || "");
  if (!USERNAME_RE.test(username)) {
    return { error: 400, message: "Username must be 3-20 letters, numbers, _ or -" };
  }
  if (password.length < 6 || password.length > 100) {
    return { error: 400, message: "Password must be 6-100 characters" };
  }
  // Hash BEFORE taking the lock — PBKDF2 is slow and holding the lock during
  // it makes other instances think the lock is stale and break it.
  const salt = randomHex(16);
  const hash = hashPassword(password, salt);
  return withLock(() => {
    const db = getDb();
    const key = username.toLowerCase();
    if (db.users[key]) return { error: 409, message: "That username is taken" };
    db.users[key] = {
      username,
      salt,
      hash,
      created: Date.now(),
    };
    const token = createSession(db, key);
    saveDb(db);
    return { token, username };
  });
}

export function login(username, password) {
  const key = String(username || "").trim().toLowerCase();
  // Hash outside the lock (see signup note).
  const user0 = getDb().users[key];
  if (!user0) return { error: 401, message: "Wrong username or password" };
  const hash = hashPassword(String(password || ""), user0.salt);
  return withLock(() => {
    const db = getDb();
    const user = db.users[key];
    if (!user) return { error: 401, message: "Wrong username or password" };
    // constant-time-ish compare
    if (hash.length !== user.hash.length) return { error: 401, message: "Wrong username or password" };
    let diff = 0;
    for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ user.hash.charCodeAt(i);
    if (diff !== 0) return { error: 401, message: "Wrong username or password" };
    const token = createSession(db, key);
    saveDb(db);
    return { token, username: user.username };
  });
}

function createSession(db, key) {
  // prune expired sessions
  const now = Date.now();
  for (const t of Object.keys(db.sessions)) {
    if (db.sessions[t].expires < now) delete db.sessions[t];
  }
  const token = randomHex(24);
  db.sessions[token] = { user: key, expires: now + SESSION_TTL_MS };
  return token;
}

export function logout(token) {
  return withLock(() => {
    const db = getDb();
    if (db.sessions[token]) {
      delete db.sessions[token];
      saveDb(db);
    }
    return { ok: true };
  });
}

export function userForToken(token) {
  if (!token || typeof token !== "string" || token.length > 128) return null;
  const db = getDb();
  const sess = db.sessions[token];
  if (!sess || sess.expires < Date.now()) return null;
  const user = db.users[sess.user];
  if (!user) return null;
  return { token, key: sess.user, username: user.username };
}

export function touchPresence(token, userKey) {
  return withLock(() => {
    const db = getDb();
    db.presence[userKey] = Date.now();
    // prune stale presence entries while we're here
    const cutoff = Date.now() - 5 * 60 * 1000;
    for (const u of Object.keys(db.presence)) {
      if (db.presence[u] < cutoff) delete db.presence[u];
    }
    saveDb(db);
  });
}

export function onlineUsers() {
  const db = getDb();
  const cutoff = Date.now() - 60 * 1000;
  const out = [];
  for (const [key, ts] of Object.entries(db.presence)) {
    if (ts >= cutoff) {
      const u = db.users[key];
      if (u) out.push(u.username);
    }
  }
  return out;
}

const MAX_MESSAGES = 500;

export function postMessage(user, text) {
  text = String(text || "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
  if (!text) return { error: 400, message: "Message can't be empty" };
  if (text.length > 500) text = text.slice(0, 500);
  return withLock(() => {
    const db = getDb();
    const msg = { id: db.nextId++, user: user.username, text, ts: Date.now() };
    db.messages.push(msg);
    if (db.messages.length > MAX_MESSAGES) {
      db.messages = db.messages.slice(-MAX_MESSAGES);
    }
    db.presence[user.key] = Date.now();
    saveDb(db);
    return { message: msg };
  });
}

export function messagesAfter(afterId) {
  const db = getDb();
  const after = Number(afterId) || 0;
  const recent = db.messages.slice(-200);
  const out = recent.filter((m) => m.id > after);
  return { messages: out, online: onlineUsers() };
}
