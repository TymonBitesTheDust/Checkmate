const { chromium } = require('/opt/node-tools/node_modules/playwright');
const path = require('path');
const OUT = process.argv[2] || '/tmp/shots';
require('fs').mkdirSync(OUT, { recursive: true });
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const url = 'file://' + path.resolve(__dirname, '../web/dist/Checkmate.html');
  await page.goto(url);
  await page.waitForSelector('.view-title');
  await page.screenshot({ path: `${OUT}/01-today.png` });
  // quick add with natural language
  await page.keyboard.press('q');
  await page.waitForSelector('.modal.quick .editor-title');
  await page.keyboard.type('Call Sam tomorrow 5pm p1 #Work @phone');
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}/02-quickadd.png` });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  for (const t of ['Pay rent every 1st at 9am p2', 'Gym every mon, wed and fri at 7am', 'Buy milk today p3 @errand', 'Draft report friday']) {
    await page.keyboard.press('q');
    await page.waitForSelector('.modal.quick .editor-title');
    await page.keyboard.type(t);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/03-today-after.png` });
  await page.goto(url + '#/upcoming');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/04-upcoming.png` });
  // open Work project
  const work = await page.$('a.nav-item:has-text("Work")');
  if (work) await work.click();
  await page.waitForTimeout(300);
  // add section
  await page.evaluate(() => {});
  await page.screenshot({ path: `${OUT}/05-project.png` });
  // open task detail
  await page.click('.task-row .task-title');
  await page.waitForSelector('.modal.detail');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/06-detail.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  // board
  await page.click('button[aria-label="Board layout"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/07-board.png` });
  // date picker
  await page.goto(url + '#/today');
  await page.waitForTimeout(300);
  await page.hover('.task-row');
  await page.click('.task-row button[aria-label="Set due date"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/08-duepicker.png` });
  await page.keyboard.press('Escape');
  // complete a task
  await page.click('.task-row .check');
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}/09-completing.png` });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/10-completed-toast.png` });
  // settings sync
  await page.click('.sb-foot .nav-item');
  await page.waitForSelector('.modal.settings');
  await page.click('.settings-tabs button:has-text("Sync")');
  await page.click('button:has-text("How do I get a config?")');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/11-settings-sync.png` });
  await page.keyboard.press('Escape');
  // dark mode
  await page.evaluate(() => { const p = JSON.parse(localStorage.getItem('tickwise.prefs.v1') || '{}'); p.theme='dark'; localStorage.setItem('tickwise.prefs.v1', JSON.stringify(p)); });
  await page.reload();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/12-dark.png` });
  await page.goto(url + '#/productivity');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/13-productivity-dark.png` });
  // mobile
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const mp = await m.newPage();
  mp.on('pageerror', (e) => errors.push('mobile pageerror: ' + e.message));
  await mp.goto(url);
  await mp.waitForSelector('.view-title');
  await mp.screenshot({ path: `${OUT}/20-m-today.png` });
  await mp.click('.fab');
  await mp.waitForTimeout(300);
  await mp.keyboard.type('Dentist on 3 nov at 14:30 p2');
  await mp.screenshot({ path: `${OUT}/21-m-quick.png` });
  await mp.keyboard.press('Enter');
  await mp.waitForTimeout(200);
  await mp.click('.topbar .icon-btn');
  await mp.waitForTimeout(350);
  await mp.screenshot({ path: `${OUT}/22-m-drawer.png` });
  await mp.click('.scrim', { position: { x: 370, y: 400 } });
  await mp.waitForTimeout(300);
  await mp.click('.task-row .task-title');
  await mp.waitForTimeout(350);
  await mp.screenshot({ path: `${OUT}/23-m-detail.png` });
  console.log('ERRORS:\n' + (errors.join('\n') || 'none'));
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
