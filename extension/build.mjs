// Packs the Chrome/Edge extension: extension/dist/Checkmate (load it with "Load unpacked")
// and ../dist/Checkmate-extension.zip. Needs web/dist-ext (node web/build.mjs) and the icons
// in brand/out/ext (python3 brand/make_icons.py brand/out); build.sh runs all three.
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { VERSION } from '../web/src/version.js';

const root = dirname(fileURLToPath(import.meta.url));
const web = join(root, '../web');
// esbuild and preact come from web/node_modules
const { build } = createRequire(join(web, 'package.json'))('esbuild');
const out = join(root, 'dist/Checkmate');
const icons = join(root, '../brand/out/ext');
for (const need of [join(web, 'dist-ext/app.js'), join(icons, 'icon128.png')]) {
  if (!existsSync(need)) throw new Error(`missing ${relative(join(root, '..'), need)}: run build.sh (or node web/build.mjs and python3 brand/make_icons.py brand/out) first`);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// the app page, its scripts and the fonts (web/build.mjs)
cpSync(join(web, 'dist-ext'), out, { recursive: true });
cpSync(icons, join(out, 'icons'), { recursive: true });
for (const f of ['background.js', 'popup.html', 'popup.css']) cpSync(join(root, 'src', f), join(out, f));
writeFileSync(join(out, 'manifest.json'), readFileSync(join(root, 'src/manifest.json'), 'utf8').replace('__VERSION__', VERSION));

// The popup shares the app's store, quick-add parser, dates and translations.
await build({
  entryPoints: [join(root, 'src/popup.jsx')],
  outfile: join(out, 'popup.js'),
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['chrome116'],
  jsx: 'automatic',
  jsxImportSource: 'preact',
  nodePaths: [join(web, 'node_modules')],
  legalComments: 'none',
  charset: 'utf8',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
});

// ---- the zip (stored with deflate; no extra tools needed) ----
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
};
walk(out);
const parts = [];
const central = [];
let offset = 0;
// a fixed date (2026-01-01) so the same files always make the same zip
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
for (const p of files) {
  const name = Buffer.from(relative(out, p).split('\\').join('/'));
  const data = readFileSync(p);
  const packed = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0);
  head.writeUInt16LE(20, 4);
  head.writeUInt16LE(0x0800, 6); // UTF-8 names
  head.writeUInt16LE(8, 8);
  head.writeUInt16LE(DOS_TIME, 10);
  head.writeUInt16LE(DOS_DATE, 12);
  head.writeUInt32LE(crc, 14);
  head.writeUInt32LE(packed.length, 18);
  head.writeUInt32LE(data.length, 22);
  head.writeUInt16LE(name.length, 26);
  parts.push(head, name, packed);
  const c = Buffer.alloc(46);
  c.writeUInt32LE(0x02014b50, 0);
  c.writeUInt16LE(20, 4);
  c.writeUInt16LE(20, 6);
  c.writeUInt16LE(0x0800, 8);
  c.writeUInt16LE(8, 10);
  c.writeUInt16LE(DOS_TIME, 12);
  c.writeUInt16LE(DOS_DATE, 14);
  c.writeUInt32LE(crc, 16);
  c.writeUInt32LE(packed.length, 20);
  c.writeUInt32LE(data.length, 24);
  c.writeUInt16LE(name.length, 28);
  c.writeUInt32LE(offset, 42);
  central.push(c, name);
  offset += head.length + name.length + packed.length;
}
const cd = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(cd.length, 12);
end.writeUInt32LE(offset, 16);
const zip = Buffer.concat([...parts, cd, end]);
mkdirSync(join(root, '../dist'), { recursive: true });
writeFileSync(join(root, '../dist/Checkmate-extension.zip'), zip);
console.log(`dist/Checkmate-extension.zip  ${(zip.length / 1024).toFixed(0)} KB, ${files.length} files (version ${VERSION})`);
