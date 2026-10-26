// NEXUS — app shell: tabs, games, chat, DMs, proxy, extras.

import {
  store, getToken, signup, login, logout, me, getMessages, postMessage,
  reactToMessage, deleteMessage, setTyping, sendDM, getDMs,
  getLeaderboard, submitScore, getAchievements, awardAchievement, API_BASE,
} from "./api.js";
import Snake from "./games/snake.js";
import G2048 from "./games/g2048.js";
import Breakout from "./games/breakout.js";
import Flappy from "./games/flappy.js";
import Pong from "./games/pong.js";
import Tetris from "./games/tetris.js";

// ---------- Sound (procedural, WebAudio) ----------

const sfx = (() => {
  let ctx = null;
  const ensure = () => {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* no audio */ }
    }
    if (ctx && ctx.state === "suspended") ctx.resume();
    return ctx;
  };
  return {
    blip(freq = 440, dur = 0.06) {
      const c = ensure();
      if (!c) return;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.12, c.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
      osc.connect(gain).connect(c.destination);
      osc.start();
      osc.stop(c.currentTime + dur);
    },
    buzz() {
      const c = ensure();
      if (!c) return;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(180, c.currentTime);
      osc.frequency.exponentialRampToValueAtTime(50, c.currentTime + 0.35);
      gain.gain.setValueAtTime(0.15, c.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.4);
      osc.connect(gain).connect(c.destination);
      osc.start();
      osc.stop(c.currentTime + 0.4);
    },
    fanfare() {
      const c = ensure();
      if (!c) return;
      [523, 659, 784, 1047].forEach((f, i) => {
        setTimeout(() => sfx.blip(f, 0.12), i * 110);
      });
    },
  };
})();
window.vaultSfx = sfx;
window.vaultStore = store; // games use this for small persistent counters (avatar-picked storage backend)
document.addEventListener("pointerdown", () => { try { sfx.blip(0.001, 0.01); } catch (e) {} }, { once: true });

// ---------- Themes ----------

const THEMES = [
  { id: "neon", name: "Neon Night", icon: "🟣" },
  { id: "midnight", name: "Midnight Blue", icon: "🔵" },
  { id: "matrix", name: "Matrix", icon: "🟩" },
];
let themeIdx = Math.max(0, THEMES.findIndex((t) => t.id === store.get("vault_theme", "neon")));
function applyTheme() {
  const t = THEMES[themeIdx];
  document.documentElement.setAttribute("data-theme", t.id);
  store.set("vault_theme", t.id);
}
applyTheme();
document.getElementById("themeBtn").addEventListener("click", () => {
  themeIdx = (themeIdx + 1) % THEMES.length;
  applyTheme();
  sfx.blip(600 + themeIdx * 120, 0.05);
});

// ---------- Tabs ----------

const tabs = [...document.querySelectorAll(".tab")];
const panels = [...document.querySelectorAll(".panel")];

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => { t.classList.toggle("is-active", t === tab); t.setAttribute("aria-selected", t === tab ? "true" : "false"); });
    panels.forEach((p) => p.classList.toggle("is-active", p.dataset.panel === tab.dataset.tab));
    if (tab.dataset.tab === "chat") startChatIfLoggedIn();
    if (tab.dataset.tab === "extras") refreshTrophies();
    if (tab.dataset.tab === "games") refreshLeaderboard();
  });
});

// ---------- Achievement toast ----------

const achToast = document.getElementById("achToast");
const achToastEmoji = document.getElementById("achToastEmoji");
const achToastName = document.getElementById("achToastName");
let toastTimer = null;

const ACH_CATALOG = {
  first_words: { emoji: "🗣️", name: "Breaking the Ice" },
  chatterbox: { emoji: "💬", name: "Certified Procrastinator" },
  pen_pal: { emoji: "✉️", name: "Pen Pal" },
  night_owl: { emoji: "🦉", name: "Night Shift" },
  flappy50: { emoji: "🐤", name: "Fifty Falls" },
  tile2048: { emoji: "🔢", name: "The Number" },
  brickmaster: { emoji: "🧱", name: "Bricklayer's Union" },
  snakelord: { emoji: "🐍", name: "Snake Lord" },
  pongchamp: { emoji: "🏓", name: "Machine Slayer" },
  blockfall10: { emoji: "🧩", name: "Tetromancer" },
};

function showAchievementToast(meta) {
  achToastEmoji.textContent = meta.emoji || "🏆";
  achToastName.textContent = meta.name || meta.id;
  achToast.hidden = false;
  achToast.classList.add("show");
  sfx.fanfare();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    achToast.classList.remove("show");
    setTimeout(() => { achToast.hidden = true; }, 400);
  }, 4200);
}

// Game/feature hooks used by games and server responses. Only shows a toast
// the first time the server records an achievement.
window.vaultAward = async (id) => {
  if (!getToken()) return;
  try {
    const res = await awardAchievement(id);
    if (res && res.isNew && res.achievement) showAchievementToast(res.achievement);
  } catch (e) { /* offline / not logged in: achievements are best-effort */ }
};

