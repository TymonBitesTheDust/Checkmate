// Pieces used only by the Cyberpunk 2077 style (id "neon"): the date readout on
// Today. (Its stat bars reuse TideStats.) Other styles hide it.
import * as store from './store.js';
import { parseYmd, DAYS_SHORT, dayShort } from './dates.js';
import { isZh } from './i18n.js';

export const isNeon = () => store.getPrefs().skin === 'neon';

const pad = (n) => String(n).padStart(2, '0');

export function NeonDate({ date }) {
  const d = parseYmd(date);
  const order = isZh() ? 'mdy' : store.getPrefs().dateOrder;
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  return (
    <div class="nn-date" aria-hidden="true">
      <span class="nn-wd">{isZh() ? dayShort(d.getDay()) : DAYS_SHORT[d.getDay()].toUpperCase()}</span>
      <span class="nn-num">{order === 'mdy' ? `${m}.${day}` : `${day}.${m}`}</span>
      <span class="nn-yr">{d.getFullYear()}</span>
    </div>
  );
}
