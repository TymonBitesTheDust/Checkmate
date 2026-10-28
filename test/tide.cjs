const { chromium } = require('/opt/node-tools/node_modules/playwright');
const path = require('path');
const OUT = process.argv[2];
const url = 'file://' + path.resolve(__dirname, '../web/dist/Checkmate.html');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 820 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url);
  await p.waitForSelector('.view-title');
  const add = async (t) => { await p.keyboard.press('q'); await p.waitForSelector('.modal.quick .editor-title'); await p.keyboard.type(t); await p.keyboard.press('Enter'); await p.waitForTimeout(80); };
  for (const t of ['Calibrate the pod today 9am p1 #Fieldwork', 'Restock supplies today p2 @errand', 'Back up the archive every friday #Fieldwork', 'Write report tomorrow p3 #Fieldwork', 'Water the garden today', 'Review notes yesterday']) await add(t);
  await p.click('.sb-foot .nav-item');
  await p.click('.settings-tabs button[data-tab="theme"]');
  await p.waitForSelector('.skin-card');
  await p.click('.skin-card:has-text("Tide")');
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/tide-1-settings.png` });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(600);
  await p.hover('.task-row:has-text("Restock")');
  await p.waitForTimeout(250);
  await p.screenshot({ path: `${OUT}/tide-2-today.png` });
  await p.click('.task-row:has-text("Water the garden") .check');
  await p.waitForTimeout(200);
  await p.screenshot({ path: `${OUT}/tide-2b-clear.png` });
  await p.waitForTimeout(700);
  await p.click('.task-row:has-text("Restock") button[aria-label="Task actions"]');
  await p.waitForTimeout(150);
  await p.screenshot({ path: `${OUT}/tide-3-menu.png` });
  await p.keyboard.press('Escape');
  await p.goto(url + '#/upcoming');
  await p.waitForTimeout(140);
  await p.screenshot({ path: `${OUT}/tide-4a-wipe.png` });
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${OUT}/tide-4-upcoming.png` });
  await p.click('a.nav-item:has-text("Fieldwork")');
  await p.waitForTimeout(500);
  await p.click('.task-row .task-title');
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/tide-5-detail.png` });
  await p.keyboard.press('Escape');
  await p.click('button[aria-label="Board layout"]');
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/tide-6-board.png` });
  await p.click('button[aria-label="List layout"]');
  await p.keyboard.press('q');
  await p.keyboard.type('Scout the ruins next week p2');
  await p.screenshot({ path: `${OUT}/tide-7-quick.png` });
  await p.keyboard.press('Escape');
  await p.goto(url + '#/productivity');
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${OUT}/tide-7b-prod.png` });
  await p.emulateMedia({ colorScheme: 'dark' });
  await p.goto(url + '#/today');
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${OUT}/tide-8-ink.png` });
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const mp = await m.newPage();
  await mp.goto(url);
  await mp.evaluate(() => localStorage.setItem('tickwise.prefs.v1', JSON.stringify({ skin: "tide", theme: "light" })));
  await mp.reload();
  await mp.waitForTimeout(600);
  await mp.screenshot({ path: `${OUT}/tide-9-m-today.png` });
  await mp.click('.topbar .icon-btn');
  await mp.waitForTimeout(400);
  await mp.screenshot({ path: `${OUT}/tide-10-m-drawer.png` });

  // the page name on the ribbon fits the window, even a long one, in English and Chinese,
  // and the page you're on reads white on the red cursor
  const assert = require('assert');
  for (const [lang, w, h] of [['en', 1400, 900], ['en', 1366, 680], ['zh-Hant', 1366, 680]]) {
    const c = await b.newContext({ viewport: { width: w, height: h } });
    await c.addInitScript((lang) => localStorage.setItem('tickwise.prefs.v1', JSON.stringify({ language: lang, skin: 'tide' })), lang);
    const rp = await c.newPage();
    rp.on('pageerror', (e) => errs.push('ribbon ' + e.message));
    await rp.goto(url);
    await rp.waitForSelector('.view-title');
    for (const v of ['productivity', 'filters', 'completed', 'today']) {
      await rp.evaluate((v) => (location.hash = '#/' + v), v);
      await rp.waitForTimeout(500);
      const r = await rp.evaluate(() => {
        const g = document.querySelector('.ghost-title');
        const on = document.querySelector('.nav > .nav-item.on');
        return { text: g.textContent, sh: g.scrollHeight, ch: g.clientHeight, color: on && getComputedStyle(on).color };
      });
      // the name runs down the window; it must not run past it (italic letters may lean a little over the side)
      assert(r.sh <= r.ch + 1, `${lang} ${w}x${h} ${v}: “${r.text}” is cut off ${JSON.stringify(r)}`);
      assert.strictEqual(r.color, 'rgb(255, 255, 255)', `${v}: the page you're on is white`);
    }
    await rp.screenshot({ path: `${OUT}/tide-11-ribbon-${lang}-${h}.png` });
    await c.close();
  }
  console.log('  ✓ the ribbon fits long page names (English and Chinese) and the current page is white');
  console.log(errs.length ? 'ERRORS ' + errs.join('\n') : 'no page errors');
  await b.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
