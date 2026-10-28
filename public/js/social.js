import { apiFetch, getToken, store } from "./api.js";

const $ = (id) => document.getElementById(id);
const safeText = (value, fallback = "") => String(value ?? fallback);
const fmt = (ts) => ts ? new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
let currentProfile = null;
let selectedSpace = null;
let selectedChannel = "general";
let spacePoll = null;
let refreshTimer = null;
let socialBusy = false;

function loggedIn() { return !!(getToken() && store.get("vault_username", null)); }
function status(el, text, isError = false) { if (!el) return; el.textContent = text || ""; el.classList.toggle("is-error", !!isError); }
function empty(text) { const el = document.createElement("div"); el.className = "social-empty"; el.textContent = text; return el; }
function btn(label, action, primary = false) { const b = document.createElement("button"); b.type = "button"; b.textContent = label; if (primary) b.className = "primary"; b.addEventListener("click", action); return b; }
function userRow(user, actions = []) {
  const row = document.createElement("div"); row.className = "social-user-row";
  const avatar = document.createElement("span"); avatar.className = "social-user-avatar"; avatar.textContent = user.avatar || "🎮";
  const copy = document.createElement("div"); copy.className = "social-user-copy";
  const name = document.createElement("strong"); name.textContent = user.displayName || user.username;
  const detail = document.createElement("small"); detail.textContent = "@" + user.username + (user.online ? " · Online" : " · Offline") + (user.status ? " · " + user.status : "");
  copy.append(name, detail); row.append(avatar, copy);
  if (actions.length) { const wrap = document.createElement("div"); wrap.className = "social-user-actions"; actions.forEach(a => wrap.appendChild(btn(a.label, a.run, a.primary))); row.appendChild(wrap); }
  return row;
}
function showAuthHint(container) { if (!container) return; container.replaceChildren(empty("Log in to use this feature. Your account and social data are stored securely on the server.")); }
async function apiOrHint(path, options) { if (!loggedIn()) throw new Error("Log in to use this feature."); return apiFetch(path, options); }

async function loadFriends() {
  const friendsList = $("friendsList"), requestsList = $("friendRequestsList");
  if (!loggedIn()) { showAuthHint(friendsList); showAuthHint(requestsList); return; }
  try {
    const data = await apiOrHint("/api/features/friends");
    friendsList.replaceChildren(); requestsList.replaceChildren();
    if (!data.friends?.length) friendsList.append(empty("No friends yet. Search for someone above to get started."));
    for (const friend of data.friends || []) friendsList.append(userRow(friend, [
      { label: "Message", primary: true, run: () => openDM(friend.username) },
      { label: "Remove", run: async () => { if (!confirm(`Remove ${friend.username} from your friends?`)) return; await apiOrHint("/api/features/friends/remove", { method: "POST", body: JSON.stringify({ username: friend.username }) }); await loadFriends(); } },
    ]));
    const all = [...(data.incoming || []).map(x => ({ ...x, requestType: "incoming" })), ...(data.outgoing || []).map(x => ({ ...x, requestType: "outgoing" }))];
    $("friendRequestCount").textContent = String(data.incoming?.length || 0);
    if (!all.length) requestsList.append(empty("No pending requests."));
    for (const person of all) {
      const actions = person.requestType === "incoming" ? [
        { label: "Accept", primary: true, run: async () => { await apiOrHint("/api/features/friends/accept", { method: "POST", body: JSON.stringify({ username: person.username }) }); await Promise.all([loadFriends(), loadNotifications()]); } },
        { label: "Decline", run: async () => { await apiOrHint("/api/features/friends/decline", { method: "POST", body: JSON.stringify({ username: person.username }) }); await loadFriends(); } },
      ] : [{ label: "Pending…", run: () => {} }];
      requestsList.append(userRow(person, actions));
    }
  } catch (e) { friendsList.replaceChildren(empty(e.message)); requestsList.replaceChildren(empty(e.message)); }
}

