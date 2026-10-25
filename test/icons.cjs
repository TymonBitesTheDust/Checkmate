// Checks that the logo, tab icon, cursors and native icon calls follow the style.
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const path = require('path');
const assert = require('assert');
const OUT = process.argv[2];
const url = 'file://' + path.resolve(__dirname, '../web/dist/Checkmate.html');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1100, height: 700 } })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  // Pretend to be the Windows host and the Android bridge, recording calls.
  await p.addInitScript(() => {
    window.__calls = [];
    window.twSetIcon = (s, follow) => window.__calls.push(['win', s, follow]);
    window.TickwiseNative = { setLauncherIcon: (s) => window.__calls.push(['android', s]), setSystemBars() {}, scheduleReminders() {} };
  });
  await p.goto(url);
  await p.waitForSelector('.view-title');
  for (const skin of ['tickwise', 'archive', 'riot', 'tide', 'frontier', 'neon']) {
    await p.evaluate((s) => { const k = 'tickwise.prefs.v1'; const v = JSON.parse(localStorage.getItem(k) || '{}'); v.skin = s; localStorage.setItem(k, JSON.stringify(v)); }, skin);
    await p.reload();
    await p.waitForSelector('.view-title');
    await p.waitForTimeout(700);
    const r = await p.evaluate(() => {
      const cur = (el) => getComputedStyle(el).cursor.slice(0, 40);
      return {
        body: cur(document.body),
        button: cur(document.querySelector('.sb-add')),
        row: cur(document.querySelector('.task-row')),
        logo: document.querySelector('.logo').innerHTML.slice(0, 160),
        fav: decodeURIComponent(document.querySelector('link[rel="icon"]').href).slice(0, 140),
        calls: window.__calls.slice(-2),
      };
    });
    console.log(skin.padEnd(9), 'body:', r.body.slice(0, 28), '| button:', r.button.slice(0, 28), '| calls:', JSON.stringify(r.calls));
    if (skin === 'tickwise') assert(/auto|default/.test(r.body), 'system cursor for Checkmate');
    else assert(r.body.startsWith('url('), 'custom arrow');
    assert(r.calls.some(([k, s, f]) => k === 'win' && s === skin && f === true), 'windows icon, shortcuts and exe follow the style');
    assert(r.calls.some(([k, s]) => k === 'android' && s === skin), 'android home-screen icon follows the style by default');
    assert(r.fav.includes('<svg'), 'tab icon is an svg');
    await p.screenshot({ path: `${OUT}/icon-${skin}.png`, clip: { x: 0, y: 0, width: 290, height: 120 } });
  }
  // text fields keep the I-beam
  await p.keyboard.press('q');
  await p.waitForSelector('.modal.quick .editor-title');
  console.log('typing cursor:', await p.evaluate(() => getComputedStyle(document.querySelector('.editor-title')).cursor));
  await p.keyboard.press('Escape');
  // turning the setting off puts the default icon back outside the app (the window keeps the style)
  await p.click('.sb-foot .nav-item');
  await p.click('.settings-tabs button[data-tab="theme"]');
  await p.waitForSelector('.switch-row:has-text("Change the app icon with the style")');
  assert(await p.isChecked('.switch-row:has-text("Change the app icon with the style") input'), 'on by default');
  await p.click('.switch-row:has-text("Change the app icon with the style") input');
  await p.waitForTimeout(200);
  const lastA = await p.evaluate(() => window.__calls.filter((c) => c[0] === 'android').pop());
  const lastW = await p.evaluate(() => window.__calls.filter((c) => c[0] === 'win').pop());
  console.log('after turning it off:', JSON.stringify(lastA), JSON.stringify(lastW));
  assert.deepStrictEqual(lastA, ['android', 'tickwise']);
  assert.deepStrictEqual(lastW, ['win', 'neon', false]);
  await p.click('.switch-row:has-text("Change the app icon with the style") input');
  await p.waitForTimeout(200);
  assert.deepStrictEqual(await p.evaluate(() => window.__calls.filter((c) => c[0] === 'android').pop()), ['android', 'neon']);
  await p.screenshot({ path: `${OUT}/icon-setting.png` });
  console.log(errs.length ? 'ERRORS ' + errs.join('\n') : 'no page errors');
  await b.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
