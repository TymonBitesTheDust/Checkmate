// Subscribed calendars: Google Calendar's "secret address in iCal format" (or any
// .ics link) is read every so often and its events are copied into a read-only
// calendar. Event ids are fixed per calendar and UID, so every device that reads the
// link writes the same items, and the events sync to devices that can't read it
// themselves (a browser can't read Google's .ics links; the Windows and Android apps can).
import * as store from './store.js';
import { toast } from './ui.jsx';
import { play } from './sound.js';
import { tr, isZh } from './i18n.js';
import { nativeFetchText, hasNativeFetch } from './native.js';
import { getSyncState, onSyncState } from './sync.js';
import { parseIcs } from './ics.js';
import { feedItems, applyFeed, saveCalendar, subscribed, calName } from './events.js';
import { formatTime, shortDate, today, ymd } from './dates.js';

const busy = new Set();
const pad = (n) => String(n).padStart(2, '0');
export const isRefreshing = (id) => busy.has(id);

// webcal:// is how calendar apps link to .ics files; it's https underneath.
export function normalizeUrl(input) {
  let u = String(input || '').trim();
  if (!u) return null;
  u = u.replace(/^webcals?:\/\//i, 'https://');
  if (!/^https?:\/\//i.test(u)) return null;
  try {
    const url = new URL(u);
    if (url.protocol === 'http:') url.protocol = 'https:';
    return url.toString();
  } catch {
    return null;
  }
}

export const isGoogleLink = (u) => /^https:\/\/calendar\.google\.com\/calendar\/ical\//i.test(u || '');
export const isPrivateGoogle = (u) => isGoogleLink(u) && /\/private-[0-9a-f]+\//i.test(u || '');

// The calendar's name from a Google link: "en.hong_kong#holiday@group..." -> null, but
// an address like "someone@gmail.com" is a good default name.
export function nameFromUrl(u) {
  const m = /\/calendar\/ical\/([^/]+)\//.exec(u || '');
  if (!m) return '';
  const id = decodeURIComponent(m[1]);
  if (/#holiday@/.test(id)) return '';
  if (/@(gmail|googlemail)\.com$/i.test(id)) return id;
  return '';
}

// Public holiday calendars Google publishes (English names).
export const HOLIDAYS = [
  ['hong_kong', 'Hong Kong', '香港'],
  ['australian', 'Australia', '澳洲'],
  ['taiwan', 'Taiwan', '台灣'],
  ['china', 'China', '中國'],
  ['macau', 'Macau', '澳門'],
  ['singapore', 'Singapore', '新加坡'],
  ['japanese', 'Japan', '日本'],
  ['new_zealand', 'New Zealand', '紐西蘭'],
  ['uk', 'United Kingdom', '英國'],
  ['usa', 'United States', '美國'],
  ['canadian', 'Canada', '加拿大'],
];
export const holidayUrl = (key) => `https://calendar.google.com/calendar/ical/en.${key}%23holiday%40group.v.calendar.google.com/public/basic.ics`;

const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

async function get(url) {
  const viaApp = nativeFetchText(url);
  if (viaApp) {
    const r = await viaApp;
    return { status: r.status, text: r.text, via: 'app' };
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch(url, { credentials: 'omit', cache: 'no-store', redirect: 'follow', referrerPolicy: 'no-referrer', signal: ctl.signal });
    return { status: r.status, text: await r.text(), via: 'web' };
  } catch (e) {
    e.blocked = !offline();
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function userError(message) {
  const e = new Error(message);
  e.twUser = true;
  return e;
}

/** Reads a link and returns the parsed calendar. Throws with a readable message. */
export async function readFeed(url) {
  let r;
  try {
    r = await get(url);
  } catch (e) {
    if (offline()) throw userError(tr('You’re offline. Checkmate will try again when you’re back online.'));
    if (e && e.blocked && !hasNativeFetch()) {
      const err = userError(tr('This browser can’t read the link itself. The Windows and Android apps check it and sync the events here.'));
      err.browserBlocked = true;
      throw err;
    }
    throw userError(tr('Couldn’t reach the calendar link. Checkmate will try again later.'));
  }
  if (!r || !r.status) {
    if (offline()) throw userError(tr('You’re offline. Checkmate will try again when you’re back online.'));
    throw userError(tr('Couldn’t reach the calendar link. Checkmate will try again later.'));
  }
  if (r.status === 404 || r.status === 410) throw userError(tr('That calendar link no longer works. In Google Calendar, copy the secret address again.'));
  if (r.status === 401 || r.status === 403) throw userError(tr('Google won’t share this calendar. Use the secret address in iCal format, or make the calendar public.'));
  if (r.status >= 400) throw userError(tr('The calendar link answered with an error ({code}).', { code: r.status }));
  try {
    const cal = parseIcs(r.text);
    cal.via = r.via;
    return cal;
  } catch {
    throw userError(tr('That link isn’t a calendar (.ics) file.'));
  }
}

export const statusOf = (id) => (store.getPrefs().calSync || {})[id] || null;
export function setStatus(id, st) {
  const all = { ...(store.getPrefs().calSync || {}) };
  if (st) all[id] = st;
  else delete all[id];
  store.setPrefs({ calSync: all });
}

export async function refresh(id, { manual = false } = {}) {
  const cal = store.get(id);
  if (!cal || !cal.sub || busy.has(id)) return null;
  busy.add(id);
  store.touch();
  try {
    const parsed = await readFeed(cal.sub.url);
    const now = store.get(id);
    if (!now) return null;
    if (!now.name && parsed.name) saveCalendar(id, { name: parsed.name });
    const items = feedItems(parsed, id, { prefix: 'ics', sinceMs: Date.now() - 400 * 86400000 });
    const stats = applyFeed(id, items, { prefix: 'ics' });
    setStatus(id, { ok: true, at: Date.now(), n: stats.total, via: parsed.via });
    if (manual) toast(stats.added + stats.updated + stats.removed ? tr('Updated “{name}”', { name: calName(now) }) : tr('“{name}” is up to date', { name: calName(now) }));
    return stats;
  } catch (e) {
    if (!(e && e.twUser)) console.warn('Checkmate calendar refresh', e);
    const msg = e && e.twUser ? e.message : tr('Couldn’t reach the calendar link. Checkmate will try again later.');
    if (store.get(id)) setStatus(id, { ok: false, at: Date.now(), msg, browser: !!(e && e.browserBlocked) });
    if (manual) {
      play('error');
      toast(msg);
    }
    return null;
  } finally {
    busy.delete(id);
    store.touch();
  }
}

export const refreshAll = (manual = true) => Promise.all(subscribed().map((c) => refresh(c.id, { manual })));

/** Adds a subscription and reads it straight away. */
export async function subscribe(url, { name = '', color = 'teal' } = {}) {
  const u = normalizeUrl(url);
  if (!u) throw userError(tr('Paste a calendar link that starts with https:// or webcal://.'));
  const existing = subscribed().find((c) => c.sub.url === u);
  if (existing) throw userError(tr('You already subscribe to this calendar.'));
  const cal = saveCalendar(null, { name: name || nameFromUrl(u), color, sub: { url: u }, defaultReminders: [], allDayReminders: [] });
  play('add');
  await refresh(cal.id, { manual: false });
  return cal;
}

function due() {
  const p = store.getPrefs();
  const every = p.calSyncEvery ?? 30;
  if (!every || offline()) return;
  const st = p.calSync || {};
  for (const c of subscribed()) {
    const s = st[c.id];
    // a browser that can't read the link only retries now and then
    const wait = s && s.browser ? Math.max(every, 360) : every;
    if (Date.now() - ((s && s.at) || 0) >= wait * 60000) refresh(c.id);
  }
}

// Like Docs & Sheets: check when the app opens (after the first cloud sync settles),
// every minute for any that are due, and when the app comes back to the front.
export function start() {
  let running = false;
  const tick = () => {
    if (document.visibilityState !== 'hidden') due();
  };
  const go = () => {
    if (running) return;
    running = true;
    tick();
    setInterval(tick, 60000);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && tick());
    window.addEventListener('online', tick);
  };
  const settled = () => ['off', 'synced', 'error', 'offline', 'signed-out'].includes(getSyncState().status);
  setTimeout(() => {
    if (settled()) return go();
    const stop = onSyncState(() => {
      if (settled()) {
        stop();
        go();
      }
    });
    setTimeout(() => {
      stop();
      go();
    }, 15000);
  }, 3000);
  window.tickwiseRefreshCalendars = () => refreshAll(true);
}

// When the last check was, in the app's language and time format.
export function when(at) {
  if (!at) return '';
  const d = new Date(at);
  const time = formatTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`, store.getPrefs().timeFormat);
  const day = ymd(d);
  return day === today() ? time : `${shortDate(day)} ${time}`;
}

/** Imports an .ics file into one of your calendars. Importing it again updates, not doubles. */
export function importFile(text, calId) {
  let parsed;
  try {
    parsed = parseIcs(text);
  } catch {
    throw userError(tr('That file isn’t a calendar (.ics) file.'));
  }
  const items = feedItems(parsed, calId, { prefix: 'imp', keepAlarms: true });
  const stats = applyFeed(calId, items, { prefix: 'imp', removeMissing: false });
  return { ...stats, name: parsed.name };
}

export const zh = isZh;
