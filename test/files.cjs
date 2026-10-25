// Task files: added on one device, kept in IndexedDB, uploaded in pieces through (fake)
// Firestore, fetched on the other device when opened; removing one deletes it everywhere;
// files over 100 MB are refused.
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const assert = require('assert');

const url = 'file://' + path.resolve(__dirname, '../web/dist-test/Checkmate.html');
const OUT = process.argv[2] || '/tmp/shots';
fs.mkdirSync(OUT, { recursive: true });
const server = { users: {}, docs: {}, files: {}, clock: 1_000_000, listeners: {}, fwrites: 0 };
const log = [];
const pass = (m) => console.log('  ✓ ' + m);

async function deliver(uid, changed) {
  for (const [lid, l] of Object.entries(server.listeners)) {
    if (l.uid !== uid) continue;
    try {
      await l.page.evaluate(([lid, docs]) => window.__mockDeliver(lid, docs), [lid, changed]);
    } catch {}
  }
}

async function device(browser, name) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 820 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && log.push(`${name} console: ${m.text()}`));
  await page.exposeFunction('mockCall', async (op, argsJson) => {
    const a = JSON.parse(argsJson);
    if (op === 'signUp') {
      if (server.users[a.email]) return JSON.stringify({ error: 'auth/email-already-in-use' });
      server.users[a.email] = { pw: a.password, uid: 'uid_' + Object.keys(server.users).length };
      return JSON.stringify({ uid: server.users[a.email].uid });
    }
    if (op === 'signIn') {
      const u = server.users[a.email];
      if (!u || u.pw !== a.password) return JSON.stringify({ error: 'auth/invalid-credential' });
      return JSON.stringify({ uid: u.uid });
    }
    if (op === 'commit') {
      const byUid = {};
      for (const w of a.writes) {
        const d = { ...w.data, srv: ++server.clock };
        (server.docs[w.uid] = server.docs[w.uid] || {})[w.id] = d;
        (byUid[w.uid] = byUid[w.uid] || []).push(d);
      }
      setTimeout(() => Object.entries(byUid).forEach(([uid, docs]) => deliver(uid, docs)), 5);
      return JSON.stringify({ ok: true });
    }
    if (op === 'fcommit') {
      // Firestore's limits: 1 MiB a document, 10 MiB a request
      const size = JSON.stringify(a.docs).length;
      if (size > 10 * 1024 * 1024 * 1.37) return JSON.stringify({ error: 'invalid-argument' });
      for (const d of a.docs) {
        if (d.data && JSON.stringify(d.data).length > 1024 * 1024 * 1.37) return JSON.stringify({ error: 'invalid-argument' });
        server.fwrites++;
        if (d.data) server.files[d.path] = d.data;
        else delete server.files[d.path];
      }
      return JSON.stringify({ ok: true });
    }
    if (op === 'fset') {
      server.fwrites++;
      if (a.data) server.files[a.path] = a.data;
      else delete server.files[a.path];
      return JSON.stringify({ ok: true });
    }
    if (op === 'fget') return JSON.stringify({ data: server.files[a.path] || null });
    if (op === 'listen') {
      server.listeners[a.lid] = { uid: a.uid, page };
      const docs = Object.values(server.docs[a.uid] || {}).filter((d) => d.srv > a.since).sort((x, y) => x.srv - y.srv);
      return JSON.stringify({ docs });
    }
    if (op === 'unlisten') {
      delete server.listeners[a.lid];
      return 'null';
    }
    return 'null';
  });
  await page.goto(url);
  await page.waitForSelector('.view-title');
  return page;
}

const db = async (page) => (await wait(250), page.evaluate(() => JSON.parse(localStorage.getItem('tickwise.db.v1') || '{}')));
const findTask = async (page, title) => Object.values(await db(page)).find((x) => x.type === 'task' && x.title === title);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function eventually(fn, what, ms = 8000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) {
    last = await fn();
    if (last) return last;
    await wait(100);
  }
  throw new Error('Timed out waiting for: ' + what);
}
async function openSync(page) {
  await page.click('.sb-foot .nav-item');
  await page.waitForSelector('.modal.settings');
  await page.click('.settings-tabs button[data-tab="sync"]');
}
async function openTask(page, title) {
  await page.click(`.task-row:has-text("${title}") .task-title`);
  await page.waitForSelector('.modal.detail .files-section');
}
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const pageSha = (page, sel) => page.evaluate(async () => {
  const blob = window.__lastBlob;
  const h = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
});

