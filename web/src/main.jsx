import { render } from 'preact';
import * as store from './store.js';
import * as sync from './sync.js';
import { App } from './app.jsx';
import { wireSounds } from './sound.js';
import * as docsync from './docsync.js';
import * as calsync from './calsync.js';
import * as files from './files.js';
import { hideSplash } from './splash.js';
import { wireExtension } from './ext.js';

store.init();
// Hooks for the Android/Windows hosts.
window.__tickwiseFlush = () => store.flush();
window.tickwiseOpenTask = (id) => {
  window.__openTask = id;
  if (window.__openTaskNow) window.__openTaskNow(id);
};
sync.wire();
wireSounds();
sync.start();
docsync.start();
calsync.start();
files.start();
wireExtension();
render(<App />, document.getElementById('app'));
hideSplash();

// Only the app's own panes scroll (lists, sidebar, calendar grid, dialogs). If a browser
// ever scrolls the page or the app's frame (older WebViews without overflow: clip, find in
// page, a focused element at the edge), put it straight back so nothing is left out of reach.
document.addEventListener(
  'scroll',
  (e) => {
    const t = e.target;
    if (t === document || t === document.documentElement || t === document.body) {
      if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
    } else if (t && t.classList && t.classList.contains('app') && (t.scrollTop || t.scrollLeft)) {
      t.scrollTop = 0;
      t.scrollLeft = 0;
    }
  },
  true,
);
window.addEventListener('pagehide', () => store.flush());
window.addEventListener('beforeunload', () => store.flush());
