// Natural-language quick add: "Pay rent every 1st at 9am p1 #Home @bills"
import {
  today, addDays, addMonths, nextWeekday, startOfWeek, ymd, parseYmd, weekday,
  MONTHS_SHORT, DAYS, formatTime, shortDate, dayName,
} from './dates.js';
import { isZh, t } from './i18n.js';

const WD = '(?:mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)';
// "sat"/"sun" on their own are too often ordinary words; they need "next"/"this"/"on".
const WD_SAFE = '(?:mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|saturday|sunday)';
const MON = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const ORD = '(?:st|nd|rd|th)?';
const NUMWORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const NUM = `(\\d+|${Object.keys(NUMWORDS).join('|')})`;
// Word edges count only Latin letters, so "明天5pm" or "p1買牛奶" still match.
const B = '(?<![\\p{Script=Latin}\\p{N}_])';
const E = '(?![\\p{Script=Latin}\\p{N}_])';

const wdIndex = (s) => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(s.slice(0, 3).toLowerCase());
const monIndex = (s) => MONTHS_SHORT.map((m) => m.toLowerCase()).indexOf(s.slice(0, 3).toLowerCase());
const toNum = (s) => (/^\d+$/.test(s) ? parseInt(s, 10) : NUMWORDS[s.toLowerCase()] || 1);
const re = (src) => new RegExp(B + src + E, 'giu');

function nextMonthDay(ref, day) {
  const d = parseYmd(ref);
  let cand = new Date(d.getFullYear(), d.getMonth(), day);
  if (cand.getDate() !== day || ymd(cand) < ref) {
    cand = parseYmd(addMonths(ymd(new Date(d.getFullYear(), d.getMonth(), 1)), 1, day));
  }
  return ymd(cand);
}

function nextYearDate(ref, month, day, year) {
  if (year) {
    if (year < 100) year += 2000;
    return ymd(new Date(year, month, day));
  }
  const r = parseYmd(ref);
  let c = new Date(r.getFullYear(), month, day);
  if (ymd(c) < ref) c = new Date(r.getFullYear() + 1, month, day);
  return ymd(c);
}

const PART_TIMES = { morning: '09:00', afternoon: '13:00', evening: '19:00', night: '21:00' };

