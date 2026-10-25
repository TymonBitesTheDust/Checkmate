// Docs & Sheets: turns a Google Doc or Google Sheet into tasks and keeps them up to date.
//
// One way only: the doc is read, its lines (or the sheet's rows) become tasks in a
// project, and later changes in the doc are applied to those tasks. A linked doc is
// stored as a synced item of type "docsource", so every device knows about it; how
// the last check went on this device lives in prefs.docSync.
//
// Each task made from a row gets a fixed id (ds_<source>_<row key>), so two devices
// reading the same doc create the same tasks instead of duplicates. A task remembers
// its row in task.src = { s: source id, f: file key, k: row key }.
import * as store from './store.js';
import * as A from './actions.js';
import { ui } from './bus.js';
import { toast } from './ui.jsx';
import { play } from './sound.js';
import { tr, isZh } from './i18n.js';
import { parseQuickAdd } from './parse.js';
import { today, ymd, formatTime, shortDate } from './dates.js';
import { nativeFetchText, hasNativeFetch } from './native.js';
import { getSyncState, onSyncState } from './sync.js';

const syncing = new Set();
let presetProject = null;
let jsonpFirst = false;

export const isSyncing = (id) => syncing.has(id);
export const sources = () => store.all('docsource').sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
export const sourceFor = (projectId) => store.all('docsource').find((s) => s.projectId === projectId) || null;

// The project menu sets this so the settings form opens with that project picked.
export function takePresetProject() {
  const id = presetProject;
  presetProject = null;
  return id;
}

// Errors meant for the person (shown as they are), as opposed to network failures.
function userError(message) {
  const e = new Error(message);
  e.twUser = true;
  return e;
}

// Short stable hash (53-bit cyrb), used for row keys and change detection.
function hash(s) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const pad = (n) => String(n).padStart(2, '0');
const same = (a, b) => a === b || JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// ---------------------------------------------------------------- links

export function parseLink(input) {
  let s = String(input || '').trim();
  if (!s) throw userError(tr('Paste a link to a Google Doc or Google Sheet.'));
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try {
    u = new URL(s);
  } catch {
    throw userError(tr('That doesn’t look like a Google Doc or Sheet link.'));
  }
  const host = u.hostname.toLowerCase();
  const path = u.pathname;
  const rk = u.searchParams.get('resourcekey') || null;
  const g = (u.hash + '&' + u.search).match(/[#&?]gid=(\d+)/);
  const gid = g ? g[1] : null;
  if (!/(^|\.)google\.com$/.test(host)) throw userError(tr('That doesn’t look like a Google Doc or Sheet link.'));
  if (/\/presentation\//.test(path) || /\/forms\//.test(path)) throw userError(tr('Only Google Docs and Google Sheets can be synced.'));
  let m;
  if ((m = path.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/e\/([\w-]+)/))) return { kind: 'sheet', pubId: m[1], gid, url: s };
  if ((m = path.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/([\w-]{20,})/))) return { kind: 'sheet', fileId: m[1], gid, rk, url: s };
  if ((m = path.match(/\/document\/(?:u\/\d+\/)?d\/e\/([\w-]+)/))) return { kind: 'doc', pubId: m[1], url: s };
  if ((m = path.match(/\/document\/(?:u\/\d+\/)?d\/([\w-]{20,})/))) return { kind: 'doc', fileId: m[1], rk, url: s };
  if (host === 'drive.google.com') {
    if ((m = path.match(/\/file\/(?:u\/\d+\/)?d\/([\w-]{20,})/))) return { kind: 'any', fileId: m[1], rk, url: s };
    const id = u.searchParams.get('id');
    if (id && /^[\w-]{20,}$/.test(id)) return { kind: 'any', fileId: id, rk, url: s };
  }
  throw userError(tr('That doesn’t look like a Google Doc or Sheet link.'));
}

// Identifies the file (and sheet tab), so the same doc can't be linked twice.
export const fileKey = (l) => `${l.fileId || 'e:' + l.pubId}:${l.gid && l.gid !== '0' ? l.gid : ''}`;
export const kindName = (k) => (k === 'sheet' ? tr('Google Sheet') : k === 'doc' ? tr('Google Doc') : tr('Google Drive file'));

// ---------------------------------------------------------------- fetching

async function get(url, { headers, native = true, referrer = false } = {}) {
  if (native) {
    const viaApp = nativeFetchText(url);
    if (viaApp) {
      const r = await viaApp;
      return { status: r.status, text: r.text, via: 'app' };
    }
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch(url, {
      headers,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      ...(referrer ? {} : { referrerPolicy: 'no-referrer' }),
      signal: ctl.signal,
    });
    return { status: r.status, text: await r.text(), via: 'web' };
  } finally {
    clearTimeout(timer);
  }
}

// Google answers with a sign-in page when a file isn't shared.
const isHtml = (s) => /^\s*(<!doctype html|<html|<head|<body)/i.test(s || '');

// Sheets' query endpoint can answer as a script, which a browser page may load from
// any site. This is how sheets are read in a plain browser.
function jsonp(url) {
  return new Promise((resolve, reject) => {
    const name = '__twGviz' + Math.random().toString(36).slice(2);
    const el = document.createElement('script');
    let settled = false;
    let timer = null;
    const end = (fn, v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        delete window[name];
      } catch {
        window[name] = undefined;
      }
      el.remove();
      fn(v);
    };
    window[name] = (data) => end(resolve, data);
    el.onerror = () => end(reject, new Error('jsonp failed'));
    el.onload = () => setTimeout(() => end(reject, new Error('jsonp no response')), 60);
    timer = setTimeout(() => end(reject, new Error('jsonp timeout')), 25000);
    el.referrerPolicy = 'no-referrer';
    el.src = url.replace('tqx=out:json', 'tqx=out:json;responseHandler:' + name);
    document.head.appendChild(el);
  });
}

