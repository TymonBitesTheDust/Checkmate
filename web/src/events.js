// Calendar events: the data side of the Calendar page.
//
// Calendars and events are synced items like tasks:
//   calendar { name, color, order, isDefault, defaultReminders, allDayReminders, sub }
//   event    { calendarId, title, allDay, start, end, tz, rrule, exdates, location, desc,
//              color, reminders, recurringId, originalStart, src, h }
// A timed event keeps its start/end as wall time in its zone ("2026-10-19T10:00" in
// "Australia/Sydney"); an all-day event keeps dates ("2026-10-18" to "2026-10-19",
// the end day not included), exactly like Google Calendar and .ics files.
// A changed occurrence of a repeating event is its own event with recurringId and
// originalStart; a deleted occurrence is listed in the series' exdates.
import * as store from './store.js';
import { COLORS, colorOf, tasks as allTasks, projectName } from './actions.js';
import { toast } from './ui.jsx';
import { play } from './sound.js';
import { tr, isZh } from './i18n.js';
import { ruleDays, dn, fromDn, reanchor, countBefore } from './recur.js';
import { wallToMs, msToWall, localTz } from './tz.js';
import { parseYmd, ymd, addDays, nextOccurrence, formatTime, shortDate, dayShortDate, today } from './dates.js';
import { parseHex, contrast } from './theme.js';
import { occurrences as birthdayOccurrences, BIRTHDAYS_CAL } from './birthdays.js';

export { BIRTHDAYS_CAL };

export const DEFAULT_CAL = 'cal-main';
export const TASKS_CAL = 'tasks';
const MIN = 60000;
const DAY = 86400000;

// ---------- calendars ----------

const byOrder = (a, b) => (a.isDefault ? -1 : b.isDefault ? 1 : (a.order ?? 0) - (b.order ?? 0) || (a.createdAt || 0) - (b.createdAt || 0));
export const calendars = () => store.all('calendar').sort(byOrder);
export const myCalendars = () => calendars().filter((c) => !c.sub);
export const subscribed = () => calendars().filter((c) => c.sub);
export const defaultCalendar = () => store.get(DEFAULT_CAL) || myCalendars()[0] || null;

export function calName(c) {
  if (!c) return tr('Calendar');
  if (c.isDefault && (!c.name || c.name === 'My calendar')) return tr('My calendar');
  return c.name || tr('Calendar');
}

export function calendarOf(ev) {
  return (ev && store.get(ev.calendarId)) || null;
}

export const isReadOnly = (ev) => {
  const c = calendarOf(ev);
  return !!(c && c.sub);
};

export function eventColorName(ev) {
  if (ev.color) return ev.color;
  const c = calendarOf(ev);
  return (c && c.color) || 'ocean';
}
export const eventColor = (ev) => colorOf(eventColorName(ev));

// White or dark text, whichever reads better on the colour.
export function inkOn(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return '#ffffff';
  return contrast(rgb, [255, 255, 255]) >= 3 ? '#ffffff' : '#1c1f1d';
}

export const hiddenSet = () => store.getPrefs().calHidden || {};
export const isHidden = (id) => !!hiddenSet()[id];
export function setHidden(id, hidden) {
  const h = { ...hiddenSet() };
  if (hidden) h[id] = true;
  else delete h[id];
  store.setPrefs({ calHidden: h });
}
export function showOnly(id) {
  const h = {};
  for (const c of calendars()) if (c.id !== id) h[c.id] = true;
  if (id !== TASKS_CAL) h[TASKS_CAL] = true;
  if (id !== BIRTHDAYS_CAL) h[BIRTHDAYS_CAL] = true;
  store.setPrefs({ calHidden: h });
}

export function saveCalendar(id, fields) {
  if (id) return store.patch(id, fields);
  const order = calendars().reduce((m, c) => Math.max(m, c.order ?? 0), 0) + 1;
  return store.create('calendar', { name: '', color: 'iris', order, defaultReminders: [10], allDayReminders: [], ...fields });
}

export function deleteCalendar(id) {
  const c = store.get(id);
  if (!c || c.isDefault) return;
  play('delete');
  const ids = [id, ...store.all('event').filter((e) => e.calendarId === id).map((e) => e.id)];
  withUndo(tr('Deleted “{name}”', { name: calName(c) }), ids, () => ids.forEach((x) => store.remove(x)));
  setHidden(id, false);
}

