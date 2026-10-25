// Two "devices" (separate browser contexts) syncing through an in-process fake Firestore.
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const path = require('path');
const assert = require('assert');

const url = 'file://' + path.resolve(__dirname, '../web/dist-test/Checkmate.html');
const server = { users: {}, docs: {}, clock: 1_000_000, listeners: {} };
const log = [];

async function deliver(uid, changed) {
  for (const [lid, l] of Object.entries(server.listeners)) {
    if (l.uid !== uid) continue;
    try {
      await l.page.evaluate(([lid, docs]) => window.__mockDeliver(lid, docs), [lid, changed]);
    } catch {}
  }
}

async function device(browser, name) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && log.push(`${name} console: ${m.text()}`));
  await page.exposeFunction('mockCall', async (op, argsJson) => {
    const a = JSON.parse(argsJson);
    if (op === 'signUp') {
      if (server.users[a.email]) return JSON.stringify({ error: 'auth/email-already-in-use' });
      server.users[a.email] = { pw: a.password, uid: 'uid_' + Object.keys(server.users).length };
      return JSON.stringify({ uid: server.users[a.email].uid });
    }
    if (op === 'signIn') {
      const u = server.users[a.email];
      if (!u || u.pw !== a.password) return JSON.stringify({ error: 'auth/invalid-credential' });
      return JSON.stringify({ uid: u.uid });
    }
    if (op === 'commit') {
      const byUid = {};
      for (const w of a.writes) {
        const srv = ++server.clock;
        const d = { ...w.data, srv };
        (server.docs[w.uid] = server.docs[w.uid] || {})[w.id] = d;
        (byUid[w.uid] = byUid[w.uid] || []).push(d);
      }
      setTimeout(() => Object.entries(byUid).forEach(([uid, docs]) => deliver(uid, docs)), 5);
      return JSON.stringify({ ok: true });
    }
    if (op === 'listen') {
      server.listeners[a.lid] = { uid: a.uid, page };
      const docs = Object.values(server.docs[a.uid] || {}).filter((d) => d.srv > a.since).sort((x, y) => x.srv - y.srv);
      return JSON.stringify({ docs });
    }
    if (op === 'unlisten') {
      delete server.listeners[a.lid];
      return 'null';
    }
    return 'null';
  });
  await page.goto(url);
  await page.waitForSelector('.view-title');
  return page;
}

const db = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('tickwise.db.v1') || '{}'));
const findTask = async (page, title) => Object.values(await db(page)).find((x) => x.type === 'task' && x.title === title);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function eventually(fn, what, ms = 4000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) {
    last = await fn();
    if (last) return last;
    await wait(100);
  }
  throw new Error('Timed out waiting for: ' + what);
}
async function quickAdd(page, text) {
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('q');
  await page.waitForSelector('.modal.quick .editor-title');
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await wait(120);
}
async function openSync(page) {
  await page.click('.sb-foot .nav-item');
  await page.waitForSelector('.modal.settings');
  await page.click('.settings-tabs button:has-text("Sync")');
}