window.vaultSubmitScore = async (game, score) => {
  if (!getToken() || !Number.isFinite(score) || score <= 0) return;
  try {
    await submitScore(game, score);
    refreshLeaderboard();
  } catch (e) { /* best-effort */ }
};

// ---------- Games ----------

const GAMES = [
  { id: "snake", name: "Neon Snake", emoji: "🐍", file: Snake, help: "Arrows or WASD to steer · eat the orange dots · don't hit yourself or the walls · swipe on mobile", best: 0 },
  { id: "2048", name: "2048", emoji: "🔢", file: G2048, help: "Arrows or swipe to merge tiles · reach 2048 (or as high as you can)", best: 0 },
  { id: "breakout", name: "Brick Breaker", emoji: "🧱", file: Breakout, help: "Move with mouse or arrow keys · clear every brick · 3 lives", best: 0 },
  { id: "flappy", name: "Flappy One", emoji: "🐤", file: Flappy, help: "Click, tap or press SPACE to flap · thread the pipes", best: 0 },
  { id: "pong", name: "Pong vs Machine", emoji: "🏓", file: Pong, help: "Mouse or arrow keys · first to 7 wins", best: 0 },
  { id: "tetris", name: "Blockfall", emoji: "🧩", file: Tetris, help: "Arrows to move/rotate · SPACE to hard-drop · clear lines to level up", best: 0 },
];

// load best scores
for (const g of GAMES) g.best = store.get("vault_best_" + g.id, 0);

const gameGrid = document.getElementById("gameGrid");
for (const g of GAMES) {
  const card = document.createElement("button");
  card.className = "game-card";
  card.style.setProperty("--card-glow", "rgba(98,232,140,0.07)");
  card.type = "button";
  card.dataset.gameId = g.id;
  const thumb = document.createElement("div");
  thumb.className = "game-thumb";
  thumb.textContent = g.emoji;
  const h3 = document.createElement("h3");
  h3.textContent = g.name;
  const best = document.createElement("span");
  best.className = "game-best";
  best.textContent = "best " + g.best;
  h3.appendChild(best);
  const p = document.createElement("p");
  p.textContent = { snake: "Classic snake with a neon coat. One wrong turn and it's over.", 2048: "Merge matching tiles. Simple rules, endless regret.", breakout: "Bounce, smash, repeat. The bricks never stood a chance.", flappy: "One button. Infinite frustration. You've been warned.", pong: "The original rivalry: you versus a machine that barely misses.", tetris: "The falling-block legend. Rotate fast, think faster." }[g.id];
  card.append(thumb, h3, p);
  card.addEventListener("click", () => openGame(g));
  g.cardEl = card;
  g.bestEl = best;
  gameGrid.appendChild(card);
}

// ---------- Leaderboard ----------

const leaderboardGrid = document.getElementById("leaderboardGrid");
const GAME_NAMES = Object.fromEntries(GAMES.map((g) => [g.id, g.name]));

async function refreshLeaderboard() {
  try {
    const data = await getLeaderboard();
    const games = (data && data.games) || {};
    leaderboardGrid.innerHTML = "";
    let any = false;
    for (const g of GAMES) {
      const list = games[g.id] || [];
      const col = document.createElement("div");
      col.className = "lb-col";
      const h4 = document.createElement("h4");
      h4.textContent = g.emoji + " " + g.name;
      col.appendChild(h4);
      const ol = document.createElement("ol");
      ol.className = "lb-list";
      if (!list.length) {
        const li = document.createElement("li");
        li.className = "lb-empty";
        li.textContent = "No scores yet — be the first";
        ol.appendChild(li);
      } else {
        any = true;
        for (const s of list) {
          const li = document.createElement("li");
          const who = document.createElement("span");
          who.textContent = s.user;
          const sc = document.createElement("strong");
          sc.textContent = String(s.score);
          li.append(who, sc);
          ol.appendChild(li);
        }
      }
      col.appendChild(ol);
      leaderboardGrid.appendChild(col);
    }
  } catch (e) { /* not logged in / offline: board is public but keep it silent */ }
}

// ---------- Game modal ----------

const modal = document.getElementById("gameModal");
const canvas = document.getElementById("gameCanvas");
const scoreEl = document.getElementById("gameScore");
const bestEl = document.getElementById("gameBest");
const titleEl = document.getElementById("gameTitle");
const helpEl = document.getElementById("gameHelp");

let currentGame = null;
let currentMeta = null;

function openGame(meta) {
  currentMeta = meta;
  window.dispatchEvent(new CustomEvent("vault:gameopen", { detail: { game: meta.id } }));
  titleEl.textContent = meta.name;
  helpEl.textContent = meta.help;
  scoreEl.textContent = "0";
  bestEl.textContent = String(meta.best);
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  startGame(meta);
  canvas.focus?.();
}

