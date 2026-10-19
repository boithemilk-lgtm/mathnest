const $ = (id) => document.getElementById(id);
const token = () => { try { return localStorage.getItem("vault_token") || ""; } catch { return ""; } };
const savedName = () => { try { return localStorage.getItem("vault_username") || ""; } catch { return ""; } };
const AVATARS = ["🎮", "👾", "🚀", "🛸", "⭐", "🍕", "🍩", "🐱", "🦊", "🐸", "🦄", "🐙", "🤖", "👽", "🎃", "🎧", "🎸", "⚽", "🐉", "🧙"];
let profile = null;
let selectedAvatar = "🎮";
let aiMessages = [];
const esc = (s) => String(s ?? "");

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (token()) headers.Authorization = `Bearer ${token()}`;
  if (options.body) headers["Content-Type"] = "application/json";
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
function setMessage(el, text, error = false) {
  el.textContent = text;
  el.classList.toggle("error", error);
}
function switchView(name) {
  document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.view === name));
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === `view-${name}`));
  if (name === "community") loadFeed();
  if (name === "profile") loadProfile();
  if (name === "ai") { if (!token()) showAiHint("log in through the Vault first to use MathNest AI."); else showAiHint(""); }
}
document.querySelectorAll(".nav-item").forEach(b => b.addEventListener("click", () => switchView(b.dataset.view)));
document.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => switchView(b.dataset.go)));

const today = new Date();
$("todayLabel").textContent = today.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }).toUpperCase();
const username = savedName();
$("accountPill").textContent = username ? `signed in as ${username}` : "guest mode · log in via vault";
$("welcomeName").textContent = username ? `, ${username}` : ", explorer";

// Dashboard shortcuts are private to this browser, so users can customize them without an account.
const DEFAULT_SHORTCUTS = [
  { name: "The Vault", url: "vault.html", icon: "🎮" },
  { name: "Dungeon", url: "dungeon.html", icon: "🗡️" },
  { name: "MathNest home", url: "index.html", icon: "✳" },
];
function getShortcuts() {
  try { const list = JSON.parse(localStorage.getItem("mathnest_shortcuts") || "null"); return Array.isArray(list) ? list.slice(0, 12) : DEFAULT_SHORTCUTS; }
  catch { return DEFAULT_SHORTCUTS; }
}
function renderShortcuts() {
  const grid = $("shortcutGrid"); grid.replaceChildren();
  const items = getShortcuts();
  if (!items.length) { const p = document.createElement("p"); p.className = "empty-state"; p.textContent = "No shortcuts yet. Add one above."; grid.append(p); return; }
  items.forEach((item, i) => {
    const a = document.createElement("a"); a.className = "shortcut"; a.href = item.url;
    const icon = document.createElement("span"); icon.className = "shortcut-icon"; icon.textContent = item.icon || "↗";
    const info = document.createElement("span"); info.style.minWidth = "0";
    const name = document.createElement("b"); name.textContent = item.name;
    const url = document.createElement("small"); url.textContent = item.url;
    info.append(name, url); a.append(icon, info);
    if (i >= DEFAULT_SHORTCUTS.length) {
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "delete-post"; remove.textContent = "✕"; remove.title = "Remove shortcut";
      remove.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); const next = getShortcuts(); next.splice(i, 1); localStorage.setItem("mathnest_shortcuts", JSON.stringify(next)); renderShortcuts(); });
      a.append(remove);
    }
    grid.append(a);
  });
}
renderShortcuts();
$("addShortcut").addEventListener("click", () => $("shortcutDialog").showModal());
$("shortcutForm").addEventListener("submit", e => {
  if (e.submitter?.value === "cancel") return;
  e.preventDefault();
  const name = $("shortcutName").value.trim(); let url;
  try { url = new URL($("shortcutUrl").value.trim(), location.href); } catch { return; }
  if (!/^https?:$/.test(url.protocol)) return;
  const list = getShortcuts();
  if (list.length >= 12) { alert("You can save up to 12 shortcuts."); return; }
  list.push({ name: name.slice(0, 24), url: url.href, icon: "↗" });
  localStorage.setItem("mathnest_shortcuts", JSON.stringify(list));
  renderShortcuts(); $("shortcutDialog").close(); e.target.reset();
});

