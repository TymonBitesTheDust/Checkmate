// 2.2.0: Checkmate orange, the Persona 3 icon, keeping the typed time in the name,
// reminder timing (per task and default, with custom times), birthdays (with optional
// lunar dates) and Settings → What’s new.
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const url = 'file://' + path.resolve(__dirname, '../web/dist/Checkmate.html');
const OUT = process.argv[2] || '/tmp/shots';
fs.mkdirSync(OUT, { recursive: true });
const pass = (m) => console.log('  ✓ ' + m);
const VERSION = fs.readFileSync(path.join(__dirname, '../web/src/version.js'), 'utf8').match(/'([\d.]+)'/)[1];

const NOW = '2026-10-24T09:30:00';
const at = (s) => new Date(s).getTime();

(async () => {
  const b = await chromium.launch();
  const errs = [];
  async function open({ prefs, lang, width = 1280, height = 860, clock = true } = {}) {
    const ctx = await b.newContext({ viewport: { width, height }, isMobile: width < 500, hasTouch: width < 500 });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    if (clock) await p.clock.install({ time: new Date(NOW) });
    await p.addInitScript(([prefs, lang]) => {
      // the Android bridge, so the reminder schedule can be read back
      window.TickwiseNative = { setSystemBars() {}, setLauncherIcon() {}, setLanguage() {}, scheduleReminders: (json) => (window.__sched = JSON.parse(json)) };
      if (!sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1');
        if (prefs || lang) localStorage.setItem('tickwise.prefs.v1', JSON.stringify({ ...(prefs || {}), ...(lang ? { language: lang } : {}) }));
      }
    }, [prefs || null, lang || null]);
    await p.goto(url);
    await p.waitForSelector('.view-title');
    return p;
  }
  const sched = async (p) => {
    await p.evaluate(() => (window.__sched = null));
    await p.clock.runFor(2000);
    return p.evaluate(() => window.__sched || []);
  };
  const db = async (p) => {
    await p.clock.runFor(400);
    return p.evaluate(() => JSON.parse(localStorage.getItem('tickwise.db.v1') || '{}'));
  };
  const task = async (p, title) => Object.values(await db(p)).find((x) => x.type === 'task' && !x.deleted && x.title === title);
  async function quickAdd(p, text) {
    await p.keyboard.press('q');
    await p.waitForSelector('.modal.quick .editor-title');
    await p.fill('.modal.quick .editor-title', text);
    await p.keyboard.press('Enter');
    await p.waitForTimeout(150);
  }
  async function settings(p, tab) {
    await p.evaluate(() => window.ui && 0);
    await p.click('.sb-foot .nav-item');
    await p.waitForSelector('.modal.settings');
    await p.click(`.settings-tabs button[data-tab="${tab}"]`);
    await p.waitForTimeout(150);
  }

  // ---------- default colour ----------
  {
    const p = await open({ prefs: { accent: 'pine', accentVars: null, theme: 'light' }, clock: false });
    const acc = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    assert.strictEqual(acc, '#f46b25', 'an old default (Pine) becomes Checkmate orange');
    const logo = await p.$eval('.logo', (el) => el.innerHTML);
    assert(/var\(--accent\)/.test(logo));
    const fav = await p.$eval('link[rel="icon"]', (l) => decodeURIComponent(l.href));
    assert(/#f46b25/i.test(fav), 'tab icon is orange');
    await settings(p, 'theme');
    assert(await p.isVisible('.accent-dot[aria-label="Checkmate orange"]'));
    assert(await p.isVisible('.accent-dot[aria-label="Pine"]'), 'Pine is still a choice');
    await p.click('.accent-dot[aria-label="Pine"]');
    await p.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() === '#1f7a5c', null, { timeout: 3000 }).catch(() => {});
    assert.strictEqual(await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()), '#1f7a5c');
    await p.reload();
    await p.waitForSelector('.view-title');
    assert.strictEqual(await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()), '#1f7a5c', 'choosing Pine again sticks');
    await p.context().close();
    pass('Checkmate orange (#f46b25) is the default for buttons, the logo and the tab icon; Pine can still be chosen');
  }

  // ---------- Persona 3 icon: the moon is clear of the tick ----------
  {
    const p = await open({ prefs: { skin: 'tide' } });
    const gap = await p.evaluate(() => {
      const svg = document.querySelector('.logo svg');
      const paths = [...svg.querySelectorAll('path')];
      const moon = paths.find((x) => (x.getAttribute('fill') || '').toLowerCase() === '#effbff');
      const tick = paths.find((x) => x.getAttribute('stroke') === '#ffffff');
      const a = moon.getBoundingClientRect();
      const t = tick.getBoundingClientRect();
      // the tick's stroke reaches 3.5 units past its path; the logo is 28px for 64 units
      const pad = (3.5 * a.width) / 7 / 2;
      return { moonLeft: a.left, moonBottom: a.bottom, tickRight: t.right + pad, tickTop: t.top - pad };
    });
    assert(gap.moonLeft > gap.tickRight - 0.5 || gap.moonBottom < gap.tickTop + 0.5, JSON.stringify(gap));
    await p.screenshot({ path: `${OUT}/v22-tide-logo.png`, clip: { x: 0, y: 0, width: 290, height: 80 } });
    await p.context().close();
    pass('the Persona 3 icon’s moon no longer overlaps the tick');
  }

  // ---------- the typed time stays in the name ----------
  {
    const p = await open();
    await quickAdd(p, 'Watch Live Aid at 12pm p1');
    let t = await task(p, 'Watch Live Aid at 12pm');
    assert(t, 'name keeps “at 12pm”');
    assert.deepStrictEqual([t.due.date, t.due.time, t.priority], ['2026-10-24', '12:00', 1]);
    await quickAdd(p, 'Call Mum tomorrow 5pm');
    t = await task(p, 'Call Mum 5pm');
    assert(t && t.due.date === '2026-10-25' && t.due.time === '17:00', 'day words are still taken out');
    await settings(p, 'general');
    await p.click('.switch-row:has-text("Keep the time in the task name") input');
    await p.keyboard.press('Escape');
    await quickAdd(p, 'Lunch with Sam at 1pm');
    t = await task(p, 'Lunch with Sam');
    assert(t && t.due.time === '13:00', 'switched off: the time is taken out as before');
    await p.context().close();
    pass('a typed time sets the due time and stays in the task name (switchable in General)');
  }

  // ---------- reminders ----------
  {
    const p = await open();
    await quickAdd(p, 'Dentist tomorrow 3pm');
    await quickAdd(p, 'Pay rent tomorrow');
    let list = await sched(p);
    let dent = await task(p, 'Dentist 3pm');
    let rent = await task(p, 'Pay rent');
    assert(list.some((r) => r.id === dent.id && r.at === at('2026-10-25T15:00:00')), 'timed task: at the due time by default');
    assert(!list.some((r) => r.id.includes(rent.id)), 'date-only task: no reminder by default');

    // change the defaults in Settings → Reminders
    await settings(p, 'reminders');
    await p.screenshot({ path: `${OUT}/v22-reminders-settings.png` });
    const timed = p.locator('.reminders-panel .field').filter({ hasText: 'Tasks with a time' });
    await timed.locator('select').first().selectOption('30');
    const dateOnly = p.locator('.reminders-panel .field').filter({ hasText: 'Tasks with only a date' });
    await dateOnly.locator('button:has-text("Add notification")').click();
    await dateOnly.locator('select').first().selectOption('-540');
    // custom: 2 days before at 18:30 for birthdays
    const bdays = p.locator('.reminders-panel .field').filter({ hasText: 'Birthdays' }).first();
    await bdays.locator('button:has-text("Custom…")').click();
    await bdays.locator('.rem-custom input[type=number]').fill('2');
    await bdays.locator('.rem-custom input[type=time]').fill('18:30');
    assert(/2 days before at 6:30/i.test(await bdays.locator('.rem-preview').innerText()), await bdays.locator('.rem-preview').innerText());
    await bdays.locator('.rem-custom button:has-text("Done")').click();
    await p.waitForTimeout(100);
    await p.keyboard.press('Escape');
    const defaults = (await db(p))['reminder-defaults'];
    assert.deepStrictEqual([defaults.timed, defaults.dateOnly, defaults.birthday], [[30], [-540], [-540, 1770]], JSON.stringify(defaults));
    list = await sched(p);
    assert(list.some((r) => r.id === `task:${dent.id}:30` && r.at === at('2026-10-25T14:30:00')), '30 minutes before');
    assert(list.some((r) => r.id === `task:${rent.id}:-540` && r.at === at('2026-10-25T09:00:00')), 'on the day at 9:00');
    pass('Settings → Reminders sets the defaults for timed and date-only tasks, and they sync as an item');

    // a task's own reminders, with a custom time
    await p.goto(url + '#/upcoming');
    await p.click('.task-row:has-text("Dentist 3pm") .task-title');
    await p.waitForSelector('.modal.detail');
    assert(/30 minutes before/.test(await p.innerText('.rem-btn')));
    await p.click('.rem-btn');
    await p.waitForSelector('.rem-pop');
    await p.click('.rem-pop .switch-row input');
    await p.click('.rem-pop button:has-text("Custom…")');
    await p.fill('.rem-pop .rem-custom input[type=number]', '90');
    await p.selectOption('.rem-pop .rem-custom select', '1');
    await p.click('.rem-pop .rem-custom button:has-text("Done")');
    await p.waitForTimeout(150);
    await p.screenshot({ path: `${OUT}/v22-task-reminders.png` });
    dent = await task(p, 'Dentist 3pm');
    assert.deepStrictEqual(dent.reminders, [30, 90]);
    await p.keyboard.press('Escape');
    assert(/2 reminders/.test(await p.innerText('.rem-btn')));
    await p.keyboard.press('Escape');
    list = await sched(p);
    assert(list.some((r) => r.id === `task:${dent.id}:90` && r.at === at('2026-10-25T13:30:00')), '90 minutes before');
    assert(await p.isVisible('.task-row:has-text("Dentist 3pm") .meta-sub[title="Reminders"]'), 'a bell on the row');
    pass('a task can have its own reminders, including a custom time (90 minutes before)');
    await p.context().close();
  }

  // ---------- birthdays ----------
  {
    const p = await open();
    await p.click('.sidebar a.nav-item:has-text("Birthdays")');
    await p.waitForSelector('.birthdays-view');
    await p.screenshot({ path: `${OUT}/v22-bd-empty.png` });
    await p.click('.birthdays-view button:has-text("Add my birthday")');
    await p.waitForSelector('.bd-dialog');
    assert(!(await p.isVisible('.bd-dialog button:has-text("Lunar date")')), 'lunar dates are off by default');
    await p.fill('.bd-dialog input[type=text] >> nth=0', 'Tymon');
    await p.selectOption('.bd-dialog select >> nth=0', '10');
    await p.selectOption('.bd-dialog select >> nth=1', '25');
    await p.fill('.bd-dialog input[type=number]', '2003');
    assert(/Tomorrow · You turn 23/.test(await p.innerText('.bd-preview')), await p.innerText('.bd-preview'));
    await p.click('.bd-dialog button[type=submit]');
    await p.click('.birthdays-view .view-actions button:has-text("Add birthday")');
    await p.fill('.bd-dialog input[type=text] >> nth=0', 'Sam Lee');
    await p.selectOption('.bd-dialog select >> nth=0', '2');
    await p.selectOption('.bd-dialog select >> nth=1', '29');
    await p.fill('.bd-dialog input[type=number]', '2000');
    await p.click('.bd-dialog button[type=submit]');
    await p.waitForTimeout(150);
    const rows = await p.$$eval('.bd-row', (x) => x.map((e) => e.innerText.replace(/\s+/g, ' ')));
    assert(/You/.test(rows[0]) && /Tomorrow/.test(rows[0]) && /You turn 23/.test(rows[0]), rows[0]);
    assert(/Sam Lee/.test(rows[1]) && /In 127 days/.test(rows[1]) && /Turns 27/.test(rows[1]), rows[1]);
    await p.screenshot({ path: `${OUT}/v22-bd-list.png` });
    pass('Birthdays page: your own and a friend’s, sorted by when they come round, with ages (29 Feb falls on 28 Feb)');

    // reminders for birthdays (default: on the day at 9:00)
    let list = await sched(p);
    const mine = Object.values(await db(p)).find((x) => x.type === 'birthday' && x.me);
    assert(list.some((r) => r.id === `bd:${mine.id}:2026-10-25:-540` && r.at === at('2026-10-25T09:00:00') && /Your birthday/.test(r.title)), JSON.stringify(list));
    // its own reminder: on the day at 20:00 (a custom time)
    await p.click('.bd-row:has-text("You")');
    await p.waitForSelector('.bd-dialog');
    await p.click('.bd-dialog .switch-row:has-text("Use my default reminders") input');
    await p.click('.bd-dialog .rem-row button[aria-label="Remove notification"]');
    await p.click('.bd-dialog button:has-text("Custom…")');
    await p.fill('.bd-dialog .rem-custom input[type=number]', '0');
    await p.fill('.bd-dialog .rem-custom input[type=time]', '20:00');
    await p.click('.bd-dialog .rem-custom button:has-text("Done")');
    await p.click('.bd-dialog button[type=submit]');
    await p.waitForTimeout(100);
    assert.deepStrictEqual(Object.values(await db(p)).find((x) => x.type === 'birthday' && x.me).reminders, [-1200]);
    list = await sched(p);
    assert(list.some((r) => r.id === `bd:${mine.id}:2026-10-25:-1200` && r.at === at('2026-10-25T20:00:00')), 'its own reminder');
    assert(!list.some((r) => r.id === `bd:${mine.id}:2026-10-25:-540`), 'instead of the default');
    pass('birthdays remind you (default on the day at 9:00, or their own times)');

    // on the calendar, Today and Upcoming
    await p.goto(url + '#/calendar');
    await p.waitForTimeout(400);
    assert(await p.isVisible('.sb-cal .cal-row:has-text("Birthdays")'));
    await p.click('text=Your birthday');
    await p.waitForSelector('.bd-card');
    assert(/You turn 23/.test(await p.innerText('.bd-card')));
    await p.screenshot({ path: `${OUT}/v22-bd-calendar.png` });
    await p.keyboard.press('Escape');
    await p.goto(url + '#/upcoming');
    await p.waitForTimeout(300);
    assert(await p.isVisible('.agenda-row:has-text("Your birthday")'), 'in Upcoming');
    pass('birthdays show on the calendar (with a card), and in Upcoming');

    // lunar birthdays: turned on in Settings → Calendar
    await settings(p, 'calendar');
    await p.click('.switch-row:has-text("Lunar birthdays") input');
    await p.keyboard.press('Escape');
    await p.goto(url + '#/birthdays');
    await p.click('.birthdays-view .view-actions button:has-text("Add birthday")');
    await p.waitForSelector('.bd-dialog button:has-text("Lunar date")');
    await p.fill('.bd-dialog input[type=text] >> nth=0', 'Ah Ming');
    await p.click('.bd-dialog button:has-text("Lunar date")');
    await p.selectOption('.bd-dialog select >> nth=0', '8');
    await p.selectOption('.bd-dialog select >> nth=1', '15');
    assert(/Next: .*15 Sep|Next: .*Sep 15/.test(await p.innerText('.bd-preview')), await p.innerText('.bd-preview'));
    await p.screenshot({ path: `${OUT}/v22-bd-lunar.png` });
    await p.click('.bd-dialog button[type=submit]');
    await p.waitForTimeout(100);
    const ming = await p.innerText('.bd-row:has-text("Ah Ming")');
    assert(/Lunar month 8, day 15/.test(ming), ming);
    pass('lunar (農曆) birthdays are optional, and land on the right day (8/15 → 15 Sep 2027)');
    await p.context().close();
  }

  // ---------- What’s new ----------
  {
    const p = await open();
    await settings(p, 'whatsnew');
    const first = await p.$eval('.wn-item', (e) => e.dataset.version);
    assert.strictEqual(first, VERSION);
    assert(await p.isVisible(`.wn-item[data-version="${VERSION}"] .wn-tag`));
    const versions = await p.$$eval('.wn-item', (x) => x.map((e) => e.dataset.version));
    for (const v of ['2.1.0', '2.1.5', '2.1.7', 'earlier']) assert(versions.includes(v), v);
    await p.screenshot({ path: `${OUT}/v22-whatsnew.png` });
    await p.context().close();
    pass('Settings → What’s new lists every version, newest first, marking this one');
  }

  // ---------- Chinese ----------
  {
    const p = await open({ lang: 'zh-Hant' });
    const english = async () => ((await p.innerText('.settings-panel')).match(/[A-Za-z]{3,}/g) || []).filter((w) => !['Checkmate', 'Live', 'Aid', 'Claude', 'Firebase', 'Persona', 'Tickwise', 'Google', 'Docs', 'Sheets', 'ics', 'Sam', 'Tymon', 'Windows', 'Android'].includes(w));
    await settings(p, 'reminders');
    assert.deepStrictEqual(await english(), []);
    await p.click('.settings-tabs button[data-tab="whatsnew"]');
    await p.waitForTimeout(100);
    assert.deepStrictEqual(await english(), []);
    await p.screenshot({ path: `${OUT}/v22-whatsnew-zh.png` });
    await p.keyboard.press('Escape');
    await p.goto(url + '#/birthdays');
    await p.click('.birthdays-view button:has-text("加入朋友的生日")');
    await p.fill('.bd-dialog input[type=text] >> nth=0', '阿明');
    await p.click('.bd-dialog button[type=submit]');
    await p.waitForTimeout(100);
    assert(/阿明/.test(await p.innerText('.bd-list')));
    await p.screenshot({ path: `${OUT}/v22-bd-zh.png` });
    await p.context().close();
    pass('the new screens read in Traditional Chinese');
  }

  // ---------- a phone ----------
  {
    const p = await open({ width: 390, height: 844 });
    await p.goto(url + '#/birthdays');
    await p.waitForSelector('.birthdays-view');
    await p.click('.birthdays-view button:has-text("Add my birthday")');
    await p.waitForSelector('.bd-dialog');
    assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await p.screenshot({ path: `${OUT}/v22-bd-dialog-phone.png` });
    await p.context().close();
    pass('fits a phone');
  }

  assert.deepStrictEqual(errs, []);
  await b.close();
  console.log('v22 OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