// Each rule: [regex, kind, handler(match, ref) -> partial]
function rules(dateOrder) {
  return [
    // ----- recurrence -----
    [re(`(every!?|each)\\s+(other\\s+)?(?:${NUM}\\s+)?(day|days|week|weeks|month|months|year|years|weekday|weekdays|workday|workdays|weekend|weekends)`), 'recur', (m, ref) => {
      const fromDone = m[1].endsWith('!');
      let every = m[2] ? 2 : m[3] ? toNum(m[3]) : 1;
      const u = m[4].toLowerCase();
      if (u.startsWith('weekday') || u.startsWith('workday')) {
        const d = weekday(ref) === 0 || weekday(ref) === 6 ? nextWeekday(ref, 1) : ref;
        return { recur: { unit: 'weekday', every: 1, fromDone }, date: d };
      }
      if (u.startsWith('weekend')) {
        const d = weekday(ref) === 0 || weekday(ref) === 6 ? ref : nextWeekday(ref, 6);
        return { recur: { unit: 'weekend', every: 1, fromDone }, date: d };
      }
      const unit = u.replace(/s$/, '');
      const recur = { unit, every, fromDone, anchor: true };
      if (unit === 'week') recur.days = [weekday(ref)];
      if (unit === 'month') recur.monthDay = parseYmd(ref).getDate();
      return { recur, date: ref };
    }],
    [re(`(every!?)\\s+(${WD}(?:\\s*(?:,|and|&)?\\s*${WD})*)`), 'recur', (m, ref) => {
      const days = [...new Set(m[2].toLowerCase().match(new RegExp(WD, 'gi')).map(wdIndex))].sort();
      const first = days.map((d) => nextWeekday(ref, d, { includeToday: true })).sort()[0];
      return { recur: { unit: 'week', every: 1, days, fromDone: m[1].endsWith('!') }, date: first };
    }],
    [re(`every!?\\s+(morning|afternoon|evening|night)`), 'recur', (m, ref) => ({
      recur: { unit: 'day', every: 1 }, date: ref, time: PART_TIMES[m[1].toLowerCase()],
    })],
    [re(`every!?\\s+(${MON})\\s+(\\d{1,2})${ORD}`), 'recur', (m, ref) => {
      const mo = monIndex(m[1]);
      const day = +m[2];
      return { recur: { unit: 'year', every: 1, month: mo, monthDay: day }, date: nextYearDate(ref, mo, day) };
    }],
    [re(`every!?\\s+(\\d{1,2})${ORD}\\s+(?:of\\s+)?(${MON})`), 'recur', (m, ref) => {
      const mo = monIndex(m[2]);
      const day = +m[1];
      return { recur: { unit: 'year', every: 1, month: mo, monthDay: day }, date: nextYearDate(ref, mo, day) };
    }],
    [re(`every!?\\s+(?:month\\s+on\\s+the\\s+)?(\\d{1,2})(?:st|nd|rd|th)`), 'recur', (m, ref) => {
      const day = +m[1];
      return { recur: { unit: 'month', every: 1, monthDay: day }, date: nextMonthDay(ref, day) };
    }],
    [re(`(daily|weekly|fortnightly|monthly|yearly|annually)`), 'recur', (m, ref) => {
      const w = m[1].toLowerCase();
      const map = { daily: ['day', 1], weekly: ['week', 1], fortnightly: ['week', 2], monthly: ['month', 1], yearly: ['year', 1], annually: ['year', 1] };
      const [unit, every] = map[w];
      const recur = { unit, every, anchor: true };
      if (unit === 'week') recur.days = [weekday(ref)];
      if (unit === 'month') recur.monthDay = parseYmd(ref).getDate();
      return { recur, date: ref };
    }],

    // ----- dates -----
    [re(`(?:on\\s+)?(\\d{4})-(\\d{2})-(\\d{2})`), 'date', (m) => ({ date: `${m[1]}-${m[2]}-${m[3]}` })],
    [re(`(?:on\\s+|by\\s+|due\\s+)?(${MON})\\s+(\\d{1,2})${ORD}(?:,?\\s+(\\d{4}))?`), 'date', (m, ref) => ({
      date: nextYearDate(ref, monIndex(m[1]), +m[2], m[3] && +m[3]),
    })],
    [re(`(?:on\\s+|by\\s+|due\\s+)?(?:the\\s+)?(\\d{1,2})${ORD}\\s+(?:of\\s+)?(${MON})(?:,?\\s+(\\d{4}))?`), 'date', (m, ref) => ({
      date: nextYearDate(ref, monIndex(m[2]), +m[1], m[3] && +m[3]),
    })],
    // Numeric dates need a lead word, a year, or a following time/end of text,
    // so fractions like "1/2 kg" stay in the title.
    [new RegExp(B + `(?:(?:on|by|due)\\s+(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?|(\\d{1,2})/(\\d{1,2})/(\\d{2,4})|(\\d{1,2})/(\\d{1,2})(?=\\s*$|\\s+(?:at\\s+)?\\d))` + E, 'giu'), 'date', (m, ref) => {
      const g = m[1] ? [m[1], m[2], m[3]] : m[4] ? [m[4], m[5], m[6]] : [m[7], m[8], null];
      const [a, b] = [+g[0], +g[1]];
      const [day, mon] = dateOrder === 'mdy' ? [b, a] : [a, b];
      if (mon < 1 || mon > 12 || day < 1 || day > 31) return null;
      return { date: nextYearDate(ref, mon - 1, day, g[2] && +g[2]) };
    }],
    [re(`(?:by\\s+|due\\s+)?(today|tod|tonight|tomorrow|tmrw|tmr)(\\s+(morning|afternoon|evening|night))?`), 'date', (m, ref) => {
      const w = m[1].toLowerCase();
      const out = { date: ['today', 'tod', 'tonight'].includes(w) ? ref : addDays(ref, 1) };
      if (w === 'tonight') out.time = '19:00';
      if (m[3]) out.time = PART_TIMES[m[3].toLowerCase()];
      return out;
    }],
    [re(`(?:on\\s+|by\\s+|due\\s+)?(?:(next|this|coming)\\s+(${WD})|(${WD_SAFE}))(\\s+(morning|afternoon|evening|night))?`), 'date', (m, ref) => {
      m = [m[0], m[1], m[2] || m[3], m[4], m[5]];
      const wd = wdIndex(m[2]);
      const mod = (m[1] || '').toLowerCase();
      let date = nextWeekday(ref, wd, { includeToday: mod === 'this' });
      if (mod === 'next' && date < addDays(startOfWeek(ref, 1), 7)) date = addDays(date, 7);
      const out = { date };
      if (m[4]) out.time = PART_TIMES[m[4].toLowerCase()];
      return out;
    }],
    [re(`(next\\s+week|next\\s+weekend|this\\s+weekend|weekend|next\\s+month|end\\s+of\\s+(?:the\\s+)?month|eom|end\\s+of\\s+(?:the\\s+)?week|next\\s+year)`), 'date', (m, ref) => {
      const w = m[1].toLowerCase().replace(/\s+/g, ' ');
      if (w === 'next week') return { date: addDays(startOfWeek(ref, 1), 7) };
      if (w === 'this weekend' || w === 'weekend') return { date: nextWeekday(ref, 6, { includeToday: true }) };
      if (w === 'next weekend') return { date: addDays(startOfWeek(ref, 1), 12) };
      if (w === 'next month') {
        const d = parseYmd(ref);
        return { date: ymd(new Date(d.getFullYear(), d.getMonth() + 1, 1)) };
      }
      if (w === 'next year') {
        const d = parseYmd(ref);
        return { date: ymd(new Date(d.getFullYear() + 1, 0, 1)) };
      }
      if (w.includes('week')) return { date: nextWeekday(ref, 5, { includeToday: true }) };
      const d = parseYmd(ref);
      return { date: ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0)) };
    }],
    [re(`in\\s+${NUM}\\s+(day|days|week|weeks|month|months|year|years)`), 'date', (m, ref) => {
      const n = toNum(m[1]);
      const u = m[2].toLowerCase();
      if (u.startsWith('day')) return { date: addDays(ref, n) };
      if (u.startsWith('week')) return { date: addDays(ref, 7 * n) };
      if (u.startsWith('month')) return { date: addMonths(ref, n) };
      return { date: addMonths(ref, 12 * n) };
    }],

    // ----- times -----
    ...zhRules().filter((r) => r[1] === 'time'),
    [re(`(?:at\\s+|@)?(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm|a\\.m\\.|p\\.m\\.)`), 'time', (m) => {
      let h = +m[1];
      const min = m[2] ? +m[2] : 0;
      if (h < 1 || h > 12 || min > 59) return null;
      const pm = m[3].toLowerCase().startsWith('p');
      if (pm && h < 12) h += 12;
      if (!pm && h === 12) h = 0;
      return { time: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}` };
    }],
    [re(`(?:at\\s+)?([01]?\\d|2[0-3])[:.]([0-5]\\d)`), 'time', (m) => ({
      time: `${m[1].padStart(2, '0')}:${m[2]}`,
    })],
    [re(`at\\s+(\\d{1,2})`), 'time', (m) => {
      let h = +m[1];
      if (h > 23) return null;
      if (h >= 1 && h <= 7) h += 12;
      return { time: `${String(h).padStart(2, '0')}:00` };
    }],
    [re(`(?:at\\s+)?(noon|midday|midnight)`), 'time', (m) => ({
      time: m[1].toLowerCase() === 'midnight' ? '23:59' : '12:00',
    })],
    ...zhRules().filter((r) => r[1] !== 'time'),
  ];
}

// ---------- Traditional Chinese ----------
// 明天下午3點、每週一、下星期五、10月20日、3天後、每月15號、每隔一天…

const ZN = '([零〇一二兩三四五六七八九十\\d]+)';
const ZWD = '[一二三四五六日天]';
const WEEK = '(?:週|周|星期|禮拜)';
const zwd = (c) => '日天一二三四五六'.indexOf(c) < 2 ? 0 : '一二三四五六'.indexOf(c) + 1;

export function zhNum(s) {
  if (s == null || s === '') return null;
  if (/^\d+$/.test(s)) return +s;
  const digit = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (s === '十') return 10;
  const i = s.indexOf('十');
  if (i === -1) return [...s].reduce((n, c) => (c in digit ? n * 10 + digit[c] : NaN), 0);
  const tens = i === 0 ? 1 : digit[s[0]];
  const ones = i === s.length - 1 ? 0 : digit[s[i + 1]];
  return tens * 10 + ones;
}

const zre = (src) => new RegExp(src, 'gu');
const hhmm = (h, m = 0) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

function zhHour(part, h) {
  if (h == null || isNaN(h) || h > 24) return null;
  if (/下午|晚|傍晚|夜/.test(part || '')) return h < 12 ? h + 12 : h;
  if (/中午/.test(part || '')) return h < 11 ? h + 12 : h;
  if (/凌晨|上午|早/.test(part || '')) return h === 12 ? 0 : h;
  if (!part && h >= 1 && h <= 7) return h + 12;
  return h === 24 ? 0 : h;
}

function zhRules() {
  const PART = '(早上|上午|早晨|清晨|凌晨|中午|下午|傍晚|晚上|夜晚|晚)?';
  return [
    // recurrence
    [zre(`每(?:個)?(?:工作日|平日)`), 'recur', (m, ref) => {
      const d = weekday(ref) === 0 || weekday(ref) === 6 ? nextWeekday(ref, 1) : ref;
      return { recur: { unit: 'weekday', every: 1 }, date: d };
    }],
    [zre(`每(?:個)?週末`), 'recur', (m, ref) => ({
      recur: { unit: 'weekend', every: 1 },
      date: weekday(ref) === 0 || weekday(ref) === 6 ? ref : nextWeekday(ref, 6),
    })],
    [zre(`每(?:隔${ZN})?(?:${ZN})?(?:天|日)(?![0-9一二三四五六七八九十])`), 'recur', (m, ref) => {
      const every = m[1] ? zhNum(m[1]) + 1 : m[2] ? zhNum(m[2]) : 1;
      return { recur: { unit: 'day', every: every || 1 }, date: ref };
    }],
    [zre(`每(?:隔${ZN}個?)?(?:${ZN}個?)?${WEEK}((?:[、,，及和與跟]?${WEEK}?${ZWD})*)`), 'recur', (m, ref) => {
      const every = m[1] ? zhNum(m[1]) + 1 : m[2] ? zhNum(m[2]) : 1;
      const days = [...new Set((m[3] || '').match(new RegExp(ZWD, 'gu')) || [])].map(zwd).sort();
      if (!days.length) return { recur: { unit: 'week', every: every || 1, anchor: true }, date: ref };
      const first = days.map((d) => nextWeekday(ref, d, { includeToday: true })).sort()[0];
      return { recur: { unit: 'week', every: every || 1, days }, date: first };
    }],
    [zre(`每(?:隔${ZN}個?)?(?:${ZN}個?)?月(?:的)?(?:${ZN}(?:號|日))?`), 'recur', (m, ref) => {
      const every = m[1] ? zhNum(m[1]) + 1 : m[2] ? zhNum(m[2]) : 1;
      const day = m[3] ? zhNum(m[3]) : null;
      if (day && (day < 1 || day > 31)) return null;
      if (!day) return { recur: { unit: 'month', every: every || 1, anchor: true }, date: ref };
      return { recur: { unit: 'month', every: every || 1, monthDay: day }, date: nextMonthDay(ref, day) };
    }],
    [zre(`每年(?:的)?(?:${ZN}月${ZN}(?:號|日))?`), 'recur', (m, ref) => {
      if (!m[1]) {
        const d = parseYmd(ref);
        return { recur: { unit: 'year', every: 1, month: d.getMonth(), monthDay: d.getDate() }, date: ref };
      }
      const mo = zhNum(m[1]) - 1;
      const day = zhNum(m[2]);
      if (mo < 0 || mo > 11 || day < 1 || day > 31) return null;
      return { recur: { unit: 'year', every: 1, month: mo, monthDay: day }, date: nextYearDate(ref, mo, day) };
    }],

    // dates
    [zre(`(?:(\\d{4})年)?${ZN}月${ZN}(?:日|號)`), 'date', (m, ref) => {
      const mo = zhNum(m[2]) - 1;
      const day = zhNum(m[3]);
      if (mo < 0 || mo > 11 || day < 1 || day > 31) return null;
      return { date: nextYearDate(ref, mo, day, m[1] && +m[1]) };
    }],
    [zre(`(大後天|大后天|後天|后天|明天|明日|明早|明晚|今天|今日|今晚|今早|今晨|昨天)`), 'date', (m, ref) => {
      const w = m[1];
      const add = { 大後天: 3, 大后天: 3, 後天: 2, 后天: 2, 明天: 1, 明日: 1, 明早: 1, 明晚: 1, 昨天: -1 }[w] || 0;
      const out = { date: addDays(ref, add) };
      if (w === '今晚' || w === '明晚') out.time = '19:00';
      if (w === '今早' || w === '今晨' || w === '明早') out.time = '09:00';
      return out;
    }],
    [zre(`(下下|下|這|这|今|本)?(?:個)?${WEEK}(${ZWD})`), 'date', (m, ref) => {
      const wd = zwd(m[2]);
      const mod = m[1] || '';
      const weekStart = startOfWeek(ref, 1);
      const offset = (wd + 6) % 7; // Monday = 0 … Sunday = 6
      if (mod.startsWith('下')) return { date: addDays(weekStart, 7 * mod.length + offset) };
      if (mod) return { date: addDays(weekStart, offset) < ref ? nextWeekday(ref, wd, { includeToday: true }) : addDays(weekStart, offset) };
      return { date: nextWeekday(ref, wd) };
    }],
    [zre(`(下(?:個)?${WEEK}末|這個?週末|本週末|週末|下(?:個)?${WEEK}|下(?:個)?月|月底|明年|年底)`), 'date', (m, ref) => {
      const w = m[1];
      const d = parseYmd(ref);
      if (/末$/.test(w) && w.startsWith('下')) return { date: addDays(startOfWeek(ref, 1), 12) };
      if (/週末$/.test(w)) return { date: nextWeekday(ref, 6, { includeToday: true }) };
      if (w.startsWith('下') && /月$/.test(w)) return { date: ymd(new Date(d.getFullYear(), d.getMonth() + 1, 1)) };
      if (w.startsWith('下')) return { date: addDays(startOfWeek(ref, 1), 7) };
      if (w === '月底') return { date: ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0)) };
      if (w === '明年') return { date: ymd(new Date(d.getFullYear() + 1, 0, 1)) };
      return { date: ymd(new Date(d.getFullYear(), 11, 31)) };
    }],
    [zre(`${ZN}(?:個)?(天|日|${WEEK}|月|年)(?:之)?後`), 'date', (m, ref) => {
      const n = zhNum(m[1]);
      if (!n) return null;
      const u = m[2];
      if (u === '天' || u === '日') return { date: addDays(ref, n) };
      if (u === '月') return { date: addMonths(ref, n) };
      if (u === '年') return { date: addMonths(ref, 12 * n) };
      return { date: addDays(ref, 7 * n) };
    }],
    [zre(`(?<![月\\d零〇一二兩三四五六七八九十])${ZN}號`), 'date', (m, ref) => {
      const day = zhNum(m[1]);
      if (!day || day > 31) return null;
      return { date: nextMonthDay(ref, day) };
    }],

    // times
    [zre(`${PART.replace(/\)\?$/, ')')}\\s*(\\d{1,2})[:：](\\d{2})`), 'time', (m) => {
      const h = zhHour(m[1], +m[2]);
      const min = +m[3];
      if (h == null || min > 59) return null;
      return { time: hhmm(h, min) };
    }],
    [zre(`${PART}\\s*${ZN}(?:點|点|時)(?:(半)|${ZN}分|整|鐘)?`), 'time', (m) => {
      const h = zhHour(m[1], zhNum(m[2]));
      if (h == null) return null;
      const min = m[3] ? 30 : m[4] ? zhNum(m[4]) : 0;
      if (min > 59) return null;
      return { time: hhmm(h, min) };
    }],
    [zre(`(中午|傍晚|晚上|今晚)`), 'time', (m) => ({ time: { 中午: '12:00', 傍晚: '18:00', 晚上: '19:00', 今晚: '19:00' }[m[1]] })],
  ];
}

const ZH_WD = ['日', '一', '二', '三', '四', '五', '六'];
function recurTextZh(r) {
  const n = r.every || 1;
  const after = r.fromDone ? '（完成後起算）' : '';
  switch (r.unit) {
    case 'day': return `${n === 1 ? '每天' : `每${n}天`}${after}`;
    case 'weekday': return `每個工作日${after}`;
    case 'weekend': return `每個週末${after}`;
    case 'week': {
      const head = n === 1 ? '每週' : `每${n}週`;
      if (r.days && r.days.length) return `${head}${r.days.map((d) => ZH_WD[d]).join('、')}${after}`;
      return `${head}${after}`;
    }
    case 'month': return `${n === 1 ? '每月' : `每${n}個月`}${r.monthDay ? `${r.monthDay}日` : ''}${after}`;
    case 'year': return `${n === 1 ? '每年' : `每${n}年`}${r.monthDay != null && r.month != null ? `${r.month + 1}月${r.monthDay}日` : ''}${after}`;
    default: return '重複';
  }
}

// How a repeat rule reads in the current language (stored text is ignored).
export function describeRecur(r) {
  if (!r) return '';
  return isZh() ? recurTextZh(r) : recurText(r);
}

function recurText(r) {
  const n = r.every || 1;
  const bang = r.fromDone ? '!' : '';
  const plural = (u) => (n === 1 ? u : `${n} ${u}s`);
  switch (r.unit) {
    case 'day': return `every${bang} ${plural('day')}`;
    case 'weekday': return `every${bang} weekday`;
    case 'weekend': return `every${bang} weekend day`;
    case 'week':
      if (r.days && r.days.length && (n === 1 || r.days.length > 1)) {
        return `every${bang} ${n > 1 ? `${n} weeks on ` : ''}${r.days.map((d) => DAYS[d]).join(', ')}`;
      }
      return `every${bang} ${n === 2 ? 'other week' : plural('week')}`;
    case 'month': {
      const d = r.monthDay;
      const suf = d ? ordinal(d) : '';
      return `every${bang} ${plural('month')}${d ? ` on the ${suf}` : ''}`;
    }
    case 'year':
      return `every${bang} ${plural('year')}${r.monthDay != null && r.month != null ? ` on ${r.monthDay} ${MONTHS_SHORT[r.month]}` : ''}`;
    default:
      return 'repeats';
  }
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function mask(text, spans) {
  let out = text.split('');
  for (const s of spans) for (let i = s.start; i < s.end; i++) out[i] = ' ';
  return out.join('');
}

function overlaps(spans, a, b) {
  return spans.some((s) => a < s.end && b > s.start);
}

function findNamed(text, symbol, names, spans) {
  // Find "#Name" (longest known name first, then a single word).
  const results = [];
  const sorted = [...names].sort((a, b) => b.length - a.length);
  let idx = -1;
  while ((idx = text.indexOf(symbol, idx + 1)) !== -1) {
    if (idx > 0 && !/\s/.test(text[idx - 1])) continue;
    if (overlaps(spans, idx, idx + 1)) continue;
    const rest = text.slice(idx + 1);
    let hit = null;
    for (const n of sorted) {
      if (rest.toLowerCase().startsWith(n.toLowerCase())) {
        const after = rest[n.length];
        if (after === undefined || /\s/.test(after)) {
          hit = { name: n, len: n.length };
          break;
        }
      }
    }
    if (!hit) {
      const w = rest.match(/^[^\s#@/]+/u);
      if (w) hit = { name: w[0], len: w[0].length, isNew: true };
    }
    if (hit) results.push({ start: idx, end: idx + 1 + hit.len, ...hit });
  }
  return results;
}

/**
 * ctx: { projects:[{id,name}], sections:[{id,name}], labels:[{id,name}],
 *        dateOrder, disabled:Set<string>, ref:'YYYY-MM-DD' }
 */
export function parseQuickAdd(text, ctx = {}) {
  const ref = ctx.ref || today();
  const disabled = ctx.disabled || new Set();
  const spans = [];
  const chips = [];
  const result = { priority: null, project: null, section: null, labels: [], due: null };

  // priority
  if (!disabled.has('priority')) {
    const pr = [...text.matchAll(re('p([1-4])'))].pop();
    if (pr) {
      spans.push({ start: pr.index, end: pr.index + pr[0].length });
      result.priority = +pr[1];
      chips.push({ kind: 'priority', key: 'priority', label: t('Priority {n}', { n: pr[1] }), value: +pr[1] });
    }
  }

  // project
  if (!disabled.has('project')) {
    const pj = findNamed(text, '#', (ctx.projects || []).map((p) => p.name), spans).pop();
    if (pj) {
      spans.push(pj);
      const known = (ctx.projects || []).find((p) => p.name.toLowerCase() === pj.name.toLowerCase());
      result.project = known ? { id: known.id, name: known.name } : { name: pj.name, isNew: true };
      chips.push({ kind: 'project', key: 'project', label: `#${result.project.name}${known ? '' : ` ${t('(new)')}`}` });
    }
  }

  // section
  if (!disabled.has('section')) {
    const sc = findNamed(text, '/', (ctx.sections || []).map((s) => s.name), spans).filter((x) => !x.isNew).pop();
    if (sc) {
      spans.push(sc);
      result.section = { name: sc.name };
      chips.push({ kind: 'section', key: 'section', label: `/${sc.name}` });
    }
  }

  // labels
  const lbls = findNamed(text, '@', (ctx.labels || []).map((l) => l.name), spans);
  for (const l of lbls) {
    const key = `label:${l.name.toLowerCase()}`;
    if (disabled.has(key)) continue;
    // "@5pm" is a time, not a label
    if (/^\d{1,2}(:\d{2})?\s*(am|pm|點|時)?$/i.test(l.name)) continue;
    spans.push(l);
    const known = (ctx.labels || []).find((x) => x.name.toLowerCase() === l.name.toLowerCase());
    const name = known ? known.name : l.name;
    if (!result.labels.some((x) => x.toLowerCase() === name.toLowerCase())) result.labels.push(name);
    chips.push({ kind: 'label', key, label: `@${name}` });
  }

  // dates, times, recurrence
  if (!disabled.has('date')) {
    const due = parseDueInto(text, spans, ref, ctx.dateOrder, ctx.keepTime);
    if (due) {
      result.due = due;
      chips.push({ kind: 'date', key: 'date', label: dueChipText(due, ref, ctx.timeFormat) });
    }
  }

  // build title from the unconsumed text (a time kept in the name stays where it was typed)
  let title = '';
  let last = 0;
  for (const s of [...spans].filter((x) => !x.keep).sort((a, b) => a.start - b.start)) {
    title += text.slice(last, s.start) + ' ';
    last = Math.max(last, s.end);
  }
  title += text.slice(last);
  result.title = title.replace(/\s+/g, ' ').trim();
  result.chips = chips;
  return result;
}

