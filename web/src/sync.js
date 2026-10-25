// Firebase sync: each signed-in user gets users/{uid}/items/{itemId}.
// Local changes are queued in the store's dirty set and pushed in batches;
// remote changes stream in through a live query ordered by server time.
import { initializeApp, deleteApp } from 'firebase/app';
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence,
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signOut,
} from 'firebase/auth';
import {
  initializeFirestore, memoryLocalCache, collection, query, where, orderBy, onSnapshot,
  writeBatch, doc, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import * as store from './store.js';
import { tr } from './i18n.js';

let app = null;
let auth = null;
let db = null;
let unsubAuth = null;
let unsubSnap = null;
let pushTimer = null;
let retryTimer = null;
let pushing = false;
let currentUid = null;

const state = { status: 'off', error: null, email: null, lastSync: null };
const listeners = new Set();
const readyListeners = new Set();

// For task files (files.js): the signed-in Firestore, or null.
export const remote = () => (db && currentUid ? { db, uid: currentUid } : null);
export function onReady(fn) {
  readyListeners.add(fn);
  return () => readyListeners.delete(fn);
}

export const getSyncState = () => ({ ...state, pending: store.dirtyCount() });
export function onSyncState(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function setState(p) {
  Object.assign(state, p);
  const snap = getSyncState();
  listeners.forEach((f) => f(snap));
}

// ---------- config & setup codes ----------

const REQUIRED = ['apiKey', 'projectId'];

export function parseConfig(text) {
  const raw = (text || '').trim();
  if (!raw) throw new Error(tr('Paste your Firebase config or a setup code first.'));
  let obj = null;
  if (/^TW1-/.test(raw)) {
    try {
      const b64 = raw.slice(4).replace(/-/g, '+').replace(/_/g, '/');
      obj = JSON.parse(decodeURIComponent(escape(atob(b64))));
    } catch {
      throw new Error(tr('That setup code is incomplete. Copy it again from your other device.'));
    }
  } else {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end < start) throw new Error(tr('Could not find the { … } config block. Copy the firebaseConfig object from Firebase project settings.'));
    let body = raw.slice(start, end + 1);
    try {
      obj = JSON.parse(body);
    } catch {
      body = body
        .replace(/\/\/.*$/gm, '')
        .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
        .replace(/'([^']*)'/g, '"$1"')
        .replace(/,\s*}/g, '}');
      try {
        obj = JSON.parse(body);
      } catch {
        throw new Error(tr('The config could not be read. Copy the whole firebaseConfig = { … } block.'));
      }
    }
  }
  for (const k of REQUIRED) {
    if (!obj[k]) throw new Error(tr('The config is missing “{k}”. Copy it again from Firebase project settings.', { k }));
  }
  const keep = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];
  const out = {};
  keep.forEach((k) => obj[k] && (out[k] = String(obj[k])));
  if (!out.authDomain) out.authDomain = `${out.projectId}.firebaseapp.com`;
  return out;
}

export function makeSetupCode(cfg) {
  const json = JSON.stringify(cfg);
  const b64 = btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `TW1-${b64}`;
}

// ---------- errors ----------

export function friendly(e) {
  const code = (e && e.code) || '';
  const map = {
    'auth/invalid-email': 'That email address isn’t valid.',
    'auth/missing-email': 'Enter your email address.',
    'auth/missing-password': 'Enter your password.',
    'auth/invalid-credential': 'Email or password is incorrect.',
    'auth/wrong-password': 'Email or password is incorrect.',
    'auth/user-not-found': 'No account uses this email yet. Choose “Create account”.',
    'auth/invalid-login-credentials': 'Email or password is incorrect.',
    'auth/email-already-in-use': 'An account with this email already exists. Choose “Sign in”.',
    'auth/weak-password': 'Use a password with at least 6 characters.',
    'auth/operation-not-allowed': 'Email/Password sign-in is off in your Firebase project. Turn it on in Authentication → Sign-in method.',
    'auth/configuration-not-found': 'Authentication isn’t set up in your Firebase project. Open Authentication, click Get started, then enable Email/Password.',
    'auth/api-key-not-valid': 'The API key in your config isn’t valid. Copy the config again from Firebase project settings.',
    'auth/invalid-api-key': 'The API key in your config isn’t valid. Copy the config again from Firebase project settings.',
    'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'The API key in your config isn’t valid. Copy the config again from Firebase project settings.',
    'auth/network-request-failed': 'Can’t reach Firebase. Check your internet connection.',
    'auth/too-many-requests': 'Too many attempts. Wait a minute, then try again.',
    'auth/user-disabled': 'This account has been disabled in your Firebase project.',
    'permission-denied': 'Firestore rules are blocking sync. Paste the rules from the setup guide into Firestore → Rules and click Publish.',
    'not-found': 'There’s no Firestore database in this project yet. Create one in the Firebase console (Firestore Database → Create database).',
    'failed-precondition': 'Firestore isn’t ready in this project. Create the database in the Firebase console, then try again.',
    'unauthenticated': 'Your sign-in expired. Sign in again.',
    'resource-exhausted': 'Firebase’s free daily quota is used up. Sync resumes tomorrow; your changes are kept on this device.',
  };
  if (map[code]) return tr(map[code]);
  const msg = (e && e.message) || String(e);
  if (/database.*does not exist/i.test(msg)) return tr(map['not-found']);
  if (/api[- ]key/i.test(msg)) return tr(map['auth/invalid-api-key']);
  return msg.replace(/^Firebase:\s*/, '').replace(/\s*\(.*\)\.?$/, '');
}

// ---------- lifecycle ----------

