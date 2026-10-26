// One app icon per style, drawn on a 64×64 grid. Used for the in-app logo and
// the browser tab icon, and exported to PNGs for the Windows and Android builds.

export const ICON_STYLES = ['tickwise', 'archive', 'riot', 'tide', 'frontier', 'neon'];

function burst(cx, cy, outer, inner, points, rot = 0) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = (Math.PI * i) / points - Math.PI / 2 + (rot * Math.PI) / 180;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

// A seeded random sequence, so the brush edges come out the same every time.
function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

// A rectangle with a jittered edge, for brush strokes.
function roughRect(x, y, w, h, amp, seed, step = 3) {
  const r = rng(seed);
  const j = () => (r() * 2 - 1) * amp;
  const pts = [];
  for (let t = 0; t <= w; t += step) pts.push([x + t, y + j()]);
  for (let t = 0; t <= h; t += step) pts.push([x + w + j(), y + t]);
  for (let t = w; t >= 0; t -= step) pts.push([x + t, y + h + j()]);
  for (let t = h; t >= 0; t -= step) pts.push([x + j(), y + t]);
  return 'M' + pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L') + 'Z';
}

// bg(shape): the background layer, 'rounded' for a finished icon or 'full' to fill an adaptive layer.
// fg: the mark on top. Both share the 64×64 grid. uid keeps gradient and clip ids
// unique when more than one icon is on the page.
export function iconParts(style, { accent = '#f46b25', uid = '' } = {}) {
  const u = uid;
  switch (style) {
    case 'archive':
      // NieR: Automata: the picked menu item, a dark plate with its square marker, between the menu's thin rules.
      return {
        bg: (shape) =>
          `<rect width="64" height="64" rx="${shape === 'rounded' ? 6 : 0}" fill="#d1cdb7"/>` +
          `<path d="${Array.from({ length: 15 }, (_, i) => `M${4 + i * 4} 0V64M0 ${4 + i * 4}H64`).join('')}" stroke="#c4bfa6" stroke-width=".4"/>`,
        fg: [
          '<rect x="9" y="12.6" width="36" height="1.2" fill="#57544a"/><rect x="49" y="11.5" width="3.4" height="3.4" fill="#57544a"/>',
          '<rect x="9" y="18" width="46" height="1.6" fill="#57544a"/><rect x="9" y="44.4" width="46" height="1.6" fill="#57544a"/>',
          '<rect x="9" y="22.5" width="46" height="19" fill="#57544a"/><rect x="5" y="25.5" width="2.2" height="13" fill="#57544a"/>',
          '<rect x="14" y="27.5" width="9" height="9" fill="#dad4bb"/>',
          '<path d="M28 32.5l5 5 12-12" fill="none" stroke="#dad4bb" stroke-width="4" stroke-linecap="square"/>',
        ].join(''),
      };
    case 'riot':
      // Persona 5 (the Calling Card design): a white-edged red star with a white tick, on black.
      return {
        bg: (shape) => `<rect width="64" height="64" rx="${shape === 'rounded' ? 6 : 0}" fill="#0b0a0a"/>`,
        fg: [
          `<polygon points="${burst(32, 34, 29, 13.6, 5, -6)}" fill="#ffffff"/>`,
          `<polygon points="${burst(32, 34, 25, 11.6, 5, -6)}" fill="#e5191c"/>`,
          '<g transform="rotate(-8 32 32)">',
          '<path d="M19 33l10 10 18-22" fill="none" stroke="#0b0a0a" stroke-width="12" stroke-linecap="square"/>',
          '<path d="M19 33l10 10 18-22" fill="none" stroke="#ffffff" stroke-width="6" stroke-linecap="square"/>',
          '</g>',
        ].join(''),
      };
    case 'tide':
      // Persona 3 Reload: deep water with the white ribbon, the red and white menu cursor under a black italic tick, and the moon.
      return {
        bg: (shape) =>
          `<defs><linearGradient id="twP3G${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5ff0ff"/><stop offset=".32" stop-color="#1a8ff0"/><stop offset=".72" stop-color="#1438c4"/><stop offset="1" stop-color="#0b1c82"/></linearGradient>` +
          `<clipPath id="twP3C${u}"><rect width="64" height="64" rx="${shape === 'rounded' ? 14 : 0}"/></clipPath></defs>` +
          `<g clip-path="url(#twP3C${u})"><rect width="64" height="64" fill="url(#twP3G${u})"/>` +
          '<path d="M0 6c6-3 10 2 16 0s9-4 15-1 10 2 15 0 12-2 18 1v5c-6-2-11 1-17 0s-9-3-15-1-10 3-16 1-10-2-16 1z" fill="#ffffff" opacity=".22"/>' +
          // on a full adaptive layer the launcher crops the edges, so the ribbon moves in
          `<g${shape === 'rounded' ? '' : ' transform="translate(11 0)"'}><path d="M-2 0h11L1 64h-5z" fill="#ffffff"/><path d="M11 0h2.2L5.2 64H3z" fill="#ff1f3d"/></g></g>`,
        fg: [
          // the moon sits up in the corner, clear of the tick's end
          '<path d="M49.5 6.5a6 6 0 1 0 6 6a4.8 4.8 0 0 1-6-6z" fill="#effbff"/>',
          '<polygon points="8,48 60,24 49,39" fill="#ffffff" transform="translate(2.5 -2.5) rotate(-3 34 36)"/>',
          '<polygon points="8,48 60,24 49,39" fill="#ff1f3d"/>',
          '<path d="M20 34l8.5 8 14.5-16" fill="none" stroke="#050816" stroke-width="7.5" stroke-linecap="square" transform="translate(34 33) skewX(-14) translate(-34 -33)"/>',
        ].join(''),
      };
    case 'frontier':
      // Red Dead Redemption 2: the rough red brush frame of a chosen option round an ink tick, on black.
      return {
        bg: (shape) => {
          const r = rng(11);
          const streaks = Array.from({ length: 14 }, (_, i) => `<rect x="${(r() * 10).toFixed(1)}" y="${(2 + i * 4.4 + r() * 1.5).toFixed(1)}" width="${(30 + r() * 34).toFixed(1)}" height="${(0.5 + r() * 1.2).toFixed(1)}" opacity="${(0.04 + r() * 0.07).toFixed(2)}"/>`).join('');
          return `<clipPath id="twRdC${u}"><rect width="64" height="64" rx="${shape === 'rounded' ? 10 : 0}"/></clipPath><g clip-path="url(#twRdC${u})"><rect width="64" height="64" fill="#0d0b09"/><g fill="#ffffff">${streaks}</g></g>`;
        },
        fg: [
          `<path d="${roughRect(9, 13, 46, 38, 1.4, 5)}${roughRect(14.5, 18.5, 35, 27, 1.2, 9)}" fill="#cc0000" fill-rule="evenodd"/>`,
          '<path d="M10 16.2h18M33 15.4h20M12 48.6h25M40 47.8h13M11.2 30v6M52.6 27v9" stroke="#0d0b09" stroke-width=".7" opacity=".8"/>',
          '<path d="M19.6 33.6L28.2 43.4L46.8 21.6L44.2 20.6L28.4 36.8L22.2 30.8Z" fill="#f2ead8" stroke="#f2ead8" stroke-width="1.2" stroke-linejoin="round"/>',
          '<path d="M23 33.2l5.3 5M31 36l12.4-13.6" stroke="#0d0b09" stroke-width=".6" opacity=".35"/>',
        ].join(''),
      };
    case 'neon':
      // A yellow check splitting into cyan and red, on a black plate with cut corners.
      return {
        bg: (shape) =>
          shape === 'rounded'
            ? '<path d="M0 0H50L64 14V64H14L0 50Z" fill="#07080e"/>'
            : '<rect width="64" height="64" fill="#07080e"/>',
        fg: [
          '<path d="M17 33l10 10 21-24" fill="none" stroke="#00f0ff" stroke-width="7" stroke-linecap="square" transform="translate(-2.5 0)"/>',
          '<path d="M17 33l10 10 21-24" fill="none" stroke="#ff2a4d" stroke-width="7" stroke-linecap="square" transform="translate(2.5 0)"/>',
          '<path d="M17 33l10 10 21-24" fill="none" stroke="#fcee0a" stroke-width="7" stroke-linecap="square"/>',
          '<path d="M15 28h12M33 39h9" stroke="#07080e" stroke-width="2.2"/>',
          '<path d="M9 53h17" stroke="#fcee0a" stroke-width="3"/><path d="M44 9h8" stroke="#ff2a4d" stroke-width="3"/>',
        ].join(''),
      };
    default:
      return {
        bg: (shape) => `<rect width="64" height="64" rx="${shape === 'rounded' ? 18 : 0}" fill="${accent}"/>`,
        fg: '<path d="M17 33.5 27.5 44 47 21" fill="none" stroke="#ffffff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="47" cy="21" r="3.5" fill="#F5C451"/>',
      };
  }
}

let seq = 0;
export function iconSvg(style, { accent, size = 64 } = {}) {
  const p = iconParts(style, { accent, uid: (++seq).toString(36) });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">${p.bg('rounded')}${p.fg}</svg>`;
}

// Separate layers for Android adaptive icons: a full-bleed background and the
// mark scaled into the centre safe zone.
export function adaptiveLayers(style) {
  const p = iconParts(style);
  return {
    bg: `<svg xmlns="http://www.w3.org/2000/svg" width="108" height="108" viewBox="0 0 64 64">${p.bg('full')}</svg>`,
    fg: `<svg xmlns="http://www.w3.org/2000/svg" width="108" height="108" viewBox="-20 -20 104 104">${p.fg}</svg>`,
  };
}