// keepTime: a time of day ("at 12pm", "下午5點") still sets the due time but stays in the
// task name. Day words ("tomorrow", "今晚") are always taken out, since they go out of date.
function parseDueInto(text, spans, ref, dateOrder, keepTime = false) {
  let due = { date: null, time: null, recur: null };
  let matched = false;
  for (const [rx, kind, fn] of rules(dateOrder)) {
    if (kind === 'recur' && due.recur) continue;
    if (kind === 'date' && due.date && due.dateFromPhrase) continue;
    if (kind === 'time' && due.time) continue;
    rx.lastIndex = 0;
    const masked = mask(text, spans);
    let m;
    while ((m = rx.exec(masked))) {
      const start = m.index;
      let end = start + m[0].length;
      if (!m[0].trim()) continue;
      const part = fn(m, ref);
      if (!part) continue;
      // swallow a dangling "on"/"at"/"by"/"due"/"starting" right before the phrase
      const before = masked.slice(0, start);
      const lead = before.match(/(?:^|\s)(on|at|by|due|from|starting)\s+$/i);
      const s0 = lead ? start - lead[0].trimStart().length : start;
      spans.push({ start: s0, end, keep: keepTime && kind === 'time' && !part.date && !/今晚|tonight/i.test(m[0]) });
      matched = true;
      if (part.recur) {
        due.recur = part.recur;
        if (!due.date) due.date = part.date;
      } else if (part.date) {
        due.date = part.date;
        due.dateFromPhrase = true;
      }
      if (part.time && !due.time) due.time = part.time;
      break;
    }
  }
  if (!matched) return null;
  if (!due.date) due.date = ref;
  if (due.recur && due.recur.anchor) {
    if (due.recur.unit === 'week') due.recur.days = [weekday(due.date)];
    if (due.recur.unit === 'month') due.recur.monthDay = parseYmd(due.date).getDate();
    delete due.recur.anchor;
  }
  if (due.recur) due.recur.text = recurText(due.recur);
  delete due.dateFromPhrase;
  return due;
}