function startGame(meta) {
  if (currentGame) { currentGame.destroy(); currentGame = null; }
  currentGame = new meta.file(canvas, {
    onScore(score) {
      scoreEl.textContent = String(score);
      if (score > meta.best) {
        meta.best = score;
        bestEl.textContent = String(score);
        store.set("vault_best_" + meta.id, score);
        if (meta.bestEl) meta.bestEl.textContent = "best " + score;
      }
    },
    onGameOver(finalScore) {
      sfx.buzz();
      window.dispatchEvent(new CustomEvent("vault:gameover", { detail: { game: meta.id, score: Number(finalScore) || 0, best: Number(meta.best) || 0 } }));
      if (finalScore >= meta.best) {
        meta.best = finalScore;
        store.set("vault_best_" + meta.id, finalScore);
        if (meta.bestEl) meta.bestEl.textContent = "best " + finalScore;
      }
      // global leaderboard submission
      window.vaultSubmitScore?.(meta.id, finalScore);
    },
  });
  window.vaultCurrentGame = currentGame; // debug/testing hook (client-side games are inherently cheatable)
}

function closeGame() {
  if (currentGame) { currentGame.destroy(); currentGame = null; }
  modal.hidden = true;
  document.body.style.overflow = "";
}

document.getElementById("gameClose").addEventListener("click", closeGame);
document.getElementById("gameRestart").addEventListener("click", () => { if (currentMeta) startGame(currentMeta); });
modal.addEventListener("click", (e) => { if (e.target === modal) closeGame(); });

// ---------- Auth UI ----------

const userChip = document.getElementById("userChip");
const chatLoggedOut = document.getElementById("chatLoggedOut");
const chatLoggedIn = document.getElementById("chatLoggedIn");
const authForm = document.getElementById("authForm");
const authError = document.getElementById("authError");
const authUser = document.getElementById("authUser");
const authPass = document.getElementById("authPass");
const authSubmit = document.getElementById("authSubmit");
const authTabs = [...document.querySelectorAll(".auth-tab")];
const avatarGrid = document.getElementById("avatarGrid");
const adminCard = document.getElementById("adminCard");
let authMode = "signup";
let pickedAvatar = "🎮";

// avatar picker
const AVATAR_CHOICES = ["🎮", "👾", "🚀", "🛸", "⭐", "🍕", "🍩", "🐱", "🦊", "🐸", "🦄", "🐙", "🤖", "👽", "🎃", "🎧", "🎸", "⚽", "🐉", "🧙"];
for (const a of AVATAR_CHOICES) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "avatar-pick" + (a === pickedAvatar ? " is-active" : "");
  btn.textContent = a;
  btn.setAttribute("aria-label", "Avatar " + a);
  btn.addEventListener("click", () => {
    pickedAvatar = a;
    [...avatarGrid.children].forEach((c) => c.classList.toggle("is-active", c === btn));
    sfx.blip(500, 0.04);
  });
  avatarGrid.appendChild(btn);
}

authTabs.forEach((t) => {
  t.addEventListener("click", () => {
    authMode = t.dataset.auth;
    authTabs.forEach((x) => x.classList.toggle("is-active", x === t));
    authSubmit.textContent = authMode === "signup" ? "Sign up" : "Log in";
    authError.textContent = "";
    // avatar picker only matters for signup
    avatarGrid.closest(".field").style.display = authMode === "signup" ? "" : "none";
  });
});

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  authSubmit.disabled = true;
  authError.textContent = "";
  try {
    if (authMode === "signup") await signup(authUser.value.trim(), authPass.value, pickedAvatar);
    else await login(authUser.value.trim(), authPass.value);
    authForm.reset();
    refreshAuthUI();
  } catch (err) {
    authError.textContent = err.message;
  } finally {
    authSubmit.disabled = false;
  }
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await logout();
  stopChat();
  refreshAuthUI();
});

function refreshAuthUI() {
  const username = store.get("vault_username", null);
  if (username && getToken()) {
    userChip.hidden = false;
    userChip.innerHTML = "";
    const dot = document.createElement("span");
    dot.className = "dot";
    userChip.append(dot, document.createTextNode(username));
    chatLoggedOut.hidden = true;
    chatLoggedIn.hidden = false;
    adminCard.hidden = store.get("vault_role", "user") !== "admin";
    startChatIfLoggedIn();
  } else {
    userChip.hidden = true;
    chatLoggedOut.hidden = false;
    chatLoggedIn.hidden = true;
    adminCard.hidden = true;
    stopChat();
  }
  window.dispatchEvent(new CustomEvent("vault:authchange", { detail: { loggedIn: !!(username && getToken()), username: username || null } }));
}

window.vaultApplyProgress = (progress) => {
  const bestScores = progress && progress.bestScores && typeof progress.bestScores === "object" ? progress.bestScores : {};
  for (const game of GAMES) {
    const saved = Number(bestScores[game.id] || 0);
    if (saved > game.best) game.best = saved;
    store.set("vault_best_" + game.id, game.best);
    if (game.bestEl) game.bestEl.textContent = "best " + game.best;
  }
};

