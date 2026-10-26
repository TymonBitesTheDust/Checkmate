// Switches the app to Traditional Chinese and checks every main screen for leftover English.
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const path = require('path');
const assert = require('assert');
const OUT = process.argv[2];
const url = 'file://' + path.resolve(__dirname, '../web/dist/Checkmate.html');

// Latin words that are fine to see in the Chinese interface.
const ALLOWED = new Set(['MB', 'KB', 'Live', 'Aid', 'Claude', 'Docs', 'Sheets', 'B', 'Checkmate', 'checkmate', 'Tickwise', 'NieR', 'Automata', 'Persona', 'Firebase', 'Firestore', 'Authentication', 'Database', 'Google', 'Analytics',
  'API', 'Windows', 'Android', 'TW', 'or', 'const', 'firebaseConfig', 'apiKey', 'Q', 'G', 'T', 'I', 'U', 'F', 'C', 'M', 'Enter', 'Ctrl', 'Esc',
  'p', 'P', 'Hosting', 'Create', 'a', 'project', 'Build', 'Get', 'started', 'Email', 'Password', 'database', 'production', 'mode', 'Rules', 'Publish',
  'Project', 'overview', 'settings', 'Your', 'apps', 'console', 'firebase', 'google', 'com', 'tickwise', 'sync', 'Sign', 'in', 'method', 'ok', 'Drive', 'Red', 'Dead', 'Redemption', 'Cyberpunk',
  // calendar: Google's own menu names in the setup steps, file types and keys
  'GMT', 'ics', 'iCal', 'Outlook', 'Apple', 'calendar', 'Settings', 'for', 'my', 'calendars', 'Integrate', 'Secret', 'address', 'format', 'webcal', 'https',
  'D', 'X', 'W', 'Y', 'A', 'J', 'K', 'L',
  // Claude connector: product names
  'Claude', 'Todoist', 'Cloudflare',
  // the Persona 5 design's name, in What's new
  'Calling', 'Card']);

