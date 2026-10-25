// Sound effects, synthesised with the Web Audio API (no audio files).
// Every style has its own bank; events a style doesn't define fall back to Checkmate.
import * as store from './store.js';

let ctx = null;
let master = null;
let echoIn = null;
let noiseBuf = null;

function buildGraph(c) {
  const m = c.createGain();
  m.connect(c.destination);
  // A soft feedback echo, used by the Tide sounds.
  const e = c.createGain();
  const delay = c.createDelay(1);
  delay.delayTime.value = 0.19;
  const fb = c.createGain();
  fb.gain.value = 0.32;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2600;
  const wet = c.createGain();
  wet.gain.value = 0.55;
  e.connect(delay);
  delay.connect(lp);
  lp.connect(fb);
  fb.connect(delay);
  lp.connect(wet);
  wet.connect(m);
  // One second of white noise, reused for whooshes and snaps.
  const buf = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return { m, e, buf };
}

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  ({ m: master, e: echoIn, buf: noiseBuf } = buildGraph(ctx));
  return ctx;
}

// ---------- building blocks ----------

function tone({ f, to, sweep, type = 'sine', at = 0, len = 0.15, vol = 0.08, attack = 0.004, filter, fc = 2400, q = 0.7, echo = false, detune = 0 }) {
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + (sweep || len));
  if (detune) o.detune.value = detune;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  let node = o;
  if (filter) {
    const b = ctx.createBiquadFilter();
    b.type = filter;
    b.frequency.value = fc;
    b.Q.value = q;
    o.connect(b);
    node = b;
  }
  node.connect(g);
  g.connect(master);
  if (echo) g.connect(echoIn);
  o.start(t);
  o.stop(t + len + 0.05);
}

function noise({ at = 0, len = 0.1, vol = 0.04, type = 'bandpass', f = 1200, to, q = 1, attack = 0.003, echo = false }) {
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.setValueAtTime(f, t);
  if (to) b.frequency.exponentialRampToValueAtTime(to, t + len);
  b.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  src.connect(b);
  b.connect(g);
  g.connect(master);
  if (echo) g.connect(echoIn);
  src.start(t, Math.random() * 0.5);
  src.stop(t + len + 0.05);
}

const notes = (list, opts) => list.forEach((f, i) => tone({ f, at: i * (opts.step || 0.07), ...opts }));
const chord = (list, opts) => list.forEach((f) => tone({ f, ...opts }));

// ---------- banks ----------

const tickwise = {
  hover: () => tone({ f: 1700, len: 0.03, vol: 0.016 }),
  select: () => tone({ f: 880, to: 1100, len: 0.06, vol: 0.04 }),
  pop: () => tone({ f: 700, to: 1000, len: 0.05, vol: 0.03 }),
  open: () => {
    tone({ f: 520, to: 780, len: 0.09, vol: 0.045 });
    tone({ f: 1040, at: 0.02, len: 0.08, vol: 0.015 });
  },
  close: () => tone({ f: 780, to: 520, len: 0.09, vol: 0.04 }),
  nav: () => {
    tone({ f: 1300, len: 0.025, vol: 0.02 });
    noise({ len: 0.03, vol: 0.012, type: 'highpass', f: 4000 });
  },
  complete: () => notes([880, 1318.5], { step: 0.07, len: 0.22, vol: 0.08, attack: 0.01 }),
  uncomplete: () => notes([1318.5, 880], { step: 0.06, len: 0.16, vol: 0.05, attack: 0.01 }),
  add: () => {
    tone({ f: 600, to: 950, len: 0.07, vol: 0.06 });
    tone({ f: 1400, at: 0.05, len: 0.12, vol: 0.025 });
  },
  delete: () => {
    tone({ f: 420, to: 180, len: 0.18, vol: 0.06, type: 'triangle' });
    noise({ len: 0.15, vol: 0.025, type: 'lowpass', f: 2000, to: 300 });
  },
  drop: () => tone({ f: 180, to: 110, len: 0.1, vol: 0.07 }),
  error: () => {
    tone({ f: 233, type: 'triangle', len: 0.12, vol: 0.07 });
    tone({ f: 196, type: 'triangle', at: 0.12, len: 0.18, vol: 0.07 });
  },
  reminder: () => notes([784, 1046.5, 1318.5], { step: 0.12, len: 0.5, vol: 0.07, attack: 0.01 }),
  goal: () => {
    notes([1046.5, 1318.5, 1568, 2093], { step: 0.08, len: 0.35, vol: 0.06, attack: 0.01 });
    chord([1046.5, 1568], { at: 0.32, len: 0.7, vol: 0.04, attack: 0.02 });
  },
};