// Profile editor
function renderAvatarPicker() {
  const picker = $("avatarPicker"); picker.replaceChildren();
  AVATARS.forEach(avatar => {
    const b = document.createElement("button"); b.type = "button"; b.className = "avatar-option" + (avatar === selectedAvatar ? " selected" : ""); b.textContent = avatar; b.setAttribute("aria-label", `Choose ${avatar}`);
    b.addEventListener("click", () => { selectedAvatar = avatar; renderAvatarPicker(); updateProfilePreview(); }); picker.append(b);
  });
}
function updateProfilePreview() {
  const display = $("displayName").value.trim() || profile?.username || username || "guest explorer";
  $("previewAvatar").textContent = selectedAvatar;
  $("previewName").textContent = display;
  $("previewBio").textContent = $("bio").value.trim() || "no bio yet — add a little about yourself.";
  $("composerAvatar").textContent = selectedAvatar;
}
async function loadProfile() {
  if (!token()) { setMessage($("profileMessage"), "log in through the Vault first to edit your profile.", true); return; }
  try {
    const data = await api("/api/features/profile"); profile = data.profile;
    selectedAvatar = profile.avatar || "🎮";
    $("displayName").value = profile.displayName || profile.username;
    $("bio").value = profile.bio || "";
    $("bioCount").textContent = $("bio").value.length;
    $("dashProfile").textContent = profile.displayName || profile.username;
    renderAvatarPicker(); updateProfilePreview(); setMessage($("profileMessage"), "");
  } catch (e) { setMessage($("profileMessage"), e.message, true); }
}
$("displayName").addEventListener("input", updateProfilePreview);
$("bio").addEventListener("input", () => { $("bioCount").textContent = $("bio").value.length; updateProfilePreview(); });
$("profileForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (!token()) return setMessage($("profileMessage"), "log in through the Vault first.", true);
  const button = e.submitter; button.disabled = true; setMessage($("profileMessage"), "saving…");
  try {
    const data = await api("/api/features/profile", { method: "POST", body: JSON.stringify({ displayName: $("displayName").value, bio: $("bio").value, avatar: selectedAvatar }) });
    profile = data.profile; setMessage($("profileMessage"), "profile saved ✓"); $("accountPill").textContent = `signed in as ${profile.username}`; $("dashProfile").textContent = profile.displayName;
  } catch (err) { setMessage($("profileMessage"), err.message, true); }
  finally { button.disabled = false; }
});
renderAvatarPicker(); updateProfilePreview();

// Community feed
function formatTime(ts) {
  const date = new Date(ts); const delta = Math.max(0, Date.now() - date.getTime());
  if (delta < 60000) return "just now";
  if (delta < 3600000) return `${Math.floor(delta / 60000)}m ago`;
  if (delta < 86400000) return `${Math.floor(delta / 3600000)}h ago`;
  return date.toLocaleDateString();
}
function renderFeed(posts) {
  const feed = $("feed"); feed.replaceChildren();
  if (!posts.length) { const empty = document.createElement("div"); empty.className = "empty-state"; empty.textContent = "it's quiet in here. be the first to post something!"; feed.append(empty); return; }
  posts.forEach(post => {
    const article = document.createElement("article"); article.className = "post";
    const avatar = document.createElement("div"); avatar.className = "post-avatar"; avatar.textContent = post.avatar || "🎮";
    const main = document.createElement("div"); main.className = "post-body";
    const head = document.createElement("div"); head.className = "post-head";
    const name = document.createElement("b"); name.textContent = post.displayName || post.username;
    const handle = document.createElement("span"); handle.textContent = `@${post.username}`;
    const time = document.createElement("time"); time.textContent = formatTime(post.ts); time.dateTime = new Date(post.ts).toISOString();
    head.append(name, handle, time);
    if (username && (post.username?.toLowerCase() === username.toLowerCase() || localStorage.getItem("vault_role") === "admin")) {
      const del = document.createElement("button"); del.className = "delete-post"; del.textContent = "delete"; del.addEventListener("click", async () => {
        try { await api(`/api/features/community/${post.id}`, { method: "DELETE" }); loadFeed(); } catch (e) { setMessage($("feedMessage"), e.message, true); }
      }); head.append(del);
    }
    const text = document.createElement("p"); text.className = "post-text"; text.textContent = post.text;
    main.append(head, text); article.append(avatar, main); feed.append(article);
  });
}
async function loadFeed() {
  try { const data = await api("/api/features/community"); renderFeed(data.posts || []); }
  catch (e) { $("feed").textContent = e.message; }
}
$("refreshFeed").addEventListener("click", loadFeed);
$("postText").addEventListener("input", () => { $("postCount").textContent = `${$("postText").value.length}/280`; });
$("postForm").addEventListener("submit", async e => {
  e.preventDefault(); const text = $("postText").value.trim(); if (!text) return;
  if (!token()) return setMessage($("feedMessage"), "log in through the Vault before posting.", true);
  const button = e.submitter; button.disabled = true; setMessage($("feedMessage"), "posting…");
  try { await api("/api/features/community", { method: "POST", body: JSON.stringify({ text }) }); $("postText").value = ""; $("postCount").textContent = "0/280"; setMessage($("feedMessage"), "posted ✓"); await loadFeed(); }
  catch (err) { setMessage($("feedMessage"), err.message, true); }
  finally { button.disabled = false; }
});
loadFeed();

