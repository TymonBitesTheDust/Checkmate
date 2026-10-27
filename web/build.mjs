// Bundles the app into one self-contained HTML file: dist/Checkmate.html
import { build, transform } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cursorCss } from './src/cursors.js';
import { ICON_STYLES, iconParts } from './src/brand-icons.js';
import { ACCENTS } from './src/theme.js';
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

// The browser extension's copy uses Firebase's web-extension auth build, which leaves out
// the sign-in-with-Google popup code (it loads scripts from the web, which extensions may not).
const extAuthPlugin = {
  name: 'firebase-auth-web-extension',
  setup(b) {
    b.onResolve({ filter: /^firebase\/auth$/ }, () => ({ path: join(root, 'src/ext-auth.js') }));
  },
};
const bundle = async (plugins) =>
  (
    await build({
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
      define: { 'process.env.NODE_ENV': '"production"' },
      logLevel: 'warning',
      plugins,
    })
  ).outputFiles[0].text;
const rawCode = await bundle(mock ? [mockPlugin, connectorPlugin] : [connectorPlugin]);
// keep the inline script from closing early
const inline = (c) => c.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const code = inline(rawCode);

// The start screen: every style's app icon (with its own gradient ids) and the theme colours,
// for splash-boot.js.
const splashData = {
  icons: Object.fromEntries(
    ICON_STYLES.map((s) => {
      const p = iconParts(s, { uid: `sp${s}` });
      return [s, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${p.bg('rounded')}${p.fg}</svg>`];
    }),
  ),
  accents: Object.fromEntries(ACCENTS.map((a) => [a.id, a.hex])),
  accent: '#f46b25',
};
const minifyJs = async (file, replace = (x) => x) => (await transform(replace(readFileSync(join(root, 'src', file), 'utf8')), { loader: 'js', minify: true, target: ['es2017'] })).code.trim();
const bootJs = await minifyJs('boot.js');
const splashJs = await minifyJs('splash-boot.js', (x) => x.replace('/*__SPLASH_DATA__*/ { icons: {}, accents: {}, accent: \'\' }', () => JSON.stringify(splashData)));
if (!splashJs.includes('viewBox')) throw new Error('splash-boot.js: the icon placeholder was not filled in');

// skin-riot.css comes last: the Persona 5 (Calling Card) rules sit on top of the shared calendar rules
const cssSource = ['styles.css', 'skin-archive.css', 'skin-tide.css', 'skin-frontier.css', 'skin-neon.css', 'cal.css', 'skin-riot.css', 'splash.css'].map((f) => readFileSync(join(root, 'src', f), 'utf8')).join('\n') + '\n' + cursorCss();
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

const page = readFileSync(join(root, 'src/index.html'), 'utf8');
let html = page.replace('/*__FONT__*/', () => font).replace('/*__CSS__*/', () => css).replace('/*__BOOT__*/', () => inline(bootJs)).replace('/*__SPLASH__*/', () => inline(splashJs)).replace('/*__JS__*/', () => code);
writeFileSync(join(out, 'Checkmate.html'), html);
console.log(`dist/Checkmate.html  ${(html.length / 1024).toFixed(0)} KB (js ${(code.length / 1024).toFixed(0)} KB, css ${(css.length / 1024).toFixed(0)} KB)`);

// The browser extension's app page (../extension/build.mjs packs it): the same app, but
// extension pages may only run scripts from files, so every script is its own file. The
// fonts are a file too, shared with the toolbar popup.
if (!mock) {
  const ext = join(root, 'dist-ext');
  mkdirSync(ext, { recursive: true });
  const extCode = await bundle([connectorPlugin, extAuthPlugin]);
  if (/apis\.google\.com\/js/.test(extCode)) throw new Error('the extension build still carries code that loads scripts from the web');
  writeFileSync(join(ext, 'app.js'), extCode);
  writeFileSync(join(ext, 'boot.js'), bootJs);
  writeFileSync(join(ext, 'splash.js'), splashJs);
  writeFileSync(join(ext, 'fonts.css'), font);
  const extHtml = page
    .replace('<style>/*__FONT__*/</style>', '<link rel="stylesheet" href="fonts.css">')
    .replace('/*__CSS__*/', () => css)
    .replace('<script>/*__BOOT__*/</script>', '<script src="boot.js"></script>')
    .replace('<script>/*__SPLASH__*/</script>', '<script src="splash.js"></script>')
    .replace('<script>/*__JS__*/</script>', '<script src="app.js"></script>');
  if (/<script>/.test(extHtml)) throw new Error('index.html has an inline script the extension can\'t run');
  writeFileSync(join(ext, 'app.html'), extHtml);
  console.log(`dist-ext/app.html + app.js ${(extCode.length / 1024).toFixed(0)} KB (for the browser extension)`);
}
