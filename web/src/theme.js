// Accent colour: presets plus any custom colour, adjusted per light/dark theme
// so buttons, links and highlights always keep readable contrast.

export const DEFAULT_ACCENT = 'orange';

export const ACCENTS = [
  { id: 'orange', name: 'Checkmate orange', hex: '#f46b25' },
  { id: 'pine', name: 'Pine', hex: '#1f7a5c' },
  { id: 'teal', name: 'Teal', hex: '#13808f' },
  { id: 'ocean', name: 'Ocean', hex: '#2f6fd6' },
  { id: 'indigo', name: 'Indigo', hex: '#4c5bd4' },
  { id: 'iris', name: 'Iris', hex: '#7353cf' },
  { id: 'plum', name: 'Plum', hex: '#9a46b8' },
  { id: 'rose', name: 'Rose', hex: '#c4325f' },
  { id: 'coral', name: 'Coral', hex: '#d9534a' },
  { id: 'tangerine', name: 'Tangerine', hex: '#d96a0b' },
  { id: 'moss', name: 'Moss', hex: '#5f7d1e' },
  { id: 'graphite', name: 'Graphite', hex: '#4a535c' },
];

// Hand-tuned light/dark values. The stylesheet ships the default (Checkmate orange), which keeps
// #f46b25 exactly for fills and the logo, with a deeper orange for text on light backgrounds.
const ORANGE = {
  light: { '--accent': '#f46b25', '--accent-strong': '#b84a0f', '--accent-soft': '#fdeee5', '--accent-ink': '#ffffff', '--shadow-fab': '0 6px 18px rgba(244, 107, 37, 0.38)' },
  dark: { '--accent': '#f46b25', '--accent-strong': '#ff9a5c', '--accent-soft': '#3a2418', '--accent-ink': '#1f0d03', '--shadow-fab': '0 6px 18px rgba(0, 0, 0, 0.45)' },
};
const PINE = {
  light: { '--accent': '#1f7a5c', '--accent-strong': '#165f47', '--accent-soft': '#e3f1ea', '--accent-ink': '#ffffff', '--shadow-fab': '0 6px 18px rgba(31, 122, 92, 0.35)' },
  dark: { '--accent': '#48b48f', '--accent-strong': '#67c9a5', '--accent-soft': '#1b3a2f', '--accent-ink': '#0b1d16', '--shadow-fab': '0 6px 18px rgba(0, 0, 0, 0.45)' },
};
const TUNED = { orange: ORANGE, pine: PINE };
export const ACCENT_KEYS = Object.keys(ORANGE.light);

const LIGHT_BG = [255, 255, 255];
const DARK_BG = [21, 25, 23];

// ---------- colour maths ----------

export function parseHex(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const toHex = (rgb) => `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}

function hslToRgb([h, s, l]) {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

function luminance(rgb) {
  const c = rgb.map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// Move lightness (keeping hue) until the colour reaches `ratio` against `bg`.
function reach(rgb, bg, ratio, dir) {
  let [h, s, l] = rgbToHsl(rgb);
  let out = rgb;
  for (let i = 0; i < 100 && contrast(out, bg) < ratio; i++) {
    l = Math.max(0, Math.min(1, l + dir * 0.01));
    out = hslToRgb([h, s, l]);
  }
  return out;
}

// ---------- public ----------

export function accentHex(pref) {
  const preset = ACCENTS.find((a) => a.id === pref);
  if (preset) return preset.hex;
  return parseHex(pref) ? toHex(parseHex(pref)) : ACCENTS[0].hex;
}

// CSS variables for both themes. The default and Pine keep their hand-tuned values.
export function accentVars(pref) {
  if (!pref) return TUNED[DEFAULT_ACCENT];
  if (TUNED[pref]) return TUNED[pref];
  const base = parseHex(accentHex(pref));
  // light: fills carry white text, strong is used for text on tinted backgrounds
  const lAccent = reach(base, LIGHT_BG, 4.5, -1);
  const lStrong = reach(mix(lAccent, [0, 0, 0], 0.2), LIGHT_BG, 6.5, -1);
  const lSoft = mix(LIGHT_BG, lAccent, 0.12);
  // dark: lighter fills with dark text, strong is lighter still
  const dAccent = reach(base, DARK_BG, 5.5, +1);
  const dStrong = reach(mix(dAccent, [255, 255, 255], 0.2), DARK_BG, 8, +1);
  const dSoft = mix(DARK_BG, dAccent, 0.2);
  const dInk = contrast(dAccent, [11, 18, 15]) >= 4.5 ? mix(dAccent, [0, 0, 0], 0.82) : [255, 255, 255];
  const [r, g, b] = lAccent.map(Math.round);
  return {
    light: {
      '--accent': toHex(lAccent), '--accent-strong': toHex(lStrong), '--accent-soft': toHex(lSoft),
      '--accent-ink': '#ffffff', '--shadow-fab': `0 6px 18px rgba(${r}, ${g}, ${b}, 0.35)`,
    },
    dark: {
      '--accent': toHex(dAccent), '--accent-strong': toHex(dStrong), '--accent-soft': toHex(dSoft),
      '--accent-ink': toHex(dInk), '--shadow-fab': ORANGE.dark['--shadow-fab'],
    },
  };
}

// The default uses the stylesheet as-is; any other colour is set inline on <html>.
export function applyAccent(pref, dark) {
  const root = document.documentElement;
  const vars = pref && pref !== DEFAULT_ACCENT ? accentVars(pref)[dark ? 'dark' : 'light'] : null;
  for (const k of ACCENT_KEYS) {
    if (vars) root.style.setProperty(k, vars[k]);
    else root.style.removeProperty(k);
  }
}
