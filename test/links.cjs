// Settings → General → Open links with, the "Ask every time" picker, and map links in an
// event's location. The Windows host is stood in for by window.chrome.webview and
// window.twOpenExternal, which records what it was asked to open.
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const url = 'file://' + path.resolve(__dirname, '../web/dist/Checkmate.html');
const OUT = process.argv[2] || '/tmp/shots';
fs.mkdirSync(OUT, { recursive: true });
const pass = (m) => console.log('  ✓ ' + m);
const NOW = new Date('2026-10-20T09:00:00+11:00').getTime();

async function open(b, host) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, timezoneId: 'Australia/Sydney', locale: 'en-AU' });
  const p = await ctx.newPage();
  await p.clock.install({ time: NOW });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript((host) => {
    if (!localStorage.getItem('tickwise.prefs.v1')) {
      localStorage.setItem('tickwise.seeded', '1');
      localStorage.setItem('tickwise.prefs.v1', JSON.stringify({ language: 'en', splash: false }));
    }
    window.__opened = [];
    window.open = (u) => void window.__opened.push([u, 'window.open']);
    if (host === 'windows') {
      window.chrome = window.chrome || {};
      window.chrome.webview = { postMessage() {}, addEventListener() {} };
      window.twOpenExternal = (u, b) => void window.__opened.push([u, b]);
    }
  }, host);
  await p.goto(url);
  await p.waitForSelector('.view-title');
  return { ctx, p, errs };
}

const opened = (p) => p.evaluate(() => window.__opened.splice(0));
const setPref = (p, v) => p.selectOption('.settings-panel select:near(:text("Open links with"))', v);

async function addTask(p, text) {
  await p.keyboard.press('q');
  await p.waitForSelector('.modal.quick .editor-title');
  await p.keyboard.type(text);
  await p.keyboard.press('Enter');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
}

