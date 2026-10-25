// The tools Claude can use. Each one loads the items it needs from Firestore into the
// stand-in store, runs the app's own code on them (so completing a repeating task, moving
// a task with its subtasks or editing one event of a series works exactly like in the
// app), then saves what changed.
import * as store from '../shims/store.js';
import * as A from '../../web/src/actions.js';
import * as E from '../../web/src/events.js';
import { parseDateText, describeRecur } from '../../web/src/parse.js';
import { ruleDays, dn, fromDn, describeRule, parseRRule, ruleFromTaskRecur } from '../../web/src/recur.js';
import { wallToMs as slowWallToMs, msToWall as slowMsToWall, offsetMin, validTz, normalizeZone } from '../../web/src/tz.js';
import { addDays, weekday, DAYS } from '../../web/src/dates.js';
import { compileFilter } from '../../web/src/filters.js';
import { isConflict, isAuthError } from './firebase.js';

export const CONNECTOR_ID = 'claude';
const META_TYPES = ['project', 'section', 'label', 'calendar', 'filter', 'connector'];
const MAX_BATCH = 50;
const DAY = 86400000;

export class ToolError extends Error {}
export class AccessError extends Error {}

// ---------- time zones, quickly ----------
// The app's tz.js asks Intl for every conversion. Here thousands of occurrences can be
// converted per request, so the zone's offset is looked up once per day instead: a day
// whose offset is the same from 14 hours before it starts to 12 hours after it ends has
// no clock change, and every instant in it converts with plain arithmetic.
const dayOffsets = new Map();
function offsetOnDay(tz, date) {
  const key = `${tz}|${date}`;
  let v = dayOffsets.get(key);
  if (v === undefined) {
    const [y, m, d] = date.split('-').map(Number);
    const midnight = Date.UTC(y, m - 1, d);
    const a = offsetMin(midnight - 14 * 3600000, tz);
    v = a === offsetMin(midnight + 36 * 3600000, tz) ? a : null;
    if (dayOffsets.size > 20000) dayOffsets.clear();
    dayOffsets.set(key, v);
  }
  return v;
}
function wallToMs(date, time, tz) {
  if (!validTz(tz)) return slowWallToMs(date, time, tz);
  const o = offsetOnDay(tz, date);
  if (o === null) return slowWallToMs(date, time, tz);
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = (time || '00:00').split(':').map(Number);
  return Date.UTC(y, m - 1, d, h || 0, mi || 0) - o * 60000;
}
function msToWall(ms, tz) {
  if (!validTz(tz)) return slowMsToWall(ms, tz);
  const o = offsetOnDay(tz, new Date(ms).toISOString().slice(0, 10));
  if (o === null) return slowMsToWall(ms, tz);
  const iso = new Date(ms + o * 60000).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}
export const _tzForTests = { wallToMs, msToWall, slowWallToMs, slowMsToWall };

// ---------- small helpers ----------

const pad = (n) => String(n).padStart(2, '0');
const wallText = (ms, tz) => {
  const w = msToWall(ms, tz);
  return `${w.date} ${w.time}`;
};
const lower = (s) => String(s || '').trim().toLowerCase();
const isoDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

function text(v, name, { required = false, max = 2000 } = {}) {
  if (v == null || v === '') {
    if (required) throw new ToolError(`“${name}” is required.`);
    return null;
  }
  if (typeof v !== 'string' && typeof v !== 'number') throw new ToolError(`“${name}” must be text.`);
  const s = String(v).trim();
  if (required && !s) throw new ToolError(`“${name}” can’t be empty.`);
  if (s.length > max) throw new ToolError(`“${name}” is too long (${s.length} characters; the limit is ${max}).`);
  return s;
}

function list(v, name, { required = false, max = MAX_BATCH } = {}) {
  if (v == null) {
    if (required) throw new ToolError(`“${name}” is required.`);
    return [];
  }
  const arr = Array.isArray(v) ? v : [v];
  if (required && !arr.length) throw new ToolError(`“${name}” needs at least one entry.`);
  if (arr.length > max) throw new ToolError(`“${name}” can have up to ${max} entries at a time; split it into several calls.`);
  return arr;
}

function priorityIn(v) {
  if (v == null || v === '') return null;
  const m = lower(v).match(/^(?:p|priority\s*)?([1-4])$/);
  if (!m) throw new ToolError(`Priority must be p1, p2, p3 or p4 (p1 is the most urgent, p4 is none), not “${v}”.`);
  return +m[1];
}

const isNone = (v) => v === null || /^(none|no date|no due date|clear|remove|null|nothing|-)$/i.test(String(v).trim());

// A due date from "tomorrow 5pm", "every weekday 9am", "2026-11-03", "2026-11-03 14:30", "明天下午3點".
function dueIn(v, ctx) {
  const s = text(v, 'due', { max: 200 });
  if (!s) return null;
  const iso = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{1,2}):(\d{2})(?::\d{2})?)?$/.exec(s);
  if (iso) {
    if (!isoDate(iso[1])) throw new ToolError(`“${s}” isn’t a real date.`);
    const time = iso[2] != null ? clock(+iso[2], +iso[3], s) : null;
    return { date: iso[1], time, recur: null };
  }
  const due = parseDateText(s, { ref: ctx.today, dateOrder: ctx.dateOrder });
  if (!due || !due.date) {
    throw new ToolError(`Couldn’t read the date “${s}”. Use YYYY-MM-DD (optionally with HH:MM) or a phrase such as “tomorrow 5pm”, “next friday”, “every weekday 9am” or “every 2 weeks on monday”.`);
  }
  return { date: due.date, time: due.time || null, recur: due.recur || null };
}

function clock(h, m, src) {
  if (!(h >= 0 && h <= 23 && m >= 0 && m <= 59)) throw new ToolError(`“${src}” isn’t a valid time.`);
  return `${pad(h)}:${pad(m)}`;
}

// ---------- reading: what each answer looks like ----------

function dueOut(due) {
  if (!due || !due.date) return undefined;
  const out = { date: due.date, weekday: DAYS[weekday(due.date)] };
  if (due.time) out.time = due.time;
  if (due.recur) out.repeat = describeRecur(due.recur);
  return out;
}

function taskOut(t, ctx, { brief = false } = {}) {
  const p = store.get(t.projectId);
  const s = t.sectionId ? store.get(t.sectionId) : null;
  const out = { id: t.id, title: t.title || '(no title)' };
  if (t.desc && !brief) out.description = t.desc.length > 1500 ? `${t.desc.slice(0, 1500)}…` : t.desc;
  out.project = p ? A.projectName(p) : 'Inbox';
  if (s) out.section = s.name;
  if (t.parentId) {
    out.parentId = t.parentId;
    const parent = store.get(t.parentId);
    if (parent) out.parentTitle = parent.title;
  }
  out.priority = `p${t.priority || 4}`;
  if (t.due && t.due.date) {
    out.due = dueOut(t.due);
    if (!t.done && t.due.date < ctx.today) out.overdue = true;
  }
  const labels = (t.labels || []).map((id) => store.get(id)).filter(Boolean).map((l) => l.name);
  if (labels.length) out.labels = labels;
  if (t.done) {
    out.done = true;
    if (t.doneAt) out.completedAt = wallText(t.doneAt, ctx.tz);
  }
  const subs = openChildren().get(t.id);
  if (subs) out.openSubtasks = subs;
  return out;
}

// How many open subtasks each task has (worked out once per change, not per task).
let kids = { v: -1, map: null };
function openChildren() {
  if (kids.v !== store.getVersion()) {
    const map = new Map();
    for (const t of A.tasks()) if (t.parentId && !t.done) map.set(t.parentId, (map.get(t.parentId) || 0) + 1);
    kids = { v: store.getVersion(), map };
  }
  return kids.map;
}

function projectOut(p, open) {
  const out = { id: p.id, name: A.projectName(p) };
  if (p.isInbox) out.isInbox = true;
  if (p.archived) out.archived = true;
  if (p.favorite) out.favorite = true;
  out.openTasks = open.filter((t) => t.projectId === p.id).length;
  const secs = A.sections(p.id).map((s) => ({ id: s.id, name: s.name }));
  if (secs.length) out.sections = secs;
  return out;
}

// ---------- looking things up by name ----------

