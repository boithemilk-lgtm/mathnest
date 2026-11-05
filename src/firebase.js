// Firebase Admin integration for username-only MathNest accounts.
// All service-account credentials stay on the server in environment variables.
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

let initialized = null;

function config() {
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!apiKey || !raw) {
    throw new Error("Firebase is not configured. Set FIREBASE_WEB_API_KEY and FIREBASE_SERVICE_ACCOUNT_JSON in Wasmer environment variables.");
  }
  let serviceAccount;
  try { serviceAccount = JSON.parse(raw); }
  catch { throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON must contain valid service-account JSON."); }
  if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error("Firebase service-account JSON is missing project_id, client_email, or private_key.");
  }
  return { apiKey, serviceAccount };
}

export function firebaseServices() {
  if (initialized) return initialized;
  const { serviceAccount } = config();
  const app = getApps()[0] || initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id });
  initialized = { auth: getAuth(app), db: getFirestore(app), apiKey: config().apiKey, FieldValue };
  return initialized;
}

export function usernameEmail(username) {
  return `${String(username).trim().toLowerCase()}@login.mathnest.invalid`;
}

export function validateUsername(username) {
  return /^[a-zA-Z0-9_-]{3,20}$/.test(String(username || "").trim());
}

export async function lookupUsername(username) {
  const { db } = firebaseServices();
  const snap = await db.collection("mathnestUsernames").doc(String(username).trim().toLowerCase()).get();
  return snap.exists ? snap.data() : null;
}

export async function createFirebaseAccount(username, password, avatar, legacy = null) {
  const { auth, db } = firebaseServices();
  const key = String(username).trim().toLowerCase();
  if (!validateUsername(username)) throw Object.assign(new Error("Username must be 3-20 letters, numbers, _ or -"), { status: 400 });
  if (String(password || "").length < 6 || String(password || "").length > 100) throw Object.assign(new Error("Password must be 6-100 characters"), { status: 400 });
  const existing = await db.collection("mathnestUsernames").doc(key).get();
  if (existing.exists) throw Object.assign(new Error("That username is taken"), { status: 409 });

  let userRecord;
  try {
    userRecord = await auth.createUser({ email: usernameEmail(username), password: String(password), displayName: String(username), emailVerified: true, disabled: false });
  } catch (error) {
    if (error.code === "auth/email-already-exists") throw Object.assign(new Error("That username is already registered"), { status: 409 });
    throw error;
  }

  const now = Date.now();
  const hasAdmin = legacy ? Object.values(legacy).some((u) => u.role === "admin") : false;
  const role = legacy?.[key]?.role || (hasAdmin ? "user" : (Object.keys(legacy || {}).length ? "user" : "admin"));
  const old = legacy?.[key] || {};
  const profile = {
    uid: userRecord.uid,
    username: String(username).trim(),
    usernameKey: key,
    avatar: avatar || old.avatar || "🎮",
    displayName: old.displayName || String(username).trim(),
    bio: old.bio || "",
    role,
    created: old.created || now,
    msgCount: Number(old.msgCount) || 0,
    progress: old.progress || { gamesPlayed: {}, bestScores: {}, recentGames: [], favoriteGames: [] },
    achievements: old.achievements || {},
    migratedAt: legacy?.[key] ? now : null,
    updatedAt: now,
  };
  const batch = db.batch();
  batch.create(db.collection("mathnestUsernames").doc(key), { uid: userRecord.uid, username: profile.username, avatar: profile.avatar, role: profile.role, created: now });
  batch.set(db.collection("mathnestUsers").doc(userRecord.uid), profile);
  try { await batch.commit(); }
  catch (error) {
    try { await auth.deleteUser(userRecord.uid); } catch {}
    throw error;
  }
  return { uid: userRecord.uid, profile };
}

export async function signInFirebase(username, password) {
  const { apiKey } = firebaseServices();
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: usernameEmail(username), password: String(password || ""), returnSecureToken: true }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = data?.error?.message || "INVALID_LOGIN_CREDENTIALS";
    if (["EMAIL_NOT_FOUND", "INVALID_PASSWORD", "INVALID_LOGIN_CREDENTIALS", "USER_DISABLED"].includes(code)) {
      throw Object.assign(new Error("Wrong username or password"), { status: 401 });
    }
    throw Object.assign(new Error("Firebase sign-in failed. Check the Firebase API key and Authentication settings."), { status: 503 });
  }
  return data;
}

export async function profileForUid(uid) {
  const { db } = firebaseServices();
  const snap = await db.collection("mathnestUsers").doc(uid).get();
  return snap.exists ? snap.data() : null;
}

export async function saveProfile(uid, patch) {
  const { db, FieldValue } = firebaseServices();
  await db.collection("mathnestUsers").doc(uid).set({ ...patch, updatedAt: Date.now() }, { merge: true });
  return profileForUid(uid);
}

export async function saveProgress(uid, update) {
  const { db } = firebaseServices();
  const ref = db.collection("mathnestUsers").doc(uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw Object.assign(new Error("Account data not found."), { status: 404 });
    const data = snap.data();
    const progress = data.progress || { gamesPlayed: {}, bestScores: {}, recentGames: [], favoriteGames: [] };
    progress.gamesPlayed ||= {};
    progress.bestScores ||= {};
    progress.recentGames ||= [];
    progress.favoriteGames ||= [];
    const allowed = new Set(["snake", "2048", "breakout", "flappy", "pong", "tetris", "dungeon"]);
    const game = String(update.game || "");
    if (update.event === "played" && allowed.has(game)) {
      progress.gamesPlayed[game] = Math.min(1000000, (Number(progress.gamesPlayed[game]) || 0) + 1);
      progress.recentGames = [game, ...progress.recentGames.filter((id) => id !== game)].slice(0, 8);
    }
    if (update.event === "score" && allowed.has(game)) {
      const score = Math.floor(Number(update.score));
      if (Number.isFinite(score) && score >= 0 && score <= 100000000) progress.bestScores[game] = Math.max(Number(progress.bestScores[game]) || 0, score);
    }
    if (Array.isArray(update.favoriteGames)) progress.favoriteGames = [...new Set(update.favoriteGames.filter((id) => allowed.has(String(id))).map(String))].slice(0, 8);
    progress.updatedAt = Date.now();
    tx.update(ref, { progress, updatedAt: Date.now() });
    return progress;
  });
}

export async function verifyFirebaseIdToken(idToken) {
  const { auth } = firebaseServices();
  return auth.verifyIdToken(idToken, true);
}