const LP = { filter: 'lowpass', fc: 2600 };
const archive = {
  hover: () => tone({ f: 1480, type: 'square', len: 0.025, vol: 0.016, ...LP }),
  select: () => notes([990, 1480], { type: 'square', step: 0.03, len: 0.03, vol: 0.028, ...LP }),
  pop: () => tone({ f: 1180, type: 'square', len: 0.03, vol: 0.024, ...LP }),
  open: () => {
    notes([740, 990, 1480], { type: 'square', step: 0.028, len: 0.03, vol: 0.028, ...LP });
    noise({ len: 0.05, vol: 0.01, f: 3000, q: 2 });
  },
  close: () => notes([1480, 990, 740], { type: 'square', step: 0.028, len: 0.03, vol: 0.026, ...LP }),
  nav: () => {
    noise({ len: 0.09, vol: 0.03, f: 2500, to: 900, q: 2 });
    tone({ f: 1980, type: 'square', len: 0.02, vol: 0.014, ...LP });
  },
  complete: () => {
    chord([660, 990], { type: 'square', len: 0.18, vol: 0.028, filter: 'lowpass', fc: 2200 });
    notes([1320, 1760, 2350, 2640], { type: 'square', step: 0.025, at: 0.05, len: 0.03, vol: 0.018, ...LP });
    tone({ f: 1320, at: 0.16, len: 0.4, vol: 0.03 });
  },
  uncomplete: () => notes([990, 660], { type: 'square', step: 0.04, len: 0.05, vol: 0.026, ...LP }),
  add: () => notes([880, 1175, 1568], { type: 'square', step: 0.025, len: 0.03, vol: 0.026, ...LP }),
  delete: () => {
    notes([1568, 1175, 880, 587], { type: 'square', step: 0.03, len: 0.035, vol: 0.026, ...LP });
    noise({ at: 0.04, len: 0.12, vol: 0.022, f: 1200, q: 3 });
  },
  drop: () => tone({ f: 220, type: 'square', len: 0.04, vol: 0.035, filter: 'lowpass', fc: 900 }),
  error: () => {
    tone({ f: 110, type: 'square', len: 0.22, vol: 0.045, filter: 'lowpass', fc: 800 });
    tone({ f: 104, type: 'square', len: 0.22, vol: 0.03, filter: 'lowpass', fc: 800 });
  },
  reminder: () => [0, 0.12, 0.36, 0.48].forEach((at) => tone({ f: 1568, type: 'square', at, len: 0.07, vol: 0.026, filter: 'lowpass', fc: 3000 })),
  goal: () => {
    notes([523.25, 659.25, 783.99, 1046.5, 1318.5], { type: 'square', step: 0.06, len: 0.1, vol: 0.026, ...LP });
    chord([1046.5, 1568], { at: 0.32, len: 0.7, vol: 0.035, attack: 0.02 });
  },
};

