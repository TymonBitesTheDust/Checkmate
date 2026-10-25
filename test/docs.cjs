// Docs & Sheets: links Google Sheets and Docs (answered by stand-in Google responses),
// checks the tasks they make, re-syncs after changes, and covers the browser paths
// (fetch, script fallback, Drive API key) and the app path (window.twFetch).
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const path = require('path');
const assert = require('assert');
const OUT = process.argv[2] || '/tmp/shots';
require('fs').mkdirSync(OUT, { recursive: true });
const url = 'file://' + path.resolve(__dirname, '../web/dist/Checkmate.html');

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = new Date();
const plus = (n) => ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
const gvDate = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return { v: `Date(${y},${m - 1},${d})`, f: s };
};
const cell = (v) => (v == null ? null : typeof v === 'object' ? v : { v, f: String(v) });

// ---------------------------------------------------------------- stand-in Google

const SHEET = 'SheetGroceries000000000000000000000000';
const JSONP_SHEET = 'SheetScriptOnly0000000000000000000000';
const ZH_SHEET = 'SheetChinese00000000000000000000000000';
const DOC = 'DocTripPlan0000000000000000000000000000';
const sheets = {
  [SHEET]: {
    cors: true,
    cols: ['Task', 'Done', 'Due', 'Priority', 'Labels', 'Section', 'Notes'],
    rows: [
      ['Buy milk', false, gvDate(plus(1)), 'P2', 'errand', 'Shopping', 'Semi-skimmed'],
      ['Pay rent', false, null, 1, 'bills, home', 'Home', null],
      ['Call plumber', true, gvDate(plus(0)), 'Low', null, 'Home', null],
      ['Book dentist next fri', false, null, null, null, null, null],
      ['Fix bike', false, null, null, null, 'Home', null],
      [null, false, null, null, null, null, null],
    ],
  },
  [JSONP_SHEET]: { cors: false, cols: ['Item', 'Status'], rows: [['Water the plants', 'done'], ['Sweep the porch', '']] },
  [ZH_SHEET]: {
    cors: true,
    cols: ['任務', '完成', '日期', '優先級', '標籤'],
    rows: [
      ['買牛奶', '', '2026/11/20', '高', '購物'],
      ['交租', '完成', '', '1', ''],
      ['明天下午3點 打電話給阿明', '', '', '', '電話'],
    ],
  },
};
let docText = [
  '# Trip plan',
  '',
  '## Before we go',
  '- Book flights tomorrow p1 @travel',
  '- [x] Renew passport',
  '- Pack',
  '    - Charger',
  '    - ~~Old adapter~~',
  '## On the day',
  '- Taxi to airport 6am',
  'A paragraph that is not a task.',
].join('\n');

function gvizJson(id) {
  const s = sheets[id];
  if (!s) return { version: '0.6', status: 'error', errors: [{ reason: 'access_denied', message: 'Access denied' }] };
  return {
    version: '0.6',
    status: 'ok',
    table: {
      cols: s.cols.map((label, i) => ({ id: String.fromCharCode(65 + i), label, type: 'string' })),
      rows: s.rows.map((r) => ({ c: r.map(cell) })),
    },
  };
}
const signIn = { status: 200, text: '<!DOCTYPE html><html><head><title>Sign in</title></head><body>Sign in</body></html>', type: 'text/html' };

