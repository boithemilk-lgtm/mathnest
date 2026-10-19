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
const require = createRequire(import.meta.url);

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB cap per response
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 12000;

const PRIVATE_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]", "metadata.google.internal"]);

function isPrivateHost(hostname) {
  const h = String(hostname || "").toLowerCase();
  if (PRIVATE_HOSTS.has(h)) return true;
  if (h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".localhost")) return true;
  const parts = h.split(".");
  if (parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p))) {
    const [a, b] = parts.map(Number);
    if (a === 10 || a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
  }
  return false;
}

export function parseTarget(rawUrl) {
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
  return { url: u };
}

async function fetchWithRedirectChecks(u, init) {
  let current = u;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const check = parseTarget(current.href);
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

function proxiedUrl(absoluteUrl, origin) {
  // Origin-absolute (not path-absolute): the page keeps a <base> tag pointing
  // at the destination, so a plain "/api/proxy?..." href would wrongly resolve
  // against the destination host. Building the full origin fixes that.
  return origin + "/api/proxy?url=" + encodeURIComponent(absoluteUrl);
}

export function rewriteHtml(html, baseUrl, origin) {
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

  // 1. Drop any existing <base> tags — they would break relative resolution.
  out = out.replace(/<base\b[^>]*>/gi, "");

  // 2. Rewrite links + forms + iframes so navigation stays inside the proxy.
  //    (Done BEFORE injecting our <base> so the base tag itself is untouched.)
  out = out.replace(/<a\b([^>]*)>/gi, (m, attrs) => {
    const hrefMatch = attrs.match(/\shref\s*=\s*("([^"]*)"|'([^']*)')/i);
    if (!hrefMatch) return m;
    const val = hrefMatch[2] !== undefined ? hrefMatch[2] : hrefMatch[3];
    if (/^(#|javascript:|mailto:|tel:|data:)/i.test(val.trim())) return m;
    const abs = resolve(val);
    if (!abs) return m;
    const newAttrs = attrs.replace(hrefMatch[0], ` href="${proxiedUrl(abs, origin)}"`);
    return `<a${newAttrs}>`;
  });

  out = out.replace(/\saction\s*=\s*("([^"]*)"|'([^']*)')/gi, (m, _q, dq, sq) => {
    const val = dq !== undefined ? dq : sq;
    const abs = resolve(val);
    if (!abs) return m;
    const quote = dq !== undefined ? '"' : "'";
    return ` action=${quote}${proxiedUrl(abs, origin)}${quote}`;
  });

  out = out.replace(/<iframe([^>]*)>/gi, (m, attrs) => {
    const srcMatch = attrs.match(/\ssrc\s*=\s*("([^"]*)"|'([^']*)')/i);
    if (!srcMatch) return m;
    const val = srcMatch[2] !== undefined ? srcMatch[2] : srcMatch[3];
    const abs = resolve(val);
    if (!abs) return m;
    return `<iframe${attrs.replace(srcMatch[0], ` src="${proxiedUrl(abs, origin)}"`)}>`;
  });

  // 3. Neutralize frame-busting / X-Frame issues are handled by headers; also
  //    drop `target="_blank"` on rewritten anchors so links open in place.
  out = out.replace(/(<a\b[^>]*?)\starget\s*=\s*("[^"]*"|'[^']*'|_[a-zA-Z]+)/gi, "$1");

  // 4. Inject <base> so relative assets (img/script/css) load directly from source.
  const baseTag = `<base href="${base.href}">`;
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, (m) => m + baseTag);
  } else if (/<html[^>]*>/i.test(out)) {
    out = out.replace(/<html([^>]*)>/i, (m) => m + "<head>" + baseTag + "</head>");
  } else {
    out = baseTag + out;
  }

  return out;
}

export async function proxyRequest(req, res, query) {
  // The origin this proxy was reached through — used to build absolute links
  // back into the proxy (they must survive the destination <base> tag).
  const fwdProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const fwdHost = String(req.headers["x-forwarded-host"] || req.headers.host || "");
  const origin = (fwdProto || "http") + "://" + fwdHost;
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
  const parsed = parseTarget(target);
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
    if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
      const text = await upstream.text();
      const rewritten = rewriteHtml(text, finalUrl, origin);
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
    const buf = await upstream.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return sendJson(413, { error: "Response too large" });
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