const kick = (at = 0, vol = 0.12) => tone({ f: 160, to: 45, sweep: 0.12, at, len: 0.16, vol, attack: 0.002 });
const snap = (at = 0, vol = 0.03) => noise({ at, len: 0.04, vol, type: 'highpass', f: 3000 });
const stab = (list, at = 0, vol = 0.02, len = 0.09) => chord(list, { type: 'square', at, len, vol, filter: 'lowpass', fc: 3200 });
const riot = {
  hover: () => {
    tone({ f: 2400, type: 'triangle', len: 0.02, vol: 0.018 });
    noise({ len: 0.015, vol: 0.01, type: 'highpass', f: 5000 });
  },
  select: () => {
    noise({ len: 0.05, vol: 0.03, type: 'highpass', f: 2500 });
    tone({ f: 1046.5, type: 'square', len: 0.05, vol: 0.022, filter: 'lowpass', fc: 4000 });
  },
  pop: () => {
    snap(0, 0.025);
    tone({ f: 1568, type: 'triangle', len: 0.03, vol: 0.025 });
  },
  open: () => {
    noise({ len: 0.18, vol: 0.035, f: 5000, to: 9000, q: 1 });
    notes([1046.5, 1568], { type: 'square', step: 0.04, len: 0.06, vol: 0.025, filter: 'lowpass', fc: 4000 });
  },
  close: () => {
    noise({ len: 0.12, vol: 0.03, f: 7000, to: 3000, q: 1 });
    tone({ f: 784, type: 'square', len: 0.05, vol: 0.022, filter: 'lowpass', fc: 3000 });
  },
  nav: () => {
    noise({ len: 0.22, vol: 0.05, f: 300, to: 3500, q: 0.8 });
    kick(0.17, 0.09);
  },
  complete: () => {
    kick(0, 0.14);
    stab([523.25, 659.25, 783.99], 0.01, 0.018, 0.1);
    tone({ f: 1046.5, type: 'square', at: 0.06, len: 0.16, vol: 0.028, filter: 'lowpass', fc: 4500 });
    tone({ f: 1568, type: 'square', at: 0.12, len: 0.22, vol: 0.028, filter: 'lowpass', fc: 4500 });
    noise({ at: 0.02, len: 0.35, vol: 0.028, type: 'highpass', f: 6000 });
  },
  uncomplete: () => {
    kick(0, 0.08);
    stab([392, 466.16], 0.01, 0.02, 0.1);
  },
  add: () => {
    kick(0, 0.1);
    stab([659.25, 783.99, 987.77], 0.01, 0.018, 0.08);
    snap(0.01);
  },
  delete: () => {
    noise({ len: 0.16, vol: 0.05, f: 8000, to: 600, q: 1.5 });
    kick(0.1, 0.12);
  },
  drop: () => {
    kick(0, 0.12);
    snap(0, 0.02);
  },
  error: () => chord([233.08, 246.94], { type: 'square', len: 0.2, vol: 0.026, filter: 'lowpass', fc: 1800 }),
  reminder: () => [0, 0.15, 0.3].forEach((at) => {
    kick(at, 0.08);
    stab([783.99, 987.77, 1174.66], at, 0.018, 0.08);
  }),
  goal: () => {
    [[523.25, 659.25, 783.99], [698.46, 880, 1046.5], [783.99, 987.77, 1174.66], [1046.5, 1318.5, 1568]].forEach((c, i) => {
      kick(i * 0.14, 0.1);
      stab(c, i * 0.14, 0.018, i === 3 ? 0.5 : 0.11);
    });
    noise({ at: 0.42, len: 0.6, vol: 0.03, type: 'highpass', f: 6000 });
  },
};

const bubble = (at, f0, vol) => tone({ f: f0, to: f0 * 2.6, sweep: 0.05, at, len: 0.07, vol });
const tide = {
  hover: () => bubble(0, 520, 0.018),
  select: () => {
    tone({ f: 1568, len: 0.25, vol: 0.026, echo: true });
    bubble(0, 700, 0.016);
  },
  pop: () => bubble(0, 600, 0.024),
  open: () => {
    tone({ f: 1400, to: 700, sweep: 0.06, len: 0.12, vol: 0.04 });
    tone({ f: 2637, at: 0.03, len: 0.5, vol: 0.018, echo: true });
  },
  close: () => tone({ f: 700, to: 1200, sweep: 0.08, len: 0.12, vol: 0.034 }),
  nav: () => {
    noise({ len: 0.32, vol: 0.06, type: 'lowpass', f: 300, to: 1400, q: 4 });
    bubble(0.1, 480, 0.02);
    bubble(0.17, 640, 0.016);
  },
  complete: () => {
    tone({ f: 523.25, type: 'triangle', len: 0.5, vol: 0.05, attack: 0.01 });
    notes([1567.98, 2093, 2637], { step: 0.06, len: 0.75, vol: 0.055, attack: 0.01, echo: true });
    noise({ at: 0.02, len: 0.08, vol: 0.025, type: 'highpass', f: 7000 });
    [3136, 3951, 4699].forEach((f, i) => tone({ f, at: 0.03 + i * 0.035, len: 0.15, vol: 0.01 }));
  },
  uncomplete: () => notes([2093, 1568], { step: 0.07, len: 0.4, vol: 0.035, attack: 0.01, echo: true }),
  add: () => {
    bubble(0, 500, 0.035);
    bubble(0.06, 750, 0.03);
    tone({ f: 2093, at: 0.08, len: 0.35, vol: 0.015, echo: true });
  },
  delete: () => {
    tone({ f: 600, to: 120, sweep: 0.3, len: 0.32, vol: 0.05 });
    noise({ len: 0.3, vol: 0.03, type: 'lowpass', f: 900, to: 200, q: 2 });
  },
  drop: () => tone({ f: 300, to: 900, sweep: 0.03, len: 0.08, vol: 0.05 }),
  error: () => chord([150, 143], { len: 0.32, vol: 0.05, attack: 0.01 }),
  reminder: () => notes([1046.5, 1318.5, 1568, 2093], { step: 0.15, len: 1, vol: 0.045, attack: 0.01, echo: true }),
  goal: () => {
    notes([1046.5, 1174.66, 1318.5, 1568, 1760, 2093, 2349.32], { step: 0.07, len: 0.6, vol: 0.035, attack: 0.01, echo: true });
    tone({ f: 523.25, type: 'triangle', len: 1.2, vol: 0.04, attack: 0.02 });
  },
};