// Answers like Google would. Returns { status, text, type, cors }.
function google(u) {
  const x = new URL(u);
  let m;
  if ((m = x.pathname.match(/\/spreadsheets\/d\/([\w-]+)\/gviz\/tq/))) {
    const tqx = x.searchParams.get('tqx') || '';
    const handler = (tqx.match(/responseHandler:([\w$]+)/) || [])[1] || 'google.visualization.Query.setResponse';
    return { status: 200, text: `/*O_o*/\n${handler}(${JSON.stringify(gvizJson(m[1]))});`, type: 'text/javascript', cors: !!(sheets[m[1]] && sheets[m[1]].cors) };
  }
  if ((m = x.pathname.match(/\/spreadsheets\/d\/([\w-]+)\/export/))) return sheets[m[1]] ? { status: 200, text: 'x', type: 'text/csv' } : signIn;
  if ((m = x.pathname.match(/\/document\/d\/([\w-]+)\/export/))) return m[1] === DOC ? { status: 200, text: docText, type: 'text/plain' } : signIn;
  if ((m = x.pathname.match(/\/drive\/v3\/files\/([\w-]+)\/export/))) {
    const key = x.searchParams.get('key');
    if (key !== 'AIzaGoodKey') {
      return { status: 400, cors: true, type: 'application/json', text: JSON.stringify({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }) };
    }
    return m[1] === DOC ? { status: 200, text: docText, type: 'text/markdown', cors: true } : { status: 404, cors: true, type: 'application/json', text: '{"error":{"code":404,"message":"File not found"}}' };
  }
  return { status: 404, text: 'nope', type: 'text/plain' };
}
const requests = [];
async function routeGoogle(ctx) {
  const handler = (route) => {
    const u = route.request().url();
    requests.push(u);
    const r = google(u);
    // Playwright's stand-in answers skip the browser's cross-site check, so a fetch()
    // Google wouldn't allow is failed here the way a real browser fails it.
    if (!r.cors && route.request().resourceType() === 'fetch') return route.abort('failed');
    route.fulfill({ status: r.status, body: r.text, headers: { 'content-type': r.type, ...(r.cors ? { 'access-control-allow-origin': '*' } : {}) } });
  };
  await ctx.route('https://docs.google.com/**', handler);
  await ctx.route('https://www.googleapis.com/**', handler);
}

// ---------------------------------------------------------------- helpers