// ---------- undo ----------

// Runs `mutate`, then offers Undo: items listed in `ids` go back to how they were and
// anything `mutate` returns as newly made is removed again.
export function withUndo(message, ids, mutate, { silent = false } = {}) {
  const before = ids.map((id) => store.get(id)).filter(Boolean).map((x) => ({ ...x }));
  const gone = new Set(ids.filter((id) => !store.get(id)));
  const created = mutate() || [];
  const undo = () => {
    play('undo');
    created.forEach((x) => x && store.remove(typeof x === 'string' ? x : x.id));
    before.forEach((s) => store.restore(s));
    void gone;
  };
  if (!silent) toast(message, undo);
  return undo;
}

// ---------- times ----------

const splitWall = (s) => [s.slice(0, 10), s.length > 10 ? s.slice(11, 16) : '00:00'];
export const localYmd = (ms) => ymd(new Date(ms));
export const midnight = (ymdStr) => parseYmd(ymdStr).getTime();
export const wallOf = (ms, tz) => {
  const w = msToWall(ms, tz);
  return `${w.date}T${w.time}`;
};

// Instants of a stored event's own start and end.
export function spanOf(ev) {
  if (ev.allDay) return [midnight(ev.start), midnight(ev.end || addDays(ev.start, 1))];
  const tz = ev.tz || localTz();
  const [sd, st] = splitWall(ev.start);
  const [ed, et] = splitWall(ev.end || ev.start);
  const s = wallToMs(sd, st, tz);
  return [s, Math.max(s, wallToMs(ed, et, tz))];
}

// ---------- occurrences ----------

// A few recent answers are kept (the page, the sidebar's mini month and the lists ask
// for different ranges); any change to the data clears them.
const cache = new Map();
let cacheVersion = -1;

/**
 * Everything to draw between two instants: event occurrences, birthdays and (optionally) tasks,
 * each as { key, kind, ev|task, allDay, startMs, endMs, startDate, endDate, ... }.
 * endDate is the day after the last day (all-day style) for both kinds.
 */
export function occurrences(fromMs, toMs, { all = false, withTasks = true, birthdays = true } = {}) {
  const prefs = store.getPrefs();
  if (cacheVersion !== store.getVersion()) {
    cache.clear();
    cacheVersion = store.getVersion();
  }
  const key = `${fromMs}|${toMs}|${all}|${withTasks}|${birthdays}|${JSON.stringify(prefs.calHidden || {})}|${prefs.calShowTasks}|${prefs.calShowDone}|${today()}`;
  if (cache.has(key)) return cache.get(key);
  const hidden = all ? {} : hiddenSet();
  const cals = new Map(calendars().map((c) => [c.id, c]));
  const events = store.all('event');
  const overridden = new Map();
  for (const e of events) {
    if (!e.recurringId || !e.originalStart) continue;
    if (!overridden.has(e.recurringId)) overridden.set(e.recurringId, new Set());
    overridden.get(e.recurringId).add(dn(e.originalStart.slice(0, 10)));
  }
  const out = [];
  for (const ev of events) {
    const cal = cals.get(ev.calendarId);
    if (!cal || hidden[cal.id] || ev.cancelled) continue;
    for (const o of expand(ev, fromMs, toMs, overridden.get(ev.id), cal)) out.push(o);
  }
  if (withTasks && prefs.calShowTasks !== false && !hidden[TASKS_CAL]) out.push(...taskOccurrences(fromMs, toMs));
  if (birthdays && !hidden[BIRTHDAYS_CAL]) out.push(...birthdayOccurrences(fromMs, toMs));
  out.sort(compareOcc);
  if (cache.size > 12) cache.delete(cache.keys().next().value);
  cache.set(key, out);
  return out;
}

export function compareOcc(a, b) {
  return a.startMs - b.startMs || (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0) || (b.endMs - b.startMs) - (a.endMs - a.startMs) || (a.kind === 'task' ? 1 : 0) - (b.kind === 'task' ? 1 : 0) || String(a.title).localeCompare(String(b.title));
}