// Red Dead Redemption 2 style: plucked guitar, a register bell, a rubber stamp,
// rustling paper and spurs.
const pluck = (f, at = 0, vol = 0.05, len = 0.45) => {
  tone({ f, type: 'sawtooth', at, len, vol, attack: 0.002, filter: 'lowpass', fc: Math.min(f * 4, 4200), q: 0.9 });
  tone({ f: f * 2, type: 'triangle', at, len: len * 0.6, vol: vol * 0.35, attack: 0.002 });
};
const strum = (list, at = 0, vol = 0.04, gap = 0.022, len = 0.6) => list.forEach((f, i) => pluck(f, at + i * gap, vol, len));
const bell = (f, at = 0, vol = 0.05, len = 1.1) => {
  tone({ f, at, len, vol, attack: 0.002 });
  tone({ f: f * 2.76, at, len: len * 0.5, vol: vol * 0.4, attack: 0.002 });
  tone({ f: f * 5.4, at, len: len * 0.25, vol: vol * 0.18, attack: 0.002 });
};
const thud = (at = 0, vol = 0.1) => {
  tone({ f: 120, to: 55, sweep: 0.1, at, len: 0.14, vol, attack: 0.002 });
  noise({ at, len: 0.06, vol: vol * 0.4, type: 'lowpass', f: 900 });
};
const rustle = (at = 0, len = 0.16, vol = 0.03) => noise({ at, len, vol, type: 'bandpass', f: 2400, to: 4200, q: 0.6 });
const spur = (at = 0, vol = 0.018) => [4186, 5274, 4699].forEach((f, i) => tone({ f, at: at + i * 0.03, len: 0.09, vol, attack: 0.001 }));
const frontier = {
  hover: () => tone({ f: 820, type: 'triangle', len: 0.035, vol: 0.022, filter: 'lowpass', fc: 1800 }),
  select: () => pluck(329.63, 0, 0.04, 0.3),
  pop: () => tone({ f: 640, type: 'triangle', len: 0.05, vol: 0.032, filter: 'lowpass', fc: 2000 }),
  open: () => {
    rustle(0, 0.18, 0.035);
    pluck(196, 0.02, 0.03, 0.35);
  },
  close: () => {
    rustle(0, 0.12, 0.028);
    tone({ f: 300, to: 180, len: 0.09, vol: 0.03, type: 'triangle' });
  },
  nav: () => {
    rustle(0, 0.22, 0.04);
    spur(0.08, 0.012);
  },
  complete: () => {
    thud(0, 0.11);
    bell(1568, 0.05, 0.045, 1);
  },
  uncomplete: () => {
    pluck(392, 0, 0.035, 0.25);
    pluck(293.66, 0.08, 0.035, 0.3);
  },
  add: () => strum([164.81, 246.94, 329.63, 415.3], 0, 0.03),
  delete: () => {
    noise({ len: 0.22, vol: 0.04, type: 'bandpass', f: 1800, to: 500, q: 0.8 });
    thud(0.06, 0.08);
  },
  drop: () => thud(0, 0.07),
  error: () => {
    pluck(116.54, 0, 0.05, 0.4);
    pluck(110, 0.01, 0.05, 0.4);
  },
  reminder: () => [0, 0.45, 0.9].forEach((at) => bell(1046.5, at, 0.05, 1)),
  goal: () => {
    strum([164.81, 207.65, 246.94, 329.63, 415.3, 493.88], 0, 0.03, 0.03, 0.9);
    strum([329.63, 415.3, 493.88, 659.25], 0.45, 0.03, 0.025, 1.1);
    bell(1318.5, 0.5, 0.035, 1.3);
  },
};