export async function start() {
  await stop();
  const cfg = store.getPrefs().firebaseConfig;
  if (!cfg) {
    setState({ status: 'off', error: null, email: null });
    return;
  }
  try {
    app = initializeApp(cfg, 'tickwise');
    auth = initializeAuth(app, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence],
    });
    db = initializeFirestore(app, { localCache: memoryLocalCache() });
  } catch (e) {
    setState({ status: 'error', error: friendly(e) });
    return;
  }
  setState({ status: 'connecting', error: null });
  unsubAuth = onAuthStateChanged(auth, (user) => {
    if (user) onSignedIn(user);
    else {
      stopListening();
      currentUid = null;
      setState({ status: 'signed-out', email: null });
    }
  });
}

export async function stop() {
  stopListening();
  if (unsubAuth) unsubAuth();
  unsubAuth = null;
  if (app) {
    try {
      await deleteApp(app);
    } catch {}
  }
  app = auth = db = null;
  currentUid = null;
}

function stopListening() {
  if (unsubSnap) unsubSnap();
  unsubSnap = null;
  clearTimeout(retryTimer);
}

function onSignedIn(user) {
  const prefs = store.getPrefs();
  if (prefs.syncUid !== user.uid) {
    // First sync for this account on this device: upload everything local.
    store.markAllDirty();
    store.setPrefs({ syncUid: user.uid, syncEmail: user.email, lastServerTime: 0 });
  }
  currentUid = user.uid;
  setState({ status: 'syncing', email: user.email, error: null });
  listen();
  schedulePush(0);
  setTimeout(() => readyListeners.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.warn('Checkmate sync ready', e);
    }
  }), 1500);
}

function listen() {
  stopListening();
  if (!db || !currentUid) return;
  const since = Math.max(0, (store.getPrefs().lastServerTime || 0) - 60000);
  const col = collection(db, 'users', currentUid, 'items');
  const q = query(col, where('srv', '>', Timestamp.fromMillis(since)), orderBy('srv'));
  unsubSnap = onSnapshot(
    q,
    (snap) => {
      let maxSrv = store.getPrefs().lastServerTime || 0;
      snap.docChanges().forEach((ch) => {
        if (ch.type === 'removed') return;
        const data = ch.doc.data({ serverTimestamps: 'none' });
        if (!data || !data.srv) return;
        const ms = data.srv.toMillis();
        if (ms > maxSrv) maxSrv = ms;
        store.applyRemote(data);
      });
      if (maxSrv > (store.getPrefs().lastServerTime || 0)) store.setPrefs({ lastServerTime: maxSrv });
      const offline = snap.metadata.fromCache && !navigator.onLine;
      setState({
        status: offline ? 'offline' : store.dirtyCount() ? 'syncing' : 'synced',
        lastSync: offline ? state.lastSync : Date.now(),
        error: null,
      });
    },
    (err) => {
      setState({ status: 'error', error: friendly(err) });
      retryTimer = setTimeout(listen, 30000);
    },
  );
}

export function schedulePush(delay = 800) {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, delay);
}

async function push() {
  if (!db || !currentUid || pushing) return;
  const items = store.dirtyItems();
  if (!items.length) return;
  pushing = true;
  setState({ status: navigator.onLine ? 'syncing' : 'offline' });
  const uid = currentUid;
  try {
    for (let i = 0; i < items.length; i += 400) {
      const chunk = items.slice(i, i + 400);
      const batch = writeBatch(db);
      for (const it of chunk) {
        const data = JSON.parse(JSON.stringify(it));
        data.srv = serverTimestamp();
        batch.set(doc(db, 'users', uid, 'items', it.id), data);
      }
      await batch.commit();
      chunk.forEach((it) => store.markClean(it.id, it.updatedAt));
    }
    setState({ status: 'synced', lastSync: Date.now(), error: null });
  } catch (e) {
    setState({ status: 'error', error: friendly(e) });
    pushing = false;
    schedulePush(20000);
    return;
  }
  pushing = false;
  if (store.dirtyCount()) schedulePush(500);
}

export function syncNow() {
  if (!currentUid) return;
  listen();
  schedulePush(0);
}

// ---------- account actions ----------

function needAuth() {
  if (!auth) throw new Error(tr('Add your Firebase config first.'));
}

export async function signIn(email, password) {
  needAuth();
  try {
    await signInWithEmailAndPassword(auth, email.trim(), password);
  } catch (e) {
    throw new Error(friendly(e));
  }
}

export async function signUp(email, password) {
  needAuth();
  try {
    await createUserWithEmailAndPassword(auth, email.trim(), password);
  } catch (e) {
    throw new Error(friendly(e));
  }
}

export async function resetPassword(email) {
  needAuth();
  try {
    await sendPasswordResetEmail(auth, email.trim());
  } catch (e) {
    throw new Error(friendly(e));
  }
}

export async function signOutSync() {
  if (auth) await signOut(auth);
  store.setPrefs({ syncUid: null, syncEmail: null, lastServerTime: 0 });
}

export async function setConfig(cfg) {
  store.setPrefs({ firebaseConfig: cfg, syncUid: null, syncEmail: null, lastServerTime: 0 });
  await start();
}

export async function removeConfig() {
  if (auth && auth.currentUser) {
    try {
      await signOut(auth);
    } catch {}
  }
  store.setPrefs({ firebaseConfig: null, syncUid: null, syncEmail: null, lastServerTime: 0 });
  await start();
}

// Push local changes soon after they happen, and when the network returns.
export function wire() {
  store.subscribe(() => {
    if (store.dirtyCount() && currentUid) schedulePush(700);
  });
  window.addEventListener('online', () => {
    setState({ status: currentUid ? 'syncing' : state.status });
    syncNow();
  });
  window.addEventListener('offline', () => currentUid && setState({ status: 'offline' }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncNow();
    else store.flush();
  });
}