function makeOcc(ev, cal, startMs, endMs, origStart, extra) {
  const allDay = !!ev.allDay;
  const startDate = localYmd(startMs);
  let endDate = allDay ? localYmd(endMs) : localYmd(Math.max(startMs, endMs - 1));
  if (!allDay) endDate = addDays(endDate, 1);
  if (endDate <= startDate) endDate = addDays(startDate, 1);
  const color = colorOf(ev.color || (cal && cal.color) || 'ocean');
  return {
    key: `${ev.id}|${origStart || ''}`,
    kind: 'event',
    ev,
    id: ev.id,
    seriesId: ev.recurringId || (ev.rrule ? ev.id : null),
    origStart: origStart || ev.originalStart || null,
    recurring: !!(ev.rrule || ev.recurringId),
    allDay,
    startMs,
    endMs,
    startDate,
    endDate,
    title: ev.title || tr('(No title)'),
    location: ev.location || '',
    color,
    readOnly: !!(cal && cal.sub),
    ...extra,
  };
}

function expand(ev, fromMs, toMs, overriddenDays, cal) {
  const out = [];
  if (ev.allDay) {
    const len = Math.max(1, dn(ev.end || addDays(ev.start, 1)) - dn(ev.start));
    if (!ev.rrule) {
      const s = midnight(ev.start);
      const e = midnight(ev.end || addDays(ev.start, 1));
      if (s < toMs && e > fromMs) out.push(makeOcc(ev, cal, s, e, ev.originalStart || null));
      return out;
    }
    const ex = new Set((ev.exdates || []).map((x) => dn(x.slice(0, 10))));
    if (overriddenDays) overriddenDays.forEach((d) => ex.add(d));
    const fromD = dn(localYmd(fromMs)) - len;
    const toD = dn(localYmd(toMs));
    for (const day of ruleDays(ev.rrule, ev.start, fromD, toD, { exdays: ex, limit: 1500 })) {
      const sd = fromDn(day);
      const s = midnight(sd);
      const e = midnight(fromDn(day + len));
      if (s < toMs && e > fromMs) out.push(makeOcc(ev, cal, s, e, sd, { first: sd === ev.start }));
    }
    return out;
  }
  const tz = ev.tz || localTz();
  const [s0, e0] = spanOf(ev);
  const dur = Math.max(0, e0 - s0);
  if (!ev.rrule) {
    if (s0 < toMs && (e0 > fromMs || (dur === 0 && s0 >= fromMs))) out.push(makeOcc(ev, cal, s0, e0, ev.originalStart || null));
    return out;
  }
  const [, st] = splitWall(ev.start);
  const ex = new Set((ev.exdates || []).map((x) => dn(x.slice(0, 10))));
  if (overriddenDays) overriddenDays.forEach((d) => ex.add(d));
  const fromD = dn(msToWall(fromMs - dur, tz).date) - 1;
  const toD = dn(msToWall(toMs, tz).date) + 1;
  for (const day of ruleDays(ev.rrule, ev.start.slice(0, 10), fromD, toD, { exdays: ex, limit: 1500 })) {
    const sd = fromDn(day);
    const s = wallToMs(sd, st, tz);
    const e = s + dur;
    if (s < toMs && (e > fromMs || (dur === 0 && s >= fromMs))) out.push(makeOcc(ev, cal, s, e, `${sd}T${st}`, { first: sd === ev.start.slice(0, 10) }));
  }
  return out;
}

// Tasks with a date, drawn on the calendar like Google's Tasks calendar.
function taskOccurrences(fromMs, toMs) {
  const prefs = store.getPrefs();
  const showDone = prefs.calShowDone !== false;
  const live = new Set(store.all('project').filter((p) => !p.archived).map((p) => p.id));
  const fromD = localYmd(fromMs);
  const toD = localYmd(toMs - 1);
  const out = [];
  for (const t of allTasks()) {
    if (!t.due || !t.due.date || !live.has(t.projectId)) continue;
    if (t.done && !showDone) continue;
    const proj = store.get(t.projectId);
    const color = colorOf(proj && !proj.isInbox ? proj.color : 'slate');
    const push = (date, virtual) => {
      if (date < fromD || date > toD) return;
      const timed = !!t.due.time;
      const s = timed ? wallToMs(date, t.due.time, null) : midnight(date);
      const e = timed ? s + 30 * MIN : midnight(addDays(date, 1));
      out.push({
        key: `task:${t.id}|${date}`, kind: 'task', task: t, id: t.id, allDay: !timed, startMs: s, endMs: e,
        startDate: date, endDate: addDays(date, 1), title: t.title || tr('(No title)'), color,
        done: !!t.done, virtual, recurring: !!t.due.recur, project: proj ? projectName(proj) : '',
      });
    };
    push(t.due.date, false);
    if (!t.done && t.due.recur && !t.due.recur.fromDone) {
      let d = t.due.date;
      for (let i = 0; i < 120; i++) {
        const next = nextOccurrence({ ...t.due, date: d }, d);
        if (!next || next > toD) break;
        push(next, true);
        d = next;
      }
    }
  }
  return out;
}

