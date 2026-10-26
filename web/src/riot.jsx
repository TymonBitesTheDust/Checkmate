// Persona 5 style pieces (the Calling Card design): cut-out lettering, the date box,
// the wiggling red-and-cyan highlight, the star-ripple field behind the app, the
// completion stamp and the page-change wipe. They only render in the Persona 5 style;
// the cut-out titles keep a plain copy that the other styles show instead.
import { useEffect, useRef, useState } from 'preact/hooks';
import * as store from './store.js';
import { parseYmd, DAYS_SHORT, dayShort, today } from './dates.js';
import { isZh, tr } from './i18n.js';

export const isRiot = () => store.getPrefs().skin === 'riot';

// Animations follow Settings → Theme (Match device, Full or Reduced).
export function reducedMotion() {
  const m = store.getPrefs().motion || 'system';
  if (m === 'reduced') return true;
  if (m === 'full') return false;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

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

const FACES = ['f-anton', 'f-abril', 'f-bowlby', 'f-rubik', 'f-elite', 'f-arsenal'];
const CJK_FACES = ['f-c-heavy', 'f-c-serif', 'f-c-sans', 'f-c-kai'];

// Each letter gets its own face, box, size and tilt, like letters cut from different pages.
// Boxes: "blk" black with a white edge (most), "wht" white, "red" red.
export function Ransom({ text, class: cls = '', firstRed = false, seed = '' }) {
  if (!text) return null;
  const rand = rng(hash(seed + text));
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
              const face = faces[Math.floor(rand() * faces.length)];
              const pick = rand();
              let look = pick < 0.6 ? 'blk' : pick < 0.86 ? 'wht' : 'red';
              if (first && firstRed) look = 'red';
              const upper = first || rand() < 0.55;
              const size = first ? 1.16 : 0.84 + rand() * 0.26;
              const rot = (rand() * 2 - 1) * 8;
              const dy = (rand() * 2 - 1) * 0.06;
              return (
                <span
                  key={ci}
                  class={`r-ch ${face} ${look}`}
                  style={{ '--s': size.toFixed(2), '--r': `${rot.toFixed(1)}deg`, '--dy': `${dy.toFixed(2)}em` }}
                >
                  {upper ? ch.toUpperCase() : ch.toLowerCase()}
                </span>
              );
            })}
          </span>
        ),
      )}
    </span>
  );
}

// A title that keeps its plain text for screen readers and shows cut-out lettering.
export function StyledTitle({ children, firstRed = true }) {
  const text = textOf(children);
  return (
    <>
      <span class="title-normal">{children}</span>
      <Ransom text={text} firstRed={firstRed} />
    </>
  );
}

// The red and cyan shards that wiggle behind whatever is selected.
export function Shards() {
  if (!isRiot()) return null;
  return <span class="hl" aria-hidden="true" />;
}

// The completion stamp across a finished task.
export function Stamp({ repeat = false }) {
  if (!isRiot()) return null;
  const text = isZh() ? (repeat ? '再來！' : '搞定！') : repeat ? 'Next!' : 'Clear!';
  return (
    <span class="stamp" aria-hidden="true">
      <Ransom text={text} seed="stamp" />
    </span>
  );
}

const dateNums = (d) => {
  const order = isZh() ? 'mdy' : store.getPrefs().dateOrder;
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return order === 'mdy' ? [m, day] : [day, m];
};

// Big tilted date block for the Today view.
export function RiotDate({ date }) {
  const d = parseYmd(date);
  const [a, b] = dateNums(d);
  return (
    <div class="riot-date" aria-hidden="true">
      <span class="rd-num">{a}<i>/</i>{b}</span>
      <span class="rd-day">{isZh() ? dayShort(d.getDay()) : DAYS_SHORT[d.getDay()].toUpperCase()}</span>
    </div>
  );
}

function timeOfDay(h) {
  if (h < 5) return tr('Late night');
  if (h < 11) return tr('Morning');
  if (h < 13) return tr('Midday');
  if (h < 17) return tr('Afternoon');
  if (h < 21) return tr('Evening');
  return tr('Late night');
}

// The date box at the top of the menu: day/month, weekday and the time of day.
export function DateBox() {
  return isRiot() ? <DateBoxInner /> : null;
}
function DateBoxInner() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(iv);
  }, []);
  const [a, b] = dateNums(now);
  return (
    <div class="datebox" aria-hidden="true">
      <span class="db-date">{a}<i>/</i>{b}</span>
      <span class="db-side">
        <span class="db-wd">{isZh() ? dayShort(now.getDay()) : DAYS_SHORT[now.getDay()].toUpperCase()}</span>
        <span class="db-tod">{timeOfDay(now.getHours())}</span>
      </span>
    </div>
  );
}

