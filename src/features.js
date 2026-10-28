// MathNest add-on features: profiles, community feed, and server-side AI chat.
import { getDb, saveDb, withLock } from "./store.js";
import * as auth from "./auth.js";
import { profileForUid, saveProfile, saveProgress, firebaseServices, lookupUsername } from "./firebase.js";

const AI_LIMIT = new Map();
const AVATARS = ["🎮", "👾", "🚀", "🛸", "⭐", "🍕", "🍩", "🐱", "🦊", "🐸", "🦄", "🐙", "🤖", "👽", "🎃", "🎧", "🎸", "⚽", "🐉", "🧙"];

function json(res, status, data) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}
function tokenFrom(req, url) {
  const h = String(req.headers.authorization || "");
  if (h.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  return url.searchParams.get("token") || null;
}
function currentUser(req, url) { return auth.userForToken(tokenFrom(req, url)); }
function body(req, limit = 12000) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > limit) { reject(new Error("Request too large")); req.destroy(); }
    });
    req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error("Invalid JSON")); } });
    req.on("error", reject);
  });
}
function publicUser(u) {
  const lastSeen = Number(u.lastSeen) || 0;
  return { username: u.username, avatar: u.avatar || "🎮", bio: u.bio || "", displayName: u.displayName || u.username, status: u.status || "", banner: u.banner || "aurora", interests: Array.isArray(u.interests) ? u.interests : [], badges: Array.isArray(u.badges) ? u.badges : [], online: Date.now() - lastSeen < 120000, created: u.created || null, role: u.role || "user", msgCount: u.msgCount || 0 };
}

const BANNERS = new Set(["aurora", "sunset", "ocean", "orchid", "forest", "mono"]);
const PRESENCE_TOUCH = new Map();
const cleanText = (value, max) => String(value || "").trim().replace(/[<>\u0000-\u001f\u007f]/g, "").slice(0, max);
function socialError(res, error, fallback = "Social features are temporarily unavailable.") {
  console.error("Social API error:", error);
  return json(res, error?.status || 503, { error: error?.message || fallback });
}
function uidOf(user) { return user?.firebaseUid || null; }
function spacePublic(s) { return { id: s.id, name: s.name, description: s.description || "", owner: s.owner || "", ownerUid: s.ownerUid, visibility: s.visibility || "public", memberCount: Array.isArray(s.members) ? s.members.length : 0, channels: Array.isArray(s.channels) ? s.channels : [], createdAt: s.createdAt || 0, updatedAt: s.updatedAt || 0 }; }
async function profileByUsername(username) {
  const index = await lookupUsername(username);
  if (!index?.uid) return null;
  const profile = await profileForUid(index.uid);
  return profile ? { uid: index.uid, profile } : null;
}
async function addNotification(db, uid, notification) {
  const ref = db.collection("mathnestUsers").doc(uid).collection("notifications").doc();
  await ref.set({ id: ref.id, read: false, createdAt: Date.now(), ...notification });
}
async function listNotifications(db, uid) {
  const snap = await db.collection("mathnestUsers").doc(uid).collection("notifications").limit(100).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 60);
}
async function isSpaceMember(db, spaceId, uid) {
  const snap = await db.collection("mathnestSpaces").doc(spaceId).get();
  if (!snap.exists) return { error: 404, message: "Space not found." };
  const space = snap.data();
  if (!(space.members || []).includes(uid)) return { error: 403, message: "Join this space before opening its channels." };
  return { space };
}

