// Files attached to tasks, up to 100 MB each.
//
// A task lists its files in task.files: [{ id, name, size, type, addedAt }], which syncs
// like any other field. The bytes are kept:
//   - on this device, in IndexedDB ("checkmate-files"), so they open offline;
//   - when sync is on, in the user's own Firestore, cut into pieces small enough for
//     Firestore documents (the free Spark plan has no Cloud Storage):
//       users/{uid}/files/{fileId}               { name, size, type, parts, done, at }
//       users/{uid}/files/{fileId}/parts/{n}     { i, data: bytes (up to 768 KB) }
// Other devices fetch a file's pieces when it's opened. Uploads resume where they stopped.
import { doc, collection, writeBatch, getDoc, setDoc, deleteDoc, Bytes, serverTimestamp } from 'firebase/firestore';
import * as store from './store.js';
import * as sync from './sync.js';
import { newId } from './store.js';

export const MAX_BYTES = 100 * 1024 * 1024;
const PART = 768 * 1024;
const PARTS_PER_COMMIT = 8;
const QUEUE_KEY = 'tickwise.filequeue.v1';
const DELETE_KEY = 'tickwise.filedelete.v1';
const ORPHAN_DAYS = 3;

// ---------- progress (for the interface) ----------

const progress = new Map(); // id → { kind: 'up'|'down', done, total, error }
const watchers = new Set();
export const progressOf = (id) => progress.get(id) || null;
export function onProgress(fn) {
  watchers.add(fn);
  return () => watchers.delete(fn);
}
function setProgress(id, p) {
  if (p) progress.set(id, p);
  else progress.delete(id);
  watchers.forEach((fn) => fn(id));
}

// ---------- IndexedDB ----------

let dbp = null;
function idb() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('no IndexedDB'));
      const req = indexedDB.open('checkmate-files', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('files', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbp.catch(() => (dbp = null));
  }
  return dbp;
}
async function tx(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const t = db.transaction('files', mode);
    const os = t.objectStore('files');
    let out;
    const r = fn(os);
    if (r) r.onsuccess = () => (out = r.result);
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('aborted'));
  });
}
const localGet = (id) => tx('readonly', (os) => os.get(id)).catch(() => null);
const localPut = (rec) => tx('readwrite', (os) => os.put(rec));
const localDel = (id) => tx('readwrite', (os) => os.delete(id)).catch(() => {});
const localAll = () => tx('readonly', (os) => os.getAll()).catch(() => []);

const localIds = new Set();
let localKnown = false;
export const isLocal = (id) => localIds.has(id);
async function refreshLocal() {
  const all = await localAll();
  localIds.clear();
  for (const r of all || []) localIds.add(r.id);
  localKnown = true;
  watchers.forEach((fn) => fn(null));
}

// ---------- adding, opening, removing ----------

