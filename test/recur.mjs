// Unit checks for repeat rules, time zones and .ics parsing (run with node).
import assert from 'node:assert/strict';
import { ruleDays, dn, fromDn, parseRRule, formatRRule, describeRule, presets, countBefore, lastDay, reanchor } from '../web/src/recur.js';
import { wallToMs, msToWall, offsetMin, normalizeZone } from '../web/src/tz.js';
import { parseIcs, toIcs } from '../web/src/ics.js';

let n = 0;
const ok = (name, fn) => {
  fn();
  n++;
  console.log('ok', name);
};
const days = (rule, start, from, to, opts) => ruleDays(rule, start, dn(from), dn(to), opts).map(fromDn);

ok('daily every 2 days', () => {
  assert.deepEqual(days({ freq: 'daily', interval: 2 }, '2026-10-18', '2026-10-18', '2026-10-25'), ['2026-10-18', '2026-10-20', '2026-10-22', '2026-10-24']);
});
ok('weekly mon/wed/fri', () => {
  const r = { freq: 'weekly', interval: 1, byDay: [1, 3, 5].map((wd) => ({ wd, n: 0 })) };
  assert.deepEqual(days(r, '2026-10-19', '2026-10-18', '2026-10-31'), ['2026-10-19', '2026-10-21', '2026-10-23', '2026-10-26', '2026-10-28', '2026-10-30']);
});
ok('every 2 weeks with skip-ahead far in the future', () => {
  const r = { freq: 'weekly', interval: 2, byDay: [{ wd: 1, n: 0 }] };
  assert.deepEqual(days(r, '2026-10-19', '2030-01-01', '2030-01-31'), ['2030-01-07', '2030-01-21']);
});
ok('monthly third sunday', () => {
  const r = { freq: 'monthly', interval: 1, byDay: [{ wd: 0, n: 3 }] };
  assert.deepEqual(days(r, '2026-10-18', '2026-10-01', '2027-01-31'), ['2026-10-18', '2026-11-15', '2026-12-20', '2027-01-17']);
});
ok('monthly last friday', () => {
  const r = { freq: 'monthly', interval: 1, byDay: [{ wd: 5, n: -1 }] };
  assert.deepEqual(days(r, '2026-10-30', '2026-10-01', '2027-01-31'), ['2026-10-30', '2026-11-27', '2026-12-25', '2027-01-29']);
});
ok('monthly on day 31 skips short months', () => {
  const r = { freq: 'monthly', interval: 1, byMonthDay: [31] };
  assert.deepEqual(days(r, '2026-10-31', '2026-10-01', '2027-03-31'), ['2026-10-31', '2026-12-31', '2027-01-31', '2027-03-31']);
});
ok('yearly feb 29', () => {
  const r = { freq: 'yearly', interval: 1, byMonth: [2], byMonthDay: [29] };
  assert.deepEqual(days(r, '2028-02-29', '2028-01-01', '2036-12-31'), ['2028-02-29', '2032-02-29', '2036-02-29']);
});
ok('count and until', () => {
  assert.deepEqual(days({ freq: 'daily', interval: 1, count: 3 }, '2026-10-18', '2026-10-01', '2026-12-31'), ['2026-10-18', '2026-10-19', '2026-10-20']);
  assert.deepEqual(days({ freq: 'weekly', interval: 1, until: '2026-11-01' }, '2026-10-18', '2026-10-01', '2026-12-31'), ['2026-10-18', '2026-10-25', '2026-11-01']);
  assert.equal(fromDn(lastDay({ freq: 'daily', interval: 1, count: 3 }, '2026-10-18')), '2026-10-20');
  assert.equal(countBefore({ freq: 'daily', interval: 1 }, '2026-10-18', dn('2026-10-21')), 3);
});
ok('exdates are skipped but still count', () => {
  const ex = new Set([dn('2026-10-19')]);
  assert.deepEqual(days({ freq: 'daily', interval: 1, count: 3 }, '2026-10-18', '2026-10-01', '2026-12-31', { exdays: ex }), ['2026-10-18', '2026-10-20']);
});
ok('last weekday of month via BYSETPOS', () => {
  const r = parseRRule('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1');
  assert.deepEqual(days(r, '2026-10-30', '2026-10-01', '2027-01-31'), ['2026-10-30', '2026-11-30', '2026-12-31', '2027-01-29']);
});
ok('rrule text round trip', () => {
  const r = parseRRule('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20261231T125959Z', 'Australia/Sydney');
  assert.equal(r.freq, 'weekly');
  assert.equal(r.interval, 2);
  assert.equal(r.until, '2026-12-31');
  assert.equal(formatRRule(r, { allDay: true }), 'FREQ=WEEKLY;INTERVAL=2;UNTIL=20261231;BYDAY=MO,WE');
});
ok('descriptions', () => {
  assert.equal(describeRule({ freq: 'monthly', interval: 1, byDay: [{ wd: 0, n: 3 }] }, '2026-10-18'), 'Monthly on the third Sunday');
  assert.equal(describeRule({ freq: 'weekly', interval: 1, byDay: [1, 2, 3, 4, 5].map((wd) => ({ wd, n: 0 })) }, '2026-10-19'), 'Every weekday (Monday to Friday)');
  assert.equal(describeRule({ freq: 'yearly', interval: 1, byMonth: [10], byMonthDay: [18] }, '2026-10-18'), 'Annually on October 18');
  assert.equal(describeRule({ freq: 'weekly', interval: 1, byDay: [{ wd: 1, n: 0 }], count: 5 }, '2026-10-19'), 'Weekly on Monday, 5 times');
  assert.deepEqual(presets('2026-10-30').map((p) => p.key), ['none', 'daily', 'weekly', 'monthlyLast', 'monthlyDay', 'yearly', 'weekdays']);
});
ok('reanchor a weekly series', () => {
  const r = reanchor({ freq: 'weekly', interval: 1, byDay: [{ wd: 1, n: 0 }, { wd: 3, n: 0 }] }, '2026-10-19', '2026-10-20');
  assert.deepEqual(r.byDay.map((b) => b.wd), [2, 4]);
});
ok('time zones', () => {
  // 10am in Hong Kong is 1pm in Sydney (summer time, UTC+11)
  const ms = wallToMs('2026-10-19', '10:00', 'Asia/Hong_Kong');
  assert.equal(new Date(ms).toISOString(), '2026-10-19T02:00:00.000Z');
  assert.deepEqual(msToWall(ms, 'Australia/Sydney'), { date: '2026-10-19', time: '13:00' });
  assert.equal(offsetMin(ms, 'Australia/Sydney'), 660);
  // across the daylight-saving change the wall time stays put
  const a = wallToMs('2026-10-03', '10:00', 'Australia/Sydney');
  const b = wallToMs('2026-10-05', '10:00', 'Australia/Sydney');
  assert.equal(b - a, 2 * 86400000 - 3600000);
  assert.equal(normalizeZone('AUS Eastern Standard Time'), 'Australia/Sydney');
  assert.equal(normalizeZone('/freeassociation.sourceforge.net/Tzfile/Europe/London'), 'Europe/London');
});