function findProject(v, { allowArchived = false } = {}) {
  const s = text(v, 'project', { max: 200 });
  if (!s) return store.get('inbox');
  const all = store.all('project');
  const byId = all.find((p) => p.id === s);
  const key = lower(s).replace(/^#/, '');
  const hit = byId || all.find((p) => (p.isInbox ? ['inbox', '收件匣'].includes(key) : lower(p.name) === key));
  if (hit && (!hit.archived || allowArchived)) return hit;
  if (hit && hit.archived) throw new ToolError(`The project “${hit.name}” is archived. Unarchive it in Checkmate first.`);
  const names = A.projects().map((p) => A.projectName(p));
  throw new ToolError(`There’s no project called “${s}”. Projects: ${names.join(', ')}. Use add-projects to make a new one.`);
}

function findSection(projectId, v) {
  const s = text(v, 'section', { max: 200 });
  if (!s) return null;
  const secs = A.sections(projectId);
  const hit = secs.find((x) => x.id === s) || secs.find((x) => lower(x.name) === lower(s).replace(/^\//, ''));
  if (hit) return hit;
  const p = store.get(projectId);
  throw new ToolError(
    `“${A.projectName(p)}” has no section called “${s}”.${secs.length ? ` Sections: ${secs.map((x) => x.name).join(', ')}.` : ' It has no sections.'} Use add-sections to make one.`,
  );
}

function labelIds(names) {
  const clean = [...new Set(list(names, 'labels', { max: 30 }).map((n) => text(n, 'label', { max: 100 })).filter(Boolean).map((n) => n.replace(/^@/, '')))];
  return clean.length ? A.ensureLabels(clean) : [];
}

function needTask(id) {
  const t = id && store.get(String(id));
  if (!t || t.type !== 'task') throw new ToolError(`There’s no task with id “${id}”. Use find-tasks to look it up.`);
  return t;
}

function myCalendar(v) {
  const s = text(v, 'calendar', { max: 200 });
  const mine = E.myCalendars();
  if (!s) return E.defaultCalendar() || mine[0] || null;
  const all = E.calendars();
  const hit = all.find((c) => c.id === s) || all.find((c) => lower(E.calName(c)) === lower(s) || lower(c.name) === lower(s));
  if (hit && hit.sub) throw new ToolError(`“${E.calName(hit)}” is a subscribed calendar, so it can’t be changed here. Pick one of: ${mine.map(E.calName).join(', ')}.`);
  if (hit) return hit;
  throw new ToolError(`There’s no calendar called “${s}”. Your calendars: ${mine.map(E.calName).join(', ')}.`);
}

// ---------- loading from Firestore ----------

async function openTasks(db) {
  // Tombstones have no "done", so this is exactly the open tasks (plus nothing else).
  return (await db.query(['done', '==', false])).filter((x) => x.type === 'task');
}

// Tasks by id, plus their parents (so reopening a subtask can reopen them too).
async function withParents(db, ids, have = new Set()) {
  const out = [];
  let want = ids.filter((id) => id && !have.has(id));
  for (let depth = 0; want.length && depth < 8; depth++) {
    const got = await db.getMany(want);
    got.forEach((x) => (out.push(x), have.add(x.id)));
    want = [...new Set(got.map((x) => x.parentId).filter((id) => id && !have.has(id)))];
  }
  return out;
}

// Every subtask below the given tasks (done or not) and their comments.
async function familyOf(db, ids) {
  const out = [];
  const seen = new Set(ids);
  let level = ids;
  for (let depth = 0; level.length && depth < 8; depth++) {
    const next = [];
    for (let i = 0; i < level.length; i += 30) {
      for (const x of await db.query(['parentId', 'in', level.slice(i, i + 30)])) {
        if (x.type === 'task' && !seen.has(x.id)) {
          seen.add(x.id);
          out.push(x);
          next.push(x.id);
        }
      }
    }
    level = next;
  }
  const all = [...seen];
  for (let i = 0; i < all.length; i += 30) out.push(...(await db.query(['taskId', 'in', all.slice(i, i + 30)])).filter((x) => x.type === 'comment'));
  return out;
}

// Events that could show up between two dates (inclusive): one-off events starting near
// the range, every repeating series, and every changed occurrence of a series.
async function eventsNear(db, fromYmd, toYmd) {
  const [near, series, changed] = await Promise.all([
    db.query([['start', '>=', addDays(fromYmd, -40)], ['start', '<', addDays(toYmd, 2)]]),
    db.query(['rrule.freq', 'in', ['daily', 'weekly', 'monthly', 'yearly']]),
    db.query(['recurringId', '>', '']),
  ]);
  const map = new Map();
  for (const x of [...near, ...series, ...changed]) if (x.type === 'event') map.set(x.id, x);
  return [...map.values()];
}

// An event plus everything needed to change one occurrence or the whole series.
async function eventFamily(db, id) {
  const ev = await db.get(String(id));
  if (!ev || ev.deleted || ev.type !== 'event') return [];
  const out = [ev];
  const seriesId = ev.recurringId || (ev.rrule ? ev.id : null);
  if (ev.recurringId) {
    const s = await db.get(ev.recurringId);
    if (s) out.push(s);
  }
  if (seriesId) out.push(...(await db.query(['recurringId', '==', seriesId])).filter((x) => x.type === 'event' && x.id !== ev.id));
  return out;
}

// ---------- calendar occurrences ----------

function occurrencesIn(fromYmd, toYmd, ctx, { search = null, calendarIds = null, limit = 300 } = {}) {
  const tz = ctx.tz;
  const fromMs = wallToMs(fromYmd, '00:00', tz);
  const toMs = wallToMs(addDays(toYmd, 1), '00:00', tz);
  const fromD = dn(fromYmd);
  const toD = dn(toYmd);
  const cals = new Map(E.calendars().map((c) => [c.id, c]));
  const events = store.all('event');
  const overridden = new Map();
  for (const e of events) {
    if (!e.recurringId || !e.originalStart) continue;
    if (!overridden.has(e.recurringId)) overridden.set(e.recurringId, new Set());
    overridden.get(e.recurringId).add(dn(e.originalStart.slice(0, 10)));
  }
  const needle = search ? lower(search) : null;
  const out = [];
  for (const ev of events) {
    const cal = cals.get(ev.calendarId);
    if (!cal || ev.cancelled || !ev.start) continue;
    if (calendarIds && !calendarIds.has(cal.id)) continue;
    if (needle && !`${ev.title || ''}\n${ev.location || ''}\n${ev.desc || ''}`.toLowerCase().includes(needle)) continue;
    const ex = new Set((ev.exdates || []).map((x) => dn(x.slice(0, 10))));
    (overridden.get(ev.id) || []).forEach((d) => ex.add(d));
    if (ev.allDay) {
      const len = Math.max(1, dn(ev.end || addDays(ev.start, 1)) - dn(ev.start));
      const days = ev.rrule ? ruleDays(ev.rrule, ev.start, fromD - len + 1, toD, { exdays: ex, limit: 1000 }) : [dn(ev.start)];
      for (const d of days) {
        if (d > toD || d + len - 1 < fromD) continue;
        out.push({ ev, cal, allDay: true, sort: wallToMs(fromDn(d), '00:00', tz), start: fromDn(d), last: fromDn(d + len - 1), orig: ev.rrule ? fromDn(d) : ev.originalStart || null });
      }
      continue;
    }
    const etz = validTz(ev.tz) ? ev.tz : tz;
    const s0 = wallToMs(ev.start.slice(0, 10), ev.start.slice(11, 16) || '00:00', etz);
    const endW = ev.end || ev.start;
    const e0 = Math.max(s0, wallToMs(endW.slice(0, 10), endW.slice(11, 16) || '00:00', etz));
    const dur = e0 - s0;
    const hit = (s, e) => s < toMs && (e > fromMs || (dur === 0 && s >= fromMs));
    if (!ev.rrule) {
      if (hit(s0, e0)) out.push({ ev, cal, allDay: false, sort: s0, s: s0, e: e0, etz, orig: ev.originalStart || null });
      continue;
    }
    const st = ev.start.slice(11, 16) || '00:00';
    const a = dn(msToWall(fromMs - dur, etz).date) - 1;
    const b = dn(msToWall(toMs, etz).date) + 1;
    for (const d of ruleDays(ev.rrule, ev.start.slice(0, 10), a, b, { exdays: ex, limit: 1000 })) {
      const s = wallToMs(fromDn(d), st, etz);
      if (hit(s, s + dur)) out.push({ ev, cal, allDay: false, sort: s, s, e: s + dur, etz, orig: `${fromDn(d)}T${st}` });
    }
  }
  out.sort((x, y) => x.sort - y.sort || (y.allDay ? 1 : 0) - (x.allDay ? 1 : 0));
  return out.slice(0, limit).map((o) => occOut(o, ctx));
}

function occOut(o, ctx) {
  const { ev, cal } = o;
  const series = ev.recurringId ? store.get(ev.recurringId) : ev.rrule ? ev : null;
  const out = { id: ev.id };
  if (series && o.orig) out.occurrence = o.orig;
  out.title = ev.title || '(no title)';
  if (o.allDay) {
    out.allDay = true;
    out.start = o.start;
    out.end = o.last;
  } else {
    out.start = wallText(o.s, ctx.tz);
    out.end = wallText(o.e, ctx.tz);
    if (o.etz !== ctx.tz) {
      out.eventTimeZone = o.etz;
      out.startInEventTimeZone = wallText(o.s, o.etz);
    }
  }
  if (ev.location) out.location = ev.location;
  if (ev.desc) out.description = ev.desc.length > 600 ? `${ev.desc.slice(0, 600)}…` : ev.desc;
  out.calendar = E.calName(cal);
  if (series && series.rrule) out.repeat = describeRule(series.rrule, series.start.slice(0, 10));
  if (cal.sub) out.readOnly = true;
  return out;
}

function eventOut(ev, ctx) {
  const cal = store.get(ev.calendarId);
  const o = { ev, cal: cal || { name: 'Calendar' }, allDay: !!ev.allDay, orig: ev.originalStart || (ev.rrule ? ev.start : null) };
  if (ev.allDay) {
    o.start = ev.start;
    o.last = addDays(ev.end || addDays(ev.start, 1), -1);
    if (o.last < o.start) o.last = o.start;
  } else {
    o.etz = validTz(ev.tz) ? ev.tz : ctx.tz;
    o.s = wallToMs(ev.start.slice(0, 10), ev.start.slice(11, 16), o.etz);
    const endW = ev.end || ev.start;
    o.e = Math.max(o.s, wallToMs(endW.slice(0, 10), endW.slice(11, 16), o.etz));
  }
  return occOut(o, ctx);
}

// ---------- event times ----------

// "2026-10-19", "2026-10-19 10:00", "2026-10-19T10:00:00+11:00", "10:30", "next fri 3pm"
function whenIn(v, name, ctx, { refDate, tz }) {
  const s = text(v, name, { max: 120 });
  if (!s) return null;
  let m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i.exec(s);
  if (m) {
    if (!isoDate(m[1])) throw new ToolError(`“${s}” isn’t a real date.`);
    if (m[2] == null) return { date: m[1], time: null };
    const time = clock(+m[2], +m[3], s);
    if (m[5]) {
      // an exact instant: show it as wall time in the event's zone
      const off = m[5].toUpperCase() === 'Z' ? 0 : (m[5][0] === '-' ? -1 : 1) * (+m[5].slice(1, 3) * 60 + +m[5].slice(-2));
      const ms = Date.parse(`${m[1]}T${time}:00Z`) - off * 60000;
      return { ...msToWall(ms, tz), exact: true };
    }
    return { date: m[1], time };
  }
  m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(s);
  if (m && (m[2] != null || m[3])) {
    let h = +m[1];
    if (m[3]) {
      if (h < 1 || h > 12) throw new ToolError(`“${s}” isn’t a valid time.`);
      h = (h % 12) + (/p/i.test(m[3]) ? 12 : 0);
    }
    return { date: refDate || ctx.today, time: clock(h, m[2] ? +m[2] : 0, s) };
  }
  const due = parseDateText(s, { ref: refDate || ctx.today, dateOrder: ctx.dateOrder });
  if (!due || !due.date) throw new ToolError(`Couldn’t read “${s}” as a date or time. Use YYYY-MM-DD or YYYY-MM-DD HH:MM (24-hour), in the user’s time zone.`);
  return { date: due.date, time: due.time || null, recur: due.recur || null };
}

const REPEAT_WORDS = {
  daily: 'every day', weekly: 'every week', fortnightly: 'every 2 weeks', biweekly: 'every 2 weeks', monthly: 'every month',
  yearly: 'every year', annually: 'every year', weekdays: 'every weekday', 'every workday': 'every weekday',
};

// A repeat rule from "every weekday", "weekly on mon, wed", "monthly", or an RRULE.
function repeatIn(v, startDate, tz, ctx) {
  const s = text(v, 'repeat', { max: 300 });
  if (!s || isNone(s)) return { rule: null };
  if (/^(RRULE:)?FREQ=/i.test(s)) {
    const r = parseRRule(s, tz);
    if (!r) throw new ToolError(`“${s}” isn’t an RRULE this calendar understands (FREQ must be DAILY, WEEKLY, MONTHLY or YEARLY).`);
    return { rule: r };
  }
  let phrase = lower(s).replace(/^repeats?\s+/, '');
  phrase = REPEAT_WORDS[phrase] || phrase.replace(/^(weekly|monthly|yearly|daily)\s+on\s+/, (w, f) => (f === 'weekly' ? 'every ' : `${REPEAT_WORDS[f]} on `));
  if (!/^every|^each|^每/.test(phrase)) phrase = `every ${phrase}`;
  const due = parseDateText(phrase, { ref: startDate, dateOrder: ctx.dateOrder });
  const rule = due && due.recur ? ruleFromTaskRecur(due.recur) : null;
  if (!rule) throw new ToolError(`Couldn’t read the repeat “${s}”. Try “every day”, “every weekday”, “every 2 weeks on monday”, “monthly”, “every year”, or an RRULE such as FREQ=WEEKLY;BYDAY=MO,WE.`);
  return { rule, firstDate: due.date };
}

function addRepeatEnd(rule, args) {
  if (!rule) return rule;
  const until = text(args.repeatUntil, 'repeatUntil', { max: 10 });
  if (until) {
    if (!isoDate(until)) throw new ToolError('repeatUntil must be a date like 2026-12-31.');
    rule.until = until;
    delete rule.count;
  }
  if (args.repeatCount != null) {
    const n = Math.round(Number(args.repeatCount));
    if (!(n >= 1 && n <= 1000)) throw new ToolError('repeatCount must be a number from 1 to 1000.');
    rule.count = n;
    delete rule.until;
  }
  return rule;
}

function remindersIn(v) {
  if (v == null) return undefined;
  if (isNone(v)) return [];
  const arr = list(v, 'reminders', { max: 5 }).map((x) => Math.round(Number(x)));
  if (arr.some((x) => !isFinite(x) || x < -1440 || x > 40320)) throw new ToolError('reminders are minutes before the start, e.g. [10, 60] (up to 40320, four weeks).');
  return [...new Set(arr)].sort((a, b) => a - b);
}

const COLOR_NAMES = Object.keys(A.COLORS);
function colorIn(v) {
  const s = text(v, 'color', { max: 30 });
  if (!s) return null;
  const k = lower(s);
  if (!A.COLORS[k]) throw new ToolError(`Colours are: ${COLOR_NAMES.join(', ')}.`);
  return k;
}

const minutesBetween = (a, b, tz) => Math.round((wallToMs(b.date, b.time, tz) - wallToMs(a.date, a.time, tz)) / 60000);
const plusMinutes = (w, min, tz) => msToWall(wallToMs(w.date, w.time, tz) + min * 60000, tz);

// ---------- the tools ----------

const taskInputProps = {
  title: { type: 'string', description: 'What to do. Keep it short; put details in description.' },
  description: { type: 'string', description: 'Notes for the task (plain text).' },
  due: {
    type: 'string',
    description:
      'When it’s due, in the user’s time zone: "2026-11-03", "2026-11-03 14:30", or a phrase like "tomorrow 5pm", "next friday", "every weekday 9am", "every 2 weeks on monday", "every month on the 1st". Repeating phrases make a repeating task.',
  },
  priority: { type: 'string', enum: ['p1', 'p2', 'p3', 'p4'], description: 'p1 = most urgent (red), p2 = orange, p3 = blue, p4 = none (default).' },
  project: { type: 'string', description: 'Project name or id. Leave out for the Inbox.' },
  section: { type: 'string', description: 'Section name or id inside the project.' },
  labels: { type: 'array', items: { type: 'string' }, description: 'Label names (new labels are created).' },
  parentId: { type: 'string', description: 'Make it a subtask of this task id. It joins the parent’s project and section.' },
};

export const TOOLS = [
  {
    name: 'get-overview',
    title: 'Overview of today',
    description:
      'Start here. Returns the user’s current date, time and time zone, overdue tasks, tasks and calendar events for a day (today by default), and their projects, labels and calendars.',
    readOnly: true,
    inputSchema: { type: 'object', properties: { date: { type: 'string', description: 'A day as YYYY-MM-DD. Defaults to today.' } } },
    async load(db, args, ctx) {
      const day = text(args.date, 'date', { max: 10 }) || ctx.today;
      if (!isoDate(day)) throw new ToolError('date must look like 2026-10-19.');
      const [open, events] = await Promise.all([openTasks(db), eventsNear(db, day, day)]);
      return [...open, ...events];
    },
    run(args, ctx) {
      const day = text(args.date, 'date', { max: 10 }) || ctx.today;
      const open = A.openTasks();
      const sort = (l) => A.sortTasks(l, 'date');
      const overdue = sort(open.filter((t) => t.due && t.due.date < ctx.today));
      const due = A.sortTasks(open.filter((t) => t.due && t.due.date === day), 'priority');
      const all = E.calendars();
      return {
        now: wallText(Date.now(), ctx.tz),
        today: ctx.today,
        weekday: DAYS[weekday(ctx.today)],
        timeZone: ctx.tz,
        date: day,
        overdue: overdue.slice(0, 100).map((t) => taskOut(t, ctx, { brief: true })),
        dueOnDate: due.slice(0, 100).map((t) => taskOut(t, ctx, { brief: true })),
        events: occurrencesIn(day, day, ctx, { limit: 100 }),
        openTasks: open.length,
        projects: A.projects().map((p) => ({ id: p.id, name: A.projectName(p), openTasks: open.filter((t) => t.projectId === p.id).length })),
        labels: A.labels().map((l) => l.name),
        calendars: all.map((c) => ({ id: c.id, name: E.calName(c), ...(c.sub ? { readOnly: true } : {}), ...(c.isDefault ? { isDefault: true } : {}) })),
      };
    },
  },
  {
    name: 'find-tasks',
    title: 'Find tasks',
    description:
      'Find tasks. With no arguments, returns open tasks soonest-due first. Combine "filter" (the app’s filter syntax: today, overdue, tomorrow, "7 days", "no date", p1, #Project, @label, /Section, recurring, joined with & | ! and parentheses, e.g. "(today | overdue) & #Work") with search, project, label and date bounds. Set status to "completed" to see finished tasks.',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Filter query, e.g. "today | overdue", "7 days & p1", "#Home & !@waiting".' },
        search: { type: 'string', description: 'Words to look for in the title or description.' },
        project: { type: 'string', description: 'Only this project (name or id).' },
        section: { type: 'string', description: 'Only this section of the project.' },
        label: { type: 'string', description: 'Only tasks with this label.' },
        dueFrom: { type: 'string', description: 'Due on or after this date (YYYY-MM-DD).' },
        dueTo: { type: 'string', description: 'Due on or before this date (YYYY-MM-DD).' },
        parentId: { type: 'string', description: 'Only subtasks of this task.' },
        status: { type: 'string', enum: ['open', 'completed'], description: 'open (default) or completed.' },
        completedSince: { type: 'string', description: 'With status "completed": finished on or after this date (YYYY-MM-DD). Defaults to 7 days ago.' },
        limit: { type: 'number', description: 'Most tasks to return (default 50, up to 300).' },
      },
    },
    async load(db, args, ctx) {
      const open = await openTasks(db);
      if (args.status !== 'completed') return open;
      const since = sinceMs(args, ctx);
      const done = (await db.query(['doneAt', '>=', since])).filter((x) => x.type === 'task' && x.done);
      return [...open, ...done];
    },
    run(args, ctx) {
      const limit = Math.max(1, Math.min(300, Math.round(Number(args.limit) || 50)));
      const completed = args.status === 'completed';
      let pool;
      if (completed) {
        const since = sinceMs(args, ctx);
        pool = [];
        for (const t of A.tasks()) {
          if (t.done && t.doneAt >= since) pool.push({ t, at: t.doneAt });
          if (!t.done) for (const c of t.completions || []) if (c >= since) pool.push({ t, at: c, recurring: true });
        }
      } else pool = A.openTasks().map((t) => ({ t }));
      if (args.filter) {
        const ctxF = { projects: store.all('project'), labels: A.labels(), sections: store.all('section') };
        const f = compileFilter(String(args.filter), ctxF);
        if (f.error) throw new ToolError(`The filter couldn’t be read: ${f.error}`);
        pool = pool.filter((x) => f.fn(x.t));
      }
      if (args.search) {
        const words = lower(args.search).split(/\s+/).filter(Boolean);
        pool = pool.filter(({ t }) => {
          const hay = `${t.title || ''}\n${t.desc || ''}`.toLowerCase();
          return words.every((w) => hay.includes(w));
        });
      }
      if (args.project) {
        const p = findProject(args.project, { allowArchived: completed });
        pool = pool.filter(({ t }) => t.projectId === p.id);
        if (args.section) {
          const s = findSection(p.id, args.section);
          pool = pool.filter(({ t }) => t.sectionId === s.id);
        }
      } else if (args.section) throw new ToolError('Give the project too when filtering by section.');
      if (args.label) {
        const key = lower(args.label).replace(/^@/, '');
        const ids = new Set(A.labels().filter((l) => lower(l.name) === key || l.id === args.label).map((l) => l.id));
        if (!ids.size) throw new ToolError(`There’s no label called “${args.label}”. Labels: ${A.labels().map((l) => l.name).join(', ') || 'none yet'}.`);
        pool = pool.filter(({ t }) => (t.labels || []).some((id) => ids.has(id)));
      }
      for (const [k, cmp] of [['dueFrom', (d, v) => d >= v], ['dueTo', (d, v) => d <= v]]) {
        if (!args[k]) continue;
        if (!isoDate(String(args[k]))) throw new ToolError(`${k} must look like 2026-10-19.`);
        pool = pool.filter(({ t }) => t.due && t.due.date && cmp(t.due.date, String(args[k])));
      }
      if (args.parentId) pool = pool.filter(({ t }) => t.parentId === String(args.parentId));
      if (completed) pool.sort((a, b) => b.at - a.at);
      else {
        const order = new Map(A.sortTasks(pool.map((x) => x.t), 'date').map((t, i) => [t.id, i]));
        pool.sort((a, b) => order.get(a.t.id) - order.get(b.t.id));
      }
      const total = pool.length;
      const tasks = pool.slice(0, limit).map(({ t, at, recurring }) => {
        const o = taskOut(t, ctx);
        if (at) {
          o.completedAt = wallText(at, ctx.tz);
          if (recurring) o.note = 'Repeating task: this occurrence was completed and the next one is still open.';
        }
        return o;
      });
      return { today: ctx.today, total, returned: tasks.length, ...(total > tasks.length ? { more: `${total - tasks.length} more; narrow the search or raise limit.` } : {}), tasks };
    },
  },
  {
    name: 'get-task',
    title: 'Get a task',
    description: 'Everything about one task: its details, subtasks (open and done) and comments.',
    readOnly: true,
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Task id.' } }, required: ['id'] },
    async load(db, args) {
      const id = text(args.id, 'id', { required: true, max: 100 });
      const self = await withParents(db, [id]);
      return [...self, ...(await familyOf(db, [id]))];
    },
    run(args, ctx) {
      const t = needTask(args.id);
      const out = taskOut(t, ctx);
      out.subtasks = A.children(t.id).map((c) => taskOut(c, ctx, { brief: true }));
      out.comments = A.comments(t.id).map((c) => ({ id: c.id, text: c.text, at: wallText(c.createdAt, ctx.tz) }));
      out.createdAt = t.createdAt ? wallText(t.createdAt, ctx.tz) : undefined;
      if (t.via === 'claude') out.addedBy = 'Claude';
      return out;
    },
  },
  {
    name: 'add-tasks',
    title: 'Add tasks',
    description: 'Add one or more tasks (up to 50). Each needs a title; due, priority, project, section, labels and parentId are optional. Tasks go to the Inbox unless a project is given.',
    inputSchema: {
      type: 'object',
      properties: { tasks: { type: 'array', minItems: 1, maxItems: MAX_BATCH, items: { type: 'object', properties: taskInputProps, required: ['title'] } } },
      required: ['tasks'],
    },
    async load(db, args) {
      const open = await openTasks(db);
      const have = new Set(open.map((t) => t.id));
      const parents = list(args.tasks, 'tasks', { required: true }).map((t) => t && t.parentId).filter(Boolean);
      return [...open, ...(await withParents(db, parents, have))];
    },
    run(args, ctx) {
      const plans = list(args.tasks, 'tasks', { required: true }).map((t, i) => {
        if (!t || typeof t !== 'object') throw new ToolError(`Task ${i + 1} must be an object with a title.`);
        try {
          const title = text(t.title, 'title', { required: true, max: 500 });
          let projectId;
          let sectionId = null;
          let parentId = null;
          if (t.parentId) {
            const parent = needTask(t.parentId);
            parentId = parent.id;
            projectId = parent.projectId;
            sectionId = parent.sectionId || null;
          } else {
            projectId = findProject(t.project).id;
            sectionId = t.section ? findSection(projectId, t.section).id : null;
          }
          return {
            title,
            desc: text(t.description, 'description', { max: 16000 }) || '',
            due: dueIn(t.due, ctx),
            priority: priorityIn(t.priority) || 4,
            projectId,
            sectionId,
            parentId,
            labelNames: t.labels,
          };
        } catch (e) {
          if (e instanceof ToolError) throw new ToolError(`Task ${i + 1} (“${(t && t.title) || ''}”): ${e.message} Nothing was added.`);
          throw e;
        }
      });
      const made = plans.map(({ labelNames, ...f }) => A.addTask({ ...f, labels: labelIds(labelNames) }));
      const where = [...new Set(made.map((t) => A.projectName(store.get(t.projectId))))];
      return { summary: `Added ${made.length} task${made.length === 1 ? '' : 's'} to ${where.join(', ')}.`, tasks: made.map((t) => taskOut(t, ctx)) };
    },
  },
  {
    name: 'update-tasks',
    title: 'Update tasks',
    description:
      'Change tasks (up to 50): title, description, due (use "none" to remove the date), priority, labels (replaces them; or use addLabels/removeLabels), or move them with project, section ("none" to leave the section) or parentId ("none" to make it a top-level task). Subtasks move with their parent. Only the fields given are changed.',
    inputSchema: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_BATCH,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Task id.' },
              ...taskInputProps,
              due: { ...taskInputProps.due, description: `${taskInputProps.due.description} Use "none" to remove the due date.` },
              addLabels: { type: 'array', items: { type: 'string' } },
              removeLabels: { type: 'array', items: { type: 'string' } },
            },
            required: ['id'],
          },
        },
      },
      required: ['tasks'],
    },
    async load(db, args) {
      const open = await openTasks(db);
      const have = new Set(open.map((t) => t.id));
      const items = list(args.tasks, 'tasks', { required: true });
      const ids = items.flatMap((t) => [t && t.id, t && t.parentId]).filter((x) => x && x !== 'none').map(String);
      const extra = await withParents(db, ids, have);
      // moving a task brings all of its subtasks along, done ones too
      return [...open, ...extra, ...(await familyOf(db, items.map((t) => t && String(t.id)).filter(Boolean)))];
    },
    run(args, ctx) {
      const items = list(args.tasks, 'tasks', { required: true });
      const plans = items.map((u, i) => {
        if (!u || typeof u !== 'object') throw new ToolError(`Entry ${i + 1} must be an object with an id.`);
        try {
          const t = needTask(u.id);
          const ch = {};
          if (u.title !== undefined) ch.title = text(u.title, 'title', { required: true, max: 500 });
          if (u.description !== undefined) ch.desc = text(u.description, 'description', { max: 16000 }) || '';
          if (u.priority !== undefined) ch.priority = priorityIn(u.priority) || 4;
          if (u.due !== undefined) ch.due = isNone(u.due) ? null : dueIn(u.due, ctx);
          let move = null;
          if (u.parentId !== undefined) {
            if (isNone(u.parentId)) move = { projectId: t.projectId, sectionId: t.sectionId || null, parentId: null };
            else {
              const p = needTask(u.parentId);
              let up = p;
              for (let k = 0; up && k < 50; k++) {
                if (up.id === t.id) throw new ToolError('A task can’t be a subtask of itself or of its own subtask.');
                up = up.parentId ? store.get(up.parentId) : null;
              }
              move = { projectId: p.projectId, sectionId: p.sectionId || null, parentId: p.id };
            }
          }
          if (u.project !== undefined || u.section !== undefined) {
            const projectId = u.project !== undefined ? findProject(u.project).id : (move ? move.projectId : t.projectId);
            let sectionId = move ? move.sectionId : u.project !== undefined && projectId !== t.projectId ? null : t.sectionId || null;
            if (u.section !== undefined) sectionId = isNone(u.section) ? null : findSection(projectId, u.section).id;
            const parentId = move ? move.parentId : projectId === t.projectId ? t.parentId || null : null;
            move = { projectId, sectionId, parentId };
          }
          return { t, ch, move, u };
        } catch (e) {
          if (e instanceof ToolError) throw new ToolError(`Entry ${i + 1} (${u.id}): ${e.message} Nothing was changed.`);
          throw e;
        }
      });
      for (const { t, ch, move, u } of plans) {
        if (u.labels !== undefined || u.addLabels !== undefined || u.removeLabels !== undefined) {
          let ids = u.labels !== undefined ? (isNone(u.labels) ? [] : labelIds(u.labels)) : [...(t.labels || [])];
          if (u.addLabels) ids = [...new Set([...ids, ...labelIds(u.addLabels)])];
          if (u.removeLabels) {
            const drop = new Set(list(u.removeLabels, 'removeLabels').map((n) => lower(n).replace(/^@/, '')));
            ids = ids.filter((id) => {
              const l = store.get(id);
              return !(l && drop.has(lower(l.name)));
            });
          }
          ch.labels = ids;
        }
        if (Object.keys(ch).length) A.updateTask(t.id, ch);
        if (move) A.moveTask(t.id, move);
      }
      return { summary: `Updated ${plans.length} task${plans.length === 1 ? '' : 's'}.`, tasks: plans.map(({ t }) => taskOut(store.get(t.id), ctx)) };
    },
  },
  {
    name: 'complete-tasks',
    title: 'Complete tasks',
    description: 'Tick off tasks by id (up to 50). A repeating task moves on to its next date instead; finishing a task also finishes its open subtasks, like in the app.',
    inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: MAX_BATCH } }, required: ['ids'] },
    async load(db, args) {
      const open = await openTasks(db);
      return [...open, ...(await withParents(db, list(args.ids, 'ids', { required: true }).map(String), new Set(open.map((t) => t.id))))];
    },
    run(args, ctx) {
      const ids = list(args.ids, 'ids', { required: true }).map(String);
      ids.forEach(needTask);
      const results = ids.map((id) => {
        const before = store.get(id);
        if (before.done) return { id, title: before.title, result: 'was already completed' };
        A.completeTask(id);
        const after = store.get(id);
        if (!after.done && after.due) return { id, title: after.title, result: `repeating task: next due ${after.due.date}`, nextDue: dueOut(after.due) };
        return { id, title: after.title, result: 'completed' };
      });
      const n = results.filter((r) => r.result !== 'was already completed').length;
      return { summary: `Completed ${n} task${n === 1 ? '' : 's'}.`, results };
    },
  },
  {
    name: 'reopen-tasks',
    title: 'Reopen tasks',
    description: 'Mark completed tasks as not done again (their parent tasks reopen too).',
    inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: MAX_BATCH } }, required: ['ids'] },
    async load(db, args) {
      return withParents(db, list(args.ids, 'ids', { required: true }).map(String));
    },
    run(args, ctx) {
      const ids = list(args.ids, 'ids', { required: true }).map(String);
      ids.forEach(needTask);
      ids.forEach((id) => A.uncompleteTask(id));
      return { summary: `Reopened ${ids.length} task${ids.length === 1 ? '' : 's'}.`, tasks: ids.map((id) => taskOut(store.get(id), ctx)) };
    },
  },
  {
    name: 'delete-tasks',
    title: 'Delete tasks',
    description: 'Delete tasks by id, with their subtasks and comments. This can’t be undone from Claude, so confirm with the user first.',
    destructive: true,
    inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: MAX_BATCH } }, required: ['ids'] },
    async load(db, args) {
      const ids = list(args.ids, 'ids', { required: true }).map(String);
      return [...(await db.getMany(ids)), ...(await familyOf(db, ids))];
    },
    run(args) {
      const ids = list(args.ids, 'ids', { required: true }).map(String);
      const tasks = ids.map(needTask).map((t) => ({ id: t.id, title: t.title }));
      let subs = 0;
      for (const { id } of tasks) {
        if (!store.get(id)) continue;
        subs += A.descendants(id).length;
        A.deleteTask(id);
      }
      return { summary: `Deleted ${tasks.length} task${tasks.length === 1 ? '' : 's'}${subs ? ` and ${subs} subtask${subs === 1 ? '' : 's'}` : ''}.`, deleted: tasks };
    },
  },
  {
    name: 'add-comments',
    title: 'Add comments',
    description: 'Add comments to tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        comments: {
          type: 'array', minItems: 1, maxItems: MAX_BATCH,
          items: { type: 'object', properties: { taskId: { type: 'string' }, text: { type: 'string' } }, required: ['taskId', 'text'] },
        },
      },
      required: ['comments'],
    },
    async load(db, args) {
      return db.getMany(list(args.comments, 'comments', { required: true }).map((c) => c && String(c.taskId)));
    },
    run(args, ctx) {
      const items = list(args.comments, 'comments', { required: true });
      const plans = items.map((c, i) => {
        if (!c) throw new ToolError(`Comment ${i + 1} is empty.`);
        return { t: needTask(c.taskId), text: text(c.text, 'text', { required: true, max: 15000 }) };
      });
      const made = plans.map(({ t, text: body }) => ({ task: t.title, taskId: t.id, id: A.addComment(t.id, body).id }));
      return { summary: `Added ${made.length} comment${made.length === 1 ? '' : 's'}.`, comments: made, at: wallText(Date.now(), ctx.tz) };
    },
  },
  {
    name: 'find-projects',
    title: 'List projects, sections and labels',
    description: 'All projects (with their sections and open task counts), labels and saved filters.',
    readOnly: true,
    inputSchema: { type: 'object', properties: { includeArchived: { type: 'boolean', description: 'Also list archived projects.' } } },
    load: (db) => openTasks(db),
    run(args) {
      const open = A.openTasks();
      const projects = A.projects().map((p) => projectOut(p, open));
      if (args.includeArchived) projects.push(...A.archivedProjects().map((p) => projectOut(p, open)));
      return {
        projects,
        labels: A.labels().map((l) => ({ id: l.id, name: l.name })),
        filters: A.filters().map((f) => ({ name: f.name, filter: f.query })),
        colors: COLOR_NAMES,
      };
    },
  },
  {
    name: 'add-projects',
    title: 'Add projects',
    description: 'Make new projects, optionally with sections. A name that already exists is reused rather than duplicated.',
    inputSchema: {
      type: 'object',
      properties: {
        projects: {
          type: 'array', minItems: 1, maxItems: 20,
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              color: { type: 'string', description: `One of: ${COLOR_NAMES.join(', ')}.` },
              view: { type: 'string', enum: ['list', 'board'] },
              favorite: { type: 'boolean' },
              sections: { type: 'array', items: { type: 'string' }, description: 'Section names to create in it.' },
            },
            required: ['name'],
          },
        },
      },
      required: ['projects'],
    },
    run(args) {
      const items = list(args.projects, 'projects', { required: true, max: 20 });
      const plans = items.map((p, i) => {
        if (!p) throw new ToolError(`Project ${i + 1} is empty.`);
        return {
          name: text(p.name, 'name', { required: true, max: 120 }),
          color: colorIn(p.color),
          view: p.view === 'board' ? 'board' : 'list',
          favorite: !!p.favorite,
          sections: list(p.sections, 'sections', { max: 30 }).map((s) => text(s, 'section', { required: true, max: 120 })),
        };
      });
      const out = plans.map((pl) => {
        let p = A.projects().find((x) => !x.isInbox && lower(x.name) === lower(pl.name));
        const existed = !!p;
        if (!p) p = A.saveProject(null, { name: pl.name, color: pl.color || 'pine', view: pl.view, favorite: pl.favorite });
        const made = [];
        for (const s of pl.sections) {
          if (!A.sections(p.id).some((x) => lower(x.name) === lower(s))) made.push(A.saveSection(null, { projectId: p.id, name: s }).name);
        }
        return { id: p.id, name: p.name, ...(existed ? { note: 'already existed' } : {}), sections: A.sections(p.id).map((s) => ({ id: s.id, name: s.name })), ...(made.length ? { addedSections: made } : {}) };
      });
      return { summary: `${out.filter((x) => !x.note).length} new project(s).`, projects: out };
    },
  },
  {
    name: 'add-sections',
    title: 'Add sections',
    description: 'Add sections to a project (names that already exist are skipped).',
    inputSchema: {
      type: 'object',
      properties: { project: { type: 'string', description: 'Project name or id.' }, sections: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 30 } },
      required: ['project', 'sections'],
    },
    run(args) {
      const p = findProject(args.project);
      const names = list(args.sections, 'sections', { required: true, max: 30 }).map((s) => text(s, 'section', { required: true, max: 120 }));
      const made = [];
      for (const n of names) if (!A.sections(p.id).some((x) => lower(x.name) === lower(n))) made.push(A.saveSection(null, { projectId: p.id, name: n }).name);
      return { summary: made.length ? `Added ${made.join(', ')} to ${A.projectName(p)}.` : 'Those sections already exist.', project: A.projectName(p), sections: A.sections(p.id).map((s) => ({ id: s.id, name: s.name })) };
    },
  },
  {
    name: 'find-events',
    title: 'Find calendar events',
    description:
      'Calendar events between two dates (inclusive), with repeating events expanded into occurrences. Times are in the user’s time zone. All-day events give start and end as dates, end being the last day. Recurring occurrences include an "occurrence" value to pass to update-events or delete-events.',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'First day, YYYY-MM-DD. Defaults to today.' },
        to: { type: 'string', description: 'Last day, YYYY-MM-DD. Defaults to 6 days after from. At most 366 days after from.' },
        search: { type: 'string', description: 'Only events whose title, location or notes contain this.' },
        calendar: { type: 'string', description: 'Only this calendar (name or id).' },
        limit: { type: 'number', description: 'Most occurrences to return (default 200, up to 500).' },
      },
    },
    async load(db, args, ctx) {
      const { from, to } = rangeOf(args, ctx);
      return eventsNear(db, from, to);
    },
    run(args, ctx) {
      const { from, to } = rangeOf(args, ctx);
      let calendarIds = null;
      if (args.calendar) {
        const all = E.calendars();
        const c = all.find((x) => x.id === args.calendar) || all.find((x) => lower(E.calName(x)) === lower(args.calendar));
        if (!c) throw new ToolError(`There’s no calendar called “${args.calendar}”. Calendars: ${all.map(E.calName).join(', ')}.`);
        calendarIds = new Set([c.id]);
      }
      const limit = Math.max(1, Math.min(500, Math.round(Number(args.limit) || 200)));
      const events = occurrencesIn(from, to, ctx, { search: args.search ? String(args.search) : null, calendarIds, limit: limit + 1 });
      return { from, to, timeZone: ctx.tz, returned: Math.min(limit, events.length), ...(events.length > limit ? { more: 'There are more; narrow the dates.' } : {}), events: events.slice(0, limit) };
    },
  },
  {
    name: 'add-events',
    title: 'Add calendar events',
    description:
      'Add events to the user’s calendar (up to 20). start is "YYYY-MM-DD" for an all-day event or "YYYY-MM-DD HH:MM" (24-hour, user’s time zone unless timeZone is given). end is optional (default: 1 hour, or the same day for all-day events; for all-day events end is the last day). repeat takes "every weekday", "every 2 weeks on mon, wed", "monthly", "yearly" or an RRULE.',
    inputSchema: {
      type: 'object',
      properties: {
        events: {
          type: 'array', minItems: 1, maxItems: 20,
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              start: { type: 'string', description: '"2026-10-21" (all day) or "2026-10-21 14:00".' },
              end: { type: 'string', description: '"2026-10-21 15:30", "15:30" (same day), or for all-day events the last day "2026-10-23".' },
              durationMinutes: { type: 'number', description: 'Instead of end: length in minutes.' },
              allDay: { type: 'boolean' },
              timeZone: { type: 'string', description: 'IANA zone such as "Asia/Hong_Kong", if the times are not in the user’s own zone.' },
              repeat: { type: 'string' },
              repeatUntil: { type: 'string', description: 'Last date of the repeat (YYYY-MM-DD).' },
              repeatCount: { type: 'number', description: 'Or: number of times it happens.' },
              location: { type: 'string' },
              description: { type: 'string' },
              calendar: { type: 'string', description: 'Calendar name or id (defaults to the main calendar).' },
              reminders: { type: 'array', items: { type: 'number' }, description: 'Minutes before the start, e.g. [10]. Leave out to use the calendar’s default; [] for none.' },
              color: { type: 'string', description: `One of: ${COLOR_NAMES.join(', ')}.` },
            },
            required: ['title', 'start'],
          },
        },
      },
      required: ['events'],
    },
    run(args, ctx) {
      const items = list(args.events, 'events', { required: true, max: 20 });
      const plans = items.map((e, i) => {
        if (!e) throw new ToolError(`Event ${i + 1} is empty.`);
        try {
          return planEvent(e, ctx);
        } catch (x) {
          if (x instanceof ToolError) throw new ToolError(`Event ${i + 1} (“${e.title || ''}”): ${x.message} Nothing was added.`);
          throw x;
        }
      });
      const made = plans.map(({ fields, note }) => ({ ev: store.create('event', fields), note }));
      return {
        summary: `Added ${made.length} event${made.length === 1 ? '' : 's'}.`,
        events: made.map(({ ev, note }) => ({ ...eventOut(ev, ctx), ...(note ? { note } : {}) })),
      };
    },
  },
  {
    name: 'update-events',
    title: 'Change a calendar event',
    description:
      'Change an event. For a repeating event give the "occurrence" from find-events and a scope: "this" (only that occurrence), "following" (it and later ones) or "all" (default when no occurrence is given). start/end use the same forms as add-events; a time alone ("15:00") keeps the date. Only fields given change. repeat "none" stops it repeating.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        occurrence: { type: 'string', description: 'The occurrence value from find-events (for repeating events).' },
        scope: { type: 'string', enum: ['this', 'following', 'all'] },
        title: { type: 'string' },
        start: { type: 'string' },
        end: { type: 'string' },
        durationMinutes: { type: 'number' },
        allDay: { type: 'boolean' },
        timeZone: { type: 'string' },
        repeat: { type: 'string' },
        repeatUntil: { type: 'string' },
        repeatCount: { type: 'number' },
        location: { type: 'string' },
        description: { type: 'string' },
        calendar: { type: 'string' },
        reminders: { type: 'array', items: { type: 'number' } },
        color: { type: 'string' },
      },
      required: ['id'],
    },
    load: (db, args) => eventFamily(db, text(args.id, 'id', { required: true, max: 200 })),
    run(args, ctx) {
      const { ev, series, occ, scope } = pickOccurrence(args);
      // what the user sees for this occurrence is what the new times are measured against
      const base = !series || ev.recurringId ? ev : occurrenceAsEvent(series, occ.origStart);
      const changes = eventChanges(args, base, ctx, { allowRepeat: !series || scope !== 'this' });
      if (!Object.keys(changes).length) throw new ToolError('Nothing to change: give at least one field such as title, start or location.');
      const before = new Set(store.all('event').map((x) => x.id));
      E.changeOccurrence(occ, changes, scope);
      const made = store.changed().find((x) => x.type === 'event' && !x.deleted && !before.has(x.id));
      const shown = made || store.get(ev.id) || (series && store.get(series.id));
      const what = !series ? '' : scope === 'this' ? 'this occurrence of ' : scope === 'following' ? 'this and the following occurrences of ' : 'every occurrence of ';
      return { summary: `Changed ${what}“${(series || ev).title}”.`, event: shown ? eventOut(shown, ctx) : undefined };
    },
  },
  {
    name: 'delete-events',
    title: 'Delete a calendar event',
    description: 'Delete an event. For a repeating event give the "occurrence" from find-events and scope "this", "following" or "all". Confirm with the user first.',
    destructive: true,
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, occurrence: { type: 'string' }, scope: { type: 'string', enum: ['this', 'following', 'all'] } },
      required: ['id'],
    },
    load: (db, args) => eventFamily(db, text(args.id, 'id', { required: true, max: 200 })),
    run(args) {
      const { ev, series, occ, scope } = pickOccurrence(args);
      const title = (series || ev).title;
      E.deleteOccurrence(occ, scope);
      return { summary: series ? `Deleted ${scope === 'this' ? 'one occurrence' : scope === 'following' ? 'this and following occurrences' : 'the whole series'} of “${title}”.` : `Deleted “${title}”.` };
    },
  },
];

