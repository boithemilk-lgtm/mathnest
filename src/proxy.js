// Built-in web proxy.
//
// Fetches a remote URL server-side and returns it through this app so the
// browser never talks to the destination directly. HTML gets a <base> tag
// (so images/scripts/stylesheets load straight from the source site) while
// links and forms are rewritten to keep navigation inside the proxy.
//
// Honest limitations (this is a lightweight fetch-and-rewrite proxy, not a
// full rewriter like Ultraviolet):
//   - Sites that require cookies/logins on the destination won't stay logged in.
//   - Heavy JavaScript apps that fetch APIs with relative URLs may partially break.
//   - Intended for simple browsing of informational sites.

import { createRequire } from "node:module";
import dns from "node:dns";
const require = createRequire(import.meta.url);

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB cap per response (all content types)
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 12000; // covers connect + body read

const PRIVATE_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]", "metadata.google.internal"]);

function isPrivateIpv4(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

// Expand an IPv6 address (possibly compressed, possibly v4-mapped) into 8 hex
// groups. Returns null if it can't be parsed.
function expandIpv6(addr) {
  let s = String(addr || "").replace(/^\[|\]$/g, "").toLowerCase();
  // trailing IPv4 dotted part -> two hex groups
  const v4 = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const o = v4[2].split(".").map(Number);
    s = v4[1] + ((o[0] << 8) | o[1]).toString(16) + ":" + ((o[2] << 8) | o[3]).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill(0), ...tail].map((g) => parseInt(g, 16));
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g))) return null;
  return groups;
}

