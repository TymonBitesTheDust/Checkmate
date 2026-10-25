// The app's frame must never scroll: in Persona 3 and Persona 5 the decorations make it
// taller than the window, and a scrolled frame hides the toolbar with no way back.
// Checks every style: forced scrolling, scrolling something at the bottom into view, and
// the reported path (month view → card in the bottom row → the date → day view).
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const path = require('path');
const assert = require('assert');
const url = 'file://' + path.resolve(__dirname, process.env.FRAME_HTML || '../web/dist/Checkmate.html');
const ev = { id: 'e1', type: 'event', calendarId: 'cal-main', title: 'Dental Appointment', allDay: false, start: '2027-04-27T12:00', end: '2027-04-27T13:00', tz: 'Australia/Sydney', updatedAt: 5 };
const pass = (m) => console.log('  ✓ ' + m);

(async () => {
  const b = await chromium.launch();
  const errs = [];
  for (const skin of ['tickwise', 'archive', 'riot', 'tide', 'frontier', 'neon']) {
    for (const [w, h] of [[1897, 945], [1280, 700]]) {
      const ctx = await b.newContext({ viewport: { width: w, height: h }, timezoneId: 'Australia/Sydney' });
      const p = await ctx.newPage();
      p.on('pageerror', (e) => errs.push(`${skin}: ${e.message}`));
      await p.addInitScript(({ ev, skin }) => {
        if (localStorage.getItem('tickwise.db.v1')) return;
        localStorage.setItem('tickwise.db.v1', JSON.stringify({ e1: ev }));
        localStorage.setItem('tickwise.seeded', '1');
        localStorage.setItem('tickwise.prefs.v1', JSON.stringify({ skin, theme: 'dark', language: 'en', calView: 'month' }));
      }, { ev, skin });
      await p.goto(url + '#/calendar');
      await p.waitForSelector('.cal-view');
      await p.waitForTimeout(500);
      for (let i = 0; i < 6; i++) {
        await p.keyboard.press('j');
        await p.waitForTimeout(80);
      }
      await p.waitForTimeout(300);
      const state = () => p.evaluate(() => {
        const app = document.querySelector('.app');
        const bar = document.querySelector('.cal-view .view-head, .cal-view .cal-bar, .cal-view header') || document.querySelector('.cal-title');
        return { app: app.scrollTop, win: window.scrollY, bar: Math.round(bar.getBoundingClientRect().top) };
      });
      const top0 = (await state()).bar;
      // 1. forced
      await p.evaluate(() => {
        document.querySelector('.app').scrollTop = 150;
        window.scrollTo(0, 150);
      });
      await p.waitForTimeout(50);
      let s = await state();
      assert(s.app === 0 && s.win === 0 && s.bar === top0, `${skin} forced scroll moved the frame: ${JSON.stringify(s)}`);
      // 2. something at the very bottom scrolled into view / focused
      await p.evaluate(() => {
        const cells = [...document.querySelectorAll('.mg-cell')];
        const last = cells[cells.length - 1];
        last.scrollIntoView({ block: 'end' });
        const n = last.querySelector('.mg-num');
        if (n) n.focus();
      });
      await p.waitForTimeout(50);
      s = await state();
      assert(s.app === 0 && s.win === 0 && s.bar === top0, `${skin} bottom element pushed the frame: ${JSON.stringify(s)}`);
      // 3. the reported path
      const cell = p.locator('.mg-cell:not(.out)', { has: p.locator('.mg-num', { hasText: /^27$/ }) }).first();
      const box = await cell.boundingBox();
      await p.mouse.click(box.x + box.width / 2, box.y + box.height - 10);
      await p.waitForTimeout(500);
      await p.keyboard.press('Escape');
      await p.waitForTimeout(300);
      await p.locator('.mg-cell:not(.out) .mg-num', { hasText: /^27$/ }).first().click();
      await p.waitForTimeout(600);
      s = await state();
      assert(s.app === 0 && s.win === 0 && s.bar >= 0 && s.bar <= top0 + 2, `${skin} day view toolbar out of view: ${JSON.stringify(s)}`);
      assert(await p.isVisible('.cal-view button:has-text("Today"), .cal-view button:has-text("TODAY")'), `${skin} Today button visible`);
      await ctx.close();
    }
    pass(`${skin}: the frame stays put (forced scroll, bottom focus, month → day)`);
  }
  // Old WebViews without overflow: clip still get put back by the scroll guard.
  const p = await (await b.newContext({ viewport: { width: 1897, height: 945 } })).newPage();
  await p.addInitScript(() => {
    localStorage.setItem('tickwise.seeded', '1');
    localStorage.setItem('tickwise.prefs.v1', JSON.stringify({ skin: 'tide', theme: 'dark', calView: 'month' }));
  });
  await p.goto(url + '#/calendar');
  await p.waitForSelector('.cal-view');
  await p.addStyleTag({ content: '.app { overflow: hidden !important; }' });
  await p.evaluate(() => (document.querySelector('.app').scrollTop = 120));
  await p.waitForTimeout(100);
  assert.strictEqual(await p.evaluate(() => document.querySelector('.app').scrollTop), 0, 'guard puts the frame back');
  pass('without overflow: clip (older WebViews) the scroll guard puts the frame back');
  assert.deepStrictEqual(errs, []);
  console.log('\nframe: all checks passed');
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
