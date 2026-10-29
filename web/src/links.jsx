// Outside links: which browser opens them (Settings → General → Open links with) and
// where an event's location points.
import { useState, useEffect } from 'preact/hooks';
import * as store from './store.js';
import { Modal, toast } from './ui.jsx';
import { canPickBrowser, copyText, openWith, setLinkOpener } from './native.js';
import { tr } from './i18n.js';

export const BROWSERS = [
  ['chrome', 'Google Chrome'],
  ['edge', 'Microsoft Edge'],
  ['firefox', 'Firefox'],
];

// The choices for the setting: the device's default, a named browser, or ask each time.
export const LINK_CHOICES = [['default', 'Default browser'], ...BROWSERS, ['ask', 'Ask every time']];

let openPicker = () => {};

export function openLink(url) {
  const choice = canPickBrowser() ? store.getPrefs().linkBrowser || 'default' : 'default';
  if (choice === 'ask') openPicker(url);
  else openWith(url, choice);
}
setLinkOpener(openLink);

// "Ask every time": the browsers, plus copying the link.
export function LinkPickerHost() {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    openPicker = setUrl;
  }, []);
  if (!url) return null;
  const pick = (b) => {
    setUrl(null);
    openWith(url, b);
  };
  return (
    <Modal onClose={() => setUrl(null)} class="confirm link-picker" label={tr('Open link with')}>
      <h2 class="dialog-title">{tr('Open link with')}</h2>
      <p class="dialog-body lp-url" translate="no">{url}</p>
      <div class="lp-list">
        <button type="button" class="btn ghost" data-browser="default" autofocus onClick={() => pick('default')}>{tr('Default browser')}</button>
        {BROWSERS.map(([id, name]) => (
          <button type="button" class="btn ghost" data-browser={id} key={id} onClick={() => pick(id)} translate="no">{name}</button>
        ))}
        <button
          type="button"
          class="btn ghost"
          data-browser="copy"
          onClick={async () => {
            setUrl(null);
            if (await copyText(url)) toast(tr('Link copied'));
          }}
        >
          {tr('Copy link')}
        </button>
      </div>
      <div class="dialog-actions">
        <button type="button" class="btn ghost" onClick={() => setUrl(null)}>{tr('Cancel')}</button>
      </div>
    </Modal>
  );
}

// Where an event's location opens. A pasted map link (Google Maps' share link, even
// with the place's name around it or without https://) opens as it is; plain words
// such as an address are looked up in Google Maps.
export function locationUrl(location) {
  const text = (location || '').trim();
  if (!text) return null;
  const full = text.match(/https?:\/\/[^\s<>"]+/i);
  if (full) return full[0].replace(/[),.;]+$/, '');
  const bare = text.match(/(?:^|\s)((?:www\.|maps\.app\.goo\.gl\/|goo\.gl\/maps\/|maps\.google\.[a-z.]+\/|(?:www\.)?google\.[a-z.]+\/maps)[^\s<>"]*)/i);
  if (bare) return `https://${bare[1].replace(/[),.;]+$/, '')}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}`;
}
