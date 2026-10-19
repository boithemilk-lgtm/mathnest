// MathNest server — static files + JSON API + built-in proxy.
// Zero npm dependencies: runs on plain Node.js and on Wasmer Edge (EdgeJS).

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { proxyRequest, parseTarget } from "./proxy.js";
import * as auth from "./auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const PORT = process.env.PORT || 3000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === "/api/proxy") {
      await proxyRequest(req, res, url.searchParams);
      return;
    }

    if (pathname.startsWith("/api/")) {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
          "access-control-allow-headers": "Content-Type, Authorization",
          "access-control-max-age": "86400",
        });
        return res.end();
      }
      await handleApi(req, res, url);
      return;
    }

    serveStatic(pathname, res);
  } catch (e) {
    console.error("request error:", e);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    } else {
      res.end();
    }
  }
});

// ---------- API ----------

function sendJson(res, status, obj, extraHeaders = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    ...extraHeaders,
  });
  res.end(JSON.stringify(obj));
}

function readJson(req, limit = 100 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("Body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch (e) {
        resolve(null);
      }
    });
    req.on("error", reject);
  });
}

function tokenFromReq(req, url) {
  const h = req.headers["authorization"] || "";
  if (h.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  const q = url.searchParams.get("token");
  return q ? q : null;
}

function requireUser(req, url) {
  const token = tokenFromReq(req, url);
  const user = auth.userForToken(token);
  return { token, user };
}

// ---------- Rate limiting (in-memory, per instance) ----------

const rateBuckets = new Map();

function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  let b = rateBuckets.get(key);
  if (!b || now - b.start > windowMs) {
    b = { start: now, count: 0 };
    rateBuckets.set(key, b);
  }
  b.count += 1;
  return b.count <= limit;
}

// prune stale buckets occasionally so the map can't grow forever
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of rateBuckets) {
    if (now - b.start > 60 * 60 * 1000) rateBuckets.delete(k);
  }
}, 10 * 60 * 1000).unref?.();

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return String(fwd).split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