$("friendSearchForm")?.addEventListener("submit", async e => {
  e.preventDefault(); const q = $("friendSearchInput").value.trim(); const target = $("friendSearchResults"); target.replaceChildren();
  if (q.length < 2) { target.append(empty("Enter at least 2 characters.")); return; }
  try {
    const data = await apiOrHint("/api/features/users?q=" + encodeURIComponent(q));
    if (!data.users?.length) { target.append(empty("No users found.")); return; }
    for (const user of data.users) target.append(userRow(user, [
      { label: "View profile", run: () => viewPublicProfile(user.username) },
      { label: "Add friend", primary: true, run: async () => { try { await apiOrHint("/api/features/friends/request", { method: "POST", body: JSON.stringify({ username: user.username }) }); status(target, ""); await loadFriends(); await loadNotifications(); target.prepend(empty(`Request sent to @${user.username}.`)); } catch (err) { target.prepend(empty(err.message)); } } },
    ]));
  } catch (err) { target.append(empty(err.message)); }
});
$("refreshFriendsBtn")?.addEventListener("click", loadFriends);

async function loadNotifications() {
  const list = $("notificationsList"); if (!loggedIn()) { showAuthHint(list); $("notificationBadge").hidden = true; return; }
  try {
    const data = await apiOrHint("/api/features/notifications"); const items = data.notifications || []; const unread = items.filter(n => !n.read).length;
    const badge = $("notificationBadge"); badge.textContent = String(unread); badge.hidden = !unread;
    list.replaceChildren();
    if (!items.length) { list.append(empty("You're all caught up.")); return; }
    for (const n of items) {
      const row = document.createElement("div"); row.className = "social-notice" + (n.read ? "" : " unread");
      const icon = document.createElement("span"); icon.className = "social-notice-icon"; icon.textContent = n.type === "friend_request" ? "♧" : n.type === "dm" ? "✉" : n.type === "friend_accepted" ? "✓" : "✦";
      const copy = document.createElement("div"); copy.className = "social-notice-copy";
      const p = document.createElement("p"); p.textContent = n.text || "New activity on MathNest.";
      const time = document.createElement("small"); time.textContent = fmt(n.createdAt); copy.append(p, time); row.append(icon, copy);
      if (!n.read) row.append(btn("Mark read", async () => { await apiOrHint("/api/features/notifications/read", { method: "POST", body: JSON.stringify({ id: n.id }) }); await loadNotifications(); }));
      if (n.type === "friend_request") row.append(btn("View", () => document.querySelector('.tab[data-tab="friends"]')?.click()));
      if (n.type === "space_invite") row.append(btn("View space", () => document.querySelector('.tab[data-tab="spaces"]')?.click()));
      list.append(row);
    }
  } catch (e) { list.replaceChildren(empty(e.message)); }
}
$("markAllNotificationsRead")?.addEventListener("click", async () => { try { await apiOrHint("/api/features/notifications/read", { method: "POST", body: JSON.stringify({ all: true }) }); await loadNotifications(); } catch (e) { status($("notificationsList"), e.message, true); } });

