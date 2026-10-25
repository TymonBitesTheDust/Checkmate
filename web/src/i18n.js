// Interface language. English strings are the keys; zh-Hant.js maps them to
// Traditional Chinese. Anything missing falls back to English.
//   t('Delete')                         -> 刪除
//   t('{n} open task{s}', { n: 3 })     -> "3 open tasks" / "3 項未完成任務"
import * as store from './store.js';
import ZH from './zh-Hant.js';

export const LANGUAGES = [
  ['system', 'Match device'],
  ['en', 'English'],
  ['zh-Hant', '繁體中文'],
];

let detected = null;
function detect() {
  if (detected) return detected;
  detected = 'en';
  try {
    const list = (typeof navigator !== 'undefined' && (navigator.languages || [navigator.language])) || [];
    for (const raw of list) {
      const l = String(raw || '').toLowerCase();
      if (/^zh-(tw|hk|mo|hant)/.test(l)) {
        detected = 'zh-Hant';
        break;
      }
      if (l.startsWith('en') || l.startsWith('zh')) break;
    }
  } catch {}
  return detected;
}

export function lang() {
  let pref = 'system';
  try {
    pref = store.getPrefs().language || 'system';
  } catch {}
  return pref === 'system' ? detect() : pref;
}

export const isZh = () => lang() === 'zh-Hant';

export function t(s, vars) {
  let out = isZh() && ZH[s] != null ? ZH[s] : s;
  if (vars) {
    if (vars.n != null && out.includes('{s}')) out = out.replace(/\{s\}/g, vars.n === 1 ? '' : 's');
    out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
  }
  return out.replace(/\{s\}/g, 's');
}

// Same function under a name that doesn't clash with the many `t` task variables.
export const tr = t;

// Text that has a Chinese form but no English key (e.g. a word inside a sentence).
export const pick = (en, zh) => (isZh() ? zh : en);