function gvizParse(text) {
  if (!text || isHtml(text)) return null;
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  try {
    return JSON.parse(text.slice(a, b + 1));
  } catch {
    return null;
  }
}

function gvizTable(data) {
  if (!data || typeof data !== 'object') throw new Error('bad gviz');
  if (data.status === 'error') {
    const err = (data.errors || [])[0] || {};
    const reason = err.reason || '';
    if (/access_denied|user_not_authenticated|not_authenticated|permission/i.test(reason)) throw userError(shareMessage('sheet'));
    throw userError(tr('Google Sheets said: {msg}', { msg: err.detailed_message || err.message || reason || 'error' }));
  }
  const t = data.table || { cols: [], rows: [] };
  return {
    cols: (t.cols || []).map((c) => (c && c.label) || ''),
    rows: (t.rows || []).map((r) => ((r && r.c) || []).map((c) => c || null)),
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const cols = rows.shift() || [];
  return { cols, rows: rows.map((r) => r.map((v) => (v === '' ? null : { v, f: v }))) };
}

function shareMessage(kind) {
  return kind === 'sheet'
    ? tr('Checkmate couldn’t open this sheet. In Google Sheets choose Share → General access → “Anyone with the link”, then try again.')
    : tr('Checkmate couldn’t read this doc. Share it with “Anyone with the link”. In a web browser, Google only lets Checkmate read Docs through a Google API key — add one under “Reading Google Docs” below.');
}

const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
const OFFLINE = () => tr('You’re offline. Checkmate will try again when you’re back online.');

async function loadSheet(l) {
  const rk = l.rk ? `&resourcekey=${encodeURIComponent(l.rk)}` : '';
  const gid = l.gid ? `&gid=${l.gid}` : '';
  if (l.fileId) {
    const url = `https://docs.google.com/spreadsheets/d/${l.fileId}/gviz/tq?tqx=out:json&headers=1${gid}${rk}`;
    const direct = async () => {
      const r = await get(url);
      const data = gvizParse(r.text);
      return data ? { ...gvizTable(data), via: r.via } : null;
    };
    const script = async () => {
      if (typeof document === 'undefined') return null;
      const data = await jsonp(url);
      jsonpFirst = true;
      return { ...gvizTable(data), via: 'web' };
    };
    for (const attempt of jsonpFirst ? [script, direct] : [direct, script]) {
      try {
        const r = await attempt();
        if (r) return r;
      } catch (e) {
        if (e.twUser) throw e;
      }
    }
    try {
      const r = await get(`https://docs.google.com/spreadsheets/d/${l.fileId}/export?format=csv${gid}${rk}`);
      if (r.status === 200 && !isHtml(r.text)) return { ...parseCsv(r.text), via: r.via };
    } catch {}
  } else if (l.pubId) {
    try {
      const r = await get(`https://docs.google.com/spreadsheets/d/e/${l.pubId}/pub?output=csv${gid}`);
      if (r.status === 200 && !isHtml(r.text)) return { ...parseCsv(r.text), via: r.via };
    } catch {}
  }
  if (offline()) throw userError(OFFLINE());
  throw userError(shareMessage('sheet'));
}

function driveError(status, err) {
  const msg = (err && err.message) || '';
  const why = `${(err && err.errors && err.errors[0] && err.errors[0].reason) || ''} ${(err && err.status) || ''} ${JSON.stringify((err && err.details) || '')} ${msg}`;
  const keyProblem = (e) => ((e.keyIssue = true), e);
  if (/REFERRER_BLOCKED|referer/i.test(why))
    return keyProblem(userError(tr('This API key is limited to certain websites. In Google Cloud console edit the key and remove the website restriction, or allow this site.')));
  if (/accessNotConfigured|SERVICE_DISABLED|has not been used|is disabled/i.test(why))
    return keyProblem(userError(tr('The Google Drive API is off for this API key’s project. In Google Cloud console open APIs & Services → Library → Google Drive API and choose Enable.')));
  if (/API_KEY_SERVICE_BLOCKED|blocked/i.test(why))
    return keyProblem(userError(tr('This API key isn’t allowed to use the Google Drive API. Edit the key in Google Cloud console and allow Google Drive API under API restrictions.')));
  if (/API key not valid|keyInvalid|API_KEY_INVALID/i.test(why)) return keyProblem(userError(tr('That Google API key isn’t valid. Copy it again from Google Cloud console.')));
  if (/exportSizeLimitExceeded/i.test(why)) return userError(tr('This doc is too large for Google to export.'));
  if (status === 404 || status === 403) return userError(tr('Google says this doc isn’t shared. Share it with “Anyone with the link” and check the link.'));
  return userError(tr('Google Drive said: {msg}', { msg: msg || String(status) }));
}

// The Drive API allows any site, so with an API key a browser can read a shared Doc.
async function driveExport(fileId, key, rk) {
  const headers = rk ? { 'X-Goog-Drive-Resource-Keys': `${fileId}/${rk}` } : undefined;
  for (const mime of ['text/markdown', 'text/plain']) {
    const r = await get(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(mime)}&key=${encodeURIComponent(key)}`,
      { headers, native: false, referrer: true },
    );
    if (r.status === 200) return { text: r.text, fmt: mime === 'text/markdown' ? 'md' : 'txt' };
    let err = null;
    try {
      err = JSON.parse(r.text).error;
    } catch {}
    const e = driveError(r.status, err);
    // Markdown export is newer; fall back to plain text unless the key itself is the problem.
    if (mime === 'text/markdown' && !e.keyIssue && !/exportSizeLimitExceeded/i.test(JSON.stringify(err || ''))) continue;
    throw e;
  }
  throw userError(tr('Google Drive couldn’t export this doc.'));
}

async function loadDoc(l) {
  const rk = l.rk ? `&resourcekey=${encodeURIComponent(l.rk)}` : '';
  const prefs = store.getPrefs();
  const myKey = (prefs.docsApiKey || '').trim();
  let keyError = null;
  const direct = async () => {
    if (l.fileId) {
      for (const fmt of ['md', 'txt']) {
        try {
          const r = await get(`https://docs.google.com/document/d/${l.fileId}/export?format=${fmt}${rk}`);
          if (r.status === 200 && r.text && !isHtml(r.text)) return { text: r.text, via: r.via };
        } catch {}
      }
    } else if (l.pubId) {
      try {
        const r = await get(`https://docs.google.com/document/d/e/${l.pubId}/pub?embedded=true`);
        if (r.status === 200 && r.text) return { text: htmlToMarkdown(r.text), via: r.via };
      } catch {}
    }
    return null;
  };
  const withKey = async (key) => {
    if (!l.fileId || !key) return null;
    try {
      return { ...(await driveExport(l.fileId, key, l.rk)), via: 'api', apiKey: key };
    } catch (e) {
      keyError = keyError || e;
      return null;
    }
  };
  // The Windows and Android apps can read a shared doc directly, so they try that
  // first; a browser page can only get at it through the Drive API with a key.
  const attempts = [];
  if (hasNativeFetch()) attempts.push(direct);
  for (const key of [myKey, l.apiKey].filter((k, i, a) => k && a.indexOf(k) === i)) attempts.push(() => withKey(key));
  if (!hasNativeFetch()) attempts.push(direct);
  // A Firebase web key is a Google API key too; it works if that project has the Drive API on.
  const fbKey = prefs.firebaseConfig && prefs.firebaseConfig.apiKey;
  if (fbKey && fbKey !== myKey && fbKey !== l.apiKey) {
    attempts.push(() =>
      withKey(fbKey).then((r) => {
        // Don't blame a key the person never gave us.
        if (!r && !myKey && !l.apiKey) keyError = null;
        return r;
      }),
    );
  }
  for (const attempt of attempts) {
    const r = await attempt();
    if (r) return r;
  }
  if (offline()) throw userError(OFFLINE());
  throw keyError || userError(shareMessage('doc'));
}

