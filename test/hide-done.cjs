// 3.0.1: Settings → General → Hide completed tasks and Hide completed subtasks.
// A project set to show completed tasks, a task with finished and open subtasks (one of them
// with only finished subtasks of its own), checked in the task panel and the project list
// and board, in English and Chinese, on desktop and phone.
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const http = require('http');
const appServer = http.createServer((q, s) => {
  fs.readFile(path.resolve(__dirname, '../web/dist/Checkmate.html'), (e, d) => {
    if (e) return s.writeHead(404), s.end();
    s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    s.end(d);
  });
});
const OUT = process.argv[2] || '/tmp/shots';
fs.mkdirSync(OUT, { recursive: true });
const pass = (m) => console.log('  ✓ ' + m);

const task = (id, title, extra) => ({
  id, type: 'task', title, desc: '', projectId: 'p-it', sectionId: null, parentId: null, priority: 4,
  labels: [], done: false, createdAt: 1, updatedAt: 1, ...extra,
});
const DB = {
  'p-it': { id: 'p-it', type: 'project', name: 'IT Project', color: 'pine', view: 'list', order: 1, showCompleted: true, createdAt: 1, updatedAt: 1 },
  app: task('app', 'Developing App', { order: 1 }),
  bug: task('bug', 'Bug', { parentId: 'app', order: 1 }),
  b1: task('b1', 'Arrow overlaps', { parentId: 'bug', order: 1, done: true, doneAt: 2 }),
  b2: task('b2', 'Mobile add issue', { parentId: 'bug', order: 2, done: true, doneAt: 2 }),
  feat: task('feat', 'Add features', { parentId: 'app', order: 2 }),
  f1: task('f1', 'Upload photo task', { parentId: 'feat', order: 1, done: true, doneAt: 2 }),
  f2: task('f2', 'Tasks for a period', { parentId: 'feat', order: 2 }),
  docs: task('docs', 'Write the guide', { parentId: 'app', order: 3, done: true, doneAt: 2 }),
  old: task('old', 'Shipped 3.0.0', { order: 2, done: true, doneAt: 2 }),
};

