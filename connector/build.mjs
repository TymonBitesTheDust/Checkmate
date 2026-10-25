// Bundles the connector into one file for a Cloudflare Worker: dist/checkmate-connector.js
// The app's own task, calendar and date code is bundled in, with stand-ins for the parts
// that only make sense in the app (its storage, sounds, toasts and language setting).
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webSrc = resolve(here, '../web/src');
const require = createRequire(join(here, '../web/package.json'));
const { build } = require('esbuild');

const SHIMS = {
  './store.js': join(here, 'shims/store.js'),
  './i18n.js': join(here, 'shims/i18n.js'),
  './sound.js': join(here, 'shims/quiet.js'),
  './ui.jsx': join(here, 'shims/quiet.js'),
};

const appModules = {
  name: 'checkmate-app-modules',
  setup(b) {
    b.onResolve({ filter: /^\.\/(store|i18n|sound)\.js$|^\.\/ui\.jsx$/ }, (args) => {
      if (resolve(args.resolveDir) !== webSrc) return null;
      return { path: SHIMS[args.path] };
    });
    // "Today" is the user's today (their time zone), not the server's.
    b.onLoad({ filter: /web[\\/]src[\\/]dates\.js$/ }, (args) => {
      const src = readFileSync(args.path, 'utf8');
      const from = 'export const today = () => ymd(new Date());';
      if (!src.includes(from)) throw new Error('dates.js: today() changed; update connector/build.mjs');
      return { contents: src.replace(from, 'export const today = () => (globalThis.__cmToday ? globalThis.__cmToday() : ymd(new Date()));'), loader: 'js' };
    });
  },
};

// The connector's modules bundled on their own (for tests).
export async function bundleModule(entry) {
  const out = await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'neutral', target: ['es2022'], write: false, logLevel: 'warning', plugins: [appModules] });
  return out.outputFiles[0].text;
}

export async function buildConnector({ write = true } = {}) {
  const out = await build({
    entryPoints: [join(here, 'src/worker.js')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: ['es2022'],
    write: false,
    minify: false,
    legalComments: 'none',
    charset: 'utf8',
    logLevel: 'warning',
    plugins: [appModules],
  });
  let code = out.outputFiles[0].text;
  const version = /VERSION = "([^"]+)"/.exec(code)[1];
  const cfg = /var CONFIG = \(?\s*(?:\/\*CHECKMATE_CONFIG\*\/)?\s*\{\s*apiKey: "",\s*projectId: "",\s*secret: ""\s*\}\s*(?:\/\*END_CHECKMATE_CONFIG\*\/)?\s*\)?;/;
  if (!cfg.test(code)) throw new Error('Could not find the CONFIG line in the bundle');
  code = code.replace(cfg, 'var CONFIG = /*CHECKMATE_CONFIG*/{"apiKey":"","projectId":"","secret":""}/*END_CHECKMATE_CONFIG*/;');
  const head = `// Checkmate connector for Claude, version ${version}
// Paste this whole file into a Cloudflare Worker (Edit code → select all → paste → Deploy).
// It lets Claude add, find, change and complete your Checkmate tasks and calendar events.
// It signs in to your own Firebase project as you and keeps no data of its own.
// Get your personal copy from Checkmate → Settings → Claude; the values in CONFIG are yours.
`;
  code = head + code;
  if (write) {
    mkdirSync(join(here, 'dist'), { recursive: true });
    writeFileSync(join(here, 'dist/checkmate-connector.js'), code);
  }
  return { code, version };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { code, version } = await buildConnector();
  console.log(`connector/dist/checkmate-connector.js  ${(code.length / 1024).toFixed(0)} KB (v${version})`);
}
