// Pieces used only by the Red Dead Redemption 2 style (id "frontier"): the
// almanac page on Today and the tally of tasks done today. Other styles hide them.
import * as store from './store.js';
import { parseYmd, dayName, monthName } from './dates.js';
import { tr } from './i18n.js';

export const isFrontier = () => store.getPrefs().skin === 'frontier';

// A tear-off almanac page: month band, big day number, weekday.
export function FrontierDate({ date }) {
  const d = parseYmd(date);
  return (
    <div class="fr-date" aria-hidden="true">
      <span class="fr-month">{monthName(d.getMonth())}</span>
      <span class="fr-day">{d.getDate()}</span>
      <span class="fr-wd">{dayName(d.getDay())}</span>
    </div>
  );
}

// Small fixed wobble so the marks look drawn by hand but never jump between renders.
const wob = (n) => Math.sin(n * 12.9898 + 4.1) * 1.4;

// Tasks done today as tally marks, five to a gate: inked marks for what's done,
// faint pencil marks for the rest of the daily goal.
export function Tally({ done, goal }) {
  const g = Math.max(1, goal || 5);
  const shown = Math.min(Math.max(done, g), 25);
  const gates = Math.ceil(shown / 5);
  const W = 40;
  const marks = [];
  for (let i = 0; i < shown; i++) {
    const x = Math.floor(i / 5) * W;
    const k = i % 5;
    const d =
      k < 4
        ? `M${(x + 5 + k * 7 + wob(i)).toFixed(1)} ${(3 + wob(i + 9) * 0.6).toFixed(1)} L${(x + 4 + k * 7 + wob(i + 3)).toFixed(1)} ${(25 + wob(i + 5) * 0.6).toFixed(1)}`
        : `M${x} ${(20 + wob(i)).toFixed(1)} L${x + 33} ${(7 + wob(i + 2)).toFixed(1)}`;
    marks.push(<path key={i} d={d} class={i < done ? 'ink' : 'pencil'} />);
  }
  const label = tr('{done} of {goal} done today', { done, goal: g });
  return (
    <div class="fr-tally" role="img" aria-label={label}>
      <svg width={gates * W} height="28" viewBox={`-2 0 ${gates * W} 28`} aria-hidden="true">{marks}</svg>
      {done > 25 && <span class="fr-more">+{done - 25}</span>}
      <span class="fr-tally-text" aria-hidden="true">{label}</span>
    </div>
  );
}