async function loadProfile() {
  if (!loggedIn()) { status($("socialProfileStatus"), "Log in to edit your profile.", true); return; }
  try {
    const data = await apiOrHint("/api/features/profile"); currentProfile = data.profile || {};
    $("profileDisplayNameInput").value = currentProfile.displayName || currentProfile.username || store.get("vault_username", "");
    $("profileAvatarInput").value = currentProfile.avatar || "🎮";
    $("profileStatusInput").value = currentProfile.status || "";
    $("profileBioInput").value = currentProfile.bio || "";
    $("profileBannerInput").value = currentProfile.banner || "aurora";
    $("profileInterestsInput").value = (currentProfile.interests || []).join(", ");
    $("profileBadgesInput").value = (currentProfile.badges || []).join(", ");
    paintProfilePreview(currentProfile);
  } catch (e) { status($("socialProfileStatus"), e.message, true); }
}
function paintProfilePreview(p) {
  $("profilePreviewAvatar").textContent = p.avatar || "🎮";
  $("profilePreviewName").textContent = p.displayName || p.username || store.get("vault_username", "Your name");
  $("profilePreviewStatus").textContent = p.status || "Set a status message";
  $("profilePreviewBio").textContent = p.bio || "Your bio will appear here.";
  const banner = $("profileBannerPreview"); banner.className = "profile-banner-preview banner-" + (p.banner || "aurora");
  const interests = $("profilePreviewInterests"); interests.replaceChildren(); (p.interests || []).forEach(t => { const x = document.createElement("span"); x.textContent = t; interests.append(x); });
  const badges = $("profilePreviewBadges"); badges.replaceChildren(); (p.badges || []).forEach(t => { const x = document.createElement("span"); x.textContent = "✦ " + t; badges.append(x); });
}
["profileDisplayNameInput", "profileAvatarInput", "profileStatusInput", "profileBioInput", "profileBannerInput", "profileInterestsInput", "profileBadgesInput"].forEach(id => $(id)?.addEventListener("input", () => {
  paintProfilePreview({ username: store.get("vault_username", ""), displayName: $("profileDisplayNameInput").value, avatar: $("profileAvatarInput").value || "🎮", status: $("profileStatusInput").value, bio: $("profileBioInput").value, banner: $("profileBannerInput").value, interests: $("profileInterestsInput").value.split(",").map(x => x.trim()).filter(Boolean).slice(0,8), badges: $("profileBadgesInput").value.split(",").map(x => x.trim()).filter(Boolean).slice(0,5) });
}));
$("socialProfileForm")?.addEventListener("submit", async e => {
  e.preventDefault(); const submit = e.submitter; if (submit) submit.disabled = true;
  try {
    const payload = { displayName: $("profileDisplayNameInput").value, avatar: $("profileAvatarInput").value.trim(), status: $("profileStatusInput").value, bio: $("profileBioInput").value, banner: $("profileBannerInput").value, interests: $("profileInterestsInput").value.split(",").map(x => x.trim()).filter(Boolean).slice(0,8), badges: $("profileBadgesInput").value.split(",").map(x => x.trim()).filter(Boolean).slice(0,5) };
    const data = await apiOrHint("/api/features/profile", { method: "POST", body: JSON.stringify(payload) }); currentProfile = data.profile; paintProfilePreview(currentProfile); status($("socialProfileStatus"), "Profile saved.");
  } catch (err) { status($("socialProfileStatus"), err.message, true); }
  finally { if (submit) submit.disabled = false; }
});
let publicProfileUsername = "";
async function viewPublicProfile(username) {
  try {
    const data = await apiOrHint("/api/features/profile/public?username=" + encodeURIComponent(username)); const p = data.profile; publicProfileUsername = p.username;
    $("publicProfileBanner").className = "profile-banner-preview banner-" + (p.banner || "aurora");
    $("publicProfileAvatar").textContent = p.avatar || "🎮"; $("publicProfileName").textContent = p.displayName || p.username;
    $("publicProfileHandle").textContent = "@" + p.username + (p.online ? " · Online" : " · Offline");
    $("publicProfileStatus").textContent = p.status || ""; $("publicProfileBio").textContent = p.bio || "No bio yet.";
    const interests = $("publicProfileInterests"); interests.replaceChildren(); (p.interests || []).forEach(t => { const x = document.createElement("span"); x.textContent = t; interests.append(x); });
    const badges = $("publicProfileBadges"); badges.replaceChildren(); (p.badges || []).forEach(t => { const x = document.createElement("span"); x.textContent = "✦ " + t; badges.append(x); });
    status($("publicProfileActionStatus"), ""); $("publicProfileModal").hidden = false;
  } catch (e) { alert(e.message); }
}
$("publicProfileClose")?.addEventListener("click", () => { $("publicProfileModal").hidden = true; });
$("publicProfileModal")?.querySelector("[data-close-public-profile]")?.addEventListener("click", () => { $("publicProfileModal").hidden = true; });
$("publicProfileAddFriend")?.addEventListener("click", async () => { try { await apiOrHint("/api/features/friends/request", { method: "POST", body: JSON.stringify({ username: publicProfileUsername }) }); status($("publicProfileActionStatus"), "Friend request sent."); await loadFriends(); await loadNotifications(); } catch (e) { status($("publicProfileActionStatus"), e.message, true); } });
$("publicProfileMessage")?.addEventListener("click", () => { $("publicProfileModal").hidden = true; openDM(publicProfileUsername); });