// Cyberpunk 2077 style: digital blips, saw zaps, sub drops and glitch grains.
const zap = (f, to, at = 0, len = 0.08, vol = 0.03) => tone({ f, to, at, len, vol, type: 'sawtooth', filter: 'lowpass', fc: 3500, attack: 0.002 });
const grains = (at = 0, vol = 0.02) => [3000, 6500, 1800, 5000].forEach((f, i) => noise({ at: at + [0, 0.018, 0.041, 0.06][i], len: 0.012, vol, type: 'bandpass', f, q: 4, attack: 0.001 }));
const sub = (at = 0, vol = 0.1) => tone({ f: 90, to: 40, sweep: 0.18, at, len: 0.22, vol, attack: 0.002 });
const blip = (f, at = 0, vol = 0.02, len = 0.03) => tone({ f, at, len, vol, type: 'square', filter: 'lowpass', fc: 5000, attack: 0.001 });
const neon = {
  hover: () => blip(2637, 0, 0.012, 0.015),
  select: () => {
    blip(1760, 0, 0.02);
    blip(2637, 0.03, 0.016);
  },
  pop: () => blip(1975.5, 0, 0.02, 0.025),
  open: () => {
    zap(220, 1400, 0, 0.12, 0.03);
    grains(0.02, 0.012);
  },
  close: () => zap(1400, 220, 0, 0.1, 0.028),
  nav: () => {
    grains(0, 0.02);
    sub(0.02, 0.06);
  },
  complete: () => {
    sub(0, 0.11);
    [659.25, 830.61, 987.77, 1318.5].forEach((f, i) => zap(f, f * 1.01, 0.02 + i * 0.045, 0.12, 0.026));
    grains(0.05, 0.014);
  },
  uncomplete: () => zap(880, 440, 0, 0.12, 0.045),
  add: () => {
    blip(1318.5, 0, 0.034);
    blip(1975.5, 0.04, 0.03);
    zap(500, 1500, 0.02, 0.08, 0.022);
  },
  delete: () => {
    zap(1200, 80, 0, 0.25, 0.05);
    grains(0.03, 0.02);
  },
  drop: () => {
    sub(0, 0.07);
    blip(1318.5, 0, 0.012);
  },
  error: () => [0, 0.09, 0.18].forEach((at) => tone({ f: 98, at, len: 0.07, vol: 0.06, type: 'square', filter: 'lowpass', fc: 900 })),
  reminder: () => [0, 0.16, 0.32, 0.6].forEach((at, i) => blip(i === 3 ? 1760 : 1318.5, at, 0.045, 0.09)),
  goal: () => {
    sub(0, 0.1);
    [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98].forEach((f, i) => zap(f, f, i * 0.06, 0.16, 0.022));
    grains(0.36, 0.016);
    tone({ f: 1046.5, type: 'sawtooth', at: 0.36, len: 0.7, vol: 0.02, filter: 'lowpass', fc: 2400 });
  },
};

const BANKS = { tickwise, archive, riot, tide, frontier, neon };
// Evens out loudness between styles.
const BANK_GAIN = { tickwise: 1, archive: 1.7, riot: 0.9, tide: 1.1, frontier: 1.1, neon: 1.2 };
const ALIAS = { undo: 'uncomplete' };

// Louder, more important sounds briefly mute quieter ones so they don't pile up.
const PRIORITY = { hover: 0, select: 1, pop: 2, open: 2.5, close: 2.5, drop: 2.5 };
const prio = (e) => PRIORITY[e] ?? 3;
let lastAt = { t: 0, p: -1 };
const lastByEvent = {};

export function soundLevel() {
  const p = store.getPrefs();
  if (p.soundLevel) return p.soundLevel;
  return p.sound === false ? 'off' : 'all';
}

