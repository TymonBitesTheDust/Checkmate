// Settings → Theme, Sidebar (choose the pages in the sidebar, task counts), About and Donate.
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
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => {
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => void window.__copied.push(t) }, configurable: true });
  });
  await p.goto(url);
  await p.waitForSelector('.view-title');
  const navLabels = () => p.$$eval('.sidebar .nav > .nav-item .nav-label', (x) => x.map((e) => e.textContent));
  assert.deepStrictEqual(await navLabels(), ['Search', 'Inbox', 'Today', 'Upcoming', 'Calendar', 'Birthdays', 'Filters & labels', 'Completed', 'Productivity']);
  const counts = () => p.$$eval('.sidebar .nav-count', (x) => x.length);
  assert(await counts() > 0, 'counts shown by default');

  await p.click('.sb-foot .nav-item');
  await p.waitForSelector('.modal.settings');
  const tabs = await p.$$eval('.settings-tabs button', (x) => x.map((e) => e.dataset.tab));
  assert.deepStrictEqual(tabs, ['general', 'theme', 'sidebar', 'reminders', 'sync', 'calendar', 'data', 'docs', 'claude', 'keys', 'whatsnew', 'about', 'donate']);
  // Theme: style, app icon, light/dark and theme colour live here now, not in General
  const general = await p.innerText('.settings-panel');
  for (const gone of ['Style', 'Theme colour', 'Match device\nLight\nDark', 'Change the app icon']) assert(!general.includes(gone), `General still has ${gone}`);
  for (const kept of ['Language', 'Open the app on', 'Week starts on', 'Time format', 'Sound effects']) assert(general.includes(kept), `General keeps ${kept}`);
  await p.click('.settings-tabs button[data-tab="theme"]');
  await p.waitForSelector('.skin-card');
  const theme = await p.innerText('.settings-panel');
  for (const has of ['Style', 'Theme', 'Match device', 'Theme colour']) assert(theme.includes(has), `Theme has ${has}`);
  assert(theme.indexOf('Style') < theme.indexOf('Match device') && theme.indexOf('Match device') < theme.indexOf('Theme colour'), 'in order');
  assert.strictEqual(await p.$$eval('.skin-card', (x) => x.length), 6);
  await p.screenshot({ path: `${OUT}/more-theme.png` });
  await p.click('.skin-card:has-text("Tide")');
  await p.waitForTimeout(150);
  assert.strictEqual(await p.evaluate(() => document.documentElement.dataset.skin), 'tide');
  assert(!/Theme colour|uses its own|Switch the style/.test(await p.innerText('.settings-panel')), 'no theme colour note in Tide');
  await p.click('.theme-panel .seg button:has-text("Depths")');
  await p.waitForTimeout(150);
  assert.strictEqual(await p.evaluate(() => JSON.parse(localStorage.getItem('tickwise.prefs.v1')).theme), 'dark');
  await p.click('.theme-panel .seg button:has-text("Match device")');
  await p.click('.skin-card:has-text("Checkmate")');
  await p.waitForTimeout(150);
  await p.click('.accent-dot[aria-label="Ocean"]');
  await p.waitForTimeout(150);
  assert.strictEqual(await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()), '#2f6fd6');
  await p.click('.accent-dot[aria-label="Pine"]');
  pass('Theme has the style, theme and theme colour, and General no longer does');
  await p.click('.settings-tabs button[data-tab="sidebar"]');
  await p.waitForSelector('.sbp-row');
  assert.strictEqual(await p.$$eval('.sbp-row input:checked', (x) => x.length), 9, 'all shown by default');
  await p.screenshot({ path: `${OUT}/more-sidebar.png` });
  await p.click('.sbp-row:has-text("Upcoming") input');
  await p.click('.sbp-row:has-text("Productivity") input');
  await p.waitForTimeout(150);
  assert.deepStrictEqual(await navLabels(), ['Search', 'Inbox', 'Today', 'Calendar', 'Birthdays', 'Filters & labels', 'Completed']);
  pass('unticking pages removes them from the sidebar straight away');
  await p.click('.sbp .switch-row input');
  await p.waitForTimeout(150);
  assert.strictEqual(await counts(), 0, 'no counts in the sidebar');
  assert.strictEqual(await p.$$eval('.sbp-ex-n', (x) => x.length), 0, 'example follows');
  assert(/Off/.test(await p.textContent('.sbp .switch-row')));
  await p.screenshot({ path: `${OUT}/more-sidebar-off.png` });
  pass('Show task count off hides every count in the sidebar, and the example shows it');

  // remembered after a restart; hidden pages still open by shortcut
  await p.reload();
  await p.waitForSelector('.view-title');
  assert.deepStrictEqual(await navLabels(), ['Search', 'Inbox', 'Today', 'Calendar', 'Birthdays', 'Filters & labels', 'Completed']);
  assert.strictEqual(await counts(), 0);
  await p.keyboard.press('g');
  await p.keyboard.press('u');
  await p.waitForTimeout(300);
  assert(/upcoming/.test(await p.evaluate(() => location.hash)), 'G then U still opens Upcoming');
  pass('the choices are remembered, and hidden pages still open with their shortcuts');
  await p.click('.sb-foot .nav-item');
  await p.click('.settings-tabs button[data-tab="sidebar"]');
  await p.click('.sbp-row:has-text("Upcoming") input');
  await p.click('.sbp-row:has-text("Productivity") input');
  await p.click('.sbp .switch-row input');
  await p.waitForTimeout(150);
  assert.strictEqual((await navLabels()).length, 9);
  assert(await counts() > 0);

  // About
  await p.click('.settings-tabs button[data-tab="about"]');
  await p.waitForSelector('.ab-card');
  const about = await p.textContent('.about-panel');
  for (const s of ['Tymon Ng', 'Claude AI', 'Proudly made in Australia', `Version ${require('fs').readFileSync(path.join(__dirname, '../web/src/version.js'), 'utf8').match(/'([\d.]+)'/)[1]}`]) assert(about.includes(s), s);
  assert(about.includes('github.com/TymonBitesTheDust/Checkmate'), 'source code link');
  await p.evaluate(() => { window.__opened = []; window.open = (u) => window.__opened.push(u); });
  await p.click('.about-panel a.ab-link');
  assert.deepStrictEqual(await p.evaluate(() => window.__opened), ['https://github.com/TymonBitesTheDust/Checkmate']);
  await p.screenshot({ path: `${OUT}/more-about.png` });
  pass('About: made by Tymon Ng with Claude AI, proudly made in Australia, with the version and a source code link');

  // Donate
  await p.click('.settings-tabs button[data-tab="donate"]');
  await p.waitForSelector('.dn-card');
  const dn = await p.textContent('.donate-panel');
  assert(dn.includes('Donate with Stripe'), 'Stripe card');
  for (const s of ['PayID', 'BSB', 'Account number', 'tymonng0903']) assert(!dn.includes(s), 'no PayID or bank details: ' + s);
  await p.evaluate(() => { window.__opened = []; window.open = (u) => window.__opened.push(u); });
  const LINKS = [
    ['A cup of coffee', 'https://buy.stripe.com/dRm3cu44SgGo7M10wnco001'],
    ['A lunch money', 'https://buy.stripe.com/6oU14m1WKfCk0jz4MDco002'],
    ['A month of Claude member', 'https://buy.stripe.com/eVqbJ0eJw3TCeap0wnco003'],
    ['A big thank!', 'https://buy.stripe.com/aFa6oG30O75Oeap6ULco004'],
    ['A lunch money (per month)', 'https://buy.stripe.com/5kQ4gy0SGai02rH4MDco005'],
  ];
  assert.deepStrictEqual(await p.$$eval('.dn-opt .dn-opt-label', (x) => x.map((e) => e.textContent)), LINKS.map((l) => l[0]));
  for (let i = 0; i < LINKS.length; i++) await p.click(`.dn-opt >> nth=${i}`);
  assert.deepStrictEqual(await p.evaluate(() => window.__opened), LINKS.map((l) => l[1]));
  assert.deepStrictEqual(await p.$$eval('.dn-opt', (x) => x.map((e) => !!e.querySelector('.dn-tag'))), [false, false, false, false, true], 'only the last is monthly');
  assert(!(await p.isVisible('.dn-pic')), 'no picture outside Frontier');
  await p.screenshot({ path: `${OUT}/more-donate.png` });
  pass('Donate: five Stripe choices, each opening its own Payment Link, and no PayID or bank details');

  // Chinese
  await p.evaluate(() => { const k = 'tickwise.prefs.v1'; const v = JSON.parse(localStorage.getItem(k)); v.language = 'zh-Hant'; localStorage.setItem(k, JSON.stringify(v)); });
  await p.reload();
  await p.waitForSelector('.view-title');
  await p.click('.sb-foot .nav-item');
  const OK = new Set(['Archive', 'Riot', 'Tide', 'Frontier', 'Neon', 'Stripe', 'Apple', 'Pay', 'Checkmate', 'Tymon', 'Ng', 'Claude', 'AI', 'Todoist', 'Google', 'github', 'com', 'TymonBitesTheDust']);
  for (const t of ['theme', 'sidebar', 'about', 'donate']) {
    await p.click(`.settings-tabs button[data-tab="${t}"]`);
    await p.waitForTimeout(150);
    const words = ((await p.innerText('.settings-panel')).match(/[A-Za-z]{2,}/g) || []).filter((w) => !OK.has(w));
    assert.deepStrictEqual([...new Set(words)], [], `English left in ${t}`);
    await p.screenshot({ path: `${OUT}/more-${t}-zh.png` });
  }
  const tabNames = await p.$$eval('.settings-tabs button', (x) => x.map((e) => e.textContent.trim()));
  console.log('    tabs:', tabNames.join(' · '));
  pass('Theme, Sidebar, About and Donate read in Traditional Chinese');

  // every style, and a phone
  for (const skin of ['tickwise', 'archive', 'riot', 'tide', 'frontier', 'neon']) {
    await p.evaluate((s) => { const k = 'tickwise.prefs.v1'; const v = JSON.parse(localStorage.getItem(k)); Object.assign(v, { skin: s, language: 'en', theme: s === 'neon' ? 'light' : 'dark' }); localStorage.setItem(k, JSON.stringify(v)); }, skin);
    await p.reload();
    await p.waitForSelector('.view-title');
    await p.click('.sb-foot .nav-item');
    for (const t of ['theme', 'sidebar', 'about', 'donate']) {
      await p.click(`.settings-tabs button[data-tab="${t}"]`);
      await p.waitForTimeout(200);
      await p.screenshot({ path: `${OUT}/more-${t}-${skin}.png` });
    }
    // the Donate picture is Frontier's alone, and loads
    assert.strictEqual(await p.isVisible('.dn-pic'), skin === 'frontier', `Donate picture in ${skin}`);
    if (skin === 'frontier') {
      assert(await p.$eval('.dn-pic img', (i) => i.complete && i.naturalWidth === 560), 'picture loaded');
      assert((await p.textContent('.dn-pic figcaption')).includes('I just need money'), 'caption');
    }
  }
  const m = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })).newPage();
  await m.goto(url);
  await m.waitForSelector('.view-title');
  await m.click('.topbar .icon-btn');
  await m.waitForTimeout(300);
  await m.click('.sb-foot .nav-item');
  for (const t of ['theme', 'sidebar', 'about', 'donate']) {
    await m.click(`.settings-tabs button[data-tab="${t}"]`);
    await m.waitForTimeout(200);
    assert(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('.settings-panel *')].every((e) => e.getBoundingClientRect().right <= innerWidth + 1)), `${t} fits a phone`);
    await m.screenshot({ path: `${OUT}/more-${t}-phone.png` });
  }
  pass('screenshots in all six styles; fits a phone');
  assert.deepStrictEqual(errs, []);
  console.log('\nsettings-more: all checks passed');
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
