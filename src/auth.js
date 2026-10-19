// Accounts, sessions, chat, DMs, scores, achievements and moderation.

import { getDb, saveDb, withLock } from "./store.js";
import { pbkdf2, toHex, randomHex, utf8 } from "./sha256.js";

const PBKDF2_ITERATIONS = 30000; // kept moderate: QuickJS on Edge is slower than V8
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,20}$/;

// Avatars players can pick at signup (single emoji only).
export const AVATARS = ["🎮", "👾", "🚀", "🛸", "⭐", "🍕", "🍩", "🐱", "🦊", "🐸", "🦄", "🐙", "🤖", "👽", "🎃", "🎧", "🎸", "⚽", "🐉", "🧙"];

// Chat reaction emojis.
export const REACTIONS = ["👍", "😂", "🔥", "💀", "🎉", "👀", "❤️", "😮", "😅", "🫡"];

// Badge levels by lifetime message count.
const LEVELS = [
  { min: 0, title: "Newcomer" },
  { min: 10, title: "Chatter" },
  { min: 50, title: "Certified Procrastinator" },
  { min: 100, title: "Vault Legend" },
  { min: 250, title: "Math? Never Heard of Her" },
];

export function badgeFor(msgCount) {
  let title = LEVELS[0].title;
  for (const l of LEVELS) if (msgCount >= l.min) title = l.title;
  return title;
}

// Achievement catalog (id -> emoji + name + how). Game milestones are reported
// by the client; social ones are detected server-side.
export const ACHIEVEMENTS = {
  first_words: { emoji: "🗣️", name: "Breaking the Ice", how: "Send your first chat message" },
  chatterbox: { emoji: "💬", name: "Certified Procrastinator", how: "Send 50 chat messages" },
  pen_pal: { emoji: "✉️", name: "Pen Pal", how: "Send someone a DM" },
  night_owl: { emoji: "🦉", name: "Night Shift", how: "Chat between midnight and 5am" },
  flappy50: { emoji: "🐤", name: "Fifty Falls", how: "Die 50 times in Flappy One" },
  tile2048: { emoji: "🔢", name: "The Number", how: "Reach the 2048 tile" },
  brickmaster: { emoji: "🧱", name: "Bricklayer's Union", how: "Clear every brick in Brick Breaker" },
  snakelord: { emoji: "🐍", name: "Snake Lord", how: "Score 100+ in Neon Snake" },
  pongchamp: { emoji: "🏓", name: "Machine Slayer", how: "Beat the machine at Pong" },
  blockfall10: { emoji: "🧩", name: "Tetromancer", how: "Clear 10 lines in one Blockfall run" },
};

const MAX_MESSAGES = 500;
const MAX_DM_PER_THREAD = 500;
const TYPING_WINDOW_MS = 4000;

export function hashPassword(password, salt) {
  return toHex(pbkdf2(password, salt, PBKDF2_ITERATIONS, 32));
}

