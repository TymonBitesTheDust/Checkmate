// Settings → Sidebar, About and Donate.
import * as store from './store.js';
import * as A from './actions.js';
import { Icon, Logo } from './icons.jsx';
import { Field, Switch, toast, useStoreVersion } from './ui.jsx';
import { copyText, platform } from './native.js';
import { StyledTitle } from './riot.jsx';
import { NAV_ITEMS } from './nav-items.jsx';
import { VERSION } from './version.js';
import { play } from './sound.js';
import { tr, pick, isZh } from './i18n.js';
import { CHANGELOG } from './changelog.js';

// ---------------------------------------------------------------- Sidebar

export function SidebarPanel() {
  useStoreVersion();
  const p = store.getPrefs();
  const hidden = p.sidebarHidden || {};
  const counts = p.sidebarCounts !== false;
  const example = [
    [pick('Personal', '個人'), 'ocean', 2],
    [pick('Family', '家庭'), 'moss', 8],
    [pick('Health', '健康'), 'rose', 1],
  ];
  return (
    <div class="panel-stack sbp">
      <Field group label={tr('Show in sidebar')}>
        <div class="sbp-list">
          {NAV_ITEMS.map((it) => (
            <label class="sbp-row" key={it.key}>
              <input
                type="checkbox"
                checked={!hidden[it.key]}
                onChange={(e) => store.setPrefs({ sidebarHidden: { ...hidden, [it.key]: !e.currentTarget.checked } })}
              />
              <span class="sbp-ic">{it.icon()}</span>
              <span>{tr(it.label)}</span>
            </label>
          ))}
        </div>
        <span class="field-hint">{tr('Hidden pages still open with their keyboard shortcuts.')}</span>
      </Field>
      <hr class="sep" />
      <Field group label={tr('Show task count')}>
        <Switch label={counts ? pick('On', '開') : pick('Off', '關')} checked={counts} onChange={(v) => store.setPrefs({ sidebarCounts: v })} />
        <span class="field-hint">{tr('Example:')}</span>
        <div class="sbp-example" aria-hidden="true">
          {example.map(([name, color, n]) => (
            <div class="sbp-ex-row" key={name}>
              <Icon name="hash" size={16} style={{ color: A.colorOf(color) }} />
              <span>{name}</span>
              {counts && <span class="sbp-ex-n">{n}</span>}
            </div>
          ))}
        </div>
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------- About

// The Southern Cross, as on the Australian flag.
function SouthernCross() {
  const star = (cx, cy, r, points = 7) => {
    const pts = [];
    for (let i = 0; i < points * 2; i++) {
      const rr = i % 2 ? r * 0.45 : r;
      const a = (Math.PI * i) / points - Math.PI / 2;
      pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
    }
    return <polygon points={pts.join(' ')} />;
  };
  return (
    <svg class="ic ab-cross" width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {star(12, 3.6, 2.6)}
      {star(12.6, 20.2, 2.8)}
      {star(5, 11.2, 2.5)}
      {star(18.6, 9.4, 2.2)}
      {star(15.4, 14.6, 1.4, 5)}
    </svg>
  );
}

export function AboutPanel() {
  useStoreVersion();
  const where = tr(platform() === 'android' ? 'Android app' : platform() === 'windows' ? 'Windows app' : platform() === 'extension' ? 'browser extension' : 'web app');
  return (
    <div class="panel-stack about-panel">
      <div class="ab-head">
        <Logo size={64} />
        <div>
          <h3 class="ab-name"><StyledTitle>Checkmate</StyledTitle></h3>
          <span class="muted">{tr('Version {v} · {where}', { v: VERSION, where })}</span>
        </div>
      </div>
      <div class="ab-card">
        <div class="ab-row">
          <span class="ab-ic"><Icon name="user" size={22} /></span>
          <div>
            <span class="muted">{tr('Created by')}</span>
            <strong>Tymon Ng</strong>
          </div>
        </div>
        <div class="ab-row">
          <span class="ab-ic"><Icon name="spark" size={22} /></span>
          <div>
            <span class="muted">{tr('Built with')}</span>
            <strong>Claude AI</strong>
          </div>
        </div>
        <div class="ab-row">
          <span class="ab-ic"><SouthernCross /></span>
          <div>
            <span class="muted">{tr('Made in')}</span>
            <strong>{tr('Proudly made in Australia')}</strong>
          </div>
        </div>
      </div>
      <p class="about">© 2026 Tymon Ng</p>
    </div>
  );
}

// ---------------------------------------------------------------- Donate

export const DONATION = {
  name: 'Tsz Chun Ng',
  payId: 'tymonng0903@gmail.com',
};

function CopyLine({ label, value, copy = value }) {
  const doCopy = async () => {
    if (await copyText(copy)) {
      play('pop');
      toast(tr('Copied {what}', { what: label }));
    }
  };
  return (
    <div class="dn-line">
      <span class="dn-label">{label}</span>
      <span class="dn-value" translate="no">{value}</span>
      <button type="button" class="btn ghost xs" onClick={doCopy} aria-label={tr('Copy {what}', { what: label })}>
        <Icon name="copy" size={14} /> {tr('Copy')}
      </button>
    </div>
  );
}

export function DonatePanel() {
  return (
    <div class="panel-stack donate-panel">
      <p class="lead">
        {tr('Checkmate is free, with no ads and no subscription. If it makes your days a little easier and you’d like to say thanks, you can chip in towards its development.')}
      </p>
      <div class="dn-card">
        <div class="dn-head">
          <Icon name="heart" size={20} />
          <strong>PayID</strong>
        </div>
        <CopyLine label={tr('PayID (email)')} value={DONATION.payId} />
        <span class="field-hint">{tr('In your banking app, choose to pay a PayID and paste this email. The name that shows should be {name}.', { name: DONATION.name })}</span>
      </div>
      <p class="about">{tr('Adding “Checkmate” as the description helps Tymon know what it’s for. Thank you!')}</p>
    </div>
  );
}

// ---------------------------------------------------------------- What’s new

export function WhatsNewPanel() {
  useStoreVersion();
  const zh = isZh();
  const month = (d) => {
    if (!d) return '';
    const [y, m] = d.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(zh ? 'zh-Hant' : [], { month: 'long', year: 'numeric' });
  };
  return (
    <div class="panel-stack whatsnew-panel">
      <p class="lead">{tr('Everything that’s changed, newest first. You’re on version {v}.', { v: VERSION })}</p>
      <div class="wn-list">
        {CHANGELOG.map((c, i) => (
          <article class={`wn-item ${c.v === VERSION ? 'latest' : ''}`} key={c.v} data-version={c.v}>
            <div class="wn-head">
              <span class="wn-ver">{c.v === 'earlier' ? tr('Before 2.1.0') : tr('Version {v}', { v: c.v })}</span>
              {c.v === VERSION && <span class="wn-tag">{tr('This version')}</span>}
              {c.date && <span class="muted wn-date">{month(c.date)}</span>}
            </div>
            <ul>
              {c.notes.map(([en, zhText], j) => <li key={j}>{zh ? zhText : en}</li>)}
            </ul>
          </article>
        ))}
      </div>
    </div>
  );
}