// A published doc ("File → Share → Publish to web") comes back as a web page.
function htmlToMarkdown(html) {
  if (typeof DOMParser === 'undefined') return html.replace(/<[^>]+>/g, '\n');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.querySelector('#contents') || doc.querySelector('.doc-content') || doc.body;
  const struck = new Set();
  doc.querySelectorAll('style').forEach((st) => {
    for (const m of st.textContent.matchAll(/\.([\w-]+)\s*\{[^}]*line-through/g)) struck.add(m[1]);
  });
  const text = (node) => {
    let out = '';
    node.childNodes.forEach((c) => {
      if (c.nodeType === 3) out += c.nodeValue;
      else if (c.nodeType === 1) {
        if (c.tagName === 'BR') {
          out += ' ';
          return;
        }
        if (/^(STYLE|SCRIPT)$/.test(c.tagName)) return;
        const inner = text(c);
        const strike = /^(S|DEL|STRIKE)$/.test(c.tagName) || /line-through/.test(c.getAttribute('style') || '') || [...c.classList].some((k) => struck.has(k));
        out += strike && inner.trim() ? `~~${inner}~~` : inner;
      }
    });
    return out;
  };
  const lines = [];
  if (root) {
    root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li').forEach((el) => {
      if (el.tagName !== 'LI' && el.closest('li')) return;
      const t = text(el).replace(/\s+/g, ' ').trim();
      if (!t) return;
      if (/^H\d$/.test(el.tagName)) {
        lines.push('#'.repeat(+el.tagName[1]) + ' ' + t);
        return;
      }
      if (el.tagName === 'LI') {
        const list = el.parentElement;
        let depth = 0;
        const m = ((list && list.className) || '').match(/lst-kix_\w+-(\d+)/);
        if (m) depth = +m[1];
        else for (let p = list && list.parentElement; p && p !== root; p = p.parentElement) if (/^(UL|OL)$/.test(p.tagName)) depth++;
        lines.push('    '.repeat(depth) + '- ' + t);
        return;
      }
      lines.push(t);
    });
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- reading lines and rows

