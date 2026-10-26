// The Persona 5 style, now the Calling Card design from Checkmate P5: picking it in Settings → Theme,
// its pieces, the Animations and star field settings, and screenshots.
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const path = require('path');
const assert = require('assert');
const OUT = process.argv[2];
const url = 'file://' + path.resolve(__dirname, '../web/dist/Checkmate.html');
const pass = (m) => console.log('  ✓ ' + m);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 820 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => { if (!localStorage.getItem('tickwise.prefs.v1')) localStorage.setItem('tickwise.prefs.v1', JSON.stringify({ language: 'en', dateOrder: 'dmy' })); });
  await p.goto(url);
  await p.waitForSelector('.view-title');
  const add = async (t) => { await p.keyboard.press('q'); await p.waitForSelector('.modal.quick .editor-title'); await p.keyboard.type(t); await p.keyboard.press('Enter'); await p.waitForTimeout(80); };
  for (const t of ['Calibrate the pod today 9am p1 #Fieldwork', 'Restock supplies today p2 @errand', 'Back up the archive every friday #Fieldwork', 'Write report tomorrow p3 #Fieldwork', 'Water the garden today', 'Review notes yesterday']) await add(t);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);

  // Settings → Theme in the Checkmate style: light/dark, no animation settings
  await p.click('.sb-foot .nav-item');
  await p.click('.settings-tabs button[data-tab="theme"]');
  await p.waitForSelector('.skin-card');
  let theme = await p.innerText('.theme-panel');
  assert(/Light/.test(theme) && !/Animations/i.test(theme) && !/star field/i.test(theme), 'Checkmate keeps light/dark and has no animation settings');
  assert(!(await p.$('canvas.starfield')), 'no stars in Checkmate');
  // pick Persona 5
  await p.click('.skin-card:has-text("Persona 5")');
  await p.waitForTimeout(300);
  theme = await p.innerText('.theme-panel');
  for (const has of ['Animations', 'Match device', 'Full', 'Reduced', 'Reduced turns off the screen shake, the page wipe and the moving stars.', 'Show the star field']) assert(theme.toLowerCase().includes(has.toLowerCase()), `Persona 5 Theme has ${has}`);
  assert(!/\bRed\b.*\bBlack\b/.test(theme), 'no light/dark choice for Persona 5 (always dark)');
  await p.screenshot({ path: `${OUT}/riot-0-theme.png` });
  pass('Settings → Theme: picking Persona 5 swaps light/dark for Animations and the star field switch');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(500);
  const logo = await p.$eval('.logo', (e) => e.innerHTML);
  assert(/#e5191c/i.test(logo) && /#0b0a0a/i.test(logo), 'the new Persona 5 logo: red star with a white tick on black');
  pass('the new Persona 5 logo');

  const look = await p.evaluate(() => ({
    skin: document.documentElement.dataset.skin,
    theme: document.documentElement.dataset.theme,
    bg: getComputedStyle(document.body).backgroundColor,
    stars: !!document.querySelector('canvas.starfield'),
    title: !!document.querySelector('.view-title .ransom .r-ch'),
    menu: [...document.querySelectorAll('.sidebar .nav > .nav-item.cut')].length,
    date: (document.querySelector('.datebox .db-date') || {}).textContent,
    hero: (document.querySelector('.hero-count b') || {}).textContent,
    font: getComputedStyle(document.querySelector('.task-title')).fontFamily,
  }));
  assert.strictEqual(look.skin, 'riot');
  assert.strictEqual(look.theme, 'dark');
  assert.strictEqual(look.bg, 'rgb(75, 0, 7)', 'blood-red page');
  assert(look.stars, 'star field');
  assert(look.title, 'cut-out title');
  assert(look.menu >= 8, 'menu words are cut out');
  const d = new Date();
  assert.strictEqual(look.date, `${d.getDate()}/${d.getMonth() + 1}`, 'date box shows today (day/month)');
  assert(Number(look.hero) >= 4, `today's count in the menu (${look.hero})`);
  assert(/Arsenal/.test(look.font), 'Arsenal for text');
  pass('blood red, star field, cut-out title and menu, date box and today’s count');

  // the active menu item gets the red and cyan shards
  assert(await p.isVisible('.sidebar .nav-item.on .hl'), 'shards behind the active page');
  await p.hover('.sidebar a.nav-item:has-text("Upcoming")');
  assert(await p.isVisible('.sidebar a.nav-item:has-text("Upcoming") .hl'), 'and behind the hovered one');
  await p.hover('.task-row:has-text("Restock")');
  assert(await p.isVisible('.task-row:has-text("Restock") .hl'), 'and behind a hovered task');
  await p.screenshot({ path: `${OUT}/riot-1-today.png` });
  pass('the red and cyan highlight follows the pointer');

  // finishing a task: slash and stamp
  await p.click('.task-row:has-text("Water the garden") .check');
  await p.waitForTimeout(200);
  assert(await p.isVisible('.task-row.completing .stamp .ransom'), 'stamp');
  assert.strictEqual((await p.textContent('.task-row.completing .stamp .ransom')).toLowerCase(), 'clear!', 'it says Clear!');
  await p.screenshot({ path: `${OUT}/riot-2-clear.png` });
  await p.waitForTimeout(800);
  assert(!(await p.isVisible('.task-row:has-text("Water the garden")')), 'gone once cleared');
  pass('a finished task is slashed and stamped');

  // changing page: wipe and shake
  await p.click('.sidebar a.nav-item:has-text("Upcoming")');
  await p.waitForTimeout(120);
  assert(await p.isVisible('.riot-wipe'), 'wipe');
  assert(await p.evaluate(() => document.querySelector('.app').classList.contains('shake')), 'shake');
  await p.screenshot({ path: `${OUT}/riot-3-wipe.png` });
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${OUT}/riot-4-upcoming.png` });
  pass('changing page sweeps a wipe across and shakes the screen');

  // menus, detail, board, quick add
  await p.click('a.nav-item:has-text("Fieldwork")');
  await p.waitForTimeout(500);
  await p.click('.task-row:has-text("Calibrate") button[aria-label="Task actions"]');
  await p.waitForTimeout(150);
  assert.strictEqual(await p.evaluate(() => getComputedStyle(document.querySelector('.popover')).backgroundColor), 'rgb(11, 10, 10)', 'black menus');
  await p.screenshot({ path: `${OUT}/riot-5-menu.png` });
  await p.keyboard.press('Escape');
  await p.click('.task-row .task-title');
  await p.waitForTimeout(300);
  assert.strictEqual(await p.evaluate(() => getComputedStyle(document.querySelector('.modal')).backgroundColor), 'rgb(255, 255, 255)', 'white paper dialogs');
  assert.strictEqual(await p.evaluate(() => getComputedStyle(document.querySelector('.detail-head')).backgroundColor), 'rgb(11, 10, 10)', 'with a black band');
  await p.screenshot({ path: `${OUT}/riot-6-detail.png` });
  await p.keyboard.press('Escape');
  await p.click('button[aria-label="Board layout"]');
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/riot-7-board.png` });
  await p.click('button[aria-label="List layout"]');
  await p.keyboard.press('q');
  await p.keyboard.type('Scout the ruins next week p2');
  await p.screenshot({ path: `${OUT}/riot-8-quick.png` });
  await p.keyboard.press('Escape');
  pass('black menus, white paper dialogs with a black band');

  // Settings → Theme: reduced motion stops the wipe; the star field can be turned off
  await p.click('.sb-foot .nav-item');
  await p.click('.settings-tabs button[data-tab="theme"]');
  await p.waitForSelector('.skin-card');
  await p.click('.theme-panel .seg button:has-text("Reduced")');
  await p.click('.switch-row:has-text("Show the star field") input');
  await p.waitForTimeout(150);
  assert.strictEqual(await p.evaluate(() => document.documentElement.dataset.motion), 'reduced');
  assert(!(await p.$('canvas.starfield')), 'star field off');
  await p.screenshot({ path: `${OUT}/riot-9-theme.png` });
  await p.keyboard.press('Escape');
  await p.click('.sidebar a.nav-item:has-text("Inbox")');
  await p.waitForTimeout(80);
  assert(!(await p.$('.riot-wipe')), 'no wipe with reduced motion');
  const prefs = await p.evaluate(() => JSON.parse(localStorage.getItem('tickwise.prefs.v1')));
  assert.strictEqual(prefs.motion, 'reduced');
  assert.strictEqual(prefs.stars, false);
  pass('Settings → Theme: Reduced motion and the star field switch');

  // switching to another style puts its light/dark back and takes the stars away
  await p.click('.sb-foot .nav-item');
  await p.click('.settings-tabs button[data-tab="theme"]');
  await p.click('.skin-card:has-text("Persona 3")');
  await p.waitForTimeout(300);
  assert(!/Animations/i.test(await p.innerText('.theme-panel')), 'Persona 3 has no animation settings');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  assert.strictEqual(await p.evaluate(() => document.documentElement.dataset.skin), 'tide');
  assert(!(await p.$('.datebox')) && !(await p.$('.hero-count')) && !(await p.$('.task-row .hl')), 'no Persona 5 pieces in Persona 3');
  await p.evaluate(() => { const k = 'tickwise.prefs.v1'; const v = JSON.parse(localStorage.getItem(k)); v.skin = 'riot'; v.motion = 'system'; v.stars = true; localStorage.setItem(k, JSON.stringify(v)); });
  pass('other styles keep their own look');

  // phone: the menu is a drawer of cut-out words
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await m.addInitScript(() => localStorage.setItem('tickwise.prefs.v1', JSON.stringify({ language: 'en', skin: 'riot' })));
  const mp = await m.newPage();
  mp.on('pageerror', (e) => errs.push('phone ' + e.message));
  await mp.goto(url);
  await mp.waitForSelector('.view-title');
  await mp.waitForTimeout(500);
  assert(await mp.isVisible('.riot-date'), 'the date shows in Today on phones');
  await mp.screenshot({ path: `${OUT}/riot-10-m-today.png` });
  await mp.click('.topbar .icon-btn');
  await mp.waitForTimeout(400);
  assert(await mp.isVisible('.sidebar .datebox'), 'date box in the drawer');
  await mp.screenshot({ path: `${OUT}/riot-11-m-drawer.png` });
  pass('phone: date in Today, drawer with the date box');

  console.log(errs.length ? 'ERRORS ' + errs.join('\n') : 'no page errors');
  if (errs.length) process.exit(1);
  await b.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
