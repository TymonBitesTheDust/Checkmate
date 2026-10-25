// Birthdays: yours and your friends', with reminders, on the calendar and in Today/Upcoming.
//
// Synced items like tasks:
//   birthday { name, month 1–12, day 1–31, year (optional, for ages), lunar (bool),
//              me (bool: it's your own), note, reminders (null = the default) }
// A lunar (農曆) birthday keeps the lunar month and day and lands on a different date
// each year (worked out from the table below, 1900–2100).
import * as store from './store.js';
import { ymd, parseYmd, addDays, today, diffDays } from './dates.js';
import { defaults, startOfDay } from './reminders.js';
import { tr, isZh } from './i18n.js';

export const BIRTHDAYS_CAL = 'birthdays';
const MIN = 60000;

export const all = () => store.all('birthday');

export function save(id, fields) {
  const clean = { ...fields, name: (fields.name || '').trim() };
  if (id && store.get(id)) return store.patch(id, clean);
  return store.create('birthday', { month: 1, day: 1, year: null, lunar: false, me: false, note: '', reminders: null, ...clean });
}

export const remindersOf = (b) => (Array.isArray(b.reminders) ? b.reminders : defaults().birthday);

// ---------- lunar calendar ----------

// One entry per lunar year 1900–2100, base 36: (day of the solar year its New Year falls on
// << 17) | (leap month, 0 = none << 13) | a bit per month, in order (leap month included),
// set when that month has 30 days. Generated from lunar-javascript (MIT), which follows the
// official tables; checked against it for every year. (Browsers' own Chinese calendar is off
// by a day in some years, e.g. New Year 2027, so it isn't used.)
const LUNAR = '2dt5e 3tp3m 2yu1x 27nt6 3l9hn 2nkpn 1w8ra 3ctwq 2hyl5 1nh3m 34evm 2ao85 3qwpx 2t6x7 1z82z 3fmi5 2kqjv 1q7vt 3799l 2ghaq 3wjo2 2ytr9 24vgt 3laae 2qcae 1tfp1 3cu6s 2hz8p 1qbo2 34gb6 2algm 3o2ej 2t6xj 1z7p2 3fo7u 2njys 1t809 37809 2dms3 3tpqr 2ys6j 225i3 3ih7x 2qctm 1w9xx 3cv50 2hykp 1nhqr 34fit 2808d 3o2eu 2t6zx 221ey 3fn3m 2ks6d 1tave 3a2bu 2dqqd 3qwlz 2ys7q 24yph 3ih91 2qd3m 1w7fp 3cvqd 2hxl6 1ks5z 31me3 2atei 3o2ga 2t755 221qq 3ihci 2krol 1qmob 378ln 2dsq3 3qv1p 2vz3h 24yuh 3lay1 2qefm 1waat 3cvfp 2jsr1 3wity 31kty 27qut 3o2qd 2t7s9 2236a 3ihzm 2nl7q 1qdzq 34fh3 2dsra 3tobe 2vzdh 24urt 3l9op 2qd1v 1tfl7 3a0q3 2f597 1ngpm 31ld6 281g5 3qwtg 2w095 1z98z 3fo2d 2kqi5 1qkdp 34fjp 2dz8q 3tosy 2ytut 252dm 3lave 2qe8l 1w8q6 3a0ra 2f5bp 1ngs2 34es2 27smd 3o2sl 2t64r 1z6hj 3cvcb 2kqje 1qe3a 378tl 2ec7m 3tpw2 2ytd1 251sb 3ih57 2njjf 1tisb 3a0tp 2f5gq 1nhw2 34g42 2auxx 3o3z9 2t6xh 1z831 3fmwm 2hxh1 1qene 379hl 2gnte 3tqj6 2ytra 24ymu 3ih5j 2njkm 1tcr9 3a15h 2hxs9 1ksk3 31llf 2808b 3o2ej 2qdsr 1z87u 3fn1m 2krqd 1qmve 378sq 2dtw5 3tpqt 2vz1p 225kd 3ih85 2qcve 1tdph 3a2ed 2hyyy 1nogl 31ms6 2811q 3o2fq 2t705 1z8aa 3fnbm 2ksdh 1te8a 34eq3 2axzr 3qvfv 2vz2z 225li 3ihd6 2qd76 1w945 3a1xh 2f5aj 1knff 31l7v'.split(' ').map((x) => parseInt(x, 36));
const FIRST = 1900;
const LAST = FIRST + LUNAR.length - 1;

export const lunarSupported = () => true;
// The editor offers lunar dates only when Settings → Calendar → Lunar birthdays is on.
export const lunarOffered = () => !!store.getPrefs().lunarBirthdays;

function months(ly) {
  const v = LUNAR[ly - FIRST];
  const leap = (v >> 13) & 15;
  const out = [];
  let bit = 0;
  for (let m = 1; m <= 12; m++) {
    out.push({ month: m, leap: false, days: (v >> bit++) & 1 ? 30 : 29 });
    if (m === leap) out.push({ month: m, leap: true, days: (v >> bit++) & 1 ? 30 : 29 });
  }
  return { start: addDays(`${ly}-01-01`, v >> 17), months: out };
}

// The solar date of a lunar date (ordinary month). A 30th in a 29-day month falls on the 29th.
export function lunarToSolar(ly, month, day) {
  if (ly < FIRST || ly > LAST) return null;
  const { start, months: ms } = months(ly);
  let off = 0;
  for (const m of ms) {
    if (m.month === month && !m.leap) return addDays(start, off + Math.min(day, m.days) - 1);
    off += m.days;
  }
  return null;
}

