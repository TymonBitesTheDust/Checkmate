// Pieces used only by the Riot style: cut-out lettering, the date badge
// and the page-change wipe. Other styles hide them with CSS.
import { useEffect, useState } from 'preact/hooks';
import * as store from './store.js';
import { parseYmd, DAYS_SHORT, dayShort } from './dates.js';
import { isZh } from './i18n.js';

export const isRiot = () => store.getPrefs().skin === 'riot';

// Plain text inside a title node (strings nested in fragments/elements).
export function textOf(node) {
  if (node == null || node === false || node === true) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node.props) return textOf(node.props.children);
  return '';
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Small deterministic random generator, so a word always gets the same letters.
function rng(seed) {
  let s = seed || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

const FACES = ['f-anton', 'f-abril', 'f-brico', 'f-josefin'];
const CJK_FACES = ['f-c-heavy', 'f-c-serif', 'f-c-sans', 'f-c-kai'];
const LOOKS = ['plain', 'plain', 'inv', 'red', 'plain', 'inv'];

// Each letter gets its own face, box, size and tilt, like letters cut from different pages.
export function Ransom({ text, class: cls = '' }) {
  if (!text) return null;
  const rand = rng(hash(text));
  const words = text.split(/(\s+)/);
  let n = 0;
  return (
    <span class={`ransom ${cls}`} aria-hidden="true">
      {words.map((w, wi) =>
        /^\s+$/.test(w) ? (
          <span class="r-gap" key={`g${wi}`} />
        ) : (
          <span class="r-word" key={`w${wi}`}>
            {[...w].map((ch, ci) => {
              const first = n++ === 0;
              const han = /\p{Script=Han}/u.test(ch);
              const faces = han ? CJK_FACES : FACES;
              const face = first ? (han ? 'f-c-serif' : 'f-abril') : faces[Math.floor(rand() * faces.length)];
              const look = first ? 'inv' : LOOKS[Math.floor(rand() * LOOKS.length)];
              const size = first ? 1.3 : 0.86 + rand() * 0.26;
              const rot = (rand() * 2 - 1) * (first ? 6 : 9);
              const dy = (rand() * 2 - 1) * 0.06;
              return (
                <span
                  key={ci}
                  class={`r-ch ${face} ${look}`}
                  style={{ '--s': size.toFixed(2), '--r': `${rot.toFixed(1)}deg`, '--dy': `${dy.toFixed(2)}em` }}
                >
                  {first ? ch.toUpperCase() : ch}
                </span>
              );
            })}
          </span>
        ),
      )}
    </span>
  );
}

// A title that reads normally everywhere, and as cut-out lettering in Riot.
export function StyledTitle({ children }) {
  const text = textOf(children);
  return (
    <>
      <span class="title-normal">{children}</span>
      <Ransom text={text} />
    </>
  );
}

// Big tilted date block for the Today view.
export function RiotDate({ date }) {
  const d = parseYmd(date);
  const order = isZh() ? 'mdy' : store.getPrefs().dateOrder;
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return (
    <div class="riot-date" aria-hidden="true">
      <span class="rd-num">{order === 'mdy' ? `${m}/${day}` : `${day}/${m}`}</span>
      <span class="rd-day">{isZh() ? dayShort(d.getDay()) : DAYS_SHORT[d.getDay()].toUpperCase()}</span>
    </div>
  );
}

// Panels that sweep across when you change page (the Persona, Red Dead and Cyberpunk styles).
export function PageWipe({ routeKey }) {
  const [n, setN] = useState(0);
  useEffect(() => setN((x) => x + 1), [routeKey]);
  const skin = store.getPrefs().skin;
  if (!['riot', 'tide', 'frontier', 'neon'].includes(skin)) return null;
  return (
    <div class={`${skin}-wipe`} key={n} aria-hidden="true">
      <i />
      <i />
      <i />
    </div>
  );
}
