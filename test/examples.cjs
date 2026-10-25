// The example in the task name box: its own on certain days, otherwise a random one.
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const url = 'file://' + path.resolve(__dirname, '../web/dist/Checkmate.html');
const OUT = process.argv[2] || '/tmp/shots';
fs.mkdirSync(OUT, { recursive: true });
const pass = (m) => console.log('  ✓ ' + m);

const ON_THE_DAY = {
  '2026-01-26': ['Celebrate Australia Day with your mates', '和朋友一起慶祝澳洲國慶日'],
  '2027-04-25': ['Anzac at 4am p1', '凌晨4點 澳紐軍團日黎明儀式 p1'],
  '2026-06-04': ['Nothing to do today!', '今天無事可做！'],
  '2026-07-13': ['Watch Live Aid at 12pm p1', '中午12點 看 Live Aid p1'],
  '2026-09-03': ['Attend Tymon’s Birthday Party at 7pm p1', '晚上7點 出席 Tymon 的生日派對 p1'],
  '2026-10-15': ['Watch flying car with Elon Musk at 8pm p1', '晚上8點 和 Elon Musk 一起看飛天汽車 p1'],
  '2026-10-16': ['Be responsible for a water bottle p3', '負責好一個水樽 p3'],
  '2026-11-19': ['Play GTA VI before GTA VI p2', '在 GTA VI 推出前玩 GTA VI p2'],
  '2026-12-18': ['Watch Messi cook and roast IShowSpeed', '看 Messi 大展身手，狠狠嗆 IShowSpeed'],
};
const ANY_DAY = [
  'Hide snacks from future me Friday 4pm p2',
  'Pet a dog every day 5pm p2',
  'Call Mum before she calls you tomorrow 5pm p1',
  'Rotate the Earth 10000 times at 5pm p2',
  'You no longer have a manager. You can’t be managed p3',
  'Fill your bedroom with mirrors so you will be surrounded by winners',
];

(async () => {
  const b = await chromium.launch();
  const errs = [];

  async function open(day, lang = 'en') {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    await p.clock.install({ time: new Date(`${day}T09:30:00`) });
    if (lang !== 'en') await p.addInitScript((l) => localStorage.setItem('tickwise.prefs.v1', JSON.stringify({ language: l })), lang);
    await p.goto(url);
    await p.waitForSelector('.view-title');
    return p;
  }
  const quickHint = async (p) => {
    await p.keyboard.press('q');
    await p.waitForSelector('.modal.quick .editor-title');
    const ph = await p.getAttribute('.modal.quick .editor-title', 'placeholder');
    await p.keyboard.press('Escape');
    await p.waitForSelector('.modal.quick', { state: 'detached' });
    return ph;
  };

  for (const [day, [en, zh]] of Object.entries(ON_THE_DAY)) {
    const p = await open(day);
    assert.strictEqual(await quickHint(p), `Task name, e.g. ${en}`, day);
    assert.strictEqual(await quickHint(p), `Task name, e.g. ${en}`, `${day} stays put`);
    if (day === '2026-07-13') await (async () => {
      await p.keyboard.press('q');
      await p.waitForSelector('.modal.quick .editor-title');
      await p.screenshot({ path: `${OUT}/example-live-aid.png` });
      await p.keyboard.press('Escape');
    })();
    await p.context().close();
  }
  pass('each of the nine days shows its own example, every time the box opens');

  for (const [day, [, zh]] of Object.entries(ON_THE_DAY).slice(2, 5)) {
    const p = await open(day, 'zh-Hant');
    assert.strictEqual(await quickHint(p), `任務名稱，例如：${zh}`, day);
    await p.context().close();
  }
  pass('in Traditional Chinese too');

  // Any other day: one of the six, and not always the same one.
  const seen = new Set();
  const p = await open('2026-10-19');
  for (let i = 0; i < 30; i++) {
    const ph = await quickHint(p);
    const ex = ph.replace(/^Task name, e\.g\. /, '');
    assert(ANY_DAY.includes(ex), `random one is from the list: ${ph}`);
    seen.add(ex);
  }
  assert(seen.size >= 3, `picks vary (${seen.size} seen)`);
  pass(`another day picks from the six at random (${seen.size} different in 30 opens)`);

  // Adding a task in a list keeps the box open, and it shows a fresh example.
  await p.goto(url + '#/inbox');
  await p.waitForSelector('.view-title');
  await p.click('.add-row');
  await p.waitForSelector('.editor-title');
  const shown = [];
  for (let i = 0; i < 8; i++) {
    shown.push(await p.getAttribute('.editor-title', 'placeholder'));
    await p.fill('.editor-title', `Example test ${i}`);
    await p.keyboard.press('Enter');
    await p.waitForTimeout(80);
  }
  assert(shown.every((ph) => ANY_DAY.includes(ph.replace(/^Task name, e\.g\. /, ''))), shown.join(' | '));
  assert(new Set(shown).size >= 2, 'a new example after adding');
  await p.screenshot({ path: `${OUT}/example-random.png` });
  await p.keyboard.press('Escape');
  pass(`after adding a task, the open box shows a new example (${new Set(shown).size} different in 8 adds)`);

  // Subtasks keep their own hint.
  await p.click('.task-row:has-text("Example test 0") .task-title');
  await p.waitForSelector('.modal.detail');
  await p.click('.modal.detail button:has-text("Add subtask")');
  await p.waitForSelector('.modal.detail .editor-title');
  assert.strictEqual(await p.getAttribute('.modal.detail .editor-title', 'placeholder'), 'Subtask name');
  pass('subtasks still say “Subtask name”');
  await p.context().close();

  // On a phone a long one is cut at a word with "…" (the full one is in the tooltip).
  for (const [skin, lang, start] of [['tickwise', 'en', 'Task name, e.g. Fill your bedroom'], ['riot', 'en', 'Task name, e.g. Fill your'], ['tickwise', 'zh-Hant', '任務名稱，例如：在睡房']]) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
    const m = await ctx.newPage();
    m.on('pageerror', (e) => errs.push(e.message));
    await m.clock.install({ time: new Date('2026-10-19T09:30:00') });
    await m.addInitScript(([l, k]) => {
      Math.random = () => 0.99;
      localStorage.setItem('tickwise.prefs.v1', JSON.stringify({ language: l, skin: k }));
    }, [lang, skin]);
    await m.goto(url);
    await m.waitForSelector('.view-title');
    await m.evaluate(() => document.fonts.ready);
    await m.click('.add-row');
    await m.waitForSelector('.editor-title');
    await m.waitForTimeout(300);
    const [ph, title, fits] = await m.$eval('.editor-title', (i) => {
      const c = document.createElement('canvas').getContext('2d');
      const cs = getComputedStyle(i, '::placeholder');
      c.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      if ('letterSpacing' in c) c.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
      const t = cs.textTransform === 'uppercase' ? i.placeholder.toUpperCase() : i.placeholder;
      return [i.placeholder, i.title, c.measureText(t).width <= i.clientWidth];
    });
    assert(ph.endsWith('…') && ph.startsWith(start), `${skin}/${lang}: ${ph}`);
    assert(fits, `${skin}/${lang} fits: ${ph}`);
    assert(/mirrors|鏡子/.test(title), 'full example in the tooltip');
    await m.screenshot({ path: `${OUT}/example-phone-${skin}-${lang}.png` });
    await ctx.close();
  }
  pass('on a phone a long example ends in “…” at a whole word instead of being chopped');

  assert.deepStrictEqual(errs, []);
  await b.close();
  console.log('examples OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
