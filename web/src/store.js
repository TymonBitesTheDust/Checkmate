// Local-first data store. Every record is an "item" with an id, a type and an
// updatedAt timestamp. Deletions are kept as tombstones so they can sync.

const DB_KEY = 'tickwise.db.v1';
const DIRTY_KEY = 'tickwise.dirty.v1';
const PREF_KEY = 'tickwise.prefs.v1';
const DEVICE_KEY = 'tickwise.device.v1';

export const newId = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

let items = {};
let dirty = new Set();
let prefs = {};
const listeners = new Set();
let version = 0;
let notifyQueued = false;

export let deviceId = '';

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error('Could not save', key, e);
  }
}

let persistTimer = null;
function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(flush, 120);
}

export function flush() {
  clearTimeout(persistTimer);
  writeJSON(DB_KEY, items);
  writeJSON(DIRTY_KEY, [...dirty]);
}

function notify() {
  version++;
  if (notifyQueued) return;
  notifyQueued = true;
  queueMicrotask(() => {
    notifyQueued = false;
    listeners.forEach((fn) => fn(version));
  });
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const getVersion = () => version;

// Ask the interface to redraw without changing any data (e.g. a spinner starts).
export const touch = () => notify();

// The stored record even if it was deleted (tombstones keep id, type and dates).
export const raw = (id) => items[id] || null;

// ---------- prefs (device-local, never synced) ----------

const DEFAULT_PREFS = {
  theme: 'system',
  skin: 'tickwise',
  accent: 'orange',
  accentVars: null,
  // the app's own icon (Windows shortcuts and .exe, Android home screen) follows the style
  iconFollowsStyle: true,
  // Persona 5 style: animations ('system' follows the device, 'full' or 'reduced') and the star field
  motion: 'system',
  stars: true,
  startView: 'today',
  weekStart: 1,
  timeFormat: guessTimeFormat(),
  dateOrder: guessDateOrder(),
  // quick add: a typed time ("at 5pm") sets the due time and stays in the task name
  keepTimeInName: true,
  dailyGoal: 5,
  firebaseConfig: null,
  syncUid: null,
  syncEmail: null,
  lastServerTime: 0,
  collapsed: {},
  todaySort: 'priority',
  showCompleted: false,
  // Settings → General: finished tasks leave every project list and board (even where a
  // project's ⋯ menu shows them); finished subtasks leave the task panel and project lists
  hideDoneTasks: false,
  hideDoneSubtasks: false,
  sound: true,
  soundLevel: null,
  soundVolume: 0.6,
  // calendar (this device)
  calView: null,
  calHidden: {},
  calShowTasks: true,
  calShowDone: true,
  calWeekends: true,
  calDuration: 60,
  calInLists: true,
  calSyncEvery: 30,
  calSync: {},
};

function guessTimeFormat() {
  try {
    const s = new Date(2020, 0, 1, 15).toLocaleTimeString([], { hour: 'numeric' });
    return /pm|am/i.test(s) ? '12' : '24';
  } catch {
    return '24';
  }
}

function guessDateOrder() {
  try {
    const s = new Date(2020, 10, 22).toLocaleDateString();
    return s.indexOf('11') < s.indexOf('22') ? 'mdy' : 'dmy';
  } catch {
    return 'dmy';
  }
}

export function getPrefs() {
  return prefs;
}

export function setPrefs(patch) {
  prefs = { ...prefs, ...patch };
  writeJSON(PREF_KEY, prefs);
  notify();
}

// ---------- items ----------

export function init() {
  items = readJSON(DB_KEY, {});
  dirty = new Set(readJSON(DIRTY_KEY, []));
  prefs = { ...DEFAULT_PREFS, ...readJSON(PREF_KEY, {}) };
  // 2.2.0: the default colour changed from Pine to Checkmate orange. Pine was saved as the
  // default (with no colour values), so it moves to the new default; Pine is still a choice.
  if (!prefs.accentV2) {
    if (!prefs.accent || (prefs.accent === 'pine' && !prefs.accentVars)) prefs = { ...prefs, accent: 'orange', accentVars: null };
    prefs.accentV2 = true;
    writeJSON(PREF_KEY, prefs);
  }
  deviceId = localStorage.getItem(DEVICE_KEY);
  if (!deviceId) {
    deviceId = newId();
    localStorage.setItem(DEVICE_KEY, deviceId);
  }
  seed();
  purgeOldTombstones();
}

export const get = (id) => {
  const it = items[id];
  return it && !it.deleted ? it : null;
};

export function all(type) {
  const out = [];
  for (const id in items) {
    const it = items[id];
    if (!it.deleted && it.type === type) out.push(it);
  }
  return out;
}

function stamp(prev) {
  return Math.max(Date.now(), (prev?.updatedAt || 0) + 1);
}

export function put(item) {
  const prev = items[item.id];
  const next = { ...item, updatedAt: stamp(prev), dev: deviceId };
  delete next.deleted;
  items[item.id] = next;
  dirty.add(item.id);
  schedulePersist();
  notify();
  return next;
}

export function create(type, fields) {
  const now = Date.now();
  return put({ id: newId(), type, createdAt: now, ...fields });
}

export function patch(id, changes) {
  const prev = items[id];
  if (!prev || prev.deleted) return null;
  return put({ ...prev, ...changes });
}

export function remove(id) {
  const prev = items[id];
  if (!prev || prev.deleted) return;
  items[id] = { id, type: prev.type, deleted: true, updatedAt: stamp(prev), dev: deviceId };
  dirty.add(id);
  schedulePersist();
  notify();
}

// Restore an item exactly as it was (used by Undo).
export function restore(snapshot) {
  put(snapshot);
}

// ---------- sync hooks ----------

export function dirtyItems() {
  return [...dirty].map((id) => items[id]).filter(Boolean);
}

export function markClean(id, updatedAt) {
  const cur = items[id];
  if (!cur || cur.updatedAt === updatedAt) {
    dirty.delete(id);
    schedulePersist();
  }
}

export function markAllDirty() {
  for (const id in items) {
    if (items[id].updatedAt > 1) dirty.add(id);
  }
  schedulePersist();
}

export const dirtyCount = () => dirty.size;

// Merge a record that arrived from the server. Newest write wins.
export function applyRemote(remote) {
  if (!remote || !remote.id) return false;
  const local = items[remote.id];
  const r = { ...remote };
  delete r.srv;
  if (local) {
    if (local.updatedAt > r.updatedAt) return false;
    if (local.updatedAt === r.updatedAt && (local.dev || '') >= (r.dev || '')) return false;
  }
  items[r.id] = r;
  dirty.delete(r.id);
  schedulePersist();
  notify();
  return true;
}

// Rewrite the welcome tasks in the current language, but only while untouched
// (updatedAt 1). They never sync in that state, so this stays on this device.
export function relabelSeeds(texts) {
  let changed = false;
  for (const id in texts) {
    const it = items[id];
    if (!it || it.deleted || it.updatedAt !== 1) continue;
    const next = { desc: '', ...texts[id] };
    if (it.title !== next.title || (it.desc || '') !== next.desc) {
      items[id] = { ...it, ...next };
      changed = true;
    }
  }
  if (changed) {
    schedulePersist();
    notify();
  }
}

export function exportData() {
  return { app: 'Checkmate', version: 1, exportedAt: new Date().toISOString(), items };
}

export function importData(data, { replace = false } = {}) {
  const incoming = data && data.items ? data.items : null;
  if (!incoming || typeof incoming !== 'object') throw new Error('This file is not a Checkmate backup.');
  if (replace) {
    for (const id in items) {
      if (!items[id].deleted && !incoming[id]) remove(id);
    }
  }
  let count = 0;
  for (const id in incoming) {
    const it = incoming[id];
    if (!it || !it.type || it.deleted) continue;
    put({ ...it, id });
    count++;
  }
  return count;
}

export function eraseLocal() {
  localStorage.removeItem(DB_KEY);
  localStorage.removeItem(DIRTY_KEY);
  localStorage.removeItem(PREF_KEY);
  items = {};
  dirty = new Set();
  prefs = { ...DEFAULT_PREFS };
  seed();
  notify();
}

function purgeOldTombstones() {
  const cutoff = Date.now() - 1000 * 60 * 60 * 24 * 60;
  let changed = false;
  for (const id in items) {
    const it = items[id];
    if (it.deleted && it.updatedAt < cutoff && !dirty.has(id)) {
      delete items[id];
      changed = true;
    }
  }
  if (changed) schedulePersist();
}

// Seed records use fixed ids and updatedAt = 1 so that every device starts
// with the same records, and any real edit or deletion always wins in sync.
function seed() {
  if (!items.inbox) {
    items.inbox = {
      id: 'inbox', type: 'project', name: 'Inbox', color: 'slate', order: 0,
      isInbox: true, view: 'list', createdAt: 0, updatedAt: 1,
    };
  }
  // The default calendar, the same on every device (like the Inbox).
  if (!items['cal-main']) {
    items['cal-main'] = {
      id: 'cal-main', type: 'calendar', name: 'My calendar', color: 'ocean', order: 0, isDefault: true,
      defaultReminders: [10], allDayReminders: [], createdAt: 0, updatedAt: 1,
    };
  }
  if (localStorage.getItem('tickwise.seeded')) return;
  localStorage.setItem('tickwise.seeded', '1');
  const today = ymd(new Date());
  const t = (id, title, extra) => {
    if (items[id]) return;
    items[id] = {
      id, type: 'task', title, desc: '', projectId: 'inbox', sectionId: null,
      parentId: null, priority: 4, labels: [], done: false, createdAt: 0,
      updatedAt: 1, ...extra,
    };
  };
  t('welcome-1', 'Tick the circle to complete a task', { order: 1, due: { date: today, time: null, recur: null } });
  t('welcome-2', 'Add a task with “Call Sam tomorrow 5pm p1 #Inbox”', {
    order: 2,
    desc: 'Dates, times, priorities (p1–p4), #projects and @labels are picked up as you type.',
    due: { date: today, time: null, recur: null },
  });
  t('welcome-3', 'Open Settings → Sync to use Checkmate on your phone and PC', {
    order: 3, priority: 2, due: { date: today, time: null, recur: null },
  });
  t('welcome-4', 'Press Q to add a task from anywhere, / to search', { order: 4 });
  schedulePersist();
}

function ymd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
