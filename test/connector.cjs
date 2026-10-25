// The Claude connector: sign-in (OAuth as Claude does it), every tool, and the
// safety checks. Runs the real bundled connector against a stand-in for Google's APIs.
//   node test/connector.cjs              (Node)
//   RUNTIME=workerd node test/connector.cjs   (the Cloudflare Workers runtime)
const assert = require('assert');
const H = require('./connector-harness.cjs');
const { createFakeGoogle } = require('./fake-google.cjs');

const TZ = 'Australia/Sydney';
const wall = (ms, tz = TZ) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
};
const addDays = (s, n) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const wd = (s) => new Date(`${s}T00:00:00Z`).getUTCDay();
const TODAY = wall(Date.now()).date;
const pass = (m) => console.log('  ✓ ' + m);

function seed(server) {
  const now = Date.now();
  let srv = 10;
  const put = (d) => (server.docs.uid_0[d.id] = { createdAt: 0, updatedAt: now - 100000, dev: 'phone', ...d, srv: ++srv });
  put({ id: 'inbox', type: 'project', name: 'Inbox', color: 'slate', order: 0, isInbox: true, view: 'list' });
  put({ id: 'p-home', type: 'project', name: 'Home', color: 'pine', order: 1, view: 'list' });
  put({ id: 'p-old', type: 'project', name: 'Old stuff', color: 'sand', order: 2, view: 'list', archived: true });
  put({ id: 's-kitchen', type: 'section', projectId: 'p-home', name: 'Kitchen', order: 1 });
  put({ id: 'l-phone', type: 'label', name: 'phone', color: 'slate', order: 1 });
  put({ id: 'f-urgent', type: 'filter', name: 'Urgent', query: 'p1 & (today | overdue)', color: 'iris', order: 1 });
  const task = (id, title, extra) => put({ id, type: 'task', title, desc: '', projectId: 'inbox', sectionId: null, parentId: null, priority: 4, labels: [], due: null, done: false, order: 1, ...extra });
  const firstOfNext = (() => {
    const [y, m] = TODAY.split('-').map(Number);
    return `${m === 12 ? y + 1 : y}-${String((m % 12) + 1).padStart(2, '0')}-01`;
  })();
  task('t-rent', 'Pay rent', { projectId: 'p-home', priority: 1, due: { date: TODAY, time: '09:00', recur: { unit: 'month', every: 1, monthDay: +TODAY.slice(8), text: 'every month' } } });
  task('t-late', 'Return library book', { due: { date: addDays(TODAY, -2), time: null, recur: null }, labels: ['l-phone'] });
  task('t-trip', 'Plan trip', { priority: 2 });
  task('t-flights', 'Book flights', { parentId: 't-trip', order: 1 });
  task('t-done', 'Wrote report', { done: true, doneAt: now - 3600000 });
  task('t-archived', 'In an archived project', { projectId: 'p-old' });
  put({ id: 'c-1', type: 'comment', taskId: 't-trip', text: 'Ask Jo about dates', createdAt: now - 7200000 });
  put({ id: 'cal-main', type: 'calendar', name: 'My calendar', color: 'ocean', order: 0, isDefault: true, defaultReminders: [10], allDayReminders: [] });
  put({ id: 'cal-work', type: 'calendar', name: 'Work', color: 'iris', order: 1, defaultReminders: [10], allDayReminders: [] });
  put({ id: 'cal-hol', type: 'calendar', name: 'Holidays in Australia', color: 'moss', order: 2, sub: { url: 'https://calendar.google.com/calendar/ical/x/public/basic.ics' } });
  // weekly standup on Mondays 10:00 Sydney, started three weeks ago
  const mon = (() => {
    let d = addDays(TODAY, -21);
    while (wd(d) !== 1) d = addDays(d, 1);
    return d;
  })();
  put({ id: 'e-standup', type: 'event', calendarId: 'cal-work', title: 'Standup', allDay: false, start: `${mon}T10:00`, end: `${mon}T10:30`, tz: TZ, rrule: { freq: 'weekly', interval: 1, byDay: [{ wd: 1, n: 0 }] }, exdates: [], location: '', desc: '', color: null, reminders: null });
  put({ id: 'e-hol', type: 'event', calendarId: 'cal-hol', title: 'Public holiday', allDay: true, start: addDays(TODAY, 3), end: addDays(TODAY, 4), tz: null, rrule: null, exdates: [] });
  put({ id: 'claude', type: 'connector', gen: 4242, tz: TZ, dateOrder: 'dmy', secret: 'abc'.repeat(15) });
  return { mon };
}

