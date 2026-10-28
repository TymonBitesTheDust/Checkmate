// The start screen (起始畫面): shown in every style with that style's icon, gone once the app
// is up, off when Settings → Theme → Start screen is off, quick with reduced motion, and never
// in the way of clicks. (Browser tests normally skip it; window.__cmSplash asks for it.)
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const url = 'file://' + path.resolve(__dirname, '../web/dist/Checkmate.html');
const OUT = process.argv[2] || '/tmp/shots';
fs.mkdirSync(OUT, { recursive: true });
const pass = (m) => console.log('  ✓ ' + m);

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const open = async (prefs, { splash = true, width = 1100 } = {}) => {
    const p = await b.newPage({ viewport: { width, height: 720 } });
    p.on('pageerror', (e) => errs.push(e.message));
    await p.addInitScript(([pr, sp]) => {
      if (sp) window.__cmSplash = true;
      if (!sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('tickwise.prefs.v1', JSON.stringify(pr));
      }
    }, [prefs, splash]);
    await p.goto(url, { waitUntil: 'commit' });
    return p;
  };
  const state = (p) =>
    p.evaluate(() => {
      const el = document.getElementById('splash');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { on: el.classList.contains('on'), full: r.width === innerWidth && r.height === innerHeight, svg: el.querySelector('.sp-icon svg')?.outerHTML || '', pe: getComputedStyle(el).pointerEvents };
    });

  for (const [skin, theme, mark] of [
    ['tickwise', 'light', '#f46b25'],
    ['tickwise', 'dark', '#f46b25'],
    ['riot', 'dark', '#e5191c'],
    ['tide', 'dark', 'sptide'],
    ['archive', 'light', '#d1cdb7'],
    ['frontier', 'light', 'spfrontier'],
    ['neon', 'dark', ''],
  ]) {
    const p = await open({ skin, theme, motion: 'full' });
    await p.waitForSelector('#splash.on .sp-icon svg');
    const s = await state(p);
    assert(s && s.on && s.full, `${skin}: splash covers the window`);
    assert.strictEqual(s.pe, 'none', 'clicks pass through');
    if (mark) assert(s.svg.includes(mark), `${skin}: its own icon (${mark})`);
    await p.waitForTimeout(450);
    await p.screenshot({ path: path.join(OUT, `splash-${skin}-${theme}.png`) });
    await p.waitForSelector('.app');
    await p.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 4000 });
    await p.close();
  }
  pass('every style shows its own start screen, and it goes once the app is up');

  // a custom theme colour colours the Checkmate icon
  {
    const p = await open({ accent: 'ocean', motion: 'full' });
    await p.waitForSelector('#splash.on .sp-icon svg');
    const s = await state(p);
    assert(s.svg.includes('#2f6fd6') && !s.svg.includes('#f46b25'), 'theme colour');
    await p.close();
  }
  pass('the Checkmate icon takes the theme colour');

  // reduced motion: no animation and a short stay
  {
    const p = await open({ motion: 'reduced' });
    await p.waitForSelector('.app');
    const anim = await p.evaluate(() => {
      const i = document.querySelector('#splash .sp-icon');
      return i ? getComputedStyle(i).animationName : 'gone';
    });
    assert(anim === 'none' || anim === 'gone', `no animation (${anim})`);
    const t0 = Date.now();
    await p.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 3000 });
    assert(Date.now() - t0 < 2000, 'gone quickly');
    await p.close();
  }
  pass('reduced motion keeps it still and short');

  // Settings → Theme → Start screen
  {
    const p = await open({ motion: 'full' }, { splash: false });
    await p.waitForSelector('.view-title');
    assert.strictEqual(await state(p), null, 'browser tests skip it by default');
    await p.click('.sb-foot .nav-item');
    await p.click('.settings-tabs button[data-tab="theme"]');
    const sw = p.locator('.field', { hasText: 'Start screen' });
    await sw.waitFor();
    assert((await sw.innerText()).includes('Checkmate name'), 'hint');
    await sw.locator('[role="switch"], input[type="checkbox"]').first().click();
    assert.strictEqual(await p.evaluate(() => JSON.parse(localStorage.getItem('tickwise.prefs.v1')).splash), false, 'saved off');
    await p.evaluate(() => (window.__cmSplash = true));
    await p.addInitScript(() => (window.__cmSplash = true));
    await p.reload({ waitUntil: 'commit' });
    await p.waitForSelector('.app');
    assert.strictEqual(await state(p), null, 'off means no start screen');
    await p.close();
  }
  pass('Settings → Theme → Start screen turns it off');

  // Chinese and phone width
  {
    const p = await open({ language: 'zh-Hant', skin: 'riot', motion: 'full' }, { width: 390 });
    await p.waitForSelector('#splash.on .sp-icon svg');
    await p.waitForTimeout(450);
    const box = await p.evaluate(() => {
      const r = document.querySelector('#splash .sp-name').getBoundingClientRect();
      return { left: r.left, right: r.right };
    });
    assert(box.left >= 0 && box.right <= 390, 'the name fits a phone');
    await p.screenshot({ path: path.join(OUT, 'splash-riot-phone.png') });
    await p.waitForSelector('.app');
    await p.close();
  }
  pass('fits at phone width');

  assert.deepStrictEqual(errs, [], 'no page errors');
  pass('no page errors');
  await b.close();
  console.log('splash: all checks passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