// Markdown-ish inline text: checkbox marks, links, emphasis and strikethrough.
function inline(s) {
  let text = String(s || '');
  let done = false;
  const links = [];
  let m = text.match(/^\s*\[([ xX✓✔])\]\s*/);
  if (m) {
    done = m[1] !== ' ';
    text = text.slice(m[0].length);
  } else if ((m = text.match(/^\s*([☐□☑☒✅✔✓])\s*/))) {
    done = !/[☐□]/.test(m[1]);
    text = text.slice(m[0].length);
  }
  const escaped = [];
  text = text
    .replace(/\\([\\`*_{}[\]()#+\-.!|>~<"'=$&@%^:;,?/])/g, (_, ch) => (escaped.push(ch), `\u0000${escaped.length - 1}\u0001`))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, label, href) => (links.push(href), label || href))
    .replace(/<\/?[a-z][^>]*>/gi, '');
  if (/~~/.test(text)) {
    // A line that is struck through from start to end counts as done.
    const rest = text.replace(/~~[\s\S]*?~~/g, '').replace(/[\s.,;:!?\-–—]/g, '');
    if (!rest && text.replace(/~~/g, '').trim()) done = true;
    text = text.replace(/~~/g, '');
  }
  text = text
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?!\w)/g, '$1$2')
    .replace(/(^|[^\w_])_(?=\S)([^_]*?\S)_(?!\w)/g, '$1$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\u0000(\d+)\u0001/g, (_, i) => escaped[+i])
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' })[e])
    .replace(/\s+/g, ' ')
    .trim();
  return { text, done, links };
}

// Dates, priorities and @labels written in the text, the same way as quick add.
function understand(text, opts) {
  if (!opts.parseText) return { title: text };
  try {
    const p = store.getPrefs();
    const r = parseQuickAdd(text, {
      ref: today(),
      disabled: new Set(['project', 'section']),
      labels: A.labels().map((l) => ({ id: l.id, name: l.name })),
      dateOrder: p.dateOrder,
      timeFormat: p.timeFormat,
    });
    const due = r.due && r.due.date ? { date: r.due.date, time: r.due.time || null, recur: r.due.recur || null } : undefined;
    return { title: r.title || text, due, priority: r.priority || undefined, labels: r.labels && r.labels.length ? r.labels : undefined };
  } catch {
    return { title: text };
  }
}

// Lines of a doc → entries. Headings become sections, indented bullets subtasks.
// mode: 'auto' (bullets and checklists, or every line if there are none), 'lists', 'all'.
export function docEntries(text, opts = {}) {
  const lines = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let fenced = false;
  for (let line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || !line.trim()) continue;
    line = line.replace(/\t/g, '    ').replace(/ /g, ' ');
    let m;
    if ((m = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/))) {
      blocks.push({ kind: 'h', level: m[1].length, text: m[2] });
      continue;
    }
    // rules and tables
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line) || /^\s*\|?[\s:|-]*-{3,}[\s:|-]*$/.test(line) || /^\s*\|.*\|\s*$/.test(line)) continue;
    if ((m = line.match(/^(\s*)(?:[-*+•◦▪▫●○■‣⁃]|\d{1,3}[.)])\s+(.*)$/))) {
      blocks.push({ kind: 'li', indent: m[1].length, text: m[2] });
      continue;
    }
    if ((m = line.match(/^(\s*)([☐□☑☒✅].*)$/))) {
      blocks.push({ kind: 'li', indent: m[1].length, text: m[2] });
      continue;
    }
    blocks.push({ kind: 'p', indent: 0, text: line.replace(/^\s*>\s?/, '') });
  }
  // A single top heading is the doc's title, not a section.
  let title = null;
  if (blocks[0] && blocks[0].kind === 'h' && blocks[0].level === 1 && blocks.filter((b) => b.kind === 'h' && b.level === 1).length === 1) {
    title = inline(blocks[0].text).text || null;
    blocks.shift();
  }
  const mode = opts.mode || 'auto';
  const hasLists = blocks.some((b) => b.kind === 'li');
  const everyLine = mode === 'all' || (mode === 'auto' && !hasLists);
  const entries = [];
  let section = null;
  let stack = []; // open bullets: { indent, i }
  const count = new Map();
  for (const b of blocks) {
    if (b.kind === 'h') {
      section = inline(b.text).text || null;
      stack = [];
      continue;
    }
    if (b.kind === 'p' && !everyLine) {
      stack = [];
      continue;
    }
    const t = inline(b.text);
    if (!t.text) continue;
    const indent = b.kind === 'li' ? b.indent : 0;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = b.kind === 'li' && stack.length ? stack[stack.length - 1].i : -1;
    const u = understand(t.text, opts);
    const name = u.title || t.text;
    const n = norm(name);
    const nth = count.get(n) || 0;
    count.set(n, nth + 1);
    const e = {
      k: `t:${n}#${nth}`,
      title: name,
      done: t.done,
      section,
      parent,
      due: u.due,
      priority: u.priority,
      labels: u.labels,
      desc: t.links.length ? t.links.join('\n') : undefined,
    };
    e.h = hash([t.text, section || '', parent >= 0 ? entries[parent].k : '', b.kind].join('\u0001'));
    entries.push(e);
    if (b.kind === 'li') stack.push({ indent, i: entries.length - 1 });
    else stack = [];
  }
  return { entries: entries.slice(0, 3000), title };
}

// Column headings Checkmate understands, in English and Chinese.
const COLUMNS = {
  id: ['id', 'key', 'uid', 'row id', '編號', '代號', '識別碼'],
  title: ['task', 'tasks', 'title', 'name', 'todo', 'to do', 'to-do', 'item', 'items', 'action', 'action item', 'what', 'subject', '任務', '標題', '名稱', '事項', '待辦', '待辦事項', '工作', '項目', '內容摘要'],
  done: ['done', 'completed', 'complete', 'status', 'state', 'check', 'checked', 'finished', '✓', '✔', '☑', '完成', '狀態', '已完成', '進度', '勾選'],
  due: ['due', 'due date', 'date', 'deadline', 'when', 'day', 'due on', '日期', '截止', '截止日期', '截止日', '到期', '到期日', '期限', '日子'],
  time: ['time', 'due time', 'at', '時間', '時刻'],
  priority: ['priority', 'pri', 'prio', 'importance', 'urgency', '優先', '優先級', '優先順序', '重要性', '緊急程度'],
  labels: ['labels', 'label', 'tags', 'tag', '標籤', '標記'],
  section: ['section', 'group', 'category', 'list', 'stage', 'phase', 'area', '分類', '區段', '分組', '類別', '階段', '清單', '組別'],
  desc: ['notes', 'note', 'description', 'details', 'desc', 'comment', 'comments', 'memo', 'info', '備註', '說明', '描述', '內容', '詳情', '附註', '筆記'],
};

function cellText(c) {
  if (!c) return '';
  if (typeof c.v === 'string') return c.v;
  if (c.f != null) return String(c.f);
  return c.v == null ? '' : String(c.v);
}
const cellRaw = (c) => (c ? [c.v === undefined ? null : c.v, c.f === undefined ? null : c.f] : null);

function cellDate(c) {
  if (!c || (c.v == null && !c.f)) return null;
  let date = null;
  let time = null;
  // Sheets sends dates as "Date(2026,9,17)" (months from 0); 1899-12-30 means time only.
  if (typeof c.v === 'string' && /^Date\(/.test(c.v)) {
    const n = (c.v.match(/-?\d+/g) || []).map(Number);
    if (n.length >= 3) {
      if (n[0] === 1899 && n[1] === 11 && n[2] === 30) time = n.length > 3 ? `${pad(n[3])}:${pad(n[4] || 0)}` : null;
      else {
        date = ymd(new Date(n[0], n[1], n[2]));
        if (n.length > 3 && (n[3] || n[4])) time = `${pad(n[3])}:${pad(n[4] || 0)}`;
      }
    }
    return date || time ? { date, time, recur: null } : null;
  }
  const s = cellText(c).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) return { date: `${m[1]}-${pad(m[2])}-${pad(m[3])}`, time: m[4] ? `${pad(m[4])}:${m[5]}` : null, recur: null };
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))) {
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    const [mo, d] = (store.getPrefs().dateOrder || 'dmy') === 'mdy' ? [m[1], m[2]] : [m[2], m[1]];
    if (+mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31) return { date: `${y}-${pad(mo)}-${pad(d)}`, time: null, recur: null };
  }
  // "next fri", "every monday", "明天下午3點"…
  return understand(s, { parseText: true }).due || null;
}

