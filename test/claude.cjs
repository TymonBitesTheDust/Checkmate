// Checkmate and Claude together, end to end: the app (test build) and the connector share
// one stand-in Firestore. Set up in Settings → Claude, copy the connector code from the
// app, run exactly that code, connect an MCP client like Claude does, and check that what
// Claude does shows up in the app and what the app does shows up for Claude.
//   node test/claude.cjs [screenshot folder]
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const H = require('./connector-harness.cjs');
const { createFakeGoogle } = require('./fake-google.cjs');

// The app is served over http, like the Windows app serves it: headless Chromium sometimes
// starts a file:// page with empty localStorage after a reload, which loses the sync setup.
const http = require('http');
const appServer = http.createServer((q, s) => {
  fs.readFile(path.resolve(__dirname, '../web/dist-test/Checkmate.html'), (e, d) => {
    if (e) return s.writeHead(404), s.end();
    s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    s.end(d);
  });
});
let url;
const OUT = process.argv[2] || '/tmp/shots';
fs.mkdirSync(OUT, { recursive: true });
const server = { users: {}, docs: {}, clock: 1_000_000, listeners: {} };
const log = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pass = (m) => console.log('  ✓ ' + m);
async function eventually(fn, what, ms = 6000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) {
    last = await fn();
    if (last) return last;
    await wait(100);
  }
  throw new Error('Timed out waiting for: ' + what);
}

async function deliver(uid, changed) {
  for (const [lid, l] of Object.entries(server.listeners)) {
    if (l.uid !== uid) continue;
    try {
      await l.page.evaluate(([lid, docs]) => window.__mockDeliver(lid, docs), [lid, changed]);
    } catch {}
  }
}

async function device(browser, name, { lang = 'en', skin = 'tickwise', theme = 'light' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Australia/Sydney', locale: 'en-AU' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && log.push(`${name} console: ${m.text()}`));
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
        const d = { ...w.data, srv: ++server.clock };
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
  await page.addInitScript(({ lang, skin, theme }) => {
    if (!localStorage.getItem('tickwise.prefs.v1')) localStorage.setItem('tickwise.prefs.v1', JSON.stringify({ language: lang, skin, theme }));
    // capture what the app copies and opens
    window.__copied = null;
    window.__opened = [];
    const clip = { writeText: async (t) => void (window.__copied = t), readText: async () => window.__copied || '' };
    try {
      Object.defineProperty(navigator, 'clipboard', { value: clip, configurable: true });
    } catch {}
    window.open = (u) => (window.__opened.push(String(u)), null);
  }, { lang, skin, theme });
  await page.goto(url);
  await page.waitForSelector('.view-title');
  return page;
}

const db = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('tickwise.db.v1') || '{}'));
async function openSettings(page, tabText) {
  await page.keyboard.press('Escape');
  await page.click('.sb-foot .nav-item');
  await page.waitForSelector('.modal.settings');
  await page.click(`.settings-tabs button:has-text("${tabText}")`);
}

