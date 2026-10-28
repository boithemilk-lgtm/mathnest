import { apiFetch, getToken, store, logout, me } from "./api.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const authGate = $("#authGate");
const authSlot = $("#authGateSlot");
const authCard = $("#chatLoggedOut .auth-card");
const dock = $("#arcadeDock");
const dockTrigger = $("#dockTrigger");
const profileDrawer = $("#profileDrawer");
let savedProgress = { gamesPlayed: {}, bestScores: {}, recentGames: [], favoriteGames: [] };
let progressBusy = false;

// Reuse the original account form so the established signup/login API remains
// the single source of truth. Only its location changes; password handling does not.
if (authCard && authSlot) authSlot.appendChild(authCard);

function isLoggedIn() {
  return !!(getToken() && store.get("vault_username", null));
}

function syncGate() {
  const loggedIn = isLoggedIn();
  const introActive = document.body.classList.contains("nexus-intro-active");
  authGate.hidden = loggedIn || introActive;
  document.body.classList.toggle("arcade-locked", !loggedIn);
  if (loggedIn) {
    loadProgress();
    loadProfile();
  }
}

function setPanel(name) {
  if (name === "profile" && !$(`.panel[data-panel="profile"]`)) {
    profileDrawer.hidden = false;
    dock.classList.remove("is-open");
    dockTrigger.setAttribute("aria-expanded", "false");
    loadProfile();
    return;
  }
  const target = $(`.panel[data-panel="${CSS.escape(name)}"]`);
  if (!target) return;
  const legacyTab = $(`.tab[data-tab="${CSS.escape(name)}"]`);
  if (legacyTab) {
    // Reuse the existing section behavior (chat polling, leaderboard, trophies).
    legacyTab.click();
  } else {
    $$(".panel").forEach((panel) => panel.classList.toggle("is-active", panel === target));
    $$(".tab[data-tab]").forEach((tab) => {
      tab.classList.remove("is-active");
      tab.setAttribute("aria-selected", "false");
    });
  }
  $$(".dock-item[data-dock]").forEach((item) => item.classList.toggle("is-active", item.dataset.dock === name));
  dock.classList.remove("is-open");
  dockTrigger.setAttribute("aria-expanded", "false");
  if (name === "games") window.dispatchEvent(new Event("vault:showgames"));
  if (name === "chat" || name === "dms") window.dispatchEvent(new Event("vault:showchat"));
  if (name === "dms") window.dispatchEvent(new Event("vault:showdms"));
  if (name === "extras") window.dispatchEvent(new Event("vault:showextras"));
  if (name === "suggestions") loadSuggestions();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// Floating controller navigation. Hover opens it on desktop; click works on mobile.
dockTrigger.addEventListener("click", (event) => {
  event.stopPropagation();
  const open = dock.classList.toggle("is-open");
  dockTrigger.setAttribute("aria-expanded", String(open));
});
dock.addEventListener("click", (event) => {
  const item = event.target.closest("[data-dock]");
  if (!item) return;
  setPanel(item.dataset.dock);
});
document.addEventListener("click", (event) => {
  if (!dock.contains(event.target)) {
    dock.classList.remove("is-open");
    dockTrigger.setAttribute("aria-expanded", "false");
  }
});
$$("[data-go]").forEach((button) => button.addEventListener("click", () => setPanel(button.dataset.go)));

// Featured tiles launch existing games rather than duplicating their code.
$$('[data-launch-game="dungeon"]').forEach((button) => button.addEventListener("click", () => {
  if (!isLoggedIn()) return;
  recordProgress({ event: "played", game: "dungeon" }).finally(() => { window.location.href = "dungeon.html"; });
}));
$$('[data-launch-game]:not([data-launch-game="dungeon"])').forEach((button) => button.addEventListener("click", () => {
  const id = button.dataset.launchGame;
  const card = $(`[data-game-id="${CSS.escape(id)}"]`);
  if (card) card.click(); else setPanel("games");
}));

// The topbar account chip doubles as a quick way to open the player card.
const userChip = $("#userChip");
if (userChip) {
  userChip.title = "Open player profile";
  userChip.style.cursor = "pointer";
  userChip.addEventListener("click", () => setPanel("profile"));
}
$("#profileClose").addEventListener("click", () => { profileDrawer.hidden = true; });
profileDrawer.addEventListener("click", (event) => { if (event.target === profileDrawer) profileDrawer.hidden = true; });
async function loadProfile() {
  if (!isLoggedIn()) return;
  try {
    const data = await apiFetch("/api/features/profile");
    const p = data.profile || {};
    $("#profileAvatar").textContent = p.avatar || "🎮";
    $("#profileName").textContent = p.displayName || p.username || store.get("vault_username", "Player");
    $("#profileBio").textContent = p.bio || "Your Nexus player card";
  } catch {
    $("#profileName").textContent = store.get("vault_username", "Player");
  }
  updateStats();
}

$("#profileLogout").addEventListener("click", async () => {
  profileDrawer.hidden = true;
  await logout();
  window.location.reload();
});

function countGamesPlayed() {
  return Object.values(savedProgress.gamesPlayed || {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
}
function topScore() {
  return Math.max(0, ...Object.values(savedProgress.bestScores || {}).map((n) => Number(n) || 0));
}
function achievementCount() {
  return Number(store.get("vault_achievement_count", 0)) || 0;
}
function updateStats() {
  $("#statGamesPlayed").textContent = String(countGamesPlayed());
  $("#statAchievements").textContent = String(achievementCount());
  $("#statBestScore").textContent = topScore() ? String(topScore()) : "—";
  $("#profilePlayed").textContent = String(countGamesPlayed());
  $("#profileTrophies").textContent = String(achievementCount());
}

async function loadProgress() {
  if (!isLoggedIn() || progressBusy) return;
  progressBusy = true;
  try {
    const data = await apiFetch("/api/features/progress");
    savedProgress = data.progress || savedProgress;
    if (typeof window.vaultApplyProgress === "function") window.vaultApplyProgress(savedProgress);
    try {
      const trophies = await apiFetch("/api/achievements");
      store.set("vault_achievement_count", (trophies.achievements || []).length);
    } catch { /* achievements are optional for older deployments */ }
    updateStats();
  } catch (error) {
    // A visible UI should still work if the progress API is not deployed yet.
    console.warn("Could not load account progress:", error.message);
  } finally {
    progressBusy = false;
  }
}

async function recordProgress(payload) {
  if (!isLoggedIn()) return;
  try {
    const data = await apiFetch("/api/features/progress", { method: "POST", body: JSON.stringify(payload) });
    if (data.progress) savedProgress = data.progress;
    if (typeof window.vaultApplyProgress === "function") window.vaultApplyProgress(savedProgress);
    updateStats();
  } catch (error) {
    console.warn("Could not save account progress:", error.message);
  }
}

window.addEventListener("vault:gameopen", (event) => {
  const game = event.detail?.game;
  if (game) recordProgress({ event: "played", game });
});
window.addEventListener("vault:gameover", (event) => {
  const { game, score } = event.detail || {};
  if (game) recordProgress({ event: "score", game, score: Number(score) || 0 });
});
window.addEventListener("vault:authchange", syncGate);
window.addEventListener("nexus:introfinished", syncGate);
window.addEventListener("vault:statschange", updateStats);

// Suggestions are server-stored and associated with the signed-in username.
const suggestionForm = $("#suggestionForm");
const suggestionStatus = $("#suggestionStatus");
const suggestionsFeed = $("#suggestionsFeed");
function renderSuggestions(items) {
  suggestionsFeed.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No suggestions yet. Be the first to share an idea.";
    suggestionsFeed.appendChild(empty);
    return;
  }
  for (const item of items) {
    const article = document.createElement("article");
    article.className = "suggestion-post";
    const title = document.createElement("h3");
    title.textContent = item.title || "Untitled idea";
    const text = document.createElement("p");
    text.textContent = item.text || "";
    const meta = document.createElement("div");
    meta.className = "suggestion-meta";
    const author = document.createElement("span");
    author.textContent = `${item.avatar || "🎮"} ${item.username || "player"}`;
    const date = document.createElement("time");
    date.textContent = item.ts ? new Date(item.ts).toLocaleDateString() : "just now";
    meta.append(author, date);
    article.append(title, text, meta);
    suggestionsFeed.appendChild(article);
  }
}
async function loadSuggestions() {
  try {
    const data = await apiFetch("/api/features/suggestions");
    renderSuggestions(data.suggestions || []);
  } catch (error) {
    suggestionsFeed.textContent = error.message || "Could not load suggestions.";
  }
}
suggestionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!isLoggedIn()) return;
  const title = $("#suggestionTitle").value.trim();
  const text = $("#suggestionText").value.trim();
  if (!title || !text) return;
  const submit = suggestionForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  suggestionStatus.textContent = "Sending your idea…";
  try {
    await apiFetch("/api/features/suggestions", { method: "POST", body: JSON.stringify({ title, text }) });
    suggestionForm.reset();
    suggestionStatus.textContent = "Suggestion sent — thanks for helping shape MathNest!";
    await loadSuggestions();
  } catch (error) {
    suggestionStatus.textContent = error.message || "Could not send the suggestion.";
  } finally {
    submit.disabled = false;
  }
});

// Start locked unless a valid session is present. The existing vault module emits
// authchange after it validates a token and after signup/login/logout.
syncGate();
me().then((user) => {
  if (!user) {
    // Let vault.js perform its normal cleanup; the gate remains visible.
    authGate.hidden = document.body.classList.contains("nexus-intro-active");
  } else {
    authGate.hidden = true;
    loadProgress();
    loadProfile();
  }
});
loadSuggestions();
