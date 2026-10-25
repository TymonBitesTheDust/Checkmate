// Test double for the parts of the Firebase SDK that sync.js uses.
// The "server" lives in the Playwright test process and is reached
// through window.mockCall (exposed with page.exposeFunction).

let listenerSeq = 0;
const listeners = {};
window.__mockDeliver = (lid, docs) => {
  const l = listeners[lid];
  if (l) l(docs);
};
window.__mockOnline = true;

const call = (op, args) => window.mockCall(op, JSON.stringify(args)).then((r) => (r ? JSON.parse(r) : r));

// ---------- app ----------
export function initializeApp(cfg, name) {
  return { cfg, name };
}
export async function deleteApp() {}

// ---------- auth ----------
const authState = { user: null, cbs: new Set() };
function emit() {
  authState.cbs.forEach((cb) => cb(authState.user));
}
export const indexedDBLocalPersistence = 'idb';
export const browserLocalPersistence = 'local';
export const inMemoryPersistence = 'mem';
export function initializeAuth() {
  try {
    authState.user = JSON.parse(localStorage.getItem('mock.auth') || 'null');
  } catch {
    authState.user = null;
  }
  const auth = {};
  Object.defineProperty(auth, 'currentUser', { get: () => authState.user });
  return auth;
}
export function onAuthStateChanged(auth, cb) {
  authState.cbs.add(cb);
  setTimeout(() => cb(authState.user), 10);
  return () => authState.cbs.delete(cb);
}
function setUser(u) {
  authState.user = u;
  localStorage.setItem('mock.auth', JSON.stringify(u));
  emit();
}
export async function signInWithEmailAndPassword(auth, email, password) {
  const r = await call('signIn', { email, password });
  if (r.error) throw Object.assign(new Error(r.error), { code: r.error });
  setUser({ uid: r.uid, email });
}
export async function createUserWithEmailAndPassword(auth, email, password) {
  const r = await call('signUp', { email, password });
  if (r.error) throw Object.assign(new Error(r.error), { code: r.error });
  setUser({ uid: r.uid, email });
}
export async function sendPasswordResetEmail() {}
export async function signOut() {
  setUser(null);
}

// ---------- firestore ----------
export function memoryLocalCache() {
  return {};
}
export function initializeFirestore() {
  return { db: true };
}
export function collection(db, ...path) {
  return { path };
}
export function doc(db, ...path) {
  return { path, id: path[path.length - 1] };
}
export const where = (field, op, value) => ({ field, op, value });
export const orderBy = (f) => ({ orderBy: f });
export function query(col, w) {
  return { path: col.path, since: w.value.ms };
}
export class Timestamp {
  constructor(ms) {
    this.ms = ms;
  }
  static fromMillis(ms) {
    return new Timestamp(ms);
  }
  toMillis() {
    return this.ms;
  }
}
export const serverTimestamp = () => ({ __srv: true });

// Items (users/{uid}/items/{id}) go through 'commit' as before; any other document
// (task files: users/{uid}/files/...) goes through the plain document calls below.
const isItem = (ref) => ref.path.length === 4 && ref.path[2] === 'items';
const pathOf = (ref) => ref.path.join('/');

export class Bytes {
  constructor(b64) {
    this.b64 = b64;
  }
  static fromUint8Array(u8) {
    let bin = '';
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return new Bytes(btoa(bin));
  }
  toUint8Array() {
    const bin = atob(this.b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }
}
const pack = (data) => JSON.parse(JSON.stringify(data, (k, v) => (v instanceof Bytes ? { __bytes: v.b64 } : v && v.__srv ? { __srv: true } : v)));
const unpack = (data) => {
  if (!data) return data;
  const out = {};
  for (const [k, v] of Object.entries(data)) out[k] = v && v.__bytes != null ? new Bytes(v.__bytes) : v;
  return out;
};
async function online() {
  while (!window.__mockOnline) await new Promise((r) => setTimeout(r, 100));
}
export async function setDoc(ref, data) {
  await online();
  const r = await call('fset', { path: pathOf(ref), data: pack(data) });
  if (r && r.error) throw Object.assign(new Error(r.error), { code: r.error });
}
export async function deleteDoc(ref) {
  await online();
  await call('fset', { path: pathOf(ref), data: null });
}
export async function getDoc(ref) {
  await online();
  const r = await call('fget', { path: pathOf(ref) });
  if (r && r.error) throw Object.assign(new Error(r.error), { code: r.error });
  const data = r && r.data ? unpack(r.data) : null;
  return { exists: () => !!data, data: () => data, id: ref.id };
}

export function writeBatch() {
  const writes = [];
  const docs = [];
  return {
    set(ref, data) {
      if (!isItem(ref)) return void docs.push({ path: pathOf(ref), data: pack(data) });
      const clean = { ...data };
      delete clean.srv;
      writes.push({ uid: ref.path[1], id: ref.id, data: clean });
    },
    delete(ref) {
      docs.push({ path: pathOf(ref), data: null });
    },
    async commit() {
      // While "offline", hold the commit until the network returns (like the SDK does).
      await online();
      if (docs.length) {
        const r = await call('fcommit', { docs });
        if (r && r.error) throw Object.assign(new Error(r.error), { code: r.error });
      }
      if (!writes.length) return;
      const r = await call('commit', { writes });
      if (r && r.error) throw Object.assign(new Error(r.error), { code: r.error });
    },
  };
}

export function onSnapshot(q, next, error) {
  const lid = `${Date.now()}-${++listenerSeq}`;
  const toSnap = (docs) => ({
    metadata: { fromCache: false },
    docChanges: () => docs.map((d) => ({ type: 'modified', doc: { data: () => ({ ...d, srv: new Timestamp(d.srv) }) } })),
  });
  listeners[lid] = (docs) => {
    if (window.__mockOnline) next(toSnap(docs));
  };
  call('listen', { lid, uid: q.path[1], since: q.since }).then((r) => {
    if (r && r.error) error(Object.assign(new Error(r.error), { code: r.error }));
    else next(toSnap(r.docs));
  });
  return () => {
    delete listeners[lid];
    call('unlisten', { lid });
  };
}
