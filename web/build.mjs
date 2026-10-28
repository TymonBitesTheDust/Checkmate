// Bundles the app into one self-contained HTML file: dist/Checkmate.html
import { build, transform } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cursorCss } from './src/cursors.js';
import { buildConnector } from '../connector/build.mjs';

const root = dirname(fileURLToPath(import.meta.url));
// MOCK_FIREBASE=1 swaps the Firebase SDK for the test double in ../test (used by the sync test only).
const mock = !!process.env.MOCK_FIREBASE;
const out = join(root, mock ? 'dist-test' : 'dist');
const mockPlugin = {
  name: 'mock-firebase',
  setup(b) {
    b.onResolve({ filter: /^firebase\/(app|auth|firestore)$/ }, () => ({ path: join(root, '../test/mock-firebase.js') }));
  },
};
mkdirSync(out, { recursive: true });

// The Claude connector (../connector) goes inside the app so Settings → Claude can hand
// out a copy filled in with the account's settings.
const connector = await buildConnector();
const connectorPlugin = {
  name: 'checkmate-connector',
  setup(b) {
    b.onResolve({ filter: /^virtual:checkmate-connector$/ }, () => ({ path: 'connector', namespace: 'checkmate-connector' }));
    b.onLoad({ filter: /.*/, namespace: 'checkmate-connector' }, () => ({ contents: `export default ${JSON.stringify(connector.code)};`, loader: 'js' }));
  },
};

const js = await build({
  entryPoints: [join(root, 'src/main.jsx')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020', 'chrome90'],
  jsx: 'automatic',
  jsxImportSource: 'preact',
  write: false,
  legalComments: 'none',
  charset: 'utf8',
  // CHECKMATE_STORE=play builds the Google Play version (no Donate tab).
  define: { 'process.env.NODE_ENV': '"production"', 'process.env.CHECKMATE_STORE': JSON.stringify(process.env.CHECKMATE_STORE || '') },
  logLevel: 'warning',
  plugins: mock ? [mockPlugin, connectorPlugin] : [connectorPlugin],
});
let code = js.outputFiles[0].text;
// keep the inline script from closing early
code = code.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

// skin-riot.css comes last: the Persona 5 (Calling Card) rules sit on top of the shared calendar rules
const cssSource = ['styles.css', 'skin-archive.css', 'skin-tide.css', 'skin-frontier.css', 'skin-neon.css', 'cal.css', 'skin-riot.css'].map((f) => readFileSync(join(root, 'src', f), 'utf8')).join('\n') + '\n' + cursorCss();
const css = (await transform(cssSource, { loader: 'css', minify: true, target: ['chrome90'] })).code;

const face = (family, style, weight, file) =>
  `@font-face{font-family:"${family}";font-style:${style};font-display:swap;font-weight:${weight};src:url(data:font/woff2;base64,${readFileSync(join(root, 'node_modules/@fontsource', file)).toString('base64')}) format("woff2")}`;
const font64 = (pkg, file) => readFileSync(join(root, 'node_modules/@fontsource-variable', pkg, 'files', file)).toString('base64');
const font = [
  `@font-face{font-family:"Bricolage Grotesque";font-style:normal;font-display:swap;font-weight:200 800;src:url(data:font/woff2;base64,${font64('bricolage-grotesque', 'bricolage-grotesque-latin-wght-normal.woff2')}) format("woff2")}`,
  // NieR: Automata style: Manrope (the YoRHa menus' clean, wide-tracked sans)
  `@font-face{font-family:"Manrope";font-style:normal;font-display:swap;font-weight:200 800;src:url(data:font/woff2;base64,${font64('manrope', 'manrope-latin-wght-normal.woff2')}) format("woff2")}`,
  `@font-face{font-family:"Anton";font-style:normal;font-display:swap;font-weight:400;src:url(data:font/woff2;base64,${readFileSync(join(root, 'node_modules/@fontsource/anton/files/anton-latin-400-normal.woff2')).toString('base64')}) format("woff2")}`,
  `@font-face{font-family:"Abril Fatface";font-style:normal;font-display:swap;font-weight:400;src:url(data:font/woff2;base64,${readFileSync(join(root, 'node_modules/@fontsource/abril-fatface/files/abril-fatface-latin-400-normal.woff2')).toString('base64')}) format("woff2")}`,
  ...['600', '800'].map((w) => `@font-face{font-family:"Barlow Condensed";font-style:italic;font-display:swap;font-weight:${w};src:url(data:font/woff2;base64,${readFileSync(join(root, `node_modules/@fontsource/barlow-condensed/files/barlow-condensed-latin-${w}-italic.woff2`)).toString('base64')}) format("woff2")}`),
  // Red Dead Redemption 2 style: woodtype headings, Caslon text
  face('Rye', 'normal', 400, 'rye/files/rye-latin-400-normal.woff2'),
  face('Libre Caslon Text', 'normal', 400, 'libre-caslon-text/files/libre-caslon-text-latin-400-normal.woff2'),
  face('Libre Caslon Text', 'italic', 400, 'libre-caslon-text/files/libre-caslon-text-latin-400-italic.woff2'),
  face('Libre Caslon Text', 'normal', 700, 'libre-caslon-text/files/libre-caslon-text-latin-700-normal.woff2'),
  // Cyberpunk 2077 style
  ...['500', '600', '700'].map((w) => face('Rajdhani', 'normal', w, `rajdhani/files/rajdhani-latin-${w}-normal.woff2`)),
  // Persona 3 style: Montserrat extra-bold italic, after the Persona 3 Reload menus
  face('Montserrat', 'italic', 600, 'montserrat/files/montserrat-latin-600-italic.woff2'),
  face('Montserrat', 'italic', 800, 'montserrat/files/montserrat-latin-800-italic.woff2'),
  face('Montserrat', 'italic', 900, 'montserrat/files/montserrat-latin-900-italic.woff2'),
  // Persona 5 style (Calling Card): Arsenal for text, and more faces for the cut-out letters
  face('Arsenal', 'normal', 400, 'arsenal/files/arsenal-latin-400-normal.woff2'),
  face('Arsenal', 'italic', 400, 'arsenal/files/arsenal-latin-400-italic.woff2'),
  face('Arsenal', 'normal', 700, 'arsenal/files/arsenal-latin-700-normal.woff2'),
  face('Arsenal', 'italic', 700, 'arsenal/files/arsenal-latin-700-italic.woff2'),
  face('Bowlby One', 'normal', 400, 'bowlby-one/files/bowlby-one-latin-400-normal.woff2'),
  face('Rubik Mono One', 'normal', 400, 'rubik-mono-one/files/rubik-mono-one-latin-400-normal.woff2'),
  face('Special Elite', 'normal', 400, 'special-elite/files/special-elite-latin-400-normal.woff2'),
].join('');

let html = readFileSync(join(root, 'src/index.html'), 'utf8');
html = html.replace('/*__FONT__*/', () => font).replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => code);
writeFileSync(join(out, 'Checkmate.html'), html);
console.log(`dist/Checkmate.html  ${(html.length / 1024).toFixed(0)} KB (js ${(code.length / 1024).toFixed(0)} KB, css ${(css.length / 1024).toFixed(0)} KB)`);
