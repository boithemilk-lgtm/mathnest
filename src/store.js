// JSON-file data store on a persistent volume.
//
// On Wasmer Edge, app.yaml mounts a persistent volume at /data — all
// accounts, sessions and chat messages live in /data/db.json and survive
// restarts and redeploys. Locally (npm start), it falls back to ./local-data.
//
// Edge apps can scale to several instances, so every read re-checks the
// file's mtime and reloads when another instance has written. Writes are
// atomic (temp file + rename) to avoid torn reads.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");

function pickDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  try {
    fs.statSync("/data");
    return "/data";
  } catch (e) {
    return path.join(rootDir, "local-data");
  }
}

const DATA_DIR = pickDataDir();
const DB_FILE = path.join(DATA_DIR, "db.json");

function emptyDb() {
  return {
    users: {},        // username -> { salt, hash, created }
    sessions: {},     // token   -> { user, expires }
    messages: [],     // { id, user, text, ts }
    nextId: 1,
    presence: {},     // username -> last seen (ms epoch)
  };
}

let cache = null;
let cachedMtime = 0;

// Cross-process lock. Edge apps can run several instances against the same
// volume, so every read-modify-write mutation runs inside this lock to avoid
// lost updates. The lock FAILS CLOSED: if it cannot be acquired, the mutation
// is refused with a busy error — a writer never proceeds without the lock.
// A lock left behind by a crashed holder is NEVER deleted automatically: no
// age or PID heuristic can prove a lock is dead across every node that shares
// the volume. Recovery: stop all instances, delete <data>/db.json.lock.
const LOCK_FILE = DB_FILE + ".lock";
const LOCK_WAIT_MS = 5000;

export function withLock(fn) {
  // The data directory must exist before the lock file can be created.
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}
  let acquired = false;
  const start = Date.now();
  while (Date.now() - start < LOCK_WAIT_MS) {
    try {
      const fd = fs.openSync(LOCK_FILE, "wx");
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, ts: Date.now() }));
      fs.closeSync(fd);
      acquired = true;
      break;
    } catch (e) {
      // Someone else holds it — wait. Never break or delete it.
      const until = Date.now() + 3 + Math.floor(Math.random() * 8);
      while (Date.now() < until) { /* brief spin */ }
    }
  }
  if (!acquired) {
    return { error: 503, message: "Server is busy — try again in a moment" };
  }
  // Always re-read from disk inside the lock: mtime-based cache checks can
  // miss a write that landed in the same clock tick on coarse-granularity
  // filesystems (tmpfs, some volume mounts).
  cache = null;
  try {
    return fn();
  } finally {
    try { fs.unlinkSync(LOCK_FILE); } catch (_) {}
  }
}

export function getDb() {
  // Read-only: this NEVER writes. If the file is missing, an in-memory empty
  // db is returned and the first locked mutation persists it. If the file is
  // corrupt or unreadable, this THROWS — a broken database is never silently
  // replaced with an empty one.
  try {
    const st = fs.statSync(DB_FILE);
    if (!cache || st.mtimeMs !== cachedMtime) {
      cache = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
      cachedMtime = st.mtimeMs;
    }
    return cache;
  } catch (e) {
    if (e && e.code === "ENOENT") {
      cache = emptyDb();
      cachedMtime = 0;
      return cache;
    }
    cache = null;
    throw new Error("Database file is unreadable: " + (e && e.message ? e.message : e));
  }
}

export function saveDb(db) {
  const tmp = DB_FILE + ".tmp." + Date.now() + "." + Math.floor(Math.random() * 1e6);
  fs.writeFileSync(tmp, JSON.stringify(db), "utf8");
  fs.renameSync(tmp, DB_FILE);
  cache = db;
  try { cachedMtime = fs.statSync(DB_FILE).mtimeMs; } catch (_) {}
}