// The occurrence of an event that starts at (or is closest after) a given instant.
export function findOccurrence(eventId, origStart) {
  const ev = store.get(eventId);
  if (!ev) return null;
  const cal = calendarOf(ev);
  if (!ev.rrule) return makeOcc(ev, cal, ...spanOf(ev), ev.originalStart || null);
  let at;
  if (origStart) {
    at = ev.allDay ? midnight(origStart.slice(0, 10)) : wallToMs(origStart.slice(0, 10), origStart.slice(11, 16) || '00:00', ev.tz);
  } else at = Date.now();
  const list = expand(ev, at - DAY, at + 400 * DAY, overriddenDaysOf(ev.id), cal);
  if (origStart) return list.find((o) => o.origStart === origStart) || list[0] || null;
  return list.find((o) => o.endMs > Date.now()) || list[0] || makeOcc(ev, cal, ...spanOf(ev), ev.start);
}

function overriddenDaysOf(seriesId) {
  const s = new Set();
  for (const e of store.all('event')) if (e.recurringId === seriesId && e.originalStart) s.add(dn(e.originalStart.slice(0, 10)));
  return s;
}

export const overridesOf = (seriesId) => store.all('event').filter((e) => e.recurringId === seriesId);

// ---------- words ----------

export function timeRangeText(occ, { short = false } = {}) {
  const fmt = store.getPrefs().timeFormat;
  if (occ.allDay) {
    const last = addDays(occ.endDate, -1);
    if (last === occ.startDate) return short ? tr('All day') : dayShortDate(occ.startDate);
    return `${shortDate(occ.startDate)} – ${shortDate(last)}`;
  }
  const s = new Date(occ.startMs);
  const e = new Date(occ.endMs);
  const t = (d) => formatTime(`${d.getHours()}:${d.getMinutes()}`, fmt);
  const sameDay = localYmd(occ.startMs) === localYmd(Math.max(occ.startMs, occ.endMs - 1));
  if (occ.kind === 'task') return t(s);
  if (occ.endMs === occ.startMs) return t(s);
  if (sameDay) return `${t(s)} – ${t(e)}`;
  return `${shortDate(localYmd(occ.startMs))} ${t(s)} – ${shortDate(localYmd(occ.endMs))} ${t(e)}`;
}

// ---------- making and changing events ----------

export function newEventFields(startMs, endMs, allDay, extra = {}) {
  const tz = localTz();
  const cal = store.get(extra.calendarId) || defaultCalendar();
  return {
    calendarId: cal ? cal.id : DEFAULT_CAL,
    title: '',
    allDay: !!allDay,
    start: allDay ? localYmd(startMs) : wallOf(startMs, tz),
    end: allDay ? localYmd(Math.max(endMs, startMs + DAY)) : wallOf(endMs, tz),
    tz,
    rrule: null,
    exdates: [],
    location: '',
    desc: '',
    color: null,
    reminders: null,
    ...extra,
  };
}

export function createEvent(fields) {
  play('add');
  const ev = store.create('event', { ...newEventFields(Date.now(), Date.now() + 3600000, false), ...fields });
  return ev;
}

const CONTENT = ['calendarId', 'title', 'allDay', 'start', 'end', 'tz', 'location', 'desc', 'color', 'reminders'];
const TIMING = ['allDay', 'start', 'end', 'tz'];
const timingChanged = (ev, ch) => TIMING.some((k) => k in ch && JSON.stringify(ch[k] ?? null) !== JSON.stringify(ev[k] ?? null));

// Shift a wall-time string by whole days, optionally replacing its time.
function shiftWall(s, days, time) {
  const d = fromDn(dn(s.slice(0, 10)) + days);
  return s.length > 10 ? `${d}T${time || s.slice(11, 16)}` : d;
}

