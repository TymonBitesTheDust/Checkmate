// Task/project operations and read helpers built on the store.
import * as store from './store.js';
import { play } from './sound.js';
import { tr } from './i18n.js';
import { today, nextOccurrence, shortDate, dueLabel } from './dates.js';

export const COLORS = {
  rose: '#c4325f', red: '#d6453d', tangerine: '#e8790f', gold: '#c99a06', moss: '#7f9a24',
  lime: '#4fa83d', pine: '#1f7a5c', jade: '#1b9e8a', teal: '#168c9c', sky: '#2b93d6',
  ocean: '#2f6fd6', indigo: '#4c5bd4', iris: '#7353cf', plum: '#9a46b8', orchid: '#c548a3',
  coral: '#e2645a', graphite: '#59606b', slate: '#8893a1', sand: '#a48b6c',
};
export const colorOf = (name) => COLORS[name] || COLORS.slate;

// The Inbox is stored as "Inbox" and shown in the current language.
export const projectName = (p) => (!p ? tr('Inbox') : p.isInbox ? tr('Inbox') : p.name);

// ---------- selectors ----------

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.createdAt || 0) - (b.createdAt || 0);

export function projects() {
  return store.all('project').filter((p) => !p.archived).sort((a, b) => (a.isInbox ? -1 : b.isInbox ? 1 : byOrder(a, b)));
}
export const archivedProjects = () => store.all('project').filter((p) => p.archived).sort(byOrder);
export const userProjects = () => projects().filter((p) => !p.isInbox);
export const sections = (projectId) => store.all('section').filter((s) => s.projectId === projectId).sort(byOrder);
export const labels = () => store.all('label').sort(byOrder);
export const filters = () => store.all('filter').sort(byOrder);
export const comments = (taskId) => store.all('comment').filter((c) => c.taskId === taskId).sort((a, b) => a.createdAt - b.createdAt);

export function tasks() {
  return store.all('task');
}
export function openTasks() {
  return tasks().filter((t) => !t.done && isLive(t));
}
// A task is hidden if its project is gone or archived.
const liveCache = { v: -1, set: null };
function isLive(t) {
  const v = store.getVersion();
  if (liveCache.v !== v) {
    liveCache.v = v;
    liveCache.set = new Set(store.all('project').filter((p) => !p.archived).map((p) => p.id));
  }
  return liveCache.set.has(t.projectId);
}

export function children(id) {
  return tasks().filter((t) => t.parentId === id).sort(byOrder);
}

export function descendants(id) {
  const out = [];
  const walk = (pid) => children(pid).forEach((c) => (out.push(c), walk(c.id)));
  walk(id);
  return out;
}

export function countFor(projectId) {
  return openTasks().filter((t) => t.projectId === projectId).length;
}

export function todayTasks() {
  const ref = today();
  return openTasks().filter((t) => t.due && t.due.date <= ref);
}