function dueChipText(due, ref, fmt) {
  let s;
  const diff = Math.round((parseYmd(due.date) - parseYmd(ref)) / 86400000);
  if (diff === 0) s = t('Today');
  else if (diff === 1) s = t('Tomorrow');
  else if (diff > 1 && diff < 7) s = dayName(weekday(due.date));
  else s = shortDate(due.date, ref);
  if (due.time) s += ` ${formatTime(due.time, fmt)}`;
  if (due.recur) s += ` · ${describeRecur(due.recur)}`;
  return s;
}

// Parse a free-text date like "next fri 3pm" or "every 2 weeks". Returns
// a due object, or null if nothing was recognised.
export function parseDateText(text, { dateOrder, ref } = {}) {
  const spans = [];
  return parseDueInto(text, spans, ref || today(), dateOrder);
}

export { recurText };

// ---------- events ----------
// "Lunch with Sam fri 12:30-1:30pm", "Standup every weekday 9am for 15 min",
// "明天下午3點到5點 開會", "Trip to Melbourne next sat all day"

const AP = '(am|pm|a\\.m\\.|p\\.m\\.)';
const ZPART = '(早上|上午|早晨|清晨|凌晨|中午|下午|傍晚|晚上|夜晚|晚)';
const ZH_CLOCK = `(\\d{1,2}|[零〇一二兩三四五六七八九十]+)(?:[:：](\\d{2})|(?:點|点|時)(?:(半)|(\\d{1,2}|[一二三四五六七八九十]+)分)?)`;