const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'X-WR-CALNAME:Holidays in Hong Kong',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20261018',
  'DTEND;VALUE=DATE:20261019',
  'UID:20261018_chung@google.com',
  'SUMMARY:Chung Yeung Festival',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Australia/Sydney:20261019T100000',
  'DTEND;TZID=Australia/Sydney:20261019T120000',
  'RRULE:FREQ=WEEKLY;BYDAY=MO',
  'EXDATE;TZID=Australia/Sydney:20261026T100000',
  'UID:abc@google.com',
  'SUMMARY:主席（淑女）',
  'LOCATION:Room 1\\, Level 2',
  'DESCRIPTION:Line one\\nLine two with a long text that is folded over',
  '  the line limit',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'TRIGGER:-PT30M',
  'END:VALARM',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Australia/Sydney:20261102T110000',
  'DTEND;TZID=Australia/Sydney:20261102T130000',
  'RECURRENCE-ID;TZID=Australia/Sydney:20261102T100000',
  'UID:abc@google.com',
  'SUMMARY:主席（淑女） moved',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART:20261023T061500Z',
  'DURATION:PT1H30M',
  'UID:bible@google.com',
  'SUMMARY:Bible study (P10)',
  'LOCATION:Celia’s place',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

ok('ics parsing', () => {
  const cal = parseIcs(ICS);
  assert.equal(cal.name, 'Holidays in Hong Kong');
  assert.equal(cal.events.length, 4);
  const [hol, series, moved, bible] = cal.events;
  assert.deepEqual([hol.allDay, hol.start, hol.end, hol.title], [true, '2026-10-18', '2026-10-19', 'Chung Yeung Festival']);
  assert.equal(series.start, '2026-10-19T10:00');
  assert.equal(series.tz, 'Australia/Sydney');
  assert.equal(series.rrule.freq, 'weekly');
  assert.deepEqual(series.exdates, ['2026-10-26T10:00']);
  assert.equal(series.location, 'Room 1, Level 2');
  assert.equal(series.desc, 'Line one\nLine two with a long text that is folded over the line limit');
  assert.deepEqual(series.reminders, [30]);
  assert.equal(moved.recurrenceId, '2026-11-02T10:00');
  assert.equal(bible.tz, 'UTC');
  assert.equal(bible.start, '2026-10-23T06:15');
  assert.equal(bible.end, '2026-10-23T07:45');
});
ok('ics writing round trip', () => {
  const cal = parseIcs(ICS);
  const text = toIcs(cal.events.map((e, i) => ({ ...e, id: `e${i}` })), { name: 'Mine' });
  assert.match(text, /^BEGIN:VCALENDAR\r\n/);
  assert.match(text, /RRULE:FREQ=WEEKLY;BYDAY=MO/);
  assert.match(text, /LOCATION:Room 1\\, Level 2/);
  const again = parseIcs(text);
  assert.equal(again.events.length, 4);
  assert.equal(again.events[1].desc, cal.events[1].desc);
  assert.equal(again.events[1].start, '2026-10-19T10:00');
  assert.deepEqual(again.events[1].exdates, ['2026-10-26T10:00']);
  for (const line of text.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, line);
});

console.log(`${n} checks passed`);