// ---------- tool helpers ----------

function sinceMs(args, ctx) {
  const s = args.completedSince ? String(args.completedSince) : addDays(ctx.today, -7);
  if (!isoDate(s)) throw new ToolError('completedSince must look like 2026-10-12.');
  return wallToMs(s, '00:00', ctx.tz);
}

function rangeOf(args, ctx) {
  const from = args.from ? String(args.from) : ctx.today;
  if (!isoDate(from)) throw new ToolError('from must look like 2026-10-19.');
  const to = args.to ? String(args.to) : addDays(from, 6);
  if (!isoDate(to)) throw new ToolError('to must look like 2026-10-25.');
  if (to < from) throw new ToolError('to is before from.');
  if (dn(to) - dn(from) > 366) throw new ToolError('Ask for at most 366 days at a time.');
  return { from, to };
}

// A stand-in event for one occurrence of a series, so changes can be worked out against it.
function occurrenceAsEvent(series, origStart) {
  if (!origStart) return series;
  if (series.allDay) {
    const len = Math.max(1, dn(series.end || addDays(series.start, 1)) - dn(series.start));
    const s = origStart.slice(0, 10);
    return { ...series, start: s, end: fromDn(dn(s) + len) };
  }
  const tz = validTz(series.tz) ? series.tz : 'UTC';
  const s0 = wallToMs(series.start.slice(0, 10), series.start.slice(11, 16), tz);
  const e0 = wallToMs((series.end || series.start).slice(0, 10), (series.end || series.start).slice(11, 16), tz);
  const s = wallToMs(origStart.slice(0, 10), origStart.slice(11, 16) || series.start.slice(11, 16), tz);
  const w = (ms) => {
    const x = msToWall(ms, tz);
    return `${x.date}T${x.time}`;
  };
  return { ...series, start: w(s), end: w(s + Math.max(0, e0 - s0)) };
}