function cellTime(c) {
  if (!c || (c.v == null && !c.f)) return null;
  if (Array.isArray(c.v)) return `${pad(c.v[0] || 0)}:${pad(c.v[1] || 0)}`; // timeofday columns
  if (typeof c.v === 'string' && /^Date\(/.test(c.v)) {
    const n = (c.v.match(/-?\d+/g) || []).map(Number);
    return n.length > 3 ? `${pad(n[3])}:${pad(n[4] || 0)}` : null;
  }
  const m = cellText(c).trim().toLowerCase().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/);
  if (!m) return null;
  let h = +m[1];
  if (m[3]) {
    if (m[3][0] === 'p' && h < 12) h += 12;
    if (m[3][0] === 'a' && h === 12) h = 0;
  }
  return h > 23 || +(m[2] || 0) > 59 ? null : `${pad(h)}:${m[2] || '00'}`;
}

function cellDone(c) {
  if (!c) return false;
  if (typeof c.v === 'boolean') return c.v;
  if (typeof c.v === 'number') return c.v >= 1;
  return /^(done|x|✓|✔|☑|✅|yes|y|true|completed?|finished|closed|resolved|shipped|完成|已完成|做完|完成了|是|已做|已處理|已解決|v)$/i.test(cellText(c).trim().toLowerCase());
}

