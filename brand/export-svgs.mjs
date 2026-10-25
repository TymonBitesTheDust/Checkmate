// Writes the app icons from web/src/brand-icons.js as SVG files for make_icons.py.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ICON_STYLES, iconSvg, adaptiveLayers } from '../web/src/brand-icons.js';

const out = join(dirname(fileURLToPath(import.meta.url)), 'out', 'svg');
mkdirSync(out, { recursive: true });
for (const s of ICON_STYLES) {
  writeFileSync(join(out, `${s}.svg`), iconSvg(s));
  const a = adaptiveLayers(s);
  writeFileSync(join(out, `${s}-bg.svg`), a.bg);
  writeFileSync(join(out, `${s}-fg.svg`), a.fg);
}
// Android notification icon: a plain white tick.
writeFileSync(join(out, 'notify.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 64 64"><path d="M12 34l14 13 26-30" fill="none" stroke="#ffffff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></svg>');
console.log('icon SVGs written to', out);