function pickOccurrence(args) {
  const ev = store.get(String(args.id));
  if (!ev || ev.type !== 'event') throw new ToolError(`There’s no event with id “${args.id}”. Use find-events to look it up.`);
  const cal = store.get(ev.calendarId);
  if (cal && cal.sub) throw new ToolError(`“${ev.title}” is in the subscribed calendar “${E.calName(cal)}”, which is read-only. Change it where it comes from.`);
  const series = ev.recurringId ? store.get(ev.recurringId) : ev.rrule ? ev : null;
  let scope = args.scope ? String(args.scope) : null;
  if (scope && !['this', 'following', 'all'].includes(scope)) throw new ToolError('scope must be "this", "following" or "all".');
  const occurrence = args.occurrence ? String(args.occurrence).trim().replace(' ', 'T') : null;
  if (!series) return { ev, series: null, occ: { id: ev.id, origStart: null }, scope: 'all' };
  if (!scope) scope = occurrence || ev.recurringId ? 'this' : 'all';
  let origStart = ev.recurringId ? ev.originalStart : occurrence;
  if (!ev.recurringId && scope !== 'all' && !origStart) throw new ToolError('This is a repeating event: give the occurrence (from find-events) for scope "this" or "following".');
  if (!origStart) origStart = series.start;
  if (!series.allDay && origStart.length === 10) origStart = `${origStart}T${series.start.slice(11, 16)}`;
  if (series.allDay) origStart = origStart.slice(0, 10);
  if (origStart && !ev.recurringId) {
    const day = dn(origStart.slice(0, 10));
    const hits = ruleDays(series.rrule, series.start.slice(0, 10), day, day, { limit: 2 });
    if (!hits.length) throw new ToolError(`“${occurrence}” isn’t one of the dates “${series.title}” happens on. Use the occurrence value from find-events.`);
  }
  return { ev, series, occ: { id: ev.id, origStart }, scope };
}