(async () => {
  const server = { users: { 'me@example.com': { pw: 'secret123', uid: 'uid_0' }, 'other@example.com': { pw: 'otherpass', uid: 'uid_1' } }, docs: { uid_0: {}, uid_1: {} }, clock: 1000 };
  const { mon } = seed(server);
  const g = createFakeGoogle({ server, apiKey: 'AIzaFakeKey', project: 'checkmate-test' });
  const gbase = await g.listen();
  const cfg = { apiKey: 'AIzaFakeKey', projectId: 'checkmate-test', authDomain: 'checkmate-test.firebaseapp.com', secret: 'Sk'.repeat(22) };
  const w = await H.startWorker({ cfg, googleBase: gbase });
  const B = w.base;
  console.log(`connector on ${process.env.RUNTIME || 'node'} at ${B}`);
  const docs = () => server.docs.uid_0;
  const live = (type) => Object.values(docs()).filter((d) => d.type === type && !d.deleted);
  try {
    // ---------- discovery ----------
    const prm = await (await fetch(`${B}/.well-known/oauth-protected-resource/mcp`)).json();
    assert.strictEqual(prm.resource, `${B}/mcp`);
    assert.deepStrictEqual(prm.authorization_servers, [B]);
    const asm = await (await fetch(`${B}/.well-known/oauth-authorization-server`)).json();
    assert.strictEqual(asm.issuer, B);
    assert(asm.code_challenge_methods_supported.includes('S256'));
    assert(asm.token_endpoint_auth_methods_supported.includes('none'));
    assert.strictEqual(asm.client_id_metadata_document_supported, true);
    assert(asm.registration_endpoint && asm.authorization_endpoint && asm.token_endpoint);
    const r401 = await fetch(`${B}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' });
    assert.strictEqual(r401.status, 401);
    assert.match(r401.headers.get('www-authenticate'), new RegExp(`resource_metadata="${B}/.well-known/oauth-protected-resource/mcp"`));
    const root = await (await fetch(`${B}/.well-known/oauth-protected-resource`)).json();
    assert.strictEqual(root.resource, B);
    pass('discovery: 401 points to the resource metadata, which names the sign-in server (S256, DCR and CIMD)');

    // ---------- registration and the sign-in page ----------
    const bad = await fetch(`${B}/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['https://evil.example/cb'] }) });
    assert.strictEqual(bad.status, 400);
    assert.strictEqual((await bad.json()).error, 'invalid_redirect_uri');
    const good = await fetch(`${B}/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], client_name: 'Claude', token_endpoint_auth_method: 'client_secret_post' }) });
    assert.strictEqual(good.status, 201);
    const reg = await good.json();
    assert(reg.client_id && reg.client_secret);
    pass('registration only accepts Claude’s callback and loopback addresses');

    const pkce = async () => {
      const verifier = require('crypto').randomBytes(32).toString('base64url');
      const challenge = require('crypto').createHash('sha256').update(verifier).digest('base64url');
      return { verifier, challenge };
    };
    const authUrl = (p) => `${B}/authorize?${new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', state: 'st8', scope: 'checkmate', ...p })}`;
    const evil = await fetch(authUrl({ redirect_uri: 'https://evil.example/cb', code_challenge: 'x', code_challenge_method: 'S256' }), { redirect: 'manual' });
    assert.strictEqual(evil.status, 400);
    assert(!evil.headers.get('location'));
    const noPkce = await fetch(authUrl({}), { redirect: 'manual' });
    assert.strictEqual(noPkce.status, 302);
    assert.match(noPkce.headers.get('location'), /error=invalid_request/);
    const k1 = await pkce();
    const wrong = await H.signInPage(authUrl({ code_challenge: k1.challenge, code_challenge_method: 'S256' }), { email: 'me@example.com', password: 'nope' });
    assert(!wrong.location && /isn’t right/.test(wrong.page), 'wrong password message');
    assert(/claude\.ai/.test(wrong.firstPage) && /checkmate-test/.test(wrong.firstPage), 'page names claude.ai and the Firebase project');
    const zh = await H.signInPage(authUrl({ code_challenge: k1.challenge, code_challenge_method: 'S256' }), { email: 'me@example.com', password: 'nope', lang: 'zh-HK,zh;q=0.9' });
    assert(/將 Claude 連接到 Checkmate/.test(zh.firstPage) && /電郵或密碼不正確/.test(zh.page));
    const cancel = await H.signInPage(authUrl({ code_challenge: k1.challenge, code_challenge_method: 'S256' }), { email: '', password: '', action: 'cancel' });
    assert.strictEqual(cancel.error, 'access_denied');
    assert.strictEqual(cancel.state, 'st8');
    const other = await H.signInPage(authUrl({ code_challenge: k1.challenge, code_challenge_method: 'S256' }), { email: 'other@example.com', password: 'otherpass' });
    assert(!other.location && /isn’t turned on/.test(other.page), 'account without Claude turned on');
    const local = await (await fetch(authUrl({ redirect_uri: 'http://127.0.0.1:5555/callback', code_challenge: k1.challenge, code_challenge_method: 'S256' }))).text();
    assert(/started by an app on this computer/.test(local));
    pass('sign-in page: refuses other sites, needs PKCE, explains a wrong password (also in Chinese), Cancel and local-app warning');

    // Claude's own client (a Client ID Metadata Document URL) with a confidential secret flow skipped
    const k2 = await pkce();
    const cimdUrl = authUrl({ client_id: 'https://claude.ai/oauth/mcp-oauth-client-metadata', code_challenge: k2.challenge, code_challenge_method: 'S256' });
    const ok = await H.signInPage(cimdUrl, { email: 'me@example.com', password: 'secret123' });
    assert(ok.code && ok.state === 'st8' && ok.location.startsWith('https://claude.ai/api/mcp/auth_callback?'));
    const tok = (body) => fetch(`${B}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
    const badVerifier = await tok({ grant_type: 'authorization_code', code: ok.code, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', client_id: 'https://claude.ai/oauth/mcp-oauth-client-metadata', code_verifier: k1.verifier });
    assert.strictEqual((await badVerifier.json()).error, 'invalid_grant');
    const badRedirect = await tok({ grant_type: 'authorization_code', code: ok.code, redirect_uri: 'https://claude.com/api/mcp/auth_callback', code_verifier: k2.verifier });
    assert.strictEqual((await badRedirect.json()).error, 'invalid_grant');
    const t1 = await (await tok({ grant_type: 'authorization_code', code: ok.code, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', client_id: 'https://claude.ai/oauth/mcp-oauth-client-metadata', code_verifier: k2.verifier })).json();
    assert(t1.access_token && t1.refresh_token && t1.expires_in > 3000 && t1.token_type === 'Bearer');
    assert(!t1.access_token.includes('secret123') && !t1.access_token.includes('idt.'), 'tokens are sealed');
    assert(docs().claude.authAt > Date.now() - 60000 && docs().claude.authEmail === 'me@example.com', 'the app can show when Claude connected');
    const badSecret = await tok({ grant_type: 'refresh_token', refresh_token: t1.refresh_token, client_id: reg.client_id, client_secret: 'wrong' });
    assert.strictEqual(badSecret.status, 401);
    const t2 = await (await tok({ grant_type: 'refresh_token', refresh_token: t1.refresh_token })).json();
    assert(t2.access_token && t2.refresh_token && t2.refresh_token !== t1.refresh_token);
    const rpc = (token, body) => fetch(`${B}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify(body) });
    const init = await (await rpc(t2.access_token, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } } })).json();
    assert.strictEqual(init.result.protocolVersion, '2025-06-18');
    assert.strictEqual(init.result.serverInfo.name, 'checkmate');
    assert((await rpc(t2.access_token, { jsonrpc: '2.0', method: 'notifications/initialized' })).status === 202);
    const tampered = t2.access_token.slice(0, -4) + (t2.access_token.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    assert.strictEqual((await rpc(tampered, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).status, 401);
    assert.strictEqual((await rpc(t2.access_token, { jsonrpc: '2.0', id: 3, method: 'nope/nope' })).status, 200);
    pass('Claude’s published client (CIMD): code + PKCE → tokens; wrong verifier, redirect or client secret are refused; refresh rotates; tampered tokens fail');

    // ---------- the MCP SDK, connecting like Claude Code ----------
    const { client, provider } = await H.connect(B, { email: 'me@example.com', password: 'secret123' });
    const { tools } = await client.listTools();
    assert.strictEqual(tools.length, 16);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    assert(byName['delete-tasks'].annotations.destructiveHint && byName['find-tasks'].annotations.readOnlyHint && !byName['add-tasks'].annotations.readOnlyHint);
    assert(tools.every((t) => t.inputSchema && t.inputSchema.type === 'object' && t.description.length > 20));
    pass('MCP SDK client: registers, signs in, and lists 16 tools with read-only/destructive hints');
    const call = (n, a) => H.call(client, n, a);

    // ---------- reading ----------
    const ov = await call('get-overview');
    assert.strictEqual(ov.today, TODAY);
    assert.strictEqual(ov.timeZone, TZ);
    assert(ov.overdue.some((t) => t.title === 'Return library book' && t.overdue && t.labels[0] === 'phone'));
    assert(ov.dueOnDate.some((t) => t.title === 'Pay rent' && t.due.repeat && t.priority === 'p1'));
    assert(!ov.projects.some((p) => p.name === 'Old stuff'), 'archived project hidden');
    if (wd(TODAY) === 1) assert(ov.events.some((e) => e.title === 'Standup' && e.start === `${TODAY} 10:00`));
    assert(ov.calendars.find((c) => c.name === 'Holidays in Australia').readOnly);
    pass('get-overview: today in the user’s zone, overdue and due tasks, events, projects, read-only calendars');

    let r = await call('find-tasks', { filter: 'today | overdue' });
    assert.deepStrictEqual(r.tasks.map((t) => t.title).sort(), ['Pay rent', 'Return library book']);
    r = await call('find-tasks', { filter: '#Home & p1' });
    assert.deepStrictEqual(r.tasks.map((t) => t.title), ['Pay rent']);
    r = await call('find-tasks', { search: 'flights' });
    assert(r.tasks[0].parentTitle === 'Plan trip');
    r = await call('find-tasks', { label: 'phone' });
    assert.deepStrictEqual(r.tasks.map((t) => t.title), ['Return library book']);
    r = await call('find-tasks', { status: 'completed' });
    assert.deepStrictEqual(r.tasks.map((t) => t.title), ['Wrote report']);
    r = await call('find-tasks', {});
    assert(!r.tasks.some((t) => t.title === 'In an archived project'));
    r = await call('find-tasks', { filter: '(((' });
    assert(r.tasks || r.error);
    r = await call('find-tasks', { project: 'Nowhere' });
    assert(/no project called “Nowhere”.*Home/.test(r.error));
    pass('find-tasks: app filter syntax, search, labels, completed tasks; archived projects stay hidden; unknown project explained');

    // ---------- adding ----------
    const before = Object.keys(docs()).length;
    r = await call('add-tasks', { tasks: [{ title: 'Fine' }, { title: 'Broken', project: 'Nowhere' }] });
    assert(/Task 2 .*Nothing was added/.test(r.error));
    assert.strictEqual(Object.keys(docs()).length, before, 'all or nothing');
    r = await call('add-tasks', {
      tasks: [
        { title: 'Call Sam', due: 'tomorrow 5pm', priority: 'p1', project: 'home', section: 'Kitchen', labels: ['phone', '@groceries'], description: 'About the fridge' },
        { title: 'Book hotel', parentId: 't-trip' },
        { title: 'Water plants', due: 'every 2 weeks on saturday' },
        { title: '明天下午3點 打電話', due: '明天下午3點' },
        { title: 'Dentist', due: '2026-11-03 14:30', priority: 2 },
      ],
    });
    assert.strictEqual(r.tasks.length, 5, JSON.stringify(r));
    const sam = docs()[r.tasks[0].id];
    assert.strictEqual(sam.projectId, 'p-home');
    assert.strictEqual(sam.sectionId, 's-kitchen');
    assert.deepStrictEqual(sam.due, { date: addDays(TODAY, 1), time: '17:00', recur: null });
    assert.strictEqual(sam.priority, 1);
    assert.strictEqual(sam.desc, 'About the fridge');
    assert.strictEqual(sam.labels[0], 'l-phone');
    const groceries = docs()[sam.labels[1]];
    assert(groceries && groceries.type === 'label' && groceries.name === 'groceries');
    assert(sam.done === false && sam.dev === 'claude' && sam.via === 'claude' && sam.updatedAt > 0 && sam.createdAt > 0 && typeof sam.order === 'number' && sam.srv > 0);
    const hotel = docs()[r.tasks[1].id];
    assert(hotel.parentId === 't-trip' && hotel.projectId === 'inbox');
    const plants = docs()[r.tasks[2].id];
    assert(plants.due.recur && plants.due.recur.unit === 'week' && plants.due.recur.every === 2 && plants.due.recur.days[0] === 6 && wd(plants.due.date) === 6);
    assert.deepStrictEqual(docs()[r.tasks[3].id].due, { date: addDays(TODAY, 1), time: '15:00', recur: null });
    assert.deepStrictEqual(docs()[r.tasks[4].id].due, { date: '2026-11-03', time: '14:30', recur: null });
    r = await call('add-tasks', { tasks: [{ title: 'x', due: 'whenever-ish' }] });
    assert(/Couldn’t read the date/.test(r.error));
    r = await call('add-tasks', { tasks: [{ title: 'x', priority: 'urgent' }] });
    assert(/p1, p2, p3 or p4/.test(r.error));
    pass('add-tasks: due phrases (English and Chinese), repeats, project/section by name, new labels, subtasks; stored exactly like the app’s tasks; all-or-nothing on errors');

    // ---------- changing ----------
    r = await call('update-tasks', { tasks: [{ id: 't-trip', project: 'Home', priority: 'p1', addLabels: ['travel'], due: 'next friday' }] });
    assert.strictEqual(docs()['t-trip'].projectId, 'p-home');
    assert.strictEqual(docs()['t-flights'].projectId, 'p-home', 'subtask followed');
    assert.strictEqual(docs()[hotel.id].projectId, 'p-home', 'new subtask followed');
    assert.strictEqual(wd(docs()['t-trip'].due.date), 5);
    r = await call('update-tasks', { tasks: [{ id: 't-trip', due: 'none', removeLabels: ['travel'] }] });
    assert.strictEqual(docs()['t-trip'].due, null);
    assert.deepStrictEqual(docs()['t-trip'].labels, []);
    r = await call('update-tasks', { tasks: [{ id: 't-trip', parentId: 't-flights' }] });
    assert(/subtask of itself/.test(r.error));
    r = await call('update-tasks', { tasks: [{ id: sam.id, section: 'none', title: 'Call Sam back' }] });
    assert(docs()[sam.id].sectionId === null && docs()[sam.id].title === 'Call Sam back');
    pass('update-tasks: move with subtasks, dates, labels, priorities; refuses loops');

    r = await call('complete-tasks', { ids: ['t-rent', sam.id, 't-trip'] });
    const rent = docs()['t-rent'];
    assert(!rent.done && rent.due.date > TODAY && rent.due.date.slice(8) === TODAY.slice(8) && rent.completions.length === 1, JSON.stringify(rent.due));
    assert(docs()[sam.id].done && docs()[sam.id].doneAt > 0);
    assert(docs()['t-trip'].done && docs()['t-flights'].done && docs()[hotel.id].done, 'subtasks completed with parent');
    assert(/next due/.test(r.results[0].result));
    r = await call('reopen-tasks', { ids: ['t-flights'] });
    assert(!docs()['t-flights'].done && !docs()['t-trip'].done, 'parent reopened');
    r = await call('find-tasks', { status: 'completed', completedSince: TODAY });
    assert(r.tasks.some((t) => t.title === 'Pay rent' && t.note) && r.tasks.some((t) => t.title === 'Call Sam back'));
    pass('complete-tasks: repeating task moves to its next date, subtasks finish with the parent; reopen-tasks reopens parents');

    r = await call('add-comments', { comments: [{ taskId: 't-trip', text: 'Flights look cheaper in May' }] });
    r = await call('get-task', { id: 't-trip' });
    assert.deepStrictEqual(r.comments.map((c) => c.text), ['Ask Jo about dates', 'Flights look cheaper in May']);
    assert(r.subtasks.length === 2 && r.subtasks.some((s) => s.done));
    const doomed = (await call('add-tasks', { tasks: [{ title: 'Doomed' }] })).tasks[0].id;
    const doomedSub = (await call('add-tasks', { tasks: [{ title: 'Doomed sub', parentId: doomed }] })).tasks[0].id;
    await call('add-comments', { comments: [{ taskId: doomedSub, text: 'bye' }] });
    r = await call('delete-tasks', { ids: [doomed] });
    assert(/1 subtask/.test(r.summary));
    assert(docs()[doomed].deleted && docs()[doomedSub].deleted && Object.values(docs()).some((d) => d.type === 'comment' && d.deleted));
    assert.deepStrictEqual(Object.keys(docs()[doomed]).sort(), ['dev', 'id', 'srv', 'type', 'updatedAt', 'deleted'].sort());
    pass('comments, get-task, and delete-tasks (subtasks and comments become tombstones, like the app)');

    r = await call('find-projects', {});
    assert(r.projects.find((p) => p.name === 'Home').sections[0].name === 'Kitchen');
    assert.deepStrictEqual(r.filters, [{ name: 'Urgent', filter: 'p1 & (today | overdue)' }]);
    r = await call('add-projects', { projects: [{ name: 'Garden', color: 'moss', sections: ['Beds', 'Pots'] }, { name: 'home', sections: ['Laundry'] }] });
    assert.strictEqual(live('project').filter((p) => p.name.toLowerCase() === 'home').length, 1, 'no duplicate');
    assert(r.projects[1].note === 'already existed' && r.projects[1].addedSections[0] === 'Laundry');
    r = await call('add-sections', { project: 'Garden', sections: ['Beds', 'Lawn'] });
    assert.deepStrictEqual(r.sections.map((s) => s.name), ['Beds', 'Pots', 'Lawn']);
    r = await call('add-projects', { projects: [{ name: 'X', color: 'chartreuse' }] });
    assert(/Colours are/.test(r.error));
    pass('find-projects, add-projects (no duplicates), add-sections');

    // ---------- calendar ----------
    const tomorrow = addDays(TODAY, 1);
    r = await call('add-events', {
      events: [
        { title: 'Lunch with Ana', start: `${tomorrow} 12:30`, end: '13:45', location: 'Cafe Sol', calendar: 'Work', reminders: [15] },
        { title: 'Camping', start: addDays(TODAY, 5), end: addDays(TODAY, 7) },
        { title: 'Gym', start: `${TODAY} 07:00`, durationMinutes: 45, repeat: 'every weekday', repeatCount: 10 },
        { title: 'Call with HK office', start: `${tomorrow} 09:00`, timeZone: 'Asia/Hong_Kong' },
      ],
    });
    assert.strictEqual(r.events.length, 4, JSON.stringify(r));
    const lunch = docs()[r.events[0].id];
    assert.deepStrictEqual([lunch.start, lunch.end, lunch.tz, lunch.calendarId, lunch.allDay, lunch.location, lunch.rrule], [`${tomorrow}T12:30`, `${tomorrow}T13:45`, TZ, 'cal-work', false, 'Cafe Sol', null]);
    assert.deepStrictEqual(lunch.reminders, [15]);
    const camp = docs()[r.events[1].id];
    assert.deepStrictEqual([camp.start, camp.end, camp.allDay], [addDays(TODAY, 5), addDays(TODAY, 8), true]);
    assert.strictEqual(r.events[1].end, addDays(TODAY, 7), 'all-day end is the last day');
    const gym = docs()[r.events[2].id];
    assert(gym.rrule.freq === 'weekly' && gym.rrule.byDay.length === 5 && gym.rrule.count === 10);
    assert(gym.end.endsWith('07:45'));
    if (wd(TODAY) === 0 || wd(TODAY) === 6) assert(r.events[2].note, 'start moved to a weekday');
    const hk = docs()[r.events[3].id];
    assert.strictEqual(hk.tz, 'Asia/Hong_Kong');
    assert.strictEqual(r.events[3].startInEventTimeZone, `${tomorrow} 09:00`);
    assert.strictEqual(r.events[3].start, `${tomorrow} 12:00`, 'shown in the user’s zone (Sydney is 3 h ahead of Hong Kong in October)');
    r = await call('add-events', { events: [{ title: 'Nope', start: tomorrow, calendar: 'Holidays in Australia' }] });
    assert(/subscribed calendar/.test(r.error));
    r = await call('add-events', { events: [{ title: 'Nope', start: `${tomorrow} 15:00`, end: `${TODAY} 14:00` }] });
    assert(/end is before start/.test(r.error));
    pass('add-events: timed, all-day (inclusive end), repeating with a count, other time zones; subscribed calendars are read-only');

    r = await call('find-events', { from: TODAY, to: addDays(TODAY, 13) });
    const gyms = r.events.filter((e) => e.title === 'Gym');
    assert.strictEqual(gyms.length, 10, 'repeatCount respected');
    assert(gyms.every((e) => e.occurrence && wd(e.start.slice(0, 10)) >= 1 && wd(e.start.slice(0, 10)) <= 5));
    const ups = r.events.filter((e) => e.title === 'Standup');
    assert.strictEqual(ups.length, 2);
    assert(ups.every((e) => e.start.endsWith('10:00') && e.repeat === 'Weekly on Monday'));
    assert(r.events.some((e) => e.title === 'Public holiday' && e.readOnly && e.allDay));
    assert(r.events.some((e) => e.title === 'Camping' && e.allDay && e.end === addDays(TODAY, 7)));
    r = await call('find-events', { from: TODAY, to: addDays(TODAY, 13), search: 'cafe' });
    assert.deepStrictEqual(r.events.map((e) => e.title), ['Lunch with Ana']);
    pass('find-events: repeating events expanded, all-day ranges, read-only holidays, search');

    // change one Standup, then the following ones, then all
    const nextMon = (() => {
      let d = addDays(TODAY, 1);
      while (wd(d) !== 1) d = addDays(d, 1);
      return d;
    })();
    r = await call('update-events', { id: 'e-standup', occurrence: `${nextMon} 10:00`, scope: 'this', start: '11:00', title: 'Standup (late)' });
    const override = live('event').find((e) => e.recurringId === 'e-standup');
    assert(override && override.originalStart === `${nextMon}T10:00` && override.start === `${nextMon}T11:00` && override.end === `${nextMon}T11:30`, JSON.stringify(override));
    r = await call('find-events', { from: nextMon, to: nextMon });
    assert.deepStrictEqual(r.events.filter((e) => /Standup/.test(e.title)).map((e) => [e.title, e.start]), [['Standup (late)', `${nextMon} 11:00`]]);
    r = await call('update-events', { id: 'e-standup', title: 'Team standup' });
    assert.strictEqual(docs()['e-standup'].title, 'Team standup');
    r = await call('update-events', { id: 'e-standup', occurrence: addDays(nextMon, 7), scope: 'following', start: '09:30' });
    const split = live('event').find((e) => e.rrule && e.id !== 'e-standup' && /standup/i.test(e.title));
    assert(split && split.start === `${addDays(nextMon, 7)}T09:30` && docs()['e-standup'].rrule.until === addDays(nextMon, 6), JSON.stringify([split, docs()['e-standup'].rrule]));
    r = await call('update-events', { id: 'e-standup', occurrence: '2020-01-01', scope: 'this', title: 'x' });
    assert(/isn’t one of the dates/.test(r.error));
    r = await call('update-events', { id: 'e-hol', title: 'Mine now' });
    assert(/read-only/.test(r.error));
    r = await call('update-events', { id: lunch.id, start: `${tomorrow} 13:00` });
    assert.deepStrictEqual([docs()[lunch.id].start, docs()[lunch.id].end], [`${tomorrow}T13:00`, `${tomorrow}T14:15`], 'kept its length');
    r = await call('update-events', { id: camp.id, allDay: false, start: `${addDays(TODAY, 5)} 08:00`, end: '17:00' });
    assert(!docs()[camp.id].allDay && docs()[camp.id].tz === TZ && docs()[camp.id].end === `${addDays(TODAY, 5)}T17:00`);
    pass('update-events: one occurrence, this-and-following (splits the series), all, moving keeps the length, all-day ↔ timed');

    const firstGym = gyms[0].occurrence;
    r = await call('delete-events', { id: gym.id, occurrence: firstGym, scope: 'this' });
    assert(docs()[gym.id].exdates.includes(firstGym));
    r = await call('delete-events', { id: lunch.id });
    assert(docs()[lunch.id].deleted);
    r = await call('delete-events', { id: 'e-standup', scope: 'all' });
    assert(docs()['e-standup'].deleted && docs()[override.id].deleted);
    pass('delete-events: one occurrence (skipped date), a single event, a whole series with its changed occurrences');

    // ---------- races, expiry and turning access off ----------
    g.stats.failNextCommit = () => {
      // another device edits the task between the connector's read and its write
      const d = docs()['t-late'];
      docs()['t-late'] = { ...d, desc: 'edited on the phone', updatedAt: Date.now(), srv: ++server.clock };
    };
    const commits = g.stats.commits;
    r = await call('update-tasks', { tasks: [{ id: 't-late', priority: 'p2' }] });
    assert(g.stats.commits === commits + 2, 'retried once');
    assert(docs()['t-late'].priority === 2 && docs()['t-late'].desc === 'edited on the phone', 'both changes kept');
    pass('a change made on another device at the same moment is kept (the write is checked and retried)');

    g.expireIdTokens();
    r = await call('find-tasks', { search: 'library' });
    assert.strictEqual(r.tasks[0].title, 'Return library book');
    assert(g.stats.refreshes >= 2);
    pass('an expired Firebase sign-in is renewed through the refresh token without bothering the user');

    docs().claude = { ...docs().claude, gen: 99, updatedAt: Date.now(), srv: ++server.clock };
    let failed = null;
    try {
      await client.callTool({ name: 'find-tasks', arguments: {} });
    } catch (e) {
      failed = e;
    }
    assert(failed, 'access turned off');
    const t3 = await (await tok({ grant_type: 'refresh_token', refresh_token: t2.refresh_token })).json();
    assert.strictEqual(t3.error, 'invalid_grant');
    const again = await H.connect(B, { email: 'me@example.com', password: 'secret123' });
    r = await H.call(again.client, 'find-tasks', { search: 'library' });
    assert.strictEqual(r.tasks.length, 1);
    pass('Disconnect in the app stops every existing token; connecting again works');

    console.log(`\n  ${g.stats.queries.length} Firestore queries, none needing an index; ${g.stats.reads} document reads in all`);
    console.log('\nconnector: all checks passed');
  } finally {
    w.stop();
    g.close();
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