// verify token on load
me().then((res) => {
  if (!res) { store.remove("vault_token"); store.remove("vault_username"); store.remove("vault_role"); }
  else if (res.role) store.set("vault_role", res.role);
  refreshAuthUI();
});

// ---------- Admin backup ----------

document.getElementById("backupBtn").addEventListener("click", () => {
  const a = document.createElement("a");
  a.href = API_BASE + "/api/backup";
  a.download = "mathnest-backup.json";
  // Bearer token can't go in a plain link — open via fetch and blob instead.
  fetch(API_BASE + "/api/backup", { headers: { Authorization: "Bearer " + getToken() } })
    .then((r) => {
      if (!r.ok) throw new Error("Backup failed (" + r.status + ")");
      return r.blob();
    })
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.click();
      URL.revokeObjectURL(url);
    })
    .catch((err) => alert(err.message));
});

// ---------- Chat ----------

const messagesEl = document.getElementById("chatMessages");
const onlineList = document.getElementById("onlineList");
const chatForm = document.getElementById("chatForm");
const chatText = document.getElementById("chatText");
const typingLine = document.getElementById("typingLine");
const dmBar = document.getElementById("dmBar");
const dmBack = document.getElementById("dmBack");
const dmTitle = document.getElementById("dmTitle");
const REACTION_CHOICES = ["👍", "😂", "🔥", "💀", "🎉", "👀", "❤️", "😮", "😅", "🫡"];

let chatTimer = null;
let lastMessageId = 0;
let chatRunning = false;
let userMap = {};        // username -> { avatar, badge, role }
let myRole = "user";
let dmWith = null;       // username when the DM drawer is open
let lastDmId = 0;

function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

const reactionPicker = document.getElementById("reactionPicker");
let pickerTarget = null; // message id the picker is for

reactionPicker.innerHTML = "";
for (const emoji of REACTION_CHOICES) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = emoji;
  b.addEventListener("click", async () => {
    const id = pickerTarget;
    hideReactionPicker();
    if (!id) return;
    try {
      await reactToMessage(id, emoji);
      // re-render that message's reactions once the poll brings them back;
      // for instant feedback, tweak the DOM optimistically
      applyReactionLocally(id, emoji);
    } catch (e) { /* ignore */ }
  });
  reactionPicker.appendChild(b);
}

function hideReactionPicker() {
  reactionPicker.hidden = true;
  pickerTarget = null;
}
document.addEventListener("click", (e) => {
  if (!reactionPicker.hidden && !reactionPicker.contains(e.target) && !e.target.closest?.(".msg-react")) {
    hideReactionPicker();
  }
});

function applyReactionLocally(id, emoji) {
  const el = messagesEl.querySelector(`[data-msg-id="${id}"] .msg-reactions`);
  if (!el) return;
  const me = store.get("vault_username", "");
  let chip = [...el.children].find((c) => c.dataset.emoji === emoji);
  if (chip) {
    let count = Number(chip.dataset.count) || 1;
    const includesMe = (chip.dataset.mine || "") === "1";
    if (includesMe) {
      count -= 1;
      chip.dataset.mine = "0";
      chip.classList.remove("mine");
      chip.dataset.count = String(count);
      chip.lastChild.textContent = String(count);
      if (count <= 0) chip.remove();
    } else {
      count += 1;
      chip.dataset.mine = "1";
      chip.classList.add("mine");
      chip.dataset.count = String(count);
      chip.lastChild.textContent = String(count);
    }
  } else {
    const c = document.createElement("button");
    c.type = "button";
    c.className = "reaction-chip mine";
    c.dataset.emoji = emoji;
    c.dataset.count = "1";
    c.dataset.mine = "1";
    c.append(document.createTextNode(emoji + " "), document.createTextNode("1"));
    c.addEventListener("click", () => { reactToMessage(id, emoji).then(() => applyReactionLocally(id, emoji)).catch(() => {}); });
    el.appendChild(c);
  }
}