/**
 * Applies changes to one occurrence. scope: 'this' | 'following' | 'all' (ignored for
 * events that don't repeat). changes may hold any event fields; start/end are this
 * occurrence's new times. Returns the ids of new items (for undo).
 */
export function changeOccurrence(occ, changes, scope = 'this') {
  const ev = store.get(occ.id);
  if (!ev) return [];
  const series = ev.recurringId ? store.get(ev.recurringId) : ev.rrule ? ev : null;
  if (!series) {
    store.patch(ev.id, changes);
    return [];
  }
  if (scope === 'this') {
    const { rrule, ...rest } = changes;
    void rrule;
    if (ev.recurringId) {
      store.patch(ev.id, rest);
      return [];
    }
    const [st, en] = occTimes(series, occ);
    const fields = {};
    CONTENT.forEach((k) => (fields[k] = series[k] ?? null));
    const made = store.create('event', {
      ...fields, start: st, end: en, rrule: null, exdates: [], recurringId: series.id, originalStart: occ.origStart, ...rest,
    });
    return [made.id];
  }
  const origDate = (occ.origStart || series.start).slice(0, 10);
  if (scope === 'following' && origDate > series.start.slice(0, 10)) return splitSeries(series, occ, changes);
  return changeSeries(series, occ, changes);
}

// This occurrence's own start/end strings, in the series' terms.
function occTimes(series, occ) {
  if (series.allDay) {
    const len = Math.max(1, dn(series.end) - dn(series.start));
    const s = occ.origStart.slice(0, 10);
    return [s, fromDn(dn(s) + len)];
  }
  const tz = series.tz || localTz();
  const [s0, e0] = spanOf(series);
  const s = wallToMs(occ.origStart.slice(0, 10), occ.origStart.slice(11, 16), tz);
  return [wallOf(s, tz), wallOf(s + (e0 - s0), tz)];
}

function changeSeries(series, occ, changes) {
  const patch = { ...changes };
  const timing = timingChanged({ ...series, ...occTimesObj(series, occ) }, changes);
  if (timing && (changes.start || changes.end || 'allDay' in changes)) {
    const [os] = occTimes(series, occ);
    const ns = changes.start || os;
    const shift = dn(ns.slice(0, 10)) - dn(os.slice(0, 10));
    const allDay = 'allDay' in changes ? changes.allDay : series.allDay;
    const newStartDate = fromDn(dn(series.start.slice(0, 10)) + shift);
    const newStart = allDay ? newStartDate : `${newStartDate}T${ns.length > 10 ? ns.slice(11, 16) : '09:00'}`;
    const ne = changes.end || occTimes(series, occ)[1];
    // keep this occurrence's new length
    let newEnd;
    if (allDay) newEnd = fromDn(dn(newStartDate) + Math.max(1, dn(ne.slice(0, 10)) - dn(ns.slice(0, 10))));
    else {
      const tz = changes.tz || series.tz || localTz();
      const lenMs = Math.max(0, wallToMs(ne.slice(0, 10), ne.slice(11, 16) || '00:00', tz) - wallToMs(ns.slice(0, 10), ns.slice(11, 16) || '00:00', tz));
      newEnd = wallOf(wallToMs(newStartDate, newStart.slice(11, 16), tz) + lenMs, tz);
    }
    patch.start = newStart;
    patch.end = newEnd;
    if (!('rrule' in changes) && shift) patch.rrule = reanchor(series.rrule, series.start.slice(0, 10), newStartDate);
    patch.exdates = (series.exdates || []).map((x) => (allDay ? shiftWall(x, shift).slice(0, 10) : `${shiftWall(x, shift).slice(0, 10)}T${newStart.slice(11, 16)}`));
    // changed occurrences no longer line up with the new times
    overridesOf(series.id).forEach((o) => store.remove(o.id));
  } else {
    const fieldChanges = {};
    Object.keys(changes).forEach((k) => !TIMING.includes(k) && k !== 'rrule' && (fieldChanges[k] = changes[k]));
    overridesOf(series.id).forEach((o) => Object.keys(fieldChanges).length && store.patch(o.id, fieldChanges));
    delete patch.start;
    delete patch.end;
  }
  if (patch.rrule && patch.rrule !== series.rrule && !('exdates' in patch)) patch.exdates = series.exdates || [];
  store.patch(series.id, patch);
  return [];
}

