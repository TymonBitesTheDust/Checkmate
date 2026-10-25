// Connecting Claude: the "connector" record that the Claude connector checks, and the
// connector code itself (built from ../connector and filled in with this account's
// Firebase project and a private key).
//
// The record { id: 'claude', type: 'connector', secret, gen, tz, ... } syncs like any
// item. The connector refuses any token whose gen doesn't match, so changing gen
// ("Disconnect") cuts Claude off everywhere at once.
import * as store from './store.js';
import { localTz, validTz } from './tz.js';
import CONNECTOR_CODE from 'virtual:checkmate-connector';

export const ID = 'claude';
export const CONNECTOR_VERSION = (/version (\d+\.\d+\.\d+)/.exec(CONNECTOR_CODE) || [])[1] || '1.0.0';
// Opens Claude's "Add custom connector" dialog with the name and address filled in.
export const addToClaudeUrl = (mcp) =>
  `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Checkmate&connectorUrl=${encodeURIComponent(mcp)}`;
export const CLOUDFLARE_URL = 'https://dash.cloudflare.com/';

export const connector = () => store.get(ID);

function randomKey(bytes = 32) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const randomGen = () => crypto.getRandomValues(new Uint32Array(1))[0] % 2000000000 + 1;

// Makes the record the first time it's needed.
export function ensure() {
  const c = connector();
  if (c) return c;
  const prefs = store.getPrefs();
  return store.put({
    id: ID,
    type: 'connector',
    createdAt: Date.now(),
    secret: randomKey(),
    gen: randomGen(),
    tz: localTz(),
    dateOrder: prefs.dateOrder || 'dmy',
    duration: prefs.calDuration || 60,
    url: '',
  });
}

// The connector code with this account's settings written into CONFIG.
export function connectorCode(cfg, c = ensure()) {
  const config = JSON.stringify({ apiKey: cfg.apiKey, projectId: cfg.projectId, authDomain: cfg.authDomain || `${cfg.projectId}.firebaseapp.com`, secret: c.secret });
  const a = '/*CHECKMATE_CONFIG*/';
  const b = '/*END_CHECKMATE_CONFIG*/';
  const i = CONNECTOR_CODE.indexOf(a);
  const j = CONNECTOR_CODE.indexOf(b);
  return CONNECTOR_CODE.slice(0, i + a.length) + config + CONNECTOR_CODE.slice(j);
}

// "checkmate.me.workers.dev", "https://checkmate.me.workers.dev/mcp/" → the Worker's address.
export function workerBase(text) {
  let s = String(text || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (!/\./.test(u.hostname) && u.hostname !== 'localhost') return null;
  return u.origin;
}
export const mcpUrl = (base) => (base ? `${base}/mcp` : '');

const newer = (a, b) => {
  const x = String(a).split('.').map(Number);
  const y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

/**
 * Asks the Worker at that address whether it's a working Checkmate connector for this
 * Firebase project. Returns { ok, base, version, outdated } or throws an Error with a
 * sentence for the person (in English; the caller translates).
 */
export async function check(text, cfg) {
  const base = workerBase(text);
  if (!base) throw Object.assign(new Error('Paste the address Cloudflare shows for your Worker, like https://checkmate.yourname.workers.dev'), { key: 'bad-url' });
  let res;
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl && setTimeout(() => ctl.abort(), 12000);
  const notConnector = () =>
    Object.assign(new Error('That Worker isn’t running the Checkmate connector yet. In Cloudflare choose Edit code, replace everything with the connector code, then Deploy.'), { key: 'not-connector' });
  try {
    res = await fetch(`${base}/health`, { cache: 'no-store', signal: ctl ? ctl.signal : undefined });
  } catch {
    // The connector always allows the app to read /health; a site that answers but
    // doesn't (like Cloudflare's Hello World) is reachable, just not the connector.
    let reachable = false;
    try {
      await fetch(`${base}/health`, { cache: 'no-store', mode: 'no-cors', signal: ctl ? ctl.signal : undefined });
      reachable = true;
    } catch {}
    clearTimeout(timer);
    if (reachable) throw notConnector();
    throw Object.assign(new Error('Couldn’t reach {host}. Check the address, and that you chose Deploy in Cloudflare.'), { key: 'unreachable', host: new URL(base).host });
  }
  clearTimeout(timer);
  let info = null;
  try {
    info = await res.json();
  } catch {}
  if (!info || info.app !== 'checkmate-connector') throw notConnector();
  if (!info.ok) throw Object.assign(new Error('The connector is running without your settings. Copy the connector code again (it includes them), paste it into the Worker and Deploy.'), { key: 'no-config' });
  if (cfg && info.projectId !== cfg.projectId) {
    throw Object.assign(new Error('This connector belongs to the Firebase project “{other}”, but Checkmate syncs with “{mine}”. Copy the connector code again and redeploy.'), { key: 'other-project', other: info.projectId, mine: cfg.projectId });
  }
  return { ok: true, base, version: info.version, outdated: newer(CONNECTOR_VERSION, info.version) };
}

export function saveUrl(base) {
  const c = ensure();
  if (c.url !== base) store.patch(ID, { url: base });
}

export function setTimeZone(tz) {
  if (!validTz(tz)) return;
  ensure();
  store.patch(ID, { tz });
}

// Claude loses access straight away; connecting again from Claude gives a new sign-in.
export function disconnect() {
  ensure();
  store.patch(ID, { gen: randomGen(), authAt: null, authEmail: null });
}