// Panels that sweep across when you change page. Persona 5: a red and a black shard and
// a shake of the screen (not on the first load, and not with reduced motion). Persona 3,
// Red Dead Redemption 2 and Cyberpunk 2077 have their own wipes.
export function PageWipe({ routeKey }) {
  const [n, setN] = useState(0);
  const first = useRef(true);
  useEffect(() => {
    const wasFirst = first.current;
    first.current = false;
    if (isRiot()) {
      if (wasFirst) return;
      if (!reducedMotion()) {
        const app = document.querySelector('.app');
        if (app) {
          app.classList.remove('shake');
          void app.offsetWidth;
          app.classList.add('shake');
        }
      }
    }
    setN((x) => x + 1);
  }, [routeKey]);
  const skin = store.getPrefs().skin;
  if (skin === 'riot') {
    if (!n || reducedMotion()) return null;
    return (
      <div class="riot-wipe" key={n} aria-hidden="true">
        <i />
        <i />
      </div>
    );
  }
  if (!['tide', 'frontier', 'neon'].includes(skin)) return null;
  return (
    <div class={`${skin}-wipe`} key={n} aria-hidden="true">
      <i />
      <i />
      <i />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Star-ripple field: concentric five-point stars pulsing in a slanted panel,
// a canvas port of the Persona 5 menu's star shader.
// ---------------------------------------------------------------------------

export function StarField() {
  const ref = useRef(null);
  const prefs = store.getPrefs();
  const on = prefs.skin === 'riot' && prefs.stars !== false;
  const motion = prefs.motion || 'system';
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !on) return undefined;
    const ctx = cv.getContext('2d');
    if (!ctx) return undefined;
    let W = 0;
    let H = 0;
    let dpr = 1;
    let stars = [];
    let region = [];
    let raf = 0;
    let last = 0;
    const t0 = performance.now();
    let bootAt = performance.now();
    const inside = (x, y, poly) => {
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i];
        const [xj, yj] = poly[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    const starSub = (r) => {
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        const rr = k % 2 ? r * 0.47 : r;
        const x = Math.cos(a) * rr;
        const y = Math.sin(a) * rr;
        if (k) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.closePath();
    };
    const rnd = (() => {
      let s = 5150;
      return () => {
        s ^= s << 13;
        s >>>= 0;
        s ^= s >>> 17;
        s ^= s << 5;
        s >>>= 0;
        return s / 4294967296;
      };
    })();
    const layout = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      W = window.innerWidth;
      H = window.innerHeight;
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      const narrow = W < 900;
      const fr = narrow ? [[0.5, 0.42], [1.02, 0.18], [1.02, 1.02], [-0.02, 1.02]] : [[0.62, -0.02], [1.02, -0.02], [1.02, 1.02], [0.42, 1.02]];
      region = fr.map(([x, y]) => [x * W, y * H]);
      const big = Math.max(W, H);
      stars = [];
      const want = narrow ? 30 : 46;
      let guard = 0;
      while (stars.length < want && guard++ < 5000) {
        const x = rnd() * W;
        const y = rnd() * H;
        if (!inside(x, y, region)) continue;
        const layer = stars.length < want * 0.4 ? 1 : 0;
        stars.push({ x, y, layer, R: big * (layer ? 0.05 + rnd() * 0.05 : 0.03 + rnd() * 0.045), rot: rnd() * Math.PI * 2, speed: (layer ? -1 : 1) * (0.35 + rnd() * 0.25) });
      }
    };
    const draw = (ts) => {
      const t = (ts - t0) / 1000;
      const b = Math.min(1, (ts - bootAt) / 520);
      const k = b >= 1 ? 1 : 1 - Math.pow(1 - b, 3) * Math.cos(b * 7.5);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.beginPath();
      region.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = '#250006';
      ctx.fill();
      ctx.clip();
      for (const s of stars) {
        const R = s.R * Math.max(0, k);
        if (R < 1) continue;
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.rot);
        ctx.beginPath();
        starSub(R);
        ctx.clip();
        ctx.fillStyle = s.layer ? '#7a0910' : '#0b0002';
        ctx.fillRect(-R, -R, R * 2, R * 2);
        const w = R / 4.6;
        const ph = (((t * s.speed) % 1) + 1) % 1;
        ctx.beginPath();
        for (let rr = R + 2 * w - ph * 2 * w; rr > 0; rr -= 2 * w) {
          starSub(rr);
          starSub(Math.max(0.1, rr - w));
        }
        ctx.fillStyle = s.layer ? '#e5191c' : '#c8141b';
        ctx.fill('evenodd');
        ctx.restore();
      }
      ctx.restore();
      ctx.beginPath();
      ctx.moveTo(region[0][0], region[0][1]);
      ctx.lineTo(region[3][0], region[3][1]);
      ctx.lineWidth = 10;
      ctx.strokeStyle = '#0b0a0a';
      ctx.stroke();
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = '#d3d6d0';
      ctx.stroke();
    };
    const still = () => reducedMotion();
    const loop = (ts) => {
      raf = 0;
      if (document.hidden) return;
      if (ts - last >= 33) {
        last = ts;
        draw(ts);
      }
      if (!still()) raf = requestAnimationFrame(loop);
    };
    const restart = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      if (still()) {
        bootAt = -1e9;
        draw(performance.now());
      } else raf = requestAnimationFrame(loop);
    };
    let rT = 0;
    const onResize = () => {
      clearTimeout(rT);
      rT = setTimeout(() => {
        layout();
        restart();
      }, 120);
    };
    const onVis = () => {
      if (!document.hidden) restart();
    };
    layout();
    restart();
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(rT);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [on, motion]);
  if (!on) return null;
  return <canvas class="starfield" ref={ref} aria-hidden="true" />;
}

// "3 due today" under the menu.
export function HeroCount({ due, late }) {
  if (!isRiot()) return null;
  if (due === 0) {
    return (
      <div class="hero-count">
        <b>0</b>
        <span>{tr('All')}<br /><em>{tr('clear')}</em></span>
      </div>
    );
  }
  return (
    <div class="hero-count">
      <b>{due}</b>
      <span>{tr('Due today')}{late > 0 && <><br /><em>{tr('{n} late', { n: late })}</em></>}</span>
    </div>
  );
}

export const todayRef = today;