const occTimesObj = (series, occ) => {
  const [start, end] = occTimes(series, occ);
  return { start, end };
};

function splitSeries(series, occ, changes) {
  const origDate = occ.origStart.slice(0, 10);
  const before = countBefore(series.rrule, series.start.slice(0, 10), dn(origDate));
  const oldRule = { ...series.rrule };
  const newRule = { ...series.rrule };
  if (oldRule.count > 0) {
    oldRule.count = before;
    newRule.count = Math.max(1, series.rrule.count - before);
    delete oldRule.until;
  } else {
    oldRule.until = fromDn(dn(origDate) - 1);
  }
  const [os, oe] = occTimes(series, occ);
  const fields = {};
  CONTENT.forEach((k) => (fields[k] = series[k] ?? null));
  const start = changes.start || os;
  const end = changes.end || oe;
  let rule = 'rrule' in changes ? changes.rrule : newRule;
  if (rule && !('rrule' in changes) && start.slice(0, 10) !== origDate) rule = reanchor(rule, origDate, start.slice(0, 10));
  const timing = timingChanged({ ...series, start: os, end: oe }, changes);
  const made = store.create('event', {
    ...fields,
    ...changes,
    start,
    end,
    rrule: rule,
    exdates: timing ? [] : (series.exdates || []).filter((x) => x.slice(0, 10) >= origDate),
  });
  store.patch(series.id, { rrule: oldRule, exdates: (series.exdates || []).filter((x) => x.slice(0, 10) < origDate) });
  for (const o of overridesOf(series.id)) {
    if (o.originalStart && o.originalStart.slice(0, 10) >= origDate) {
      if (timing) store.remove(o.id);
      else store.patch(o.id, { recurringId: made.id });
    }
  }
  return [made.id];
}

/** Deletes one occurrence, it and the ones after, or the whole series. */
export function deleteOccurrence(occ, scope = 'this') {
  const ev = store.get(occ.id);
  if (!ev) return;
  play('delete');
  const series = ev.recurringId ? store.get(ev.recurringId) : ev.rrule ? ev : null;
  if (!series) {
    withUndo(tr('Event deleted'), [ev.id], () => store.remove(ev.id));
    return;
  }
  const overrides = overridesOf(series.id);
  const ids = [series.id, ...overrides.map((o) => o.id)];
  if (scope === 'all' || (scope === 'following' && (occ.origStart || '').slice(0, 10) <= series.start.slice(0, 10))) {
    withUndo(tr('Deleted all events in the series'), ids, () => ids.forEach((x) => store.remove(x)));
    return;
  }
  if (scope === 'following') {
    const origDate = occ.origStart.slice(0, 10);
    withUndo(tr('Deleted this and following events'), ids, () => {
      const rule = { ...series.rrule };
      if (rule.count > 0) rule.count = countBefore(series.rrule, series.start.slice(0, 10), dn(origDate));
      else rule.until = fromDn(dn(origDate) - 1);
      store.patch(series.id, { rrule: rule });
      overrides.filter((o) => o.originalStart && o.originalStart.slice(0, 10) >= origDate).forEach((o) => store.remove(o.id));
    });
    return;
  }
  withUndo(tr('Event deleted'), ids, () => {
    if (ev.recurringId) store.remove(ev.id);
    const orig = occ.origStart || ev.originalStart;
    if (orig) store.patch(series.id, { exdates: [...new Set([...(series.exdates || []), orig])] });
  });
}

export function duplicateEvent(occ) {
  const ev = store.get(occ.id);
  if (!ev) return null;
  const src = ev.recurringId ? store.get(ev.recurringId) || ev : ev;
  const fields = {};
  CONTENT.forEach((k) => (fields[k] = (ev[k] ?? src[k]) ?? null));
  const cal = calendarOf(ev);
  if (cal && cal.sub) fields.calendarId = (defaultCalendar() || {}).id || DEFAULT_CAL;
  const made = store.create('event', { ...fields, rrule: ev.recurringId ? null : ev.rrule || null, exdates: [], title: ev.title });
  play('add');
  toast(tr('Event duplicated'));
  return made;
}

// ---------- reminders ----------

export function remindersFor(ev) {
  if (Array.isArray(ev.reminders)) return ev.reminders;
  const c = calendarOf(ev);
  if (!c) return [];
  if (ev.allDay) return c.allDayReminders || [];
  return c.defaultReminders || [];
}