(async () => {
  await new Promise((r) => appServer.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${appServer.address().port}/Checkmate.html`;
  const g = createFakeGoogle({ server, apiKey: 'AIzaFakeKey', project: 'checkmate-test', deliver });
  const gbase = await g.listen();
  const browser = await chromium.launch();
  let worker = null;
  try {
    const A = await device(browser, 'A');

    // Before sync: the tab explains what's needed
    await openSettings(A, 'Claude');
    await A.waitForSelector('.cl-panel');
    assert(/Turn on sync first/.test(await A.textContent('.cl-panel')));
    await A.screenshot({ path: `${OUT}/claude-needs-sync.png` });
    await A.click('.cl-panel button:has-text("Open Sync settings")');
    await A.waitForSelector('.settings-panel textarea');
    pass('without sync, Settings → Claude says to turn on sync first and opens the Sync tab');

    // Turn on sync like a person would
    await A.fill('.settings-panel textarea', 'const firebaseConfig = {\n  apiKey: "AIzaFakeKey",\n  authDomain: "checkmate-test.firebaseapp.com",\n  projectId: "checkmate-test",\n  appId: "1:2:web:3",\n};');
    await A.click('button:has-text("Connect")');
    await A.waitForSelector('input[type="email"]');
    await A.fill('input[type="email"]', 'me@example.com');
    await A.fill('input[type="password"]', 'secret123');
    await A.click('button:has-text("Create account")');
    await A.waitForSelector('.sync-card.st-synced', { timeout: 5000 });
    const uid = server.users['me@example.com'].uid;

    // Settings → Claude
    await A.click('.settings-tabs button:has-text("Claude")');
    await A.waitForSelector('.cl-steps');
    assert(/Not connected yet/.test(await A.textContent('.cl-status')));
    await A.screenshot({ path: `${OUT}/claude-setup.png`, fullPage: true });
    await A.click('button:has-text("Copy connector code")');
    const code = await eventually(() => A.evaluate(() => window.__copied), 'code copied');
    const rec = await eventually(() => (server.docs[uid] || {}).claude, 'connector record synced');
    assert(rec.type === 'connector' && rec.secret.length >= 40 && rec.gen > 0 && rec.tz === 'Australia/Sydney');
    const cfgText = /\/\*CHECKMATE_CONFIG\*\/(.*?)\/\*END_CHECKMATE_CONFIG\*\//.exec(code)[1];
    const cfg = JSON.parse(cfgText);
    assert.deepStrictEqual(cfg, { apiKey: 'AIzaFakeKey', projectId: 'checkmate-test', authDomain: 'checkmate-test.firebaseapp.com', secret: rec.secret });
    const dist = fs.readFileSync(path.join(__dirname, '../connector/dist/checkmate-connector.js'), 'utf8');
    assert.strictEqual(code.replace(cfgText, ''), dist.replace(/\/\*CHECKMATE_CONFIG\*\/(.*?)\/\*END_CHECKMATE_CONFIG\*\//, '/*CHECKMATE_CONFIG*//*END_CHECKMATE_CONFIG*/'), 'the app hands out exactly the built connector');
    pass('Copy connector code gives the built connector filled in with this account’s project and a new private key (synced as the connector record)');

    // Run exactly that code, then check its address from the app
    worker = await H.startWorker({ code, cfg: null, googleBase: gbase });
    await A.fill('.cl-check input', 'nope');
    await A.click('.cl-check button[type="submit"]');
    await A.waitForSelector('.cl-check .form-error');
    assert(/Paste the address Cloudflare shows/.test(await A.textContent('.cl-check .form-error')));
    await A.fill('.cl-check input', `${gbase}/hello`);
    await A.click('.cl-check button[type="submit"]');
    await eventually(async () => /isn’t running the Checkmate connector/.test((await A.textContent('.cl-check')) || ''), 'not-a-connector message');
    await A.fill('.cl-check input', `${worker.base}/mcp/`);
    await A.click('.cl-check button[type="submit"]');
    await A.waitForSelector('.cl-check .form-ok');
    assert.strictEqual(await A.inputValue('.cl-check input'), worker.base, 'address tidied');
    assert.strictEqual(await A.inputValue('.cl-mcp input'), `${worker.base}/mcp`);
    await A.click('button:has-text("Add to Claude")');
    const opened = await eventually(async () => (await A.evaluate(() => window.__opened))[0], 'opened Claude');
    assert.strictEqual(opened, `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Checkmate&connectorUrl=${encodeURIComponent(`${worker.base}/mcp`)}`);
    assert.strictEqual((await eventually(() => server.docs[uid].claude.url, 'url synced')), worker.base);
    pass('Check: explains a bad address and a Worker without the connector, accepts the right one and offers Claude’s prefilled Add custom connector link');

    // Claude connects
    const { client } = await H.connect(worker.base, { email: 'me@example.com', password: 'secret123' });
    await A.waitForSelector('.cl-status:has-text("Claude is connected")', { timeout: 6000 });
    assert(/me@example\.com/.test(await A.textContent('.cl-status')));
    await A.screenshot({ path: `${OUT}/claude-connected.png` });
    pass('after Claude signs in, the app shows “Claude is connected” with the account');

    // Claude adds things → the app shows them
    const call = (n, a) => H.call(client, n, a);
    let r = await call('add-tasks', { tasks: [{ title: 'Pick up dry cleaning', due: 'today 5pm', priority: 'p1', labels: ['errands'] }, { title: 'Book dentist', due: 'every 6 months' }] });
    assert(r.tasks && r.tasks.length === 2, JSON.stringify(r));
    await A.keyboard.press('Escape');
    await A.evaluate(() => (location.hash = '#/today'));
    await A.waitForSelector('.task-row:has-text("Pick up dry cleaning")', { timeout: 6000 });
    await A.click('.task-row:has-text("Pick up dry cleaning") .task-title');
    await A.waitForSelector('.side-meta');
    assert(/Added by Claude/.test(await A.textContent('.side-meta')));
    await A.screenshot({ path: `${OUT}/claude-task-in-app.png` });
    await A.keyboard.press('Escape');
    const local = await db(A);
    const dry = Object.values(local).find((x) => x.title === 'Pick up dry cleaning');
    assert(dry && dry.due.time === '17:00' && dry.priority === 1 && local[dry.labels[0]].name === 'errands');
    pass('tasks Claude adds appear in the app straight away (Today, with priority, time and a new label) and say “Added by Claude”');

    const day = (await call('get-overview')).today;
    r = await call('add-events', { events: [{ title: 'Haircut', start: `${day} 18:30`, durationMinutes: 30, location: 'Main St' }] });
    const evId = r.events[0].id;
    await eventually(async () => (await db(A))[evId], 'event synced');
    await A.evaluate(() => (location.hash = '#/calendar'));
    await A.waitForSelector('.cal-view');
    await A.keyboard.press('d');
    await eventually(async () => (await A.textContent('.cal-view')).includes('Haircut'), 'event on the calendar');
    pass('an event Claude adds shows on the app’s calendar');

    // The app changes things → Claude sees them
    await A.evaluate(() => (location.hash = '#/today'));
    await A.waitForSelector('.task-row:has-text("Pick up dry cleaning")');
    await A.click('.task-row:has-text("Pick up dry cleaning") .check');
    await eventually(async () => {
      const d = Object.values(server.docs[uid]).find((x) => x.title === 'Pick up dry cleaning');
      return d && d.done;
    }, 'completion synced');
    r = await call('find-tasks', { status: 'completed', completedSince: day });
    assert(r.tasks.some((t) => t.title === 'Pick up dry cleaning'));
    pass('a task ticked off in the app shows as completed for Claude');

    // Disconnect in the app → Claude is cut off
    await openSettings(A, 'Claude');
    await A.click('.cl-status button:has-text("Disconnect")');
    await A.click('.modal button.btn.danger');
    await A.waitForSelector('.cl-status:has-text("Not connected yet")');
    await eventually(() => !server.docs[uid].claude.authAt, 'disconnect synced');
    let cut = false;
    try {
      await client.callTool({ name: 'find-tasks', arguments: {} });
    } catch {
      cut = true;
    }
    assert(cut, 'Claude was cut off');
    pass('Disconnect in the app stops Claude straight away');

    // Chinese and every style
    await A.evaluate(() => {
      const k = 'tickwise.prefs.v1';
      const v = JSON.parse(localStorage.getItem(k));
      v.language = 'zh-Hant';
      localStorage.setItem(k, JSON.stringify(v));
    });
    await A.reload();
    await A.waitForSelector('.view-title');
    await openSettings(A, 'Claude');
    // once Claude has been connected the guide starts folded; open it
    await A.waitForSelector('.cl-guide');
    if (!(await A.$eval('.cl-guide', (d) => d.open))) await A.click('.cl-guide > summary');
    await A.waitForSelector('.cl-steps');
    const zh = await A.textContent('.cl-panel');
    assert(/複製連接器程式碼/.test(zh) && /放到 Cloudflare/.test(zh) && /新增到 Claude/.test(zh), zh.slice(0, 300));
    // Only product names and the English menu names of Cloudflare and Claude stay in English.
    const OK = new Set(['Checkmate', 'Claude', 'Todoist', 'Cloudflare', 'Firebase', 'dash', 'cloudflare', 'com', 'Workers', 'Pages', 'Compute', 'Create', 'Start', 'with', 'Hello', 'World',
      'Deploy', 'Edit', 'code', 'worker', 'js', 'checkmate', 'workers', 'dev', 'Customize', 'Connectors', 'Add', 'custom', 'connector', 'Sign', 'in', 'now', 'Use', 'published', 'identity',
      'Connect', 'Team', 'Enterprise', 'Owner', 'Australia', 'Sydney', 'http', 'https', 'mcp', 'p1', 'yourname', 'Claude’s']);
    const words = await A.evaluate(() => {
      const c = document.querySelector('.cl-panel').cloneNode(true);
      c.querySelectorAll('select').forEach((x) => x.remove()); // time zone names are IANA names
      return c.textContent;
    });
    const english = [...new Set((words.match(/[A-Za-z]{2,}/g) || []).filter((w) => !OK.has(w)))];
    assert.deepStrictEqual(english, [], 'English left in the Chinese Claude tab');
    await A.screenshot({ path: `${OUT}/claude-zh.png`, fullPage: true });
    pass('the Claude tab reads in Traditional Chinese');

    for (const [skin, theme] of [['tickwise', 'dark'], ['archive', 'light'], ['riot', 'light'], ['tide', 'dark'], ['frontier', 'light'], ['neon', 'dark']]) {
      await A.evaluate(([skin, theme]) => {
        const k = 'tickwise.prefs.v1';
        const v = JSON.parse(localStorage.getItem(k));
        Object.assign(v, { skin, theme, language: 'en' });
        localStorage.setItem(k, JSON.stringify(v));
      }, [skin, theme]);
      await A.reload();
      await A.waitForSelector('.view-title');
      await openSettings(A, 'Claude');
      await A.waitForSelector('.cl-guide');
      if (!(await A.$eval('.cl-guide', (d) => d.open))) await A.click('.cl-guide > summary');
      await A.waitForSelector('.cl-steps');
      await A.waitForTimeout(250);
      await A.screenshot({ path: `${OUT}/claude-style-${skin}-${theme}.png` });
    }
    const ph = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Australia/Sydney' });
    const P = await ph.newPage();
    P.on('pageerror', (e) => log.push(`phone pageerror: ${e.message}`));
    await P.addInitScript(() => localStorage.setItem('tickwise.prefs.v1', JSON.stringify({ language: 'en', firebaseConfig: { apiKey: 'k', projectId: 'checkmate-test' } })));
    await P.goto(url);
    await P.waitForSelector('.view-title');
    pass('screenshots of the Claude tab in all six styles');

    const bad = log.filter((l) => !/net::ERR|mockCall|blocked by CORS policy/.test(l)); // the CORS line comes from the deliberate “not a connector” check
    assert.deepStrictEqual(bad, [], 'no page errors');
    console.log('\nclaude (app + connector): all checks passed');
  } finally {
    if (worker) worker.stop();
    g.close();
    appServer.close();
    await browser.close();
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  console.error(log.join('\n'));
  process.exit(1);
});
