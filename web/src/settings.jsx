import { useState, useEffect } from 'preact/hooks';
import * as store from './store.js';
import * as sync from './sync.js';
import { Icon } from './icons.jsx';
import { Modal, Field, Switch, confirmDialog, toast } from './ui.jsx';
import { saveFile, copyText, platform, openExternal, canSwitchAppIcon, canPickBrowser } from './native.js';
import { LINK_CHOICES } from './links.jsx';
import { ymd } from './dates.js';
import { StyledTitle } from './riot.jsx';
import { play, soundLevel } from './sound.js';
import { ACCENTS, DEFAULT_ACCENT, accentHex, accentVars, parseHex } from './theme.js';
import { tr, isZh, LANGUAGES } from './i18n.js';
import { DocsPanel } from './docs-settings.jsx';
import { CalendarPanel } from './cal-settings.jsx';
import { ClaudePanel } from './claude-settings.jsx';
import { SidebarPanel, AboutPanel, DonatePanel, WhatsNewPanel, showDonate } from './settings-more.jsx';
import { RemindersPanel } from './reminders-ui.jsx';

export const RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}`;

const SKINS = [
  { id: 'tickwise', name: 'Checkmate' },
  { id: 'archive', name: 'Archive' },
  { id: 'riot', name: 'Riot' },
  { id: 'tide', name: 'Tide' },
  { id: 'frontier', name: 'Frontier' },
  { id: 'neon', name: 'Neon' },
];
const THEME_NAMES = { archive: ['Parchment', 'Ink'], tide: ['Surface', 'Depths'], frontier: ['Journal', 'Campfire'], neon: ['Yellow', 'Night'] };

const TABS = [
  ['general', 'General', 'settings'],
  ['theme', 'Theme', 'palette'],
  ['sidebar', 'Sidebar', 'sidebar'],
  ['reminders', 'Reminders', 'bell'],
  ['sync', 'Sync', 'cloud'],
  ['calendar', 'Calendar', 'month'],
  ['data', 'Backup', 'archive'],
  ['docs', 'Docs & Sheets', 'link'],
  ['claude', 'Claude', 'plug'],
  ['keys', 'Shortcuts', 'keyboard'],
  ['whatsnew', 'What’s new', 'history'],
  ['about', 'About', 'info'],
  ['donate', 'Donate', 'heart'],
].filter(([k]) => k !== 'donate' || showDonate());

export function Settings({ tab: initial = 'general', onClose }) {
  const [first, focus] = String(initial).split(':');
  const [tab, setTab] = useState(first);
  return (
    <Modal onClose={onClose} class="settings" label={tr('Settings')} initialFocus={false}>
      <div class="settings-head">
        <h2 class="dialog-title"><StyledTitle>{tr('Settings')}</StyledTitle></h2>
        <button type="button" class="icon-btn" aria-label={tr('Close settings')} onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div class="settings-body">
        <nav class="settings-tabs" role="tablist">
          {TABS.map(([k, label, icon]) => (
            <button type="button" role="tab" aria-selected={tab === k} key={k} data-tab={k} class={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
              <Icon name={icon} size={18} />
              <span>{tr(label)}</span>
            </button>
          ))}
        </nav>
        <div class="settings-panel" role="tabpanel">
          {tab === 'general' && <General />}
          {tab === 'theme' && <ThemePanel />}
          {tab === 'sync' && <SyncPanel />}
          {tab === 'data' && <DataPanel />}
          {tab === 'docs' && <DocsPanel />}
          {tab === 'claude' && <ClaudePanel goTo={setTab} />}
          {tab === 'calendar' && <CalendarPanel focus={tab === first ? focus : null} />}
          {tab === 'keys' && <Keys />}
          {tab === 'sidebar' && <SidebarPanel />}
          {tab === 'reminders' && <RemindersPanel goTo={setTab} />}
          {tab === 'whatsnew' && <WhatsNewPanel />}
          {tab === 'about' && <AboutPanel />}
          {tab === 'donate' && <DonatePanel />}
        </div>
      </div>
    </Modal>
  );
}

function Seg({ value, options, onChange, label }) {
  return (
    <div class="seg wide" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button type="button" key={v} class={value === v ? 'on' : ''} aria-pressed={value === v} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

function General() {
  const p = store.getPrefs();
  return (
    <div class="panel-stack">
      <Field group label="Language · 語言">
        <Seg
          label="Language · 語言"
          value={p.language || 'system'}
          onChange={(v) => store.setPrefs({ language: v })}
          options={LANGUAGES.map(([v, l]) => [v, v === 'system' ? tr(l) : l])}
        />
      </Field>
      <Field label={tr('Open the app on')}>
        <select value={p.startView} onChange={(e) => store.setPrefs({ startView: e.currentTarget.value })}>
          <option value="today">{tr('Today')}</option>
          <option value="inbox">{tr('Inbox')}</option>
          <option value="upcoming">{tr('Upcoming')}</option>
          <option value="calendar">{tr('Calendar')}</option>
        </select>
      </Field>
      <Field group label={tr('Week starts on')}>
        <Seg label={tr('Week starts on')} value={String(p.weekStart)} onChange={(v) => store.setPrefs({ weekStart: +v })} options={[['1', tr('Monday')], ['0', tr('Sunday')], ['6', tr('Saturday')]]} />
      </Field>
      <Field group label={tr('Time format')}>
        <Seg label={tr('Time format')} value={p.timeFormat} onChange={(v) => store.setPrefs({ timeFormat: v })} options={[['24', '13:00'], ['12', isZh() ? '下午1點' : '1:00pm']]} />
      </Field>
      <Field group label={tr('Typed dates like 3/4 mean')} hint={tr('Used when you type a date with slashes in a task name.')}>
        <Seg label={tr('Date order')} value={p.dateOrder} onChange={(v) => store.setPrefs({ dateOrder: v })} options={[['dmy', tr('3 April')], ['mdy', tr('March 4')]]} />
      </Field>
      <div class="field">
        <Switch label={tr('Keep the time in the task name')} checked={p.keepTimeInName !== false} onChange={(v) => store.setPrefs({ keepTimeInName: v })} />
        <span class="field-hint">{tr('Typing a time such as “at 5pm” still sets when the task is due. Day words such as “tomorrow” are always taken out of the name.')}</span>
      </div>
      <div class="field">
        <Switch label={tr('Hide completed tasks')} checked={!!p.hideDoneTasks} onChange={(v) => store.setPrefs({ hideDoneTasks: v })} />
        <span class="field-hint">{tr('Ticked tasks leave your projects, even ones set to show completed tasks. They stay on the Completed page. The calendar has its own switch in Settings → Calendar.')}</span>
      </div>
      <div class="field">
        <Switch label={tr('Hide completed subtasks')} checked={!!p.hideDoneSubtasks} onChange={(v) => store.setPrefs({ hideDoneSubtasks: v })} />
        <span class="field-hint">{tr('Ticked subtasks leave the task panel and your project lists. Counts such as 3/5 still include them.')}</span>
      </div>
      {canPickBrowser() && (
        <Field label={tr('Open links with')} hint={tr('For links in tasks, events, locations and comments.')}>
          <select value={p.linkBrowser || 'default'} onChange={(e) => store.setPrefs({ linkBrowser: e.currentTarget.value })}>
            {LINK_CHOICES.map(([v, l]) => (
              <option value={v} key={v}>{tr(l)}</option>
            ))}
          </select>
        </Field>
      )}
      <SoundSettings />
    </div>
  );
}

// Settings → Theme: the style, its app icon, light or dark (Persona 5: animations and the
// star field instead), and the theme colour.
function ThemePanel() {
  const p = store.getPrefs();
  return (
    <div class="panel-stack theme-panel">
      <Field group label={tr('Style')}>
        <div class="skins" role="radiogroup" aria-label={tr('Style')}>
          {SKINS.map((k) => (
            <button
              type="button"
              key={k.id}
              role="radio"
              aria-checked={(p.skin || 'tickwise') === k.id}
              class={`skin-card ${(p.skin || 'tickwise') === k.id ? 'on' : ''}`}
              onClick={() => store.setPrefs({ skin: k.id })}
            >
              <div class={`skin-preview ${k.id}`} aria-hidden="true">
                <div class="pv-side"><i /><i /><i /><i /></div>
                <div class="pv-main"><i /><i /><i /><i /></div>
              </div>
              <strong>{k.name}</strong>
            </button>
          ))}
        </div>
      </Field>
      {canSwitchAppIcon() && (
        <div class="field">
          <Switch label={tr('Change the app icon with the style')} checked={p.iconFollowsStyle !== false} onChange={(v) => store.setPrefs({ iconFollowsStyle: v })} />
          <span class="field-hint">
            {platform() === 'windows'
              ? tr('Checkmate’s shortcuts on the desktop, in Start and on the taskbar change straight away. Checkmate.exe itself changes when you close Checkmate.')
              : platform() === 'extension'
                ? tr('The Checkmate button in your browser’s toolbar changes straight away.')
                : tr('The new icon appears after you leave the app. Some launchers move the home-screen shortcut back to the app drawer when the icon changes, so you may need to add it again.')}
          </span>
        </div>
      )}
      <div class="field">
        <Switch label={tr('Start screen')} checked={p.splash !== false} onChange={(v) => store.setPrefs({ splash: v })} />
        <span class="field-hint">{tr('Shows the style’s icon and the Checkmate name for a moment while the app opens.')}</span>
      </div>
      {p.skin === 'riot' ? (
        // Persona 5 (the Calling Card design) is always dark; instead it chooses how much moves.
        <>
          <Field group label={tr('Animations')}>
            <Seg label={tr('Animations')} value={p.motion || 'system'} onChange={(v) => store.setPrefs({ motion: v })} options={[['system', tr('Match device')], ['full', tr('Full')], ['reduced', tr('Reduced')]]} />
            <span class="field-hint">{tr('Reduced turns off the screen shake, the page wipe and the moving stars.')}</span>
          </Field>
          <div class="field">
            <Switch label={tr('Show the star field')} checked={p.stars !== false} onChange={(v) => store.setPrefs({ stars: v })} />
          </div>
        </>
      ) : (
        <Field group label={tr('Theme')}>
          <Seg label={tr('Theme')} value={p.theme} onChange={(v) => store.setPrefs({ theme: v })} options={[['system', tr('Match device')], ['light', tr((THEME_NAMES[p.skin] || ['Light'])[0])], ['dark', tr((THEME_NAMES[p.skin] || [0, 'Dark'])[1])]]} />
        </Field>
      )}
      {(p.skin || 'tickwise') === 'tickwise' && (
        // The other styles bring their own colours.
        <Field group label={tr('Theme colour')} hint={tr('Used for buttons, highlights and the Checkmate mark. Colours are adjusted slightly in light and dark mode so text stays readable.')}>
          <AccentPicker
            value={p.accent || DEFAULT_ACCENT}
            onChange={(v) => store.setPrefs({ accent: v, accentVars: v === DEFAULT_ACCENT ? null : accentVars(v) })}
          />
        </Field>
      )}
    </div>
  );
}

function AccentPicker({ value, onChange }) {
  const preset = ACCENTS.find((a) => a.id === value);
  const hex = accentHex(value);
  const [text, setText] = useState(hex);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setText(hex);
    setBad(false);
  }, [hex]);
  const commit = () => {
    const rgb = parseHex(text);
    if (!rgb) {
      setBad(true);
      return;
    }
    const norm = `#${text.trim().replace(/^#/, '').toLowerCase()}`;
    const full = norm.length === 4 ? `#${norm.slice(1).split('').map((c) => c + c).join('')}` : norm;
    const match = ACCENTS.find((a) => a.hex === full);
    onChange(match ? match.id : full);
  };
  return (
    <div class="accent-picker">
      <div class="accents" role="radiogroup" aria-label={tr('Theme colour')}>
        {ACCENTS.map((a) => (
          <button
            type="button"
            key={a.id}
            role="radio"
            aria-checked={value === a.id}
            aria-label={tr(a.name)}
            title={tr(a.name)}
            class={`accent-dot ${value === a.id ? 'on' : ''}`}
            style={{ '--c': a.hex }}
            onClick={() => onChange(a.id)}
          />
        ))}
        <label class={`accent-dot custom ${preset ? '' : 'on'}`} title={tr('Custom colour')} style={preset ? undefined : { '--c': hex }}>
          <input type="color" value={hex} aria-label={tr('Choose a custom colour')} onInput={(e) => onChange(e.currentTarget.value)} />
          {preset && <Icon name="plus" size={14} />}
        </label>
      </div>
      <div class="accent-meta">
        <span class="accent-name">{preset ? tr(preset.name) : tr('Custom colour')}</span>
        <input
          type="text"
          class={`mono hex-input ${bad ? 'bad' : ''}`}
          value={text}
          maxLength={7}
          spellcheck={false}
          aria-label={tr('Colour code')}
          aria-invalid={bad}
          onInput={(e) => {
            setText(e.currentTarget.value);
            setBad(false);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
        />
        {value !== DEFAULT_ACCENT && (
          <button type="button" class="link-btn sm" onClick={() => onChange(DEFAULT_ACCENT)}>{tr('Reset to Checkmate orange')}</button>
        )}
      </div>
      {bad && <p class="form-error" role="alert">{tr('Use a colour code like #2f6fd6.')}</p>}
    </div>
  );
}

const SOUND_TESTS = [
  ['complete', 'Finish task'],
  ['goal', 'Daily goal'],
  ['add', 'Add'],
  ['delete', 'Delete'],
  ['open', 'Open panel'],
  ['nav', 'Change page'],
  ['hover', 'Menu move'],
  ['reminder', 'Reminder'],
];

function SoundSettings() {
  const p = store.getPrefs();
  const level = soundLevel();
  const vol = Math.round((p.soundVolume ?? 0.6) * 100);
  return (
    <>
      <Field group label={tr('Sound effects')} hint={tr('Each style has its own sounds. “Everything” adds a soft tick as you move through menus and lists.')}>
        <Seg
          label={tr('Sound effects')}
          value={level}
          onChange={(v) => store.setPrefs({ soundLevel: v, sound: v !== 'off' })}
          options={[['off', tr('Off')], ['actions', tr('Actions')], ['all', tr('Everything')]]}
        />
      </Field>
      {level !== 'off' && (
        <>
          <Field label={tr('Volume {v}%', { v: vol })}>
            <input
              type="range"
              class="volume"
              min="0"
              max="100"
              step="5"
              value={vol}
              aria-label={tr('Sound volume')}
              onInput={(e) => store.setPrefs({ soundVolume: +e.currentTarget.value / 100 })}
              onChange={() => play('select', { force: true })}
            />
          </Field>
          <Field group label={tr('Try them')}>
            <div class="sound-tests">
              {SOUND_TESTS.map(([ev, label]) => (
                <button type="button" key={ev} class="btn ghost sm" onClick={(e) => (e.stopPropagation(), play(ev, { force: true }))}>
                  {tr(label)}
                </button>
              ))}
            </div>
          </Field>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function useSyncState() {
  const [s, setS] = useState(sync.getSyncState());
  useEffect(() => sync.onSyncState(setS), []);
  return s;
}

function SyncPanel() {
  const prefs = store.getPrefs();
  const s = useSyncState();
  if (!prefs.firebaseConfig) return <ConnectProject />;
  if (s.status === 'signed-out' || (s.status === 'error' && !prefs.syncUid) || s.status === 'connecting') return <SignIn state={s} />;
  return <SignedIn state={s} />;
}

function ConnectProject() {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [guide, setGuide] = useState(false);
  const connect = async () => {
    setErr('');
    let cfg;
    try {
      cfg = sync.parseConfig(text);
    } catch (e) {
      setErr(e.message);
      return;
    }
    setBusy(true);
    await sync.setConfig(cfg);
    setBusy(false);
  };
  return (
    <div class="panel-stack">
      <p class="lead">
        {tr('Sync keeps your tasks the same on your phone, PC and browser. Tasks are stored in your own free Firebase project, so only you can reach them.')}
      </p>
      <Field label={tr('Setup code or Firebase config')} hint={tr('Already set up on another device? Paste the setup code shown there. Setting up for the first time? Paste the firebaseConfig block.')}>
        <textarea class="mono" rows={5} value={text} spellcheck={false} placeholder={tr('TW1-…  or  const firebaseConfig = { apiKey: "…", … }')} onInput={(e) => setText(e.currentTarget.value)} />
      </Field>
      {err && <p class="form-error" role="alert">{err}</p>}
      <div class="row-actions">
        <button type="button" class="btn primary" disabled={!text.trim() || busy} onClick={connect}>{busy ? tr('Connecting…') : tr('Connect')}</button>
        <button type="button" class="btn ghost" onClick={() => setGuide(!guide)} aria-expanded={guide}>
          {guide ? tr('Hide setup steps') : tr('How do I get a config?')}
        </button>
      </div>
      {guide && <SetupSteps />}
    </div>
  );
}

function SetupSteps() {
  const copyRules = async () => (await copyText(RULES)) && toast(tr('Rules copied'));
  const consoleLink = (
    <button type="button" class="link-btn accent" onClick={() => openExternal('https://console.firebase.google.com/')}>console.firebase.google.com</button>
  );
  const rules = (
    <>
      <pre class="code">{RULES}</pre>
      <button type="button" class="btn ghost sm" onClick={copyRules}>
        <Icon name="copy" size={16} /> {tr('Copy rules')}
      </button>
    </>
  );
  if (isZh()) {
    // Firebase's own menus may be in English or Chinese, so both names are given.
    return (
      <ol class="steps">
        <li>前往 {consoleLink}，用 Google 帳戶登入，然後選擇<b>建立專案（Create a project）</b>。名稱隨意，例如「checkmate-sync」。Google Analytics 可以不開。</li>
        <li>在左邊選單打開<b>建構 → Authentication</b>，按<b>開始使用（Get started）</b>，選擇<b>電子郵件/密碼（Email/Password）</b>，開啟後儲存。</li>
        <li>打開<b>建構 → Firestore Database</b>，按<b>建立資料庫（Create database）</b>，選擇離你較近的位置，並以<b>正式版模式（production mode）</b>開始。</li>
        <li>
          在 Firestore 打開<b>規則（Rules）</b>分頁，把內容全部換成下面的規則，然後按<b>發布（Publish）</b>。
          {rules}
        </li>
        <li>按<b>專案總覽（Project overview）</b>旁的齒輪 →<b>專案設定（Project settings）</b>。在<b>你的應用程式（Your apps）</b>下按網頁圖示 <code>&lt;/&gt;</code>，取個暱稱並註冊（不需要 Hosting）。</li>
        <li>複製畫面上的 <code>firebaseConfig = {'{ … }'}</code> 區塊，貼到上面並按<b>連線</b>，然後建立你的帳戶。</li>
      </ol>
    );
  }
  return (
    <ol class="steps">
      <li>
        Go to {consoleLink}, sign in with a Google account and choose <b>Create a project</b>. Any name works, for example “checkmate-sync”. Google Analytics can stay off.
      </li>
      <li>In the left menu open <b>Build → Authentication</b>, click <b>Get started</b>, choose <b>Email/Password</b>, switch it on and save.</li>
      <li>Open <b>Build → Firestore Database</b>, click <b>Create database</b>, pick a location near you and start in <b>production mode</b>.</li>
      <li>
        In Firestore open the <b>Rules</b> tab, replace everything with the rules below and click <b>Publish</b>.
        {rules}
      </li>
      <li>Click the gear next to <b>Project overview → Project settings</b>. Under <b>Your apps</b> click the web icon <code>&lt;/&gt;</code>, give it a nickname and register it (no hosting needed).</li>
      <li>Copy the <code>firebaseConfig = {'{ … }'}</code> block it shows, paste it above and choose <b>Connect</b>. Then create your account.</li>
    </ol>
  );
}

function SignIn({ state }) {
  const [email, setEmail] = useState(store.getPrefs().syncEmail || '');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState('');
  const run = (kind) => async (e) => {
    e && e.preventDefault();
    setErr('');
    setInfo('');
    setBusy(kind);
    try {
      if (kind === 'in') await sync.signIn(email, pw);
      else if (kind === 'up') await sync.signUp(email, pw);
      else if (kind === 'reset') {
        await sync.resetPassword(email);
        setInfo(tr('A reset link is on its way to {email}.', { email: email.trim() }));
      }
    } catch (x) {
      play('error');
      setErr(x.message);
    }
    setBusy('');
  };
  const cfg = store.getPrefs().firebaseConfig;
  return (
    <form class="panel-stack" onSubmit={run('in')}>
      <p class="lead">
        {tr('Sign in to start syncing. Use the same email and password on every device.')}
        <span class="muted"> {tr('Project: {id}', { id: cfg.projectId })}</span>
      </p>
      {state.status === 'connecting' && <p class="muted">{tr('Connecting to Firebase…')}</p>}
      {state.error && <p class="form-error" role="alert">{state.error}</p>}
      <Field label={tr('Email')}>
        <input type="email" autocomplete="username" value={email} onInput={(e) => setEmail(e.currentTarget.value)} required />
      </Field>
      <Field label={tr('Password')} hint={tr('At least 6 characters.')}>
        <input type="password" autocomplete="current-password" value={pw} onInput={(e) => setPw(e.currentTarget.value)} required minLength={6} />
      </Field>
      {err && <p class="form-error" role="alert">{err}</p>}
      {info && <p class="form-ok" role="status">{info}</p>}
      <div class="row-actions">
        <button type="submit" class="btn primary" disabled={!!busy || !email || pw.length < 6}>{busy === 'in' ? tr('Signing in…') : tr('Sign in')}</button>
        <button type="button" class="btn ghost" disabled={!!busy || !email || pw.length < 6} onClick={run('up')}>{busy === 'up' ? tr('Creating…') : tr('Create account')}</button>
      </div>
      <div class="row-actions small">
        <button type="button" class="link-btn" disabled={!email || !!busy} onClick={run('reset')}>{tr('Forgot password?')}</button>
        <button
          type="button"
          class="link-btn"
          onClick={async () => {
            if (await confirmDialog({ title: tr('Use a different Firebase project?'), body: tr('This device forgets the current project config. Your tasks stay on this device.'), confirm: tr('Forget project') })) sync.removeConfig();
          }}
        >
          {tr('Use a different project')}
        </button>
      </div>
    </form>
  );
}

function SignedIn({ state }) {
  const prefs = store.getPrefs();
  const code = sync.makeSetupCode(prefs.firebaseConfig);
  const label = {
    synced: tr('Up to date'),
    syncing: tr('Syncing…'),
    offline: tr('Offline. Changes are saved here and sync when you’re back online.'),
    error: state.error,
    connecting: tr('Connecting…'),
  }[state.status] || state.status;
  const ago = state.lastSync ? new Date(state.lastSync).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;
  return (
    <div class="panel-stack">
      <div class={`sync-card st-${state.status}`}>
        <Icon name={state.status === 'offline' || state.status === 'error' ? 'cloudOff' : 'cloud'} size={28} />
        <div>
          <strong>{state.email || prefs.syncEmail}</strong>
          <span role="status">{label}{state.status === 'synced' && ago ? ` · ${tr('last checked {time}', { time: ago })}` : ''}</span>
          {state.pending > 0 && state.status !== 'synced' && <span class="muted">{tr('{n} change{s} waiting to upload', { n: state.pending })}</span>}
        </div>
      </div>
      <div class="row-actions">
        <button type="button" class="btn ghost" onClick={() => sync.syncNow()}>{tr('Sync now')}</button>
        <button
          type="button"
          class="btn ghost"
          onClick={async () => {
            if (await confirmDialog({ title: tr('Sign out of sync?'), body: tr('Your tasks stay on this device. They stop syncing until you sign in again.'), confirm: tr('Sign out') })) sync.signOutSync();
          }}
        >
          {tr('Sign out')}
        </button>
      </div>
      <Field label={tr('Add another device')} hint={tr('On your phone or other PC, open Settings → Sync and paste this code, then sign in with the same email. The code holds your project details, not your password.')}>
        <div class="copy-row">
          <input type="text" class="mono" readOnly value={code} onFocus={(e) => e.currentTarget.select()} aria-label={tr('Setup code')} />
          <button type="button" class="btn primary sm" onClick={async () => (await copyText(code)) && toast(tr('Setup code copied'))}>{tr('Copy')}</button>
        </div>
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------------------

function DataPanel() {
  const [paste, setPaste] = useState('');
  const [err, setErr] = useState('');
  const doImport = async (text) => {
    setErr('');
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      play('error');
      setErr(tr('That isn’t a valid backup file.'));
      return;
    }
    const ok = await confirmDialog({ title: tr('Import this backup?'), body: tr('Tasks in the backup are added or updated. Nothing on this device is deleted.'), confirm: tr('Import') });
    if (!ok) return;
    try {
      const n = store.importData(data);
      toast(tr('Imported {n} item{s}', { n }));
      setPaste('');
    } catch (e) {
      setErr(tr(e.message));
    }
  };
  const json = () => JSON.stringify(store.exportData(), null, 1);
  return (
    <div class="panel-stack">
      <p class="lead">{tr('A backup is a single file with every project, task, label and comment on this device.')}</p>
      <div class="row-actions">
        <button type="button" class="btn primary" onClick={() => saveFile(`checkmate-backup-${ymd(new Date())}.json`, 'application/json', json())}>
          <Icon name="download" size={18} /> {tr('Save backup file')}
        </button>
        <button type="button" class="btn ghost" onClick={async () => (await copyText(json())) && toast(tr('Backup copied'))}>
          <Icon name="copy" size={18} /> {tr('Copy as text')}
        </button>
      </div>
      <Field label={tr('Restore from a backup file')}>
        <input
          type="file"
          accept="application/json,.json"
          onChange={(e) => {
            const f = e.currentTarget.files && e.currentTarget.files[0];
            if (!f) return;
            f.text().then(doImport);
            e.currentTarget.value = '';
          }}
        />
      </Field>
      <Field label={tr('…or paste backup text')}>
        <textarea class="mono" rows={3} value={paste} onInput={(e) => setPaste(e.currentTarget.value)} placeholder='{"app":"Checkmate", …}' />
      </Field>
      {paste.trim() && <button type="button" class="btn ghost" onClick={() => doImport(paste)}>{tr('Import pasted text')}</button>}
      {err && <p class="form-error" role="alert">{err}</p>}
      <hr class="sep" />
      <button
        type="button"
        class="btn danger-ghost"
        onClick={async () => {
          const ok = await confirmDialog({
            title: tr('Erase everything on this device?'),
            body: tr('Tasks, projects and settings on this device are removed. If you use sync, sign in again to download your tasks.'),
            confirm: tr('Erase'),
            danger: true,
          });
          if (ok) {
            await sync.stop();
            store.eraseLocal();
            location.hash = '#/today';
            location.reload();
          }
        }}
      >
        <Icon name="trash" size={18} /> {tr('Erase this device')}
      </button>
    </div>
  );
}

function Keys() {
  const rows = [
    [['Q'], 'Add a task'],
    [['/'], 'Search'],
    [['G', 'T'], 'Go to Today'],
    [['G', 'I'], 'Go to Inbox'],
    [['G', 'U'], 'Go to Upcoming'],
    [['G', 'L'], 'Go to Calendar'],
    [['G', 'B'], 'Go to Birthdays'],
    [['G', 'F'], 'Go to Filters & labels'],
    [['G', 'C'], 'Go to Completed'],
    [['M'], 'Show or hide the sidebar'],
    [['Enter'], 'Save a new task'],
    [['Ctrl', '+', 'Enter'], 'Save from the description box'],
    [['Esc'], 'Close the open panel'],
    [['?'], 'Show these shortcuts'],
  ];
  const calRows = [
    [['C'], 'New event'],
    [['T'], 'Go to today'],
    [['J'], 'Next period'],
    [['K'], 'Previous period'],
    [['D'], 'Day view'],
    [['X'], '3 or 4 day view'],
    [['W'], 'Week view'],
    [['M'], 'Month view'],
    [['Y'], 'Year view'],
    [['A'], 'Schedule view'],
    [['/'], 'Search events'],
  ];
  const table = (list) => (
    <table class="keys">
      <tbody>
        {list.map(([keys, d]) => (
          <tr key={d}>
            <td>
              {keys.map((x, i) => (
                <>
                  {i > 0 && x !== '+' && keys[i - 1] !== '+' && <span class="muted"> {tr('then')} </span>}
                  {x === '+' ? <span class="muted"> + </span> : <kbd key={i}>{x}</kbd>}
                </>
              ))}
            </td>
            <td>{tr(d)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <div class="panel-stack">
      <p class="lead">{tr('Typing in a task name understands dates (“fri 3pm”, “every mon”), priorities (p1–p4), #projects, /sections and @labels.')}</p>
      {table(rows)}
      <h3 class="keys-head">{tr('On the Calendar')}</h3>
      <p class="lead">{tr('Typing in a new event’s title understands dates, times and repeats too, such as “Lunch fri 12:30-1:30pm” or “明天下午3點到5點 開會”.')}</p>
      {table(calRows)}
    </div>
  );
}
