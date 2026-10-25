// Calendar: views, creating by click and drag, moving and resizing, repeating events
// (this / following / all), month overflow, year and schedule, search, tasks on the
// calendar, subscriptions (browser and app paths), .ics import/export and reminders.
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const url = 'file://' + path.resolve(__dirname, '../web/dist/Checkmate.html');
const OUT = process.argv[2] || '/tmp/shots';
fs.mkdirSync(OUT, { recursive: true });

const NOW = new Date('2026-10-18T15:40:00+11:00');
const ICS = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:Church', 'X-WR-TIMEZONE:Australia/Sydney',
  'BEGIN:VEVENT', 'UID:bible@test', 'DTSTART;TZID=Australia/Sydney:20261023T171500', 'DTEND;TZID=Australia/Sydney:20261023T191500',
  'SUMMARY:Bible study (P10)', 'LOCATION:Celia’s place', 'RRULE:FREQ=WEEKLY;BYDAY=FR', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:bday@test', 'DTSTART;VALUE=DATE:20261024', 'DTEND;VALUE=DATE:20261025', 'SUMMARY:阿梅生日', 'RRULE:FREQ=YEARLY', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');
const HOLIDAYS = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:Holidays in Hong Kong',
  'BEGIN:VEVENT', 'UID:cy@google', 'DTSTART;VALUE=DATE:20261018', 'DTEND;VALUE=DATE:20261019', 'SUMMARY:Chung Yeung Festival', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:cy2@google', 'DTSTART;VALUE=DATE:20261019', 'DTEND;VALUE=DATE:20261020', 'SUMMARY:Day off for Chung Yeung Festival', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

async function open(b, { viewport = { width: 1440, height: 900 }, prefs = {}, init } = {}) {
  const ctx = await b.newContext({ viewport, timezoneId: 'Australia/Sydney', locale: 'en-AU', acceptDownloads: true });
  const p = await ctx.newPage();
  await p.clock.install({ time: NOW });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_|CORS|Access-Control/.test(m.text()) && errs.push('console: ' + m.text()));
  await p.addInitScript(({ prefs }) => {
    if (!localStorage.getItem('tickwise.prefs.v1')) {
      localStorage.setItem('tickwise.seeded', '1');
      localStorage.setItem('tickwise.prefs.v1', JSON.stringify({ language: 'en', weekStart: 0, timeFormat: '12', ...prefs }));
    }
  }, { prefs });
  if (init) await p.addInitScript(init, ICS);
  // any calendar host the browser can't reach answers like Google does (no CORS)
  await p.route('https://calendar.google.com/**', (r) => r.abort('failed'));
  await p.route('https://example.test/**', (r) => r.fulfill({ status: 200, contentType: 'text/calendar', headers: { 'Access-Control-Allow-Origin': '*' }, body: ICS }));
  await p.goto(url + '#/calendar');
  await p.waitForSelector('.cal-view');
  return { ctx, p, errs };
}

const H = 48;
async function slot(p, date, hour) {
  const col = await p.$(`.tg-col[data-date="${date}"]`);
  const box = await col.boundingBox();
  return { x: box.x + box.width / 2, y: box.y + hour * H + 4 };
}
const db = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('tickwise.db.v1') || '{}'));
const flush = (p) => p.evaluate(() => window.__tickwiseFlush());
async function events(p) {
  await flush(p);
  return Object.values(await db(p)).filter((x) => x.type === 'event' && !x.deleted);
}