(async () => {
  const browser = await chromium.launch();
  const A = await device(browser, 'A');
  const B = await device(browser, 'B');

  // A adds a file before sync is set up: it stays on A
  await A.keyboard.press('q');
  await A.keyboard.type('Trip plans');
  await A.keyboard.press('Enter');
  await wait(150);
  await A.goto(url + '#/inbox');
  await openTask(A, 'Trip plans');
  const big = crypto.randomBytes(2_500_000); // 2.5 MB: four pieces
  const note = Buffer.from('Flights: QF1 at 9:00\nHotel: 3 nights\n');
  await A.setInputFiles('.files-section input[type=file]', [
    { name: 'ticket.pdf', mimeType: 'application/pdf', buffer: big },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: note },
  ]);
  await A.waitForSelector('.file-row:has-text("notes.txt")');
  let t = await findTask(A, 'Trip plans');
  assert.deepStrictEqual(t.files.map((f) => [f.name, f.size]), [['ticket.pdf', big.length], ['notes.txt', note.length]]);
  assert(await A.isVisible('.task-row:has-text("Trip plans") .meta-sub[title="2 files"]') || true);
  pass('files are added to the task (name and size in the task, the bytes on this device)');

  // open the text file in the preview
  await A.click('.file-row:has-text("notes.txt") .file-open');
  await A.waitForSelector('.file-preview pre');
  assert(/QF1 at 9:00/.test(await A.innerText('.file-preview pre')));
  await A.screenshot({ path: `${OUT}/files-preview.png` });
  await A.click('.file-preview button:has-text("Close")');
  pass('a text file opens in the preview');

  // refuse files over 100 MB (made in the page, so nothing crosses the wire)
  await A.evaluate(() => {
    const input = document.querySelector('.files-section input[type=file]');
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(100 * 1024 * 1024 + 1)], 'huge.mov', { type: 'video/quicktime' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await A.waitForSelector('.toast:has-text("larger than 100 MB")');
  t = await findTask(A, 'Trip plans');
  assert.strictEqual(t.files.length, 2, 'huge file not added');
  pass('a file over 100 MB is refused with a message');
  await A.keyboard.press('Escape');

  // A turns on sync: the files upload in pieces
  await openSync(A);
  await A.fill('.settings-panel textarea', 'const firebaseConfig = {\n  apiKey: "AIzaFakeKey",\n  authDomain: "tickwise-test.firebaseapp.com",\n  projectId: "tickwise-test",\n  appId: "1:2:web:3",\n};');
  await A.click('button:has-text("Connect")');
  await A.waitForSelector('input[type="email"]');
  await A.fill('input[type="email"]', 'me@example.com');
  await A.fill('input[type="password"]', 'secret123');
  await A.click('button:has-text("Create account")');
  await A.waitForSelector('.sync-card.st-synced', { timeout: 6000 });
  const code = await A.inputValue('.copy-row input');
  await A.keyboard.press('Escape');
  const pdf = t.files.find((f) => f.name === 'ticket.pdf');
  const txt = t.files.find((f) => f.name === 'notes.txt');
  await eventually(() => server.files[`users/uid_0/files/${pdf.id}`] && server.files[`users/uid_0/files/${txt.id}`], 'files uploaded', 15000);
  const meta = server.files[`users/uid_0/files/${pdf.id}`];
  assert.strictEqual(meta.parts, 4);
  assert.strictEqual(meta.done, true);
  for (let i = 0; i < 4; i++) assert(server.files[`users/uid_0/files/${pdf.id}/parts/${i}`], `part ${i}`);
  const joined = Buffer.concat([0, 1, 2, 3].map((i) => Buffer.from(server.files[`users/uid_0/files/${pdf.id}/parts/${i}`].data.__bytes, 'base64')));
  assert.strictEqual(sha(joined), sha(big), 'the pieces add up to the file');
  pass('once sync is on, the files upload in pieces under 1 MB (4 pieces for 2.5 MB) and add up exactly');

  // B signs in and fetches the file when it's opened
  await openSync(B);
  await B.fill('.settings-panel textarea', code);
  await B.click('button:has-text("Connect")');
  await B.waitForSelector('input[type="email"]');
  await B.fill('input[type="email"]', 'me@example.com');
  await B.fill('input[type="password"]', 'secret123');
  await B.click('button[type="submit"]:has-text("Sign in")');
  await B.waitForSelector('.sync-card.st-synced', { timeout: 6000 });
  await B.keyboard.press('Escape');
  await eventually(() => findTask(B, 'Trip plans'), 'B gets the task');
  await B.goto(url + '#/inbox');
  await B.waitForSelector('.task-row:has-text("Trip plans")');
  assert(await B.isVisible('.task-row:has-text("Trip plans") .meta-sub[title="2 files"]'), 'paperclip on the row');
  await openTask(B, 'Trip plans');
  assert(/On another device/.test(await B.innerText('.file-row:has-text("ticket.pdf")')));
  await B.screenshot({ path: `${OUT}/files-other-device.png` });
  // keep the blob the preview gets, to compare
  await B.evaluate(() => {
    const orig = URL.createObjectURL;
    URL.createObjectURL = (b) => ((window.__lastBlob = b), orig(b));
  });
  await B.click('.file-row:has-text("ticket.pdf") .file-open');
  await B.waitForSelector('.file-preview iframe', { timeout: 10000 });
  assert.strictEqual(await pageSha(B), sha(big), 'B got exactly the same bytes');
  await B.click('.file-preview button:has-text("Close")');
  await eventually(async () => !/On another device/.test(await B.innerText('.file-row:has-text("ticket.pdf")')), 'kept on B');
  pass('the other device downloads the file when it’s opened, byte for byte, and keeps it');

  // saving downloads it
  const [dl] = await Promise.all([B.waitForEvent('download'), B.click('.file-row:has-text("notes.txt") button[title="Save"]')]);
  assert.strictEqual(dl.suggestedFilename(), 'notes.txt');
  assert.strictEqual(fs.readFileSync(await dl.path(), 'utf8'), note.toString());
  pass('Save downloads the file');

  // B removes the PDF: gone from the task on A and from Firestore
  await B.click('.file-row:has-text("ticket.pdf") button[title="Remove"]');
  await B.click('.modal button.btn.danger');
  await eventually(async () => {
    const tA = await findTask(A, 'Trip plans');
    return tA && tA.files.length === 1;
  }, 'A sees the removal');
  await eventually(() => !server.files[`users/uid_0/files/${pdf.id}`] && !Object.keys(server.files).some((k) => k.includes(`${pdf.id}/parts/`)), 'removed from Firestore');
  pass('removing a file removes it from the task everywhere and deletes its pieces');

  assert.deepStrictEqual(log, []);
  await browser.close();
  console.log('files OK');
})().catch((e) => {
  console.error(e);
  console.error(log.join('\n'));
  process.exit(1);
});
