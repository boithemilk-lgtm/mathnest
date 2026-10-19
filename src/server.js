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

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  const method = req.method;

  if (method === "GET" && pathname === "/api/health") {
    return sendJson(res, 200, { ok: true, time: Date.now() });
  }

  if (method === "POST" && pathname === "/api/signup") {
    const body = await readJson(req);
    if (!body) return sendJson(res, 400, { error: "Invalid JSON body" });
    const result = auth.signup(body.username, body.password);
    if (result.error) return sendJson(res, result.error, { error: result.message });
    return sendJson(res, 200, result);
  }

  if (method === "POST" && pathname === "/api/login") {
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
    return sendJson(res, 200, { username: user.username });
  }

  if (method === "GET" && pathname === "/api/messages") {
    const { user } = requireUser(req, url);
    if (!user) return sendJson(res, 401, { error: "Log in to use the chat" });
    auth.touchPresence(tokenFromReq(req, url), user.key);
    const data = auth.messagesAfter(url.searchParams.get("after"));
    return sendJson(res, 200, data);
  }

  if (method === "POST" && pathname === "/api/messages") {
    const { user } = requireUser(req, url);
    if (!user) return sendJson(res, 401, { error: "Log in to use the chat" });
    const body = await readJson(req);
    if (!body) return sendJson(res, 400, { error: "Invalid JSON body" });
    const result = auth.postMessage(user, body.text);
    if (result.error) return sendJson(res, result.error, { error: result.message });
    return sendJson(res, 200, result);
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
