// Screenshots of the calendar in every style, light and dark, in English and Chinese,
// on a computer and a phone. Fails on page errors or sideways scrolling on a phone.
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const url = 'file://' + path.resolve(__dirname, '../web/dist/Checkmate.html');
const OUT = process.argv[2] || '/tmp/shots';
const only = process.argv[3] ? process.argv[3].split(',') : null;
fs.mkdirSync(OUT, { recursive: true });

const ev = (id, title, start, end, extra = {}) => ({ id, type: 'event', calendarId: 'cal-main', title, allDay: start.length === 10, start, end, tz: start.length === 10 ? null : 'Australia/Sydney', updatedAt: 5, ...extra });
const SEED = {
  'cal-hol': { id: 'cal-hol', type: 'calendar', name: 'Holidays in Hong Kong', color: 'moss', order: 2, sub: { url: 'https://example.test/hk.ics' }, defaultReminders: [], allDayReminders: [], updatedAt: 5 },
  'cal-work': { id: 'cal-work', type: 'calendar', name: 'Church', color: 'iris', order: 1, defaultReminders: [10], allDayReminders: [], updatedAt: 5 },
  hol1: ev('hol1', 'Chung Yeung Festival', '2026-10-18', '2026-10-19', { calendarId: 'cal-hol' }),
  hol2: ev('hol2', 'Day off for Chung Yeung Festival', '2026-10-19', '2026-10-20', { calendarId: 'cal-hol' }),
  e1: ev('e1', '主席（淑女）', '2026-10-19T10:00', '2026-10-19T12:00', { rrule: { freq: 'weekly', interval: 1, byDay: [{ wd: 1, n: 0 }] }, calendarId: 'cal-work' }),
  e2: ev('e2', 'Pre-study 22-24', '2026-10-21T10:00', '2026-10-21T12:00', { location: 'Zoom' }),
  e3: ev('e3', '阿梅生日', '2026-10-24', '2026-10-25', { rrule: { freq: 'yearly', interval: 1, byMonth: [10], byMonthDay: [24] }, color: 'gold' }),
  e4: ev('e4', 'Bible study (P10)', '2026-10-23T17:15', '2026-10-23T19:15', { location: 'Celia’s place', calendarId: 'cal-work' }),
  e5: ev('e5', 'Coffee with Jo', '2026-10-18T09:00', '2026-10-18T10:00', { color: 'tangerine' }),
  e6: ev('e6', 'Gym', '2026-10-21T10:30', '2026-10-21T11:30', { color: 'rose' }),
  e7: ev('e7', 'Dinner with Sam', '2026-10-22T19:00', '2026-10-22T21:00', { color: 'teal' }),
  e8: ev('e8', 'Trip to Melbourne', '2026-10-28', '2026-10-31', { color: 'sky' }),
  t1: { id: 't1', type: 'task', title: 'Pay rent', projectId: 'inbox', priority: 1, labels: [], done: false, due: { date: '2026-10-20', time: '11:00', recur: null }, updatedAt: 5 },
  t2: { id: 't2', type: 'task', title: 'Buy flowers', projectId: 'inbox', priority: 4, labels: [], done: false, due: { date: '2026-10-22', time: null, recur: null }, updatedAt: 5 },
};

const SKINS = ['tickwise', 'archive', 'riot', 'tide', 'frontier', 'neon'];

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const shot = async ({ skin, theme, lang = 'en', narrow = false, views = ['week', 'month'] }) => {
    const ctx = await b.newContext({ viewport: narrow ? { width: 390, height: 844 } : { width: 1440, height: 900 }, timezoneId: 'Australia/Sydney', locale: 'en-AU' });
    const p = await ctx.newPage();
    await p.clock.install({ time: new Date('2026-10-18T15:40:00+11:00') });
    p.on('pageerror', (e) => errs.push(`${skin}/${theme}/${lang}: ${e.message}`));
    await p.route('https://example.test/**', (r) => r.abort('failed'));
    await p.addInitScript(({ seed, prefs }) => {
      if (!localStorage.getItem('tickwise.db.v1')) {
        localStorage.setItem('tickwise.db.v1', JSON.stringify(seed));
        localStorage.setItem('tickwise.seeded', '1');
        localStorage.setItem('tickwise.prefs.v1', JSON.stringify(prefs));
      }
    }, { seed: SEED, prefs: { skin, theme, language: lang, weekStart: 0, timeFormat: '12', calView: views[0] } });
    await p.goto(url + '#/calendar');
    await p.waitForSelector('.cal-view');
    await p.waitForTimeout(700);
    const tag = `${skin}-${theme}${lang === 'en' ? '' : '-zh'}${narrow ? '-phone' : ''}`;
    for (const v of views) {
      await p.keyboard.press({ week: 'w', month: 'm', days: 'x', schedule: 'a', day: 'd', year: 'y' }[v]);
      await p.waitForTimeout(350);
      if (v === 'week' || v === 'days') await p.evaluate(() => (document.querySelector('.tg-scroll').scrollTop = 8.5 * 48));
      await p.waitForTimeout(150);
      await p.screenshot({ path: `${OUT}/style-${tag}-${v}.png` });
      if (narrow) assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tag} ${v} scrolls sideways`);
    }
    if (!narrow) {
      await p.keyboard.press('w');
      await p.waitForTimeout(250);
      await p.evaluate(() => (document.querySelector('.tg-scroll').scrollTop = 8.5 * 48));
      await p.click('.ev-block:has-text("Pre-study")');
      await p.waitForTimeout(300);
      await p.screenshot({ path: `${OUT}/style-${tag}-card.png` });
      await p.keyboard.press('Escape');
    }
    await ctx.close();
  };
  for (const skin of SKINS) {
    if (only && !only.includes(skin)) continue;
    for (const theme of ['light', 'dark']) await shot({ skin, theme });
    await shot({ skin, theme: 'light', lang: 'zh-Hant', views: ['week'] });
    await shot({ skin, theme: 'dark', narrow: true, views: ['days', 'month', 'schedule'] });
  }
  await b.close();
  assert.deepEqual(errs, []);
  console.log('calendar style screenshots done');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