// AI chat
function showAiHint(text) { $("aiSetupNote").hidden = !text; $("aiSetupNote").textContent = text; }
function renderAiMessages() {
  const box = $("aiMessages"); box.replaceChildren();
  if (!aiMessages.length) {
    const welcome = document.createElement("div"); welcome.className = "ai-welcome";
    const spark = document.createElement("div"); spark.className = "welcome-spark"; spark.textContent = "✧";
    const h = document.createElement("h3"); h.textContent = "what are we working on?";
    const p = document.createElement("p"); p.textContent = "ask me to explain something, debug code, plan a project, or help you get unstuck.";
    const chips = document.createElement("div"); chips.className = "prompt-chips";
    [["💻 website ideas", "Help me plan a cool website project."], ["🧠 explain a topic", "Explain a difficult topic in simple steps."], ["🛠️ debug code", "Help me debug this code: "]].forEach(([label, prompt]) => { const b = document.createElement("button"); b.textContent = label; b.addEventListener("click", () => { $("aiInput").value = prompt; $("aiInput").focus(); }); chips.append(b); });
    welcome.append(spark, h, p, chips); box.append(welcome); return;
  }
  aiMessages.forEach(m => { const b = document.createElement("div"); b.className = `bubble ${m.role}${m.error ? " error" : ""}`; b.textContent = m.content; box.append(b); });
  box.scrollTop = box.scrollHeight;
}
document.querySelectorAll("[data-prompt]").forEach(b => b.addEventListener("click", () => { $("aiInput").value = b.dataset.prompt; $("aiInput").focus(); }));
$("clearAi").addEventListener("click", () => { aiMessages = []; showAiHint(""); renderAiMessages(); });
$("aiForm").addEventListener("submit", async e => {
  e.preventDefault(); const content = $("aiInput").value.trim(); if (!content) return;
  if (!token()) { showAiHint("log in through the Vault first to use MathNest AI."); return; }
  aiMessages.push({ role: "user", content }); $("aiInput").value = ""; renderAiMessages();
  const waiting = { role: "assistant", content: "thinking…", waiting: true }; aiMessages.push(waiting); renderAiMessages();
  const send = $("aiForm").querySelector("button"); send.disabled = true;
  try {
    const payload = aiMessages.filter(m => !m.waiting && !m.error).map(({ role, content }) => ({ role, content }));
    const data = await api("/api/features/ai", { method: "POST", body: JSON.stringify({ messages: payload }) });
    aiMessages.pop(); aiMessages.push({ role: "assistant", content: data.reply }); showAiHint("");
  } catch (err) {
    aiMessages.pop(); aiMessages.push({ role: "assistant", content: err.message, error: true });
    if (/OPENROUTER_API_KEY|isn't configured/i.test(err.message)) showAiHint("the AI provider isn't configured yet. add OPENROUTER_API_KEY to your Wasmer app's environment variables. the key stays on the server.");
  } finally { send.disabled = false; renderAiMessages(); }
});
renderAiMessages();