function buildMessageRow(msg) {
  const mine = msg.user === store.get("vault_username", "");
  const info = userMap[msg.user] || { avatar: "🎮", badge: "", role: "user" };
  const div = document.createElement("div");
  div.className = "chat-msg" + (mine ? " mine" : "");
  div.dataset.msgId = String(msg.id);

  if (msg.deleted) {
    const body = document.createElement("div");
    body.className = "body muted";
    body.textContent = "message deleted";
    div.appendChild(body);
    return div;
  }

  const head = document.createElement("div");
  head.className = "msg-head";
  const avatar = document.createElement("span");
  avatar.className = "msg-avatar";
  avatar.textContent = info.avatar;
  const who = document.createElement("span");
  who.className = "who";
  who.textContent = msg.user;
  const badge = document.createElement("span");
  badge.className = "msg-badge";
  badge.textContent = info.badge;
  if (info.role === "admin") {
    const crown = document.createElement("span");
    crown.className = "msg-crown";
    crown.textContent = "🛡️";
    crown.title = "admin";
    head.append(avatar, who, crown, badge);
  } else {
    head.append(avatar, who, badge);
  }
  const dmBtn = document.createElement("button");
  dmBtn.type = "button";
  dmBtn.className = "msg-dm";
  dmBtn.title = "DM " + msg.user;
  dmBtn.textContent = "✉";
  dmBtn.addEventListener("click", () => openDM(msg.user));
  head.appendChild(dmBtn);

  const body = document.createElement("div");
  body.className = "body";
  body.textContent = msg.text; // textContent — never innerHTML for chat

  const time = document.createElement("div");
  time.className = "time";
  time.textContent = fmtTime(msg.ts);

  const actions = document.createElement("div");
  actions.className = "msg-actions";
  const reactBtn = document.createElement("button");
  reactBtn.type = "button";
  reactBtn.className = "msg-react";
  reactBtn.title = "Add reaction";
  reactBtn.textContent = "☺+";
  reactBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const rect = reactBtn.getBoundingClientRect();
    pickerTarget = msg.id;
    reactionPicker.hidden = false;
    reactionPicker.style.left = Math.min(rect.left, window.innerWidth - 220) + "px";
    reactionPicker.style.top = Math.max(8, rect.top - 52) + "px";
  });
  actions.appendChild(reactBtn);
  if (mine || myRole === "admin") {
    const del = document.createElement("button");
    del.type = "button";
    del.className = "msg-del";
    del.title = "Delete message";
    del.textContent = "🗑";
    del.addEventListener("click", async () => {
      try {
        await deleteMessage(msg.id);
        div.classList.add("msg-deleted");
        body.textContent = "message deleted";
        body.classList.add("muted");
      } catch (err) { /* ignore */ }
    });
    actions.appendChild(del);
  }

  const reactions = document.createElement("div");
  reactions.className = "msg-reactions";
  for (const [emoji, users] of Object.entries(msg.reactions || {})) {
    if (!users.length) continue;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "reaction-chip" + (users.includes(store.get("vault_username", "")) ? " mine" : "");
    chip.dataset.emoji = emoji;
    chip.dataset.count = String(users.length);
    chip.dataset.mine = users.includes(store.get("vault_username", "")) ? "1" : "0";
    chip.title = users.join(", ");
    chip.append(document.createTextNode(emoji + " "), document.createTextNode(String(users.length)));
    chip.addEventListener("click", () => {
      reactToMessage(msg.id, emoji)
        .then(() => applyReactionLocally(msg.id, emoji))
        .catch(() => {});
    });
    reactions.appendChild(chip);
  }

  div.append(head, body, reactions, time, actions);
  return div;
}

function appendMessage(msg) {
  const div = buildMessageRow(msg);
  messagesEl.appendChild(div);
}