const to24 = (h, ap) => {
  if (!ap) return h;
  const pm = ap.toLowerCase().startsWith('p');
  return (h % 12) + (pm ? 12 : 0);
};

function rangeRules() {
  return [
    [new RegExp(`${B}(from\\s+)?(\\d{1,2})(?:[:.](\\d{2}))?\\s*${AP}?\\s*(?:-|–|—|~|to|until|till)\\s*(\\d{1,2})(?:[:.](\\d{2}))?\\s*${AP}?${E}`, 'giu'), (m) => {
      const [, from, h1s, m1s, ap1s, h2s, m2s, ap2s] = m;
      if (!ap1s && !ap2s && m1s == null && m2s == null && !from) return null;
      let h1 = +h1s;
      let h2 = +h2s;
      const m1 = m1s ? +m1s : 0;
      const m2 = m2s ? +m2s : 0;
      if (m1 > 59 || m2 > 59) return null;
      let ap1 = ap1s;
      let ap2 = ap2s;
      if (ap1 || ap2) {
        if (h1 > 12 || h2 > 12 || h1 < 1 || h2 < 1) return null;
        if (!ap1) {
          ap1 = ap2;
          if (to24(h1, ap1) * 60 + m1 >= to24(h2, ap2) * 60 + m2) ap1 = ap2.toLowerCase().startsWith('p') ? 'am' : 'pm';
        }
        if (!ap2) {
          ap2 = ap1;
          if (to24(h2, ap2) * 60 + m2 <= to24(h1, ap1) * 60 + m1) ap2 = ap1.toLowerCase().startsWith('p') ? 'am' : 'pm';
        }
        h1 = to24(h1, ap1);
        h2 = to24(h2, ap2);
      } else {
        if (h1 > 23 || h2 > 24) return null;
        if (!m1s && h1 >= 1 && h1 <= 7) h1 += 12;
        if (h2 * 60 + m2 <= h1 * 60 + m1 && h2 < 12) h2 += 12;
      }
      if (h2 === 24) h2 = 0;
      return { start: hhmm(h1, m1), end: hhmm(h2 % 24, m2) };
    }],
    [new RegExp(`${ZPART}?\\s*${ZH_CLOCK}\\s*(?:-|–|—|~|至|到)\\s*${ZPART}?\\s*${ZH_CLOCK}`, 'gu'), (m) => {
      const [, p1, h1s, m1s, half1, min1, p2, h2s, m2s, half2, min2] = m;
      let h1 = zhHour(p1, zhNum(h1s));
      const mm1 = m1s ? +m1s : half1 ? 30 : min1 ? zhNum(min1) : 0;
      let h2raw = zhNum(h2s);
      const mm2 = m2s ? +m2s : half2 ? 30 : min2 ? zhNum(min2) : 0;
      if (h1 == null || h2raw == null || isNaN(h2raw) || mm1 > 59 || mm2 > 59) return null;
      let h2 = zhHour(p2 || p1, h2raw);
      if (h2 == null) return null;
      if (h2 * 60 + mm2 <= h1 * 60 + mm1 && h2 < 12) h2 += 12;
      if (h1 > 23 || h2 > 24) return null;
      return { start: hhmm(h1, mm1), end: hhmm(h2 % 24, mm2) };
    }],
  ];
}