function planEvent(e, ctx) {
  const title = text(e.title, 'title', { required: true, max: 500 });
  let tz = ctx.tz;
  if (e.timeZone) {
    const z = normalizeZone(String(e.timeZone));
    if (!validTz(z)) throw new ToolError(`“${e.timeZone}” isn’t a time zone this calendar knows. Use an IANA name like "Asia/Hong_Kong".`);
    tz = z;
  }
  const cal = myCalendar(e.calendar);
  if (!cal) throw new ToolError('There’s no calendar to add it to. Open the Calendar in Checkmate once first.');
  const s = whenIn(e.start, 'start', ctx, { tz });
  if (!s) throw new ToolError('start is required.');
  const allDay = e.allDay != null ? !!e.allDay : !s.time;
  let rep = e.repeat != null ? repeatIn(e.repeat, s.date, tz, ctx) : { rule: s.recur ? ruleFromTaskRecur(s.recur) : null };
  let note = null;
  let startDate = s.date;
  if (rep.firstDate && rep.firstDate !== s.date && rep.firstDate > s.date) {
    note = `${s.date} doesn’t match the repeat, so the first one is on ${rep.firstDate}.`;
    startDate = rep.firstDate;
  }
  const rule = addRepeatEnd(rep.rule ? { ...rep.rule } : null, e);
  const fields = {
    calendarId: cal.id, title, allDay, tz, rrule: rule, exdates: [], location: text(e.location, 'location', { max: 500 }) || '',
    desc: text(e.description, 'description', { max: 16000 }) || '', color: colorIn(e.color), reminders: remindersIn(e.reminders) ?? null,
  };
  if (allDay) {
    let last = startDate;
    if (e.end) {
      const en = whenIn(e.end, 'end', ctx, { refDate: startDate, tz });
      last = en.date;
    }
    if (last < startDate) throw new ToolError('end is before start.');
    fields.start = startDate;
    fields.end = addDays(last, 1);
  } else {
    const st = { date: startDate, time: s.time || '09:00' };
    let en;
    if (e.end) {
      en = whenIn(e.end, 'end', ctx, { refDate: startDate, tz });
      if (!en.time) throw new ToolError('end needs a time for a timed event, e.g. "2026-10-21 15:00" or "15:00".');
      if (minutesBetween(st, en, tz) < 0) {
        if (/^\d{1,2}(:\d{2})?\s*(am|pm)?$/i.test(String(e.end).trim())) en = { date: addDays(en.date, 1), time: en.time };
        else throw new ToolError('end is before start.');
      }
    } else {
      const min = e.durationMinutes != null ? Math.round(Number(e.durationMinutes)) : ctx.duration;
      if (!(min >= 0 && min <= 14 * 1440)) throw new ToolError('durationMinutes must be between 0 and 20160.');
      en = plusMinutes(st, min, tz);
    }
    fields.start = `${st.date}T${st.time}`;
    fields.end = `${en.date}T${en.time}`;
  }
  return { fields, note };
}

