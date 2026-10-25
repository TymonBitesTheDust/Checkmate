// Reminders for tasks and birthdays (event reminders live in events.js).
//
// A reminder is a number of minutes, with the same meaning the calendar uses:
//   timed tasks:      minutes before the due time (0 = at the due time)
//   date-only tasks
//   and birthdays:    minutes before the start of the day, so -540 is "on the day at 9:00"
//                     and 900 is "the day before at 9:00"
// A task's own list is task.reminders; when it has none (null) the defaults apply.
// The defaults sync between devices: they're kept in one item, id "reminder-defaults".
import * as store from './store.js';
import { parseYmd, dueTimestamp } from './dates.js';

export const DEFAULTS_ID = 'reminder-defaults';
export const FACTORY = { timed: [0], dateOnly: [], birthday: [-540] };
const MIN = 60000;

export function defaults() {
  const s = store.get(DEFAULTS_ID);
  const out = { ...FACTORY };
  if (s) for (const k of Object.keys(FACTORY)) if (Array.isArray(s[k])) out[k] = s[k];
  return out;
}

export function setDefaults(patch) {
  const cur = store.get(DEFAULTS_ID);
  const now = Date.now();
  store.put({ ...(cur || { id: DEFAULTS_ID, type: 'settings', createdAt: now }), ...patch });
}

export const clean = (list) => [...new Set((list || []).filter((m) => Number.isFinite(m)).map((m) => Math.round(m)))].sort((a, b) => a - b);

// The reminders that apply to a task (its own, or the defaults for its kind of date).
export function taskReminders(t) {
  if (!t || !t.due || !t.due.date) return [];
  if (Array.isArray(t.reminders)) return t.reminders;
  const d = defaults();
  return t.due.time ? d.timed : d.dateOnly;
}

export const usesDefaults = (t) => !Array.isArray(t && t.reminders);

// When each reminder fires: [{ m, at }]
export function taskReminderTimes(t) {
  if (!t || !t.due || !t.due.date) return [];
  const timed = !!t.due.time;
  const base = timed ? dueTimestamp(t.due) : startOfDay(t.due.date);
  return taskReminders(t).map((m) => ({ m, at: base - m * MIN, timed }));
}

export function startOfDay(date) {
  const d = parseYmd(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