export function upcomingEventReminders(now = Date.now(), horizon = 8 * DAY) {
  const out = [];
  for (const o of occurrences(now - DAY, now + horizon + 2 * DAY, { all: true, withTasks: false, birthdays: false })) {
    const mins = remindersFor(o.ev);
    for (const m of mins) {
      const at = o.startMs - m * MIN;
      if (at <= now - MIN || at > now + horizon) continue;
      const when = o.allDay ? tr('All day') : timeRangeText(o);
      out.push({
        id: `ev:${o.id}:${o.origStart || ''}:${m}`,
        at,
        title: o.title,
        body: `${o.allDay ? `${dayShortDate(o.startDate)} · ${when}` : when}${o.location ? ` · ${o.location}` : ''}`,
      });
    }
  }
  return out;
}

// Reminder choices, in minutes before the start (all-day: before midnight, so 900 is
// "the day before at 9:00" and -540 is "on the day at 9:00").
export const TIMED_REMINDERS = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080];
export const ALLDAY_REMINDERS = [-540, 900, 2340, 9540];

export function reminderText(m, allDay) {
  const fmt = store.getPrefs().timeFormat;
  if (allDay) {
    const daysBefore = Math.ceil(m / 1440);
    const at = daysBefore * 1440 - m;
    const time = formatTime(`${Math.floor(at / 60)}:${at % 60}`, fmt);
    if (daysBefore <= 0) return tr('On the day at {time}', { time });
    if (daysBefore % 7 === 0) return tr('{n} week{s} before at {time}', { n: daysBefore / 7, time });
    return tr('{n} day{s} before at {time}', { n: daysBefore, time });
  }
  if (m === 0) return tr('At the start');
  if (m % 10080 === 0) return tr('{n} week{s} before', { n: m / 10080 });
  if (m % 1440 === 0) return tr('{n} day{s} before', { n: m / 1440 });
  if (m % 60 === 0) return tr('{n} hour{s} before', { n: m / 60 });
  return tr('{n} minute{s} before', { n: m });
}

// ---------- search ----------

export function searchEvents(q, limit = 100) {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const hits = store.all('event').filter((e) => !e.cancelled && store.get(e.calendarId) && `${e.title || ''}\n${e.location || ''}\n${e.desc || ''}`.toLowerCase().includes(needle));
  const now = Date.now();
  const out = [];
  for (const e of hits) {
    let occ;
    if (e.rrule) {
      const list = expand(e, now - DAY, now + 730 * DAY, overriddenDaysOf(e.id), calendarOf(e));
      occ = list.find((o) => o.endMs > now) || null;
      if (!occ) occ = makeOcc(e, calendarOf(e), ...spanOf(e), e.allDay ? e.start : e.start);
    } else occ = makeOcc(e, calendarOf(e), ...spanOf(e), e.originalStart || null);
    out.push(occ);
  }
  const upcoming = out.filter((o) => o.endMs > now).sort(compareOcc);
  const past = out.filter((o) => o.endMs <= now).sort((a, b) => b.startMs - a.startMs);
  return [...upcoming, ...past].slice(0, limit);
}

// ---------- .ics feeds and files ----------

export function hash(s) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const FEED_FIELDS = ['title', 'allDay', 'start', 'end', 'tz', 'rrule', 'exdates', 'location', 'desc', 'reminders', 'recurringId', 'originalStart'];

/**
 * Turns a parsed .ics into event items for one calendar. Ids are fixed (prefix, calendar,
 * UID), so reading the same file again, or on another device, updates instead of adding.
 * keepAlarms: use the file's reminders (imports) or the calendar's (subscriptions).
 */