function durationIn(text) {
  const en = new RegExp(`${B}for\\s+(\\d+(?:\\.\\d+)?|an?|one|two|three|four|five|six|half\\s+an?)\\s*(hours?|hrs?|h|minutes?|mins?|m)${E}`, 'iu').exec(text);
  if (en) {
    const w = en[1].toLowerCase();
    const n = /^half/.test(w) ? 0.5 : /^\d/.test(w) ? parseFloat(w) : NUMWORDS[w] || 1;
    const unit = en[2].toLowerCase();
    const min = /^h/.test(unit) ? Math.round(n * 60) : Math.round(n);
    if (min > 0 && min <= 7 * 1440) return { min, start: en.index, end: en.index + en[0].length };
  }
  const zh = /(?:為期|共|用)?(\d+(?:\.\d+)?|[一二兩三四五六七八九十]+|半)(?:個)?(小時|鐘頭|鐘|分鐘)/u.exec(text);
  if (zh) {
    const n = zh[1] === '半' ? 0.5 : /^\d/.test(zh[1]) ? parseFloat(zh[1]) : zhNum(zh[1]);
    const min = zh[2] === '分鐘' ? Math.round(n) : Math.round(n * 60);
    if (min > 0 && min <= 7 * 1440) return { min, start: zh.index, end: zh.index + zh[0].length };
  }
  return null;
}