(async () => {
  const b = await chromium.launch();
  let checks = 0;
  const ok = (name) => {
    checks++;
    console.log('ok', name);
  };

  // ------------------------------------------------------------- desktop
  const { p, errs } = await open(b);
  const head = await p.$$eval('.tg-dayhead .dnum', (els) => els.map((e) => e.textContent));
  assert.deepEqual(head, ['18', '19', '20', '21', '22', '23', '24']);
  ok('week view starts on Sunday like the person’s Google Calendar');
  assert.ok(await p.$('.tg-dayhead.today'));
  assert.ok(await p.$('.tg-col.today .now-line'));
  ok('today is marked and the now line is drawn');

  // click an empty slot: quick create with a typed repeat and time range
  let s = await slot(p, '2026-10-19', 10);
  await p.mouse.click(s.x, s.y);
  await p.waitForSelector('.quickev .qe-title');
  await p.keyboard.type('Chairing every monday 10am-12pm');
  await p.waitForTimeout(150);
  assert.match(await p.textContent('.quickev .chip-date'), /Mon 19 Oct · 10am – 12pm · Weekly on Monday/);
  await p.screenshot({ path: `${OUT}/cal-01-quick.png` });
  await p.keyboard.press('Enter');
  await p.waitForTimeout(250);
  let evs = await events(p);
  let chair = evs.find((e) => e.title === 'Chairing');
  assert.ok(chair && chair.rrule && chair.rrule.freq === 'weekly' && chair.start === '2026-10-19T10:00' && chair.end === '2026-10-19T12:00' && chair.tz === 'Australia/Sydney');
  const block = await p.$('.tg-col[data-date="2026-10-19"] .ev-block:has-text("Chairing")');
  const bb = await block.boundingBox();
  assert.ok(Math.abs(bb.height - (2 * H - 2)) < 2, `height ${bb.height}`);
  ok('quick create reads “every monday 10am-12pm” into a weekly 2-hour event');

  // drag to create 10:00–12:00 on Wednesday
  s = await slot(p, '2026-10-21', 10);
  await p.mouse.move(s.x, s.y);
  await p.mouse.down();
  await p.mouse.move(s.x, s.y + H, { steps: 4 });
  await p.mouse.move(s.x, s.y + 2 * H - 10, { steps: 4 });
  await p.mouse.up();
  await p.waitForSelector('.quickev .qe-title');
  assert.deepEqual(await p.$$eval('.quickev .time-field input', (els) => els.map((e) => e.value)), ['10am', '12pm']);
  await p.keyboard.type('Pre-study 22-24');
  await p.fill('.quickev input[aria-label="Location"]', 'Zoom');
  await p.click('.quickev button[type="submit"]');
  await p.waitForTimeout(250);
  evs = await events(p);
  const pre = evs.find((e) => e.title === 'Pre-study 22-24');
  assert.ok(pre && pre.start === '2026-10-21T10:00' && pre.end === '2026-10-21T12:00' && pre.location === 'Zoom');
  ok('dragging across empty time makes an event of that length');

  // the details card
  await p.click('.tg-col[data-date="2026-10-19"] .ev-block:has-text("Chairing")');
  await p.waitForSelector('.evcard');
  assert.match(await p.textContent('.evcard'), /Weekly on Monday/);
  assert.match(await p.textContent('.evcard'), /10 minutes before/);
  await p.screenshot({ path: `${OUT}/cal-02-card.png` });
  await p.keyboard.press('Escape');
  ok('the details card shows the repeat and the default reminder');

  // move by dragging to Thursday 11:00, then undo
  const pb = await (await p.$('.tg-col[data-date="2026-10-21"] .ev-block:has-text("Pre-study")')).boundingBox();
  const t = await slot(p, '2026-10-22', 11);
  await p.mouse.move(pb.x + pb.width / 2, pb.y + 10);
  await p.mouse.down();
  await p.mouse.move(t.x, t.y + 6, { steps: 8 });
  await p.screenshot({ path: `${OUT}/cal-03-drag.png` });
  await p.mouse.up();
  await p.waitForTimeout(250);
  evs = await events(p);
  let moved = evs.find((e) => e.id === pre.id);
  assert.equal(moved.start, '2026-10-22T11:00');
  assert.equal(moved.end, '2026-10-22T13:00');
  ok('an event drags to another day and time, keeping its length');
  await p.click('.toast-undo');
  await p.waitForTimeout(200);
  evs = await events(p);
  assert.equal(evs.find((e) => e.id === pre.id).start, '2026-10-21T10:00');
  ok('Undo puts it back');

  // resize from the bottom edge
  const rb = await (await p.$('.tg-col[data-date="2026-10-21"] .ev-block:has-text("Pre-study")')).boundingBox();
  await p.mouse.move(rb.x + rb.width / 2, rb.y + rb.height - 2);
  await p.mouse.down();
  await p.mouse.move(rb.x + rb.width / 2, rb.y + rb.height + H, { steps: 6 });
  await p.mouse.up();
  await p.waitForTimeout(200);
  evs = await events(p);
  assert.equal(evs.find((e) => e.id === pre.id).end, '2026-10-21T13:00');
  ok('dragging the bottom edge changes the end time');

  // repeating: move only next Monday's meeting to Tuesday
  await p.click('button[aria-label="Next"]');
  await p.waitForTimeout(200);
  const cb = await (await p.$('.tg-col[data-date="2026-10-26"] .ev-block:has-text("Chairing")')).boundingBox();
  const tt = await slot(p, '2026-10-27', 10);
  await p.mouse.move(cb.x + cb.width / 2, cb.y + 8);
  await p.mouse.down();
  await p.mouse.move(tt.x, tt.y + 6, { steps: 8 });
  await p.mouse.up();
  await p.waitForSelector('.modal.scope');
  await p.screenshot({ path: `${OUT}/cal-04-scope.png` });
  await p.click('.modal.scope .btn.primary');
  await p.waitForTimeout(250);
  assert.equal(await p.$('.tg-col[data-date="2026-10-26"] .ev-block:has-text("Chairing")'), null);
  assert.ok(await p.$('.tg-col[data-date="2026-10-27"] .ev-block:has-text("Chairing")'));
  evs = await events(p);
  const ov = evs.find((e) => e.recurringId === chair.id);
  assert.ok(ov && ov.originalStart === '2026-10-26T10:00' && ov.start === '2026-10-27T10:00');
  await p.click('button[aria-label="Next"]');
  await p.waitForTimeout(150);
  assert.ok(await p.$('.tg-col[data-date="2026-11-02"] .ev-block:has-text("Chairing")'));
  ok('“This event” moves one occurrence and leaves the rest of the series');

  // edit all events through the editor
  await p.click('.tg-col[data-date="2026-11-02"] .ev-block:has-text("Chairing")');
  await p.click('.evcard button[aria-label="Edit event"]');
  await p.waitForSelector('.modal.ev-editor');
  await p.fill('.ev-editor .ee-title', 'Chairing (Ladies)');
  await p.screenshot({ path: `${OUT}/cal-05-editor.png` });
  await p.click('.ev-editor button[type="submit"]');
  await p.waitForSelector('.modal.scope');
  await p.click('.modal.scope label:has-text("All events")');
  await p.click('.modal.scope .btn.primary');
  await p.waitForTimeout(250);
  evs = await events(p);
  assert.equal(evs.find((e) => e.id === chair.id).title, 'Chairing (Ladies)');
  assert.equal(evs.find((e) => e.recurringId === chair.id).title, 'Chairing (Ladies)');
  ok('“All events” renames the series and its changed occurrence');

  // delete this and following from 9 November
  await p.click('button[aria-label="Next"]');
  await p.waitForTimeout(150);
  await p.click('.tg-col[data-date="2026-11-09"] .ev-block:has-text("Chairing")');
  await p.click('.evcard button[aria-label="Delete event"]');
  await p.waitForSelector('.modal.scope');
  await p.click('.modal.scope label:has-text("This and following events")');
  await p.click('.modal.scope .btn.danger');
  await p.waitForTimeout(250);
  evs = await events(p);
  assert.equal(evs.find((e) => e.id === chair.id).rrule.until, '2026-11-08');
  assert.equal(await p.$('.tg-col[data-date="2026-11-09"] .ev-block:has-text("Chairing")'), null);
  await p.click('button[aria-label="Previous"]');
  await p.waitForTimeout(150);
  assert.ok(await p.$('.tg-col[data-date="2026-11-02"] .ev-block:has-text("Chairing")'));
  ok('“This and following” ends the series the day before');

  // tasks on the calendar
  await p.keyboard.press('t');
  await p.keyboard.press('q');
  await p.waitForSelector('.modal.quick .editor-title');
  await p.keyboard.type('Pay rent tomorrow 9am p1');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(200);
  assert.ok(await p.$('.tg-col[data-date="2026-10-19"] .ev-block.task:has-text("Pay rent")'));
  await p.click('.tg-col[data-date="2026-10-19"] .ev-block.task:has-text("Pay rent")');
  await p.waitForSelector('.evcard .check');
  await p.click('.evcard .check');
  await p.waitForTimeout(250);
  assert.ok(await p.$('.tg-col[data-date="2026-10-19"] .ev-block.task.done'));
  await p.keyboard.press('Escape');
  ok('tasks with a time show on the grid and can be ticked off there');

  // all-day row, month overflow and the day list
  await p.keyboard.press('m');
  await p.waitForSelector('.mg');
  for (let i = 1; i <= 8; i++) {
    const cell = await (await p.$('.mg-cell[data-date="2026-10-30"]')).boundingBox();
    await p.mouse.click(cell.x + cell.width - 8, cell.y + cell.height - 4);
    await p.waitForSelector('.quickev .qe-title:focus');
    await p.keyboard.type(`Packing ${i}`);
    await p.keyboard.press('Enter');
    await p.waitForTimeout(160);
  }
  evs = await events(p);
  assert.equal(evs.filter((e) => /^Packing/.test(e.title) && e.allDay && e.start === '2026-10-30' && e.end === '2026-10-31').length, 8);
  const more = await p.$('.mg-cell[data-date="2026-10-30"] .mg-more');
  assert.ok(more, 'a “+N more” link');
  await p.screenshot({ path: `${OUT}/cal-06-month.png` });
  await more.click();
  await p.waitForSelector('.daylist');
  assert.equal(await p.$$eval('.daylist .dl-item', (x) => x.length), 8);
  await p.keyboard.press('Escape');
  ok('clicking a day in the month makes an all-day event, and a full day shows “+N more”');

  // drag a month item to another day
  const mi = await (await p.$('.mg-item:has-text("Pre-study")')).boundingBox();
  const target = await (await p.$('.mg-cell[data-date="2026-10-28"]')).boundingBox();
  await p.mouse.move(mi.x + 20, mi.y + 8);
  await p.mouse.down();
  await p.mouse.move(target.x + 40, target.y + 60, { steps: 8 });
  await p.mouse.up();
  await p.waitForTimeout(250);
  evs = await events(p);
  assert.equal(evs.find((e) => e.id === pre.id).start, '2026-10-28T10:00');
  ok('month items drag to another day, keeping their time');

  // drag across three days to make a trip
  const c1 = await (await p.$('.mg-cell[data-date="2026-10-13"]')).boundingBox();
  const c3 = await (await p.$('.mg-cell[data-date="2026-10-15"]')).boundingBox();
  await p.mouse.move(c1.x + 30, c1.y + c1.height - 10);
  await p.mouse.down();
  await p.mouse.move(c3.x + 30, c3.y + c3.height - 10, { steps: 8 });
  await p.mouse.up();
  await p.waitForSelector('.quickev .qe-title:focus');
  await p.keyboard.type('Trip to Melbourne');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(200);
  evs = await events(p);
  const trip = evs.find((e) => e.title === 'Trip to Melbourne');
  assert.ok(trip && trip.allDay && trip.start === '2026-10-13' && trip.end === '2026-10-16', JSON.stringify(trip));
  ok('dragging across days in the month makes a multi-day event');

  await p.keyboard.press('y');
  await p.waitForSelector('.yg');
  await p.click('.yg .mini:nth-child(10) .mini-day[aria-label*="30 October"], .yg .mini:nth-child(10) .mini-day:has-text("30") >> nth=0');
  await p.waitForSelector('.daylist');
  await p.screenshot({ path: `${OUT}/cal-07-year.png` });
  await p.keyboard.press('Escape');
  ok('the year view opens a day’s list');

  await p.keyboard.press('a');
  await p.waitForSelector('.sched');
  const firstItems = await p.$$eval('.sched-title', (x) => x.slice(0, 3).map((e) => e.textContent));
  assert.ok(firstItems.length >= 2);
  await p.screenshot({ path: `${OUT}/cal-08-schedule.png` });
  ok('the schedule lists what’s coming');

  await p.keyboard.press('/');
  await p.keyboard.type('pre-st');
  await p.waitForTimeout(150);
  assert.match(await p.textContent('.sched'), /Pre-study 22-24/);
  await p.click('button[aria-label="Search events"]');
  ok('searching finds events');

  // ------------------------------------------------------------- subscriptions and files
  await p.keyboard.press('w');
  await p.click('.sb-cal button[aria-label="Add other calendars"]');
  await p.click('.menu-item:has-text("Subscribe to a calendar")');
  await p.waitForSelector('.cal-panel input[type="url"]');
  await p.fill('.cal-panel input[type="url"]', 'webcal://example.test/church.ics');
  await p.click('.cal-panel button:has-text("Subscribe")');
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${OUT}/cal-09-settings.png` });
  evs = await events(p);
  const bible = evs.find((e) => e.title === 'Bible study (P10)');
  assert.ok(bible && bible.rrule && bible.src && bible.src.k === 'ics');
  assert.ok(evs.find((e) => e.title === '阿梅生日' && e.allDay));
  ok('a calendar link (webcal://) is read and its events copied in');

  // the browser can't read Google's links; it says so without an error badge
  await p.fill('.cal-panel input[type="url"]', 'https://calendar.google.com/calendar/ical/someone%40gmail.com/private-abc123/basic.ics');
  await p.click('.cal-panel button:has-text("Subscribe")');
  await p.waitForTimeout(600);
  assert.match(await p.textContent('.cal-panel'), /can’t read the link itself/);
  assert.match(await p.textContent('.cal-panel'), /someone@gmail\.com/);
  ok('a Google link in a browser is kept, with a note that the apps read it');
  await p.keyboard.press('Escape');

  // read-only card for a subscribed event
  await p.click('button[aria-label="Next"]');
  await p.waitForTimeout(150);
  await p.click('.tg-col[data-date="2026-10-30"] .ev-block:has-text("Bible study")');
  await p.waitForSelector('.evcard');
  assert.equal(await p.$('.evcard button[aria-label="Edit event"]'), null);
  assert.match(await p.textContent('.evcard'), /From a subscribed calendar/);
  await p.keyboard.press('Escape');
  ok('subscribed events are read-only');

  // .ics import (twice: no duplicates) and export
  await p.evaluate(() => (location.hash = '#/today'));
  await p.waitForTimeout(100);
  await p.evaluate(() => (location.hash = '#/calendar'));
  await p.waitForSelector('.cal-view');
  await p.click('.sb-cal button[aria-label="Add other calendars"]');
  await p.click('.menu-item:has-text("Import an .ics file")');
  await p.waitForSelector('.cal-panel .file-btn');
  const file = path.join(OUT, 'holidays.ics');
  fs.writeFileSync(file, HOLIDAYS);
  for (let i = 0; i < 2; i++) {
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('.cal-panel .file-btn')]);
    await fc.setFiles(file);
    await p.waitForTimeout(250);
  }
  evs = await events(p);
  assert.equal(evs.filter((e) => e.title === 'Chung Yeung Festival').length, 1);
  assert.match(await p.textContent('.cal-panel'), /Imported 2 events/);
  ok('importing an .ics file twice updates instead of doubling');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('.cal-panel button:has-text("Export .ics")')]);
  const text = fs.readFileSync(await dl.path(), 'utf8');
  assert.match(text, /BEGIN:VCALENDAR/);
  assert.match(text, /SUMMARY:Chairing \(Ladies\)/);
  assert.match(text, /RRULE:FREQ=WEEKLY;UNTIL=/);
  ok('export writes an .ics with the series and its end');
  await p.keyboard.press('Escape');

  // reminder 10 minutes before an event
  await p.keyboard.press('t');
  s = await slot(p, '2026-10-18', 16);
  await p.mouse.click(s.x, s.y + 2);
  await p.waitForSelector('.quickev .qe-title');
  await p.keyboard.type('Call Mum 4pm');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(100);
  await p.clock.fastForward('10:25');
  await p.waitForTimeout(300);
  assert.match(await p.textContent('.toasts'), /Call Mum · 4pm – 5pm/);
  ok('an event reminder appears 10 minutes before');

  // Today and Upcoming list the day’s events
  await p.evaluate(() => (location.hash = '#/today'));
  await p.waitForSelector('.day-events');
  assert.match(await p.textContent('.day-events'), /Call Mum/);
  await p.screenshot({ path: `${OUT}/cal-10-today.png` });
  ok('Today shows today’s events');

  assert.deepEqual(errs, []);
  ok('no page errors');
  await p.context().close();

  // ------------------------------------------------------------- the apps read Google links
  const app = await open(b, {
    init: (ics) => {
      window.twFetch = (id, u) => setTimeout(() => window.__twFetchDone(id, /calendar\.google\.com/.test(u) ? 200 : 0, ics), 30);
    },
  });
  await app.p.evaluate(() => (location.hash = '#/calendar'));
  await app.p.click('.sb-cal .sb-empty');
  await app.p.waitForSelector('.cal-panel input[type="url"]');
  await app.p.fill('.cal-panel input[type="url"]', 'https://calendar.google.com/calendar/ical/someone%40gmail.com/private-abc123/basic.ics');
  await app.p.click('.cal-panel button:has-text("Subscribe")');
  await app.p.waitForTimeout(500);
  evs = await events(app.p);
  assert.ok(evs.some((e) => e.title === 'Bible study (P10)'));
  ok('in the Windows and Android apps a Google link is read through the app');
  await app.p.context().close();

  // ------------------------------------------------------------- phone
  const ph = await open(b, { viewport: { width: 390, height: 844 } });
  assert.equal(await ph.p.$$eval('.tg-dayhead', (x) => x.length), 3);
  ok('a phone opens on the 3-day view');
  const sw = await ph.p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  assert.ok(sw);
  await ph.p.screenshot({ path: `${OUT}/cal-11-phone.png` });
  await ph.p.click('.cal-fab');
  await ph.p.waitForSelector('.sheet.quickev');
  await ph.p.screenshot({ path: `${OUT}/cal-12-phone-quick.png` });
  await ph.p.keyboard.type('Lunch fri 12:30-1:30pm');
  await ph.p.click('.sheet.quickev button[type="submit"]');
  await ph.p.waitForTimeout(200);
  const lunch = (await events(ph.p)).find((e) => e.title === 'Lunch');
  assert.ok(lunch && lunch.start === '2026-10-23T12:30' && lunch.end === '2026-10-23T13:30');
  ok('on a phone, the + button opens quick create with the title ready to type');
  await ph.p.click('.cal-viewbtn');
  await ph.p.click('.menu-item:has-text("Month")');
  await ph.p.waitForTimeout(200);
  await ph.p.screenshot({ path: `${OUT}/cal-13-phone-month.png` });
  await ph.p.click('.cal-viewbtn');
  await ph.p.click('.menu-item:has-text("Schedule")');
  await ph.p.waitForTimeout(200);
  await ph.p.screenshot({ path: `${OUT}/cal-14-phone-schedule.png` });
  assert.ok(await ph.p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  ok('phone layouts fit the screen');
  assert.deepEqual(ph.errs, []);
  await ph.p.context().close();

  await b.close();
  console.log(`${checks} calendar checks passed`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
