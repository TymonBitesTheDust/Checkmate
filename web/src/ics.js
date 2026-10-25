// iCalendar (.ics) files: reading Google Calendar's "secret address in iCal format"
// and exported calendars, and writing Checkmate calendars back out.

import { parseRRule, formatRRule } from './recur.js';
import { normalizeZone, wallToMs, msToWall, localTz } from './tz.js';

const pad = (n) => String(n).padStart(2, '0');

// ---------- reading ----------

function unfold(text) {
  return String(text || '').replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

// "DTSTART;TZID=Australia/Sydney:20261019T100000" -> { name, params, value }
function parseLine(line) {
  let i = 0;
  let inQuote = false;
  let colon = -1;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ':' && !inQuote) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const bits = [];
  let cur = '';
  inQuote = false;
  for (const c of head) {
    if (c === '"') inQuote = !inQuote;
    if (c === ';' && !inQuote) {
      bits.push(cur);
      cur = '';
    } else cur += c;
  }
  bits.push(cur);
  const params = {};
  for (const b of bits.slice(1)) {
    const eq = b.indexOf('=');
    if (eq > 0) params[b.slice(0, eq).toUpperCase()] = b.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: bits[0].toUpperCase(), params, value };
}

export function unescapeText(v) {
  return String(v || '').replace(/\\([\\;,nN])/g, (m, c) => (c === 'n' || c === 'N' ? '\n' : c));
}

// Google sometimes stores descriptions as simple HTML.
function plainText(s) {
  if (!/<\/?[a-z][^>]*>/i.test(s)) return s;
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/gi, (m, href, txt) => (txt && txt !== href ? `${txt} (${href})` : href))
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// A date or date-time value -> { allDay, date, time, ms, tz }
function readTime(prop, fallbackTz) {
  if (!prop) return null;
  const v = prop.value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (!m[4] || (prop.params.VALUE || '').toUpperCase() === 'DATE') return { allDay: true, date };
  const time = `${m[4]}:${m[5]}`;
  if (m[7]) {
    const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    return { allDay: false, ms, utc: true };
  }
  const tz = normalizeZone(prop.params.TZID) || fallbackTz || localTz();
  return { allDay: false, date, time, tz, ms: wallToMs(date, time, tz) };
}

const wallStr = (ms, tz) => {
  const w = msToWall(ms, tz);
  return `${w.date}T${w.time}`;
};

// "PT1H30M", "P1D", "-PT15M", "P1W" -> milliseconds (signed)
export function parseDuration(v) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(v || '').trim());
  if (!m) return null;
  const ms = ((+m[2] || 0) * 7 * 86400 + (+m[3] || 0) * 86400 + (+m[4] || 0) * 3600 + (+m[5] || 0) * 60 + (+m[6] || 0)) * 1000;
  return m[1] === '-' ? -ms : ms;
}

function addDaysStr(date, n) {
  const [y, mo, d] = date.split('-').map(Number);
  const x = new Date(Date.UTC(y, mo - 1, d + n));
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
}

/**
 * Parses an .ics file. Returns { name, tz, events: [...] } where each event is in the
 * shape Checkmate stores (start/end as "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM" in tz), plus
 * uid and, for a changed occurrence of a series, recurrenceId (in the series' terms).
 */
export function parseIcs(text) {
  const lines = unfold(text);
  if (!lines.some((l) => /^BEGIN:VCALENDAR/i.test(l))) throw new Error('not-ics');
  const cal = { name: '', tz: null, events: [] };
  const stack = [];
  let ev = null;
  let alarm = null;
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const p = parseLine(raw);
    if (!p) continue;
    if (p.name === 'BEGIN') {
      const what = p.value.trim().toUpperCase();
      stack.push(what);
      if (what === 'VEVENT') ev = { props: {}, multi: { EXDATE: [] }, alarms: [] };
      else if (what === 'VALARM' && ev) alarm = {};
      continue;
    }
    if (p.name === 'END') {
      const what = stack.pop();
      if (what === 'VEVENT' && ev) {
        const done = finishEvent(ev, cal.tz);
        if (done) cal.events.push(done);
        ev = null;
      } else if (what === 'VALARM' && ev && alarm) {
        ev.alarms.push(alarm);
        alarm = null;
      }
      continue;
    }
    const where = stack[stack.length - 1];
    if (where === 'VCALENDAR') {
      if (p.name === 'X-WR-CALNAME') cal.name = unescapeText(p.value).trim();
      if (p.name === 'X-WR-TIMEZONE') cal.tz = normalizeZone(p.value.trim());
    } else if (where === 'VALARM' && alarm) {
      alarm[p.name] = p;
    } else if (where === 'VEVENT' && ev) {
      if (p.name === 'EXDATE') ev.multi.EXDATE.push(p);
      else if (!ev.props[p.name]) ev.props[p.name] = p;
    }
  }
  return cal;
}