(async () => {
  await new Promise((r) => appServer.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${appServer.address().port}/Checkmate.html`;
  const b = await chromium.launch();
  const errs = [];
  async function open({ prefs = {}, width = 1280, height = 860 } = {}) {
    const ctx = await b.newContext({ viewport: { width, height }, isMobile: width < 500, hasTouch: width < 500 });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    await p.addInitScript(({ db, prefs }) => {
      if (localStorage.getItem('tickwise.db.v1')) return;
      localStorage.setItem('tickwise.db.v1', JSON.stringify(db));
      localStorage.setItem('tickwise.seeded', '1');
      localStorage.setItem('tickwise.prefs.v1', JSON.stringify(prefs));
    }, { db: DB, prefs });
    await p.goto(url + '#/project/p-it');
    await p.waitForSelector('.task-row');
    return p;
  }
  const titles = (p, scope) => p.$$eval(`${scope} .task-row .task-title`, (x) => x.map((e) => e.textContent));
  const rowOf = (p, scope, title) => p.locator(`${scope} .task-row`, { has: p.locator('.task-title', { hasText: new RegExp(`^${title}$`) }) });
  async function panel(p) {
    await rowOf(p, '.view', 'Developing App').locator('.task-title').click();
    await p.waitForSelector('.modal.detail .detail-section .task-list');
    const list = await titles(p, '.modal.detail .detail-section');
    const head = await p.locator('.modal.detail .detail-section h3', { hasText: 'Subtasks' }).innerText();
    await p.keyboard.press('Escape');
    await p.waitForSelector('.modal.detail', { state: 'detached' });
    return { list, head: head.replace(/\s+/g, ' ').trim() };
  }
  async function settings(p, check) {
    await p.click('.sb-foot .nav-item');
    await p.waitForSelector('.modal.settings');
    await check();
    await p.keyboard.press('Escape');
    await p.waitForSelector('.modal.settings', { state: 'detached' });
  }
  const sw = (p, label) => p.locator('.settings-panel .switch-row', { hasText: label }).locator('input.switch');
  async function menuLabels(p) {
    await p.click('.view-head [aria-label="Project actions"]');
    await p.waitForSelector('.menu-list');
    const l = await p.$$eval('.menu-list .menu-label', (x) => x.map((e) => e.textContent));
    await p.keyboard.press('Escape');
    return l;
  }
  const prefs = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('tickwise.prefs.v1')));

  // --- Both off: as before
  let p = await open();
  assert.deepStrictEqual(await titles(p, '.view'),
    ['Developing App', 'Bug', 'Arrow overlaps', 'Mobile add issue', 'Add features', 'Upload photo task', 'Tasks for a period', 'Write the guide', 'Shipped 3.0.0']);
  let pn = await panel(p);
  assert.deepStrictEqual(pn.list, ['Bug', 'Arrow overlaps', 'Mobile add issue', 'Add features', 'Upload photo task', 'Tasks for a period', 'Write the guide']);
  assert(/Subtasks 1\/3/.test(pn.head), pn.head);
  assert((await menuLabels(p)).includes('Hide completed tasks'));
  pass('both switches off: finished tasks and subtasks show as before');

  // --- The switches in General, under Keep the time in the task name
  await settings(p, async () => {
    const txt = await p.innerText('.settings-panel');
    const i = txt.indexOf('Keep the time in the task name'), j = txt.indexOf('Hide completed tasks'), k = txt.indexOf('Hide completed subtasks'), s = txt.indexOf('Sound effects');
    assert(i >= 0 && i < j && j < k && k < s, 'order: keep time, tasks, subtasks, sounds');
    assert(txt.includes('They stay on the Completed page.') && txt.includes('Counts such as 3/5 still include them.'));
    assert.strictEqual(await sw(p, 'Hide completed tasks').isChecked(), false);
    assert.strictEqual(await sw(p, 'Hide completed subtasks').isChecked(), false);
    await sw(p, 'Hide completed subtasks').click();
    await p.screenshot({ path: `${OUT}/hide-general.png` });
  });
  assert.strictEqual((await prefs(p)).hideDoneSubtasks, true);

  // --- Hide completed subtasks
  assert.deepStrictEqual(await titles(p, '.view'), ['Developing App', 'Bug', 'Add features', 'Tasks for a period', 'Shipped 3.0.0']);
  assert.strictEqual(await rowOf(p, '.view', 'Bug').locator('.twisty').count(), 0, 'Bug has nothing to expand');
  assert(/2\/2/.test(await rowOf(p, '.view', 'Bug').locator('.meta-sub').first().innerText()), 'Bug still counts 2/2');
  assert.strictEqual(await rowOf(p, '.view', 'Add features').locator('.twisty').count(), 1);
  pn = await panel(p);
  assert.deepStrictEqual(pn.list, ['Bug', 'Add features', 'Tasks for a period']);
  assert(/Subtasks 1\/3/.test(pn.head), 'the heading still counts every subtask: ' + pn.head);
  pass('Hide completed subtasks: gone from the panel and the list, counts unchanged, no empty arrow');

  // Ticking a subtask in the panel makes it leave
  await rowOf(p, '.view', 'Developing App').locator('.task-title').click();
  await p.waitForSelector('.modal.detail .detail-section .task-list');
  await rowOf(p, '.modal.detail .detail-section', 'Tasks for a period').locator('.check').click();
  await p.waitForTimeout(700);
  assert.deepStrictEqual(await titles(p, '.modal.detail .detail-section'), ['Bug', 'Add features']);
  await rowOf(p, '.modal.detail .detail-section', 'Add features').locator('.check').click();
  await p.waitForTimeout(700);
  assert.deepStrictEqual(await titles(p, '.modal.detail .detail-section'), ['Bug']);
  await p.keyboard.press('Escape');
  // ...and still opens on the Completed page
  await p.goto(url + '#/completed');
  await p.waitForSelector('.done-item');
  assert((await p.innerText('.done-list')).includes('Add features'));
  await p.goto(url + '#/project/p-it');
  await p.waitForSelector('.task-row');
  pass('ticked subtasks leave the panel straight away and stay on the Completed page');

  // --- Hide completed tasks too
  await settings(p, async () => { await sw(p, 'Hide completed tasks').click(); });
  assert.strictEqual((await prefs(p)).hideDoneTasks, true);
  assert.deepStrictEqual(await titles(p, '.view'), ['Developing App', 'Bug']);
  let menu = await menuLabels(p);
  assert(!menu.includes('Hide completed tasks') && !menu.includes('Show completed tasks'), 'the project switch goes');
  // Board view
  await p.click('.view-head [aria-label="Board layout"]');
  await p.waitForSelector('.board-col .task-row');
  assert.deepStrictEqual(await titles(p, '.board-col'), ['Developing App', 'Bug']);
  pass('Hide completed tasks: gone from the list and the board even though the project shows them');

  // --- Only Hide completed tasks: the panel shows finished subtasks again
  await settings(p, async () => { await sw(p, 'Hide completed subtasks').click(); });
  await p.click('.board-col .task-title:text-is("Developing App")');
  await p.waitForSelector('.modal.detail .detail-section .task-list');
  assert((await titles(p, '.modal.detail .detail-section')).includes('Write the guide'));
  await p.keyboard.press('Escape');
  await settings(p, async () => { await sw(p, 'Hide completed tasks').click(); });
  menu = await menuLabels(p);
  assert(menu.includes('Hide completed tasks'), 'the project switch is back');
  pass('the panel follows only the subtasks switch; turning both off restores everything');
  await p.context().close();

  // --- Chinese and phone, Persona 3
  p = await open({ prefs: { language: 'zh-Hant', skin: 'tide', hideDoneSubtasks: true }, width: 390, height: 844 });
  await rowOf(p, '.view', 'Developing App').locator('.task-title').click();
  await p.waitForSelector('.modal.detail .detail-section .task-list');
  assert.deepStrictEqual(await titles(p, '.modal.detail .detail-section'), ['Bug', 'Add features', 'Tasks for a period']);
  await p.screenshot({ path: `${OUT}/hide-tide-phone-panel.png` });
  await p.keyboard.press('Escape');
  await p.waitForSelector('.modal.detail', { state: 'detached' });
  await p.click('.topbar .icon-btn');
  await p.waitForTimeout(300);
  await p.click('.sb-foot .nav-item');
  await p.waitForSelector('.modal.settings');
  const zh = await p.innerText('.settings-panel');
  assert(zh.includes('隱藏已完成的任務') && zh.includes('隱藏已完成的子任務'), 'Chinese labels');
  assert(zh.includes('3/5 這類計數仍會把它們算在內'), 'Chinese hint');
  assert.strictEqual(await sw(p, '隱藏已完成的子任務').isChecked(), true);
  const sideways = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert(!sideways, 'no sideways scrolling on the phone');
  await p.locator('.switch-row', { hasText: '隱藏已完成的子任務' }).scrollIntoViewIfNeeded();
  await p.screenshot({ path: `${OUT}/hide-tide-phone-settings.png` });
  pass('Chinese labels and hints; phone layout');
  await p.context().close();

  assert.deepStrictEqual(errs, []);
  pass('no page errors');
  await b.close();
  appServer.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