const items = (p) => p.evaluate(() => (window.__tickwiseFlush(), Object.values(JSON.parse(localStorage.getItem('tickwise.db.v1')))).filter((x) => !x.deleted));
const prefs = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('tickwise.prefs.v1') || '{}'));
async function openDocs(p) {
  if (!(await p.$('.settings-panel'))) {
    await p.click('.sb-foot .nav-item');
    await p.waitForSelector('.settings-panel');
  }
  await p.click('.settings-tabs button[data-tab="docs"]');
  await p.waitForSelector('.ds-form');
}
async function link(p, link, { name = '', target } = {}) {
  await openDocs(p);
  await p.fill('.ds-url', link);
  if (target) await p.selectOption('.ds-form select >> nth=0', target);
  if (name) await p.fill('.ds-name', name);
  await p.click('.ds-form button[type=submit]');
  await p.waitForFunction(() => !document.querySelector('.ds-form button[type=submit] .ds-spin'), null, { timeout: 30000 });
  await p.waitForTimeout(150);
  return {
    ok: await p.$eval('.ds-form', (f) => (f.querySelector('.form-ok') || {}).textContent || ''),
    err: await p.$eval('.ds-form', (f) => (f.querySelector('.form-error') || {}).textContent || ''),
  };
}
const lastToast = (p) => p.$$eval('.toast .toast-msg', (x) => (x.length ? x[x.length - 1].textContent : ''));
async function closeSettings(p) {
  if (await p.$('.settings-panel')) await p.click('.settings-head .icon-btn');
  await p.waitForTimeout(150);
}

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const watch = (p, tag) => {
    p.on('pageerror', (e) => errs.push(`${tag}: ${e.message}`));
    p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|CORS|Access-Control/i.test(m.text()) && errs.push(`${tag} console: ${m.text()}`));
  };

  // ================================================================ in a browser
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
  await routeGoogle(ctx);
  const p = await ctx.newPage();
  watch(p, 'web');
  await p.goto(url);
  await p.evaluate(() => localStorage.setItem('tickwise.prefs.v1', JSON.stringify({ language: 'en', theme: 'light', dateOrder: 'dmy' })));
  await p.reload();
  await p.waitForSelector('.view-title');

  // A bad link, an unshared sheet
  await openDocs(p);
  await p.fill('.ds-url', 'https://example.com/foo');
  await p.click('.ds-form button[type=submit]');
  assert.match(await p.textContent('.ds-form .form-error'), /doesn’t look like a Google Doc or Sheet/);
  let r = await link(p, 'https://docs.google.com/spreadsheets/d/SheetNotShared000000000000000000000/edit');
  assert.match(r.err, /Anyone with the link/, 'unshared sheet explains sharing');
  console.log('unshared sheet →', r.err.slice(0, 60) + '…');

  // 1. A sheet, read with fetch
  await p.fill('.ds-url', `https://docs.google.com/spreadsheets/d/${SHEET}/edit#gid=0`);
  assert.match(await p.textContent('.ds-form .field-hint'), /each row becomes a task/);
  r = await link(p, `https://docs.google.com/spreadsheets/d/${SHEET}/edit#gid=0`, { name: 'Groceries' });
  console.log('sheet linked →', r.ok);
  assert.match(r.ok, /5 tasks from the Google Sheet are in “Groceries”/);
  await p.screenshot({ path: `${OUT}/docs-1-linked.png` });
  let all = await items(p);
  const proj = all.find((x) => x.type === 'project' && x.name === 'Groceries');
  assert(proj, 'project made');
  const src = all.find((x) => x.type === 'docsource');
  assert.strictEqual(src.projectId, proj.id);
  assert.strictEqual(src.kind, 'sheet');
  const t = (title) => all.find((x) => x.type === 'task' && x.title === title && x.projectId === proj.id);
  const secName = (id) => (all.find((x) => x.id === id) || {}).name;
  const lblNames = (ids) => ids.map((id) => all.find((x) => x.id === id).name).sort().join(',');
  assert.strictEqual(t('Buy milk').due.date, plus(1));
  assert.strictEqual(t('Buy milk').priority, 2);
  assert.strictEqual(lblNames(t('Buy milk').labels), 'errand');
  assert.strictEqual(secName(t('Buy milk').sectionId), 'Shopping');
  assert.strictEqual(t('Buy milk').desc, 'Semi-skimmed');
  assert.strictEqual(t('Pay rent').priority, 1);
  assert.strictEqual(lblNames(t('Pay rent').labels), 'bills,home');
  assert.strictEqual(t('Call plumber').done, true);
  assert.strictEqual(t('Call plumber').priority, 4);
  assert(t('Book dentist') && t('Book dentist').due && t('Book dentist').due.date > plus(0), '"next fri" read as a date');
  assert(t('Fix bike'));
  assert(all.filter((x) => x.type === 'task' && x.projectId === proj.id).every((x) => x.id.startsWith(`ds_${src.id}_`) && x.src && x.src.s === src.id));

  // the same link again is refused
  r = await link(p, `https://docs.google.com/spreadsheets/d/${SHEET}/edit`);
  assert.match(r.err, /already synced to “Groceries”/);

  // 2. An edit in Tickwise survives a sync while the row is unchanged
  await closeSettings(p);
  await p.goto(url + `#/project/${proj.id}`);
  await p.waitForTimeout(400);
  assert.match(await p.textContent('.view-sub'), /Synced from a Google Sheet/);
  await p.screenshot({ path: `${OUT}/docs-2-project.png` });
  await p.click('.task-row:has-text("Pay rent") .check');
  await p.waitForTimeout(800);
  await p.click('button[aria-label="Project actions"]');
  await p.waitForSelector('.menu-item:has-text("Sync from linked Google Sheet now")');
  await p.screenshot({ path: `${OUT}/docs-3-menu.png` });
  await p.click('.menu-item:has-text("Sync from linked Google Sheet now")');
  await p.waitForTimeout(600);
  console.log('unchanged sync →', await lastToast(p));
  assert.match(await lastToast(p), /“Groceries” is up to date/);
  all = await items(p);
  assert.strictEqual(t('Pay rent').done, true, 'Tickwise edit kept');

  // 3. Changes in the sheet
  const S = sheets[SHEET];
  S.rows[0][2] = gvDate(plus(2)); // Buy milk moves
  S.rows[3][1] = true; // Book dentist done
  S.rows.splice(4, 1); // Fix bike gone
  S.rows.splice(1, 1); // Pay rent gone (done in Tickwise, so kept)
  S.rows.push(['Water plants', false, null, 'urgent', null, 'Home', null]);
  await openDocs(p);
  await p.click('.ds-card button:has-text("Sync now")');
  await p.waitForTimeout(800);
  console.log('changed sync →', await lastToast(p));
  assert.match(await lastToast(p), /Synced “Groceries”: 1 added, 1 updated, 1 completed, 1 removed/);
  all = await items(p);
  assert.strictEqual(t('Buy milk').due.date, plus(2));
  assert.strictEqual(t('Book dentist').done, true);
  assert(!t('Fix bike'), 'removed row removed');
  assert(t('Pay rent') && t('Pay rent').done, 'completed task kept');
  assert.strictEqual(t('Water plants').priority, 1);
  assert.match(await p.textContent('.ds-card .ds-status'), /Synced .* · 4 tasks/);

  // 4. A sheet that only answers as a script (how real Google behaves in a browser)
  r = await link(p, `https://docs.google.com/spreadsheets/d/${JSONP_SHEET}/edit`, { name: 'Chores' });
  console.log('script-only sheet →', r.ok || r.err);
  assert.match(r.ok, /2 tasks/);
  all = await items(p);
  const chores = all.find((x) => x.type === 'project' && x.name === 'Chores');
  assert.strictEqual(all.find((x) => x.title === 'Water the plants' && x.projectId === chores.id).done, true);
  assert(requests.some((u) => /responseHandler/.test(u)), 'used the script fallback');

  // 5. A Doc in a browser: needs a key; a bad key says so; a good key works
  r = await link(p, `https://docs.google.com/document/d/${DOC}/edit`);
  console.log('doc without key →', r.err.slice(0, 70) + '…');
  assert.match(r.err, /API key/);
  await p.fill('.copy-row input', 'AIzaWrongKey');
  await p.click('.copy-row button');
  r = await link(p, `https://docs.google.com/document/d/${DOC}/edit`);
  assert.match(r.err, /isn’t valid/);
  await p.fill('.copy-row input', 'AIzaGoodKey');
  await p.click('.copy-row button');
  assert.strictEqual((await prefs(p)).docsApiKey, 'AIzaGoodKey');
  r = await link(p, `https://docs.google.com/document/d/${DOC}/edit`);
  console.log('doc with key →', r.ok);
  assert.match(r.ok, /6 tasks from the Google Doc are in “Trip plan”/);
  all = await items(p);
  const trip = all.find((x) => x.type === 'project' && x.name === 'Trip plan');
  const tt = (title) => all.find((x) => x.type === 'task' && x.title === title && x.projectId === trip.id);
  assert.strictEqual(tt('Book flights').due.date, plus(1));
  assert.strictEqual(tt('Book flights').priority, 1);
  assert.strictEqual(secName(tt('Book flights').sectionId), 'Before we go');
  assert.strictEqual(tt('Renew passport').done, true);
  assert.strictEqual(tt('Charger').parentId, tt('Pack').id);
  assert.strictEqual(tt('Old adapter').done, true);
  assert.strictEqual(tt('Old adapter').parentId, tt('Pack').id);
  assert.strictEqual(tt('Taxi to airport').due.time, '06:00');
  assert.strictEqual(secName(tt('Taxi to airport').sectionId), 'On the day');
  assert(!all.some((x) => x.title && x.title.startsWith('A paragraph')), 'plain paragraph skipped');
  assert.strictEqual(all.find((x) => x.type === 'docsource' && x.projectId === trip.id).apiKey, 'AIzaGoodKey');
  await p.screenshot({ path: `${OUT}/docs-4-cards.png` });
  await p.click('.ds-guide, .row-actions button:has-text("How should my doc or sheet look?")');
  await p.waitForSelector('.ds-guide');
  await p.$eval('.settings-panel', (e) => (e.scrollTop = e.scrollHeight));
  await p.screenshot({ path: `${OUT}/docs-5-guide.png` });

  // 6. Copies of a synced task are plain tasks
  await closeSettings(p);
  const dup = await p.evaluate(() => {
    const id = Object.values(JSON.parse(localStorage.getItem('tickwise.db.v1'))).find((x) => x.title === 'Buy milk').id;
    window.tickwiseOpenTask(id);
    return id;
  });
  await p.waitForSelector('.modal.detail');
  await p.click('.modal.detail .side-dup');
  await p.waitForTimeout(300);
  await p.keyboard.press('Escape');
  assert(dup.startsWith('ds_'));
  all = await items(p);
  const copies = all.filter((x) => x.type === 'task' && x.title === 'Buy milk');
  assert.strictEqual(copies.length, 2);
  assert(copies.some((x) => !x.src && !x.id.startsWith('ds_')), 'the copy is not linked to the sheet');

  // 7. Checks on its own when the app opens and a check is due
  S.rows.push(['Buy bread', false, null, null, null, 'Shopping', null]);
  await p.evaluate(() => {
    const k = 'tickwise.prefs.v1';
    const v = JSON.parse(localStorage.getItem(k));
    for (const id in v.docSync) v.docSync[id].at = 0;
    localStorage.setItem(k, JSON.stringify(v));
  });
  await p.reload();
  await p.waitForTimeout(4500);
  all = await items(p);
  assert(t('Buy bread'), 'auto check picked up the new row');
  console.log('auto check →', await lastToast(p));

  // 8. Stop syncing keeps the tasks
  await openDocs(p);
  const before = (await items(p)).filter((x) => x.type === 'task' && x.projectId === chores.id).length;
  await p.click('.ds-card:has-text("Chores") button:has-text("Stop syncing")');
  await p.click('.modal.confirm .btn.primary');
  await p.waitForTimeout(300);
  all = await items(p);
  assert(!all.some((x) => x.type === 'docsource' && x.projectId === chores.id));
  assert.strictEqual(all.filter((x) => x.type === 'task' && x.projectId === chores.id).length, before);

  // Looks in each style
  for (const skin of ['tickwise', 'archive', 'riot', 'tide']) {
    for (const theme of ['light', 'dark']) {
      await p.evaluate(([s, th]) => {
        const k = 'tickwise.prefs.v1';
        const v = JSON.parse(localStorage.getItem(k));
        v.skin = s;
        v.theme = th;
        localStorage.setItem(k, JSON.stringify(v));
      }, [skin, theme]);
      await p.reload();
      await p.waitForSelector('.view-title');
      await openDocs(p);
      await p.waitForTimeout(500);
      await p.$eval('.settings-panel', (e) => (e.scrollTop = 330));
      await p.screenshot({ path: `${OUT}/docs-style-${skin}-${theme}.png` });
    }
  }

  // ================================================================ in the apps (window.twFetch)
  const app = await b.newContext({ viewport: { width: 1280, height: 860 } });
  await app.exposeFunction('__google', (u) => {
    requests.push('app ' + u);
    const r = google(u);
    return { status: r.status, text: r.text };
  });
  await app.addInitScript(() => {
    window.twFetch = (id, u) => {
      window.__google(u).then((r) => setTimeout(() => window.__twFetchDone(id, r.status, r.text), 20));
    };
  });
  // Docs need no key here, and nothing should go out over the page's own network.
  await app.route('https://**', (route) => {
    errs.push('app page fetched ' + route.request().url());
    route.abort();
  });
  const q = await app.newPage();
  watch(q, 'app');
  await q.goto(url);
  await q.evaluate(() => localStorage.setItem('tickwise.prefs.v1', JSON.stringify({ language: 'zh-Hant', theme: 'light', skin: 'tickwise' })));
  await q.reload();
  await q.waitForSelector('.view-title');
  r = await link(q, `https://docs.google.com/document/d/${DOC}/edit?usp=sharing`);
  console.log('app doc →', r.ok);
  assert.match(r.ok, /已連結/);
  r = await link(q, `https://docs.google.com/spreadsheets/d/${ZH_SHEET}/edit`, { name: '家務' });
  console.log('app 中文 sheet →', r.ok);
  let a = await items(q);
  const home = a.find((x) => x.type === 'project' && x.name === '家務');
  const z = (title) => a.find((x) => x.type === 'task' && x.title === title && x.projectId === home.id);
  assert.strictEqual(z('買牛奶').due.date, '2026-11-20');
  assert.strictEqual(z('買牛奶').priority, 2);
  assert.strictEqual(z('交租').done, true);
  assert.strictEqual(z('交租').priority, 1);
  assert.strictEqual(z('打電話給阿明').due.date, plus(1));
  assert.strictEqual(z('打電話給阿明').due.time, '15:00');
  await q.screenshot({ path: `${OUT}/docs-6-zh.png` });

  // A doc change: new subtask, a line struck through
  docText = docText.replace('    - Charger', '    - ~~Charger~~\n    - Socks');
  await q.click('.ds-card:has-text("Trip plan") button.btn.ghost.sm >> nth=0');
  await q.waitForTimeout(700);
  console.log('app doc change →', await lastToast(q));
  a = await items(q);
  const trip2 = a.find((x) => x.type === 'project' && x.name === 'Trip plan');
  const t2 = (title) => a.find((x) => x.type === 'task' && x.title === title && x.projectId === trip2.id);
  assert.strictEqual(t2('Socks').parentId, t2('Pack').id);
  assert.strictEqual(t2('Charger').done, true);
  await q.$eval('.settings-panel', (e) => (e.scrollTop = 330));
  await q.screenshot({ path: `${OUT}/docs-7-zh-cards.png` });
  assert(requests.some((u) => u.startsWith('app https://docs.google.com/document/d/')), 'doc read through the app');

  // Same doc on a second device makes the same task ids (no duplicates after sync)
  const ids1 = a.filter((x) => x.projectId === trip2.id && x.type === 'task').map((x) => x.id.split('_').pop()).sort();
  const ids0 = all.filter((x) => x.projectId === trip.id && x.type === 'task').map((x) => x.id.split('_').pop());
  assert(ids0.every((k) => ids1.includes(k)), 'row keys match across devices');

  // Phone layout in Chinese
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await routeGoogle(m);
  const mp = await m.newPage();
  watch(mp, 'phone');
  await mp.goto(url);
  await mp.evaluate(() => localStorage.setItem('tickwise.prefs.v1', JSON.stringify({ language: 'zh-Hant', theme: 'light', skin: 'archive' })));
  await mp.reload();
  await mp.waitForTimeout(500);
  await mp.click('.topbar .icon-btn');
  await mp.waitForTimeout(300);
  await mp.click('.sb-foot .nav-item');
  await mp.waitForSelector('.settings-panel');
  await mp.click('.settings-tabs button[data-tab="docs"]');
  await mp.waitForTimeout(300);
  await mp.screenshot({ path: `${OUT}/docs-8-phone.png` });
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert(!overflow, 'no sideways scroll on a phone');

  console.log(errs.length ? 'ERRORS\n' + errs.join('\n') : 'no page errors');
  await b.close();
  if (errs.length) process.exitCode = 2;
})().catch((e) => {
  console.error('FAILED', e.stack || e.message);
  process.exit(1);
});
