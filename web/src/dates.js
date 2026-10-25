// Date helpers. Due dates are stored as local calendar dates ("YYYY-MM-DD")
// plus an optional "HH:MM" time, so they mean the same day on every device.

import { isZh, t } from './i18n.js';

const pad = (n) => String(n).padStart(2, '0');

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAYS_SHORT = DAYS.map((d) => d.slice(0, 3));

// ---------- names in the current language ----------
const ZH_DAYS = ['日', '一', '二', '三', '四', '五', '六'];
export const dayName = (i) => (isZh() ? `星期${ZH_DAYS[i]}` : DAYS[i]);
export const dayShort = (i) => (isZh() ? `週${ZH_DAYS[i]}` : DAYS_SHORT[i]);
export const dayMin = (i) => (isZh() ? ZH_DAYS[i] : DAYS_SHORT[i].slice(0, 2));
export const monthName = (i) => (isZh() ? `${i + 1}月` : MONTHS[i]);
export const monthShort = (i) => (isZh() ? `${i + 1}月` : MONTHS_SHORT[i]);

// "October 2026" / "2026年10月"
export function monthYear(d) {
  return isZh() ? `${d.getFullYear()}年${d.getMonth() + 1}月` : `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// "Saturday 17 October" / "10月17日 星期六"
export function dayLong(s) {
  const d = parseYmd(s);
  return isZh() ? `${d.getMonth() + 1}月${d.getDate()}日 ${dayName(d.getDay())}` : `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

// "Sat 17 Oct" / "10月17日 週六"
export function dayShortDate(s) {
  const d = parseYmd(s);
  return isZh() ? `${d.getMonth() + 1}月${d.getDate()}日 ${dayShort(d.getDay())}` : `${DAYS_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

export function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const today = () => ymd(new Date());

export function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

export function addMonths(s, n, dayOfMonth) {
  const d = parseYmd(s);
  const target = dayOfMonth || d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(target, last));
  return ymd(d);
}

export function diffDays(a, b) {
  return Math.round((parseYmd(a) - parseYmd(b)) / 86400000);
}

export const weekday = (s) => parseYmd(s).getDay();

export function startOfWeek(s, weekStart = 1) {
  const wd = weekday(s);
  return addDays(s, -((wd - weekStart + 7) % 7));
}

export function nextWeekday(from, wd, { includeToday = false } = {}) {
  const cur = weekday(from);
  let delta = (wd - cur + 7) % 7;
  if (delta === 0 && !includeToday) delta = 7;
  return addDays(from, delta);
}

export function formatTime(tm, fmt = '24') {
  if (!tm) return '';
  const [h, m] = tm.split(':').map(Number);
  if (fmt === '24') return `${pad(h)}:${pad(m)}`;
  const hh = h % 12 || 12;
  if (isZh()) {
    const part = h < 12 ? '上午' : '下午';
    return m ? `${part}${hh}:${pad(m)}` : `${part}${hh}點`;
  }
  const ap = h >= 12 ? 'pm' : 'am';
  return m ? `${hh}:${pad(m)}${ap}` : `${hh}${ap}`;
}

// "17 Oct" / "10月17日", with the year added when it isn't this year.
export function shortDate(s, ref = today()) {
  const d = parseYmd(s);
  const r = parseYmd(ref);
  const other = d.getFullYear() !== r.getFullYear();
  if (isZh()) return `${other ? `${d.getFullYear()}年` : ''}${d.getMonth() + 1}月${d.getDate()}日`;
  const base = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  return other ? `${base} ${d.getFullYear()}` : base;
}

// Friendly due label + tone used for colouring.
export function dueLabel(due, fmt = '24', ref = today()) {
  if (!due || !due.date) return null;
  const diff = diffDays(due.date, ref);
  let text;
  let tone;
  if (diff < 0) {
    tone = 'overdue';
    text = diff === -1 ? t('Yesterday') : shortDate(due.date, ref);
  } else if (diff === 0) {
    tone = 'today';
    text = t('Today');
  } else if (diff === 1) {
    tone = 'tomorrow';
    text = t('Tomorrow');
  } else if (diff < 7) {
    tone = 'week';
    text = dayName(weekday(due.date));
  } else {
    tone = 'later';
    text = shortDate(due.date, ref);
  }
  if (due.time) {
    text += ` ${formatTime(due.time, fmt)}`;
    if (diff === 0) {
      const now = new Date();
      const [h, m] = due.time.split(':').map(Number);
      if (now.getHours() * 60 + now.getMinutes() > h * 60 + m) tone = 'overdue';
    }
  }
  return { text, tone };
}

export function dueTimestamp(due) {
  if (!due || !due.date) return null;
  const d = parseYmd(due.date);
  if (due.time) {
    const [h, m] = due.time.split(':').map(Number);
    d.setHours(h, m, 0, 0);
  } else {
    d.setHours(23, 59, 59, 0);
  }
  return d.getTime();
}

export function isOverdue(due, ref = today()) {
  if (!due || !due.date) return false;
  if (due.date < ref) return true;
  return false;
}

// ---------- recurrence ----------
// A rule looks like { text, unit: 'day'|'week'|'month'|'year'|'weekday',
//   every: n, days: [0..6] (for weekly), monthDay, month, fromDone }

export function nextOccurrence(due, completedOn = today()) {
  const r = due.recur;
  if (!r) return null;
  const base = r.fromDone ? completedOn : due.date;
  let next = base;
  const n = Math.max(1, r.every || 1);
  const advance = (d) => {
    switch (r.unit) {
      case 'day':
        return addDays(d, n);
      case 'weekday': {
        let x = addDays(d, 1);
        while (weekday(x) === 0 || weekday(x) === 6) x = addDays(x, 1);
        return x;
      }
      case 'weekend': {
        let x = addDays(d, 1);
        while (weekday(x) !== 0 && weekday(x) !== 6) x = addDays(x, 1);
        return x;
      }
      case 'week': {
        if (r.days && r.days.length) {
          // Next listed weekday; jump (n-1) extra weeks when wrapping around.
          const sorted = [...r.days].sort();
          const wd = weekday(d);
          const later = sorted.find((x) => x > wd);
          if (later !== undefined) return addDays(d, later - wd);
          return addDays(d, 7 * (n - 1) + (7 - wd + sorted[0]));
        }
        return addDays(d, 7 * n);
      }
      case 'month':
        return addMonths(d, n, r.monthDay);
      case 'year': {
        const x = parseYmd(d);
        return ymd(new Date(x.getFullYear() + n, r.month ?? x.getMonth(), r.monthDay || x.getDate()));
      }
      default:
        return addDays(d, 1);
    }
  };
  next = advance(base);
  // Skip occurrences up to and including the day it was completed.
  let guard = 0;
  while (next <= completedOn && guard++ < 5000) next = advance(next);
  if (r.until && next > r.until) return null;
  return next;
}