(async () => {
  const browser = await chromium.launch();
  const A = await device(browser, 'A');
  const B = await device(browser, 'B');
  const pass = (m) => console.log('  ✓ ' + m);

  // A: connect with a pasted firebaseConfig and create the account
  await quickAdd(A, 'Local before sync #Home p1');
  await openSync(A);
  await A.fill('.settings-panel textarea', 'const firebaseConfig = {\n  apiKey: "AIzaFakeKey",\n  authDomain: "tickwise-test.firebaseapp.com",\n  projectId: "tickwise-test",\n  appId: "1:2:web:3",\n};');
  await A.click('button:has-text("Connect")');
  await A.waitForSelector('input[type="email"]');
  await A.fill('input[type="email"]', 'me@example.com');
  await A.fill('input[type="password"]', 'secret123');
  await A.click('button:has-text("Create account")');
  await A.waitForSelector('.sync-card.st-synced', { timeout: 5000 });
  pass('A created an account and shows "Up to date"');
  const code = await A.inputValue('.copy-row input');
  assert(code.startsWith('TW1-'), 'setup code');
  pass('A shows a setup code for other devices');
  await eventually(() => Object.values(server.docs.uid_0 || {}).some((d) => d.title === 'Local before sync'), 'A local task uploaded');
  assert(!Object.values(server.docs.uid_0).some((d) => d.id === 'welcome-1'), 'seed tasks are not uploaded unless edited');
  pass('A uploaded its existing tasks (and not the untouched welcome tasks)');
  await A.keyboard.press('Escape');

  // B: wrong password first, then sign in with the setup code
  await openSync(B);
  await B.fill('.settings-panel textarea', code);
  await B.click('button:has-text("Connect")');
  await B.waitForSelector('input[type="email"]');
  await B.fill('input[type="email"]', 'me@example.com');
  await B.fill('input[type="password"]', 'wrongpass');
  await B.click('button[type="submit"]:has-text("Sign in")');
  await B.waitForSelector('.form-error');
  assert((await B.textContent('.form-error')).includes('incorrect'));
  pass('B sees a clear error for a wrong password');
  await B.fill('input[type="password"]', 'secret123');
  await B.click('button[type="submit"]:has-text("Sign in")');
  await B.waitForSelector('.sync-card.st-synced', { timeout: 5000 });
  await B.keyboard.press('Escape');
  const tB = await eventually(() => findTask(B, 'Local before sync'), 'B receives A task');
  const projB = (await db(B))[tB.projectId];
  assert(projB && projB.name === 'Home', 'project came along');
  pass('B received A’s task together with its #Home project');

  // B adds -> A receives
  await quickAdd(B, 'Made on B tomorrow 9am @phone');
  const tA = await eventually(() => findTask(A, 'Made on B 9am'), 'A receives B task');
  assert(tA.due && tA.due.time === '09:00', 'due time synced');
  const lblA = (await db(A))[tA.labels[0]];
  assert(lblA && lblA.name === 'phone', 'label synced');
  pass('A received B’s task with its due time and @phone label');

  // A completes -> B sees done
  await A.goto(url + '#/today');
  await A.waitForTimeout(200);
  await A.evaluate(() => (location.hash = '#/search/Local'));
  await A.waitForSelector('.task-row');
  await A.click('.task-row:has-text("Local before sync") .check');
  await eventually(async () => (await findTask(B, 'Local before sync')).done, 'B sees completion');
  pass('Completing on A marks it done on B');

  // B deletes -> A loses it
  await B.evaluate(() => (location.hash = '#/search/Made'));
  await B.waitForSelector('.task-row:has-text("Made on B")');
  await B.click('.task-row:has-text("Made on B") button[aria-label="Task actions"]');
  await B.click('.menu-item:has-text("Delete task")');
  await eventually(async () => !(await findTask(A, 'Made on B 9am')), 'A sees deletion');
  pass('Deleting on B removes it on A');

  // B offline: edits wait, then flow when back online
  await B.evaluate(() => {
    window.__mockOnline = false;
    window.dispatchEvent(new Event('offline'));
  });
  await quickAdd(B, 'Written offline on B');
  await wait(800);
  assert(!(await findTask(A, 'Written offline on B')), 'nothing leaks while offline');
  await B.evaluate(() => {
    window.__mockOnline = true;
    window.dispatchEvent(new Event('online'));
  });
  await eventually(() => findTask(A, 'Written offline on B'), 'A receives offline edit after reconnect');
  pass('Changes made offline on B arrive on A after reconnecting');

  // A offline misses pushes, catches up on reconnect
  await A.evaluate(() => {
    window.__mockOnline = false;
    window.dispatchEvent(new Event('offline'));
  });
  await quickAdd(B, 'Sent while A was offline');
  await wait(600);
  assert(!(await findTask(A, 'Sent while A was offline')));
  await A.evaluate(() => {
    window.__mockOnline = true;
    window.dispatchEvent(new Event('online'));
  });
  await eventually(() => findTask(A, 'Sent while A was offline'), 'A catches up after reconnect');
  pass('A catches up on changes it missed while offline');

  // Reload B: data and session persist, nothing re-uploads needlessly
  const before = server.clock;
  await B.reload();
  await B.waitForSelector('.view-title');
  await wait(800);
  assert(await findTask(B, 'Sent while A was offline'));
  assert(server.clock === before, 'reload does not re-upload');
  pass('Reloading B keeps the session and does not re-upload');

  // Docs & Sheets: a linked sheet reaches B, and both devices make the same tasks
  const sheetRows = [['Milk'], ['Bread']];
  const sheetRoute = (route) => {
    const table = { cols: [{ label: 'Task', type: 'string' }], rows: sheetRows.map((r) => ({ c: r.map((v) => ({ v })) })) };
    const body = `/*O_o*/\ngoogle.visualization.Query.setResponse(${JSON.stringify({ version: '0.6', status: 'ok', table })});`;
    route.fulfill({ status: 200, body, headers: { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' } });
  };
  await A.context().route('https://docs.google.com/**', sheetRoute);
  await B.context().route('https://docs.google.com/**', sheetRoute);
  const inList = async (page) => {
    const d = Object.values(await db(page));
    const p = d.find((x) => x.type === 'project' && x.name === 'Shared list' && !x.deleted);
    return p ? d.filter((x) => x.type === 'task' && !x.deleted && x.projectId === p.id).map((x) => x.id).sort() : [];
  };
  await A.click('.sb-foot .nav-item');
  await A.waitForSelector('.modal.settings');
  await A.click('.settings-tabs button:has-text("Docs & Sheets")');
  await A.fill('.ds-url', 'https://docs.google.com/spreadsheets/d/SharedList0000000000000000000000/edit');
  await A.fill('.ds-name', 'Shared list');
  await A.click('.ds-form button[type=submit]');
  await A.waitForSelector('.ds-card');
  await A.keyboard.press('Escape');
  await eventually(async () => (await inList(A)).length === 2, 'A makes 2 tasks from the sheet');
  await eventually(async () => (await inList(B)).length === 2, 'B receives the sheet tasks');
  await eventually(async () => Object.values(await db(B)).some((x) => x.type === 'docsource' && !x.deleted), 'B receives the link');
  pass('A linked a Google Sheet; B received the link and its tasks');
  sheetRows.push(['Eggs']);
  await B.click('.sb-foot .nav-item');
  await B.waitForSelector('.modal.settings');
  await B.click('.settings-tabs button:has-text("Docs & Sheets")');
  await B.click('.ds-card button:has-text("Sync now")');
  await eventually(async () => (await inList(B)).length === 3, 'B picks up the new row');
  await B.keyboard.press('Escape');
  await eventually(async () => (await inList(A)).length === 3, 'A receives the new row from B');
  await A.evaluate(() => window.tickwiseSyncLinkedDocs());
  await wait(800);
  const listA = await inList(A);
  assert.deepStrictEqual(listA, await inList(B));
  assert.strictEqual(listA.length, 3, 'no duplicates after both devices read the sheet');
  pass('Both devices read the sheet and agree on the same 3 tasks, with no duplicates');

  // Calendar: an event made on A reaches B; a change on B comes back to A
  const findEvent = async (page, title) => Object.values(await db(page)).find((x) => x.type === 'event' && !x.deleted && x.title === title);
  await A.evaluate(() => (location.hash = '#/calendar'));
  await A.waitForSelector('.cal-view');
  await A.click('.cal-create');
  await A.waitForSelector('.quickev .qe-title:focus');
  await A.keyboard.type('Team lunch fri 12:30-1:30pm every week');
  await A.keyboard.press('Enter');
  const evB = await eventually(() => findEvent(B, 'Team lunch'), 'B receives A’s event');
  assert(evB.start.endsWith('T12:30') && evB.end.endsWith('T13:30') && evB.rrule && evB.rrule.freq === 'weekly', 'event times and repeat synced');
  assert(await findEvent(B, 'Team lunch') && Object.values(await db(B)).some((x) => x.id === 'cal-main' && x.type === 'calendar'), 'default calendar on both');
  pass('An event made in A’s calendar arrives on B with its time and weekly repeat');
  await B.evaluate((d) => (location.hash = '#/calendar/' + d), evB.start.slice(0, 10));
  await B.waitForSelector('.ev-block:has-text("Team lunch")');
  await B.click('.ev-block:has-text("Team lunch")');
  await B.click('.evcard button[aria-label="Delete event"]');
  await B.waitForSelector('.modal.scope');
  await B.click('.modal.scope .btn.danger');
  const exA = await eventually(async () => {
    const e = await findEvent(A, 'Team lunch');
    return e && e.exdates && e.exdates.length === 1 ? e : null;
  }, 'A sees the skipped occurrence');
  assert.strictEqual(exA.exdates[0], evB.start);
  pass('Deleting one occurrence on B skips it on A too');

  // Subscribed calendar: read on both devices, the same events, no duplicates
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:Church',
    'BEGIN:VEVENT', 'UID:bible@test', 'DTSTART;TZID=Australia/Sydney:20261023T171500', 'DTEND;TZID=Australia/Sydney:20261023T191500', 'RRULE:FREQ=WEEKLY', 'SUMMARY:Bible study', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:bday@test', 'DTSTART;VALUE=DATE:20261024', 'DTEND;VALUE=DATE:20261025', 'SUMMARY:Birthday', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const icsRoute = (route) => route.fulfill({ status: 200, body: ics, headers: { 'content-type': 'text/calendar', 'access-control-allow-origin': '*' } });
  await A.context().route('https://example.test/**', icsRoute);
  await B.context().route('https://example.test/**', icsRoute);
  await A.evaluate(() => (location.hash = '#/calendar'));
  await A.click('.sb-cal .sb-empty');
  await A.waitForSelector('.cal-panel input[type="url"]');
  await A.fill('.cal-panel input[type="url"]', 'webcal://example.test/church.ics');
  await A.click('.cal-panel button:has-text("Subscribe")');
  await A.waitForSelector('.cal-panel .ds-card:has-text("Church")');
  await A.keyboard.press('Escape');
  const subIds = async (page) => Object.values(await db(page)).filter((x) => x.type === 'event' && !x.deleted && x.src && x.src.k === 'ics').map((x) => x.id).sort();
  await eventually(async () => (await subIds(B)).length === 2, 'B receives the subscribed events');
  await B.evaluate(() => window.tickwiseRefreshCalendars());
  await wait(800);
  assert.deepStrictEqual(await subIds(A), await subIds(B));
  assert.strictEqual((await subIds(A)).length, 2, 'no duplicates after both devices read the link');
  pass('A subscribed to a calendar link; both devices read it and agree on the same events');

  // Same-account second device uses existing email -> clear sign-up error
  const C = await device(browser, 'C');
  await openSync(C);
  await C.fill('.settings-panel textarea', code);
  await C.click('button:has-text("Connect")');
  await C.waitForSelector('input[type="email"]');
  await C.fill('input[type="email"]', 'me@example.com');
  await C.fill('input[type="password"]', 'secret123');
  await C.click('button:has-text("Create account")');
  await C.waitForSelector('.form-error');
  assert((await C.textContent('.form-error')).includes('already exists'));
  pass('Creating a duplicate account explains to sign in instead');

  console.log(log.length ? 'PAGE ERRORS:\n' + log.join('\n') : 'No page errors');
  await browser.close();
})().catch(async (e) => {
  console.error('FAILED:', e.message);
  console.log(log.join('\n'));
  process.exit(1);
});