let pollChatBusy = false; // in-flight guard: manual + interval polls can race and double-render
let pollCount = 0;
async function pollChat() {
  if (pollChatBusy) return;
  pollChatBusy = true;
  try {
    pollCount++;
    // every 10th poll (~20s): full refresh reconciles reactions/deletes on older messages
    const fullRefresh = pollCount % 10 === 0;
    const since = fullRefresh ? 0 : lastMessageId;
    const data = await getMessages(since);
    if (!chatRunning) return;
    userMap = Object.assign(userMap, data.users || {});
    myRole = store.get("vault_role", "user");
    if (dmWith) {
      // DM drawer owns the message view; just advance the cursor
      for (const msg of data.messages || []) lastMessageId = Math.max(lastMessageId, msg.id);
    } else {
      if (fullRefresh && lastMessageId) messagesEl.innerHTML = "";
      for (const msg of data.messages || []) {
        appendMessage(msg);
        lastMessageId = Math.max(lastMessageId, msg.id);
      }
    }
    // cap DOM length
    while (messagesEl.children.length > 300) messagesEl.removeChild(messagesEl.firstChild);
    const nearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 120;
    if (nearBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
    // typing indicator
    const typers = (data.typing || []).filter((u) => u !== store.get("vault_username", ""));
    typingLine.textContent = typers.length
      ? (typers.length === 1 ? typers[0] + " is typing…" : typers.slice(0, 2).join(" and ") + " are typing…")
      : "";
    onlineList.innerHTML = "";
    for (const name of data.online || []) {
      const li = document.createElement("li");
      const dot = document.createElement("span");
      dot.className = "dot";
      const info = userMap[name];
      if (info && info.avatar) {
        const av = document.createElement("span");
        av.className = "msg-avatar";
        av.textContent = info.avatar;
        li.append(dot, av, document.createTextNode(name));
      } else {
        li.append(dot, document.createTextNode(name));
      }
      if (name !== store.get("vault_username", "")) {
        li.title = "Click to DM " + name;
        li.className = "online-user";
        li.addEventListener("click", () => openDM(name));
      }
      onlineList.appendChild(li);
    }
    if (!onlineList.children.length) {
      const li = document.createElement("li");
      li.textContent = "Nobody else — yet.";
      onlineList.appendChild(li);
    }
    // also poll the open DM thread
    if (dmWith) pollDM();
  } catch (e) {
    if (String(e.message).includes("Log in")) { stopChat(); refreshAuthUI(); }
  } finally {
    pollChatBusy = false;
  }
}

// ---------- DM drawer ----------

let dmViewGen = 0; // bumped on every view switch: stale in-flight DM responses get discarded
let pollDMBusy = false;

function openDM(username) {
  if (username === store.get("vault_username", "")) return;
  dmWith = username;
  dmViewGen++;
  lastDmId = 0;
  dmBar.hidden = false;
  dmTitle.textContent = "✉ DM with " + username;
  messagesEl.innerHTML = "";
  chatText.placeholder = "Message " + username + " privately…";
  pollDM();
}

dmBack.addEventListener("click", () => {
  dmWith = null;
  dmViewGen++; // invalidate any in-flight DM poll
  dmBar.hidden = true;
  chatText.placeholder = "Say something…";
  messagesEl.innerHTML = "";
  lastMessageId = 0;
  const sys = document.createElement("div");
  sys.className = "chat-system";
  sys.textContent = "Welcome back to the Nexus chatroom. Be cool to each other.";
  messagesEl.appendChild(sys);
  pollChat();
});

async function pollDM() {
  if (!dmWith || pollDMBusy) return;
  pollDMBusy = true;
  const thread = dmWith;
  const gen = dmViewGen;
  try {
    const data = await getDMs(thread, lastDmId);
    // view changed while the request was in flight — drop the response
    if (!chatRunning || dmWith !== thread || gen !== dmViewGen) return;
    for (const msg of (data.messages || [])) {
      if (msg.id <= lastDmId) continue; // dedupe by id (guards against cursor races)
      lastDmId = Math.max(lastDmId, msg.id);
      const div = document.createElement("div");
      div.className = "chat-msg dm" + (msg.from === store.get("vault_username", "") ? " mine" : "");
      const who = document.createElement("div");
      who.className = "who";
      who.textContent = msg.from === store.get("vault_username", "") ? "you" : msg.from;
      const body = document.createElement("div");
      body.className = "body";
      body.textContent = msg.text;
      const time = document.createElement("div");
      time.className = "time";
      time.textContent = fmtTime(msg.ts);
      div.append(who, body, time);
      messagesEl.appendChild(div);
    }
    if (data.messages && data.messages.length) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
    while (messagesEl.children.length > 300) messagesEl.removeChild(messagesEl.firstChild);
  } catch (e) {
    if (String(e.message).includes("Log in")) { stopChat(); refreshAuthUI(); }
  } finally {
    pollDMBusy = false;
  }
}

function startChatIfLoggedIn() {
  if (!getToken()) return;
  if (chatRunning) return;
  chatRunning = true;
  messagesEl.innerHTML = "";
  const sys = document.createElement("div");
  sys.className = "chat-system";
  sys.textContent = "Welcome to the Nexus chatroom. Be cool to each other.";
  messagesEl.appendChild(sys);
  pollChat();
  chatTimer = setInterval(() => { pollChat(); }, 2000);
}

function stopChat() {
  chatRunning = false;
  if (chatTimer) { clearInterval(chatTimer); chatTimer = null; }
  dmWith = null;
  dmViewGen++; // invalidate any in-flight DM poll
  dmBar.hidden = true;
}

// typing indicator: ping the server while the user is typing
let typingLastSent = 0;
chatText.addEventListener("input", () => {
  const now = Date.now();
  if (now - typingLastSent > 2000 && chatText.value.trim()) {
    typingLastSent = now;
    setTyping().catch(() => {});
  }
});

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = chatText.value.trim();
  if (!text) return;
  chatText.value = "";
  try {
    if (dmWith) {
      const res = await sendDM(dmWith, text);
      if (res && res.unlocked) res.unlocked.forEach((a) => showAchievementToast(a));
      pollDM();
    } else {
      const res = await postMessage(text);
      if (res && res.unlocked) res.unlocked.forEach((a) => showAchievementToast(a));
      pollChat();
    }
  } catch (err) {
    if (String(err.message).includes("Log in")) { stopChat(); refreshAuthUI(); }
    else alert(err.message);
  }
});

// ---------- Trophy case (Extras) ----------

const trophyGrid = document.getElementById("trophyGrid");
const achCount = document.getElementById("achCount");

