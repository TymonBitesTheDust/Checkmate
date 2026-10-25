// Repeating events, the way Google Calendar (and the iCalendar RRULE standard) does
// them: "weekly on Monday and Wednesday", "monthly on the third Sunday", "every
// weekday", "annually on 18 October", with an end date or a number of times.
//
// A rule is stored as
//   { freq: 'daily'|'weekly'|'monthly'|'yearly', interval, byDay: [{ wd: 0-6, n }],
//     byMonthDay: [..], byMonth: [1-12], bySetPos: [..], count, until: 'YYYY-MM-DD', wkst }
// where n in byDay is 0 for "every Monday", 2 for "the second Monday", -1 for "the last".
// Dates are worked out as floating calendar days; the event's time and zone are
// applied afterwards (see events.js).

import { isZh } from './i18n.js';
import { MONTHS, DAYS } from './dates.js';
import { wallToMs, msToWall } from './tz.js';

const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');

// ---------- day numbers (days since 1970-01-01) ----------

export const dn = (ymdStr) => {
  const [y, m, d] = ymdStr.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY);
};
export function fromDn(n) {
  const d = new Date(n * DAY);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
const ymdParts = (n) => {
  const d = new Date(n * DAY);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
};
const dnOf = (y, m, d) => Math.round(Date.UTC(y, m - 1, d) / DAY);
const wdOf = (n) => (((n + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday
const monthLen = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

const WD_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// ---------- candidates within one month ----------

function monthCandidates(rule, y, m, d0) {
  const len = monthLen(y, m);
  let days = null;
  if (rule.byMonthDay && rule.byMonthDay.length) {
    days = new Set();
    for (const v of rule.byMonthDay) {
      const d = v < 0 ? len + 1 + v : v;
      if (d >= 1 && d <= len) days.add(d);
    }
  }
  if (rule.byDay && rule.byDay.length) {
    const set = new Set();
    const firstWd = wdOf(dnOf(y, m, 1));
    for (const { wd, n } of rule.byDay) {
      const first = 1 + ((wd - firstWd + 7) % 7);
      const all = [];
      for (let d = first; d <= len; d += 7) all.push(d);
      if (!n) all.forEach((d) => set.add(d));
      else {
        const pick = n > 0 ? all[n - 1] : all[all.length + n];
        if (pick) set.add(pick);
      }
    }
    days = days ? new Set([...days].filter((d) => set.has(d))) : set;
  }
  if (!days) days = d0 <= len ? new Set([d0]) : new Set();
  return [...days].sort((a, b) => a - b).map((d) => dnOf(y, m, d));
}

function applySetPos(list, setPos) {
  if (!setPos || !setPos.length || !list.length) return list;
  const out = new Set();
  for (const p of setPos) {
    const v = p > 0 ? list[p - 1] : list[list.length + p];
    if (v !== undefined) out.add(v);
  }
  return [...out].sort((a, b) => a - b);
}

// All candidate days of period p (not yet limited by the start date or end).
function periodDays(rule, p, base) {
  const iv = Math.max(1, rule.interval || 1);
  const { start, y0, m0, d0, weekStart } = base;
  const byMonth = rule.byMonth && rule.byMonth.length ? rule.byMonth : null;
  switch (rule.freq) {
    case 'daily': {
      const day = start + p * iv;
      const [, m, d] = ymdParts(day);
      if (byMonth && !byMonth.includes(m)) return [];
      if (rule.byMonthDay && rule.byMonthDay.length) {
        const [y] = ymdParts(day);
        const len = monthLen(y, m);
        if (!rule.byMonthDay.some((v) => (v < 0 ? len + 1 + v : v) === d)) return [];
      }
      if (rule.byDay && rule.byDay.length && !rule.byDay.some((b) => b.wd === wdOf(day))) return [];
      return [day];
    }
    case 'weekly': {
      const ws = weekStart + 7 * p * iv;
      const wkst = rule.wkst ?? 1;
      const wds = rule.byDay && rule.byDay.length ? [...new Set(rule.byDay.map((b) => b.wd))] : [wdOf(start)];
      let days = wds.map((wd) => ws + ((wd - wkst + 7) % 7)).sort((a, b) => a - b);
      if (byMonth) days = days.filter((x) => byMonth.includes(ymdParts(x)[1]));
      return applySetPos(days, rule.bySetPos);
    }
    case 'monthly': {
      const total = y0 * 12 + (m0 - 1) + p * iv;
      const y = Math.floor(total / 12);
      const m = (total % 12) + 1;
      if (byMonth && !byMonth.includes(m)) return [];
      return applySetPos(monthCandidates(rule, y, m, d0), rule.bySetPos);
    }
    case 'yearly': {
      const y = y0 + p * iv;
      const hasDays = (rule.byMonthDay && rule.byMonthDay.length) || (rule.byDay && rule.byDay.length);
      const months = byMonth || (hasDays && rule.byDay && rule.byDay.some((b) => !b.n) && !(rule.byMonthDay && rule.byMonthDay.length) ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : [m0]);
      let days = [];
      for (const m of months) days.push(...monthCandidates(rule, y, m, d0));
      days.sort((a, b) => a - b);
      return applySetPos(days, rule.bySetPos);
    }
    default:
      return p === 0 ? [start] : [];
  }
}

/**
 * Occurrence dates (day numbers) of a rule that starts on startYmd, from fromDn to toDn.
 * The start date itself is always the first occurrence, as in Google Calendar.
 */
export function ruleDays(rule, startYmd, fromDn, toDn, { exdays = null, limit = 2000 } = {}) {
  const start = dn(startYmd);
  if (!rule) return start >= fromDn && start <= toDn ? [start] : [];
  const [y0, m0, d0] = ymdParts(start);
  const wkst = rule.wkst ?? 1;
  const base = { start, y0, m0, d0, weekStart: start - ((wdOf(start) - wkst + 7) % 7) };
  const untilDn = rule.until ? dn(rule.until) : Infinity;
  const count = rule.count > 0 ? rule.count : Infinity;
  const end = Math.min(toDn, untilDn);
  const out = [];
  if (end < start) return out;
  const iv = Math.max(1, rule.interval || 1);

  // Without a count, jump straight to the periods near the range.
  let p = 0;
  if (count === Infinity && fromDn > start) {
    const gap = fromDn - start;
    if (rule.freq === 'daily') p = Math.max(0, Math.floor(gap / iv) - 1);
    else if (rule.freq === 'weekly') p = Math.max(0, Math.floor((fromDn - base.weekStart) / (7 * iv)) - 1);
    else if (rule.freq === 'monthly') {
      const [fy, fm] = ymdParts(fromDn);
      p = Math.max(0, Math.floor(((fy - y0) * 12 + (fm - m0)) / iv) - 1);
    } else if (rule.freq === 'yearly') p = Math.max(0, Math.floor((ymdParts(fromDn)[0] - y0) / iv) - 1);
  }

  let n = 0;
  // The first occurrence is the start date even when the rule wouldn't pick it.
  const startPicked = periodDays(rule, 0, base).includes(start);
  if (!startPicked) {
    n++;
    if (start >= fromDn && start <= end && !(exdays && exdays.has(start))) out.push(start);
  }
  let guard = 0;
  let empty = 0;
  for (; guard < 40000; p++, guard++) {
    const days = periodDays(rule, p, base);
    if (!days.length) {
      if (++empty > 2000) break;
      // still stop if the whole period is past the end
      const probe = rule.freq === 'daily' ? start + p * iv : null;
      if (probe != null && probe > end) break;
      continue;
    }
    empty = 0;
    let past = false;
    for (const day of days) {
      if (day < start) continue;
      if (day > end) {
        past = true;
        break;
      }
      n++;
      if (n > count) return out;
      if (day >= fromDn && !(exdays && exdays.has(day))) {
        out.push(day);
        if (out.length >= limit) return out;
      }
    }
    if (past || n >= count) break;
  }
  return out;
}

// The day of the last occurrence, or null if the rule never ends.
export function lastDay(rule, startYmd) {
  if (!rule) return dn(startYmd);
  if (!rule.until && !(rule.count > 0)) return null;
  const days = ruleDays(rule, startYmd, dn(startYmd), rule.until ? dn(rule.until) : dn(startYmd) + 366 * 200, { limit: 100000 });
  return days.length ? days[days.length - 1] : dn(startYmd);
}

// How many occurrences come before a given day (for splitting a series).
export function countBefore(rule, startYmd, dayN) {
  return ruleDays(rule, startYmd, dn(startYmd), dayN - 1, { limit: 100000 }).length;
}

// ---------- presets (Google's "Repeat" list) ----------

export const nthOfMonth = (ymdStr) => Math.ceil(+ymdStr.slice(8, 10) / 7);
export const isLastWeekOfMonth = (ymdStr) => {
  const [y, m, d] = ymdStr.split('-').map(Number);
  return d + 7 > monthLen(y, m);
};

export function presets(startYmd) {
  const n = dn(startYmd);
  const wd = wdOf(n);
  const [, m, d] = ymdParts(n);
  const nth = nthOfMonth(startYmd);
  const list = [
    { key: 'none', rule: null },
    { key: 'daily', rule: { freq: 'daily', interval: 1 } },
    { key: 'weekly', rule: { freq: 'weekly', interval: 1, byDay: [{ wd, n: 0 }] } },
    nth <= 4 && { key: 'monthlyNth', rule: { freq: 'monthly', interval: 1, byDay: [{ wd, n: nth }] } },
    isLastWeekOfMonth(startYmd) && { key: 'monthlyLast', rule: { freq: 'monthly', interval: 1, byDay: [{ wd, n: -1 }] } },
    { key: 'monthlyDay', rule: { freq: 'monthly', interval: 1, byMonthDay: [d] } },
    { key: 'yearly', rule: { freq: 'yearly', interval: 1, byMonth: [m], byMonthDay: [d] } },
    { key: 'weekdays', rule: { freq: 'weekly', interval: 1, byDay: [1, 2, 3, 4, 5].map((x) => ({ wd: x, n: 0 })) } },
  ].filter(Boolean);
  return list;
}

// Two rules that mean the same (ignoring how they end).
export function sameRule(a, b) {
  if (!a || !b) return !a && !b;
  const norm = (r) => JSON.stringify({
    f: r.freq, i: r.interval || 1,
    d: (r.byDay || []).map((x) => `${x.n || 0}:${x.wd}`).sort(),
    md: [...(r.byMonthDay || [])].sort(), mo: [...(r.byMonth || [])].sort(), sp: [...(r.bySetPos || [])].sort(),
  });
  return norm(a) === norm(b);
}

// Re-anchor a rule to a new first date, e.g. when a series is moved to another day.
export function reanchor(rule, oldYmd, newYmd) {
  if (!rule || oldYmd === newYmd) return rule;
  const shift = dn(newYmd) - dn(oldYmd);
  const r = { ...rule };
  const [, m, d] = ymdParts(dn(newYmd));
  if (r.freq === 'weekly' && r.byDay) r.byDay = r.byDay.map((b) => ({ ...b, wd: (((b.wd + shift) % 7) + 7) % 7 }));
  if (r.freq === 'monthly') {
    if (r.byDay && r.byDay.some((b) => b.n)) r.byDay = [{ wd: wdOf(dn(newYmd)), n: r.byDay[0].n < 0 ? -1 : nthOfMonth(newYmd) }];
    else if (r.byMonthDay) r.byMonthDay = [d];
  }
  if (r.freq === 'yearly') {
    if (r.byMonth) r.byMonth = [m];
    if (r.byMonthDay) r.byMonthDay = [d];
  }
  if (r.until) r.until = fromDn(dn(r.until) + shift);
  return r;
}

// ---------- words ----------

const ZH_WD = ['日', '一', '二', '三', '四', '五', '六'];
const ZH_NTH = { 1: '第一個', 2: '第二個', 3: '第三個', 4: '第四個', 5: '第五個', [-1]: '最後一個' };
const EN_NTH = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', [-1]: 'last' };
const isWeekdays = (r) => r.freq === 'weekly' && (r.interval || 1) === 1 && r.byDay && r.byDay.length === 5 && [1, 2, 3, 4, 5].every((x) => r.byDay.some((b) => b.wd === x));

function listEn(arr) {
  if (arr.length <= 1) return arr.join('');
  return `${arr.slice(0, -1).join(', ')} and ${arr[arr.length - 1]}`;
}

// "Weekly on Monday" / "每週一", "Monthly on the third Sunday" / "每月第三個星期日"…
export function describeRule(r, startYmd, { withEnd = true } = {}) {
  if (!r) return isZh() ? '不重複' : 'Does not repeat';
  const iv = Math.max(1, r.interval || 1);
  const zh = isZh();
  const start = startYmd ? dn(startYmd) : null;
  const [, sm, sd] = start != null ? ymdParts(start) : [0, 1, 1];
  const days = (r.byDay || []).map((b) => b.wd);
  let s;
  if (isWeekdays(r)) s = zh ? '每個工作日（星期一至星期五）' : 'Every weekday (Monday to Friday)';
  else if (r.freq === 'daily') s = zh ? (iv === 1 ? '每天' : `每${iv}天`) : iv === 1 ? 'Daily' : `Every ${iv} days`;
  else if (r.freq === 'weekly') {
    const wds = days.length ? [...new Set(days)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)) : start != null ? [wdOf(start)] : [];
    if (zh) s = `${iv === 1 ? '每週' : `每${iv}週`}${wds.map((x) => ZH_WD[x]).join('、')}`;
    else s = `${iv === 1 ? 'Weekly' : `Every ${iv} weeks`} on ${listEn(wds.map((x) => DAYS[x]))}`;
  } else if (r.freq === 'monthly') {
    const nthDay = r.byDay && r.byDay.find((b) => b.n);
    const head = zh ? (iv === 1 ? '每月' : `每${iv}個月`) : iv === 1 ? 'Monthly' : `Every ${iv} months`;
    if (nthDay) s = zh ? `${head}${ZH_NTH[nthDay.n] || `第${nthDay.n}個`}星期${ZH_WD[nthDay.wd]}` : `${head} on the ${EN_NTH[nthDay.n] || nthDay.n} ${DAYS[nthDay.wd]}`;
    else {
      const md = (r.byMonthDay && r.byMonthDay[0]) || sd;
      s = zh ? `${head}${md === -1 ? '最後一天' : `${md}日`}` : md === -1 ? `${head} on the last day` : `${head} on day ${md}`;
    }
  } else if (r.freq === 'yearly') {
    const m = (r.byMonth && r.byMonth[0]) || sm;
    const nthDay = r.byDay && r.byDay.find((b) => b.n);
    const head = zh ? (iv === 1 ? '每年' : `每${iv}年`) : iv === 1 ? 'Annually' : `Every ${iv} years`;
    if (nthDay) s = zh ? `${head}${m}月${ZH_NTH[nthDay.n] || ''}星期${ZH_WD[nthDay.wd]}` : `${head} on the ${EN_NTH[nthDay.n] || nthDay.n} ${DAYS[nthDay.wd]} of ${MONTHS[m - 1]}`;
    else {
      const md = (r.byMonthDay && r.byMonthDay[0]) || sd;
      s = zh ? `${head}${m}月${md}日` : `${head} on ${MONTHS[m - 1]} ${md}`;
    }
  } else s = zh ? '重複' : 'Repeats';
  if (withEnd) {
    if (r.count > 0) s += zh ? `，共${r.count}次` : `, ${r.count} times`;
    else if (r.until) {
      const [y, m, d] = r.until.split('-').map(Number);
      s += zh ? `，直至${y}年${m}月${d}日` : `, until ${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`;
    }
  }
  return s;
}

// ---------- iCalendar RRULE text ----------

export function parseRRule(text, tz) {
  const r = { freq: null, interval: 1 };
  for (const part of String(text || '').replace(/^RRULE:/i, '').split(';')) {
    const [k, v] = part.split('=');
    if (!k || v == null) continue;
    const key = k.trim().toUpperCase();
    const val = v.trim();
    if (key === 'FREQ') r.freq = val.toLowerCase();
    else if (key === 'INTERVAL') r.interval = Math.max(1, parseInt(val, 10) || 1);
    else if (key === 'COUNT') r.count = parseInt(val, 10) || null;
    else if (key === 'UNTIL') r.until = untilDate(val, tz);
    else if (key === 'BYDAY') {
      r.byDay = val.split(',').map((x) => {
        const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(x.trim());
        return m ? { wd: WD_CODES.indexOf(m[2].toUpperCase()), n: m[1] ? parseInt(m[1], 10) : 0 } : null;
      }).filter(Boolean);
    } else if (key === 'BYMONTHDAY') r.byMonthDay = val.split(',').map((x) => parseInt(x, 10)).filter((x) => x && Math.abs(x) <= 31);
    else if (key === 'BYMONTH') r.byMonth = val.split(',').map((x) => parseInt(x, 10)).filter((x) => x >= 1 && x <= 12);
    else if (key === 'BYSETPOS') r.bySetPos = val.split(',').map((x) => parseInt(x, 10)).filter(Boolean);
    else if (key === 'WKST') r.wkst = WD_CODES.indexOf(val.toUpperCase());
  }
  if (!['daily', 'weekly', 'monthly', 'yearly'].includes(r.freq)) return null;
  if (r.wkst == null || r.wkst < 0) delete r.wkst;
  return r;
}

function untilDate(v, tz) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(v);
  if (!m) return null;
  if (!m[4]) return `${m[1]}-${m[2]}-${m[3]}`;
  if (m[7]) {
    const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    return msToWall(ms, tz).date;
  }
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export function formatRRule(r, { allDay, tz, time } = {}) {
  if (!r) return '';
  const parts = [`FREQ=${r.freq.toUpperCase()}`];
  if ((r.interval || 1) > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.count > 0) parts.push(`COUNT=${r.count}`);
  else if (r.until) {
    if (allDay) parts.push(`UNTIL=${r.until.replace(/-/g, '')}`);
    else {
      const ms = wallToMs(r.until, '23:59', tz);
      const d = new Date(ms + 59000);
      parts.push(`UNTIL=${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`);
    }
  }
  if (r.byDay && r.byDay.length) parts.push(`BYDAY=${r.byDay.map((b) => `${b.n ? b.n : ''}${WD_CODES[b.wd]}`).join(',')}`);
  if (r.byMonthDay && r.byMonthDay.length) parts.push(`BYMONTHDAY=${r.byMonthDay.join(',')}`);
  if (r.byMonth && r.byMonth.length) parts.push(`BYMONTH=${r.byMonth.join(',')}`);
  if (r.bySetPos && r.bySetPos.length) parts.push(`BYSETPOS=${r.bySetPos.join(',')}`);
  if (r.wkst != null && r.wkst !== 1) parts.push(`WKST=${WD_CODES[r.wkst]}`);
  void time;
  return parts.join(';');
}

// A task's repeat ("every mon", "每月15號") as an event rule.
export function ruleFromTaskRecur(rec) {
  if (!rec) return null;
  const every = Math.max(1, rec.every || 1);
  let r = null;
  switch (rec.unit) {
    case 'day': r = { freq: 'daily', interval: every }; break;
    case 'weekday': r = { freq: 'weekly', interval: 1, byDay: [1, 2, 3, 4, 5].map((wd) => ({ wd, n: 0 })) }; break;
    case 'weekend': r = { freq: 'weekly', interval: 1, byDay: [6, 0].map((wd) => ({ wd, n: 0 })) }; break;
    case 'week': r = { freq: 'weekly', interval: every, ...(rec.days && rec.days.length ? { byDay: rec.days.map((wd) => ({ wd, n: 0 })) } : {}) }; break;
    case 'month': r = { freq: 'monthly', interval: every, ...(rec.monthDay ? { byMonthDay: [rec.monthDay] } : {}) }; break;
    case 'year': r = { freq: 'yearly', interval: every, ...(rec.month != null ? { byMonth: [rec.month + 1] } : {}), ...(rec.monthDay ? { byMonthDay: [rec.monthDay] } : {}) }; break;
    default: return null;
  }
  if (rec.until) r.until = rec.until;
  return r;
}
