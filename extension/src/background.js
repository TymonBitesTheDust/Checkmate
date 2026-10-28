// Checkmate's service worker: reminders (an alarm and a notification for each), opening the
// app from a notification or the keyboard shortcut, and opening it once after installing.
// The app page (web/src/native.js) sends the next week's reminders whenever tasks change.
const APP = chrome.runtime.getURL('app.html');

async function appTab() {
  const pages = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
  return pages.find((c) => c.documentUrl && c.documentUrl.split(/[?#]/)[0] === APP) || null;
}

// Shows the Checkmate tab (opening one if needed), optionally on a task or reminder.
async function openApp(taskId) {
  const tab = await appTab();
  if (!tab) {
    await chrome.tabs.create({ url: taskId ? `${APP}?task=${encodeURIComponent(taskId)}` : APP });
    return;
  }
  await chrome.tabs.update(tab.tabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  if (taskId) chrome.runtime.sendMessage({ type: 'checkmate:open-task', id: taskId }).catch(() => {});
}

// Alarm names are "r|<reminder id>|<time>", so a moved reminder gets a new alarm.
const alarmName = (r) => `r|${r.id}|${r.at}`;

async function schedule(list) {
  const now = Date.now();
  const keep = (Array.isArray(list) ? list : []).filter((r) => r && r.id && r.at > now - 60000).slice(0, 60);
  await chrome.storage.local.set({ reminders: keep });
  const want = new Map(keep.map((r) => [alarmName(r), r]));
  const have = await chrome.alarms.getAll();
  for (const a of have) if (a.name.startsWith('r|') && !want.has(a.name)) await chrome.alarms.clear(a.name);
  const names = new Set(have.map((a) => a.name));
  for (const [name, r] of want) if (!names.has(name)) await chrome.alarms.create(name, { when: Math.max(r.at, now + 1000) });
}

chrome.alarms.onAlarm.addListener(async (a) => {
  if (!a.name.startsWith('r|')) return;
  const { reminders = [] } = await chrome.storage.local.get('reminders');
  const r = reminders.find((x) => alarmName(x) === a.name);
  // a reminder that's long gone (the computer was asleep) isn't worth showing
  if (!r || Date.now() - r.at > 15 * 60000) return;
  chrome.notifications.create(a.name, { type: 'basic', iconUrl: 'icons/icon128.png', title: r.title || 'Checkmate', message: r.body || '', priority: 2 });
});

chrome.notifications.onClicked.addListener((name) => {
  chrome.notifications.clear(name);
  if (name.startsWith('r|')) openApp(name.slice(2, name.lastIndexOf('|')));
});

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (!m || sender.id !== chrome.runtime.id) return;
  if (m.type === 'checkmate:reminders') schedule(m.list).then(() => reply(true), () => reply(false));
  else if (m.type === 'checkmate:open') openApp(m.taskId).then(() => reply(true), () => reply(false));
  else return;
  return true; // answers later
});

chrome.commands.onCommand.addListener((c) => {
  if (c === 'open-app') openApp();
});

chrome.runtime.onInstalled.addListener((d) => {
  if (d.reason === 'install') openApp();
});