function cellPriority(c) {
  if (!c) return 4;
  if (typeof c.v === 'number') return c.v >= 1 && c.v <= 4 ? Math.round(c.v) : 4;
  const s = cellText(c).trim().toLowerCase();
  const m = s.match(/^p?\s*([1-4])$/);
  if (m) return +m[1];
  if (/^(!!!|urgent|critical|highest|top|緊急|最高|非常重要)/.test(s)) return 1;
  if (/^(!!|high|important|高|重要)/.test(s)) return 2;
  if (/^(!|medium|med|normal|mid|moderate|中|普通|一般)/.test(s)) return 3;
  return 4;
}

const cellLabels = (c) =>
  cellText(c)
    .split(/[,;，、；\n]+|\s+(?=[@#])/)
    .map((s) => s.trim().replace(/^[@#]+/, '').trim())
    .filter(Boolean);

// Rows of a sheet → entries. The first row holds the headings.
export function sheetEntries(table, opts = {}) {
  let heads = (table.cols || []).map((h) => String(h == null ? '' : h).trim());
  const rows = (table.rows || []).slice();
  const col = {};
  const used = new Set();
  const clean = (h) => h.toLowerCase().replace(/[\s_]+/g, ' ').replace(/[?:*：？。.]+$/, '').trim();
  const fields = ['id', 'title', 'done', 'due', 'time', 'priority', 'labels', 'section', 'desc'];
  // First exact heading names, then headings that contain one ("Due date (AEST)").
  for (let pass = 0; pass < 2; pass++) {
    for (const f of fields) {
      if (col[f] != null) continue;
      const names = COLUMNS[f];
      for (let i = 0; i < heads.length; i++) {
        if (used.has(i)) continue;
        const h = clean(heads[i]);
        if (!h) continue;
        const hit =
          pass === 0
            ? names.includes(h)
            : names.some((n) => (/[^\x00-\x7f]/.test(n) ? n.length > 1 && h.includes(n) : n.length > 2 && ` ${h} `.includes(` ${n} `)));
        if (hit) {
          col[f] = i;
          used.add(i);
          break;
        }
      }
    }
  }
  // No known headings: the first row is a task too.
  if (!Object.keys(col).length && heads.some(Boolean)) {
    rows.unshift(heads.map((h) => (h ? { v: h, f: h } : null)));
    heads = heads.map(() => '');
  }
  if (col.title == null) {
    let first = -1;
    for (let i = 0; i < Math.max(heads.length, (rows[0] || []).length); i++) {
      if (used.has(i)) continue;
      if (rows.some((r) => r[i] && typeof r[i].v === 'string' && r[i].v.trim())) {
        first = i;
        break;
      }
    }
    col.title = first >= 0 ? first : 0;
  }
  const has = (f) => col[f] != null;
  const entries = [];
  const count = new Map();
  for (const row of rows) {
    const cell = (f) => (has(f) && row ? row[col[f]] || null : null);
    const raw = cellText(cell('title')).replace(/\s+/g, ' ').trim();
    if (!raw) continue;
    const u = understand(raw, opts);
    const name = u.title || raw;
    let due = has('due') ? cellDate(cell('due')) : undefined;
    const time = has('time') ? cellTime(cell('time')) : null;
    if ((due === null || due === undefined) && u.due) due = u.due;
    if (due && time) due = { ...due, time };
    if (due && !due.date) due = time && has('due') ? null : undefined;
    if (has('due') && due === undefined) due = null;
    const priority = has('priority') ? (cellText(cell('priority')).trim() ? cellPriority(cell('priority')) : u.priority || 4) : u.priority;
    const labels = has('labels') ? [...new Set([...cellLabels(cell('labels')), ...(u.labels || [])])] : u.labels;
    const id = has('id') && cellText(cell('id')).trim();
    let k;
    if (id) k = `id:${id}`;
    else {
      const n = norm(name);
      const nth = count.get(n) || 0;
      count.set(n, nth + 1);
      k = `t:${n}#${nth}`;
    }
    entries.push({
      k,
      title: name,
      done: has('done') ? cellDone(cell('done')) : false,
      section: has('section') ? cellText(cell('section')).trim() || null : undefined,
      parent: -1,
      due,
      priority,
      labels,
      desc: has('desc') ? cellText(cell('desc')).trim() : undefined,
      h: hash(JSON.stringify([raw, cellRaw(cell('due')), cellRaw(cell('time')), cellRaw(cell('priority')), cellRaw(cell('labels')), cellRaw(cell('section')), cellRaw(cell('desc'))])),
    });
  }
  return { entries: entries.slice(0, 3000), title: null };
}

// Reads a linked doc or sheet. A Drive link ("any") is tried as a sheet, then as a doc.
export async function load(src) {
  const opts = { mode: src.mode || 'auto', parseText: src.parseText !== false };
  const asSheet = async () => {
    const t = await loadSheet(src);
    return { kind: 'sheet', ...sheetEntries(t, opts), via: t.via };
  };
  const asDoc = async () => {
    const d = await loadDoc(src);
    return { kind: 'doc', ...docEntries(d.text, opts), via: d.via, apiKey: d.apiKey };
  };
  if (src.kind === 'sheet') return asSheet();
  if (src.kind === 'doc') return asDoc();
  let sheetErr;
  try {
    return await asSheet();
  } catch (e) {
    sheetErr = e;
  }
  try {
    return await asDoc();
  } catch (e) {
    throw e.twUser && !/sheet/i.test(e.message) ? e : sheetErr;
  }
}

// ---------------------------------------------------------------- applying to tasks

const CONTENT = ['title', 'due', 'priority', 'labels', 'desc', 'sectionId', 'parentId'];

// Brings the project in line with what was read. A row that hasn't changed in the doc
// leaves its task alone, so edits made in Checkmate stay until that row changes.
export function apply(src, result) {
  const project = store.get(src.projectId);
  if (!project) throw userError(tr('The project for this link was deleted. Stop syncing, then link the doc again.'));
  if (project.archived) throw userError(tr('The project for this link is archived.'));
  const pid = project.id;
  const fk = src.fkey || fileKey(src);
  const entries = result.entries || [];
  const now = Date.now();
  const stats = { added: 0, updated: 0, done: 0, removed: 0 };

  // Tasks already made from this link, by row key. Tasks from an earlier link to the
  // same file whose link was removed are taken over, if they're still in this project.
  const linked = new Map();
  const live = new Set(store.all('docsource').map((s) => s.id));
  for (const t of A.tasks()) {
    if (!t.src || t.src.f !== fk || (t.src.s !== src.id && (live.has(t.src.s) || t.projectId !== pid))) continue;
    const prev = linked.get(t.src.k);
    const own = `ds_${src.id}_${t.src.k}`;
    if (!prev || t.id === own || (prev.id !== own && (t.createdAt || 0) < (prev.createdAt || 0))) linked.set(t.src.k, t);
  }
  // Open tasks typed in by hand, so the first sync adopts them instead of adding twins.
  const byTitle = new Map();
  for (const t of A.tasks()) {
    if (t.projectId !== pid || t.src || t.done) continue;
    const n = norm(t.title);
    if (!byTitle.has(n)) byTitle.set(n, []);
    byTitle.get(n).push(t);
  }
  const secIds = new Map(A.sections(pid).map((s) => [s.name.toLowerCase(), s.id]));
  const sectionId = (name) => {
    if (!name) return null;
    const k = name.toLowerCase();
    if (!secIds.has(k)) secIds.set(k, A.saveSection(null, { projectId: pid, name }).id);
    return secIds.get(k);
  };
  const labelIds = (names) => (names && names.length ? A.ensureLabels(names) : []);
  const before = src.rows || {};
  const rows = {};
  const ids = [];
  const kept = new Set();

  entries.forEach((e, i) => {
    const key = hash(e.k);
    const doneMark = e.done ? '1' : '0';
    const [prevHash, prevDone] = (before[key] || '').split('|');
    rows[key] = `${e.h}|${doneMark}`;
    const parentId = e.parent >= 0 ? ids[e.parent] || null : null;
    let task = linked.get(key);
    if (!task && !before[key]) {
      const twins = byTitle.get(norm(e.title));
      if (twins && twins.length) {
        task = twins.shift();
        linked.set(key, task);
      }
    }
    const id = `ds_${src.id}_${key}`;
    if (task) {
      const ch = {};
      const here = task.projectId === pid; // moved to another project: leave where it is
      if (prevHash !== e.h) {
        const want = { title: e.title };
        if (e.priority !== undefined) want.priority = e.priority || 4;
        if (e.labels !== undefined) want.labels = labelIds(e.labels);
        if (e.due !== undefined) want.due = e.due || null;
        if (e.desc !== undefined) want.desc = e.desc;
        if (here) {
          if (e.section !== undefined) want.sectionId = sectionId(e.section);
          want.parentId = parentId;
        }
        for (const f in want) if (!same(task[f], want[f])) ch[f] = want[f];
      }
      if (here && (task.order ?? 0) !== i + 1) ch.order = i + 1;
      const doneChanged = prevDone !== undefined ? prevDone !== doneMark : e.done;
      if (doneChanged && !!task.done !== e.done) {
        ch.done = e.done;
        ch.doneAt = e.done ? now : null;
        if (e.done) stats.done++;
      }
      if (!task.src || task.src.s !== src.id || task.src.k !== key || task.src.f !== fk) ch.src = { s: src.id, f: fk, k: key };
      if (Object.keys(ch).length) {
        store.patch(task.id, ch);
        if (CONTENT.some((f) => ch[f] !== undefined)) stats.updated++;
      }
      ids[i] = task.id;
      kept.add(task.id);
      return;
    }
    const old = store.raw(id);
    // Deleted in Checkmate: stays deleted until its row changes in the doc.
    if (before[key] && (prevHash === e.h || (old && old.deleted))) {
      ids[i] = null;
      return;
    }
    store.put({
      id,
      type: 'task',
      title: e.title,
      desc: e.desc || '',
      projectId: pid,
      sectionId: e.section ? sectionId(e.section) : null,
      parentId,
      priority: e.priority || 4,
      labels: labelIds(e.labels),
      due: e.due || null,
      done: e.done,
      doneAt: e.done ? now : null,
      order: i + 1,
      createdAt: (old && old.createdAt) || now,
      src: { s: src.id, f: fk, k: key },
    });
    ids[i] = id;
    kept.add(id);
    stats.added++;
  });

  // Rows gone from the doc. Completed tasks are kept; so are completed subtasks of a
  // removed task, which move up a level so they stay visible.
  if (src.removeMissing !== false) {
    for (const [key, t] of linked) {
      if (rows[key] || kept.has(t.id) || t.done || !store.get(t.id)) continue;
      for (const d of A.children(t.id)) if (d.done && !kept.has(d.id)) store.patch(d.id, { parentId: t.parentId || null });
      const gone = [t.id, ...A.descendants(t.id).filter((d) => !d.done && !kept.has(d.id)).map((d) => d.id)];
      gone.forEach((x) => store.remove(x));
      stats.removed++;
    }
  }

  const ch = {};
  if (!same(before, rows)) ch.rows = rows;
  if (result.kind && src.kind !== result.kind) ch.kind = result.kind;
  if (result.apiKey && src.apiKey !== result.apiKey) ch.apiKey = result.apiKey;
  if (!src.fkey) ch.fkey = fk;
  if (Object.keys(ch).length) store.patch(src.id, ch);
  stats.total = entries.length;
  return stats;
}

export function summary(s) {
  const parts = [];
  if (s.added) parts.push(tr('{n} added', { n: s.added }));
  if (s.updated) parts.push(tr('{n} updated', { n: s.updated }));
  if (s.done) parts.push(tr('{n} completed', { n: s.done }));
  if (s.removed) parts.push(tr('{n} removed', { n: s.removed }));
  return parts.join(isZh() ? '，' : ', ');
}

export const statusOf = (id) => (store.getPrefs().docSync || {})[id] || null;

export function setStatus(id, st) {
  const all = { ...(store.getPrefs().docSync || {}) };
  if (st) all[id] = st;
  else delete all[id];
  store.setPrefs({ docSync: all });
}

// When the last check was, in the app's language and time format.
export function when(at) {
  if (!at) return '';
  const d = new Date(at);
  const p = store.getPrefs();
  const time = formatTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`, p.timeFormat);
  const day = ymd(d);
  return day === today() ? time : `${shortDate(day)} ${time}`;
}

export async function syncSource(id, { manual = false } = {}) {
  const src = store.get(id);
  if (!src || src.type !== 'docsource' || syncing.has(id)) return null;
  syncing.add(id);
  store.touch();
  const name = () => {
    const p = store.get(src.projectId);
    return p ? A.projectName(p) : kindName(src.kind);
  };
  let out = null;
  try {
    const result = await load(src);
    const now = store.get(id);
    if (!now) return null; // unlinked while reading
    const s = apply(now, result);
    setStatus(id, { ok: true, at: Date.now(), n: s.total, via: result.via });
    const text = summary(s);
    if (manual) toast(text ? tr('Synced “{name}”: {summary}', { name: name(), summary: text }) : tr('“{name}” is up to date', { name: name() }));
    else if (text) toast(tr('Updated “{name}” from the linked doc: {summary}', { name: name(), summary: text }));
    out = s;
  } catch (e) {
    const msg = e && e.twUser ? e.message : offline() ? OFFLINE() : tr('Couldn’t reach Google. Checkmate will try again later.');
    if (!(e && e.twUser)) console.warn('Checkmate doc sync', e);
    if (store.get(id)) setStatus(id, { ok: false, at: Date.now(), msg });
    if (manual) {
      play('error');
      toast(msg);
    }
  } finally {
    syncing.delete(id);
    store.touch();
  }
  return out;
}

export const syncAll = (manual = true) => Promise.all(sources().map((s) => syncSource(s.id, { manual })));

function syncDue() {
  const p = store.getPrefs();
  const every = p.docSyncEvery ?? 15;
  if (!every || offline()) return;
  const st = p.docSync || {};
  for (const s of store.all('docsource')) {
    const last = (st[s.id] && st[s.id].at) || 0;
    if (Date.now() - last >= every * 60000) syncSource(s.id);
  }
}

// Checks linked docs when the app opens, every minute for any that are due, and when
// the app comes back to the front or online. Waits for the first cloud sync to finish,
// so tasks other devices already made from the doc arrive before this one reads it.
export function start() {
  let running = false;
  const tick = () => {
    if (document.visibilityState !== 'hidden') syncDue();
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
  }, 2500);
  window.tickwiseSyncLinkedDocs = () => syncAll(true);
}

// ---------------------------------------------------------------- project menu and header

export function projectMenuItems(p) {
  const s = sourceFor(p.id);
  if (s) {
    return [
      { label: tr('Sync from linked {kind} now', { kind: kindName(s.kind) }), icon: 'refresh', onSelect: () => syncSource(s.id, { manual: true }) },
      { label: tr('Linked doc settings'), icon: 'link', onSelect: () => ui.openSettings('docs') },
    ];
  }
  return [
    {
      label: tr('Sync from a Google Doc or Sheet…'),
      icon: 'link',
      onSelect: () => {
        presetProject = p.id;
        ui.openSettings('docs');
      },
    },
  ];
}

export function projectSubtitle(projectId, base) {
  const s = sourceFor(projectId);
  if (!s) return base;
  const note = s.kind === 'sheet' ? tr('Synced from a Google Sheet') : s.kind === 'doc' ? tr('Synced from a Google Doc') : tr('Synced from Google Drive');
  return base ? `${base} · ${note}` : note;
}