/**
 * Reads the date, time range, length and repeat out of a new event's title.
 * Returns { title, date, start, end, allDay, recur, found } (recur in the task form;
 * see ruleFromTaskRecur). start/end are "HH:MM" or null.
 */
export function parseEventText(text, { ref, dateOrder, off = false } = {}) {
  ref = ref || today();
  if (off || !text.trim()) return { title: text.trim(), date: null, start: null, end: null, allDay: false, recur: null, found: false };
  const spans = [];
  let range = null;
  for (const [rx, fn] of rangeRules()) {
    rx.lastIndex = 0;
    let m;
    while ((m = rx.exec(text))) {
      const r = fn(m);
      if (r) {
        range = r;
        const lead = text.slice(0, m.index).match(/(?:^|\s)(at|from|between)\s+$/i);
        spans.push({ start: lead ? m.index - lead[0].trimStart().length : m.index, end: m.index + m[0].length });
        break;
      }
    }
    if (range) break;
  }
  let dur = null;
  const d = durationIn(mask(text, spans));
  if (d) {
    dur = d.min;
    spans.push({ start: d.start, end: d.end });
  }
  let allDay = false;
  const ad = /(?<![\p{Script=Latin}])all[ -]?day(?![\p{Script=Latin}])|全日|全天|整天/iu.exec(mask(text, spans));
  if (ad) {
    allDay = true;
    spans.push({ start: ad.index, end: ad.index + ad[0].length });
  }
  // Was a day actually named? (A time on its own keeps the day the event was made on.)
  const probe = parseDueInto(text, spans.map((s) => ({ ...s })), '1900-01-01', dateOrder);
  const named = !!(probe && probe.date && probe.date !== '1900-01-01');
  const due = parseDueInto(text, spans, ref, dateOrder);
  let start = range ? range.start : due && due.time ? due.time : null;
  let end = range ? range.end : null;
  if (start && !end && dur) {
    const [h, mi] = start.split(':').map(Number);
    const t = h * 60 + mi + dur;
    end = hhmm(Math.floor(t / 60) % 24, t % 60);
  }
  if (allDay) {
    start = null;
    end = null;
  }
  let title = '';
  let last = 0;
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    title += text.slice(last, s.start) + ' ';
    last = Math.max(last, s.end);
  }
  title += text.slice(last);
  const found = !!(range || due || allDay || dur);
  return {
    title: title.replace(/\s+/g, ' ').trim(),
    date: due && named ? due.date : null,
    start,
    end,
    dur,
    allDay,
    recur: due ? due.recur : null,
    found,
  };
}