export function play(event, { force = false } = {}) {
  const level = soundLevel();
  if (level === 'off') return;
  if (event === 'hover' && level !== 'all' && !force) return;
  if (document.visibilityState === 'hidden') return;
  const now = performance.now();
  const p = prio(event);
  if (!force) {
    if (now - (lastByEvent[event] || 0) < 45) return;
    if (now - lastAt.t < 150 && lastAt.p > p) return;
  }
  lastByEvent[event] = now;
  lastAt = { t: now, p };
  try {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
    const prefs = store.getPrefs();
    master.gain.value = Math.max(0, Math.min(1, prefs.soundVolume ?? 0.6)) * 3.4 * (BANK_GAIN[prefs.skin] || 1);
    const name = ALIAS[event] || event;
    const bank = BANKS[prefs.skin] || tickwise;
    if (window.__tickwiseSoundLog) window.__tickwiseSoundLog.push([prefs.skin || 'tickwise', event]);
    (bank[name] || tickwise[name] || (() => {}))();
  } catch (e) {
    if (window.__tickwiseSoundLog) window.__tickwiseSoundLog.push(['error', String(e)]);
  }
}

export const SOUND_EVENTS = Object.keys(tickwise);

// Test hook: renders one sound offline and reports its loudness.
async function measure(skin, event) {
  const off = new OfflineAudioContext(1, 44100 * 2, 44100);
  const saved = [ctx, master, echoIn, noiseBuf];
  ctx = off;
  ({ m: master, e: echoIn, buf: noiseBuf } = buildGraph(off));
  master.gain.value = 0.6 * 3.4 * (BANK_GAIN[skin] || 1);
  try {
    const bank = BANKS[skin] || tickwise;
    (bank[event] || tickwise[event])();
  } finally {
    [ctx, master, echoIn, noiseBuf] = saved;
  }
  const out = (await off.startRendering()).getChannelData(0);
  let peak = 0;
  let sum = 0;
  let last = 0;
  for (let i = 0; i < out.length; i++) {
    const v = Math.abs(out[i]);
    if (v > peak) peak = v;
    sum += out[i] * out[i];
    if (v > 0.001) last = i;
  }
  return { peak, rms: Math.sqrt(sum / out.length), length: last / 44100 };
}

// ---------- automatic menu sounds ----------

const HOVERABLE = '.nav-item, .menu-item, .settings-tabs button, .picker-item, .due-quick-item, .skin-card, .sb-add, .week-day:not(:disabled), .btn:not(:disabled), .seg button, .task-row, .entity-row:not(.static), .cal-day';
const SELECTABLE = '.menu-item, .picker-item, .due-quick-item, .seg button, .skin-card, .switch, .color-dot, .accent-dot, .settings-tabs button, .cal-day, .week-day, .group-toggle, .twisty, .chip-x, .tool, .icon-btn, .sb-group-toggle, .link-btn, input[type="checkbox"]';

export function wireSounds() {
  if (window.__tickwiseSoundLog) {
    window.__tickwiseSound = play;
    window.__tickwiseMeasure = measure;
  }
  let lastHover = null;
  let lastKey = 0;
  // Browsers only allow audio after the first tap or key press.
  const unlock = () => {
    try {
      if (ensure() && ctx.state === 'suspended') ctx.resume();
    } catch {}
  };
  document.addEventListener('pointerdown', unlock, { capture: true });
  document.addEventListener('keydown', () => {
    lastKey = performance.now();
    unlock();
  }, { capture: true });
  let lastPlayed = null;
  let lastPlayedAt = 0;
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const el = e.target.closest && e.target.closest(HOVERABLE);
    if (el === lastHover) return;
    lastHover = el;
    if (!el) return;
    // Coming back to the same thing a moment later (the pointer wobbling on an edge) stays quiet.
    const now = performance.now();
    if (el === lastPlayed && now - lastPlayedAt < 600) return;
    lastPlayed = el;
    lastPlayedAt = now;
    play('hover');
  });
  document.addEventListener('focusin', (e) => {
    if (performance.now() - lastKey > 400) return;
    if (e.target.matches && e.target.matches('.menu-item, .nav-item, .picker-item, .settings-tabs button')) play('hover');
  });
  document.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest(SELECTABLE);
    if (el) play('select');
  });
}
