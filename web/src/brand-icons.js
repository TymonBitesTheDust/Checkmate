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

// bg(shape): the background layer, 'rounded' for a finished icon or 'full' to fill an adaptive layer.
// fg: the mark on top. Both share the 64×64 grid.
export function iconParts(style, { accent = '#f46b25' } = {}) {
  switch (style) {
    case 'archive':
      return {
        bg: (shape) => `<rect width="64" height="64" rx="${shape === 'rounded' ? 6 : 0}" fill="#d8d4c5"/>`,
        fg: [
          '<rect x="9" y="9" width="46" height="46" fill="none" stroke="#48443a" stroke-width="1.6"/>',
          '<path d="M9 16V9h7M48 9h7v7M55 48v7h-7M16 55H9v-7" fill="none" stroke="#48443a" stroke-width="3.4"/>',
          '<path d="M19 33l9 9 17-20" fill="none" stroke="#48443a" stroke-width="6" stroke-linecap="square"/>',
          '<rect x="46" y="14" width="6" height="6" fill="#48443a"/>',
        ].join(''),
      };
    case 'riot':
      return {
        bg: (shape) => `<rect width="64" height="64" rx="${shape === 'rounded' ? 4 : 0}" fill="#d2152a"/>`,
        fg: [
          `<polygon points="${burst(32, 33, 27, 17, 11, 8)}" fill="#0d0d0d"/>`,
          '<g transform="rotate(-8 32 32)">',
          '<path d="M17 33l11 11 20-24" fill="none" stroke="#0d0d0d" stroke-width="14" stroke-linecap="square"/>',
          '<path d="M17 33l11 11 20-24" fill="none" stroke="#ffffff" stroke-width="7.5" stroke-linecap="square"/>',
          '</g>',
        ].join(''),
      };
    case 'tide':
      return {
        bg: (shape) =>
          '<defs><linearGradient id="twTideGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2fd2ff"/><stop offset=".45" stop-color="#1a7ff0"/><stop offset="1" stop-color="#0b1c82"/></linearGradient></defs>' +
          `<clipPath id="twTideClip"><rect width="64" height="64" rx="${shape === 'rounded' ? 14 : 0}"/></clipPath>` +
          '<g clip-path="url(#twTideClip)"><rect width="64" height="64" fill="url(#twTideGrad)"/>' +
          '<path d="M10 0h8L6 64H-2z" fill="#ffffff" opacity=".12"/><path d="M26 0h4L18 64h-4z" fill="#ffffff" opacity=".1"/></g>',
        fg: [
          // the crescent sits in the top-right corner, clear of the tick's end
          '<path d="M49.36 7.2A7 7 0 1 0 57.8 15.64A6 6 0 0 1 49.36 7.2z" fill="#effbff"/>',
          '<g transform="translate(5 0) skewX(-10)">',
          '<path d="M15 38l10 9 19-20" fill="none" stroke="#06134a" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" opacity=".35" transform="translate(0 2)"/>',
          '<path d="M15 38l10 9 19-20" fill="none" stroke="#ffffff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>',
          '</g>',
          '<path d="M13 52l26-6" stroke="#ff2d55" stroke-width="3"/>',
        ].join(''),
      };
    case 'frontier':
      // A lucky horseshoe around a red check, on dark leather.
      return {
        bg: (shape) =>
          '<defs><radialGradient id="twFrGrad" cx=".45" cy=".4" r=".75"><stop offset="0" stop-color="#3d2a1a"/><stop offset="1" stop-color="#1a110a"/></radialGradient></defs>' +
          `<rect width="64" height="64" rx="${shape === 'rounded' ? 12 : 0}" fill="url(#twFrGrad)"/>`,
        fg: [
          '<path d="M19 13C10 26 11 50 32 52.5C53 50 54 26 45 13" fill="none" stroke="#dcc597" stroke-width="9"/>',
          '<path d="M19 13C10 26 11 50 32 52.5C53 50 54 26 45 13" fill="none" stroke="#8b6a3c" stroke-width="1.4"/>',
          '<path d="M14 10h10v4H14zM40 10h10v4H40z" fill="#dcc597"/>',
          '<g fill="#3a2716"><circle cx="14.3" cy="24.3" r="1.5"/><circle cx="14.3" cy="36.7" r="1.5"/><circle cx="19.9" cy="47.1" r="1.5"/><circle cx="49.7" cy="24.3" r="1.5"/><circle cx="49.7" cy="36.7" r="1.5"/><circle cx="44.1" cy="47.1" r="1.5"/></g>',
          '<path d="M23 31l6.5 6.5 12.5-14" fill="none" stroke="#1a110a" stroke-width="9.5" stroke-linecap="square" opacity=".55"/>',
          '<path d="M23 31l6.5 6.5 12.5-14" fill="none" stroke="#d0392d" stroke-width="6" stroke-linecap="square"/>',
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

export function iconSvg(style, { accent, size = 64 } = {}) {
  const p = iconParts(style, { accent });
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