export async function handleFeaturesApi(req, res, url) {
  const path = url.pathname;
  const method = req.method;

  // ---------- Friends, persistent DMs, notifications, profiles, spaces ----------
  const socialUser = currentUser(req, url);
  const uid = uidOf(socialUser);
  if (path.startsWith("/api/features/") && ["/api/features/friends", "/api/features/notifications", "/api/features/spaces", "/api/features/dms", "/api/features/users", "/api/features/profile/public"].some(p => path === p || path.startsWith(p + "/"))) {
    if (!socialUser || !uid) return json(res, 401, { error: "Log in with your MathNest account to use social features." });
    let db;
    try { db = firebaseServices().db; } catch (error) { return socialError(res, error, "Firebase is not configured."); }
    const lastTouch = PRESENCE_TOUCH.get(uid) || 0;
    if (Date.now() - lastTouch > 60000) {
      PRESENCE_TOUCH.set(uid, Date.now());
      db.collection("mathnestUsers").doc(uid).set({ lastSeen: Date.now() }, { merge: true }).catch(error => console.error("Presence update failed:", error));
    }

    // User search / public profile lookup
    if (path === "/api/features/users" && method === "GET") {
      const q = cleanText(url.searchParams.get("q"), 20).toLowerCase();
      if (q.length < 2) return json(res, 200, { users: [] });
      const snap = await db.collection("mathnestUsernames").limit(500).get();
      const hits = snap.docs.map(d => ({ ...d.data(), key: d.id })).filter(x => x.key.includes(q) || String(x.username || "").toLowerCase().includes(q)).slice(0, 20);
      const users = [];
      for (const hit of hits) { if (hit.uid === uid) continue; const p = await profileForUid(hit.uid); if (p) users.push(publicUser(p)); }
      return json(res, 200, { users });
    }
    if (path === "/api/features/profile/public" && method === "GET") {
      const username = cleanText(url.searchParams.get("username"), 20);
      const found = await profileByUsername(username);
      if (!found) return json(res, 404, { error: "Profile not found." });
      return json(res, 200, { profile: publicUser(found.profile), isSelf: found.uid === uid });
    }

    // Friends: request, accept, decline, remove and list
    if (path === "/api/features/friends" && method === "GET") {
      const own = db.collection("mathnestUsers").doc(uid);
      const [friendSnap, requestSnap] = await Promise.all([
        own.collection("friends").get(),
        db.collection("mathnestFriendRequests").get()
      ]);
      const friends = [];
      for (const doc of friendSnap.docs) { const d = doc.data(); if (d.status !== "accepted") continue; const p = await profileForUid(doc.id); if (p) friends.push(publicUser(p)); }
      const incoming = [], outgoing = [];
      for (const doc of requestSnap.docs) { const r = doc.data(); if (r.status !== "pending") continue; if (r.toUid === uid || r.fromUid === uid) { const otherUid = r.toUid === uid ? r.fromUid : r.toUid; const p = await profileForUid(otherUid); if (p) (r.toUid === uid ? incoming : outgoing).push({ ...publicUser(p), requestedAt: r.createdAt || 0 }); } }
      return json(res, 200, { friends, incoming, outgoing });
    }
    if (path === "/api/features/friends/request" && method === "POST") {
      const data = await body(req); const target = cleanText(data.username, 20);
      const found = await profileByUsername(target);
      if (!found) return json(res, 404, { error: "That user wasn't found." });
      if (found.uid === uid) return json(res, 400, { error: "You can't add yourself." });
      const mine = await db.collection("mathnestUsers").doc(uid).collection("friends").doc(found.uid).get();
      if (mine.exists && mine.data().status === "accepted") return json(res, 409, { error: "You're already friends." });
      const requestRef = db.collection("mathnestFriendRequests").doc(`${uid}_${found.uid}`);
      const reverseRef = db.collection("mathnestFriendRequests").doc(`${found.uid}_${uid}`);
      const [existingRequest, reverse] = await Promise.all([requestRef.get(), reverseRef.get()]);
      if (existingRequest.exists && existingRequest.data().status === "pending") return json(res, 409, { error: "You already sent a request to this person." });
      if (reverse.exists && reverse.data().status === "pending") return json(res, 409, { error: "They already sent you a request. Accept it in your friends list." });
      await requestRef.set({ fromUid: uid, toUid: found.uid, fromUsername: socialUser.username, toUsername: found.profile.username, status: "pending", createdAt: Date.now() }, { merge: true });
      await addNotification(db, found.uid, { type: "friend_request", fromUid: uid, fromUsername: socialUser.username, text: `${socialUser.username} sent you a friend request.` });
      return json(res, 200, { ok: true });
    }
    if (["/api/features/friends/accept", "/api/features/friends/decline", "/api/features/friends/remove"].includes(path) && method === "POST") {
      const data = await body(req); const found = await profileByUsername(cleanText(data.username, 20));
      if (!found || found.uid === uid) return json(res, 404, { error: "Friend not found." });
      if (path.endsWith("/remove")) {
        await Promise.all([db.collection("mathnestUsers").doc(uid).collection("friends").doc(found.uid).delete(), db.collection("mathnestUsers").doc(found.uid).collection("friends").doc(uid).delete()]);
        return json(res, 200, { ok: true });
      }
      const requestRef = db.collection("mathnestFriendRequests").doc(`${found.uid}_${uid}`);
      const request = await requestRef.get();
      if (!request.exists || request.data().status !== "pending") return json(res, 404, { error: "That friend request is no longer pending." });
      if (path.endsWith("/decline")) { await requestRef.update({ status: "declined", updatedAt: Date.now() }); return json(res, 200, { ok: true }); }
      const batch = db.batch(); const now = Date.now();
      batch.set(db.collection("mathnestUsers").doc(uid).collection("friends").doc(found.uid), { status: "accepted", since: now, username: found.profile.username });
      batch.set(db.collection("mathnestUsers").doc(found.uid).collection("friends").doc(uid), { status: "accepted", since: now, username: socialUser.username });
      batch.update(requestRef, { status: "accepted", updatedAt: now }); await batch.commit();
      await addNotification(db, found.uid, { type: "friend_accepted", fromUid: uid, fromUsername: socialUser.username, text: `${socialUser.username} accepted your friend request.` });
      return json(res, 200, { ok: true });
    }

    // Notification center
    if (path === "/api/features/notifications" && method === "GET") return json(res, 200, { notifications: await listNotifications(db, uid) });
    if (path === "/api/features/notifications/read" && method === "POST") {
      const data = await body(req); const ref = db.collection("mathnestUsers").doc(uid).collection("notifications");
      if (data.all === true) { const snap = await ref.get(); const batch = db.batch(); snap.docs.filter(d => !d.data().read).forEach(d => batch.update(d.ref, { read: true })); await batch.commit(); }
      else if (data.id) { const doc = await ref.doc(String(data.id)).get(); if (doc.exists) await doc.ref.update({ read: true }); }
      return json(res, 200, { ok: true });
    }

    // Persistent one-to-one inbox and message history
    if (path === "/api/features/dms" && method === "GET") {
      const other = cleanText(url.searchParams.get("with"), 20);
      if (other) {
        const found = await profileByUsername(other);
        if (!found) return json(res, 404, { error: "That user wasn't found." });
        if (found.uid === uid) return json(res, 400, { error: "You can't DM yourself." });
        const pair = [uid, found.uid].sort(); const convId = pair.join("__");
        const ref = db.collection("mathnestConversations").doc(convId);
        let snap = await ref.get();
        // Preserve an existing legacy DM thread when both accounts have migrated.
        if (!snap.exists) {
          let legacy = { messages: [] };
          try { legacy = auth.dmThread(socialUser, found.profile.username, 0) || legacy; } catch {}
          if (Array.isArray(legacy.messages) && legacy.messages.length) {
            const oldMessages = legacy.messages.slice(-200);
            await db.runTransaction(async tx => {
              const current = await tx.get(ref);
              if (current.exists) return;
              const nextId = Math.max(0, ...oldMessages.map(m => Number(m.id) || 0));
              tx.set(ref, { members: pair, usernames: { [uid]: socialUser.username, [found.uid]: found.profile.username }, lastMessage: oldMessages[oldMessages.length - 1].text.slice(0, 160), updatedAt: oldMessages[oldMessages.length - 1].ts || Date.now(), nextMessageId: nextId, unread: {} });
              for (const old of oldMessages) tx.set(ref.collection("messages").doc(String(old.id).padStart(12, "0")), { id: Number(old.id), from: old.from, to: old.to, text: old.text, ts: old.ts });
            });
            snap = await ref.get();
          }
        }
        if (!snap.exists) return json(res, 200, { messages: [], conversation: { id: convId, username: found.profile.username } });
        const conversationData = snap.data();
        if (Number(conversationData.unread?.[uid]) > 0) await ref.set({ unread: { ...(conversationData.unread || {}), [uid]: 0 } }, { merge: true });
        const after = Math.max(0, Number(url.searchParams.get("after")) || 0);
        const messages = await ref.collection("messages").where("id", ">", after).orderBy("id", "asc").limit(100).get();
        return json(res, 200, { messages: messages.docs.map(d => d.data()), conversation: { id: convId, username: found.profile.username } });
      }
      const snap = await db.collection("mathnestConversations").where("members", "array-contains", uid).get();
      const conversations = [];
      for (const doc of snap.docs) { const d = doc.data(); const otherUid = (d.members || []).find(x => x !== uid); if (!otherUid) continue; const p = await profileForUid(otherUid); if (p) conversations.push({ username: p.username, displayName: p.displayName || p.username, avatar: p.avatar || "🎮", lastMessage: d.lastMessage || "", updatedAt: d.updatedAt || 0, unread: Number((d.unread || {})[uid]) || 0 }); }
      conversations.sort((a,b) => b.updatedAt - a.updatedAt);
      return json(res, 200, { conversations: conversations.slice(0, 60) });
    }
    if (path === "/api/features/dms" && method === "POST") {
      const data = await body(req); const target = cleanText(data.to, 20); const text = cleanText(data.text, 1000);
      if (!text) return json(res, 400, { error: "Write a message first." });
      const found = await profileByUsername(target);
      if (!found) return json(res, 404, { error: "That user wasn't found." });
      if (found.uid === uid) return json(res, 400, { error: "You can't DM yourself." });
      const pair = [uid, found.uid].sort(); const convId = pair.join("__"); const ref = db.collection("mathnestConversations").doc(convId); const now = Date.now();
      let message;
      await db.runTransaction(async tx => {
        const snap = await tx.get(ref); const nextId = (Number(snap.data()?.nextMessageId) || 0) + 1;
        message = { id: nextId, from: socialUser.username, to: found.profile.username, text, ts: now };
        tx.set(ref, { members: pair, usernames: { [uid]: socialUser.username, [found.uid]: found.profile.username }, lastMessage: text.slice(0, 160), updatedAt: now, nextMessageId: nextId, unread: { ...(snap.data()?.unread || {}), [found.uid]: (Number(snap.data()?.unread?.[found.uid]) || 0) + 1, [uid]: 0 } }, { merge: true });
        tx.set(ref.collection("messages").doc(String(nextId).padStart(12,"0")), message);
      });
      await addNotification(db, found.uid, { type: "dm", fromUid: uid, fromUsername: socialUser.username, text: `New message from ${socialUser.username}.` });
      return json(res, 200, { message });
    }

    // Spaces: create/join, channels, and persistent channel messages
    if (path === "/api/features/spaces" && method === "GET") {
      const snap = await db.collection("mathnestSpaces").limit(200).get();
      const spaces = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(s => s.visibility !== "private" || (s.members || []).includes(uid)).sort((a,b) => (b.updatedAt || 0) - (a.updatedAt || 0)).map(s => ({ ...spacePublic(s), isMember: (s.members || []).includes(uid) }));
      return json(res, 200, { spaces });
    }
    if (path === "/api/features/spaces" && method === "POST") {
      const data = await body(req); const name = cleanText(data.name, 36); const description = cleanText(data.description, 180);
      if (name.length < 3) return json(res, 400, { error: "Space names need at least 3 characters." });
      const channels = [{ id: "general", name: "general", topic: "The main conversation" }]; const ref = db.collection("mathnestSpaces").doc(); const now = Date.now();
      const space = { id: ref.id, name, description, owner: socialUser.username, ownerUid: uid, visibility: data.visibility === "private" ? "private" : "public", members: [uid], channels, createdAt: now, updatedAt: now };
      await ref.set(space); return json(res, 200, { space: spacePublic(space) });
    }
    const spaceMatch = path.match(/^\/api\/features\/spaces\/([a-zA-Z0-9_-]+)(?:\/(join|channels|messages|invite))?$/);
    if (spaceMatch) {
      const [, spaceId, action] = spaceMatch; const spaceRef = db.collection("mathnestSpaces").doc(spaceId); const spaceSnap = await spaceRef.get();
      if (!spaceSnap.exists) return json(res, 404, { error: "Space not found." });
      const space = { id: spaceSnap.id, ...spaceSnap.data() };
      if (action === "join" && method === "POST") {
        if (space.visibility === "private") return json(res, 403, { error: "This space is private; ask its owner for an invite." });
        if (!(space.members || []).includes(uid)) await spaceRef.update({ members: firebaseServices().FieldValue.arrayUnion(uid), updatedAt: Date.now() });
        return json(res, 200, { ok: true });
      }
      if (action === "invite" && method === "POST") {
        if (space.ownerUid !== uid) return json(res, 403, { error: "Only the space owner can invite members right now." });
        const data = await body(req); const target = await profileByUsername(cleanText(data.username, 20));
        if (!target) return json(res, 404, { error: "That user wasn't found." });
        if (target.uid === uid) return json(res, 400, { error: "You're already the owner of this space." });
        await spaceRef.update({ members: firebaseServices().FieldValue.arrayUnion(target.uid), updatedAt: Date.now() });
        await addNotification(db, target.uid, { type: "space_invite", fromUid: uid, fromUsername: socialUser.username, spaceId, spaceName: space.name, text: `${socialUser.username} invited you to ${space.name}.` });
        return json(res, 200, { ok: true });
      }
      if (!(space.members || []).includes(uid)) return json(res, 403, { error: "Join this space to use its channels." });
      if (action === "channels" && method === "POST") {
        if (space.ownerUid !== uid) return json(res, 403, { error: "Only the space owner can add channels right now." });
        const data = await body(req); const name = cleanText(data.name, 24).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, ""); const topic = cleanText(data.topic, 100);
        if (name.length < 2) return json(res, 400, { error: "Channel names need at least 2 characters." });
        if ((space.channels || []).some(c => c.name === name)) return json(res, 409, { error: "That channel already exists." });
        const channel = { id: `ch-${Date.now().toString(36)}`, name, topic }; await spaceRef.update({ channels: firebaseServices().FieldValue.arrayUnion(channel), updatedAt: Date.now() }); return json(res, 200, { channel });
      }
      if (action === "messages" && method === "GET") {
        const channelId = cleanText(url.searchParams.get("channel"), 60) || "general";
        if (!(space.channels || []).some(c => c.id === channelId)) return json(res, 404, { error: "Channel not found." });
        const snap = await spaceRef.collection("channels").doc(channelId).collection("messages").orderBy("ts", "desc").limit(100).get();
        return json(res, 200, { messages: snap.docs.map(d => d.data()).reverse() });
      }
      if (action === "messages" && method === "POST") {
        const data = await body(req); const channelId = cleanText(data.channel, 60) || "general"; const text = cleanText(data.text, 1000);
        if (!text) return json(res, 400, { error: "Write a message first." });
        if (!(space.channels || []).some(c => c.id === channelId)) return json(res, 404, { error: "Channel not found." });
        const ref = spaceRef.collection("channels").doc(channelId).collection("messages").doc(); const message = { id: ref.id, username: socialUser.username, displayName: socialUser.displayName || socialUser.username, avatar: socialUser.avatar || "🎮", text, ts: Date.now() };
        await ref.set(message); await spaceRef.update({ updatedAt: Date.now() }); return json(res, 200, { message });
      }
      return json(res, 405, { error: "Unsupported space action." });
    }
  }

  if (path === "/api/features/profile" && method === "GET") {
    const user = currentUser(req, url);
    if (!user) return json(res, 401, { error: "Log in to view your profile settings." });
    try {
      if (user.firebaseUid) {
        const stored = await profileForUid(user.firebaseUid);
        if (stored) return json(res, 200, { profile: publicUser(stored) });
      }
      const db = getDb();
      return json(res, 200, { profile: publicUser(db.users[user.key] || user) });
    } catch (error) {
      console.error("Firebase profile read failed:", error);
      return json(res, 503, { error: "Firebase profile storage is unavailable. Check the Firebase server configuration." });
    }
  }

  if (path === "/api/features/profile" && method === "POST") {
    const user = currentUser(req, url);
    if (!user) return json(res, 401, { error: "Log in to edit your profile." });
    let data;
    try { data = await body(req); } catch (e) { return json(res, 400, { error: e.message }); }
    const displayName = String(data.displayName || user.username).trim().replace(/[<>\u0000-\u001f]/g, "").slice(0, 24) || user.username;
    const bio = String(data.bio || "").trim().replace(/[<>\u0000-\u001f]/g, "").slice(0, 160);
    const avatar = AVATARS.includes(data.avatar) ? data.avatar : "🎮";
    const status = cleanText(data.status, 60);
    const banner = BANNERS.has(String(data.banner || "aurora")) ? String(data.banner || "aurora") : "aurora";
    const interests = Array.isArray(data.interests) ? [...new Set(data.interests.map(v => cleanText(v, 24)).filter(Boolean))].slice(0, 8) : [];
    const badges = Array.isArray(data.badges) ? [...new Set(data.badges.map(v => cleanText(v, 24)).filter(Boolean))].slice(0, 5) : [];
    try {
      if (user.firebaseUid) {
        const profile = await saveProfile(user.firebaseUid, { displayName, bio, avatar, status, banner, interests, badges });
        auth.syncFirebaseProfile(user.username, { displayName, bio, avatar });
        return json(res, 200, { profile: publicUser(profile || { ...user, displayName, bio, avatar, status, banner, interests, badges }) });
      }
      const result = withLock(() => {
        const db = getDb();
        const stored = db.users[user.key];
        if (!stored) return { error: 401, message: "Account not found." };
        stored.displayName = displayName; stored.bio = bio; stored.avatar = avatar; stored.status = status; stored.banner = banner; stored.interests = interests; stored.badges = badges;
        saveDb(db);
        return { profile: publicUser(stored) };
      });
      if (result.error) return json(res, result.error, { error: result.message });
      return json(res, 200, result);
    } catch (error) {
      console.error("Firebase profile save failed:", error);
      return json(res, 503, { error: "Could not save your profile to Firebase. Check the Firebase server configuration." });
    }
  }

  if (path === "/api/features/community" && method === "GET") {
    const db = getDb();
    const posts = (db.communityPosts || []).slice(-100).reverse();
    return json(res, 200, { posts });
  }

  if (path === "/api/features/community" && method === "POST") {
    const user = currentUser(req, url);
    if (!user) return json(res, 401, { error: "Log in to post in the community." });
    let data;
    try { data = await body(req); } catch (e) { return json(res, 400, { error: e.message }); }
    const text = String(data.text || "").trim().replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").slice(0, 280);
    if (!text) return json(res, 400, { error: "Write something first." });
    const result = withLock(() => {
      const db = getDb();
      db.communityPosts ||= [];
      db.nextCommunityId ||= 1;
      const stored = db.users[user.key] || user;
      const post = { id: db.nextCommunityId++, username: stored.username, avatar: stored.avatar || "🎮", displayName: stored.displayName || stored.username, text, ts: Date.now() };
      db.communityPosts.push(post);
      db.communityPosts = db.communityPosts.slice(-300);
      saveDb(db);
      return { post };
    });
    if (result.error) return json(res, result.error, { error: result.message });
    return json(res, 200, result);
  }

  const deleteMatch = path.match(/^\/api\/features\/community\/(\d+)$/);
  if (deleteMatch && method === "DELETE") {
    const user = currentUser(req, url);
    if (!user) return json(res, 401, { error: "Log in first." });
    const result = withLock(() => {
      const db = getDb();
      db.communityPosts ||= [];
      const post = db.communityPosts.find(p => p.id === Number(deleteMatch[1]));
      if (!post) return { error: 404, message: "Post not found." };
      if (post.username.toLowerCase() !== user.username.toLowerCase() && user.role !== "admin") return { error: 403, message: "You can only delete your own posts." };
      db.communityPosts = db.communityPosts.filter(p => p.id !== post.id);
      saveDb(db);
      return { ok: true };
    });
    if (result.error) return json(res, result.error, { error: result.message });
    return json(res, 200, result);
  }

  // Account-bound arcade progress. The browser can only submit bounded,
  // whitelisted fields; progress is stored on the user's server-side account.
  if (path === "/api/features/progress" && method === "GET") {
    const user = currentUser(req, url);
    if (!user) return json(res, 401, { error: "Log in to load your saved progress." });
    try {
      if (user.firebaseUid) {
        const stored = await profileForUid(user.firebaseUid);
        if (stored?.progress) return json(res, 200, { progress: stored.progress });
      }
      const db = getDb();
      const stored = db.users[user.key];
      const progress = stored?.progress || { gamesPlayed: {}, bestScores: {}, recentGames: [], favoriteGames: [] };
      return json(res, 200, { progress });
    } catch (error) {
      console.error("Firebase progress read failed:", error);
      return json(res, 503, { error: "Could not load saved progress from Firebase." });
    }
  }

  if (path === "/api/features/progress" && method === "POST") {
    const user = currentUser(req, url);
    if (!user) return json(res, 401, { error: "Log in to save your progress." });
    let data;
    try { data = await body(req, 12000); } catch (e) { return json(res, 400, { error: e.message }); }
    const allowedGames = new Set(["snake", "2048", "breakout", "flappy", "pong", "tetris", "dungeon"]);
    try {
      if (user.firebaseUid) {
        const progress = await saveProgress(user.firebaseUid, data);
        return json(res, 200, { progress });
      }
      const result = withLock(() => {
        const db = getDb();
        const stored = db.users[user.key];
        if (!stored) return { error: 401, message: "Account not found." };
        const progress = stored.progress ||= { gamesPlayed: {}, bestScores: {}, recentGames: [], favoriteGames: [] };
        progress.gamesPlayed ||= {}; progress.bestScores ||= {}; progress.recentGames ||= []; progress.favoriteGames ||= [];
        const game = String(data.game || "");
        if (data.event === "played" && allowedGames.has(game)) {
          progress.gamesPlayed[game] = Math.min(1000000, (Number(progress.gamesPlayed[game]) || 0) + 1);
          progress.recentGames = [game, ...progress.recentGames.filter((id) => id !== game)].slice(0, 8);
        }
        if (data.event === "score" && allowedGames.has(game)) {
          const score = Math.floor(Number(data.score));
          if (Number.isFinite(score) && score >= 0 && score <= 100000000) progress.bestScores[game] = Math.max(Number(progress.bestScores[game]) || 0, score);
        }
        if (Array.isArray(data.favoriteGames)) progress.favoriteGames = [...new Set(data.favoriteGames.filter((id) => allowedGames.has(String(id))).map(String))].slice(0, 8);
        progress.updatedAt = Date.now(); saveDb(db); return { progress };
      });
      if (result.error) return json(res, result.error, { error: result.message });
      return json(res, 200, result);
    } catch (error) {
      console.error("Firebase progress save failed:", error);
      return json(res, 503, { error: "Could not save progress to Firebase." });
    }
  }

  // Public suggestions feed; only signed-in accounts can submit an idea.
  if (path === "/api/features/suggestions" && method === "GET") {
    const db = getDb();
    return json(res, 200, { suggestions: (db.suggestions || []).slice(-80).reverse() });
  }

  if (path === "/api/features/suggestions" && method === "POST") {
    const user = currentUser(req, url);
    if (!user) return json(res, 401, { error: "Log in to send a suggestion." });
    let data;
    try { data = await body(req, 12000); } catch (e) { return json(res, 400, { error: e.message }); }
    const title = String(data.title || "").trim().replace(/[<>\u0000-\u001f]/g, "").slice(0, 70);
    const text = String(data.text || "").trim().replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").slice(0, 500);
    if (!title || !text) return json(res, 400, { error: "Add a title and a little detail first." });
    const result = withLock(() => {
      const db = getDb();
      db.suggestions ||= [];
      db.nextSuggestionId ||= 1;
      const stored = db.users[user.key] || user;
      const suggestion = { id: db.nextSuggestionId++, username: stored.username, avatar: stored.avatar || "🎮", title, text, ts: Date.now() };
      db.suggestions.push(suggestion);
      db.suggestions = db.suggestions.slice(-250);
      saveDb(db);
      return { suggestion };
    });
    if (result.error) return json(res, result.error, { error: result.message });
    return json(res, 200, result);
  }

  if (path === "/api/features/ai" && method === "POST") {
    const user = currentUser(req, url);
    if (!user) return json(res, 401, { error: "Log in to use MathNest AI." });
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return json(res, 503, { error: "MathNest AI isn't configured yet. Add OPENROUTER_API_KEY to your Wasmer app's environment variables." });
    const now = Date.now();
    const last = AI_LIMIT.get(user.key) || 0;
    if (now - last < 2500) return json(res, 429, { error: "Give the AI a second before sending another message." });
    AI_LIMIT.set(user.key, now);
    let data;
    try { data = await body(req, 20000); } catch (e) { return json(res, 400, { error: e.message }); }
    const messages = Array.isArray(data.messages) ? data.messages.slice(-12) : [];
    const clean = [];
    for (const m of messages) {
      if (!m || !["user", "assistant"].includes(m.role)) continue;
      const content = String(m.content || "").trim().slice(0, 3000);
      if (content) clean.push({ role: m.role, content });
    }
    if (!clean.length || clean[clean.length - 1].role !== "user") return json(res, 400, { error: "Send a message to get started." });
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json", "HTTP-Referer": process.env.SITE_URL || "https://mathnest.app", "X-Title": "MathNest AI" },
        body: JSON.stringify({ model: process.env.OPENROUTER_MODEL || "openrouter/free", messages: [{ role: "system", content: "You are MathNest AI, a friendly, concise assistant for learning, brainstorming, writing, and coding. Explain clearly, support learning instead of simply doing schoolwork when appropriate, and never claim you ran code unless you did. Do not request passwords, API keys, or sensitive personal information. Keep answers useful and age-appropriate." }, ...clean], temperature: 0.6, max_tokens: 1200 })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const msg = result?.error?.message || `AI provider returned ${response.status}.`;
        return json(res, 502, { error: msg.slice(0, 220) });
      }
      const reply = result?.choices?.[0]?.message?.content;
      if (!reply) return json(res, 502, { error: "The AI provider returned an empty reply." });
      return json(res, 200, { reply: String(reply).slice(0, 12000) });
    } catch (e) {
      return json(res, 502, { error: "Could not reach the AI provider. Try again in a moment." });
    }
  }

  return json(res, 404, { error: "Unknown feature endpoint." });
}