export function sizeText(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

// Adds files (File objects) to a task. Returns { added, tooBig } (names of skipped files).
export async function addFiles(taskId, fileList) {
  const t = store.get(taskId);
  if (!t) return { added: [], tooBig: [] };
  const added = [];
  const tooBig = [];
  for (const f of fileList) {
    if (f.size > MAX_BYTES) {
      tooBig.push(f.name);
      continue;
    }
    const meta = { id: `f${newId()}`, name: f.name || 'file', size: f.size, type: f.type || '', addedAt: Date.now() };
    await localPut({ ...meta, taskId, blob: f, uploadedTo: null });
    localIds.add(meta.id);
    added.push(meta);
  }
  if (added.length) {
    const cur = store.get(taskId);
    store.patch(taskId, { files: [...((cur && cur.files) || []), ...added] });
    const q = queue();
    for (const m of added) q.push({ id: m.id, next: 0 });
    saveQueue(q);
    pump();
  }
  return { added, tooBig };
}

// The file's bytes as a Blob: from this device, or fetched from sync (then kept here).
export async function getBlob(meta) {
  const rec = await localGet(meta.id);
  if (rec && rec.blob) return rec.blob;
  const blob = await download(meta);
  await localPut({ ...meta, blob, uploadedTo: (sync.remote() || {}).uid || null });
  localIds.add(meta.id);
  return blob;
}

export async function removeFile(taskId, fileId) {
  const t = store.get(taskId);
  if (t) store.patch(taskId, { files: (t.files || []).filter((f) => f.id !== fileId) });
  saveQueue(queue().filter((q) => q.id !== fileId));
  await localDel(fileId);
  localIds.delete(fileId);
  const d = deletions();
  d.push(fileId);
  saveDeletions(d);
  pump();
}

// ---------- queues ----------

function readJSON(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch {
    return [];
  }
}
const queue = () => readJSON(QUEUE_KEY);
const saveQueue = (q) => localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
const deletions = () => readJSON(DELETE_KEY);
const saveDeletions = (d) => localStorage.setItem(DELETE_KEY, JSON.stringify([...new Set(d)].slice(-500)));
export const pendingUploads = () => queue().length;

let pumping = false;
let retry = null;
export async function pump() {
  const r = sync.remote();
  if (!r || pumping) return;
  pumping = true;
  clearTimeout(retry);
  try {
    for (const id of deletions()) {
      await deleteRemote(r, id);
      saveDeletions(deletions().filter((x) => x !== id));
    }
    let q;
    while ((q = queue()).length) {
      const job = q[0];
      const ok = await upload(r, job);
      saveQueue(queue().filter((x) => x.id !== job.id));
      if (!ok) continue;
    }
  } catch (e) {
    console.warn('Checkmate files', e);
    retry = setTimeout(pump, 30000);
  } finally {
    pumping = false;
  }
}

async function upload({ db, uid }, job) {
  const rec = await localGet(job.id);
  if (!rec || !rec.blob) return false; // removed meanwhile
  const parts = Math.max(1, Math.ceil(rec.size / PART));
  const metaRef = doc(db, 'users', uid, 'files', job.id);
  let next = job.next || 0;
  setProgress(job.id, { kind: 'up', done: next, total: parts });
  try {
    while (next < parts) {
      const batch = writeBatch(db);
      const end = Math.min(parts, next + PARTS_PER_COMMIT);
      for (let i = next; i < end; i++) {
        const buf = new Uint8Array(await rec.blob.slice(i * PART, Math.min(rec.size, (i + 1) * PART)).arrayBuffer());
        batch.set(doc(db, 'users', uid, 'files', job.id, 'parts', String(i)), { i, data: Bytes.fromUint8Array(buf) });
      }
      await batch.commit();
      next = end;
      saveQueue(queue().map((x) => (x.id === job.id ? { ...x, next } : x)));
      setProgress(job.id, { kind: 'up', done: next, total: parts });
    }
    await setDoc(metaRef, { name: rec.name, size: rec.size, type: rec.type || '', parts, done: true, at: serverTimestamp() });
    await localPut({ ...rec, uploadedTo: uid });
    setProgress(job.id, null);
    return true;
  } catch (e) {
    setProgress(job.id, { kind: 'up', done: next, total: parts, error: true });
    throw e;
  }
}

async function download(meta) {
  const r = sync.remote();
  if (!r) throw Object.assign(new Error('offline'), { code: 'not-here' });
  const { db, uid } = r;
  const snap = await getDoc(doc(db, 'users', uid, 'files', meta.id));
  const m = snap.exists() ? snap.data() : null;
  if (!m || !m.done) throw Object.assign(new Error('not uploaded'), { code: 'not-uploaded' });
  const out = new Array(m.parts);
  let got = 0;
  setProgress(meta.id, { kind: 'down', done: 0, total: m.parts });
  try {
    let i = 0;
    const worker = async () => {
      while (i < m.parts) {
        const n = i++;
        const ps = await getDoc(doc(db, 'users', uid, 'files', meta.id, 'parts', String(n)));
        if (!ps.exists()) throw Object.assign(new Error('missing part'), { code: 'not-uploaded' });
        out[n] = ps.data().data.toUint8Array();
        got++;
        setProgress(meta.id, { kind: 'down', done: got, total: m.parts });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  } catch (e) {
    setProgress(meta.id, null);
    throw e;
  }
  setProgress(meta.id, null);
  return new Blob(out, { type: m.type || meta.type || '' });
}

async function deleteRemote({ db, uid }, id) {
  const snap = await getDoc(doc(db, 'users', uid, 'files', id));
  const parts = snap.exists() ? snap.data().parts || 0 : 140;
  for (let i = 0; i < parts; i += 400) {
    const batch = writeBatch(db);
    for (let n = i; n < Math.min(parts, i + 400); n++) batch.delete(doc(db, 'users', uid, 'files', id, 'parts', String(n)));
    await batch.commit();
  }
  await deleteDoc(doc(db, 'users', uid, 'files', id));
}

// ---------- start-up: upload what's missing, tidy files whose task is gone ----------

const referenced = () => {
  const ids = new Set();
  for (const t of store.all('task')) for (const f of t.files || []) ids.add(f.id);
  return ids;
};

async function catchUp() {
  const r = sync.remote();
  const all = (await localAll()) || [];
  const refs = referenced();
  const q = queue();
  const queued = new Set(q.map((x) => x.id));
  const now = Date.now();
  for (const rec of all) {
    if (!refs.has(rec.id)) {
      // the task (or the file) was deleted: forget it after a few days (Undo may bring it back)
      if (!rec.orphanSince) await localPut({ ...rec, orphanSince: now });
      else if (now - rec.orphanSince > ORPHAN_DAYS * 86400000) {
        await localDel(rec.id);
        localIds.delete(rec.id);
        if (rec.uploadedTo) saveDeletions([...deletions(), rec.id]);
      }
      continue;
    }
    if (rec.orphanSince) await localPut({ ...rec, orphanSince: null });
    if (r && rec.uploadedTo !== r.uid && !queued.has(rec.id)) q.push({ id: rec.id, next: 0 });
  }
  saveQueue(q);
  pump();
}

export function start() {
  refreshLocal().then(catchUp);
  sync.onReady(() => catchUp());
  window.addEventListener('online', () => pump());
}

export const ready = () => localKnown;