export function signup(username, password, avatar) {
  username = String(username || "").trim();
  password = String(password || "");
  avatar = String(avatar || "");
  if (!USERNAME_RE.test(username)) {
    return { error: 400, message: "Username must be 3-20 letters, numbers, _ or -" };
  }
  if (password.length < 6 || password.length > 100) {
    return { error: 400, message: "Password must be 6-100 characters" };
  }
  if (!AVATARS.includes(avatar)) avatar = AVATARS[0];
  // Hash BEFORE taking the lock — PBKDF2 is slow and holding the lock during
  // it makes other instances think the lock is stale and break it.
  const salt = randomHex(16);
  const hash = hashPassword(password, salt);
  return withLock(() => {
    const db = getDb();
    const key = username.toLowerCase();
    if (db.users[key]) return { error: 409, message: "That username is taken" };
    // If nobody has admin powers yet, the first account gets them.
    const hasAdmin = Object.values(db.users).some((u) => u.role === "admin");
    db.users[key] = {
      username,
      salt,
      hash,
      created: Date.now(),
      avatar,
      role: hasAdmin ? "user" : "admin",
      msgCount: 0,
    };
    const token = createSession(db, key);
    saveDb(db);
    return { token, username, avatar, role: db.users[key].role };
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
    return { token, username: user.username, avatar: user.avatar, role: user.role };
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
  return {
    token,
    key: sess.user,
    username: user.username,
    avatar: user.avatar,
    role: user.role,
    msgCount: user.msgCount,
  };
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

// ---------- Messages ----------

function awardAchievement(db, userKey, id) {
  // returns true if this was newly awarded
  const catalog = ACHIEVEMENTS;
  if (!catalog[id]) return false;
  db.achievements[userKey] = db.achievements[userKey] || {};
  if (db.achievements[userKey][id]) return false;
  db.achievements[userKey][id] = Date.now();
  return true;
}

export function postMessage(user, text) {
  text = String(text || "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
  if (!text) return { error: 400, message: "Message can't be empty" };
  if (text.length > 500) text = text.slice(0, 500);
  return withLock(() => {
    const db = getDb();
    const msg = { id: db.nextId++, user: user.username, text, ts: Date.now(), reactions: {} };
    db.messages.push(msg);
    if (db.messages.length > MAX_MESSAGES) {
      db.messages = db.messages.slice(-MAX_MESSAGES);
    }
    db.presence[user.key] = Date.now();
    const u = db.users[user.key];
    if (u) u.msgCount = (u.msgCount || 0) + 1;
    // server-side achievements
    const unlocked = [];
    if (awardAchievement(db, user.key, "first_words")) unlocked.push("first_words");
    if (u && u.msgCount >= 50 && awardAchievement(db, user.key, "chatterbox")) unlocked.push("chatterbox");
    const hour = new Date(msg.ts).getHours();
    if (hour < 5 && awardAchievement(db, user.key, "night_owl")) unlocked.push("night_owl");
    saveDb(db);
    return {
      message: msg,
      badge: badgeFor(u ? u.msgCount : 0),
      unlocked: unlocked.map((id) => ({ id, ...ACHIEVEMENTS[id] })),
    };
  });
}

// Snapshot of the chat: recent messages, author info, online list, typing users.
export function messagesAfter(afterId, excludeKey) {
  const db = getDb();
  const after = Number(afterId) || 0;
  const recent = db.messages.slice(-200);
  const out = recent.filter((m) => m.id > after);
  const users = {};
  for (const m of out) {
    if (users[m.user]) continue;
    const key = m.user.toLowerCase();
    const u = db.users[key];
    users[m.user] = {
      avatar: (u && u.avatar) || "🎮",
      badge: badgeFor(u ? u.msgCount : 0),
      role: (u && u.role) || "user",
    };
  }
  return { messages: out, online: onlineUsers(), users, typing: typingUsers(excludeKey) };
}

// ---------- Reactions ----------

export function reactToMessage(user, messageId, emoji) {
  messageId = Number(messageId) || 0;
  emoji = String(emoji || "");
  if (!REACTIONS.includes(emoji)) return { error: 400, message: "Unknown reaction" };
  return withLock(() => {
    const db = getDb();
    const msg = db.messages.find((m) => m.id === messageId);
    if (!msg || msg.deleted) return { error: 404, message: "Message not found" };
    msg.reactions = msg.reactions || {};
    const list = msg.reactions[emoji] || [];
    const i = list.indexOf(user.username);
    if (i >= 0) list.splice(i, 1); // toggle off
    else list.push(user.username); // toggle on
    if (list.length) msg.reactions[emoji] = list;
    else delete msg.reactions[emoji];
    saveDb(db);
    return { ok: true, reactions: msg.reactions };
  });
}

// ---------- Moderation ----------

export function deleteMessage(user, messageId) {
  messageId = Number(messageId) || 0;
  return withLock(() => {
    const db = getDb();
    const msg = db.messages.find((m) => m.id === messageId);
    if (!msg) return { error: 404, message: "Message not found" };
    if (msg.user !== user.username && user.role !== "admin") {
      return { error: 403, message: "You can only delete your own messages" };
    }
    if (!msg.deleted) {
      msg.deleted = true;
      msg.text = "";
      saveDb(db);
    }
    return { ok: true };
  });
}

// ---------- Typing indicators ----------

export function setTyping(user) {
  return withLock(() => {
    const db = getDb();
    db.typing[user.key] = Date.now();
    // prune anything outside the window
    const cutoff = Date.now() - TYPING_WINDOW_MS;
    for (const u of Object.keys(db.typing)) {
      if (db.typing[u] < cutoff) delete db.typing[u];
    }
    saveDb(db);
  });
}

export function typingUsers(excludeKey) {
  const db = getDb();
  const cutoff = Date.now() - TYPING_WINDOW_MS;
  const out = [];
  for (const [key, ts] of Object.entries(db.typing)) {
    if (ts >= cutoff && key !== excludeKey) {
      const u = db.users[key];
      if (u) out.push(u.username);
    }
  }
  return out;
}

// ---------- Direct messages ----------

function dmKey(a, b) {
  return [String(a).toLowerCase(), String(b).toLowerCase()].sort().join("|");
}

export function postDM(fromUser, toUsername, text) {
  text = String(text || "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
  if (!text) return { error: 400, message: "Message can't be empty" };
  if (text.length > 500) text = text.slice(0, 500);
  toUsername = String(toUsername || "").trim();
  return withLock(() => {
    const db = getDb();
    const toKey = toUsername.toLowerCase();
    const to = db.users[toKey];
    if (!to) return { error: 404, message: "No user with that name" };
    if (toKey === fromUser.key) return { error: 400, message: "You can't DM yourself" };
    const key = dmKey(fromUser.key, toKey);
    db.dms[key] = db.dms[key] || [];
    const msg = { id: db.nextId++, from: fromUser.username, to: to.username, text, ts: Date.now() };
    db.dms[key].push(msg);
    if (db.dms[key].length > MAX_DM_PER_THREAD) {
      db.dms[key] = db.dms[key].slice(-MAX_DM_PER_THREAD);
    }
    const unlocked = [];
    if (awardAchievement(db, fromUser.key, "pen_pal")) unlocked.push("pen_pal");
    saveDb(db);
    return { message: msg, unlocked: unlocked.map((id) => ({ id, ...ACHIEVEMENTS[id] })) };
  });
}

export function dmThread(user, otherUsername, afterId) {
  const db = getDb();
  const otherKey = String(otherUsername || "").trim().toLowerCase();
  const other = db.users[otherKey];
  if (!other) return { error: 404, message: "No user with that name" };
  if (otherKey === user.key) return { error: 400, message: "You can't DM yourself" };
  const key = dmKey(user.key, otherKey);
  const after = Number(afterId) || 0;
  const thread = (db.dms[key] || []).filter((m) => m.id > after).slice(-200);
  return {
    with: other.username,
    avatar: other.avatar,
    messages: thread,
  };
}

// ---------- Scores / leaderboard ----------

const VALID_GAMES = new Set(["snake", "2048", "breakout", "flappy", "pong", "tetris"]);

export function submitScore(user, game, score) {
  game = String(game || "");
  score = Math.floor(Number(score));
  if (!VALID_GAMES.has(game)) return { error: 400, message: "Unknown game" };
  if (!Number.isFinite(score) || score < 0 || score > 10_000_000) return { error: 400, message: "Invalid score" };
  return withLock(() => {
    const db = getDb();
    db.scores[game] = db.scores[game] || [];
    const list = db.scores[game];
    const mine = list.find((s) => s.user === user.username);
    if (mine) {
      if (score > mine.score) {
        mine.score = score;
        mine.ts = Date.now();
      }
    } else {
      list.push({ user: user.username, score, ts: Date.now() });
    }
    // keep top 10
    list.sort((a, b) => b.score - a.score);
    if (list.length > 10) list.length = 10;
    saveDb(db);
    return { ok: true, leaderboard: leaderboard()[game] || [] };
  });
}

export function leaderboard() {
  const db = getDb();
  const out = {};
  for (const game of VALID_GAMES) {
    out[game] = (db.scores[game] || []).map((s) => ({ user: s.user, score: s.score }));
  }
  return out;
}

// ---------- Achievements ----------

// Client-reported game milestones: the server just records them.
export function awardAchievementClient(user, id) {
  id = String(id || "");
  if (!ACHIEVEMENTS[id]) return { error: 400, message: "Unknown achievement" };
  return withLock(() => {
    const db = getDb();
    const isNew = awardAchievement(db, user.key, id);
    saveDb(db);
    return { ok: true, isNew, achievement: { id, ...ACHIEVEMENTS[id] } };
  });
}

export function getAchievements(user) {
  const db = getDb();
  const mine = db.achievements[user.key] || {};
  const out = [];
  for (const [id, ts] of Object.entries(mine)) {
    if (ACHIEVEMENTS[id]) out.push({ id, ts, ...ACHIEVEMENTS[id] });
  }
  return { achievements: out, total: Object.keys(ACHIEVEMENTS).length };
}

// ---------- Admin backup ----------

export function isAdmin(user) {
  return !!(user && user.role === "admin");
}

export function exportDbJson(user) {
  if (!isAdmin(user)) return { error: 403, message: "Admins only" };
  const db = getDb();
  // strip password hashes + session tokens from the export
  const safe = JSON.parse(JSON.stringify(db));
  for (const u of Object.values(safe.users)) { delete u.hash; delete u.salt; }
  safe.sessions = {};
  return { json: JSON.stringify(safe, null, 2) };
}
