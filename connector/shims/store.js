// Stand-in for the app's store.js inside the connector. The app's own task and event
// code (actions.js, events.js) runs against it unchanged: the connector loads the items
// a request needs from Firestore, lets that code change them here, then saves exactly
// the items it touched.

export let deviceId = 'claude';

let items = {};
let dirty = new Set();
let prefs = {};
let version = 0;

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

const DEFAULT_PREFS = {
  timeFormat: '24', dateOrder: 'dmy', weekStart: 1, calHidden: {}, calShowTasks: false,
  calShowDone: true, calDuration: 60, language: 'en',
};

// Every device has these two from the start (fixed ids, updatedAt 1) and they only reach
// Firestore once edited, so they may not be there yet. Same records as the app's seed().
const SEEDS = [
  { id: 'inbox', type: 'project', name: 'Inbox', color: 'slate', order: 0, isInbox: true, view: 'list', createdAt: 0, updatedAt: 1 },
  { id: 'cal-main', type: 'calendar', name: 'My calendar', color: 'ocean', order: 0, isDefault: true, defaultReminders: [10], allDayReminders: [], createdAt: 0, updatedAt: 1 },
];

// Start a request: these items (tombstones included) are what the code can see.
export function begin(list, p = {}) {
  items = {};
  for (const s of SEEDS) items[s.id] = { ...s };
  for (const it of list) if (it && it.id) items[it.id] = it;
  dirty = new Set();
  prefs = { ...DEFAULT_PREFS, ...p };
  version++;
}

export function add(list) {
  for (const it of list) if (it && it.id && !items[it.id]) items[it.id] = it;
  version++;
}

export const changed = () => [...dirty].map((id) => items[id]).filter(Boolean);

export const getVersion = () => version;
export const touch = () => version++;
export const subscribe = () => () => {};
export const flush = () => {};
export const raw = (id) => items[id] || null;
export const getPrefs = () => prefs;
export function setPrefs(p) {
  prefs = { ...prefs, ...p };
}

export const get = (id) => {
  const it = items[id];
  return it && !it.deleted ? it : null;
};

// The app's code asks for "all tasks" many times per request, so the lists are kept
// until something changes. Callers get a copy (some of them sort it in place).
let byType = null;
let byTypeVersion = -1;
export function all(type) {
  if (byTypeVersion !== version || !byType) {
    byType = new Map();
    for (const id in items) {
      const it = items[id];
      if (it.deleted) continue;
      let list = byType.get(it.type);
      if (!list) byType.set(it.type, (list = []));
      list.push(it);
    }
    byTypeVersion = version;
  }
  return (byType.get(type) || []).slice();
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
  version++;
  return next;
}

export function create(type, fields) {
  return put({ id: newId(), type, createdAt: Date.now(), via: 'claude', ...fields });
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
  version++;
}

export const restore = (snapshot) => put(snapshot);
export const dirtyItems = changed;
export const dirtyCount = () => dirty.size;
export const markClean = () => {};
export const markAllDirty = () => {};
export const applyRemote = () => false;
