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

export function getDb() {
  try {
    const st = fs.statSync(DB_FILE);
    if (!cache || st.mtimeMs !== cachedMtime) {
      cache = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
      cachedMtime = st.mtimeMs;
    }
    return cache;
  } catch (e) {
    // First boot: create the directory and a fresh database.
    cache = emptyDb();
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}
    saveDb(cache);
    return cache;
  }
}

export function saveDb(db) {
  const tmp = DB_FILE + ".tmp." + Date.now() + "." + Math.floor(Math.random() * 1e6);
  fs.writeFileSync(tmp, JSON.stringify(db), "utf8");
  fs.renameSync(tmp, DB_FILE);
  cache = db;
  try { cachedMtime = fs.statSync(DB_FILE).mtimeMs; } catch (_) {}
}
