// THE VAULT — app shell: tabs, games, chat, proxy, extras.

import { store, getToken, signup, login, logout, me, getMessages, postMessage, API_BASE } from "./api.js";
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
  };
})();
window.vaultSfx = sfx;
document.addEventListener("pointerdown", () => { try { sfx.blip(0.001, 0.01); } catch (e) {} }, { once: true });

// ---------- Tabs ----------

const tabs = [...document.querySelectorAll(".tab")];
const panels = [...document.querySelectorAll(".panel")];

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => { t.classList.toggle("is-active", t === tab); t.setAttribute("aria-selected", t === tab ? "true" : "false"); });
    panels.forEach((p) => p.classList.toggle("is-active", p.dataset.panel === tab.dataset.tab));
    if (tab.dataset.tab === "chat") startChatIfLoggedIn();
  });
});

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
      if (finalScore >= meta.best) {
        meta.best = finalScore;
        store.set("vault_best_" + meta.id, finalScore);
        if (meta.bestEl) meta.bestEl.textContent = "best " + finalScore;
      }
    },
  });
}

document.getElementById("gameClose").addEventListener("click", closeGame);
document.getElementById("gameRestart").addEventListener("click", () => { if (currentMeta) startGame(currentMeta); });
modal.addEventListener("click", (e) => { if (e.target === modal) closeGame(); });
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modal.hidden) closeGame();
});

function closeGame() {
  if (currentGame) { currentGame.destroy(); currentGame = null; }
  modal.hidden = true;
  document.body.style.overflow = "";
}

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
let authMode = "signup";

authTabs.forEach((t) => {
  t.addEventListener("click", () => {
    authMode = t.dataset.auth;
    authTabs.forEach((x) => x.classList.toggle("is-active", x === t));
    authSubmit.textContent = authMode === "signup" ? "Sign up" : "Log in";
    authError.textContent = "";
  });
});

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  authSubmit.disabled = true;
  authError.textContent = "";
  try {
    if (authMode === "signup") await signup(authUser.value.trim(), authPass.value);
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
    startChatIfLoggedIn();
  } else {
    userChip.hidden = true;
    chatLoggedOut.hidden = false;
    chatLoggedIn.hidden = true;
    stopChat();
  }
}

// verify token on load
me().then((res) => {
  if (!res) { store.remove("vault_token"); store.remove("vault_username"); }
  refreshAuthUI();
});

// ---------- Chat ----------

const messagesEl = document.getElementById("chatMessages");
const onlineList = document.getElementById("onlineList");
const chatForm = document.getElementById("chatForm");
const chatText = document.getElementById("chatText");
let chatTimer = null;
let lastMessageId = 0;
let chatRunning = false;

function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function appendMessage(msg) {
  const mine = msg.user === store.get("vault_username", "");
  const div = document.createElement("div");
  div.className = "chat-msg" + (mine ? " mine" : "");
  const who = document.createElement("div");
  who.className = "who";
  who.textContent = msg.user;
  const body = document.createElement("div");
  body.className = "body";
  body.textContent = msg.text; // textContent — never innerHTML for chat
  const time = document.createElement("div");
  time.className = "time";
  time.textContent = fmtTime(msg.ts);
  div.append(who, body, time);
  messagesEl.appendChild(div);
}

async function pollChat() {
  try {
    const data = await getMessages(lastMessageId);
    if (!chatRunning) return;
    for (const msg of data.messages || []) {
      appendMessage(msg);
      lastMessageId = Math.max(lastMessageId, msg.id);
    }
    // cap DOM length
    while (messagesEl.children.length > 300) messagesEl.removeChild(messagesEl.firstChild);
    const nearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 120;
    if (nearBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
    onlineList.innerHTML = "";
    for (const name of data.online || []) {
      const li = document.createElement("li");
      const dot = document.createElement("span");
      dot.className = "dot";
      li.append(dot, document.createTextNode(name));
      onlineList.appendChild(li);
    }
    if (!onlineList.children.length) {
      const li = document.createElement("li");
      li.textContent = "Nobody else — yet.";
      onlineList.appendChild(li);
    }
  } catch (e) {
    if (String(e.message).includes("Log in")) { stopChat(); refreshAuthUI(); }
  }
}

function startChatIfLoggedIn() {
  if (!getToken()) return;
  if (chatRunning) return;
  chatRunning = true;
  messagesEl.innerHTML = "";
  const sys = document.createElement("div");
  sys.className = "chat-system";
  sys.textContent = "Welcome to the Vault chatroom. Be cool to each other.";
  messagesEl.appendChild(sys);
  pollChat();
  chatTimer = setInterval(pollChat, 2000);
}

function stopChat() {
  chatRunning = false;
  if (chatTimer) { clearInterval(chatTimer); chatTimer = null; }
}

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = chatText.value.trim();
  if (!text) return;
  chatText.value = "";
  try {
    await postMessage(text);
    pollChat();
  } catch (err) {
    if (String(err.message).includes("Log in")) { stopChat(); refreshAuthUI(); }
  }
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

const HACK_CODE = `> initiating vault handshake...
> route: /api/secure/67 -> OK
> bypassing firewall [#####.......] 54%
> injecting payload into mainframe
> access level: ROOT
> downloading secrets: 47 files
> encryption: AES-256 ... broken
> trace route masked via 7 proxies
> they're tracing this line. move fast.
> root@vault:~# ls /var/secret
  area51.db  bigfoot.jpg  homework_answers.txt
> root@vault:~# cat homework_answers.txt
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
