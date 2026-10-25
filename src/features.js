// MathNest add-on features: profiles, community feed, and server-side AI chat.
import { getDb, saveDb, withLock } from "./store.js";
import * as auth from "./auth.js";

const AI_LIMIT = new Map();
const AVATARS = ["🎮", "👾", "🚀", "🛸", "⭐", "🍕", "🍩", "🐱", "🦊", "🐸", "🦄", "🐙", "🤖", "👽", "🎃", "🎧", "🎸", "⚽", "🐉", "🧙"];

function json(res, status, data) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}
function tokenFrom(req, url) {
  const h = String(req.headers.authorization || "");
  if (h.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  return url.searchParams.get("token") || null;
}
function currentUser(req, url) { return auth.userForToken(tokenFrom(req, url)); }
function body(req, limit = 12000) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > limit) { reject(new Error("Request too large")); req.destroy(); }
    });
    req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error("Invalid JSON")); } });
    req.on("error", reject);
  });
}
function publicUser(u) {
  return { username: u.username, avatar: u.avatar || "🎮", bio: u.bio || "", displayName: u.displayName || u.username, created: u.created || null, role: u.role || "user", msgCount: u.msgCount || 0 };
}

export async function handleFeaturesApi(req, res, url) {
  const path = url.pathname;
  const method = req.method;

  if (path === "/api/features/profile" && method === "GET") {
    const user = currentUser(req, url);
    if (!user) return json(res, 401, { error: "Log in to view your profile settings." });
    const db = getDb();
    return json(res, 200, { profile: publicUser(db.users[user.key] || user) });
  }

  if (path === "/api/features/profile" && method === "POST") {
    const user = currentUser(req, url);
    if (!user) return json(res, 401, { error: "Log in to edit your profile." });
    let data;
    try { data = await body(req); } catch (e) { return json(res, 400, { error: e.message }); }
    const displayName = String(data.displayName || user.username).trim().replace(/[<>\u0000-\u001f]/g, "").slice(0, 24) || user.username;
    const bio = String(data.bio || "").trim().replace(/[<>\u0000-\u001f]/g, "").slice(0, 160);
    const avatar = AVATARS.includes(data.avatar) ? data.avatar : "🎮";
    const result = withLock(() => {
      const db = getDb();
      const stored = db.users[user.key];
      if (!stored) return { error: 401, message: "Account not found." };
      stored.displayName = displayName;
      stored.bio = bio;
      stored.avatar = avatar;
      saveDb(db);
      return { profile: publicUser(stored) };
    });
    if (result.error) return json(res, result.error, { error: result.message });
    return json(res, 200, result);
  }

  if (path === "/api/features/community" && method === "GET") {
    const db = getDb();
    const posts = (db.communityPosts || []).slice(-100).reverse();
    return json(res, 200, { posts });
  }

  if (path === "/api/features/community" && method === "POST") {
    const user = currentUser(req, url);
    if (!user) return json(res, 401, { error: "Log in to post in the community." });
    let data;
    try { data = await body(req); } catch (e) { return json(res, 400, { error: e.message }); }
    const text = String(data.text || "").trim().replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").slice(0, 280);
    if (!text) return json(res, 400, { error: "Write something first." });
    const result = withLock(() => {
      const db = getDb();
      db.communityPosts ||= [];
      db.nextCommunityId ||= 1;
      const stored = db.users[user.key] || user;
      const post = { id: db.nextCommunityId++, username: stored.username, avatar: stored.avatar || "🎮", displayName: stored.displayName || stored.username, text, ts: Date.now() };
      db.communityPosts.push(post);
      db.communityPosts = db.communityPosts.slice(-300);
      saveDb(db);
      return { post };
    });
    if (result.error) return json(res, result.error, { error: result.message });
    return json(res, 200, result);
  }

  const deleteMatch = path.match(/^\/api\/features\/community\/(\d+)$/);
  if (deleteMatch && method === "DELETE") {
    const user = currentUser(req, url);
    if (!user) return json(res, 401, { error: "Log in first." });
    const result = withLock(() => {
      const db = getDb();
      db.communityPosts ||= [];
      const post = db.communityPosts.find(p => p.id === Number(deleteMatch[1]));
      if (!post) return { error: 404, message: "Post not found." };
      if (post.username.toLowerCase() !== user.username.toLowerCase() && user.role !== "admin") return { error: 403, message: "You can only delete your own posts." };
      db.communityPosts = db.communityPosts.filter(p => p.id !== post.id);
      saveDb(db);
      return { ok: true };
    });
    if (result.error) return json(res, result.error, { error: result.message });
    return json(res, 200, result);
  }

  // Account-bound arcade progress. The browser can only submit bounded,
  // whitelisted fields; progress is stored on the user's server-side account.
  if (path === "/api/features/progress" && method === "GET") {
    const user = currentUser(req, url);
    if (!user) return json(res, 401, { error: "Log in to load your saved progress." });
    const db = getDb();
    const stored = db.users[user.key];
    const progress = stored?.progress || { gamesPlayed: {}, bestScores: {}, recentGames: [], favoriteGames: [] };
    return json(res, 200, { progress });
  }

  if (path === "/api/features/progress" && method === "POST") {
    const user = currentUser(req, url);
    if (!user) return json(res, 401, { error: "Log in to save your progress." });
    let data;
    try { data = await body(req, 12000); } catch (e) { return json(res, 400, { error: e.message }); }
    const allowedGames = new Set(["snake", "2048", "breakout", "flappy", "pong", "tetris", "dungeon"]);
    const result = withLock(() => {
      const db = getDb();
      const stored = db.users[user.key];
      if (!stored) return { error: 401, message: "Account not found." };
      const progress = stored.progress ||= { gamesPlayed: {}, bestScores: {}, recentGames: [], favoriteGames: [] };
      progress.gamesPlayed ||= {};
      progress.bestScores ||= {};
      progress.recentGames ||= [];
      progress.favoriteGames ||= [];
      const game = String(data.game || "");
      if (data.event === "played" && allowedGames.has(game)) {
        progress.gamesPlayed[game] = Math.min(1000000, (Number(progress.gamesPlayed[game]) || 0) + 1);
        progress.recentGames = [game, ...progress.recentGames.filter((id) => id !== game)].slice(0, 8);
      }
      if (data.event === "score" && allowedGames.has(game)) {
        const score = Math.floor(Number(data.score));
        if (Number.isFinite(score) && score >= 0 && score <= 100000000) {
          progress.bestScores[game] = Math.max(Number(progress.bestScores[game]) || 0, score);
        }
      }
      if (Array.isArray(data.favoriteGames)) {
        progress.favoriteGames = [...new Set(data.favoriteGames.filter((id) => allowedGames.has(String(id))).map(String))].slice(0, 8);
      }
      progress.updatedAt = Date.now();
      saveDb(db);
      return { progress };
    });
    if (result.error) return json(res, result.error, { error: result.message });
    return json(res, 200, result);
  }

  // Public suggestions feed; only signed-in accounts can submit an idea.
  if (path === "/api/features/suggestions" && method === "GET") {
    const db = getDb();
    return json(res, 200, { suggestions: (db.suggestions || []).slice(-80).reverse() });
  }

  if (path === "/api/features/suggestions" && method === "POST") {
    const user = currentUser(req, url);
    if (!user) return json(res, 401, { error: "Log in to send a suggestion." });
    let data;
    try { data = await body(req, 12000); } catch (e) { return json(res, 400, { error: e.message }); }
    const title = String(data.title || "").trim().replace(/[<>\u0000-\u001f]/g, "").slice(0, 70);
    const text = String(data.text || "").trim().replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").slice(0, 500);
    if (!title || !text) return json(res, 400, { error: "Add a title and a little detail first." });
    const result = withLock(() => {
      const db = getDb();
      db.suggestions ||= [];
      db.nextSuggestionId ||= 1;
      const stored = db.users[user.key] || user;
      const suggestion = { id: db.nextSuggestionId++, username: stored.username, avatar: stored.avatar || "🎮", title, text, ts: Date.now() };
      db.suggestions.push(suggestion);
      db.suggestions = db.suggestions.slice(-250);
      saveDb(db);
      return { suggestion };
    });
    if (result.error) return json(res, result.error, { error: result.message });
    return json(res, 200, result);
  }

  if (path === "/api/features/ai" && method === "POST") {
    const user = currentUser(req, url);
    if (!user) return json(res, 401, { error: "Log in to use MathNest AI." });
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return json(res, 503, { error: "MathNest AI isn't configured yet. Add OPENROUTER_API_KEY to your Wasmer app's environment variables." });
    const now = Date.now();
    const last = AI_LIMIT.get(user.key) || 0;
    if (now - last < 2500) return json(res, 429, { error: "Give the AI a second before sending another message." });
    AI_LIMIT.set(user.key, now);
    let data;
    try { data = await body(req, 20000); } catch (e) { return json(res, 400, { error: e.message }); }
    const messages = Array.isArray(data.messages) ? data.messages.slice(-12) : [];
    const clean = [];
    for (const m of messages) {
      if (!m || !["user", "assistant"].includes(m.role)) continue;
      const content = String(m.content || "").trim().slice(0, 3000);
      if (content) clean.push({ role: m.role, content });
    }
    if (!clean.length || clean[clean.length - 1].role !== "user") return json(res, 400, { error: "Send a message to get started." });
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json", "HTTP-Referer": process.env.SITE_URL || "https://mathnest.app", "X-Title": "MathNest AI" },
        body: JSON.stringify({ model: process.env.OPENROUTER_MODEL || "openrouter/free", messages: [{ role: "system", content: "You are MathNest AI, a friendly, concise assistant for learning, brainstorming, writing, and coding. Explain clearly, support learning instead of simply doing schoolwork when appropriate, and never claim you ran code unless you did. Do not request passwords, API keys, or sensitive personal information. Keep answers useful and age-appropriate." }, ...clean], temperature: 0.6, max_tokens: 1200 })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const msg = result?.error?.message || `AI provider returned ${response.status}.`;
        return json(res, 502, { error: msg.slice(0, 220) });
      }
      const reply = result?.choices?.[0]?.message?.content;
      if (!reply) return json(res, 502, { error: "The AI provider returned an empty reply." });
      return json(res, 200, { reply: String(reply).slice(0, 12000) });
    } catch (e) {
      return json(res, 502, { error: "Could not reach the AI provider. Try again in a moment." });
    }
  }

  return json(res, 404, { error: "Unknown feature endpoint." });
}