async function refreshTrophies() {
  achCount.textContent = "";
  trophyGrid.innerHTML = "";
  if (!getToken()) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Log in to start collecting achievements.";
    trophyGrid.appendChild(p);
    return;
  }
  try {
    const data = await getAchievements();
    const owned = new Set((data.achievements || []).map((a) => a.id));
    achCount.textContent = `(${data.achievements.length}/${data.total})`;
    store.set("vault_achievement_count", data.achievements.length);
    window.dispatchEvent(new Event("vault:statschange"));
    for (const [id, meta] of Object.entries(ACH_CATALOG)) {
      const has = owned.has(id);
      const div = document.createElement("div");
      div.className = "trophy" + (has ? "" : " locked");
      const emoji = document.createElement("span");
      emoji.className = "trophy-emoji";
      emoji.textContent = has ? meta.emoji : "🔒";
      const name = document.createElement("span");
      name.className = "trophy-name";
      name.textContent = meta.name;
      const how = document.createElement("span");
      how.className = "trophy-how";
      how.textContent = meta.how || "";
      div.append(emoji, name, how);
      trophyGrid.appendChild(div);
    }
  } catch (e) { /* ignore */ }
}

// ---------- Panic screen (double-Esc) ----------

const panicScreen = document.getElementById("panicScreen");
const panicQuestion = document.getElementById("panicQuestion");
const panicAnswer = document.getElementById("panicAnswer");
const panicFeedback = document.getElementById("panicFeedback");
const panicScore = document.getElementById("panicScore");
const panicForm = document.getElementById("panicForm");
let panicA = 0;
let panicB = 0;
let panicSolved = 0;
let panicActive = false;
let lastEscTime = 0;

function newPanicQuestion() {
  panicA = 2 + Math.floor(Math.random() * 11);
  panicB = 2 + Math.floor(Math.random() * 11);
  panicQuestion.textContent = `${panicA} × ${panicB} = ?`;
  panicAnswer.value = "";
  panicFeedback.textContent = "";
}

function enterPanic() {
  panicActive = true;
  lastEscTime = 0;
  document.title = "Math Practice — Grade 8";
  panicScreen.hidden = false;
  newPanicQuestion();
  panicAnswer.focus();
}

function exitPanic() {
  panicActive = false;
  document.title = "NEXUS — Gaming Hub";
  panicScreen.hidden = true;
}

panicForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const v = Number(String(panicAnswer.value).trim());
  if (v === panicA * panicB) {
    panicSolved += 1;
    panicFeedback.textContent = "Correct!";
    sfx.blip(760, 0.06);
  } else {
    panicFeedback.textContent = "Not quite — try again.";
    sfx.blip(200, 0.08);
  }
  panicScore.textContent = "Solved: " + panicSolved;
  newPanicQuestion();
});

window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const now = Date.now();
  if (panicActive) {
    // double-Esc exits the panic screen
    if (now - lastEscTime < 700) { lastEscTime = 0; exitPanic(); }
    else lastEscTime = now;
    return;
  }
  if (!modal.hidden) { lastEscTime = now; closeGame(); return; } // first Esc closes the game (still counts toward the double-tap)
  if (now - lastEscTime < 700) enterPanic(); // double-tap = panic
  else lastEscTime = now;
});
// tiny hidden hotspot in the corner also exits panic mode
panicScreen.addEventListener("click", (e) => {
  if (e.target === panicScreen) exitPanic();
});

// ---------- Proxy ----------

const proxyForm = document.getElementById("proxyForm");
const proxyInput = document.getElementById("proxyUrl");
const proxyFrame = document.getElementById("proxyFrame");
const proxyEmpty = document.getElementById("proxyEmpty");

function normalizeUrl(raw) {
  let u = raw.trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  try { const parsed = new URL(u); return parsed.href; } catch (e) { return null; }
}

function loadProxy(rawUrl) {
  const url = normalizeUrl(rawUrl);
  if (!url) { proxyInput.focus(); return; }
  proxyEmpty.style.display = "none";
  proxyFrame.src = API_BASE + "/api/proxy?url=" + encodeURIComponent(url);
}

proxyForm.addEventListener("submit", (e) => {
  e.preventDefault();
  loadProxy(proxyInput.value);
});

document.querySelectorAll(".quick-link").forEach((btn) => {
  btn.addEventListener("click", () => {
    proxyInput.value = btn.dataset.url;
    loadProxy(btn.dataset.url);
  });
});

// ---------- Extras: drum pad ----------

const DRUMS = [
  { name: "kick", key: "1", freq: 0 },
  { name: "snare", key: "2", freq: 0 },
  { name: "hat", key: "3", freq: 0 },
  { name: "tom", key: "4", freq: 160 },
  { name: "tom hi", key: "5", freq: 220 },
  { name: "clap", key: "6", freq: 0 },
  { name: "bass", key: "7", freq: 90 },
  { name: "blip", key: "8", freq: 520 },
  { name: "zap", key: "9", freq: 780 },
];

