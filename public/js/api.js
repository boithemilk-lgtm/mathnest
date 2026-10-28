// Shared client helpers: safe storage wrapper + API client.

// localStorage can be unavailable (sandboxed iframes / private mode),
// so wrap it and fall back to an in-memory map.
const memory = new Map();

export const store = {
  get(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      return memory.has(key) ? memory.get(key) : fallback;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      memory.set(key, value);
    }
  },
  remove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (e) {
      memory.delete(key);
    }
  },
};

export function getToken() {
  return store.get("vault_token", null);
}

export function setSession(token, username) {
  store.set("vault_token", token);
  store.set("vault_username", username);
}

export function clearSession() {
  store.remove("vault_token");
  store.remove("vault_username");
  store.remove("vault_role");
}

// Base URL for API calls. Empty for same-origin hosting; can be set to a
// full backend URL when the frontend is served from a different origin.
export const API_BASE = (typeof window !== "undefined" && window.VAULT_API_BASE) || "";

export async function apiFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getToken();
  if (token) headers["Authorization"] = "Bearer " + token;
  if (options.body && typeof options.body === "string") {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(API_BASE + path, { ...options, headers });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (!res.ok) {
    throw new Error((data && data.error) || "Request failed (" + res.status + ")");
  }
  return data;
}

// ---------- Auth ----------

export async function signup(username, password, avatar) {
  const data = await apiFetch("/api/signup", {
    method: "POST",
    body: JSON.stringify({ username, password, avatar }),
  });
  setSession(data.token, data.username);
  store.set("vault_role", data.role || "user");
  return data;
}

export async function login(username, password) {
  const data = await apiFetch("/api/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  setSession(data.token, data.username);
  store.set("vault_role", data.role || "user");
  return data;
}

export async function logout() {
  try { await apiFetch("/api/logout", { method: "POST" }); } catch (e) { /* ignore */ }
  clearSession();
}

export async function me() {
  if (!getToken()) return null;
  try {
    return await apiFetch("/api/me");
  } catch (e) {
    return null;
  }
}

// ---------- Chat ----------

export async function getMessages(afterId) {
  return apiFetch("/api/messages?after=" + encodeURIComponent(afterId || 0));
}

export async function postMessage(text) {
  return apiFetch("/api/messages", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

// ---------- Reactions / moderation / typing ----------

export async function reactToMessage(id, emoji) {
  return apiFetch(`/api/messages/${id}/react`, {
    method: "POST",
    body: JSON.stringify({ emoji }),
  });
}

export async function deleteMessage(id) {
  return apiFetch(`/api/messages/${id}`, { method: "DELETE" });
}

export async function setTyping() {
  return apiFetch("/api/typing", { method: "POST" });
}

// ---------- DMs ----------

export async function sendDM(to, text) {
  const result = await apiFetch("/api/features/dms", {
    method: "POST",
    body: JSON.stringify({ to, text }),
  });
  window.dispatchEvent(new Event("nexus:dm-updated"));
  return { message: result.message };
}

export async function getDMs(withUser, afterId) {
  return apiFetch(`/api/features/dms?with=${encodeURIComponent(withUser)}&after=${encodeURIComponent(afterId || 0)}`);
}

// ---------- Leaderboard / achievements ----------

export async function getLeaderboard() {
  return apiFetch("/api/leaderboard");
}

export async function submitScore(game, score) {
  return apiFetch("/api/scores", {
    method: "POST",
    body: JSON.stringify({ game, score }),
  });
}

export async function getAchievements() {
  return apiFetch("/api/achievements");
}

export async function awardAchievement(id) {
  return apiFetch("/api/achievements", {
    method: "POST",
    body: JSON.stringify({ id }),
  });
}
