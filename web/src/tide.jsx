// Pieces used only by the Tide style: the moon-phase date, the stat bars on
// Today, the shatter effect and the keyboard guide. Other styles hide them.
import * as store from './store.js';
import { parseYmd, dayShort } from './dates.js';
import { tr, isZh } from './i18n.js';

export const isTide = () => store.getPrefs().skin === 'tide';

// ---------- the page name on the ribbon ----------

// How long a page name runs in Montserrat Black Italic, in em (measured letter by letter, with
// the ribbon's -0.04em tracking; Chinese characters stand upright at about 1.1em each). The
// ribbon divides the window's height by this, so a long name like PRODUCTIVITY shrinks to fit.
const EM = { A: 0.8, B: 0.73, C: 0.68, D: 0.79, E: 0.63, F: 0.6, G: 0.73, H: 0.76, I: 0.31, J: 0.53, K: 0.73, L: 0.58, M: 0.91, N: 0.76, O: 0.81, P: 0.69, Q: 0.81, R: 0.71, S: 0.62, T: 0.62, U: 0.73, V: 0.75, W: 1.16, X: 0.72, Y: 0.68, Z: 0.65, '&': 0.74, ' ': 0.25, '/': 0.33, '-': 0.36 };
export function ribbonEms(text) {
  let n = 0;
  for (const c of String(text || '').toUpperCase()) n += EM[c] ?? (/[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(c) ? 1.1 : /[0-9]/.test(c) ? 0.62 : 0.72);
  return Math.max(1, +(n * 1.04).toFixed(2));
}

// ---------- moon phase ----------

const SYNODIC = 29.530588853;
const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
const PHASES = [
  [1.84, 'New moon'],
  [5.53, 'Waxing crescent'],
  [9.22, 'First quarter'],
  [12.91, 'Waxing gibbous'],
  [16.61, 'Full moon'],
  [20.3, 'Waning gibbous'],
  [23.99, 'Last quarter'],
  [27.68, 'Waning crescent'],
  [99, 'New moon'],
];

export function moonPhase(ymd) {
  const d = parseYmd(ymd);
  d.setHours(21, 0, 0, 0); // evening, when people look up
  let age = ((d.getTime() - KNOWN_NEW_MOON) / 86400000) % SYNODIC;
  if (age < 0) age += SYNODIC;
  const name = PHASES.find(([limit]) => age < limit)[1];
  return { age, fraction: age / SYNODIC, name: tr(name) };
}

// In the southern hemisphere the moon looks mirrored left to right.
function southern() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    return /^(Australia|Antarctica)\/|^Pacific\/(Auckland|Chatham|Fiji|Noumea|Efate|Port_Moresby)|^America\/(Argentina|Sao_Paulo|Santiago|Montevideo|Asuncion|La_Paz|Lima|Punta_Arenas)|^Africa\/(Johannesburg|Maputo|Harare|Windhoek|Gaborone|Lusaka|Maseru|Mbabane)|^Indian\/(Mauritius|Reunion|Antananarivo)/.test(tz);
  } catch {
    return false;
  }
}

export function Moon({ fraction, size = 44 }) {
  const r = 20;
  const c = 24;
  const k = Math.cos(2 * Math.PI * fraction); // 1 = new, -1 = full
  const rx = Math.abs(k) * r;
  const waxing = fraction < 0.5;
  const crescent = k > 0;
  const lit = `M ${c} ${c - r} A ${r} ${r} 0 0 1 ${c} ${c + r} A ${rx.toFixed(2)} ${r} 0 0 ${crescent ? 0 : 1} ${c} ${c - r} Z`;
  const mirror = waxing === southern();
  return (
    <svg class="tide-moon" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <circle cx={c} cy={c} r={r} class="moon-dark" />
      {fraction > 0.015 && fraction < 0.985 && (
        <path d={lit} class="moon-lit" transform={mirror ? `translate(48 0) scale(-1 1)` : undefined} />
      )}
      <circle cx={c} cy={c} r={r} class="moon-rim" />
    </svg>
  );
}

export function TideDate({ date }) {
  const d = parseYmd(date);
  const order = isZh() ? 'mdy' : store.getPrefs().dateOrder;
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const phase = moonPhase(date);
  return (
    <div class="tide-date" title={phase.name}>
      <Moon fraction={phase.fraction} />
      <div class="td-text">
        <span class="td-num">{order === 'mdy' ? `${m}/${day}` : `${day}/${m}`}<small>{dayShort(d.getDay())}</small></span>
        <span class="td-phase">{phase.name}</span>
      </div>
    </div>
  );
}

// Two stat bars for Today: how close you are to the daily goal, and what's left.
export function TideStats({ done, left }) {
  const goal = Math.max(1, store.getPrefs().dailyGoal || 5);
  const doneW = Math.min(1, done / goal);
  const leftW = left + done ? left / (left + done) : 0;
  return (
    <div class="tide-stats" role="group" aria-label={tr('{done} of {goal} done today, {left} left', { done, goal, left })}>
      <div class="ts-row ts-done">
        <span class="ts-label">{tr('Done')}</span>
        <span class="ts-num">{done}<small>/{goal}</small></span>
        <span class="ts-bar"><i style={{ width: `${doneW * 100}%` }} /></span>
      </div>
      <div class="ts-row ts-left">
        <span class="ts-label">{tr('Left')}</span>
        <span class="ts-num">{left}</span>
        <span class="ts-bar"><i style={{ width: `${leftW * 100}%` }} /></span>
      </div>
    </div>
  );
}

// Glass shards that fly off a task's checkbox when it's completed.
export function Shatter() {
  return (
    <span class="shatter" aria-hidden="true">
      <i /><i /><i /><i /><i /><i /><i /><i />
    </span>
  );
}

// What each page is for, shown above the button prompts like the pause menu's help line.
const PAGE_HELP = {
  today: 'View / Clear today’s tasks',
  inbox: 'Sort new tasks',
  upcoming: 'Plan the days ahead',
  calendar: 'View / Change events',
  birthdays: 'Remember birthdays',
  filters: 'View / Edit filters and labels',
  completed: 'Look back at finished tasks',
  productivity: 'View stats / Set a daily goal',
  search: 'Find a task',
  project: 'View / Organize a project',
  label: 'Tasks with this label',
  filter: 'Tasks that match this filter',
};

// The Command help line with button prompts (bottom right in Persona 3).
export function KeyHints({ view }) {
  return (
    <div class="key-hints" aria-hidden="true">
      <span class="kh-label">{tr(PAGE_HELP[view] || 'What will you do today?')}</span>
      <span class="kh-cmd">{tr('Command')}</span>
      <span class="kh-keys">
        <span><kbd>Q</kbd>{tr('Add')}</span>
        <span><kbd>/</kbd>{tr('Search')}</span>
        <span><kbd>?</kbd>{tr('Keys')}</span>
      </span>
    </div>
  );
}
