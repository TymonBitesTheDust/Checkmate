const { chromium } = require('/opt/node-tools/node_modules/playwright');
const path = require('path');
const assert = require('assert');
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
  await p.click('.sb-foot .nav-item');
  await p.click('.settings-tabs button[data-tab="theme"]');
  await p.waitForSelector('.accent-picker');
  await p.click('.accent-dot[aria-label="Ocean"]');
  await p.waitForTimeout(150);
  const acc = () => p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  assert.strictEqual(await acc(), '#2f6fd6');
  await p.screenshot({ path: `${OUT}/a1-settings-ocean.png` });
  // custom colour via the hex box
  await p.fill('.hex-input', '#c548a3');
  await p.press('.hex-input', 'Enter');
  await p.waitForTimeout(150);
  console.log('custom light accent', await acc());
  assert.strictEqual(await p.textContent('.accent-name'), 'Custom colour');
  // invalid code shows an error and keeps the colour
  await p.fill('.hex-input', 'blue');
  await p.press('.hex-input', 'Enter');
  assert(await p.isVisible('.accent-picker .form-error'));
  await p.keyboard.press('Escape');
  await p.waitForTimeout(150);
  await p.keyboard.press('q');
  await p.keyboard.type('Plan trip friday p2');
  await p.screenshot({ path: `${OUT}/a2-quickadd-custom.png` });
  await p.keyboard.press('Escape');
  // persists across reload, applied before the app renders
  await p.reload();
  const early = await p.evaluate(() => document.documentElement.style.getPropertyValue('--accent'));
  console.log('after reload', early);
  assert(early);
  // dark mode adapts the same colour
  await p.emulateMedia({ colorScheme: 'dark' });
  await p.waitForTimeout(200);
  console.log('custom dark accent', await acc());
  await p.screenshot({ path: `${OUT}/a3-dark-custom.png` });
  // reset to the default (Checkmate orange) removes inline overrides
  await p.click('.sb-foot .nav-item');
  await p.click('.settings-tabs button[data-tab="theme"]');
  await p.click('button:has-text("Reset to Checkmate orange")');
  await p.waitForTimeout(100);
  assert.strictEqual(await p.evaluate(() => document.documentElement.style.getPropertyValue('--accent')), '');
  assert.strictEqual(await acc(), '#f46b25');
  console.log(errs.length ? 'ERRORS ' + errs.join('\n') : 'no page errors');
  await b.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