export function feedItems(parsed, calId, { prefix = 'ics', keepAlarms = false, sinceMs = null } = {}) {
  const series = new Map();
  const items = [];
  const seen = new Set();
  const idFor = (uid, extra) => {
    let id = `${prefix}_${calId}_${hash(`${uid}|${extra || ''}`)}`;
    while (seen.has(id)) id += 'x';
    seen.add(id);
    return id;
  };
  const singles = parsed.events.filter((e) => !e.recurrenceId);
  const changed = parsed.events.filter((e) => e.recurrenceId);
  for (const e of singles) {
    if (e.cancelled) continue;
    const it = {
      id: idFor(e.uid || `${e.title}|${e.start}`), type: 'event', calendarId: calId,
      title: e.title, allDay: e.allDay, start: e.start, end: e.end, tz: e.allDay ? null : e.tz || null,
      rrule: e.rrule || null, exdates: e.exdates || [], location: e.location || '', desc: e.desc || '',
      color: null, reminders: keepAlarms && e.reminders ? e.reminders : null, recurringId: null, originalStart: null,
      src: { k: prefix, uid: e.uid || '' },
    };
    if (e.uid && e.rrule) series.set(e.uid, it);
    items.push(it);
  }
  for (const e of changed) {
    const s = series.get(e.uid);
    if (!s) continue;
    let orig = e.recurrenceId;
    if (!s.allDay && e.recurrenceTz && s.tz && e.recurrenceTz !== s.tz) orig = wallOf(wallToMs(orig.slice(0, 10), orig.slice(11, 16), e.recurrenceTz), s.tz);
    else if (!s.allDay && e.recurrenceMs != null && s.tz) orig = wallOf(e.recurrenceMs, s.tz);
    if (s.allDay) orig = orig.slice(0, 10);
    if (e.cancelled) {
      s.exdates = [...new Set([...(s.exdates || []), orig])];
      continue;
    }
    items.push({
      id: idFor(e.uid, orig), type: 'event', calendarId: calId,
      title: e.title, allDay: e.allDay, start: e.start, end: e.end, tz: e.allDay ? null : e.tz || null,
      rrule: null, exdates: [], location: e.location || '', desc: e.desc || '', color: null,
      reminders: keepAlarms && e.reminders ? e.reminders : null, recurringId: s.id, originalStart: orig,
      src: { k: prefix, uid: e.uid || '' },
    });
  }
  // Subscriptions only keep what's recent or still to come.
  const kept = (sinceMs == null ? items : items.filter((it) => {
    if (it.rrule) {
      if (it.rrule.until) return midnight(it.rrule.until) + DAY > sinceMs;
      if (it.rrule.count > 0) return true;
      return true;
    }
    if (it.recurringId) return items.some((x) => x.id === it.recurringId) && spanOf(it)[1] > sinceMs - 400 * DAY;
    return spanOf(it)[1] > sinceMs;
  })).slice();
  // A very long feed keeps every repeating event and the most recent single ones,
  // so one calendar can't use up the free sync allowance.
  const MAX = 3000;
  if (kept.length > MAX) {
    const series = kept.filter((it) => it.rrule || it.recurringId);
    const singles = kept.filter((it) => !it.rrule && !it.recurringId).sort((a, b) => spanOf(b)[1] - spanOf(a)[1]);
    kept.length = 0;
    kept.push(...series.slice(0, MAX), ...singles.slice(0, Math.max(0, MAX - series.length)));
  }
  for (const it of kept) {
    const content = {};
    FEED_FIELDS.forEach((k) => (content[k] = it[k] ?? null));
    it.h = hash(JSON.stringify(content));
  }
  return kept;
}

/** Writes feed items into the store. Returns { added, updated, removed, total }. */
export function applyFeed(calId, items, { prefix = 'ics', removeMissing = true } = {}) {
  const stats = { added: 0, updated: 0, removed: 0, total: items.length };
  const want = new Set();
  for (const it of items) {
    want.add(it.id);
    const cur = store.raw(it.id);
    if (cur && !cur.deleted && cur.h === it.h && cur.calendarId === calId) continue;
    // a person's own change to an imported event is kept until the file changes it
    if (cur && !cur.deleted && prefix === 'imp' && cur.h === it.h) continue;
    store.put({ createdAt: (cur && cur.createdAt) || Date.now(), ...it });
    if (cur && !cur.deleted) stats.updated++;
    else stats.added++;
  }
  if (removeMissing) {
    for (const e of store.all('event')) {
      if (e.calendarId === calId && e.src && e.src.k === prefix && !want.has(e.id)) {
        store.remove(e.id);
        stats.removed++;
      }
    }
  }
  return stats;
}

// Every event of a calendar (or all calendars), ready for toIcs().
export function eventsForExport(calId) {
  return store.all('event').filter((e) => (calId ? e.calendarId === calId : true) && !e.cancelled);
}

export function isZhCal() {
  return isZh();
}

export { COLORS };