function isPrivateIpv6(ip) {
  const groups = expandIpv6(ip);
  if (!groups) return false;
  const allZero = groups.every((g) => g === 0);
  if (allZero) return true; // ::
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true; // ::1
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    // IPv4-mapped — check the embedded v4 address
    return isPrivateIpv4(`${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`);
  }
  if ((groups[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((groups[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  return false;
}

function isPrivateAddress(addr) {
  const a = String(addr || "");
  if (a.includes(":")) return isPrivateIpv6(a);
  return isPrivateIpv4(a);
}

function isPrivateHost(hostname) {
  const h = String(hostname || "").toLowerCase();
  if (PRIVATE_HOSTS.has(h)) return true;
  if (h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".localhost")) return true;
  // Literal IPs (incl. bracketed IPv6) are checked directly, no DNS needed.
  const bare = h.replace(/^\[|\]$/g, "");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(bare) || bare.includes(":")) {
    return isPrivateAddress(bare);
  }
  return false;
}

// Resolve the hostname and check every address it maps to. DNS names can point
// at private/internal ranges even when the text looks public, so a text check
// alone is not enough. Fails closed if resolution errors.
async function resolvesToPrivateHost(hostname) {
  const bare = String(hostname || "").replace(/^\[|\]$/g, "");
  // already a literal IP
  if (/^\d+\.\d+\.\d+\.\d+$/.test(bare) || bare.includes(":")) {
    return isPrivateAddress(bare);
  }
  try {
    const addrs = await dns.promises.lookup(bare, { all: true });
    return addrs.some((a) => isPrivateAddress(a.address));
  } catch (e) {
    return true; // unresolvable -> treat as blocked (fail closed)
  }
}

export async function parseTarget(rawUrl) {
  let u;
  try {
    u = new URL(String(rawUrl || ""));
  } catch (e) {
    return { error: "That doesn't look like a valid URL" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { error: "Only http:// and https:// URLs are supported" };
  }
  if (isPrivateHost(u.hostname)) {
    return { error: "Blocked: that host is not allowed" };
  }
  if (await resolvesToPrivateHost(u.hostname)) {
    return { error: "Blocked: that host is not allowed" };
  }
  return { url: u };
}

async function fetchWithRedirectChecks(u, init) {
  let current = u;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const check = await parseTarget(current.href);
    if (check.error) throw new Error(check.error);
    let res;
    if (typeof globalThis.fetch === "function") {
      res = await fetch(current.href, init);
    } else {
      res = await fetchNode(current, init); // fallback for runtimes without fetch
    }
    if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.get("location")) {
      const next = new URL(res.headers.get("location"), current.href);
      current = next;
      continue;
    }
    return { res, finalUrl: current.href };
  }
  throw new Error("Too many redirects");
}

function fetchNode(u, init) {
  // Minimal https fallback using node:https when global fetch is missing.
  const https = require("node:https");
  const http = require("node:http");
  const mod = u.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(u, { method: init.method || "GET", timeout: REQUEST_TIMEOUT_MS }, (res) => {
      // wrap in a fetch-like Response subset
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks);
        resolve({
          status: res.statusCode,
          headers: {
            get: (name) => res.headers[String(name).toLowerCase()] || null,
          },
          arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
          text: async () => body.toString("utf8"),
        });
      });
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out")); });
    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

// Navigation (anchors, forms, iframes) is rewritten to "?url=..." — a link
// relative to the proxy document's own URL, so it works no matter what origin
// or path the proxy is served from (localhost, Wasmer, preview hosts).
function proxiedUrl(absoluteUrl) {
  return "?url=" + encodeURIComponent(absoluteUrl);
}

export function rewriteHtml(html, baseUrl) {
  const base = new URL(baseUrl);
  // Resolve a URL found in an attribute against the page we're rewriting.
  const resolve = (val) => {
    try {
      const abs = new URL(val, base).href;
      if (abs.startsWith("http:") || abs.startsWith("https:")) return abs;
    } catch (e) { /* ignore */ }
    return null;
  };

  let out = html;

  // 1. Drop any existing <base> tags — we rewrite every URL instead.
  out = out.replace(/<base\b[^>]*>/gi, "");

  // 2. Sub-resources (images, scripts, stylesheets, media): rewrite to
  //    absolute destination URLs so they load straight from the source site.
  out = out.replace(/<(img|script|source|video|audio|embed|track)\b([^>]*)>/gi, (m, tag, attrs) => {
    const srcMatch = attrs.match(/\ssrc\s*=\s*("([^"]*)"|'([^']*)')/i);
    if (!srcMatch) return m;
    const val = srcMatch[2] !== undefined ? srcMatch[2] : srcMatch[3];
    if (/^(data:|blob:)/i.test(val.trim())) return m;
    const abs = resolve(val);
    if (!abs) return m;
    return `<${tag}${attrs.replace(srcMatch[0], ` src="${abs}"`)}>`;
  });

  out = out.replace(/<video\b([^>]*)>/gi, (m, attrs) => {
    const pMatch = attrs.match(/\sposter\s*=\s*("([^"]*)"|'([^']*)')/i);
    if (!pMatch) return m;
    const val = pMatch[2] !== undefined ? pMatch[2] : pMatch[3];
    const abs = resolve(val);
    if (!abs) return m;
    return `<video${attrs.replace(pMatch[0], ` poster="${abs}"`)}>`;
  });

  out = out.replace(/<link\b([^>]*)>/gi, (m, attrs) => {
    const hMatch = attrs.match(/\shref\s*=\s*("([^"]*)"|'([^']*)')/i);
    if (!hMatch) return m;
    const val = hMatch[2] !== undefined ? hMatch[2] : hMatch[3];
    const abs = resolve(val);
    if (!abs) return m;
    return `<link${attrs.replace(hMatch[0], ` href="${abs}"`)}>`;
  });

  // 3. Navigation: anchors, forms and iframes stay inside the proxy via
  //    "?url=..." links (relative to this document's own URL).
  out = out.replace(/<a\b([^>]*)>/gi, (m, attrs) => {
    const hrefMatch = attrs.match(/\shref\s*=\s*("([^"]*)"|'([^']*)')/i);
    if (!hrefMatch) return m;
    const val = hrefMatch[2] !== undefined ? hrefMatch[2] : hrefMatch[3];
    if (/^(#|javascript:|mailto:|tel:|data:)/i.test(val.trim())) return m;
    const abs = resolve(val);
    if (!abs) return m;
    const newAttrs = attrs.replace(hrefMatch[0], ` href="${proxiedUrl(abs)}"`);
    return `<a${newAttrs}>`;
  });

  out = out.replace(/\saction\s*=\s*("([^"]*)"|'([^']*)')/gi, (m, _q, dq, sq) => {
    const val = dq !== undefined ? dq : sq;
    const abs = resolve(val);
    if (!abs) return m;
    const quote = dq !== undefined ? '"' : "'";
    return ` action=${quote}${proxiedUrl(abs)}${quote}`;
  });

  out = out.replace(/<iframe([^>]*)>/gi, (m, attrs) => {
    const srcMatch = attrs.match(/\ssrc\s*=\s*("([^"]*)"|'([^']*)')/i);
    if (!srcMatch) return m;
    const val = srcMatch[2] !== undefined ? srcMatch[2] : srcMatch[3];
    const abs = resolve(val);
    if (!abs) return m;
    return `<iframe${attrs.replace(srcMatch[0], ` src="${proxiedUrl(abs)}"`)}>`;
  });

  // 4. Drop `target="_blank"` on rewritten anchors so links open in place.
  out = out.replace(/(<a\b[^>]*?)\starget\s*=\s*("[^"]*"|'[^']*'|_[a-zA-Z]+)/gi, "$1");

  return out;
}

export async function proxyRequest(req, res, query) {
  // Every proxied response carries a CSP sandbox: even if someone opens
  // /api/proxy directly in a browser tab, the returned document gets an opaque
  // origin and cannot touch this app's storage or cookies.
  const CSP = "sandbox allow-scripts allow-forms allow-popups";

  const sendJson = (status, obj) => {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "content-security-policy": CSP,
    });
    res.end(JSON.stringify(obj));
  };

  const target = query.get("url");
  // Form GET submissions rewrite their action to "?url=...", so any extra
  // query parameters the browser appends are forwarded to the destination.
  let targetUrl = target;
  const extras = [];
  for (const [k, v] of query.entries()) {
    if (k !== "url") extras.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
  }
  if (extras.length && targetUrl) {
    targetUrl += (targetUrl.includes("?") ? "&" : "?") + extras.join("&");
  }
  const parsed = await parseTarget(targetUrl);
  if (parsed.error) return sendJson(400, { error: parsed.error });

  const headersToForward = {};
  if (target && /^https:/i.test(parsed.url.href)) headersToForward["accept-language"] = "en-US,en;q=0.9";

  let body = null;
  if (req.method === "POST" || req.method === "PUT") {
    body = await readBody(req, 1024 * 1024);
  }

  let result;
  try {
    result = await Promise.race([
      fetchWithRedirectChecks(parsed.url, {
        method: req.method === "HEAD" ? "GET" : req.method,
        redirect: "manual",
        headers: headersToForward,
        body,
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("Request timed out")), REQUEST_TIMEOUT_MS)),
    ]);
  } catch (e) {
    return sendJson(502, { error: "Could not fetch that URL: " + (e && e.message ? e.message : "network error") });
  }

  const { res: upstream, finalUrl } = result;
  const contentType = (upstream.headers.get("content-type") || "").toLowerCase();

  try {
    // Read the full body (bounded by size + time) before deciding how to serve it.
    const buf = await Promise.race([
      upstream.arrayBuffer(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("Response body timed out")), REQUEST_TIMEOUT_MS)),
    ]);
    if (buf.byteLength > MAX_BYTES) return sendJson(413, { error: "Response too large" });

    if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
      const text = Buffer.from(buf).toString("utf8");
      const rewritten = rewriteHtml(text, finalUrl);
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-proxy-final-url": finalUrl.slice(0, 500),
        "content-security-policy": CSP,
      });
      res.end(rewritten);
      return;
    }

    // Everything else (images, css, js, json, ...): pass through as-is.
    res.writeHead(200, {
      "content-type": upstream.headers.get("content-type") || "application/octet-stream",
      "cache-control": "no-store",
      "x-proxy-final-url": finalUrl.slice(0, 500),
      "content-security-policy": CSP,
    });
    res.end(Buffer.from(buf));
  } catch (e) {
    sendJson(502, { error: "Failed to read response: " + (e && e.message) });
  }
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("Body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