// Works out the stored fields to change from the arguments of update-events.
function eventChanges(args, base, ctx, { allowRepeat }) {
  const ch = {};
  if (args.title !== undefined) ch.title = text(args.title, 'title', { required: true, max: 500 });
  if (args.location !== undefined) ch.location = text(args.location, 'location', { max: 500 }) || '';
  if (args.description !== undefined) ch.desc = text(args.description, 'description', { max: 16000 }) || '';
  if (args.color !== undefined) ch.color = isNone(args.color) ? null : colorIn(args.color);
  if (args.reminders !== undefined) ch.reminders = remindersIn(args.reminders) ?? null;
  if (args.calendar !== undefined) ch.calendarId = myCalendar(args.calendar).id;
  let tz = validTz(base.tz) ? base.tz : ctx.tz;
  if (args.timeZone !== undefined) {
    const z = normalizeZone(String(args.timeZone));
    if (!validTz(z)) throw new ToolError(`“${args.timeZone}” isn’t a time zone this calendar knows.`);
    tz = z;
    if (z !== base.tz) ch.tz = z;
  }
  const timing = args.start !== undefined || args.end !== undefined || args.allDay !== undefined || args.durationMinutes !== undefined || ch.tz;
  if (timing) {
    const allDay = args.allDay !== undefined ? !!args.allDay : !!base.allDay;
    const oldStart = { date: base.start.slice(0, 10), time: base.allDay ? '09:00' : base.start.slice(11, 16) };
    const oldEnd = base.allDay ? { date: addDays(base.end || addDays(base.start, 1), -1), time: '10:00' } : { date: (base.end || base.start).slice(0, 10), time: (base.end || base.start).slice(11, 16) };
    const oldLen = base.allDay ? 60 : Math.max(0, minutesBetween(oldStart, oldEnd, validTz(base.tz) ? base.tz : tz));
    const s = args.start !== undefined ? whenIn(args.start, 'start', ctx, { refDate: oldStart.date, tz }) : oldStart;
    if (allDay) {
      const first = s.date;
      let last = args.end !== undefined ? whenIn(args.end, 'end', ctx, { refDate: first, tz }).date : base.allDay ? fromDn(dn(first) + (dn(oldEnd.date) - dn(oldStart.date))) : first;
      if (last < first) throw new ToolError('end is before start.');
      ch.start = first;
      ch.end = addDays(last, 1);
    } else {
      const st = { date: s.date, time: s.time || oldStart.time };
      let en;
      if (args.end !== undefined) {
        en = whenIn(args.end, 'end', ctx, { refDate: st.date, tz });
        if (!en.time) throw new ToolError('end needs a time for a timed event.');
        if (minutesBetween(st, en, tz) < 0) {
          if (/^\d{1,2}(:\d{2})?\s*(am|pm)?$/i.test(String(args.end).trim())) en = { date: addDays(en.date, 1), time: en.time };
          else throw new ToolError('end is before start.');
        }
      } else {
        const min = args.durationMinutes != null ? Math.round(Number(args.durationMinutes)) : base.allDay ? ctx.duration : oldLen;
        if (!(min >= 0 && min <= 14 * 1440)) throw new ToolError('durationMinutes must be between 0 and 20160.');
        en = plusMinutes(st, min, tz);
      }
      ch.start = `${st.date}T${st.time}`;
      ch.end = `${en.date}T${en.time}`;
      if (base.allDay && !ch.tz) ch.tz = tz;
    }
    ch.allDay = allDay;
  }
  if (args.repeat !== undefined || args.repeatUntil !== undefined || args.repeatCount !== undefined) {
    if (!allowRepeat) throw new ToolError('To change how it repeats, use scope "following" or "all".');
    const startDate = (ch.start || base.start).slice(0, 10);
    const rep = args.repeat !== undefined ? repeatIn(args.repeat, startDate, tz, ctx) : { rule: base.rrule ? { ...base.rrule } : null };
    if (!rep.rule && (args.repeatUntil !== undefined || args.repeatCount !== undefined) && args.repeat === undefined) throw new ToolError('This event doesn’t repeat; give repeat too.');
    ch.rrule = addRepeatEnd(rep.rule ? { ...rep.rule } : null, args);
  }
  return ch;
}