(async () => {
  const b = await chromium.launch();

  // ------------------------------------------------------------------ Windows
  const { p, errs } = await open(b, 'windows');
  await p.click('.sb-foot .nav-item');
  await p.waitForSelector('.modal.settings');
  const general = await p.innerText('.settings-panel');
  assert(general.includes('Open links with'), 'the setting is in General on Windows');
  const choices = await p.$$eval('.settings-panel select:near(:text("Open links with")) option', (x) => x.map((o) => [o.value, o.textContent]));
  assert.deepStrictEqual(choices, [['default', 'Default browser'], ['chrome', 'Google Chrome'], ['edge', 'Microsoft Edge'], ['firefox', 'Firefox'], ['ask', 'Ask every time']]);
  await setPref(p, 'chrome');
  await p.locator('.settings-panel select:near(:text("Open links with"))').scrollIntoViewIfNeeded();
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/links-setting.png` });
  assert.strictEqual(await p.evaluate(() => JSON.parse(localStorage.getItem('tickwise.prefs.v1')).linkBrowser), 'chrome');
  pass('Settings → General → Open links with lists the browsers and remembers the choice');

  // a link in About follows the choice too
  await p.click('.settings-tabs button[data-tab="about"]');
  await p.click('.ab-link:has-text("tymon.website")');
  assert.deepStrictEqual(await opened(p), [['https://tymon.website/', 'chrome']]);
  pass('Settings → About links to tymon.website, opened in the chosen browser');
  await p.keyboard.press('Escape');
  await p.waitForSelector('.modal.settings', { state: 'detached' });

  // a link in a task's name
  await p.evaluate(() => (location.hash = '#/inbox'));
  await addTask(p, 'Read https://example.com/article?a=1');
  const link = p.locator('.task-row a[href="https://example.com/article?a=1"]').first();
  await link.click();
  assert.deepStrictEqual(await opened(p), [['https://example.com/article?a=1', 'chrome']]);
  pass('a link in a task opens in Google Chrome, not in a Checkmate window');

  // Ask every time: the picker, then the browser picked in it
  await p.click('.sb-foot .nav-item');
  await setPref(p, 'ask');
  await p.keyboard.press('Escape');
  await p.waitForSelector('.modal.settings', { state: 'detached' });
  await link.click();
  await p.waitForSelector('.link-picker');
  assert.match(await p.innerText('.link-picker'), /Open link with[\s\S]*example\.com\/article[\s\S]*Default browser[\s\S]*Google Chrome[\s\S]*Microsoft Edge[\s\S]*Firefox[\s\S]*Copy link/);
  assert.deepStrictEqual(await opened(p), []);
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/links-ask.png` });
  await p.click('.link-picker [data-browser="firefox"]');
  await p.waitForSelector('.link-picker', { state: 'detached' });
  assert.deepStrictEqual(await opened(p), [['https://example.com/article?a=1', 'firefox']]);
  await link.click();
  await p.click('.link-picker [data-browser="default"]');
  assert.deepStrictEqual(await opened(p), [['https://example.com/article?a=1', 'default']]);
  pass('Ask every time shows the browsers and opens the link in the one picked');

  // ------------------------------------------------------------- event locations
  await p.click('.sb-foot .nav-item');
  await setPref(p, 'default');
  await p.keyboard.press('Escape');
  const cases = [
    ['Sydney Opera House', 'https://www.google.com/maps/search/?api=1&query=Sydney%20Opera%20House'],
    ['https://maps.app.goo.gl/AbC123xyz', 'https://maps.app.goo.gl/AbC123xyz'],
    ['Opera House https://maps.app.goo.gl/AbC123xyz', 'https://maps.app.goo.gl/AbC123xyz'],
    ['maps.app.goo.gl/AbC123xyz', 'https://maps.app.goo.gl/AbC123xyz'],
    ['https://www.google.com/maps/place/Sydney+Opera+House/@-33.85,151.21,17z', 'https://www.google.com/maps/place/Sydney+Opera+House/@-33.85,151.21,17z'],
    ['google.com/maps/place/Bondi+Beach', 'https://google.com/maps/place/Bondi+Beach'],
  ];
  await p.evaluate(() => (location.hash = '#/calendar'));
  await p.waitForSelector('.cal-view');
  for (let i = 0; i < cases.length; i++) {
    const [loc, want] = cases[i];
    const col = await p.$('.tg-col[data-date="2026-10-21"]');
    const box = await col.boundingBox();
    await p.mouse.click(box.x + box.width / 2, box.y + (8 + i * 2) * 48 + 4);
    await p.waitForSelector('.quickev .qe-title');
    await p.keyboard.type(`Place ${i}`);
    await p.fill('.quickev input[aria-label="Location"]', loc);
    await p.click('.quickev button[type="submit"]');
    await p.waitForTimeout(250);
    await p.click(`.tg-col[data-date="2026-10-21"] .ev-block:has-text("Place ${i}")`);
    await p.waitForSelector('.evcard');
    const a = p.locator('.evcard .evc-link');
    assert.strictEqual(await a.getAttribute('href'), want, loc);
    if (i === 2) await p.waitForTimeout(400);
    if (i === 2) await p.screenshot({ path: `${OUT}/links-location.png` });
    await a.click();
    assert.deepStrictEqual(await opened(p), [[want, 'default']], loc);
    await p.keyboard.press('Escape');
    await p.waitForSelector('.evcard', { state: 'detached' });
  }
  pass('Open in Maps opens a pasted map link as it is, and looks up typed places in Google Maps');
  assert.deepStrictEqual(errs, []);

  // ------------------------------------------------------------------ browser
  const web = await open(b, 'web');
  await web.p.click('.sb-foot .nav-item');
  await web.p.waitForSelector('.modal.settings');
  assert(!(await web.p.innerText('.settings-panel')).includes('Open links with'), 'no browser choice in a browser');
  await web.p.keyboard.press('Escape');
  await web.p.evaluate(() => (location.hash = '#/inbox'));
  await addTask(web.p, 'See https://example.org/x');
  await web.p.click('.task-row a[href="https://example.org/x"]');
  assert.deepStrictEqual(await opened(web.p), [['https://example.org/x', 'window.open']]);
  assert.deepStrictEqual(web.errs, []);
  pass('in a browser there is no choice, and links open in a new tab as before');

  await b.close();
  console.log('links: all passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