function leftovers(text) {
  const words = text.match(/[A-Za-z]{2,}/g) || [];
  return [...new Set(words.filter((w) => !ALLOWED.has(w)))];
}

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 820 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url);
  await p.waitForSelector('.view-title');

  // Switch through the Settings language control.
  await p.click('.sb-foot .nav-item');
  await p.waitForSelector('.settings-panel');
  await p.click('.seg button:has-text("繁體中文")');
  await p.waitForTimeout(200);
  assert.strictEqual(await p.evaluate(() => document.documentElement.lang), 'zh-Hant');
  assert(await p.isVisible('.settings-tabs button:has-text("一般")'));
  await p.click('.settings-tabs button[data-tab="theme"]');
  await p.waitForSelector('.skin-card');
  assert(await p.isVisible('.settings-tabs button[data-tab="theme"]:has-text("主題")'));
  assert.strictEqual(await p.$$eval('.skin-card span', (x) => x.length), 0, 'style descriptions are gone');
  await p.click('.settings-tabs button[data-tab="general"]');
  await p.screenshot({ path: `${OUT}/zh-1-settings.png` });
  const report = {};
  for (const tab of ['一般', '主題', '提醒', '同步', '日曆', '備份', '文件與試算表', 'Claude', '快捷鍵', '更新內容']) {
    await p.click(`.settings-tabs button:has-text("${tab}")`);
    if (tab === '同步') await p.click('button:has-text("怎樣取得設定？")');
    if (tab === '日曆') await p.click('button:has-text("在哪裡找到連結？")');
    await p.waitForTimeout(100);
    report[`設定/${tab}`] = leftovers(await p.innerText('.settings-panel'));
  }
  await p.screenshot({ path: `${OUT}/zh-2-sync.png` });
  await p.keyboard.press('Escape');

  // Welcome tasks are now in Chinese.
  const welcome = await p.$$eval('.task-row .task-title', (x) => x.map((e) => e.textContent));
  console.log('welcome tasks:', welcome.join(' / '));
  assert(welcome.some((w) => w.includes('完成任務')));

  // Quick add in Chinese.
  const add = async (text) => {
    await p.keyboard.press('q');
    await p.waitForSelector('.modal.quick .editor-title');
    await p.keyboard.type(text);
    await p.waitForTimeout(80);
  };
  await add('明天下午5點 打電話給阿明 p1 #工作 @電話');
  await p.screenshot({ path: `${OUT}/zh-3-quickadd.png` });
  const tool = await p.textContent('.modal.quick .tool');
  console.log('date button while typing:', tool);
  assert(tool.includes('明天') && tool.includes('下午5點'));
  await p.keyboard.press('Enter');
  await p.waitForTimeout(150);
  for (const t of ['每週一、三、五 早上7點 健身', '今天 買牛奶 p2', '每月15號交租 p3', '後天 交報告', '10月30日 看醫生', '今天 晚上9點 寫日記 p3']) {
    await add(t);
    await p.keyboard.press('Enter');
    await p.waitForTimeout(120);
  }
  const db = await p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('tickwise.db.v1'))).filter((x) => x.type === 'task' && !x.id.startsWith('welcome')));
  const byTitle = Object.fromEntries(db.map((x) => [x.title, x]));
  // the time typed stays in the name (2.2.0); day words such as 明天 are taken out
  assert(byTitle['下午5點 打電話給阿明'] && byTitle['下午5點 打電話給阿明'].due.time === '17:00' && byTitle['下午5點 打電話給阿明'].priority === 1);
  assert(byTitle['早上7點 健身'] && byTitle['早上7點 健身'].due.recur.days.join() === '1,3,5' && byTitle['早上7點 健身'].due.time === '07:00');
  assert(byTitle['交租'] && byTitle['交租'].due.recur.monthDay === 15);
  console.log('parsed:', db.map((x) => `${x.title}=${x.due && x.due.date}${x.due && x.due.time ? ' ' + x.due.time : ''}`).join(', '));

  await p.goto(url + '#/today');
  await p.waitForTimeout(400);
  report['今天'] = leftovers(await p.innerText('.app'));
  await p.screenshot({ path: `${OUT}/zh-4-today.png` });

  // complete a task to see the toast
  await p.click('.task-row:has-text("買牛奶") .check');
  await p.waitForTimeout(700);
  console.log('toast:', await p.textContent('.toast .toast-msg'));

  await p.goto(url + '#/upcoming');
  await p.waitForTimeout(400);
  report['即將到來'] = leftovers(await p.innerText('.app'));
  await p.screenshot({ path: `${OUT}/zh-5-upcoming.png` });

  await p.click('a.nav-item:has-text("工作")');
  await p.waitForTimeout(300);
  await p.click('.task-row .task-title');
  await p.waitForSelector('.modal.detail');
  report['任務詳情'] = leftovers(await p.innerText('.modal.detail'));
  await p.screenshot({ path: `${OUT}/zh-6-detail.png` });
  await p.click('.modal.detail .side-btn:has-text("明天")');
  await p.waitForSelector('.due-picker');
  report['日期選擇'] = leftovers(await p.innerText('.due-picker'));
  await p.screenshot({ path: `${OUT}/zh-7-duepicker.png` });
  await p.keyboard.press('Escape');
  await p.keyboard.press('Escape');

  for (const [hash, name] of [['#/filters', '篩選器與標籤'], ['#/completed', '已完成'], ['#/productivity', '生產力'], ['#/inbox', '收件匣'], ['#/search/牛奶', '搜尋']]) {
    await p.goto(url + hash);
    await p.waitForTimeout(350);
    report[name] = leftovers(await p.innerText('.app'));
  }
  // filter with Chinese words
  await p.goto(url + '#/filters');
  await p.waitForTimeout(300);
  console.log('open dialogs before filter step:', await p.$$eval('.modal', (x) => x.map((m) => m.className + ' :: ' + m.innerText.slice(0, 60).replace(/\n/g, ' '))));
  await p.screenshot({ path: `${OUT}/zh-debug.png` });
  await p.click('button[aria-label="新增篩選器"]');
  await p.fill('.modal.dialog input >> nth=0', '重要');
  await p.fill('.modal.dialog input >> nth=1', '(今天 | 逾期 | 明天) & p1');
  await p.waitForTimeout(100);
  console.log('filter hint:', await p.textContent('.modal.dialog .field-hint'));
  report['新增篩選器'] = leftovers(await p.innerText('.modal.dialog'));
  await p.screenshot({ path: `${OUT}/zh-8-filter.png` });
  await p.keyboard.press('Escape');

  // Calendar in Chinese
  await p.goto(url + '#/calendar');
  await p.waitForSelector('.cal-view');
  await p.keyboard.press('w');
  const quickEvent = async (text) => {
    await p.click('.cal-create');
    await p.waitForSelector('.quickev .qe-title:focus');
    await p.keyboard.type(text);
    await p.waitForTimeout(150);
  };
  await quickEvent('明天下午3點到5點 開會');
  const chip = await p.textContent('.quickev .chip-date');
  console.log('event chip:', chip);
  assert(chip.includes('下午3點') && chip.includes('下午5點'));
  report['新活動'] = leftovers(await p.innerText('.quickev'));
  await p.screenshot({ path: `${OUT}/zh-12-quick-event.png` });
  await p.keyboard.press('Enter');
  await quickEvent('每週一上午10時至下午12時 主席');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(200);
  const evDb = await p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('tickwise.db.v1'))).filter((x) => x.type === 'event'));
  const chair = evDb.find((x) => x.title === '主席');
  assert(chair && chair.rrule && chair.rrule.freq === 'weekly' && chair.start.endsWith('T10:00') && chair.end.endsWith('T12:00'), 'weekly event from Chinese words');
  // the week with tomorrow's meeting (the weekly one may start in the following week)
  const meet = evDb.find((x) => x.title === '開會');
  await p.goto(url + '#/calendar/' + meet.start.slice(0, 10));
  await p.waitForSelector('.ev-block:has-text("開會")');
  report['日曆/週'] = leftovers(await p.innerText('.app'));
  await p.screenshot({ path: `${OUT}/zh-13-calendar-week.png` });
  await p.click('.ev-block:has-text("開會")');
  await p.waitForSelector('.evcard');
  report['活動詳情'] = leftovers(await p.innerText('.evcard'));
  await p.click('.evcard button[aria-label="編輯活動"]');
  await p.waitForSelector('.ev-editor');
  report['編輯活動'] = leftovers(await p.innerText('.ev-editor'));
  await p.selectOption('.ev-editor .repeat-select', 'custom');
  await p.waitForSelector('.repeat-dialog');
  report['自訂重複'] = leftovers(await p.innerText('.repeat-dialog'));
  await p.screenshot({ path: `${OUT}/zh-14-custom-repeat.png` });
  await p.keyboard.press('Escape');
  await p.keyboard.press('Escape');
  for (const [k, name] of [['m', '日曆/月'], ['y', '日曆/年'], ['a', '日曆/時間表'], ['x', '日曆/4天'], ['d', '日曆/日']]) {
    await p.keyboard.press(k);
    await p.waitForTimeout(250);
    report[name] = leftovers(await p.innerText('.app'));
    if (k === 'm') await p.screenshot({ path: `${OUT}/zh-15-calendar-month.png` });
  }
  await p.click('.cal-viewbtn');
  report['檢視選單'] = leftovers(await p.innerText('.popover'));
  await p.keyboard.press('Escape');

  // Each style in Chinese
  for (const [skin, label] of [['archive', 'NieR'], ['riot', 'p5'], ['tide', 'p3'], ['frontier', 'rdr2'], ['neon', 'cp2077']]) {
    await p.evaluate((s) => { const k = 'tickwise.prefs.v1'; const v = JSON.parse(localStorage.getItem(k)); v.skin = s; localStorage.setItem(k, JSON.stringify(v)); }, skin);
    await p.goto(url + '#/today');
    await p.reload();
    await p.waitForTimeout(900);
    await p.screenshot({ path: `${OUT}/zh-9-${label}.png` });
    if (skin !== 'archive') {
      await p.click('.task-row:has-text("寫日記") .check');
      await p.waitForTimeout(skin === 'riot' ? 170 : 200);
      await p.screenshot({ path: `${OUT}/zh-9-${label}-done.png` });
      await p.waitForTimeout(700);
      await p.click('.toast:has-text("任務已完成") .toast-undo');
      await p.waitForTimeout(200);
    }
  }

  // Phone
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const mp = await m.newPage();
  await mp.goto(url);
  await mp.evaluate(() => localStorage.setItem('tickwise.prefs.v1', JSON.stringify({ language: 'zh-Hant', skin: 'tide', theme: 'light' })));
  await mp.reload();
  await mp.waitForTimeout(700);
  await mp.screenshot({ path: `${OUT}/zh-10-phone.png` });
  await mp.click('.topbar .icon-btn');
  await mp.waitForTimeout(400);
  await mp.screenshot({ path: `${OUT}/zh-11-phone-menu.png` });

  // Back to English restores English welcome tasks
  await p.evaluate(() => { const k = 'tickwise.prefs.v1'; const v = JSON.parse(localStorage.getItem(k)); v.language = 'en'; v.skin = 'tickwise'; localStorage.setItem(k, JSON.stringify(v)); });
  await p.goto(url + '#/inbox');
  await p.reload();
  await p.waitForTimeout(400);
  const en = await p.$$eval('.task-row .task-title', (x) => x.map((e) => e.textContent));
  console.log('after switching back:', JSON.stringify(en), await p.evaluate(() => JSON.stringify(Object.values(JSON.parse(localStorage.getItem('tickwise.db.v1'))).filter((x) => x.id.startsWith('welcome')).map((x) => [x.id, x.updatedAt, x.title.slice(0, 12)])), await p.evaluate(() => localStorage.getItem('tickwise.prefs.v1').slice(0, 80))));
  assert(en.some((w) => w.includes('Tick the circle')), 'welcome tasks back in English');
  assert.strictEqual(await p.textContent('.view-title .title-normal'), 'Inbox');

  let clean = true;
  for (const [k, v] of Object.entries(report)) {
    if (v.length) clean = false;
    console.log(`${k.padEnd(10, '　')} ${v.length ? 'English left: ' + v.join(', ') : 'all Chinese'}`);
  }
  console.log(errs.length ? 'ERRORS ' + errs.join('\n') : 'no page errors');
  await b.close();
  if (!clean) process.exitCode = 2;
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