let spacesCache = [];
async function loadSpaces() {
  const list = $("spacesList"); if (!loggedIn()) { showAuthHint(list); return; }
  try {
    const data = await apiOrHint("/api/features/spaces"); spacesCache = data.spaces || []; list.replaceChildren();
    if (!spacesCache.length) list.append(empty("No spaces yet. Be the first to create one."));
    for (const space of spacesCache) {
      const row = document.createElement("div"); row.className = "space-row";
      const icon = document.createElement("span"); icon.className = "social-user-avatar"; icon.textContent = "▤";
      const copy = document.createElement("div"); copy.className = "space-row-copy"; const name = document.createElement("strong"); name.textContent = space.name; const detail = document.createElement("small"); detail.textContent = `${space.memberCount || 0} members · by @${space.owner}`; copy.append(name, detail); row.append(icon, copy);
      const joined = !!space.joined || space.owner === store.get("vault_username", "") || space.isMember;
      row.append(btn(joined ? "Open" : space.visibility === "private" ? "Private" : "Join", async () => {
        if (space.visibility === "private" && !joined) { status($("createSpaceStatus"), "Private spaces are invite-only; ask the owner for access."); return; }
        try { if (!joined) await apiOrHint(`/api/features/spaces/${encodeURIComponent(space.id)}/join`, { method: "POST" }); await loadSpaces(); await openSpace(space.id); } catch (e) { status($("createSpaceStatus"), e.message, true); }
      }, !joined && space.visibility !== "private"));
      list.append(row);
    }
  } catch (e) { list.replaceChildren(empty(e.message)); }
}
$("refreshSpacesBtn")?.addEventListener("click", loadSpaces);
$("createSpaceForm")?.addEventListener("submit", async e => {
  e.preventDefault(); status($("createSpaceStatus"), "Creating space…");
  try { const data = await apiOrHint("/api/features/spaces", { method: "POST", body: JSON.stringify({ name: $("spaceNameInput").value, description: $("spaceDescriptionInput").value, visibility: $("spacePrivateInput").checked ? "private" : "public" }) }); $("createSpaceForm").reset(); status($("createSpaceStatus"), "Space created."); await loadSpaces(); await openSpace(data.space.id); }
  catch (err) { status($("createSpaceStatus"), err.message, true); }
});
async function openSpace(id) {
  const space = spacesCache.find(s => s.id === id); if (!space) return;
  selectedSpace = space; selectedChannel = "general";
  $("spaceDetailEmpty").hidden = true; $("spaceDetail").hidden = false;
  $("spaceDetailName").textContent = space.name; $("spaceDetailDescription").textContent = space.description || "A community space."; $("spaceMemberLabel").textContent = `${space.memberCount || 0} MEMBERS · ${space.visibility === "private" ? "PRIVATE" : "PUBLIC"}`;
  $("addSpaceChannelBtn").hidden = space.owner !== store.get("vault_username", "");
  $("inviteSpaceMemberBtn").hidden = space.owner !== store.get("vault_username", "");
  renderChannels(); await loadSpaceMessages();
}
function renderChannels() {
  const list = $("spaceChannelsList"); list.replaceChildren();
  const channels = selectedSpace?.channels || [{ id: "general", name: "general", topic: "The main conversation" }];
  for (const channel of channels) { const b = document.createElement("button"); b.type = "button"; b.className = "space-channel-button" + (channel.id === selectedChannel ? " active" : ""); b.textContent = "# " + channel.name; b.addEventListener("click", async () => { selectedChannel = channel.id; $("spaceChannelTitle").textContent = "# " + channel.name; $("spaceChannelTopic").textContent = channel.topic || ""; renderChannels(); await loadSpaceMessages(); }); list.append(b); }
  const current = channels.find(c => c.id === selectedChannel) || channels[0]; if (current) { selectedChannel = current.id; $("spaceChannelTitle").textContent = "# " + current.name; $("spaceChannelTopic").textContent = current.topic || ""; }
}
async function loadSpaceMessages() {
  if (!selectedSpace || !loggedIn()) return;
  try {
    const data = await apiOrHint(`/api/features/spaces/${encodeURIComponent(selectedSpace.id)}/messages?channel=${encodeURIComponent(selectedChannel)}`); const list = $("spaceMessages"); list.replaceChildren();
    if (!data.messages?.length) list.append(empty("No messages here yet. Start the conversation."));
    for (const msg of data.messages || []) { const row = document.createElement("div"); row.className = "space-message"; const av = document.createElement("span"); av.className = "space-message-avatar"; av.textContent = msg.avatar || "🎮"; const copy = document.createElement("div"); copy.className = "space-message-content"; const who = document.createElement("strong"); who.textContent = msg.displayName || msg.username; const time = document.createElement("small"); time.textContent = fmt(msg.ts); const text = document.createElement("p"); text.textContent = msg.text; copy.append(who, time, text); row.append(av, copy); list.append(row); }
    list.scrollTop = list.scrollHeight;
  } catch (e) { $("spaceMessages").replaceChildren(empty(e.message)); }
}
$("addSpaceChannelBtn")?.addEventListener("click", async () => {
  if (!selectedSpace) return; const name = prompt("New channel name (letters, numbers, hyphens):"); if (!name) return; const topic = prompt("Channel topic (optional):") || "";
  try { const data = await apiOrHint(`/api/features/spaces/${encodeURIComponent(selectedSpace.id)}/channels`, { method: "POST", body: JSON.stringify({ name, topic }) }); selectedSpace.channels.push(data.channel); selectedChannel = data.channel.id; renderChannels(); await loadSpaceMessages(); }
  catch (e) { status($("spaceMessageStatus"), e.message, true); }
});
$("inviteSpaceMemberBtn")?.addEventListener("click", async () => {
  if (!selectedSpace) return; const username = prompt("Username to invite:"); if (!username?.trim()) return;
  try { await apiOrHint(`/api/features/spaces/${encodeURIComponent(selectedSpace.id)}/invite`, { method: "POST", body: JSON.stringify({ username: username.trim() }) }); status($("spaceMessageStatus"), `Invite sent to @${username.trim()}.`); await loadNotifications(); await loadSpaces(); }
  catch (e) { status($("spaceMessageStatus"), e.message, true); }
});
$("spaceMessageForm")?.addEventListener("submit", async e => {
  e.preventDefault(); if (!selectedSpace) return; const input = $("spaceMessageInput"); const text = input.value.trim(); if (!text) return;
  try { await apiOrHint(`/api/features/spaces/${encodeURIComponent(selectedSpace.id)}/messages`, { method: "POST", body: JSON.stringify({ channel: selectedChannel, text }) }); input.value = ""; status($("spaceMessageStatus"), ""); await loadSpaceMessages(); }
  catch (err) { status($("spaceMessageStatus"), err.message, true); }
});
function openDM(username) {
  document.querySelector('.tab[data-tab="chat"]')?.click();
  if (typeof window.nexusOpenDM === "function") window.nexusOpenDM(username);
  else { const online = document.querySelector(`.online-user[data-username="${CSS.escape(username)}"]`); online?.click(); }
}
async function refreshInbox() {
  if (!loggedIn()) { window.nexusSetPersistentDMContacts?.([]); return; }
  try {
    const data = await apiOrHint("/api/features/dms"); const conversations = data.conversations || [];
    window.nexusSetPersistentDMContacts?.(conversations.map(c => c.username));
    const unread = conversations.reduce((sum, c) => sum + (Number(c.unread) || 0), 0); const badge = $("dmUnreadBadge");
    if (badge) { badge.textContent = unread > 99 ? "99+" : String(unread); badge.hidden = unread < 1; }
  } catch { /* existing chat UI will display its own login / API errors */ }
}
async function refreshAll() {
  if (socialBusy) return; socialBusy = true;
  try { await Promise.all([loadNotifications(), refreshInbox()]); }
  finally { socialBusy = false; }
}
function syncAuth() {
  if (loggedIn()) { loadFriends(); loadProfile(); loadSpaces(); refreshAll(); }
  else {
    ["friendsList", "friendRequestsList", "friendSearchResults", "notificationsList", "spacesList"].forEach(id => showAuthHint($(id)));
    status($("socialProfileStatus"), "Log in to edit your profile.");
    window.nexusSetPersistentDMContacts?.([]);
  }
}
for (const name of ["friends", "notifications", "spaces", "profile"]) {
  document.querySelector(`.tab[data-tab="${name}"]`)?.addEventListener("click", () => {
    if (!loggedIn()) return;
    if (name === "friends") loadFriends();
    if (name === "notifications") loadNotifications();
    if (name === "spaces") loadSpaces();
    if (name === "profile") loadProfile();
  });
}
window.addEventListener("vault:authchange", syncAuth);
window.addEventListener("nexus:dm-updated", refreshInbox);
window.addEventListener("vault:showdms", refreshInbox);
window.addEventListener("vault:showchat", refreshInbox);
window.addEventListener("focus", refreshAll);
if (refreshTimer) clearInterval(refreshTimer);
refreshTimer = setInterval(() => { if (loggedIn()) refreshAll(); }, 20000);
syncAuth();