// The lunar date of a day: { year, month, day, leap }
export function toLunar(date) {
  let ly = +date.slice(0, 4);
  if (ly > LAST || ly < FIRST) return null;
  if (date < months(ly).start) ly--;
  if (ly < FIRST) return null;
  const { start, months: ms } = months(ly);
  let off = diffDays(date, start);
  for (const m of ms) {
    if (off < m.days) return { year: ly, month: m.month, day: off + 1, leap: m.leap };
    off -= m.days;
  }
  return null;
}

// ---------- dates ----------

const isLeapYear = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

// The birthday's date in a solar year (lunar: the lunar date of that lunar year).
function dateFor(b, year) {
  if (b.lunar) return lunarToSolar(year, b.month, b.day);
  let day = b.day;
  if (b.month === 2 && day === 29 && !isLeapYear(year)) day = 28;
  return `${year}-${String(b.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Every date the birthday falls on between two dates (inclusive), with the age it marks.
export function datesBetween(b, from, to) {
  const out = [];
  const y0 = +from.slice(0, 4) - 1;
  const y1 = +to.slice(0, 4);
  for (let y = y0; y <= y1; y++) {
    const d = dateFor(b, y);
    if (!d || d < from || d > to) continue;
    out.push({ date: d, age: b.year ? y - b.year : null });
  }
  return out;
}

// The next time it comes round, today included.
export function next(b, from = today()) {
  return datesBetween(b, from, addDays(from, 400))[0] || null;
}

export function daysUntil(b, from = today()) {
  const n = next(b, from);
  return n ? diffDays(n.date, from) : null;
}

// ---------- words ----------

const ZH_NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const zhMonth = (m) => (m === 1 ? '正' : m === 12 ? '臘' : m === 11 ? '冬' : m <= 10 ? ZH_NUM[m] : `十${ZH_NUM[m - 10]}`);
function zhDay(d) {
  if (d <= 10) return `初${ZH_NUM[d]}`;
  if (d < 20) return `十${ZH_NUM[d - 10]}`;
  if (d === 20) return '二十';
  if (d < 30) return `廿${ZH_NUM[d - 20]}`;
  return '三十';
}

export function lunarText(month, day) {
  return isZh() ? `農曆${zhMonth(month)}月${zhDay(day)}` : tr('Lunar month {m}, day {d}', { m: month, d: day });
}

// "14 March" / "3月14日", or the lunar date
export function dateText(b) {
  if (b.lunar) return lunarText(b.month, b.day);
  const d = new Date(2000, b.month - 1, b.day);
  return d.toLocaleDateString(isZh() ? 'zh-Hant' : [], { day: 'numeric', month: 'long' });
}

export function titleOf(b) {
  if (b.me) return tr('Your birthday');
  return tr('{name}’s birthday', { name: b.name || tr('(No name)') });
}

export function ageText(age, me) {
  if (age == null || age < 0) return '';
  if (me) return tr('You turn {n}', { n: age });
  return tr('Turns {n}', { n: age });
}

export function untilText(days) {
  if (days == null) return '';
  if (days === 0) return tr('Today');
  if (days === 1) return tr('Tomorrow');
  return tr('In {n} days', { n: days });
}

// ---------- calendar and reminders ----------

const midnight = (date) => startOfDay(date);

// Occurrences for the calendar, Today and Upcoming (all-day, read-only).
export function occurrences(fromMs, toMs) {
  const from = ymd(new Date(fromMs));
  const to = ymd(new Date(toMs - 1));
  const color = '#e8618c';
  const out = [];
  for (const b of all()) {
    for (const { date, age } of datesBetween(b, from, to)) {
      out.push({
        key: `bd:${b.id}|${date}`, kind: 'birthday', birthday: b, id: b.id, allDay: true,
        startMs: midnight(date), endMs: midnight(addDays(date, 1)), startDate: date, endDate: addDays(date, 1),
        title: titleOf(b), age, color, readOnly: true, recurring: true, location: '',
      });
    }
  }
  return out;
}

export function birthdayReminders(now = Date.now(), horizonMs = now + 8 * 86400000) {
  const out = [];
  const from = ymd(new Date(now - 86400000));
  const to = ymd(new Date(horizonMs + 40 * 86400000));
  for (const b of all()) {
    const mins = remindersOf(b);
    if (!mins.length) continue;
    for (const { date, age } of datesBetween(b, from, to)) {
      for (const m of mins) {
        const at = midnight(date) - m * MIN;
        if (at <= now - MIN || at >= horizonMs) continue;
        const days = diffDays(date, ymd(new Date(at)));
        out.push({
          id: `bd:${b.id}:${date}:${m}`,
          at,
          title: `🎂 ${titleOf(b)}`,
          body: [untilText(Math.max(0, days)), ageText(age, b.me), b.lunar ? lunarText(b.month, b.day) : ''].filter(Boolean).join(' · '),
        });
      }
    }
  }
  return out;
}

// Sorted by the next date (today first), for the Birthdays page.
export function upcoming(from = today()) {
  return all()
    .map((b) => ({ b, next: next(b, from) }))
    .map((x) => ({ ...x, days: x.next ? diffDays(x.next.date, from) : 9999 }))
    .sort((a, c) => a.days - c.days || (a.b.name || '').localeCompare(c.b.name || ''));
}