export function sortTasks(list, mode = 'manual') {
  const prio = (t) => t.priority || 4;
  const dueKey = (t) => (t.due ? t.due.date + (t.due.time || '99:99') : '9999-99-99');
  const s = [...list];
  if (mode === 'priority') s.sort((a, b) => prio(a) - prio(b) || dueKey(a).localeCompare(dueKey(b)) || byOrder(a, b));
  else if (mode === 'date') s.sort((a, b) => dueKey(a).localeCompare(dueKey(b)) || prio(a) - prio(b) || byOrder(a, b));
  else if (mode === 'name') s.sort((a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' }));
  else if (mode === 'added') s.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  else s.sort(byOrder);
  return s;
}

// ---------- ordering ----------

export function nextOrder(list) {
  return list.reduce((m, x) => Math.max(m, x.order ?? 0), 0) + 1;
}

export function orderBetween(prev, next) {
  if (prev == null && next == null) return 1;
  if (prev == null) return next - 1;
  if (next == null) return prev + 1;
  return (prev + next) / 2;
}

// ---------- undo-able changes ----------

let toastFn = () => {};
export function setToaster(fn) {
  toastFn = fn;
}

function snapshot(ids) {
  return ids.map((id) => store.get(id)).filter(Boolean).map((x) => ({ ...x }));
}

function undoable(message, ids, mutate) {
  const before = snapshot(ids);
  mutate();
  toastFn(message, () => before.forEach((s) => store.restore(s)));
}

// ---------- tasks ----------

export function addTask(fields) {
  const siblings = tasks().filter(
    (t) => t.projectId === fields.projectId && (t.sectionId || null) === (fields.sectionId || null) && (t.parentId || null) === (fields.parentId || null),
  );
  return store.create('task', {
    title: '', desc: '', projectId: 'inbox', sectionId: null, parentId: null, priority: 4,
    labels: [], due: null, done: false,
    order: fields.order ?? nextOrder(siblings),
    ...fields,
  });
}

export function updateTask(id, changes) {
  return store.patch(id, changes);
}

export function completeTask(id) {
  const t = store.get(id);
  if (!t) return;
  const now = Date.now();
  if (t.due && t.due.recur) {
    const next = nextOccurrence(t.due, today());
    const completions = [...(t.completions || []), now].slice(-400);
    if (next) {
      const label = dueLabel({ date: next, time: null }).text;
      const when = label === 'Today' || label === 'Tomorrow' ? label.toLowerCase() : label;
      undoable(tr('Done. Next due {when}', { when }), [id], () =>
        store.patch(id, { due: { ...t.due, date: next }, completions }),
      );
      return;
    }
  }
  const ids = [id, ...descendants(id).filter((d) => !d.done).map((d) => d.id)];
  undoable(ids.length > 1 ? tr('Completed with {n} subtask{s}', { n: ids.length - 1 }) : tr('Task completed'), ids, () => {
    ids.forEach((x) => store.patch(x, { done: true, doneAt: now }));
  });
}

export function uncompleteTask(id) {
  const t = store.get(id);
  if (!t) return;
  store.patch(id, { done: false, doneAt: null });
  // reopening a subtask reopens its parents too
  let p = t.parentId && store.get(t.parentId);
  while (p) {
    if (p.done) store.patch(p.id, { done: false, doneAt: null });
    p = p.parentId && store.get(p.parentId);
  }
}

export function toggleTask(id) {
  const t = store.get(id);
  if (!t) return;
  if (t.done) uncompleteTask(id);
  else completeTask(id);
}

export function deleteTask(id) {
  play('delete');
  const ids = [id, ...descendants(id).map((d) => d.id)];
  const cids = store.all('comment').filter((c) => ids.includes(c.taskId)).map((c) => c.id);
  undoable(ids.length > 1 ? tr('Deleted task and {n} subtask{s}', { n: ids.length - 1 }) : tr('Task deleted'), [...ids, ...cids], () => {
    [...ids, ...cids].forEach((x) => store.remove(x));
  });
}

export function duplicateTask(id) {
  const t = store.get(id);
  if (!t) return;
  const copy = addTask({ ...stripMeta(t), title: t.title, order: (t.order ?? 0) + 0.01 });
  const map = { [id]: copy.id };
  descendants(id).forEach((d) => {
    const c = addTask({ ...stripMeta(d), parentId: map[d.parentId] });
    map[d.id] = c.id;
  });
  toastFn(tr('Task duplicated'));
  return copy;
}

function stripMeta(t) {
  // src links a task to a row of a synced Google Doc/Sheet; a copy is a task of its own.
  const { id, updatedAt, dev, createdAt, completions, src, ...rest } = t;
  return rest;
}

export function moveTask(id, { projectId, sectionId = null, parentId = null, order }) {
  const t = store.get(id);
  if (!t) return;
  const changes = { projectId, sectionId, parentId };
  if (order !== undefined) changes.order = order;
  else if (t.projectId !== projectId || (t.sectionId || null) !== sectionId || (t.parentId || null) !== parentId) {
    const sib = tasks().filter((x) => x.projectId === projectId && (x.sectionId || null) === sectionId && (x.parentId || null) === parentId && x.id !== id);
    changes.order = nextOrder(sib);
  }
  store.patch(id, changes);
  // subtasks follow their parent
  descendants(id).forEach((d) => {
    if (d.projectId !== projectId || d.sectionId !== sectionId) store.patch(d.id, { projectId, sectionId });
  });
}

export function rescheduleOverdue() {
  const ref = today();
  const od = openTasks().filter((t) => t.due && t.due.date < ref);
  if (!od.length) return;
  undoable(tr('Moved {n} task{s} to today', { n: od.length }), od.map((t) => t.id), () => {
    od.forEach((t) => store.patch(t.id, { due: { ...t.due, date: ref } }));
  });
}

export function addComment(taskId, text) {
  return store.create('comment', { taskId, text });
}

// ---------- projects, sections, labels, filters ----------

export function saveProject(id, fields) {
  if (id) return store.patch(id, fields);
  return store.create('project', { view: 'list', color: 'pine', order: nextOrder(userProjects()), ...fields });
}

export function deleteProject(id) {
  play('delete');
  const p = store.get(id);
  if (!p || p.isInbox) return;
  const tids = tasks().filter((t) => t.projectId === id).map((t) => t.id);
  const sids = sections(id).map((s) => s.id);
  const all = [id, ...tids, ...sids];
  undoable(tr('Deleted “{name}”', { name: p.name }), all, () => all.forEach((x) => store.remove(x)));
}

export function saveSection(id, fields) {
  if (id) return store.patch(id, fields);
  return store.create('section', { order: nextOrder(sections(fields.projectId)), ...fields });
}

export function deleteSection(id) {
  play('delete');
  const s = store.get(id);
  if (!s) return;
  const tids = tasks().filter((t) => t.sectionId === id).map((t) => t.id);
  undoable(tr('Deleted section “{name}”', { name: s.name }), [id, ...tids], () => [id, ...tids].forEach((x) => store.remove(x)));
}

export function saveLabel(id, fields) {
  if (id) return store.patch(id, fields);
  return store.create('label', { color: 'slate', order: nextOrder(labels()), ...fields });
}

export function ensureLabels(names) {
  const existing = labels();
  return names.map((n) => {
    const hit = existing.find((l) => l.name.toLowerCase() === n.toLowerCase());
    return hit ? hit.id : saveLabel(null, { name: n }).id;
  });
}

export function deleteLabel(id) {
  play('delete');
  const l = store.get(id);
  if (!l) return;
  const affected = tasks().filter((t) => (t.labels || []).includes(id));
  undoable(tr('Deleted label “{name}”', { name: l.name }), [id, ...affected.map((t) => t.id)], () => {
    affected.forEach((t) => store.patch(t.id, { labels: t.labels.filter((x) => x !== id) }));
    store.remove(id);
  });
}

export function saveFilter(id, fields) {
  if (id) return store.patch(id, fields);
  return store.create('filter', { color: 'iris', order: nextOrder(filters()), ...fields });
}

export function deleteFilter(id) {
  play('delete');
  const f = store.get(id);
  if (!f) return;
  undoable(tr('Deleted filter “{name}”', { name: f.name }), [id], () => store.remove(id));
}

// ---------- stats ----------

export function completionEvents() {
  const ev = [];
  for (const t of tasks()) {
    if (t.done && t.doneAt) ev.push({ task: t, at: t.doneAt });
    for (const c of t.completions || []) ev.push({ task: t, at: c, recurring: true });
  }
  return ev.sort((a, b) => b.at - a.at);
}