function finishEvent(ev, calTz) {
  const P = ev.props;
  const s = readTime(P.DTSTART, calTz);
  if (!s) return null;
  const out = {
    uid: P.UID ? P.UID.value.trim() : '',
    title: P.SUMMARY ? unescapeText(P.SUMMARY.value).trim() : '',
    location: P.LOCATION ? unescapeText(P.LOCATION.value).trim() : '',
    desc: P.DESCRIPTION ? plainText(unescapeText(P.DESCRIPTION.value)).trim() : '',
    allDay: !!s.allDay,
    cancelled: P.STATUS ? /CANCELLED/i.test(P.STATUS.value) : false,
  };
  let tz = null;
  if (s.allDay) {
    out.start = s.date;
    const e = readTime(P.DTEND, calTz);
    if (e && e.allDay && e.date > s.date) out.end = e.date;
    else if (P.DURATION) {
      const ms = parseDuration(P.DURATION.value) || 86400000;
      out.end = addDaysStr(s.date, Math.max(1, Math.round(ms / 86400000)));
    } else out.end = addDaysStr(s.date, 1);
  } else {
    tz = s.utc ? calTz || localTz() : s.tz;
    if (s.utc && !calTz) tz = 'UTC';
    out.tz = tz;
    out.start = wallStr(s.ms, tz);
    const e = readTime(P.DTEND, calTz);
    let endMs = s.ms;
    if (e && !e.allDay) endMs = e.ms;
    else if (P.DURATION) endMs = s.ms + (parseDuration(P.DURATION.value) || 0);
    if (endMs < s.ms) endMs = s.ms;
    out.end = wallStr(endMs, tz);
  }
  if (P.RRULE) out.rrule = parseRRule(P.RRULE.value, tz || calTz || localTz());
  const ex = [];
  for (const x of ev.multi.EXDATE) {
    for (const v of x.value.split(',')) {
      const t = readTime({ value: v, params: x.params }, tz || calTz);
      if (!t) continue;
      if (out.allDay) ex.push(t.allDay ? t.date : msToWall(t.ms, tz || localTz()).date);
      else if (t.allDay) ex.push(`${t.date}T${out.start.slice(11)}`);
      else ex.push(wallStr(t.ms, tz));
    }
  }
  if (ex.length) out.exdates = ex;
  if (P['RECURRENCE-ID']) {
    const r = readTime(P['RECURRENCE-ID'], tz || calTz);
    if (r) {
      if (r.allDay) out.recurrenceId = out.allDay ? r.date : `${r.date}T${out.start.slice(11)}`;
      else {
        out.recurrenceMs = r.ms;
        out.recurrenceId = r.utc ? wallStr(r.ms, tz || 'UTC') : `${r.date}T${r.time}`;
        if (!r.utc) out.recurrenceTz = r.tz;
      }
    }
  }
  const rem = [];
  for (const a of ev.alarms) {
    const trig = a.TRIGGER;
    if (!trig || (trig.params.VALUE || '').toUpperCase() === 'DATE-TIME') continue;
    if ((trig.params.RELATED || '').toUpperCase() === 'END') continue;
    const ms = parseDuration(trig.value);
    if (ms == null) continue;
    const min = Math.round(-ms / 60000);
    if (!rem.includes(min)) rem.push(min);
  }
  if (rem.length) out.reminders = rem.sort((a, b) => a - b);
  return out;
}

// ---------- writing ----------

export function escapeText(v) {
  return String(v || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// Lines longer than 75 bytes are folded onto continuation lines (never mid-character).
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > limit) {
      out.push(cur);
      cur = ' ';
      bytes = 1;
      limit = 75;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n');
}

const compactDate = (d) => d.replace(/-/g, '');
const compactDateTime = (s) => `${s.slice(0, 10).replace(/-/g, '')}T${s.slice(11, 13)}${s.slice(14, 16)}00`;
function utcStamp(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function timeProp(name, value, ev) {
  if (ev.allDay) return `${name};VALUE=DATE:${compactDate(value.slice(0, 10))}`;
  if (!ev.tz || ev.tz === 'UTC') return `${name}:${utcStamp(wallToMs(value.slice(0, 10), value.slice(11, 16), ev.tz || 'UTC'))}`;
  return `${name};TZID=${ev.tz}:${compactDateTime(value)}`;
}

/**
 * events: stored Checkmate events (series, single events and changed occurrences).
 * A changed occurrence (recurringId + originalStart) is written as a VEVENT with the
 * series' UID and a RECURRENCE-ID.
 */
export function toIcs(events, { name = 'Checkmate', tz = localTz(), uidOf } = {}) {
  const uid = (ev) => (uidOf ? uidOf(ev) : null) || ev.uid || `${ev.id}@tickwise`;
  const byId = new Map(events.map((e) => [e.id, e]));
  const stamp = utcStamp(Date.now());
  const L = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Checkmate//Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`, `X-WR-TIMEZONE:${tz}`,
  ];
  for (const ev of events) {
    if (!ev || ev.cancelled) continue;
    const series = ev.recurringId ? byId.get(ev.recurringId) : null;
    L.push('BEGIN:VEVENT');
    L.push(`UID:${series ? uid(series) : uid(ev)}`);
    L.push(`DTSTAMP:${stamp}`);
    L.push(timeProp('DTSTART', ev.start, ev));
    L.push(timeProp('DTEND', ev.end || ev.start, ev));
    const orig = ev.originalStart || ev.recurrenceId;
    if ((ev.recurringId || ev.recurrenceId) && orig) {
      const base = series || ev;
      L.push(timeProp('RECURRENCE-ID', orig, { allDay: base.allDay, tz: base.tz }));
    }
    if (ev.rrule) L.push(`RRULE:${formatRRule(ev.rrule, { allDay: ev.allDay, tz: ev.tz })}`);
    for (const x of ev.exdates || []) L.push(timeProp('EXDATE', x, ev));
    L.push(`SUMMARY:${escapeText(ev.title || '')}`);
    if (ev.location) L.push(`LOCATION:${escapeText(ev.location)}`);
    if (ev.desc) L.push(`DESCRIPTION:${escapeText(ev.desc)}`);
    for (const m of ev.reminders || []) {
      L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(ev.title || 'Reminder')}`);
      const a = Math.abs(m);
      L.push(`TRIGGER:${m > 0 ? '-' : ''}PT${a}M`);
      L.push('END:VALARM');
    }
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return `${L.map(fold).join('\r\n')}\r\n`;
}