const RL_SIGNUP = { limit: 5, window: 60 * 60 * 1000 };      // 5/hour per IP
const RL_LOGIN = { limit: 10, window: 5 * 60 * 1000 };       // 10/5min per IP
const RL_MSG = { limit: 12, window: 60 * 1000 };            // 12/min per user

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  const method = req.method;

  if (method === "GET" && pathname === "/api/health") {
    return sendJson(res, 200, { ok: true, time: Date.now() });
  }

  if (method === "POST" && pathname === "/api/signup") {
    if (!rateLimit("signup:" + clientIp(req), RL_SIGNUP.limit, RL_SIGNUP.window)) {
      return sendJson(res, 429, { error: "Too many signups from this network — try again later" });
    }
    const body = await readJson(req);
    if (!body) return sendJson(res, 400, { error: "Invalid JSON body" });
    const result = auth.signup(body.username, body.password, body.avatar);
    if (result.error) return sendJson(res, result.error, { error: result.message });
    return sendJson(res, 200, result);
  }

  if (method === "POST" && pathname === "/api/login") {
    if (!rateLimit("login:" + clientIp(req), RL_LOGIN.limit, RL_LOGIN.window)) {
      return sendJson(res, 429, { error: "Too many login attempts — try again in a few minutes" });
    }
    const body = await readJson(req);
    if (!body) return sendJson(res, 400, { error: "Invalid JSON body" });
    const result = auth.login(body.username, body.password);
    if (result.error) return sendJson(res, result.error, { error: result.message });
    return sendJson(res, 200, result);
  }

  if (method === "POST" && pathname === "/api/logout") {
    const { token } = requireUser(req, url);
    auth.logout(token);
    return sendJson(res, 200, { ok: true });
  }

  if (method === "GET" && pathname === "/api/me") {
    const { user } = requireUser(req, url);
    if (!user) return sendJson(res, 401, { error: "Not logged in" });
    return sendJson(res, 200, {
      username: user.username,
      avatar: user.avatar,
      role: user.role,
      msgCount: user.msgCount,
      badge: auth.badgeFor(user.msgCount),
    });
  }

  if (method === "GET" && pathname === "/api/messages") {
    const { user } = requireUser(req, url);
    if (!user) return sendJson(res, 401, { error: "Log in to use the chat" });
    auth.touchPresence(tokenFromReq(req, url), user.key);
    const data = auth.messagesAfter(url.searchParams.get("after"), user.key);
    return sendJson(res, 200, data);
  }

  if (method === "POST" && pathname === "/api/messages") {
    const { user } = requireUser(req, url);
    if (!user) return sendJson(res, 401, { error: "Log in to use the chat" });
    if (!rateLimit("msg:" + user.key, RL_MSG.limit, RL_MSG.window)) {
      return sendJson(res, 429, { error: "You're sending messages too fast — take a breath" });
    }
    const body = await readJson(req);
    if (!body) return sendJson(res, 400, { error: "Invalid JSON body" });
    const result = auth.postMessage(user, body.text);
    if (result.error) return sendJson(res, result.error, { error: result.message });
    return sendJson(res, 200, result);
  }

  // React to a message (toggle)
  let m = pathname.match(/^\/api\/messages\/(\d+)\/react$/);
  if (method === "POST" && m) {
    const { user } = requireUser(req, url);
    if (!user) return sendJson(res, 401, { error: "Log in to use the chat" });
    const body = await readJson(req);
    if (!body) return sendJson(res, 400, { error: "Invalid JSON body" });
    const result = auth.reactToMessage(user, m[1], body.emoji);
    if (result.error) return sendJson(res, result.error, { error: result.message });
    return sendJson(res, 200, result);
  }

  // Delete a message (own messages + admin moderation)
  m = pathname.match(/^\/api\/messages\/(\d+)$/);
  if (method === "DELETE" && m) {
    const { user } = requireUser(req, url);
    if (!user) return sendJson(res, 401, { error: "Log in to use the chat" });
    const result = auth.deleteMessage(user, m[1]);
    if (result.error) return sendJson(res, result.error, { error: result.message });
    return sendJson(res, 200, result);
  }

  // Typing indicator
  if (method === "POST" && pathname === "/api/typing") {
    const { user } = requireUser(req, url);
    if (!user) return sendJson(res, 401, { error: "Log in to use the chat" });
    auth.setTyping(user);
    return sendJson(res, 200, { ok: true });
  }

  // Direct messages
  if (method === "POST" && pathname === "/api/dms") {
    const { user } = requireUser(req, url);
    if (!user) return sendJson(res, 401, { error: "Log in first" });
    if (!rateLimit("dm:" + user.key, RL_MSG.limit, RL_MSG.window)) {
      return sendJson(res, 429, { error: "You're sending messages too fast — take a breath" });
    }
    const body = await readJson(req);
    if (!body) return sendJson(res, 400, { error: "Invalid JSON body" });
    const result = auth.postDM(user, body.to, body.text);
    if (result.error) return sendJson(res, result.error, { error: result.message });
    return sendJson(res, 200, result);
  }

  if (method === "GET" && pathname === "/api/dms") {
    const { user } = requireUser(req, url);
    if (!user) return sendJson(res, 401, { error: "Log in first" });
    const result = auth.dmThread(user, url.searchParams.get("with"), url.searchParams.get("after"));
    if (result.error) return sendJson(res, result.error, { error: result.message });
    return sendJson(res, 200, result);
  }

  // Leaderboard
  if (method === "GET" && pathname === "/api/leaderboard") {
    return sendJson(res, 200, { games: auth.leaderboard() });
  }

  if (method === "POST" && pathname === "/api/scores") {
    const { user } = requireUser(req, url);
    if (!user) return sendJson(res, 401, { error: "Log in to submit scores" });
    const body = await readJson(req);
    if (!body) return sendJson(res, 400, { error: "Invalid JSON body" });
    const result = auth.submitScore(user, body.game, body.score);
    if (result.error) return sendJson(res, result.error, { error: result.message });
    return sendJson(res, 200, result);
  }

  // Achievements
  if (method === "GET" && pathname === "/api/achievements") {
    const { user } = requireUser(req, url);
    if (!user) return sendJson(res, 401, { error: "Log in first" });
    return sendJson(res, 200, auth.getAchievements(user));
  }

  if (method === "POST" && pathname === "/api/achievements") {
    const { user } = requireUser(req, url);
    if (!user) return sendJson(res, 401, { error: "Log in first" });
    const body = await readJson(req);
    if (!body) return sendJson(res, 400, { error: "Invalid JSON body" });
    const result = auth.awardAchievementClient(user, body.id);
    if (result.error) return sendJson(res, result.error, { error: result.message });
    return sendJson(res, 200, result);
  }

  // Admin backup download (safe JSON — no hashes or tokens)
  if (method === "GET" && pathname === "/api/backup") {
    const { user } = requireUser(req, url);
    const result = auth.exportDbJson(user);
    if (result.error) return sendJson(res, result.error, { error: result.message });
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "content-disposition": "attachment; filename=mathnest-backup.json",
    });
    return res.end(result.json);
  }

  if (method === "GET" && pathname === "/api/parse-target") {
    const parsed = await parseTarget(url.searchParams.get("url"));
    return sendJson(res, 200, parsed);
  }

  return sendJson(res, 404, { error: "Unknown API route" });
}

// ---------- Static files ----------

function serveStatic(pathname, res) {
  if (pathname === "/") pathname = "/index.html";
  if (pathname === "/vault" || pathname === "/vault.html") pathname = "/vault.html";

  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendJson(res, 403, { error: "Forbidden" });
  }

  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      // SPA-ish fallback: unknown paths go to the math site.
      return sendFile(path.join(PUBLIC_DIR, "index.html"), res, true);
    }
    sendFile(filePath, res, false);
  });
}

function sendFile(filePath, res, isFallback) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "content-type": "text/plain" });
      return res.end("404 — page not found");
    }
    const ext = path.extname(filePath).toLowerCase();
    const status = isFallback ? 200 : 200;
    res.writeHead(status, {
      "content-type": MIME[ext] || "application/octet-stream",
      "cache-control": isFallback ? "no-store" : "public, max-age=120",
      "x-content-type-options": "nosniff",
    });
    res.end(data);
  });
}

server.listen(PORT, () => {
  console.log(`MathNest listening on port ${PORT}`);
});
