// Checks every sound in every style renders at a sensible level, and that the UI triggers them.
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const path = require('path');
const assert = require('assert');
const url = 'file://' + path.resolve(__dirname, '../web/dist/Checkmate.html');
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await (await b.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => { window.__tickwiseSoundLog = []; });
  await p.goto(url);
  await p.waitForSelector('.view-title');
  const events = ['hover', 'select', 'pop', 'open', 'close', 'nav', 'complete', 'uncomplete', 'add', 'delete', 'drop', 'error', 'reminder', 'goal'];
  const table = await p.evaluate(async (events) => {
    const out = {};
    for (const skin of ['tickwise', 'archive', 'riot', 'tide', 'frontier', 'neon']) {
      out[skin] = {};
      for (const ev of events) out[skin][ev] = await window.__tickwiseMeasure(skin, ev);
    }
    return out;
  }, events);
  console.log('peak level per sound (0-1), length in seconds');
  console.log('event'.padEnd(11) + ['tickwise', 'archive', 'riot', 'tide', 'frontier', 'neon'].map((s) => s.padStart(13)).join(''));
  for (const ev of events) {
    console.log(ev.padEnd(11) + ['tickwise', 'archive', 'riot', 'tide', 'frontier', 'neon'].map((s) => `${table[s][ev].peak.toFixed(2)} ${table[s][ev].length.toFixed(2)}s`.padStart(13)).join(''));
    for (const s of Object.keys(table)) {
      const m = table[s][ev];
      assert(m.peak > 0.01, `${s}/${ev} is silent`);
      assert(m.peak < 0.98, `${s}/${ev} clips (${m.peak})`);
    }
  }
  // UI triggers
  const log = () => p.evaluate(() => window.__tickwiseSoundLog.splice(0).map((x) => x.join(':')));
  await log();
  await p.keyboard.press('q');
  await p.waitForSelector('.modal.quick .editor-title');
  await p.keyboard.type('Sound test tomorrow');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(300);
  console.log('quick add  ->', (await log()).join(' '));
  await p.click('a.nav-item:has-text("Upcoming")');
  await p.waitForTimeout(300);
  console.log('navigate   ->', (await log()).join(' '));
  await p.hover('.task-row:has-text("Sound test")');
  await p.mouse.move(600, 20);
  await p.hover('a.nav-item:has-text("Inbox")');
  await p.waitForTimeout(200);
  console.log('hover      ->', (await log()).join(' '));
  await p.click('.task-row:has-text("Sound test") .check');
  await p.waitForTimeout(700);
  console.log('complete   ->', (await log()).join(' '));
  await p.click('.toast:has-text("Task completed") .toast-undo');
  await p.waitForTimeout(200);
  console.log('undo       ->', (await log()).join(' '));
  await p.click('.task-row:has-text("Sound test") button[aria-label="Task actions"]');
  await p.waitForTimeout(150);
  await p.click('.menu-item:has-text("Delete task")');
  await p.waitForTimeout(300);
  console.log('delete     ->', (await log()).join(' '));
  // settings: switch style, change level, try buttons
  await p.click('.sb-foot .nav-item');
  await p.click('.settings-tabs button[data-tab="theme"]');
  await p.waitForSelector('.skin-card');
  await p.click('.skin-card:has-text("Riot")');
  await p.waitForTimeout(150);
  await p.click('.settings-tabs button[data-tab="general"]');
  await p.waitForSelector('.sound-tests');
  await p.click('.sound-tests button:has-text("Daily goal")');
  await p.waitForTimeout(150);
  console.log('settings   ->', (await log()).join(' '));
  await p.click('.seg button:has-text("Off")');
  await p.waitForTimeout(100);
  await log();
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  await p.click('a.nav-item:has-text("Today")');
  await p.waitForTimeout(200);
  const silent = await log();
  console.log('sound off  ->', silent.join(' ') || '(nothing)');
  assert.strictEqual(silent.length, 0);
  console.log(errs.length ? 'ERRORS ' + errs.join('\n') : 'no page errors');
  await b.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
