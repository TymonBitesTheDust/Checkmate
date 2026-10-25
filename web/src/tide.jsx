// Pieces used only by the Tide style: the moon-phase date, the stat bars on
// Today, the shatter effect and the keyboard guide. Other styles hide them.
import * as store from './store.js';
import { parseYmd, dayShort } from './dates.js';
import { tr, isZh } from './i18n.js';

export const isTide = () => store.getPrefs().skin === 'tide';

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

// Keyboard guide in the sidebar, styled like on-screen button prompts.
export function KeyHints() {
  return (
    <div class="key-hints" aria-hidden="true">
      <span class="kh-label">{tr('What will you do today?')}</span>
      <span class="kh-keys">
        <span><kbd>Q</kbd>{tr('Add')}</span>
        <span><kbd>/</kbd>{tr('Search')}</span>
        <span><kbd>?</kbd>{tr('Keys')}</span>
      </span>
    </div>
  );
}
