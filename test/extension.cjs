// The Chrome/Edge extension (extension/dist/Checkmate, made by node extension/build.mjs):
// installing opens the app, the toolbar popup adds and completes tasks through the open tab
// or by itself when no tab is open, reminders become alarms in the service worker, a reminder
// or popup row opens its task, and every extension page runs without inline scripts.
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const OUT = process.argv[2] || '/tmp/shots';
fs.mkdirSync(OUT, { recursive: true });
const pass = (m) => console.log('  ✓ ' + m);
const ext = path.resolve(__dirname, '../extension/dist/Checkmate');
const { VERSION } = { VERSION: fs.readFileSync(path.resolve(__dirname, '../web/src/version.js'), 'utf8').match(/VERSION = '([^']+)'/)[1] };

(async () => {
  // the package itself
  const manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
  assert.strictEqual(manifest.manifest_version, 3);
  assert.strictEqual(manifest.version, VERSION, 'manifest version');
  for (const f of ['app.html', 'popup.html']) {
    const html = fs.readFileSync(path.join(ext, f), 'utf8');
    assert(!/<script>/.test(html) && !/\son[a-z]+=/.test(html.replace(/<style>[\s\S]*?<\/style>/g, '')), `${f}: no inline scripts`);
  }
  for (const f of ['app.js', 'popup.js', 'background.js']) assert(!/apis\.google\.com\/js|recaptcha\/api\.js/.test(fs.readFileSync(path.join(ext, f), 'utf8')), `${f}: no code loaded from the web`);
  assert(fs.existsSync(path.resolve(__dirname, '../dist/Checkmate-extension.zip')), 'the zip');
  pass(`Manifest V3, version ${VERSION}, no inline or remote scripts, zip made`);

  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(require('os').tmpdir(), 'cm-ext-')), {
    headless: true,
    channel: 'chromium',
    viewport: { width: 1200, height: 800 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  const errs = [];
  const watch = (p, who) => {
    p.on('pageerror', (e) => errs.push(`${who}: ${e.message}`));
    p.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errs.push(`${who}: ${m.text()}`));
  };
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const id = sw.url().split('/')[2];
  const base = `chrome-extension://${id}`;
  const appPage = async () => {
    for (let i = 0; i < 50; i++) {
      const p = ctx.pages().find((x) => x.url().startsWith(`${base}/app.html`));
      if (p) return p;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('no Checkmate tab');
  };
  // the task panel's title is an editable field
  const detailHas = (p, title) =>
    p.$eval('.modal.detail', (m, t) => [...m.querySelectorAll('input, textarea, [contenteditable]')].some((e) => (e.value || e.textContent || '').includes(t)) || m.innerText.includes(t), title);
  const db = (p) => p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('tickwise.db.v1') || '{}')));

  // installing opens the app
  let app = await appPage();
  watch(app, 'app');
  await app.waitForSelector('.app');
  assert.strictEqual(await app.getAttribute('.app', 'data-platform'), 'extension');
  await app.click('.sb-foot .nav-item');
  await app.click('.settings-tabs button[data-tab="about"]');
  assert((await app.innerText('.about-panel')).includes(`Version ${VERSION} · browser extension`), 'About');
  await app.click('.settings-tabs button[data-tab="theme"]');
  const iconSwitch = await app.innerText('.settings-panel');
  assert(iconSwitch.includes('Change the app icon with the style') && iconSwitch.includes('toolbar changes straight away'), 'the toolbar icon follows the style');
  await app.keyboard.press('Escape');
  await app.screenshot({ path: path.join(OUT, 'ext-app.png') });
  pass('installing opens Checkmate in a tab; About says browser extension');

  // the popup, with the app open: changes go through the app
  const popup = async () => {
    const p = await ctx.newPage();
    watch(p, 'popup');
    await p.setViewportSize({ width: 360, height: 560 });
    await p.goto(`${base}/popup.html`);
    await p.waitForSelector('.pop');
    return p;
  };
  let pop = await popup();
  const before = await pop.$$eval('.tasks li', (l) => l.length);
  assert(before >= 1, 'today list');
  await pop.fill('.add input', 'Buy milk tomorrow 9am p1 #Errands @shop');
  const chips = await pop.$$eval('.chip', (c) => c.map((x) => x.textContent));
  assert(chips.some((c) => /Tomorrow/.test(c)) && chips.includes('Priority 1') && chips.some((c) => c.startsWith('#Errands')) && chips.includes('@shop'), `chips: ${chips}`);
  await pop.screenshot({ path: path.join(OUT, 'ext-popup-typing.png') });
  await pop.press('.add input', 'Enter');
  await pop.waitForSelector('footer .note');
  assert((await pop.innerText('footer')).includes('Added to Errands'));
  let milk = (await db(app)).find((t) => t.type === 'task' && t.title === 'Buy milk 9am');
  assert(milk && milk.priority === 1 && milk.due && milk.due.time === '09:00', `task made in the app: ${JSON.stringify(milk)}`);
  assert((await db(app)).some((x) => x.type === 'project' && x.name === 'Errands'), 'new project');
  await app.waitForSelector(`text=Errands`);
  const first = await pop.textContent('.tasks li .t');
  await pop.click('.tasks li .check');
  await pop.waitForFunction((n) => document.querySelectorAll('.tasks li').length === n - 1, before);
  assert((await pop.innerText('footer')).includes('Completed'));
  assert((await db(app)).find((t) => t.title === first).done, 'completed in the app');
  await pop.click('footer .link');
  await pop.waitForFunction((n) => document.querySelectorAll('.tasks li').length === n, before);
  assert(!(await db(app)).find((t) => t.title === first).done, 'undone');
  await pop.screenshot({ path: path.join(OUT, 'ext-popup.png') });
  await pop.close();
  pass('popup: quick add with dates, priority, #project and @label; complete and undo, through the open tab');

  // reminders: the app hands them to the service worker, which sets alarms
  await sw.evaluate(() => new Promise((r) => setTimeout(r, 2500)));
  const alarms = await sw.evaluate(async () => (await chrome.alarms.getAll()).map((a) => a.name));
  assert(alarms.some((n) => n.startsWith(`r|${milk.id}|`)), `alarm for the task: ${alarms}`);
  pass('reminders become alarms in the service worker');

  // a reminder or popup row asks the service worker to open its task
  pop = await popup();
  await pop.evaluate((tid) => chrome.runtime.sendMessage({ type: 'checkmate:open', taskId: tid }), milk.id).catch(() => {});
  await app.waitForSelector('.modal.detail');
  assert(await detailHas(app, 'Buy milk'), 'the task opens');
  await app.keyboard.press('Escape');
  pass('opening a task from outside shows it in the Checkmate tab');

  // with no Checkmate tab, the popup saves by itself; the app finds it later (and will sync it)
  await app.close();
  pop = await popup();
  await pop.fill('.add input', 'Water plants today p2');
  await pop.press('.add input', 'Enter');
  await pop.waitForSelector('footer .note');
  assert(await pop.$('text=Water plants'), 'shown in Today');
  const saved = (await db(pop)).find((t) => t.title === 'Water plants');
  assert(saved && saved.priority === 2, 'saved by the popup');
  assert((await pop.evaluate(() => JSON.parse(localStorage.getItem('tickwise.dirty.v1')))).includes(saved.id), 'queued for sync');
  // a row opens the app on that task
  await pop.click('.tasks li .title >> text=Water plants');
  app = await appPage();
  watch(app, 'app');
  await app.waitForSelector('.modal.detail');
  assert(await detailHas(app, 'Water plants'), 'the task opens');
  assert(!app.url().includes('?task='), 'the address is tidied');
  pass('with no tab open the popup saves by itself, and a row opens Checkmate on that task');

  // the popup follows the style and the language
  await app.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('tickwise.prefs.v1'));
    localStorage.setItem('tickwise.prefs.v1', JSON.stringify({ ...p, skin: 'riot', language: 'zh-Hant' }));
  });
  pop = await popup();
  assert.strictEqual(await pop.getAttribute('html', 'data-skin'), 'riot');
  assert((await pop.innerText('.pop')).includes('開啟 Checkmate'), 'Chinese');
  assert.strictEqual(await pop.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(11, 10, 10)');
  await pop.screenshot({ path: path.join(OUT, 'ext-popup-riot-zh.png') });
  pass('the popup follows the style and the language');

  assert.deepStrictEqual(errs, [], 'no page errors');
  pass('no page errors');
  await ctx.close();
  console.log('extension: all checks passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