// ---------- running a tool ----------

// One tool call at a time per connector instance: the stand-in store is shared.
let queue = Promise.resolve();
function exclusive(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

export const toolList = () =>
  TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { title: t.title, readOnlyHint: !!t.readOnly, destructiveHint: !!t.destructive, idempotentHint: !!t.readOnly, openWorldHint: false },
  }));

export function findTool(name) {
  return TOOLS.find((t) => t.name === name) || null;
}

/**
 * session: { db: () => UserDb, gen }
 * Returns the tool's answer, throws ToolError for something Claude should fix and
 * AccessError when Claude's access was turned off in the app.
 */
export function callTool(tool, args, session) {
  return exclusive(async () => {
    for (let attempt = 0; ; attempt++) {
      const db = session.db();
      let meta;
      try {
        meta = await db.query(['type', 'in', META_TYPES]);
      } catch (e) {
        if (isAuthError(e)) throw new AccessError('sign-in expired');
        throw e;
      }
      const conn = meta.find((x) => x.id === CONNECTOR_ID && !x.deleted);
      if (!conn || conn.gen !== session.gen) throw new AccessError('Claude’s access was turned off in Checkmate.');
      const ctx = contextOf(conn);
      globalThis.__cmToday = () => ctx.today;
      const extra = tool.load ? await tool.load(db, args, ctx) : [];
      store.begin([...meta, ...extra], { timeFormat: '24', dateOrder: ctx.dateOrder, weekStart: conn.weekStart ?? 1, calDuration: ctx.duration });
      const result = tool.run(args, ctx);
      const changed = store.changed();
      if (!changed.length) return result;
      try {
        await db.save(changed);
        return result;
      } catch (e) {
        if (isConflict(e) && attempt < 2) continue;
        throw e;
      }
    }
  });
}

export function contextOf(conn) {
  const tz = conn && validTz(conn.tz) ? conn.tz : 'UTC';
  return {
    tz,
    today: msToWall(Date.now(), tz).date,
    dateOrder: (conn && conn.dateOrder) || 'dmy',
    duration: (conn && conn.duration) || 60,
  };
}

export const SERVER_INSTRUCTIONS = `Checkmate is the user's own to-do list and calendar app (projects, sections, labels, priorities p1-p4, due dates, repeating tasks, and a Google-Calendar-like calendar). Everything you change syncs to the user's phone and computer within seconds.
- Call get-overview first to learn today's date, the time zone and the user's projects, labels and calendars. All dates and times are in that time zone.
- Dates can be YYYY-MM-DD or YYYY-MM-DD HH:MM; tasks also accept phrases like "tomorrow 5pm" or "every weekday 9am".
- p1 is the most urgent priority and p4 means no priority. New tasks go to the Inbox unless you name a project.
- Use ids from find-tasks / find-events when changing things, and batch several tasks into one call.
- Ask before deleting anything.`;

void DAY;