function playDrum(d) {
  const c = (() => {
    try { return new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
  })();
  if (!c) return;
  if (c.state === "suspended") c.resume();
  const t = c.currentTime;
  const master = c.createGain();
  master.gain.value = 0.5;
  master.connect(c.destination);

  if (d.name === "kick") {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    g.gain.setValueAtTime(1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc.connect(g).connect(master);
    osc.start(t); osc.stop(t + 0.25);
  } else if (d.name === "snare" || d.name === "hat" || d.name === "clap") {
    const len = d.name === "hat" ? 0.05 : 0.18;
    const buf = c.createBuffer(1, c.sampleRate * len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
    const src = c.createBufferSource();
    src.buffer = buf;
    const filter = c.createBiquadFilter();
    filter.type = d.name === "hat" ? "highpass" : "bandpass";
    filter.frequency.value = d.name === "hat" ? 6000 : 1800;
    const g = c.createGain();
    g.gain.value = d.name === "clap" ? 0.7 : 1;
    src.connect(filter).connect(g).connect(master);
    src.start(t);
  } else {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = d.name === "zap" ? "sawtooth" : d.name === "bass" ? "triangle" : "sine";
    osc.frequency.setValueAtTime(d.freq, t);
    if (d.name === "zap") osc.frequency.exponentialRampToValueAtTime(d.freq / 3, t + 0.15);
    g.gain.setValueAtTime(0.8, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(g).connect(master);
    osc.start(t); osc.stop(t + 0.2);
  }
}

const drumGrid = document.getElementById("drumGrid");
const padByKey = new Map();
DRUMS.forEach((d) => {
  const pad = document.createElement("button");
  pad.className = "drum-pad";
  pad.type = "button";
  const key = document.createElement("span");
  key.className = "key";
  key.textContent = d.key;
  pad.append(key, document.createTextNode(d.name));
  pad.addEventListener("pointerdown", () => {
    playDrum(d);
    pad.classList.add("hit");
    setTimeout(() => pad.classList.remove("hit"), 120);
  });
  padByKey.set(d.key, pad);
  drumGrid.appendChild(pad);
});
window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  const pad = padByKey.get(e.key);
  if (pad) {
    const d = DRUMS.find((x) => x.key === e.key);
    playDrum(d);
    pad.classList.add("hit");
    setTimeout(() => pad.classList.remove("hit"), 120);
  }
});

// ---------- Extras: hacker typer ----------

const HACK_CODE = `> initiating nexus handshake...
> route: /api/secure/67 -> OK
> bypassing firewall [#####.......] 54%
> injecting payload into mainframe
> access level: ROOT
> downloading secrets: 47 files
> encryption: AES-256 ... broken
> trace route masked via 7 proxies
> they're tracing this line. move fast.
> root@nexus:~# ls /var/secret
  area51.db  bigfoot.jpg  homework_answers.txt
> root@nexus:~# cat homework_answers.txt
> just kidding. do your homework.
`;

const typerEl = document.getElementById("typer");
const typerStatus = document.getElementById("typerStatus");
let typed = 0;

typerEl.addEventListener("keydown", (e) => {
  e.preventDefault();
  typed += 2 + Math.floor(Math.random() * 3);
  if (typed > HACK_CODE.length) typed = HACK_CODE.length;
  typerEl.textContent = HACK_CODE.slice(0, typed);
  typerEl.scrollTop = typerEl.scrollHeight;
  const pct = Math.floor((typed / HACK_CODE.length) * 100);
  typerStatus.textContent = pct < 100 ? `hacking mainframe… ${pct}%` : "ACCESS GRANTED ✔";
  if (typed >= HACK_CODE.length) {
    setTimeout(() => {
      typed = 0;
      typerEl.textContent = "";
      typerStatus.textContent = "";
    }, 3500);
  }
});

// ---------- Extras: fun facts ----------

const FACTS = [
  "A day on Venus is longer than its year.",
  "Octopuses have three hearts and blue blood.",
  "The first computer bug was an actual moth, taped into a logbook in 1947.",
  "Bananas are berries. Strawberries are not.",
  "There are more possible chess games than atoms in the observable universe.",
  "Honey never spoils — archaeologists found 3,000-year-old jars in Egypt that were still edible.",
  "A group of flamingos is called a 'flamboyance'.",
  "The hottest planet, Venus, is hotter than Mercury because of runaway greenhouse gases.",
  "Sharks existed before trees. Let that sink in.",
  "The Eiffel Tower can grow over 15 cm taller in summer heat.",
  "Wombats poop cubes. Yes, really.",
  "If you folded a piece of paper 42 times, it would reach the moon.",
  "Scotland's national animal is the unicorn.",
  "The longest recorded flight of a chicken is 13 seconds.",
];

const factText = document.getElementById("factText");
document.getElementById("factBtn").addEventListener("click", () => {
  factText.textContent = FACTS[Math.floor(Math.random() * FACTS.length)];
});
factText.textContent = FACTS[Math.floor(Math.random() * FACTS.length)];

// init
refreshAuthUI();
refreshLeaderboard();
refreshTrophies();
